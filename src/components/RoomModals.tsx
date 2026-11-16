import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Shield,
  Users,
  X,
} from 'lucide-react';
import type { Participant } from '../types';

interface ParticipantsModalProps {
  open: boolean;
  onClose: () => void;
  participants: Participant[];
  currentClientId: string;
}

export const ParticipantsModal: React.FC<ParticipantsModalProps> = ({
  open,
  onClose,
  participants,
  currentClientId,
}) => {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const instructors = participants.filter((p) => p.role === 'instructor');
  const students = participants.filter((p) => p.role === 'student');

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/50 p-0 sm:p-4 backdrop-blur-[2px]"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="참여자 목록"
    >
      <div
        className="flex max-h-[80dvh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl sm:rounded-2xl border border-slate-200 bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-slate-600" />
            <h3 className="text-sm font-bold text-slate-900 tabular-nums">
              현재 접속자 ({participants.length}명)
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="inline-flex min-h-[38px] min-w-[38px] items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-slate-100 px-5 py-2 pb-safe">
          {participants.length === 0 ? (
            <p className="py-8 text-center text-xs text-slate-500">
              접속자 정보를 불러오는 중입니다.
            </p>
          ) : (
            <>
              {instructors.map((p) => (
                <div
                  key={`${p.clientId}-${p.role}`}
                  className="flex items-center justify-between py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-blue-700">
                      {p.name}
                      {p.clientId === currentClientId ? ' (나)' : ''}
                    </p>
                  </div>
                  <span className="text-xs font-semibold text-blue-600 shrink-0">
                    강사
                  </span>
                </div>
              ))}
              {students.map((p) => (
                <div
                  key={`${p.clientId}-${p.role}`}
                  className="flex items-center justify-between py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900">
                      {p.name}
                      {p.clientId === currentClientId ? ' (나)' : ''}
                    </p>
                  </div>
                  <span className="text-xs text-slate-500 shrink-0">수강생</span>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

interface RoomSettingsModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  notice: string;
  submissionsOpen: boolean;
  onSaveSettings: (title: string, notice: string, submissionsOpen: boolean) => Promise<void>;
  onChangePassword: (
    currentPassword: string,
    newPassword: string,
    revokeOtherSessions: boolean
  ) => Promise<{ ok: boolean; message: string }>;
  onCloseRoom: () => Promise<void>;
}

export const RoomSettingsModal: React.FC<RoomSettingsModalProps> = ({
  open,
  onClose,
  title: initialTitle,
  notice: initialNotice,
  submissionsOpen: initialSubmissionsOpen,
  onSaveSettings,
  onChangePassword,
  onCloseRoom,
}) => {
  const [title, setTitle] = useState(initialTitle);
  const [notice, setNotice] = useState(initialNotice);
  const [submissionsOpen, setSubmissionsOpen] = useState(initialSubmissionsOpen);
  const [saving, setSaving] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [revokeOtherSessions, setRevokeOtherSessions] = useState(true);
  const [changingPw, setChangingPw] = useState(false);
  const [pwFeedback, setPwFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(
    null
  );

  const [confirmClose, setConfirmClose] = useState(false);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle(initialTitle);
    setNotice(initialNotice);
    setSubmissionsOpen(initialSubmissionsOpen);
    setConfirmClose(false);
    setPwFeedback(null);
  }, [open, initialTitle, initialNotice, initialSubmissionsOpen]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const handleSaveGeneral = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    try {
      await onSaveSettings(title.trim(), notice.trim(), submissionsOpen);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwFeedback(null);
    if (newPassword.trim().length < 4) {
      setPwFeedback({ type: 'err', text: '새 비밀번호는 최소 4자 이상 입력해 주세요.' });
      return;
    }
    setChangingPw(true);
    try {
      const result = await onChangePassword(
        currentPassword,
        newPassword,
        revokeOtherSessions
      );
      setPwFeedback({
        type: result.ok ? 'ok' : 'err',
        text: result.message,
      });
      if (result.ok) {
        setCurrentPassword('');
        setNewPassword('');
      }
    } finally {
      setChangingPw(false);
    }
  };

  const handleConfirmCloseRoom = async () => {
    setClosing(true);
    try {
      await onCloseRoom();
    } finally {
      setClosing(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/50 p-0 sm:p-4 backdrop-blur-[2px]"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="강의실 설정"
    >
      <div
        className="flex max-h-[90dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl sm:rounded-2xl border border-slate-200 bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5 shrink-0">
          <h3 className="text-sm font-bold text-slate-900">강의실 관리 설정</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="설정 닫기"
            className="inline-flex min-h-[38px] min-w-[38px] items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-6 pb-safe">
          {/* General Settings */}
          <form onSubmit={handleSaveGeneral} className="space-y-4">
            <div>
              <label
                htmlFor="settings-title"
                className="block text-xs font-semibold text-slate-700 mb-1.5"
              >
                강의 제목
              </label>
              <input
                id="settings-title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={100}
                className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
              />
            </div>

            <div>
              <label
                htmlFor="settings-notice"
                className="block text-xs font-semibold text-slate-700 mb-1.5"
              >
                강의실 상단 공지사항 (실시간 표시)
              </label>
              <textarea
                id="settings-notice"
                value={notice}
                onChange={(e) => setNotice(e.target.value)}
                rows={2}
                maxLength={500}
                placeholder="수강생 상단에 띄울 안내사항을 입력하세요 (비워두면 숨김)"
                className="w-full rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none"
              />
            </div>

            <label className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50/70 px-3.5 py-3 cursor-pointer">
              <div>
                <p className="text-xs font-semibold text-slate-900">과제 제출물 접수 허용</p>
                <p className="text-[11px] text-slate-500">
                  끄면 수강생의 새 제출물 업로드가 중단됩니다.
                </p>
              </div>
              <input
                type="checkbox"
                checked={submissionsOpen}
                onChange={(e) => setSubmissionsOpen(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600"
              />
            </label>

            <button
              type="submit"
              disabled={saving}
              className="inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-4 text-xs sm:text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
            >
              <Check className="h-4 w-4" />
              <span>{saving ? '저장 중...' : '강의실 정보 저장'}</span>
            </button>
          </form>

          {/* Security: Password Change */}
          <div className="border-t border-slate-200 pt-5">
            <div className="flex items-center gap-1.5 mb-3">
              <Shield className="h-4 w-4 text-slate-600" />
              <h4 className="text-xs font-bold text-slate-900">
                강사 관리 비밀번호 변경
              </h4>
            </div>
            <form onSubmit={handlePasswordSubmit} className="space-y-3">
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="현재 관리 비밀번호"
                autoComplete="current-password"
                className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs sm:text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
              />
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="새 관리 비밀번호 (최소 4자)"
                autoComplete="new-password"
                className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs sm:text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
              />
              <label className="inline-flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={revokeOtherSessions}
                  onChange={(e) => setRevokeOtherSessions(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600"
                />
                <span>변경 시 다른 기기의 강사 로그인 권한 초기화</span>
              </label>

              {pwFeedback && (
                <p
                  className={`text-xs font-medium ${
                    pwFeedback.type === 'ok' ? 'text-emerald-700' : 'text-red-600'
                  }`}
                >
                  {pwFeedback.text}
                </p>
              )}

              <button
                type="submit"
                disabled={changingPw}
                className="inline-flex h-10 w-full items-center justify-center rounded-lg border border-slate-200 bg-slate-900 px-4 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
              >
                {changingPw ? '변경 중...' : '비밀번호 변경하기'}
              </button>
            </form>
          </div>

          {/* Close Room (Inline 2-step confirmation, no window.confirm) */}
          <div className="border-t border-slate-200 pt-5">
            {!confirmClose ? (
              <button
                type="button"
                onClick={() => setConfirmClose(true)}
                className="inline-flex h-10 w-full items-center justify-center rounded-lg border border-red-200 bg-red-50/70 px-4 text-xs font-semibold text-red-700 hover:bg-red-100"
              >
                강의실 완전히 종료하기
              </button>
            ) : (
              <div className="rounded-xl border border-red-200 bg-red-50 p-4 space-y-3">
                <div className="flex items-start gap-2 text-xs text-red-800">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  <p className="leading-relaxed">
                    강의실을 종료하면 모든 교안, 제출 파일, 채팅 내역이 삭제되며 접속 중인 수강생 연결도 즉시 종료됩니다.
                  </p>
                </div>
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirmClose(false)}
                    className="inline-flex min-h-[38px] items-center rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    취소
                  </button>
                  <button
                    type="button"
                    disabled={closing}
                    onClick={handleConfirmCloseRoom}
                    className="inline-flex min-h-[38px] items-center rounded-lg bg-red-600 px-3.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-60"
                  >
                    {closing ? '종료 중...' : '확인 후 강의실 종료'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
