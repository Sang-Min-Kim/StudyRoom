export interface ApiResponse<T = Record<string, unknown>> {
  ok: boolean;
  status: number;
  data: T;
  error?: string;
}

const TRANSIENT_STATUSES = new Set([502, 503, 504]);

const RAW_API_BASE = (import.meta.env.VITE_API_BASE || '').trim().replace(/\/+$/, '');

export function resolveApiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  if (!RAW_API_BASE) return path;
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${RAW_API_BASE}${normalizedPath}`;
}

export function resolveWsUrl(): string {
  if (RAW_API_BASE) {
    const wsBase = RAW_API_BASE.replace(/^http/i, 'ws');
    return `${wsBase}/ws`;
  }
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws`;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function apiRequest<T = Record<string, unknown>>(
  url: string,
  options: RequestInit = {},
  retries = 1
): Promise<ApiResponse<T>> {
  let attempt = 0;
  const targetUrl = resolveApiUrl(url);

  while (true) {
    try {
      const res = await fetch(targetUrl, options);
      const contentType = res.headers.get('content-type') || '';

      if (TRANSIENT_STATUSES.has(res.status) && attempt < retries) {
        attempt += 1;
        await wait(1000);
        continue;
      }

      if (contentType.includes('application/json')) {
        const data = (await res.json()) as T & { error?: string };
        return {
          ok: res.ok,
          status: res.status,
          data,
          error: !res.ok
            ? data?.error || `요청 처리 중 오류가 발생했습니다. (HTTP ${res.status})`
            : undefined,
        };
      }

      const rawText = await res.text().catch(() => '');
      let fallbackMsg: string;
      if (TRANSIENT_STATUSES.has(res.status)) {
        fallbackMsg = `서버가 시작 중이거나 일시적으로 응답하지 않습니다. (HTTP ${res.status}) 잠시 후 다시 시도해 주세요.`;
      } else if (res.status === 405) {
        fallbackMsg =
          '백엔드 서버가 실행되지 않은 정적 배포 환경입니다. (HTTP 405) Cloud Run 등 Node.js 서버(npm start)가 함께 실행되는 환경으로 배포해 주세요.';
      } else {
        fallbackMsg = `서버 응답을 처리할 수 없습니다. (HTTP ${res.status})`;
      }

      return {
        ok: false,
        status: res.status,
        data: { rawText } as unknown as T,
        error: fallbackMsg,
      };
    } catch {
      if (attempt < retries) {
        attempt += 1;
        await wait(1000);
        continue;
      }
      return {
        ok: false,
        status: 0,
        data: {} as T,
        error: '네트워크 연결이 불안정하거나 서버가 응답하지 않습니다. 잠시 후 다시 시도해 주세요.',
      };
    }
  }
}

export async function checkBackendHealth(): Promise<'ok' | 'static' | 'unreachable'> {
  try {
    const res = await fetch(resolveApiUrl('/api/health'), { cache: 'no-store' });
    const contentType = res.headers.get('content-type') || '';
    if (res.ok && contentType.includes('application/json')) {
      const data = (await res.json()) as { ok?: boolean };
      if (data?.ok) return 'ok';
    }
    if (res.status === 404 || res.status === 405 || contentType.includes('text/html')) {
      return 'static';
    }
    return 'unreachable';
  } catch {
    return 'unreachable';
  }
}

