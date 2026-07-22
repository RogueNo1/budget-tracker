const API_BASE = (import.meta as unknown as { env?: { VITE_API_URL?: string } }).env?.VITE_API_URL ??
  'http://localhost:3001';

// Access token lives in memory only — never localStorage/sessionStorage —
// to limit the blast radius of an XSS bug. The refresh token is an
// HttpOnly cookie the browser sends automatically; JS never touches it.
let accessToken: string | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}
export function getAccessToken(): string | null {
  return accessToken;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'ApiError';
  }
}

async function rawFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  return fetch(`${API_BASE}${path}`, { ...init, headers, credentials: 'include' });
}

/** Attempts a silent refresh using the HttpOnly cookie. Returns true if it worked. */
export async function trySilentRefresh(): Promise<boolean> {
  const res = await fetch(`${API_BASE}/auth/refresh`, { method: 'POST', credentials: 'include' });
  if (!res.ok) return false;
  const body = await res.json();
  setAccessToken(body.accessToken);
  return true;
}

/**
 * Authenticated fetch: attaches the access token, and on a 401 (expired
 * access token — they only live ~15 min) tries exactly one silent refresh
 * + retry before giving up. Callers get either a real response or a thrown
 * ApiError; they never have to think about token expiry themselves.
 */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  let res = await rawFetch(path, init);
  if (res.status === 401 && accessToken !== null) {
    const refreshed = await trySilentRefresh();
    if (refreshed) res = await rawFetch(path, init);
  }
  if (!res.ok) {
    let message = `Request failed: ${res.status}`;
    try {
      const body = await res.json();
      // Fastify's default error shape is { statusCode, error: "Internal Server Error", message: "<actual reason>" }.
      // `error` is just the generic HTTP status text; `message` (or our own
      // routes' `{ error: "<specific reason>" }` shape) has the real reason.
      if (typeof body?.message === 'string' && body.message) message = body.message;
      else if (typeof body?.error === 'string' && body.error) message = body.error;
    } catch {
      /* non-JSON error body, keep default message */
    }
    throw new ApiError(res.status, message);
  }
  return res;
}

export async function apiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await apiFetch(path, init);
  return res.json() as Promise<T>;
}
