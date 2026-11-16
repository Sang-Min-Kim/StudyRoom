import React, { useEffect, useMemo, useRef, useState } from 'react';
import { HelpCircle, Pin, Send, Trash2, X } from 'lucide-react';
import type { ChatMessage, Role } from '../types';
import { formatTime } from '../utils/format';

interface ChatPanelProps {
  role: Role;
  clientId: string;
  messages: ChatMessage[];
  connected: boolean;
  onSendMessage: (text: string, isQuestion: boolean) => void;
  onDeleteMessage: (messageId: string) => void;
  onTogglePinMessage: (messageId: string) => void;
}

export const ChatPanel: React.FC<ChatPanelProps> = ({
  role,
  clientId,
  messages,
  connected,
  onSendMessage,
  onDeleteMessage,
  onTogglePinMessage,
}) => {
  const isInstructor = role === 'instructor';
  const [filter, setFilter] = useState<'all' | 'questions'>('all');
  const [draft, setDraft] = useState('');
  const [isQuestion, setIsQuestion] = useState(false);
  const [showJumpButton, setShowJumpButton] = useState(false);

  const listRef = useRef<HTMLDivElement | null>(null);
  const atBottomRef = useRef(true);

  const questionCount = useMemo(
    () => messages.filter((m) => m.isQuestion).length,
    [messages]
  );

  const pinnedMessages = useMemo(
    () => messages.filter((m) => m.isPinned),
    [messages]
  );

  const visibleMessages = useMemo(
    () => (filter === 'questions' ? messages.filter((m) => m.isQuestion) : messages),
    [messages, filter]
  );

  const scrollToBottom = (behavior: ScrollBehavior = 'smooth') => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
    setShowJumpButton(false);
  };

  useEffect(() => {
    if (atBottomRef.current) {
      scrollToBottom('auto');
    } else if (visibleMessages.length > 0) {
      setShowJumpButton(true);
    }
  }, [visibleMessages.length]);

  const handleScroll = () => {
    const el = listRef.current;
    if (!el) return;
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    atBottomRef.current = isNearBottom;
    if (isNearBottom) {
      setShowJumpButton(false);
    }
  };

  const handleSend = () => {
    const text = draft.trim();
    if (!text || !connected) return;
    onSendMessage(text, isQuestion);
    setDraft('');
    setIsQuestion(false);
    atBottomRef.current = true;
    requestAnimationFrame(() => scrollToBottom('smooth'));
  };

  return (
    <div className="flex h-full flex-col bg-white">
      {/* Chat Header */}
      <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-3 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <h2 className="text-sm font-bold text-slate-900 whitespace-nowrap">
            실시간 채팅
          </h2>
          <span className="text-xs text-slate-500 tabular-nums whitespace-nowrap">
            {messages.length}
          </span>
        </div>

        <div className="inline-flex items-center gap-1 rounded-lg bg-slate-100 p-0.5 shrink-0">
          <button
            type="button"
            onClick={() => setFilter('all')}
            className={`min-h-[32px] rounded-md px-2.5 text-xs font-medium transition-colors whitespace-nowrap ${
              filter === 'all'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            전체
          </button>
          <button
            type="button"
            onClick={() => setFilter('questions')}
            className={`min-h-[32px] rounded-md px-2.5 text-xs font-medium transition-colors whitespace-nowrap tabular-nums ${
              filter === 'questions'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            질문만 {questionCount > 0 ? `(${questionCount})` : ''}
          </button>
        </div>
      </div>

      {/* Pinned Messages Strip */}
      {pinnedMessages.length > 0 && (
        <div className="border-b border-blue-100 bg-blue-50/70 px-4 py-2.5 space-y-1.5 shrink-0">
          {pinnedMessages.slice(-2).map((msg) => (
            <div
              key={msg.id}
              className="flex items-start justify-between gap-2 text-xs"
            >
              <div className="min-w-0 flex-1">
                <span className="inline-flex items-center gap-1 font-semibold text-blue-700 mr-1.5">
                  <Pin className="h-3 w-3" />
                  <span>고정 · {msg.senderName}:</span>
                </span>
                <span className="text-slate-800 break-words">{msg.text}</span>
              </div>
              {isInstructor && (
                <button
                  type="button"
                  onClick={() => onTogglePinMessage(msg.id)}
                  aria-label="고정 해제"
                  className="inline-flex min-h-[28px] min-w-[28px] items-center justify-center rounded text-slate-400 hover:text-slate-700 shrink-0"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Message List */}
      <div className="relative flex-1 overflow-hidden">
        <div
          ref={listRef}
          onScroll={handleScroll}
          className="h-full overflow-y-auto px-3.5 sm:px-4 py-4 space-y-3"
        >
          {visibleMessages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-center px-4">
              <p className="text-sm font-semibold text-slate-800">
                {filter === 'questions'
                  ? '아직 등록된 질문이 없습니다.'
                  : '실시간 채팅이 열려 있습니다.'}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {filter === 'questions'
                  ? '질문으로 표시 버튼을 켜고 메시지를 보내면 이곳에 모아집니다.'
                  : '수업 중 궁금한 점이나 안내사항을 자유롭게 남겨 보세요.'}
              </p>
            </div>
          ) : (
            visibleMessages.map((msg) => {
              const isOwn = msg.senderId === clientId;
              const fromInstructor = msg.role === 'instructor';
              const canDelete = isInstructor || isOwn;

              return (
                <div
                  key={msg.id}
                  className={`group rounded-xl border px-3.5 py-2.5 transition-colors ${
                    msg.isQuestion
                      ? 'border-amber-200 bg-amber-50/40'
                      : fromInstructor
                      ? 'border-blue-200 bg-blue-50/30'
                      : isOwn
                      ? 'border-slate-200 bg-slate-50'
                      : 'border-slate-100 bg-white'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0 text-xs">
                      <span
                        className={`font-semibold truncate ${
                          fromInstructor ? 'text-blue-700' : 'text-slate-900'
                        }`}
                      >
                        {msg.senderName}
                      </span>
                      {fromInstructor && (
                        <>
                          <span aria-hidden="true" className="text-slate-300">
                            ·
                          </span>
                          <span className="font-semibold text-blue-600 shrink-0">
                            강사
                          </span>
                        </>
                      )}
                      {msg.isQuestion && (
                        <>
                          <span aria-hidden="true" className="text-slate-300">
                            ·
                          </span>
                          <span className="inline-flex items-center gap-0.5 font-semibold text-amber-700 shrink-0">
                            <HelpCircle className="h-3 w-3" />
                            <span>질문</span>
                          </span>
                        </>
                      )}
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <span className="text-[11px] text-slate-400 tabular-nums">
                        {formatTime(msg.createdAt)}
                      </span>
                      {(isInstructor || canDelete) && (
                        <div className="flex items-center gap-0.5 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity ml-1">
                          {isInstructor && (
                            <button
                              type="button"
                              onClick={() => onTogglePinMessage(msg.id)}
                              title={msg.isPinned ? '고정 해제' : '메시지 고정'}
                              aria-label={msg.isPinned ? '고정 해제' : '메시지 고정'}
                              className={`inline-flex h-7 w-7 items-center justify-center rounded text-slate-400 hover:bg-slate-100 ${
                                msg.isPinned ? 'text-blue-600' : 'hover:text-slate-700'
                              }`}
                            >
                              <Pin className="h-3 w-3" />
                            </button>
                          )}
                          {canDelete && (
                            <button
                              type="button"
                              onClick={() => onDeleteMessage(msg.id)}
                              title="메시지 삭제"
                              aria-label="메시지 삭제"
                              className="inline-flex h-7 w-7 items-center justify-center rounded text-slate-400 hover:bg-red-50 hover:text-red-600"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                  <p className="mt-1 text-sm leading-relaxed text-slate-800 whitespace-pre-wrap break-words">
                    {msg.text}
                  </p>
                </div>
              );
            })
          )}
        </div>

        {showJumpButton && (
          <button
            type="button"
            onClick={() => scrollToBottom('smooth')}
            className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 shadow-md hover:bg-slate-50"
          >
            새 메시지 보기
          </button>
        )}
      </div>

      {/* Composer */}
      <div className="border-t border-slate-200 bg-white p-3.5 shrink-0">
        <div className="mb-2 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setIsQuestion((v) => !v)}
            className={`inline-flex min-h-[34px] items-center gap-1.5 rounded-md border px-2.5 text-xs font-semibold transition-colors whitespace-nowrap ${
              isQuestion
                ? 'border-amber-300 bg-amber-50 text-amber-800'
                : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            <HelpCircle className="h-3.5 w-3.5" />
            <span>{isQuestion ? '질문으로 전송 중' : '질문으로 표시'}</span>
          </button>
          {!connected && (
            <span className="text-[11px] font-medium text-amber-700">
              실시간 연결 복구 중...
            </span>
          )}
        </div>

        <div className="flex items-end gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                handleSend();
              }
            }}
            rows={1}
            maxLength={1500}
            placeholder={
              isQuestion
                ? '강사에게 질문할 내용을 입력하세요...'
                : '메시지를 입력하세요 (Enter 전송)'
            }
            className="min-h-[44px] max-h-28 flex-1 resize-none rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:bg-white focus:outline-none"
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={!draft.trim() || !connected}
            aria-label="메시지 전송"
            className="inline-flex h-[44px] w-[44px] items-center justify-center rounded-xl bg-blue-600 text-white transition-colors hover:bg-blue-700 disabled:bg-slate-200 disabled:text-slate-400 shrink-0"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
