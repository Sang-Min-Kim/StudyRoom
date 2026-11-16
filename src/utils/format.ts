import type { SavedHostRoom } from '../types';

const CLIENT_ID_KEY = 'studyroom_client_id';
const STUDENT_NAME_KEY = 'studyroom_student_name';
const HOST_ROOMS_KEY = 'studyroom_host_rooms';
export const ACTIVE_SESSION_KEY = 'studyroom_active_session';

export function getClientId(): string {
  try {
    const existing = localStorage.getItem(CLIENT_ID_KEY);
    if (existing) return existing;
    const generated =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `client_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(CLIENT_ID_KEY, generated);
    return generated;
  } catch {
    return `client_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }
}

export function getSavedStudentName(): string {
  try {
    return localStorage.getItem(STUDENT_NAME_KEY) || '';
  } catch {
    return '';
  }
}

export function saveStudentName(name: string): void {
  try {
    localStorage.setItem(STUDENT_NAME_KEY, name);
  } catch {
    // ignore storage errors
  }
}

export function getSavedHostRooms(): SavedHostRoom[] {
  try {
    const raw = localStorage.getItem(HOST_ROOMS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveHostRoom(room: SavedHostRoom): void {
  try {
    const list = getSavedHostRooms().filter((r) => r.code !== room.code);
    list.unshift(room);
    localStorage.setItem(HOST_ROOMS_KEY, JSON.stringify(list.slice(0, 10)));
  } catch {
    // ignore storage errors
  }
}

export function removeSavedHostRoom(code: string): void {
  try {
    const list = getSavedHostRooms().filter((r) => r.code !== code);
    localStorage.setItem(HOST_ROOMS_KEY, JSON.stringify(list));
  } catch {
    // ignore storage errors
  }
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

export function formatTime(timestamp: number): string {
  try {
    return new Intl.DateTimeFormat('ko-KR', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(timestamp));
  } catch {
    return '';
  }
}

export function formatDateTime(timestamp: number): string {
  try {
    const now = new Date();
    const d = new Date(timestamp);
    const sameDay =
      now.getFullYear() === d.getFullYear() &&
      now.getMonth() === d.getMonth() &&
      now.getDate() === d.getDate();

    if (sameDay) {
      return formatTime(timestamp);
    }
    return new Intl.DateTimeFormat('ko-KR', {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(d);
  } catch {
    return '';
  }
}

export type PreviewKind = 'image' | 'pdf' | 'text' | null;

export function getPreviewKind(mimeType: string, originalName: string): PreviewKind {
  const mime = (mimeType || '').toLowerCase();
  const name = (originalName || '').toLowerCase();
  if (mime.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(name)) {
    return 'image';
  }
  if (mime === 'application/pdf' || name.endsWith('.pdf')) {
    return 'pdf';
  }
  if (
    mime.startsWith('text/') ||
    mime === 'application/json' ||
    mime === 'application/javascript' ||
    mime === 'application/xml' ||
    /\.(txt|md|markdown|csv|json|js|mjs|cjs|ts|tsx|jsx|py|java|c|cpp|h|cs|go|rs|html|css|scss|yml|yaml|sql|sh|env|log)$/i.test(
      name
    )
  ) {
    return 'text';
  }
  return null;
}

export function getFileCategoryLabel(mimeType: string, originalName: string): string {
  const kind = getPreviewKind(mimeType, originalName);
  const name = (originalName || '').toLowerCase();
  if (kind === 'image') return '이미지';
  if (kind === 'pdf') return 'PDF 문서';
  if (/\.(ppt|pptx|key)$/i.test(name)) return '발표 자료';
  if (/\.(doc|docx|hwp|hwpx)$/i.test(name)) return '문서 파일';
  if (/\.(xls|xlsx|csv)$/i.test(name)) return '스프레드시트';
  if (/\.(zip|tar|gz|7z|rar)$/i.test(name)) return '압축 파일';
  if (/\.(js|ts|tsx|jsx|py|java|c|cpp|html|css|sql|json)$/i.test(name)) return '소스 코드';
  return '첨부 파일';
}
