import type { SupabaseClient } from '@supabase/supabase-js';

export interface IApiClient {
  fetch<T>(path: string, init?: RequestInit): Promise<T>;
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body: unknown): Promise<T>;
}

export class ApiClient implements IApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly supabase: SupabaseClient,
  ) {}

  async fetch<T>(path: string, init: RequestInit = {}): Promise<T> {
    const session = await this.supabase.auth.getSession();
    const token = session.data.session?.access_token;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(init.headers as Record<string, string>),
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const resp = await fetch(`${this.baseUrl}${path}`, { ...init, headers });

    if (!resp.ok) {
      const body = await resp.json().catch(() => ({ error: resp.statusText }));
      throw new ApiError(resp.status, body.error ?? resp.statusText);
    }

    return resp.json() as Promise<T>;
  }

  get<T>(path: string) {
    return this.fetch<T>(path, { method: 'GET' });
  }

  post<T>(path: string, body: unknown) {
    return this.fetch<T>(path, { method: 'POST', body: JSON.stringify(body) });
  }
}

export class TokenApiClient implements IApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly accessToken: string,
  ) {}

  async fetch<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.accessToken}`,
      ...(init.headers as Record<string, string>),
    };
    const resp = await fetch(`${this.baseUrl}${path}`, { ...init, headers });
    if (!resp.ok) {
      const body = await resp.json().catch(() => ({ error: resp.statusText }));
      throw new ApiError(resp.status, body.error ?? resp.statusText);
    }
    return resp.json() as Promise<T>;
  }

  get<T>(path: string) { return this.fetch<T>(path, { method: 'GET' }); }
  post<T>(path: string, body: unknown) {
    return this.fetch<T>(path, { method: 'POST', body: JSON.stringify(body) });
  }
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
