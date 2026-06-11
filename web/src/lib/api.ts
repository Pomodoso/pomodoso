import { ApiError } from '@pomodoso/api';

const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:8080';
const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? '';

function getToken(): string | null {
  if (!SUPABASE_URL) return null;
  try {
    const projectRef = new URL(SUPABASE_URL).hostname.split('.')[0];
    const raw = localStorage.getItem(`sb-${projectRef}-auth-token`);
    if (!raw) return null;
    return (JSON.parse(raw) as { access_token?: string }).access_token ?? null;
  } catch {
    return null;
  }
}

async function authedFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string>),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const resp = await fetch(`${API_URL}${path}`, { ...init, headers });
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({ error: resp.statusText }));
    throw new ApiError(resp.status, body.error ?? resp.statusText);
  }
  return resp.json() as Promise<T>;
}

// Kept for AuthContext compatibility — no-op since we read from localStorage directly.
export function setAuthToken(_token: string | null): void {}

export const api = {
  fetch: authedFetch,
  get: <T>(path: string) => authedFetch<T>(path, { method: 'GET' }),
  post: <T>(path: string, body: unknown) =>
    authedFetch<T>(path, { method: 'POST', body: JSON.stringify(body) }),
};
