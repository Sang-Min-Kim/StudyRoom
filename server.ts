import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import multer from 'multer';
import { WebSocket, WebSocketServer } from 'ws';
import type {
  ChatMessage,
  MaterialItem,
  MaterialType,
  Participant,
  Role,
  RoomPublicState,
  StoredFileMeta,
  SubmissionItem,
  SubmissionStatus,
} from './src/types.ts';

interface StoredFileRecord extends StoredFileMeta {
  diskPath: string;
}

interface InternalMaterial extends Omit<MaterialItem, 'file'> {
  file?: StoredFileRecord;
}

interface InternalSubmission extends Omit<SubmissionItem, 'file'> {
  file?: StoredFileRecord;
}

interface InternalRoom {
  code: string;
  title: string;
  instructorName: string;
  notice: string;
  submissionsOpen: boolean;
  passwordHash: string;
  hostTokens: string[];
  createdAt: number;
  materials: InternalMaterial[];
  submissions: InternalSubmission[];
  messages: ChatMessage[];
}

interface SocketSession {
  ws: WebSocket;
  roomCode: string | null;
  clientId: string;
  name: string;
  role: Role;
  joinedAt: number;
  isAlive: boolean;
}

function resolvePort(): number {
  const portArgIdx = process.argv.indexOf('--port');
  if (portArgIdx !== -1 && process.argv[portArgIdx + 1]) {
    const parsed = Number(process.argv[portArgIdx + 1]);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  const envPort = process.env.PORT;
  const nginxPort = process.env.NGINX_PORT;
  if (envPort && nginxPort && envPort === nginxPort) {
    return Number(process.env.DEFAULT_APP_PORT || 3000);
  }
  return Number(envPort || 3000);
}

const PORT = resolvePort();
const DATA_DIR = path.resolve(process.cwd(), '.studyroom-data');
const ROOMS_FILE = path.join(DATA_DIR, 'rooms.json');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const TEMP_CHUNKS_DIR = path.join(UPLOADS_DIR, '_chunks');
const MAX_FILE_BYTES = 50 * 1024 * 1024; // 50MB
const MAX_CHUNK_BYTES = 4 * 1024 * 1024; // 4MB per chunk

fs.mkdirSync(UPLOADS_DIR, { recursive: true });
fs.mkdirSync(TEMP_CHUNKS_DIR, { recursive: true });

// ---- Security helpers (scrypt) ----
function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, keyHex] = parts;
  const keyBuf = Buffer.from(keyHex, 'hex');
  const derivedBuf = crypto.scryptSync(password, salt, 64);
  if (keyBuf.length !== derivedBuf.length) return false;
  return crypto.timingSafeEqual(keyBuf, derivedBuf);
}

function createToken(): string {
  return crypto.randomBytes(24).toString('hex');
}

function normalizeOriginalFilename(name: string): string {
  try {
    // Handle multer's latin1 decoding of UTF-8 multipart filenames when needed
    const decoded = Buffer.from(name, 'latin1').toString('utf8');
    if (decoded && !decoded.includes('\uFFFD') && /[가-힣ㄱ-ㅎㅏ-ㅣ]/.test(decoded)) {
      return decoded;
    }
  } catch {
    // fallback
  }
  return name;
}

// ---- Persistence ----
const rooms = new Map<string, InternalRoom>();
const roomSockets = new Map<string, Set<SocketSession>>();

function loadRoomsFromDisk(): void {
  try {
    if (!fs.existsSync(ROOMS_FILE)) return;
    const raw = fs.readFileSync(ROOMS_FILE, 'utf8');
    const parsed = JSON.parse(raw) as InternalRoom[];
    if (!Array.isArray(parsed)) return;
    for (const room of parsed) {
      if (room && typeof room.code === 'string') {
        rooms.set(room.code, room);
      }
    }
  } catch (err) {
    console.error('Failed to load rooms from disk:', err);
  }
}

function schedulePersist(): void {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const data = Array.from(rooms.values());
    const tmpPath = `${ROOMS_FILE}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmpPath, ROOMS_FILE);
  } catch (err) {
    console.error('Failed to persist rooms:', err);
  }
}

loadRoomsFromDisk();

// ---- Helpers ----
function getParticipants(roomCode: string): Participant[] {
  const sessions = roomSockets.get(roomCode);
  if (!sessions) return [];
  const byClient = new Map<string, Participant>();
  for (const session of sessions) {
    const existing = byClient.get(session.clientId);
    if (!existing || session.role === 'instructor') {
      byClient.set(session.clientId, {
        clientId: session.clientId,
        name: session.name,
        role: session.role,
        joinedAt: session.joinedAt,
      });
    }
  }
  return Array.from(byClient.values()).sort((a, b) => {
    if (a.role !== b.role) return a.role === 'instructor' ? -1 : 1;
    return a.joinedAt - b.joinedAt;
  });
}

function toPublicFileMeta(file: StoredFileRecord): StoredFileMeta {
  return {
    id: file.id,
    originalName: file.originalName,
    mimeType: file.mimeType,
    size: file.size,
    url: file.url,
  };
}

function toPublicRoom(room: InternalRoom, viewerRole: Role, viewerClientId?: string): RoomPublicState {
  return {
    code: room.code,
    title: room.title,
    instructorName: room.instructorName,
    notice: room.notice,
    submissionsOpen: room.submissionsOpen,
    createdAt: room.createdAt,
    materials: room.materials.map((m) => ({
      id: m.id,
      type: m.type,
      title: m.title,
      content: m.content,
      linkUrl: m.linkUrl,
      pinned: m.pinned,
      file: m.file ? toPublicFileMeta(m.file) : undefined,
      createdAt: m.createdAt,
      updatedAt: m.updatedAt,
    })),
    submissions: room.submissions
      .filter((s) => viewerRole === 'instructor' || (viewerClientId && s.studentId === viewerClientId))
      .map((s) => ({
        id: s.id,
        studentId: s.studentId,
        studentName: s.studentName,
        comment: s.comment,
        feedback: s.feedback,
        status: s.status,
        file: s.file ? toPublicFileMeta(s.file) : undefined,
        linkUrl: s.linkUrl,
        linkTitle: s.linkTitle,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      })),
    messages: room.messages,
    participants: getParticipants(room.code),
  };
}

function broadcastToRoom(
  roomCode: string,
  payload: unknown,
  filter?: (session: SocketSession) => boolean
): void {
  const sessions = roomSockets.get(roomCode);
  if (!sessions) return;
  const raw = JSON.stringify(payload);
  for (const session of sessions) {
    if (session.ws.readyState !== WebSocket.OPEN) continue;
    if (filter && !filter(session)) continue;
    session.ws.send(raw);
  }
}

function removeFileFromDisk(diskPath?: string): void {
  if (!diskPath) return;
  try {
    if (fs.existsSync(diskPath)) {
      fs.unlinkSync(diskPath);
    }
  } catch {
    // ignore cleanup failures
  }
}

function findFileRecord(room: InternalRoom, fileId: string): StoredFileRecord | null {
  for (const m of room.materials) {
    if (m.file && m.file.id === fileId) return m.file;
  }
  for (const s of room.submissions) {
    if (s.file && s.file.id === fileId) return s.file;
  }
  return null;
}

// ---- Multer Upload Setup ----
const storage = multer.diskStorage({
  destination(req, _file, cb) {
    const code = String(req.params.code || 'general').replace(/\D/g, '').slice(0, 4) || 'general';
    const dir = path.join(UPLOADS_DIR, code);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename(_req, file, cb) {
    const ext = path.extname(normalizeOriginalFilename(file.originalname)).slice(0, 16);
    const id = crypto.randomUUID();
    cb(null, `${id}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_BYTES },
});

const chunkUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_CHUNK_BYTES },
});

interface PendingChunkSession {
  id: string;
  roomCode: string;
  originalName: string;
  mimeType: string;
  totalSize: number;
  totalChunks: number;
  dirPath: string;
  createdAt: number;
}

const pendingUploads = new Map<string, PendingChunkSession>();

function cleanupPendingUpload(uploadId: string): void {
  const session = pendingUploads.get(uploadId);
  if (session) {
    pendingUploads.delete(uploadId);
    try {
      if (fs.existsSync(session.dirPath)) {
        fs.rmSync(session.dirPath, { recursive: true, force: true });
      }
    } catch {
      // ignore
    }
  }
}

function assembleChunkedUpload(roomCode: string, uploadId: string): StoredFileRecord {
  const session = pendingUploads.get(uploadId);
  if (!session || session.roomCode !== roomCode) {
    throw new Error('유효하지 않거나 만료된 업로드 세션입니다. 다시 시도해 주세요.');
  }

  const roomDir = path.join(UPLOADS_DIR, roomCode);
  fs.mkdirSync(roomDir, { recursive: true });

  const fileId = crypto.randomUUID();
  const ext = path.extname(session.originalName).slice(0, 16);
  const finalPath = path.join(roomDir, `${fileId}${ext}`);

  const writeFd = fs.openSync(finalPath, 'w');
  let assembledSize = 0;
  try {
    for (let i = 0; i < session.totalChunks; i += 1) {
      const partPath = path.join(session.dirPath, `part_${i}`);
      if (!fs.existsSync(partPath)) {
        throw new Error(`업로드 파일 조각(${i + 1}/${session.totalChunks})이 누락되었습니다.`);
      }
      const chunkBuf = fs.readFileSync(partPath);
      fs.writeSync(writeFd, chunkBuf);
      assembledSize += chunkBuf.length;
    }
  } catch (err) {
    fs.closeSync(writeFd);
    removeFileFromDisk(finalPath);
    throw err;
  }
  fs.closeSync(writeFd);

  if (assembledSize > MAX_FILE_BYTES) {
    removeFileFromDisk(finalPath);
    throw new Error('파일 크기는 최대 50MB까지 업로드할 수 있습니다.');
  }

  cleanupPendingUpload(uploadId);

  return {
    id: fileId,
    originalName: session.originalName,
    mimeType: session.mimeType,
    size: assembledSize,
    url: `/api/rooms/${roomCode}/files/${fileId}`,
    diskPath: finalPath,
  };
}

// Clean up abandoned chunk folders every 15 minutes
setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [id, session] of pendingUploads.entries()) {
    if (session.createdAt < cutoff) {
      cleanupPendingUpload(id);
    }
  }
}, 15 * 60 * 1000);

// ---- Express App ----
const app = express();
app.use(express.json({ limit: '2mb' }));

// CORS & preflight for /api/* (supports separated frontend/backend origins when configured)
app.use('/api', (req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-host-token');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
});

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

// Check if room exists
app.get('/api/rooms/:code/check', (req, res) => {
  const code = String(req.params.code || '').trim();
  if (!/^\d{4}$/.test(code)) {
    res.json({ exists: false });
    return;
  }
  const room = rooms.get(code);
  if (!room) {
    res.json({ exists: false });
    return;
  }
  res.json({
    exists: true,
    title: room.title,
    instructorName: room.instructorName,
    participantCount: getParticipants(code).length,
  });
});

// Create a new room
app.post('/api/rooms', (req, res) => {
  const code = String(req.body?.code || '').trim();
  const title = String(req.body?.title || '').trim();
  const instructorName = String(req.body?.instructorName || '').trim() || '강사';
  const adminPassword = String(req.body?.adminPassword || '');

  if (!/^\d{4}$/.test(code)) {
    res.status(400).json({ error: '4자리 숫자 강의 번호를 입력해 주세요.' });
    return;
  }
  if (rooms.has(code)) {
    res.status(409).json({ error: `이미 사용 중인 강의 번호(${code})입니다. 다른 번호를 선택해 주세요.` });
    return;
  }
  if (!title) {
    res.status(400).json({ error: '강의 제목을 입력해 주세요.' });
    return;
  }
  if (adminPassword.trim().length < 4) {
    res.status(400).json({ error: '강사 관리 비밀번호는 최소 4자 이상이어야 합니다.' });
    return;
  }

  const hostToken = createToken();
  const room: InternalRoom = {
    code,
    title: title.slice(0, 100),
    instructorName: instructorName.slice(0, 40),
    notice: '',
    submissionsOpen: true,
    passwordHash: hashPassword(adminPassword),
    hostTokens: [hostToken],
    createdAt: Date.now(),
    materials: [],
    submissions: [],
    messages: [],
  };

  rooms.set(code, room);
  schedulePersist();

  res.status(201).json({
    room: toPublicRoom(room, 'instructor'),
    hostToken,
  });
});

// Host login from another device using adminPassword
app.post('/api/rooms/host-login', (req, res) => {
  const code = String(req.body?.code || '').trim();
  const adminPassword = String(req.body?.adminPassword || '');

  if (!/^\d{4}$/.test(code)) {
    res.status(400).json({ error: '4자리 강의 번호를 입력해 주세요.' });
    return;
  }

  const room = rooms.get(code);
  if (!room) {
    res.status(404).json({ error: '해당 4자리 번호의 강의실을 찾을 수 없습니다.' });
    return;
  }

  if (!verifyPassword(adminPassword, room.passwordHash)) {
    res.status(401).json({ error: '강사 관리 비밀번호가 일치하지 않습니다.' });
    return;
  }

  const hostToken = createToken();
  room.hostTokens.push(hostToken);
  if (room.hostTokens.length > 20) {
    room.hostTokens = room.hostTokens.slice(-20);
  }
  schedulePersist();

  res.json({
    room: toPublicRoom(room, 'instructor'),
    name: room.instructorName,
    hostToken,
  });
});

// Join room (student or returning host)
app.post('/api/rooms/join', (req, res) => {
  const code = String(req.body?.code || '').trim();
  const name = String(req.body?.name || '').trim();
  const clientId = String(req.body?.clientId || '').trim() || crypto.randomUUID();
  const hostToken = typeof req.body?.hostToken === 'string' ? req.body.hostToken : undefined;

  if (!/^\d{4}$/.test(code)) {
    res.status(400).json({ error: '4자리 강의 번호를 정확히 입력해 주세요.' });
    return;
  }

  const room = rooms.get(code);
  if (!room) {
    res.status(404).json({ error: `번호 ${code}에 해당하는 강의실이 열려 있지 않습니다.` });
    return;
  }

  const isValidHost = Boolean(hostToken && room.hostTokens.includes(hostToken));
  if (hostToken && !isValidHost) {
    res.status(401).json({ error: '강사 인증이 만료되었습니다. 관리 비밀번호로 다시 입장해 주세요.' });
    return;
  }

  const role: Role = isValidHost ? 'instructor' : 'student';
  const resolvedName = (name || (role === 'instructor' ? room.instructorName : '')).slice(0, 40);
  if (!resolvedName) {
    res.status(400).json({ error: '이름 또는 닉네임을 입력해 주세요.' });
    return;
  }

  res.json({
    room: toPublicRoom(room, role, clientId),
    role,
    clientId,
    name: resolvedName,
  });
});

// Middleware to verify instructor token
function requireHost(req: express.Request, res: express.Response): InternalRoom | null {
  const code = String(req.params.code || '').trim();
  const room = rooms.get(code);
  if (!room) {
    res.status(404).json({ error: '강의실을 찾을 수 없습니다.' });
    return null;
  }
  const token = String(req.headers['x-host-token'] || '');
  if (!token || !room.hostTokens.includes(token)) {
    res.status(403).json({ error: '강사 권한이 없거나 인증이 만료되었습니다.' });
    return null;
  }
  return room;
}

// Update room settings
app.patch('/api/rooms/:code/settings', (req, res) => {
  const room = requireHost(req, res);
  if (!room) return;

  const patch: Partial<Pick<RoomPublicState, 'title' | 'notice' | 'submissionsOpen'>> = {};

  if (typeof req.body?.title === 'string') {
    const trimmed = req.body.title.trim().slice(0, 100);
    if (trimmed) {
      room.title = trimmed;
      patch.title = trimmed;
    }
  }
  if (typeof req.body?.notice === 'string') {
    const trimmedNotice = req.body.notice.trim().slice(0, 500);
    room.notice = trimmedNotice;
    patch.notice = trimmedNotice;
  }
  if (typeof req.body?.submissionsOpen === 'boolean') {
    room.submissionsOpen = req.body.submissionsOpen;
    patch.submissionsOpen = req.body.submissionsOpen;
  }

  schedulePersist();
  broadcastToRoom(room.code, { type: 'room:updated', patch });
  res.json({ ok: true, patch });
});

// Change instructor admin password
app.patch('/api/rooms/:code/password', (req, res) => {
  const room = requireHost(req, res);
  if (!room) return;

  const currentPassword = String(req.body?.currentPassword || '');
  const newPassword = String(req.body?.newPassword || '');
  const revokeOtherSessions = Boolean(req.body?.revokeOtherSessions);

  if (!verifyPassword(currentPassword, room.passwordHash)) {
    res.status(401).json({ error: '현재 강사 비밀번호가 일치하지 않습니다.' });
    return;
  }
  if (newPassword.trim().length < 4) {
    res.status(400).json({ error: '새 비밀번호는 최소 4자 이상 입력해 주세요.' });
    return;
  }

  room.passwordHash = hashPassword(newPassword);
  let newToken: string | undefined;
  if (revokeOtherSessions) {
    newToken = createToken();
    room.hostTokens = [newToken];
  }
  schedulePersist();

  res.json({ ok: true, hostToken: newToken });
});

// Close room
app.delete('/api/rooms/:code', (req, res) => {
  const room = requireHost(req, res);
  if (!room) return;

  const code = room.code;
  broadcastToRoom(code, { type: 'room:closed', reason: '강사가 강의실을 종료했습니다.' });
  rooms.delete(code);

  // Cleanup uploaded directory
  const roomUploadDir = path.join(UPLOADS_DIR, code);
  try {
    if (fs.existsSync(roomUploadDir)) {
      fs.rmSync(roomUploadDir, { recursive: true, force: true });
    }
  } catch {
    // ignore
  }
  schedulePersist();
  res.json({ ok: true });
});

// Initialize chunked upload session (allows up to 50MB reliably behind proxy limits)
app.post('/api/rooms/:code/uploads/init', (req, res) => {
  const code = String(req.params.code || '').trim();
  const room = rooms.get(code);
  if (!room) {
    res.status(404).json({ error: '강의실을 찾을 수 없습니다.' });
    return;
  }

  const originalName = String(req.body?.fileName || 'file').trim().slice(0, 240) || 'file';
  const mimeType = String(req.body?.mimeType || 'application/octet-stream').trim() || 'application/octet-stream';
  const totalSize = Number(req.body?.totalSize || 0);
  const totalChunks = Number(req.body?.totalChunks || 0);

  if (!Number.isFinite(totalSize) || totalSize <= 0 || totalSize > MAX_FILE_BYTES) {
    res.status(413).json({ error: '파일 크기는 최대 50MB까지 업로드할 수 있습니다.' });
    return;
  }
  if (!Number.isInteger(totalChunks) || totalChunks < 1 || totalChunks > 100) {
    res.status(400).json({ error: '올바르지 않은 분할 업로드 요청입니다.' });
    return;
  }

  const uploadId = crypto.randomUUID();
  const dirPath = path.join(TEMP_CHUNKS_DIR, uploadId);
  fs.mkdirSync(dirPath, { recursive: true });

  pendingUploads.set(uploadId, {
    id: uploadId,
    roomCode: code,
    originalName,
    mimeType,
    totalSize,
    totalChunks,
    dirPath,
    createdAt: Date.now(),
  });

  res.status(201).json({ uploadId });
});

// Receive a single file chunk
app.post('/api/rooms/:code/uploads/:uploadId/chunk', chunkUpload.single('chunk'), (req, res) => {
  const code = String(req.params.code || '').trim();
  const uploadId = String(req.params.uploadId || '').trim();
  const session = pendingUploads.get(uploadId);

  if (!session || session.roomCode !== code) {
    res.status(404).json({ error: '업로드 세션을 찾을 수 없습니다.' });
    return;
  }
  const chunkIndex = Number(req.body?.chunkIndex);
  if (!Number.isInteger(chunkIndex) || chunkIndex < 0 || chunkIndex >= session.totalChunks) {
    res.status(400).json({ error: '유효하지 않은 파일 조각 인덱스입니다.' });
    return;
  }
  if (!req.file || !req.file.buffer) {
    res.status(400).json({ error: '전송된 파일 조각이 비어 있습니다.' });
    return;
  }

  const partPath = path.join(session.dirPath, `part_${chunkIndex}`);
  fs.writeFileSync(partPath, req.file.buffer);
  res.json({ ok: true, chunkIndex });
});

// Upload / create material
app.post('/api/rooms/:code/materials', upload.single('file'), (req, res) => {
  const room = requireHost(req, res);
  if (!room) {
    if (req.file) removeFileFromDisk(req.file.path);
    return;
  }

  const rawType = String(req.body?.type || 'note');
  const type: MaterialType =
    rawType === 'file' || rawType === 'link' || rawType === 'notice' ? rawType : 'note';
  const content = String(req.body?.content || '').trim();
  const linkUrl = typeof req.body?.linkUrl === 'string' ? req.body.linkUrl.trim() : undefined;
  const pinned = String(req.body?.pinned || '') === 'true';
  const uploadId = typeof req.body?.uploadId === 'string' ? req.body.uploadId.trim() : '';

  let fileMeta: StoredFileRecord | undefined;
  if (uploadId) {
    try {
      fileMeta = assembleChunkedUpload(room.code, uploadId);
    } catch (err) {
      if (req.file) removeFileFromDisk(req.file.path);
      res.status(400).json({
        error: err instanceof Error ? err.message : '파일 병합에 실패했습니다.',
      });
      return;
    }
  } else if (req.file) {
    const fileId = crypto.randomUUID();
    const originalName = normalizeOriginalFilename(req.file.originalname);
    fileMeta = {
      id: fileId,
      originalName,
      mimeType: req.file.mimetype || 'application/octet-stream',
      size: req.file.size,
      url: `/api/rooms/${room.code}/files/${fileId}`,
      diskPath: req.file.path,
    };
  }

  const rawTitle = String(req.body?.title || '').trim();
  const title =
    rawTitle ||
    (fileMeta ? fileMeta.originalName.replace(/\.[^/.]+$/, '') : type === 'link' ? '참고 링크' : '강의 교안');

  if (type === 'file' && !fileMeta) {
    res.status(400).json({ error: '업로드할 파일을 선택해 주세요.' });
    return;
  }
  if (type === 'note' && !content && !fileMeta) {
    res.status(400).json({ error: '배포할 교안 내용을 입력해 주세요.' });
    return;
  }
  if (type === 'link' && !linkUrl) {
    res.status(400).json({ error: '공유할 웹 주소(URL)를 입력해 주세요.' });
    return;
  }

  const material: InternalMaterial = {
    id: crypto.randomUUID(),
    type,
    title: title.slice(0, 120),
    content: content.slice(0, 10000),
    linkUrl: linkUrl ? linkUrl.slice(0, 500) : undefined,
    pinned,
    file: fileMeta,
    createdAt: Date.now(),
  };

  room.materials.unshift(material);
  schedulePersist();

  const publicMaterial: MaterialItem = {
    ...material,
    file: material.file ? toPublicFileMeta(material.file) : undefined,
  };
  broadcastToRoom(room.code, { type: 'material:created', material: publicMaterial });
  res.status(201).json({ material: publicMaterial });
});

// Update material (pin, title, content)
app.patch('/api/rooms/:code/materials/:id', (req, res) => {
  const room = requireHost(req, res);
  if (!room) return;

  const material = room.materials.find((m) => m.id === req.params.id);
  if (!material) {
    res.status(404).json({ error: '자료를 찾을 수 없습니다.' });
    return;
  }

  if (typeof req.body?.pinned === 'boolean') {
    material.pinned = req.body.pinned;
  }
  if (typeof req.body?.title === 'string' && req.body.title.trim()) {
    material.title = req.body.title.trim().slice(0, 120);
  }
  if (typeof req.body?.content === 'string') {
    material.content = req.body.content.trim().slice(0, 10000);
  }
  if (typeof req.body?.linkUrl === 'string') {
    material.linkUrl = req.body.linkUrl.trim().slice(0, 500) || undefined;
  }
  material.updatedAt = Date.now();

  schedulePersist();
  const publicMaterial: MaterialItem = {
    ...material,
    file: material.file ? toPublicFileMeta(material.file) : undefined,
  };
  broadcastToRoom(room.code, { type: 'material:updated', material: publicMaterial });
  res.json({ material: publicMaterial });
});

// Delete material
app.delete('/api/rooms/:code/materials/:id', (req, res) => {
  const room = requireHost(req, res);
  if (!room) return;

  const idx = room.materials.findIndex((m) => m.id === req.params.id);
  if (idx === -1) {
    res.status(404).json({ error: '자료를 찾을 수 없습니다.' });
    return;
  }

  const [removed] = room.materials.splice(idx, 1);
  if (removed.file) {
    removeFileFromDisk(removed.file.diskPath);
  }
  schedulePersist();
  broadcastToRoom(room.code, { type: 'material:deleted', materialId: removed.id });
  res.json({ ok: true });
});

// Student/Host assignment submission (File and/or URL)
app.post('/api/rooms/:code/submissions', upload.single('file'), (req, res) => {
  const code = String(req.params.code || '').trim();
  const room = rooms.get(code);
  if (!room) {
    if (req.file) removeFileFromDisk(req.file.path);
    res.status(404).json({ error: '강의실을 찾을 수 없습니다.' });
    return;
  }
  const hostToken = String(req.headers['x-host-token'] || '');
  const isHost = Boolean(hostToken && room.hostTokens.includes(hostToken));
  if (!room.submissionsOpen && !isHost) {
    if (req.file) removeFileFromDisk(req.file.path);
    res.status(403).json({ error: '현재 과제 제출이 마감되었습니다.' });
    return;
  }

  const rawLinkUrl = String(req.body?.linkUrl || '').trim();
  let normalizedLinkUrl: string | undefined;
  if (rawLinkUrl) {
    const candidate = /^https?:\/\//i.test(rawLinkUrl) ? rawLinkUrl : `https://${rawLinkUrl}`;
    try {
      const parsed = new URL(candidate);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('Invalid protocol');
      }
      normalizedLinkUrl = parsed.toString().slice(0, 500);
    } catch {
      if (req.file) removeFileFromDisk(req.file.path);
      res.status(400).json({ error: '올바른 웹 주소(URL) 형식을 입력해 주세요.' });
      return;
    }
  }

  const uploadId = typeof req.body?.uploadId === 'string' ? req.body.uploadId.trim() : '';

  if (!req.file && !uploadId && !normalizedLinkUrl) {
    res.status(400).json({ error: '제출할 파일을 선택하거나 URL 주소를 입력해 주세요.' });
    return;
  }

  const studentId = String(req.body?.studentId || '').trim();
  const studentName = String(req.body?.studentName || '').trim() || '수강생';
  const comment = String(req.body?.comment || '').trim().slice(0, 300);
  const linkTitle = String(req.body?.linkTitle || '').trim().slice(0, 120) || undefined;

  if (!studentId) {
    if (req.file) removeFileFromDisk(req.file.path);
    res.status(400).json({ error: '제출자 식별 정보가 누락되었습니다.' });
    return;
  }

  let fileMeta: StoredFileRecord | undefined;
  if (uploadId) {
    try {
      fileMeta = assembleChunkedUpload(room.code, uploadId);
    } catch (err) {
      if (req.file) removeFileFromDisk(req.file.path);
      res.status(400).json({
        error: err instanceof Error ? err.message : '파일 병합에 실패했습니다.',
      });
      return;
    }
  } else if (req.file) {
    const fileId = crypto.randomUUID();
    const originalName = normalizeOriginalFilename(req.file.originalname);
    fileMeta = {
      id: fileId,
      originalName,
      mimeType: req.file.mimetype || 'application/octet-stream',
      size: req.file.size,
      url: `/api/rooms/${room.code}/files/${fileId}`,
      diskPath: req.file.path,
    };
  }

  const submission: InternalSubmission = {
    id: crypto.randomUUID(),
    studentId,
    studentName: studentName.slice(0, 40),
    comment,
    status: 'submitted',
    file: fileMeta,
    linkUrl: normalizedLinkUrl,
    linkTitle,
    createdAt: Date.now(),
  };

  room.submissions.unshift(submission);
  schedulePersist();

  const publicSubmission: SubmissionItem = {
    ...submission,
    file: submission.file ? toPublicFileMeta(submission.file) : undefined,
  };

  broadcastToRoom(
    room.code,
    { type: 'submission:created', submission: publicSubmission },
    (s) => s.role === 'instructor' || s.clientId === studentId
  );

  res.status(201).json({ submission: publicSubmission });
});

// Instructor updates submission review status / feedback
app.patch('/api/rooms/:code/submissions/:id', (req, res) => {
  const room = requireHost(req, res);
  if (!room) return;

  const submission = room.submissions.find((s) => s.id === req.params.id);
  if (!submission) {
    res.status(404).json({ error: '제출물을 찾을 수 없습니다.' });
    return;
  }

  const nextStatus = req.body?.status;
  if (nextStatus === 'submitted' || nextStatus === 'reviewed') {
    submission.status = nextStatus as SubmissionStatus;
  }
  if (typeof req.body?.feedback === 'string') {
    submission.feedback = req.body.feedback.trim().slice(0, 300);
  }
  submission.updatedAt = Date.now();
  schedulePersist();

  const publicSubmission: SubmissionItem = {
    ...submission,
    file: submission.file ? toPublicFileMeta(submission.file) : undefined,
  };

  broadcastToRoom(
    room.code,
    { type: 'submission:updated', submission: publicSubmission },
    (s) => s.role === 'instructor' || s.clientId === submission.studentId
  );

  res.json({ submission: publicSubmission });
});

// Delete submission (instructor or owning student)
app.delete('/api/rooms/:code/submissions/:id', (req, res) => {
  const code = String(req.params.code || '').trim();
  const room = rooms.get(code);
  if (!room) {
    res.status(404).json({ error: '강의실을 찾을 수 없습니다.' });
    return;
  }

  const idx = room.submissions.findIndex((s) => s.id === req.params.id);
  if (idx === -1) {
    res.status(404).json({ error: '제출물을 찾을 수 없습니다.' });
    return;
  }

  const target = room.submissions[idx];
  const hostToken = String(req.headers['x-host-token'] || '');
  const isHost = Boolean(hostToken && room.hostTokens.includes(hostToken));
  const studentId = String(req.query.studentId || '');

  if (!isHost && (!studentId || studentId !== target.studentId)) {
    res.status(403).json({ error: '제출물을 삭제할 권한이 없습니다.' });
    return;
  }

  room.submissions.splice(idx, 1);
  if (target.file) {
    removeFileFromDisk(target.file.diskPath);
  }
  schedulePersist();

  broadcastToRoom(
    room.code,
    { type: 'submission:deleted', submissionId: target.id },
    (s) => s.role === 'instructor' || s.clientId === target.studentId
  );

  res.json({ ok: true });
});

// Serve uploaded files safely
app.get('/api/rooms/:code/files/:fileId', (req, res) => {
  const code = String(req.params.code || '').trim();
  const fileId = String(req.params.fileId || '').trim();
  const room = rooms.get(code);
  if (!room) {
    res.status(404).send('Room not found');
    return;
  }

  const fileRecord = findFileRecord(room, fileId);
  if (!fileRecord || !fs.existsSync(fileRecord.diskPath)) {
    res.status(404).send('File not found');
    return;
  }

  const inline = req.query.inline === '1';
  const encodedName = encodeURIComponent(fileRecord.originalName);
  res.setHeader('Content-Type', fileRecord.mimeType || 'application/octet-stream');
  res.setHeader(
    'Content-Disposition',
    `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodedName}`
  );
  res.sendFile(fileRecord.diskPath);
});

// Unmatched /api/* JSON 404 handler
app.all('/api/*', (_req, res) => {
  res.status(404).json({ error: '요청한 API 경로를 찾을 수 없습니다.' });
});

// Multer & global error handler (always returns JSON for /api/*)
app.use(
  (
    err: unknown,
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        res.status(413).json({ error: '파일 크기는 최대 50MB까지 업로드할 수 있습니다.' });
        return;
      }
      res.status(400).json({ error: `파일 업로드 오류: ${err.message}` });
      return;
    }
    if (req.path.startsWith('/api/')) {
      console.error('API error:', err);
      res.status(500).json({ error: '서버 내부 처리 중 오류가 발생했습니다.' });
      return;
    }
    next(err);
  }
);

// ---- HTTP & WebSocket Server ----
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
  const session: SocketSession = {
    ws,
    roomCode: null,
    clientId: '',
    name: '',
    role: 'student',
    joinedAt: Date.now(),
    isAlive: true,
  };

  ws.on('pong', () => {
    session.isAlive = true;
  });

  ws.on('message', (raw) => {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }

    const type = String(msg.type || '');

    if (type === 'join') {
      const code = String(msg.code || '').trim();
      const clientId = String(msg.clientId || '').trim();
      const name = String(msg.name || '').trim().slice(0, 40);
      const requestedRole = msg.role === 'instructor' ? 'instructor' : 'student';
      const hostToken = typeof msg.hostToken === 'string' ? msg.hostToken : undefined;

      const room = rooms.get(code);
      if (!room) {
        ws.send(JSON.stringify({ type: 'error', message: '강의실이 존재하지 않거나 종료되었습니다.' }));
        return;
      }

      const verifiedHost =
        requestedRole === 'instructor' && Boolean(hostToken && room.hostTokens.includes(hostToken));

      if (requestedRole === 'instructor' && !verifiedHost) {
        ws.send(JSON.stringify({ type: 'error', message: '강사 권한 인증에 실패했습니다.' }));
        return;
      }

      // Leave previous room if any
      if (session.roomCode && roomSockets.has(session.roomCode)) {
        roomSockets.get(session.roomCode)!.delete(session);
        broadcastToRoom(session.roomCode, {
          type: 'presence:update',
          participants: getParticipants(session.roomCode),
        });
      }

      session.roomCode = code;
      session.clientId = clientId || crypto.randomUUID();
      session.role = verifiedHost ? 'instructor' : 'student';
      session.name = name || (session.role === 'instructor' ? room.instructorName : '수강생');
      session.joinedAt = Date.now();

      if (!roomSockets.has(code)) {
        roomSockets.set(code, new Set());
      }
      roomSockets.get(code)!.add(session);

      ws.send(
        JSON.stringify({
          type: 'room:sync',
          room: toPublicRoom(room, session.role, session.clientId),
        })
      );

      broadcastToRoom(code, {
        type: 'presence:update',
        participants: getParticipants(code),
      });
      return;
    }

    if (!session.roomCode) return;
    const room = rooms.get(session.roomCode);
    if (!room) return;

    if (type === 'chat:send') {
      const text = String(msg.text || '').trim().slice(0, 1500);
      if (!text) return;
      const isQuestion = Boolean(msg.isQuestion);

      const chatMessage: ChatMessage = {
        id: crypto.randomUUID(),
        senderId: session.clientId,
        senderName: session.name,
        role: session.role,
        text,
        isQuestion,
        isPinned: false,
        createdAt: Date.now(),
      };

      room.messages.push(chatMessage);
      if (room.messages.length > 500) {
        room.messages = room.messages.slice(-500);
      }
      schedulePersist();

      broadcastToRoom(room.code, { type: 'chat:message', message: chatMessage });
      return;
    }

    if (type === 'chat:pin') {
      if (session.role !== 'instructor') return;
      const messageId = String(msg.messageId || '');
      const target = room.messages.find((m) => m.id === messageId);
      if (!target) return;
      target.isPinned = !target.isPinned;
      schedulePersist();
      broadcastToRoom(room.code, { type: 'chat:updated', message: target });
      return;
    }

    if (type === 'chat:delete') {
      const messageId = String(msg.messageId || '');
      const idx = room.messages.findIndex((m) => m.id === messageId);
      if (idx === -1) return;
      const target = room.messages[idx];
      if (session.role !== 'instructor' && target.senderId !== session.clientId) {
        return;
      }
      room.messages.splice(idx, 1);
      schedulePersist();
      broadcastToRoom(room.code, { type: 'chat:deleted', messageId });
    }
  });

  ws.on('close', () => {
    if (session.roomCode && roomSockets.has(session.roomCode)) {
      const set = roomSockets.get(session.roomCode)!;
      set.delete(session);
      if (set.size === 0) {
        roomSockets.delete(session.roomCode);
      }
      broadcastToRoom(session.roomCode, {
        type: 'presence:update',
        participants: getParticipants(session.roomCode),
      });
    }
  });
});

// Keepalive heartbeat
const heartbeatInterval = setInterval(() => {
  for (const ws of wss.clients) {
    const extWs = ws as WebSocket & { isAlive?: boolean };
    if (extWs.isAlive === false) {
      ws.terminate();
      continue;
    }
    extWs.isAlive = false;
    ws.ping();
  }
}, 30000);

wss.on('close', () => {
  clearInterval(heartbeatInterval);
});

// ---- Vite Dev Middleware or Static Production ----
async function startServer(): Promise<void> {
  const distDir = path.resolve(process.cwd(), 'dist');
  const distIndex = path.join(distDir, 'index.html');
  const isDevMode =
    process.env.NODE_ENV === 'development' || process.env.npm_lifecycle_event === 'dev';
  const isProd =
    process.env.NODE_ENV === 'production' || (!isDevMode && fs.existsSync(distIndex));

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(distIndex);
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`StudyRoom server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Server startup error:', err);
  process.exit(1);
});
