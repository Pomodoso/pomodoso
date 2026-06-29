import { createClient, SupabaseClient } from '@supabase/supabase-js';

let _client: SupabaseClient | null = null;

/** Minimal async storage contract Supabase accepts. The extension supplies a
 *  chrome.storage.local-backed adapter so the session survives MV3 service
 *  worker restarts (localStorage doesn't exist there); the web app omits it and
 *  Supabase falls back to localStorage. */
export interface SupabaseAuthStorage {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
  removeItem(key: string): void | Promise<void>;
}

export interface SupabaseClientOptions {
  storage?: SupabaseAuthStorage;
  storageKey?: string;
  /** Defaults to true. The extension disables it so a single context (the service
   *  worker) refreshes explicitly — two GoTrue clients auto-refreshing the same
   *  account rotate the refresh token against each other and trip Supabase's reuse
   *  detection, which signs the user out. */
  autoRefreshToken?: boolean;
}

export function getSupabaseClient(
  url: string,
  anonKey: string,
  opts: SupabaseClientOptions = {},
): SupabaseClient {
  if (!_client) {
    _client = createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: opts.autoRefreshToken ?? true,
        ...(opts.storage ? { storage: opts.storage } : {}),
        ...(opts.storageKey ? { storageKey: opts.storageKey } : {}),
      },
    });
  }
  return _client;
}

export type { SupabaseClient };
