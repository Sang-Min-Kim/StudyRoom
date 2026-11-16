import { useCallback, useEffect, useState } from 'react';
import { LandingPage } from './components/LandingPage';
import { RoomView } from './components/RoomView';
import type { ActiveSession } from './types';
import { resolveApiUrl } from './utils/api';
import { ACTIVE_SESSION_KEY } from './utils/format';

export default function App() {
  const [session, setSession] = useState<ActiveSession | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [initialPin, setInitialPin] = useState('');
  const [bannerMessage, setBannerMessage] = useState('');

  useEffect(() => {
    const urlPin = (new URLSearchParams(window.location.search).get('pin') || '')
      .replace(/\D/g, '')
      .slice(0, 4);
    if (urlPin) {
      setInitialPin(urlPin);
    }

    const raw = sessionStorage.getItem(ACTIVE_SESSION_KEY);
    if (!raw) {
      setRestoring(false);
      return;
    }

    let parsed: {
      code?: string;
      role?: string;
      clientId?: string;
      name?: string;
      hostToken?: string;
    } | null = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      sessionStorage.removeItem(ACTIVE_SESSION_KEY);
      setRestoring(false);
      return;
    }

    if (!parsed?.code || (urlPin && urlPin !== parsed.code)) {
      setRestoring(false);
      return;
    }

    fetch(resolveApiUrl('/api/rooms/join'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: parsed.code,
        name: parsed.name,
        clientId: parsed.clientId,
        hostToken: parsed.hostToken,
      }),
    })
      .then(async (res) => {
        if (!res.ok) {
          sessionStorage.removeItem(ACTIVE_SESSION_KEY);
          return;
        }
        const data = await res.json();
        setSession({
          room: data.room,
          role: data.role,
          clientId: data.clientId,
          name: data.name,
          hostToken: data.role === 'instructor' ? parsed?.hostToken : undefined,
        });
      })
      .catch(() => {})
      .finally(() => {
        setRestoring(false);
      });
  }, []);

  const handleEnterRoom = useCallback((next: ActiveSession) => {
    setBannerMessage('');
    setSession(next);
    try {
      sessionStorage.setItem(
        ACTIVE_SESSION_KEY,
        JSON.stringify({
          code: next.room.code,
          role: next.role,
          clientId: next.clientId,
          name: next.name,
          hostToken: next.hostToken,
        })
      );
    } catch {
      // ignore storage errors
    }
    const nextUrl = `${window.location.pathname}?pin=${next.room.code}`;
    window.history.replaceState(null, '', nextUrl);
  }, []);

  const handleLeave = useCallback((reason?: string) => {
    setSession(null);
    sessionStorage.removeItem(ACTIVE_SESSION_KEY);
    window.history.replaceState(null, '', window.location.pathname);
    if (reason) {
      setBannerMessage(reason);
    }
  }, []);

  const handleHostTokenUpdated = useCallback((newToken: string) => {
    setSession((prev) => {
      if (!prev) return prev;
      const updated: ActiveSession = { ...prev, hostToken: newToken };
      try {
        sessionStorage.setItem(
          ACTIVE_SESSION_KEY,
          JSON.stringify({
            code: updated.room.code,
            role: updated.role,
            clientId: updated.clientId,
            name: updated.name,
            hostToken: newToken,
          })
        );
      } catch {
        // ignore
      }
      return updated;
    });
  }, []);

  if (restoring) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-500">
        강의실 연결 상태를 확인하고 있습니다...
      </div>
    );
  }

  if (session) {
    return (
      <RoomView
        initialRoom={session.room}
        role={session.role}
        clientId={session.clientId}
        userName={session.name}
        hostToken={session.hostToken}
        onHostTokenUpdated={handleHostTokenUpdated}
        onLeave={handleLeave}
      />
    );
  }

  return (
    <>
      {bannerMessage && (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-center text-xs font-medium text-amber-800">
          <span>{bannerMessage}</span>
          <button
            type="button"
            onClick={() => setBannerMessage('')}
            className="ml-3 font-semibold underline"
          >
            닫기
          </button>
        </div>
      )}
      <LandingPage initialPin={initialPin} onEnterRoom={handleEnterRoom} />
    </>
  );
}
