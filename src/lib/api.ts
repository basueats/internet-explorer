export function extractErrorMessage(input: unknown, fallback: string): string {
  if (!input) return fallback;
  if (typeof input === 'string') {
    const trimmed = input.trim();
    return trimmed && trimmed !== '[object Object]' ? trimmed : fallback;
  }
  if (input instanceof Error) {
    const msg = input.message?.trim();
    if (msg && msg !== '[object Object]') return msg;
    return fallback;
  }
  if (typeof input === 'object') {
    const record = input as Record<string, unknown>;
    if (record.error !== undefined) {
      const nested = extractErrorMessage(record.error, '');
      if (nested) return nested;
    }
    if (typeof record.message === 'string' && record.message.trim()) {
      return record.message.trim();
    }
    if (typeof record.detail === 'string' && record.detail.trim()) {
      return record.detail.trim();
    }
    if (typeof record.statusText === 'string' && record.statusText.trim()) {
      return record.statusText.trim();
    }
  }
  return fallback;
}

export class ProxyAuthError extends Error {
  status: number;
  constructor(status: number, message?: string) {
    super(
      message ||
        `Preview session authorization expired or blocked (HTTP ${status}). Refresh the page or open in a new tab.`
    );
    this.name = 'ProxyAuthError';
    this.status = status;
  }
}

export async function safeFetchJson<T>(
  input: RequestInfo | URL,
  init: RequestInit = {},
  retries = 2
): Promise<{ status: number; ok: boolean; data: T }> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(input, {
        credentials: 'include',
        cache: 'no-store',
        ...init,
        headers: {
          Accept: 'application/json',
          ...(init.headers || {}),
        },
      });

      const contentType = response.headers.get('content-type') || '';
      const rawText = await response.text();

      const looksLikeHtml =
        contentType.includes('text/html') ||
        rawText.trimStart().startsWith('<');

      if (looksLikeHtml) {
        if (response.status === 401 || response.status === 403) {
          throw new ProxyAuthError(response.status);
        }
        if (attempt < retries) {
          await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
          continue;
        }
        throw new Error(
          `Server returned an HTML page (HTTP ${response.status}) instead of API JSON. Please refresh the page and try again.`
        );
      }

      let parsed: unknown = {};
      if (rawText) {
        try {
          parsed = JSON.parse(rawText);
        } catch {
          if (response.status === 401 || response.status === 403) {
            throw new ProxyAuthError(response.status);
          }
          throw new Error(
            `Unexpected server response (HTTP ${response.status}). Please refresh and try again.`
          );
        }
      }

      const parsedRecord =
        parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
      const isAppAuthRejection =
        parsedRecord?.code === 'INVALID_PASSPHRASE' ||
        parsedRecord?.error === 'Incorrect secret passphrase for this unique space name.' ||
        parsedRecord?.error === 'Unauthorized space access.';

      if ((response.status === 401 || response.status === 403) && !isAppAuthRejection) {
        throw new ProxyAuthError(
          response.status,
          extractErrorMessage(
            parsed,
            `Preview session authorization expired or blocked (HTTP ${response.status}).`
          )
        );
      }

      return {
        status: response.status,
        ok: response.ok,
        data: parsed as T,
      };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(extractErrorMessage(err, 'Network request failed.'));
      if (err instanceof ProxyAuthError) {
        throw err;
      }
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
        continue;
      }
    }
  }

  throw lastError || new Error('Unable to reach encrypted server.');
}

export function joinRoomViaWebSocket<T>(payload: {
  roomId: string;
  gateHash: string;
  mode: 'create' | 'join' | 'auto';
}): Promise<{ status: number; ok: boolean; data: T }> {
  return new Promise((resolve, reject) => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    const requestId = crypto.randomUUID();
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        ws.close();
        reject(new Error('Encrypted WebSocket connection timed out.'));
      }
    }, 6000);

    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          type: 'room:join',
          requestId,
          ...payload,
        })
      );
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(String(event.data)) as {
          type?: string;
          requestId?: string;
          ok?: boolean;
          status?: number;
        };
        if (msg.type === 'room:join:result' && msg.requestId === requestId && !settled) {
          settled = true;
          clearTimeout(timer);
          ws.close();
          resolve({
            status: msg.status || (msg.ok ? 200 : 400),
            ok: Boolean(msg.ok),
            data: msg as unknown as T,
          });
        }
      } catch {
        // Ignore malformed frame
      }
    };

    ws.onerror = () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(new Error('WebSocket fallback could not connect.'));
      }
    };

    ws.onclose = () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(new Error('WebSocket closed before room verification completed.'));
      }
    };
  });
}
