export interface ApiResponse<T = Record<string, unknown>> {
  ok: boolean;
  status: number;
  data: T;
  error?: string;
}

const TRANSIENT_STATUSES = new Set([502, 503, 504]);

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function apiRequest<T = Record<string, unknown>>(
  url: string,
  options: RequestInit = {},
  retries = 1
): Promise<ApiResponse<T>> {
  let attempt = 0;

  while (true) {
    try {
      const res = await fetch(url, options);
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
      const fallbackMsg = TRANSIENT_STATUSES.has(res.status)
        ? `서버가 시작 중이거나 일시적으로 응답하지 않습니다. (HTTP ${res.status}) 잠시 후 다시 시도해 주세요.`
        : `서버 응답을 처리할 수 없습니다. (HTTP ${res.status})`;

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
