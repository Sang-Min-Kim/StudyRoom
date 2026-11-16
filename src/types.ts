export type Role = 'instructor' | 'student';

export type MaterialType = 'note' | 'file' | 'link' | 'notice';

export interface StoredFileMeta {
  id: string;
  originalName: string;
  mimeType: string;
  size: number;
  url: string;
}

export interface MaterialItem {
  id: string;
  type: MaterialType;
  title: string;
  content: string;
  linkUrl?: string;
  pinned: boolean;
  file?: StoredFileMeta;
  createdAt: number;
  updatedAt?: number;
}

export type SubmissionStatus = 'submitted' | 'reviewed';

export interface SubmissionItem {
  id: string;
  studentId: string;
  studentName: string;
  comment: string;
  feedback?: string;
  status: SubmissionStatus;
  file?: StoredFileMeta;
  linkUrl?: string;
  linkTitle?: string;
  createdAt: number;
  updatedAt?: number;
}

export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  role: Role;
  text: string;
  isQuestion: boolean;
  isPinned: boolean;
  createdAt: number;
}

export interface Participant {
  clientId: string;
  name: string;
  role: Role;
  joinedAt: number;
}

export interface RoomPublicState {
  code: string;
  title: string;
  instructorName: string;
  notice: string;
  submissionsOpen: boolean;
  createdAt: number;
  materials: MaterialItem[];
  submissions: SubmissionItem[];
  messages: ChatMessage[];
  participants: Participant[];
}

export interface SavedHostRoom {
  code: string;
  title: string;
  instructorName: string;
  hostToken: string;
  createdAt: number;
}

export interface ActiveSession {
  room: RoomPublicState;
  role: Role;
  clientId: string;
  name: string;
  hostToken?: string;
}

export interface RoomCheckResult {
  exists: boolean;
  title?: string;
  instructorName?: string;
  participantCount?: number;
}
