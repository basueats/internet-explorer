import type { EncryptedMessageEnvelope } from '../types';
import { joinSpaceViaRelay } from './relay';

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

export class BackendUnavailableError extends Error {
  status: number;
  constructor(status: number, message?: string) {
    super(message || `Backend API unavailable (HTTP ${status}).`);
    this.name = 'BackendUnavailableError';
    this.status = status;
  }
}

export async function safeFetchJson<T>(
  input: RequestInfo | URL,
  init: RequestInit = {},
  retries = 1
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
      const isExpressBackend = response.headers.get('x-ie-backend') === 'express';
      const rawText = await response.text();

      const looksLikeHtml =
        contentType.includes('text/html') ||
        rawText.trimStart().startsWith('<');

      if (looksLikeHtml) {
        if (response.status === 401 || response.status === 403) {
          throw new ProxyAuthError(response.status);
        }
        if (response.status === 404 || response.status >= 500) {
          throw new BackendUnavailableError(
            response.status,
            `Backend endpoint unavailable (HTTP ${response.status}).`
          );
        }
        if (attempt < retries) {
          await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
          continue;
        }
        throw new BackendUnavailableError(
          response.status,
          `Server returned an HTML page (HTTP ${response.status}) instead of API JSON.`
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
          if (response.status === 404 || response.status >= 500) {
            throw new BackendUnavailableError(response.status);
          }
          throw new Error(
            `Unexpected server response (HTTP ${response.status}). Please refresh and try again.`
          );
        }
      }

      const parsedRecord =
        parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
      const isAppAuthRejection =
        isExpressBackend ||
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

      const isAppNotFound =
        isExpressBackend ||
        parsedRecord?.code === 'ROOM_NOT_FOUND' ||
        parsedRecord?.error ===
          'No private space found with that unique name. Switch to Create Space to start it.' ||
        parsedRecord?.error === 'Private space not found.';

      if (response.status === 404 && !isAppNotFound) {
        throw new BackendUnavailableError(
          404,
          extractErrorMessage(parsed, 'Backend API not found on this host.')
        );
      }

      return {
        status: response.status,
        ok: response.ok,
        data: parsed as T,
      };
    } catch (err) {
      lastError =
        err instanceof Error
          ? err
          : new Error(extractErrorMessage(err, 'Network request failed.'));
      if (err instanceof ProxyAuthError || err instanceof BackendUnavailableError) {
        throw err;
      }
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
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

export interface JoinSpaceResponse {
  ok?: boolean;
  isNew?: boolean;
  code?: string;
  messages?: EncryptedMessageEnvelope[];
  error?: string;
}

export async function connectAndJoinSpace(payload: {
  roomId: string;
  gateHash: string;
  mode: 'create' | 'join' | 'auto';
}): Promise<{
  status: number;
  ok: boolean;
  data: JoinSpaceResponse;
  transport: 'server' | 'relay';
}> {
  try {
    const res = await safeFetchJson<JoinSpaceResponse>('/api/rooms/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return { ...res, transport: 'server' };
  } catch (err) {
    if (err instanceof BackendUnavailableError) {
      const relayRes = await joinSpaceViaRelay(payload);
      return { ...relayRes, transport: 'relay' };
    }

    if (
      err instanceof ProxyAuthError ||
      err instanceof TypeError ||
      (err instanceof Error && /Network request failed|Failed to fetch/i.test(err.message))
    ) {
      try {
        const wsRes = await joinRoomViaWebSocket<JoinSpaceResponse>(payload);
        return { ...wsRes, transport: 'server' };
      } catch {
        if (err instanceof ProxyAuthError) {
          throw err;
        }
        const relayRes = await joinSpaceViaRelay(payload);
        return { ...relayRes, transport: 'relay' };
      }
    }

    throw err;
  }
}

