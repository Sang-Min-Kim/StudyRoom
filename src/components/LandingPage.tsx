import React, { useEffect, useState } from 'react';
import {
  ArrowRight,
  Eye,
  EyeOff,
  FolderUp,
  KeyRound,
  Lock,
  MessageSquare,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import type { ActiveSession, RoomCheckResult, SavedHostRoom } from '../types';
import { apiRequest, checkBackendHealth } from '../utils/api';
import {
  formatDateTime,
  getClientId,
  getSavedHostRooms,
  getSavedStudentName,
  removeSavedHostRoom,
  saveHostRoom,
  saveStudentName,
} from '../utils/format';
import { PinInput } from './PinInput';

interface LandingPageProps {
  initialPin: string;
  onEnterRoom: (session: ActiveSession) => void;
}

export const LandingPage: React.FC<LandingPageProps> = ({ initialPin, onEnterRoom }) => {
  // Student join state
  const [joinPin, setJoinPin] = useState(initialPin);
  const [studentName, setStudentName] = useState(() => getSavedStudentName());
  const [roomCheck, setRoomCheck] = useState<RoomCheckResult | null>(null);
  const [checkingRoom, setCheckingRoom] = useState(false);
  const [joinError, setJoinError] = useState('');
  const [joining, setJoining] = useState(false);

  // Instructor panel state
  const [hostTab, setHostTab] = useState<'create' | 'manage'>('create');
  const [createPin, setCreatePin] = useState('');
  const [roomTitle, setRoomTitle] = useState('');
  const [instructorName, setInstructorName] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [showCreatePw, setShowCreatePw] = useState(false);
  const [createError, setCreateError] = useState('');
  const [creating, setCreating] = useState(false);

  // Host login (existing room)
  const [loginPin, setLoginPin] = useState('');
  const [loginRoomCheck, setLoginRoomCheck] = useState<RoomCheckResult | null>(null);
  const [checkingLoginRoom, setCheckingLoginRoom] = useState(false);
  const [loginPassword, setLoginPassword] = useState('');
  const [showLoginPw, setShowLoginPw] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);

  // Saved host rooms
  const [savedHostRooms, setSavedHostRooms] = useState<SavedHostRoom[]>(() =>
    getSavedHostRooms()
  );
  const [activeHostMap, setActiveHostMap] = useState<Record<string, boolean>>({});
  const [isStaticDeploy, setIsStaticDeploy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    checkBackendHealth().then((status) => {
      if (!cancelled && status === 'static') {
        setIsStaticDeploy(true);
      }
    });

    const rooms = getSavedHostRooms();
    setSavedHostRooms(rooms);
    rooms.forEach((room) => {
      apiRequest<RoomCheckResult>(`/api/rooms/${room.code}/check`)
        .then((res) => {
          if (res.ok) {
            setActiveHostMap((prev) => ({
              ...prev,
              [room.code]: Boolean(res.data.exists),
            }));
          }
        })
        .catch(() => {});
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (joinPin.length !== 4) {
      setRoomCheck(null);
      setJoinError('');
      return;
    }
    let cancelled = false;
    setCheckingRoom(true);
    setJoinError('');
    apiRequest<RoomCheckResult>(`/api/rooms/${joinPin}/check`)
      .then((res) => {
        if (!cancelled) setRoomCheck(res.ok ? res.data : null);
      })
      .catch(() => {
        if (!cancelled) setRoomCheck(null);
      })
      .finally(() => {
        if (!cancelled) setCheckingRoom(false);
      });
    return () => {
      cancelled = true;
    };
  }, [joinPin]);

  useEffect(() => {
    if (loginPin.length !== 4) {
      setLoginRoomCheck(null);
      setLoginError('');
      return;
    }
    let cancelled = false;
    setCheckingLoginRoom(true);
    setLoginError('');
    apiRequest<RoomCheckResult>(`/api/rooms/${loginPin}/check`)
      .then((res) => {
        if (!cancelled) setLoginRoomCheck(res.ok ? res.data : null);
      })
      .catch(() => {
        if (!cancelled) setLoginRoomCheck(null);
      })
      .finally(() => {
        if (!cancelled) setCheckingLoginRoom(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loginPin]);

  const generateRandomPin = () => {
    const random = String(Math.floor(1000 + Math.random() * 9000));
    setCreatePin(random);
    setCreateError('');
  };

  const handleStudentJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    setJoinError('');
    if (joinPin.length !== 4) {
      setJoinError('4자리 강의 번호를 모두 입력해 주세요.');
      return;
    }
    const trimmedName = studentName.trim();
    if (!trimmedName) {
      setJoinError('수강생 이름 또는 닉네임을 입력해 주세요.');
      return;
    }

    setJoining(true);
    try {
      const clientId = getClientId();
      const res = await apiRequest<{
        room: ActiveSession['room'];
        role: ActiveSession['role'];
        clientId: string;
        name: string;
      }>('/api/rooms/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: joinPin, name: trimmedName, clientId }),
      });
      if (!res.ok) {
        setJoinError(res.error || '강의실 입장에 실패했습니다.');
        return;
      }
      saveStudentName(trimmedName);
      onEnterRoom({
        room: res.data.room,
        role: res.data.role,
        clientId: res.data.clientId,
        name: res.data.name,
      });
    } finally {
      setJoining(false);
    }
  };

  const handleCreateRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError('');
    if (!/^\d{4}$/.test(createPin)) {
      setCreateError('개설할 4자리 숫자 번호를 입력해 주세요.');
      return;
    }
    if (!roomTitle.trim()) {
      setCreateError('강의 제목을 입력해 주세요.');
      return;
    }
    if (adminPassword.trim().length < 4) {
      setCreateError('강사 관리 비밀번호는 최소 4자 이상 입력해 주세요.');
      return;
    }

    setCreating(true);
    try {
      const clientId = getClientId();
      const resolvedInstructor = instructorName.trim() || '강사';
      const res = await apiRequest<{
        room: ActiveSession['room'];
        hostToken: string;
      }>('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: createPin,
          title: roomTitle.trim(),
          instructorName: resolvedInstructor,
          adminPassword,
          clientId,
        }),
      });
      if (!res.ok) {
        setCreateError(res.error || '강의 방 개설에 실패했습니다.');
        return;
      }

      saveHostRoom({
        code: res.data.room.code,
        title: res.data.room.title,
        instructorName: res.data.room.instructorName,
        hostToken: res.data.hostToken,
        createdAt: res.data.room.createdAt,
      });
      onEnterRoom({
        room: res.data.room,
        role: 'instructor',
        clientId,
        name: res.data.room.instructorName,
        hostToken: res.data.hostToken,
      });
    } finally {
      setCreating(false);
    }
  };

  const handleHostLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    if (!/^\d{4}$/.test(loginPin)) {
      setLoginError('관리할 4자리 강의 번호를 입력해 주세요.');
      return;
    }
    if (!loginPassword) {
      setLoginError('강사 관리 비밀번호를 입력해 주세요.');
      return;
    }

    setLoggingIn(true);
    try {
      const clientId = getClientId();
      const res = await apiRequest<{
        room: ActiveSession['room'];
        name: string;
        hostToken: string;
      }>('/api/rooms/host-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: loginPin,
          adminPassword: loginPassword,
          clientId,
        }),
      });
      if (!res.ok) {
        setLoginError(res.error || '강사 인증에 실패했습니다.');
        return;
      }
      saveHostRoom({
        code: res.data.room.code,
        title: res.data.room.title,
        instructorName: res.data.room.instructorName,
        hostToken: res.data.hostToken,
        createdAt: res.data.room.createdAt,
      });
      onEnterRoom({
        room: res.data.room,
        role: 'instructor',
        clientId,
        name: res.data.name,
        hostToken: res.data.hostToken,
      });
    } finally {
      setLoggingIn(false);
    }
  };

  const handleQuickReenterHost = async (saved: SavedHostRoom) => {
    const clientId = getClientId();
    const res = await apiRequest<{
      room: ActiveSession['room'];
      name: string;
    }>('/api/rooms/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: saved.code,
        name: saved.instructorName,
        clientId,
        hostToken: saved.hostToken,
      }),
    });
    if (!res.ok) {
      if (res.status === 401 || res.status === 404) {
        removeSavedHostRoom(saved.code);
        setSavedHostRooms(getSavedHostRooms());
      }
      return;
    }
    onEnterRoom({
      room: res.data.room,
      role: 'instructor',
      clientId,
      name: res.data.name,
      hostToken: saved.hostToken,
    });
  };

  const handleRemoveSavedHost = (code: string) => {
    removeSavedHostRoom(code);
    setSavedHostRooms(getSavedHostRooms());
  };

  const activeSavedRooms = savedHostRooms.filter((r) => activeHostMap[r.code]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      {/* 3-Zone Top Bar Contract */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur-sm">
        <div className="mx-auto flex h-14 sm:h-16 max-w-6xl items-center justify-between gap-8 px-4 sm:px-6">
          <a
            href="/"
            className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
          >
            StudyRoom
          </a>

          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
            <a
              href="#join-section"
              className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
            >
              수강생 입장
            </a>
            <a
              href="#host-section"
              className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
            >
              강사 방 개설
            </a>
            <a
              href="#workflow-section"
              className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
            >
              이용 안내
            </a>
          </nav>

          <a
            href="#host-section"
            onClick={() => setHostTab('create')}
            className="inline-flex min-h-[40px] items-center justify-center rounded-lg bg-blue-600 px-4 text-xs sm:text-sm font-semibold text-white transition-colors hover:bg-blue-700 whitespace-nowrap shrink-0"
          >
            강의 방 개설
          </a>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-14">
        {/* Hero Copy */}
        <div className="max-w-2xl">
          <h1 className="text-2xl sm:text-4xl font-bold tracking-tight text-slate-900 leading-tight [text-wrap:balance]">
            설치 없이 4자리 번호로 바로 연결되는 실시간 강의실
          </h1>
          <p className="mt-3 text-sm sm:text-base text-slate-600 leading-relaxed">
            강사는 4자리 숫자로 방을 열어 교안과 파일을 수시로 배포하고, 수강생은 PC와 모바일 웹에서 번호만 입력해 자료 다운로드, 과제 제출, 실시간 채팅을 바로 이용합니다.
          </p>
        </div>

        {/* Static-only deployment warning */}
        {isStaticDeploy && (
          <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3.5 text-xs sm:text-sm text-amber-900">
            <p className="font-bold">정적 호스팅(프론트엔드 전용) 환경에서 실행 중입니다.</p>
            <p className="mt-1 leading-relaxed text-amber-800">
              StudyRoom은 실시간 강의실 개설·파일 공유·채팅을 위해 Node.js 백엔드 서버(<code className="font-mono">npm start</code>)가 함께 실행되어야 합니다. 정적 미리보기(Share)나 정적 CDN만 배포된 상태에서는 요청 시 HTTP 405 오류가 발생하므로, Cloud Run 등 풀스택 서버 환경으로 배포해 주세요.
            </p>
          </div>
        )}

        {/* Two-column Join / Host Split */}
        <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-12 lg:items-stretch">
          {/* Student Join Card */}
          <section
            id="join-section"
            className="lg:col-span-6 flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-5 sm:p-8"
          >
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg sm:text-xl font-bold text-slate-900">
                  수강생 강의실 입장
                </h2>
                <span className="text-xs font-medium text-slate-500">
                  별도 설치 · 로그인 불필요
                </span>
              </div>
              <p className="mt-1.5 text-sm text-slate-600">
                강사가 안내한 4자리 숫자 번호를 입력하면 강의실로 즉시 연결됩니다.
              </p>

              <form onSubmit={handleStudentJoin} className="mt-6 space-y-5">
                <div>
                  <label
                    htmlFor="join-pin-0"
                    className="block text-xs font-semibold text-slate-700 mb-2"
                  >
                    4자리 강의 번호
                  </label>
                  <PinInput
                    value={joinPin}
                    onChange={setJoinPin}
                    idPrefix="join-pin"
                  />
                </div>

                {/* Live Room Preview Status */}
                {joinPin.length === 4 && (
                  <div className="rounded-xl border border-slate-200 bg-slate-50/70 px-4 py-3">
                    {checkingRoom ? (
                      <p className="text-xs font-medium text-slate-500">
                        강의실 정보를 확인하고 있습니다...
                      </p>
                    ) : roomCheck?.exists ? (
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-bold text-slate-900">
                            {roomCheck.title}
                          </p>
                          <p className="mt-0.5 text-xs text-slate-600 tabular-nums">
                            {roomCheck.instructorName} 강사 · 현재 접속 {roomCheck.participantCount ?? 0}명
                          </p>
                        </div>
                        <span className="text-xs font-semibold text-emerald-700 whitespace-nowrap shrink-0">
                          입장 가능
                        </span>
                      </div>
                    ) : (
                      <p className="text-xs font-medium text-amber-700">
                        번호 {joinPin}으로 개설된 강의실이 없습니다. 번호를 다시 확인해 주세요.
                      </p>
                    )}
                  </div>
                )}

                <div>
                  <label
                    htmlFor="student-name"
                    className="block text-xs font-semibold text-slate-700 mb-1.5"
                  >
                    수강생 이름 또는 닉네임
                  </label>
                  <input
                    id="student-name"
                    type="text"
                    value={studentName}
                    onChange={(e) => setStudentName(e.target.value)}
                    placeholder="예: 김민수"
                    maxLength={40}
                    autoComplete="name"
                    className="h-12 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15"
                  />
                </div>

                {joinError && (
                  <p
                    className="rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-700"
                    role="alert"
                  >
                    {joinError}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={joining}
                  className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-60"
                >
                  <span>{joining ? '강의실 연결 중...' : '강의실 입장하기'}</span>
                  <ArrowRight className="h-4 w-4" />
                </button>
              </form>
            </div>

            <div className="mt-6 border-t border-slate-100 pt-4 text-xs text-slate-500">
              초대 링크(?pin=번호)로 접속하면 강의 번호가 자동으로 채워집니다.
            </div>
          </section>

          {/* Instructor Create / Manage Card */}
          <section
            id="host-section"
            className="lg:col-span-6 flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-5 sm:p-8"
          >
            <div>
              {/* Segmented Switch */}
              <div className="inline-flex w-full sm:w-auto items-center gap-1 rounded-xl bg-slate-100 p-1">
                <button
                  type="button"
                  onClick={() => {
                    setHostTab('create');
                    setLoginError('');
                  }}
                  className={`flex-1 sm:flex-none min-h-[40px] rounded-lg px-4 text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap ${
                    hostTab === 'create'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  새 강의실 개설
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setHostTab('manage');
                    setCreateError('');
                  }}
                  className={`flex-1 sm:flex-none min-h-[40px] rounded-lg px-4 text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap ${
                    hostTab === 'manage'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  기존 방 강사 입장
                </button>
              </div>

              {hostTab === 'create' ? (
                <>
                  <h2 className="mt-4 text-lg sm:text-xl font-bold text-slate-900">
                    강사 새 강의실 개설
                  </h2>
                  <p className="mt-1.5 text-sm text-slate-600">
                    수강생에게 공유할 4자리 번호와 강사용 관리 비밀번호를 설정해 주세요.
                  </p>

                  <form onSubmit={handleCreateRoom} className="mt-5 space-y-4">
                    <div>
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <label
                          htmlFor="create-pin-0"
                          className="text-xs font-semibold text-slate-700"
                        >
                          사용할 4자리 강의 번호
                        </label>
                        <button
                          type="button"
                          onClick={generateRandomPin}
                          className="inline-flex min-h-[32px] items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-700"
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                          <span>번호 랜덤 생성</span>
                        </button>
                      </div>
                      <PinInput
                        value={createPin}
                        onChange={setCreatePin}
                        idPrefix="create-pin"
                      />
                    </div>

                    <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                      <div>
                        <label
                          htmlFor="room-title"
                          className="block text-xs font-semibold text-slate-700 mb-1.5"
                        >
                          강의 제목
                        </label>
                        <input
                          id="room-title"
                          type="text"
                          value={roomTitle}
                          onChange={(e) => setRoomTitle(e.target.value)}
                          placeholder="예: 데이터 분석 실무 특강"
                          maxLength={100}
                          className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15"
                        />
                      </div>
                      <div>
                        <label
                          htmlFor="instructor-name"
                          className="block text-xs font-semibold text-slate-700 mb-1.5"
                        >
                          강사 이름 (선택)
                        </label>
                        <input
                          id="instructor-name"
                          type="text"
                          value={instructorName}
                          onChange={(e) => setInstructorName(e.target.value)}
                          placeholder="예: 홍길동"
                          maxLength={40}
                          className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15"
                        />
                      </div>
                    </div>

                    <div>
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <label
                          htmlFor="admin-password"
                          className="text-xs font-semibold text-slate-700"
                        >
                          강사 관리 비밀번호
                        </label>
                        <span className="inline-flex items-center gap-1 text-[11px] text-slate-500">
                          <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
                          <span>scrypt 암호화</span>
                        </span>
                      </div>
                      <div className="relative">
                        <input
                          id="admin-password"
                          type={showCreatePw ? 'text' : 'password'}
                          value={adminPassword}
                          onChange={(e) => setAdminPassword(e.target.value)}
                          placeholder="최소 4자 이상 (다른 기기에서 강사 복귀 시 필요)"
                          autoComplete="new-password"
                          className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-3.5 pr-11 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15"
                        />
                        <button
                          type="button"
                          onClick={() => setShowCreatePw((v) => !v)}
                          aria-label={showCreatePw ? '비밀번호 숨기기' : '비밀번호 보기'}
                          className="absolute right-1.5 top-1/2 -translate-y-1/2 inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:text-slate-700"
                        >
                          {showCreatePw ? (
                            <EyeOff className="h-4 w-4" />
                          ) : (
                            <Eye className="h-4 w-4" />
                          )}
                        </button>
                      </div>
                    </div>

                    {createError && (
                      <p
                        className="rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-700"
                        role="alert"
                      >
                        {createError}
                      </p>
                    )}

                    <button
                      type="submit"
                      disabled={creating}
                      className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-5 text-sm font-semibold text-white transition-colors hover:bg-slate-800 disabled:opacity-60"
                    >
                      <span>{creating ? '암호화 및 개설 중...' : '암호 설정 후 방 개설하기'}</span>
                      <Plus className="h-4 w-4" />
                    </button>
                  </form>
                </>
              ) : (
                <>
                  <h2 className="mt-4 text-lg sm:text-xl font-bold text-slate-900">
                    기존 방 강사 관리 입장
                  </h2>
                  <p className="mt-1.5 text-sm text-slate-600">
                    다른 PC·태블릿·모바일에서 개설한 강의실에 강사 관리 비밀번호로 인증해 입장합니다.
                  </p>

                  <form onSubmit={handleHostLogin} className="mt-5 space-y-4">
                    <div>
                      <label
                        htmlFor="host-login-pin-0"
                        className="block text-xs font-semibold text-slate-700 mb-2"
                      >
                        개설된 4자리 강의 번호
                      </label>
                      <PinInput
                        value={loginPin}
                        onChange={setLoginPin}
                        idPrefix="host-login-pin"
                      />
                    </div>

                    {loginPin.length === 4 && (
                      <div className="rounded-xl border border-slate-200 bg-slate-50/70 px-4 py-3">
                        {checkingLoginRoom ? (
                          <p className="text-xs font-medium text-slate-500">
                            강의실 존재 여부를 확인하고 있습니다...
                          </p>
                        ) : loginRoomCheck?.exists ? (
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-bold text-slate-900">
                                {loginRoomCheck.title}
                              </p>
                              <p className="mt-0.5 text-xs text-slate-600 tabular-nums">
                                {loginRoomCheck.instructorName} 강사 · 현재 접속 {loginRoomCheck.participantCount ?? 0}명
                              </p>
                            </div>
                            <span className="text-xs font-semibold text-emerald-700 whitespace-nowrap shrink-0">
                              방 확인됨
                            </span>
                          </div>
                        ) : (
                          <p className="text-xs font-medium text-amber-700">
                            번호 {loginPin}으로 개설된 강의실이 없습니다. 새 강의실 개설 탭에서 방을 먼저 만들어 주세요.
                          </p>
                        )}
                      </div>
                    )}

                    <div>
                      <label
                        htmlFor="host-login-password"
                        className="block text-xs font-semibold text-slate-700 mb-1.5"
                      >
                        강사 관리 비밀번호
                      </label>
                      <div className="relative">
                        <input
                          id="host-login-password"
                          type={showLoginPw ? 'text' : 'password'}
                          value={loginPassword}
                          onChange={(e) => setLoginPassword(e.target.value)}
                          placeholder="방 개설 시 설정한 관리 비밀번호 입력"
                          autoComplete="current-password"
                          className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-3.5 pr-11 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15"
                        />
                        <button
                          type="button"
                          onClick={() => setShowLoginPw((v) => !v)}
                          aria-label={showLoginPw ? '비밀번호 숨기기' : '비밀번호 보기'}
                          className="absolute right-1.5 top-1/2 -translate-y-1/2 inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:text-slate-700"
                        >
                          {showLoginPw ? (
                            <EyeOff className="h-4 w-4" />
                          ) : (
                            <Eye className="h-4 w-4" />
                          )}
                        </button>
                      </div>
                    </div>

                    {loginError && (
                      <p
                        className="rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-700"
                        role="alert"
                      >
                        {loginError}
                      </p>
                    )}

                    <button
                      type="submit"
                      disabled={loggingIn}
                      className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-5 text-sm font-semibold text-white transition-colors hover:bg-slate-800 disabled:opacity-60"
                    >
                      <span>{loggingIn ? '암호 검증 중...' : '암호 확인 후 강사로 입장하기'}</span>
                      <Lock className="h-4 w-4" />
                    </button>
                  </form>
                </>
              )}
            </div>

            {activeSavedRooms.length > 0 && (
              <div className="mt-6 border-t border-slate-200 pt-4">
                <p className="text-xs font-semibold text-slate-700 mb-2.5">
                  현재 이 브라우저에서 운영 중인 내 강의실
                </p>
                <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-slate-50/70">
                  {activeSavedRooms.slice(0, 3).map((saved) => (
                    <div
                      key={saved.code}
                      className="flex items-center justify-between gap-3 px-3.5 py-2.5"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm font-bold text-blue-700 tabular-nums">
                            {saved.code}
                          </span>
                          <span className="truncate text-xs font-semibold text-slate-900">
                            {saved.title}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500 tabular-nums mt-0.5">
                          {saved.instructorName} · {formatDateTime(saved.createdAt)} 개설
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleQuickReenterHost(saved)}
                          className="inline-flex min-h-[36px] items-center rounded-lg bg-white border border-slate-200 px-3 text-xs font-semibold text-slate-800 hover:bg-slate-100 whitespace-nowrap"
                        >
                          강사 재입장
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRemoveSavedHost(saved.code)}
                          aria-label="목록에서 제거"
                          className="inline-flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg text-slate-400 hover:bg-slate-200/70 hover:text-slate-700"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        </div>

        {/* Workflow Section */}
        <section
          id="workflow-section"
          className="mt-10 rounded-2xl border border-slate-200 bg-white"
        >
          <div className="grid grid-cols-1 divide-y divide-slate-200 md:grid-cols-3 md:divide-x md:divide-y-0">
            <div className="p-6">
              <div className="flex items-center gap-2 text-xs font-semibold text-blue-600">
                <KeyRound className="h-4 w-4" />
                <span>01. 4자리 번호 개설·입장</span>
              </div>
              <h3 className="mt-2.5 text-base font-bold text-slate-900">
                앱 설치 없는 즉시 입장
              </h3>
              <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">
                강사가 4자리 암호 숫자를 지정해 방을 개설하면, 수강생은 초대 링크나 4자리 번호만으로 PC·모바일 웹 브라우저에서 즉시 입장합니다.
              </p>
            </div>

            <div className="p-6">
              <div className="flex items-center gap-2 text-xs font-semibold text-blue-600">
                <FolderUp className="h-4 w-4" />
                <span>02. 수시 교안·자료·제출물</span>
              </div>
              <h3 className="mt-2.5 text-base font-bold text-slate-900">
                실시간 자료 배포 및 과제 수합
              </h3>
              <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">
                수업 중 강사가 올리는 교안·텍스트·첨부파일이 수강생 화면에 즉시 반영되며, 수강생은 실습 결과물을 바로 제출할 수 있습니다.
              </p>
            </div>

            <div className="p-6">
              <div className="flex items-center gap-2 text-xs font-semibold text-blue-600">
                <MessageSquare className="h-4 w-4" />
                <span>03. 질문 구분 실시간 채팅</span>
              </div>
              <h3 className="mt-2.5 text-base font-bold text-slate-900">
                놓치지 않는 강의 중 질의응답
              </h3>
              <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">
                질문 표시 기능으로 일반 대화와 질문을 구분해 모아볼 수 있으며, 강사는 중요 공지나 질문을 상단에 고정할 수 있습니다.
              </p>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-200 bg-white mt-10">
        <div className="mx-auto flex max-w-6xl flex-col sm:flex-row items-center justify-between gap-2 px-4 py-6 sm:px-6 text-xs text-slate-500">
          <span>StudyRoom · 실시간 4자리 번호 강의실</span>
          <span>PDF · 문서 · 이미지 · 코드 파일 최대 50MB 지원</span>
        </div>
      </footer>
    </div>
  );
};
