import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  BookOpen,
  Check,
  Copy,
  FolderUp,
  LogOut,
  Megaphone,
  MessageSquare,
  Settings,
  Share2,
  Users,
  Wifi,
  WifiOff,
} from 'lucide-react';
import type {
  ChatMessage,
  MaterialItem,
  Participant,
  Role,
  RoomPublicState,
  StoredFileMeta,
  SubmissionItem,
} from '../types';
import { apiRequest, resolveApiUrl, resolveWsUrl } from '../utils/api';
import { removeSavedHostRoom, saveHostRoom } from '../utils/format';
import { ChatPanel } from './ChatPanel';
import { FilePreviewModal } from './FilePreviewModal';
import { MaterialsPanel } from './MaterialsPanel';
import { ParticipantsModal, RoomSettingsModal } from './RoomModals';
import { SubmissionsPanel } from './SubmissionsPanel';

interface RoomViewProps {
  initialRoom: RoomPublicState;
  role: Role;
  clientId: string;
  userName: string;
  hostToken?: string;
  onHostTokenUpdated: (newToken: string) => void;
  onLeave: (reason?: string) => void;
}

export const RoomView: React.FC<RoomViewProps> = ({
  initialRoom,
  role,
  clientId,
  userName,
  hostToken,
  onHostTokenUpdated,
  onLeave,
}) => {
  const isInstructor = role === 'instructor';
  const [room, setRoom] = useState<RoomPublicState>(initialRoom);
  const [connected, setConnected] = useState(false);

  // Desktop left workspace tab: materials | submissions
  const [desktopTab, setDesktopTab] = useState<'materials' | 'submissions'>('materials');
  // Mobile active tab: materials | submissions | chat
  const [mobileTab, setMobileTab] = useState<'materials' | 'submissions' | 'chat'>(
    'materials'
  );
  const [unreadChat, setUnreadChat] = useState(0);

  const [copiedPin, setCopiedPin] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [participantsOpen, setParticipantsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [previewFile, setPreviewFile] = useState<StoredFileMeta | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const mobileTabRef = useRef(mobileTab);
  mobileTabRef.current = mobileTab;

  // WebSocket real-time connection with auto-reconnect
  useEffect(() => {
    let disposed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let delay = 1000;

    const connect = () => {
      if (disposed) return;
      const socket = new WebSocket(resolveWsUrl());
      wsRef.current = socket;

      socket.onopen = () => {
        if (disposed) {
          socket.close();
          return;
        }
        delay = 1000;
        setConnected(true);
        socket.send(
          JSON.stringify({
            type: 'join',
            code: initialRoom.code,
            clientId,
            name: userName,
            role,
            hostToken,
          })
        );
      };

      socket.onmessage = (event) => {
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(String(event.data));
        } catch {
          return;
        }

        switch (msg.type) {
          case 'room:sync': {
            const synced = msg.room as RoomPublicState;
            setRoom(synced);
            break;
          }
          case 'presence:update': {
            const participants = msg.participants as Participant[];
            setRoom((prev) => ({ ...prev, participants }));
            break;
          }
          case 'room:updated': {
            const patch = msg.patch as Partial<RoomPublicState>;
            setRoom((prev) => ({ ...prev, ...patch }));
            break;
          }
          case 'room:closed': {
            if (isInstructor) removeSavedHostRoom(initialRoom.code);
            onLeave(
              typeof msg.reason === 'string'
                ? msg.reason
                : '강의실이 종료되었습니다.'
            );
            break;
          }
          case 'material:created': {
            const material = msg.material as MaterialItem;
            setRoom((prev) =>
              prev.materials.some((m) => m.id === material.id)
                ? prev
                : { ...prev, materials: [material, ...prev.materials] }
            );
            break;
          }
          case 'material:updated': {
            const material = msg.material as MaterialItem;
            setRoom((prev) => ({
              ...prev,
              materials: prev.materials.map((m) =>
                m.id === material.id ? material : m
              ),
            }));
            break;
          }
          case 'material:deleted': {
            const materialId = String(msg.materialId || '');
            setRoom((prev) => ({
              ...prev,
              materials: prev.materials.filter((m) => m.id !== materialId),
            }));
            break;
          }
          case 'submission:created': {
            const submission = msg.submission as SubmissionItem;
            setRoom((prev) =>
              prev.submissions.some((s) => s.id === submission.id)
                ? prev
                : { ...prev, submissions: [submission, ...prev.submissions] }
            );
            break;
          }
          case 'submission:updated': {
            const submission = msg.submission as SubmissionItem;
            setRoom((prev) => ({
              ...prev,
              submissions: prev.submissions.map((s) =>
                s.id === submission.id ? submission : s
              ),
            }));
            break;
          }
          case 'submission:deleted': {
            const submissionId = String(msg.submissionId || '');
            setRoom((prev) => ({
              ...prev,
              submissions: prev.submissions.filter((s) => s.id !== submissionId),
            }));
            break;
          }
          case 'chat:message': {
            const chatMsg = msg.message as ChatMessage;
            setRoom((prev) =>
              prev.messages.some((m) => m.id === chatMsg.id)
                ? prev
                : { ...prev, messages: [...prev.messages, chatMsg] }
            );
            if (mobileTabRef.current !== 'chat') {
              setUnreadChat((c) => c + 1);
            }
            break;
          }
          case 'chat:updated': {
            const chatMsg = msg.message as ChatMessage;
            setRoom((prev) => ({
              ...prev,
              messages: prev.messages.map((m) =>
                m.id === chatMsg.id ? chatMsg : m
              ),
            }));
            break;
          }
          case 'chat:deleted': {
            const messageId = String(msg.messageId || '');
            setRoom((prev) => ({
              ...prev,
              messages: prev.messages.filter((m) => m.id !== messageId),
            }));
            break;
          }
          case 'error': {
            if (typeof msg.message === 'string') {
              onLeave(msg.message);
            }
            break;
          }
        }
      };

      socket.onclose = () => {
        setConnected(false);
        if (!disposed) {
          reconnectTimer = setTimeout(() => {
            delay = Math.min(delay * 1.6, 8000);
            connect();
          }, delay);
        }
      };

      socket.onerror = () => {
        socket.close();
      };
    };

    connect();

    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      wsRef.current?.close();
    };
  }, [initialRoom.code, clientId, userName, role, hostToken, isInstructor, onLeave]);

  const sendMessage = useCallback((text: string, isQuestion: boolean) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'chat:send', text, isQuestion }));
    }
  }, []);

  const deleteMessage = useCallback((messageId: string) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'chat:delete', messageId }));
    }
  }, []);

  const togglePinMessage = useCallback((messageId: string) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'chat:pin', messageId }));
    }
  }, []);

  const handleCopyPin = () => {
    navigator.clipboard?.writeText(room.code).then(() => {
      setCopiedPin(true);
      setTimeout(() => setCopiedPin(false), 1800);
    });
  };

  const handleCopyInviteLink = async () => {
    const inviteUrl = `${window.location.origin}/?pin=${room.code}`;
    if (navigator.share && window.innerWidth < 768) {
      try {
        await navigator.share({
          title: `StudyRoom — ${room.title}`,
          text: `강의실 번호 ${room.code}로 입장하세요.`,
          url: inviteUrl,
        });
        return;
      } catch {
        // fallback to clipboard copy
      }
    }
    navigator.clipboard?.writeText(inviteUrl).then(() => {
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 1800);
    });
  };

  const handleSaveSettings = async (
    nextTitle: string,
    nextNotice: string,
    nextSubmissionsOpen: boolean
  ) => {
    if (!isInstructor || !hostToken) return;
    await fetch(resolveApiUrl(`/api/rooms/${room.code}/settings`), {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'x-host-token': hostToken,
      },
      body: JSON.stringify({
        title: nextTitle,
        notice: nextNotice,
        submissionsOpen: nextSubmissionsOpen,
      }),
    });
  };

  const handleChangePassword = async (
    currentPassword: string,
    newPassword: string,
    revokeOtherSessions: boolean
  ): Promise<{ ok: boolean; message: string }> => {
    if (!isInstructor || !hostToken) {
      return { ok: false, message: '강사 권한이 필요합니다.' };
    }
    const res = await apiRequest<{ hostToken?: string }>(
      `/api/rooms/${room.code}/password`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-host-token': hostToken,
        },
        body: JSON.stringify({
          currentPassword,
          newPassword,
          revokeOtherSessions,
        }),
      }
    );
    if (!res.ok) {
      return { ok: false, message: res.error || '비밀번호 변경에 실패했습니다.' };
    }
    if (res.data.hostToken) {
      saveHostRoom({
        code: room.code,
        title: room.title,
        instructorName: room.instructorName,
        hostToken: res.data.hostToken,
        createdAt: room.createdAt,
      });
      onHostTokenUpdated(res.data.hostToken);
    }
    return {
      ok: true,
      message: revokeOtherSessions
        ? '관리 비밀번호가 변경되었고 다른 기기 권한이 초기화되었습니다.'
        : '관리 비밀번호가 안전하게 변경되었습니다.',
    };
  };

  const handleCloseRoom = async () => {
    if (!isInstructor || !hostToken) return;
    await fetch(resolveApiUrl(`/api/rooms/${room.code}`), {
      method: 'DELETE',
      headers: { 'x-host-token': hostToken },
    });
    removeSavedHostRoom(room.code);
    onLeave('강의실이 정상적으로 종료되었습니다.');
  };

  const selectMobileTab = (tab: 'materials' | 'submissions' | 'chat') => {
    setMobileTab(tab);
    if (tab === 'chat') {
      setUnreadChat(0);
    }
    if (tab === 'materials' || tab === 'submissions') {
      setDesktopTab(tab);
    }
  };

  return (
    <div className="flex h-dvh flex-col bg-slate-50 text-slate-900 overflow-hidden">
      {/* Compact Sticky Top Bar (48px on mobile, 56px on desktop) */}
      <header className="relative z-30 flex h-12 sm:h-14 items-center justify-between gap-2 sm:gap-4 border-b border-slate-200 bg-white px-3 sm:px-6 shrink-0">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <button
            type="button"
            onClick={() => onLeave()}
            className="text-sm sm:text-base font-bold tracking-tight text-slate-900 hover:text-blue-600 transition-colors whitespace-nowrap shrink-0"
          >
            StudyRoom
          </button>
          <span aria-hidden="true" className="text-slate-300 hidden sm:inline">
            /
          </span>
          <h1 className="truncate text-xs sm:text-sm font-semibold text-slate-800 max-w-[110px] sm:max-w-xs md:max-w-md">
            {room.title}
          </h1>

          {/* 4-digit PIN Copy Button */}
          <button
            type="button"
            onClick={handleCopyPin}
            title="4자리 강의 번호 복사"
            className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2 sm:px-2.5 font-mono text-xs font-bold text-blue-700 tabular-nums hover:bg-slate-100 whitespace-nowrap shrink-0"
          >
            <span>{room.code}</span>
            {copiedPin ? (
              <Check className="h-3 w-3 text-emerald-600" />
            ) : (
              <Copy className="h-3 w-3 text-slate-400" />
            )}
          </button>

          {/* Invite Share / Copy */}
          <button
            type="button"
            onClick={handleCopyInviteLink}
            aria-label="초대 링크 공유 또는 복사"
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 sm:px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
          >
            {copiedLink ? (
              <>
                <Check className="h-3.5 w-3.5 text-emerald-600" />
                <span className="hidden md:inline text-emerald-700">링크 복사됨</span>
              </>
            ) : (
              <>
                <Share2 className="h-3.5 w-3.5 text-slate-500" />
                <span className="hidden md:inline">초대 링크 복사</span>
              </>
            )}
          </button>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {/* Live connection state with explicit icon + text */}
          <span
            className={`hidden sm:inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap ${
              connected ? 'text-emerald-700' : 'text-amber-700'
            }`}
          >
            {connected ? (
              <Wifi className="h-3.5 w-3.5" />
            ) : (
              <WifiOff className="h-3.5 w-3.5" />
            )}
            <span>{connected ? '실시간 연결됨' : '재연결 중'}</span>
          </span>

          {/* Participants */}
          <button
            type="button"
            onClick={() => setParticipantsOpen(true)}
            aria-label="참여자 목록 보기"
            className="inline-flex h-8 sm:h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 sm:px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 tabular-nums whitespace-nowrap"
          >
            <Users className="h-3.5 w-3.5 text-slate-500" />
            <span>{room.participants.length}</span>
          </button>

          {/* Instructor Settings */}
          {isInstructor && (
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              aria-label="강의실 설정"
              className="inline-flex h-8 sm:h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 sm:px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap"
            >
              <Settings className="h-3.5 w-3.5 text-slate-500" />
              <span className="hidden sm:inline">설정</span>
            </button>
          )}

          {/* Leave Room */}
          <button
            type="button"
            onClick={() => onLeave()}
            aria-label="강의실 나가기"
            className="inline-flex h-8 sm:h-9 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 sm:px-3 text-xs font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900 whitespace-nowrap"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">나가기</span>
          </button>
        </div>
      </header>

      {/* Main Split Workspace */}
      <div className="flex flex-1 min-h-0 flex-col lg:flex-row">
        {/* Left Main Content (Hidden on mobile when Chat tab is active) */}
        <main
          className={`flex-1 min-w-0 overflow-y-auto ${
            mobileTab === 'chat' ? 'hidden lg:block' : 'block'
          }`}
        >
          <div className="mx-auto max-w-4xl px-3.5 py-4 sm:px-6 sm:py-6 space-y-4 sm:space-y-5">
            {/* Room Notice Banner */}
            {room.notice && (
              <div className="flex items-start gap-2.5 rounded-xl border border-blue-200 bg-blue-50/70 px-4 py-3 text-xs sm:text-sm text-slate-800">
                <Megaphone className="h-4 w-4 text-blue-600 shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1">
                  <span className="font-semibold text-blue-800 mr-1.5">공지</span>
                  <span className="whitespace-pre-wrap break-words">{room.notice}</span>
                </div>
              </div>
            )}

            {/* Desktop Workspace Tabs (hidden on mobile because mobile uses bottom nav) */}
            <div className="hidden lg:flex items-center justify-between gap-4">
              <div className="inline-flex items-center gap-1 rounded-xl bg-slate-200/70 p-1">
                <button
                  type="button"
                  onClick={() => setDesktopTab('materials')}
                  className={`inline-flex min-h-[38px] items-center gap-2 rounded-lg px-4 text-sm font-semibold transition-colors whitespace-nowrap tabular-nums ${
                    desktopTab === 'materials'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <BookOpen className="h-4 w-4" />
                  <span>교안·자료 ({room.materials.length})</span>
                </button>
                <button
                  type="button"
                  onClick={() => setDesktopTab('submissions')}
                  className={`inline-flex min-h-[38px] items-center gap-2 rounded-lg px-4 text-sm font-semibold transition-colors whitespace-nowrap tabular-nums ${
                    desktopTab === 'submissions'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <FolderUp className="h-4 w-4" />
                  <span>과제·제출물 ({room.submissions.length})</span>
                </button>
              </div>

              <p className="text-xs text-slate-500">
                {isInstructor ? `${userName} (강사)` : `${userName} (수강생)`}
              </p>
            </div>

            {/* Active Panel Content */}
            <div className="lg:hidden">
              {mobileTab === 'materials' && (
                <MaterialsPanel
                  roomCode={room.code}
                  role={role}
                  hostToken={hostToken}
                  materials={room.materials}
                  onPreviewFile={setPreviewFile}
                />
              )}
              {mobileTab === 'submissions' && (
                <SubmissionsPanel
                  roomCode={room.code}
                  role={role}
                  clientId={clientId}
                  userName={userName}
                  hostToken={hostToken}
                  submissionsOpen={room.submissionsOpen}
                  submissions={room.submissions}
                  onPreviewFile={setPreviewFile}
                />
              )}
            </div>

            <div className="hidden lg:block">
              {desktopTab === 'materials' ? (
                <MaterialsPanel
                  roomCode={room.code}
                  role={role}
                  hostToken={hostToken}
                  materials={room.materials}
                  onPreviewFile={setPreviewFile}
                />
              ) : (
                <SubmissionsPanel
                  roomCode={room.code}
                  role={role}
                  clientId={clientId}
                  userName={userName}
                  hostToken={hostToken}
                  submissionsOpen={room.submissionsOpen}
                  submissions={room.submissions}
                  onPreviewFile={setPreviewFile}
                />
              )}
            </div>
          </div>
        </main>

        {/* Chat Sidebar (Always visible on lg+, full tab viewport on mobile when chat active) */}
        <aside
          className={`${
            mobileTab === 'chat' ? 'flex flex-1 min-h-0' : 'hidden'
          } lg:flex lg:w-[360px] xl:w-[400px] lg:border-l lg:border-slate-200 lg:shrink-0 flex-col min-h-0`}
        >
          <ChatPanel
            role={role}
            clientId={clientId}
            messages={room.messages}
            connected={connected}
            onSendMessage={sendMessage}
            onDeleteMessage={deleteMessage}
            onTogglePinMessage={togglePinMessage}
          />
        </aside>
      </div>

      {/* Mobile Bottom Thumb-Zone Navigation (56px height, <15% total sticky cap) */}
      <nav
        aria-label="모바일 강의실 메뉴"
        className="lg:hidden border-t border-slate-200 bg-white/95 backdrop-blur-md pb-safe shrink-0 z-30"
      >
        <div className="grid grid-cols-3 h-14">
          <button
            type="button"
            onClick={() => selectMobileTab('materials')}
            className={`flex flex-col items-center justify-center gap-0.5 text-[11px] font-semibold transition-colors ${
              mobileTab === 'materials'
                ? 'text-blue-600'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <BookOpen className="h-5 w-5" />
            <span className="tabular-nums">교안·자료 ({room.materials.length})</span>
          </button>

          <button
            type="button"
            onClick={() => selectMobileTab('submissions')}
            className={`flex flex-col items-center justify-center gap-0.5 text-[11px] font-semibold transition-colors ${
              mobileTab === 'submissions'
                ? 'text-blue-600'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <FolderUp className="h-5 w-5" />
            <span className="tabular-nums">과제·제출 ({room.submissions.length})</span>
          </button>

          <button
            type="button"
            onClick={() => selectMobileTab('chat')}
            className={`relative flex flex-col items-center justify-center gap-0.5 text-[11px] font-semibold transition-colors ${
              mobileTab === 'chat'
                ? 'text-blue-600'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <MessageSquare className="h-5 w-5" />
            <span className="tabular-nums">
              실시간 채팅{unreadChat > 0 ? ` (${unreadChat})` : ''}
            </span>
          </button>
        </div>
      </nav>

      {/* Modals & Preview */}
      <ParticipantsModal
        open={participantsOpen}
        onClose={() => setParticipantsOpen(false)}
        participants={room.participants}
        currentClientId={clientId}
      />

      {isInstructor && (
        <RoomSettingsModal
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          title={room.title}
          notice={room.notice}
          submissionsOpen={room.submissionsOpen}
          onSaveSettings={handleSaveSettings}
          onChangePassword={handleChangePassword}
          onCloseRoom={handleCloseRoom}
        />
      )}

      <FilePreviewModal
        file={previewFile}
        onClose={() => setPreviewFile(null)}
      />
    </div>
  );
};
