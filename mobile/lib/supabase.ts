import type { SupabaseAuthStorage, SupabaseClient } from '@pomodoso/api';
import { getSupabaseClient } from '@pomodoso/api';

import { getChunkedItem, removeChunkedItem, setChunkedItem } from '@/utils/secureStore';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

export function isAuthConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

// A Supabase session (access + refresh JWT, user metadata) routinely
// exceeds SecureStore's ~2048-byte per-item cap — chunking (utils/
// secureStore.ts) is the standard workaround (same constraint the
// extension doesn't have — chrome.storage.local has no such per-item cap).
const secureStoreAdapter: SupabaseAuthStorage = {
  getItem: getChunkedItem,
  setItem: setChunkedItem,
  removeItem: removeChunkedItem,
};

let _supabase: SupabaseClient | null = null;

/** The single Supabase client for the app. Always go through this so the
 *  SecureStore adapter is wired before the underlying singleton is created
 *  — same reasoning as extension's supabaseClient.ts. */
export function getMobileSupabase(): SupabaseClient {
  if (!isAuthConfigured()) {
    throw new Error('Supabase is not configured. Add EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY to .env.local');
  }
  if (!_supabase) {
    _supabase = getSupabaseClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
      storage: secureStoreAdapter,
      storageKey: 'pomodoso-auth',
    });
  }
  return _supabase;
}

export const API_URL = process.env.EXPO_PUBLIC_API_URL;
