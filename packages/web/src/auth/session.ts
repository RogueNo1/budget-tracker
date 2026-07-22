import { apiJson, setAccessToken, trySilentRefresh, getAccessToken } from '../api/client.js';

export interface SessionUser {
  id: string;
  email: string;
}

let currentUser: SessionUser | null = null;
const listeners = new Set<(user: SessionUser | null) => void>();

export function getCurrentUser(): SessionUser | null {
  return currentUser;
}

export function onSessionChange(fn: (user: SessionUser | null) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function setUser(user: SessionUser | null): void {
  currentUser = user;
  listeners.forEach((fn) => fn(user));
}

const API_BASE =
  (import.meta as unknown as { env?: { VITE_API_URL?: string } }).env?.VITE_API_URL ??
  'http://localhost:3001';

export async function register(email: string, password: string): Promise<SessionUser> {
  const body = await apiJson<{ user: SessionUser; accessToken: string }>('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  setAccessToken(body.accessToken);
  setUser(body.user);
  return body.user;
}

export async function login(email: string, password: string): Promise<SessionUser> {
  const body = await apiJson<{ user: SessionUser; accessToken: string }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  setAccessToken(body.accessToken);
  setUser(body.user);
  return body.user;
}

export async function logout(): Promise<void> {
  try {
    await fetch(`${API_BASE}/auth/logout`, { method: 'POST', credentials: 'include' });
  } finally {
    setAccessToken(null);
    setUser(null);
  }
}

/**
 * On app load: try to restore a session from the refresh cookie alone (the
 * access token only lives in memory, so a page reload always starts with
 * none). If it succeeds, fetch /me to get the user's profile.
 */
export async function restoreSession(): Promise<SessionUser | null> {
  const ok = await trySilentRefresh();
  if (!ok) return null;
  try {
    const me = await apiJson<{ id: string; email: string }>('/me');
    setUser({ id: me.id, email: me.email });
    return currentUser;
  } catch {
    setAccessToken(null);
    return null;
  }
}

export function isAuthenticated(): boolean {
  return getAccessToken() !== null && currentUser !== null;
}
