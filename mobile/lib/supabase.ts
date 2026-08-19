import type { SupabaseAuthStorage, SupabaseClient } from '@pomodoso/api';
import { getSupabaseClient } from '@pomodoso/api';
import * as SecureStore from 'expo-secure-store';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

export function isAuthConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

// SecureStore (iOS Keychain / Android Keystore) caps individual values at
// ~2048 bytes — a Supabase session (access + refresh JWT, user metadata)
// routinely exceeds that. Chunk across numbered keys and reassemble on
// read, the standard workaround for Supabase + Expo SecureStore (same
// constraint the extension doesn't have — chrome.storage.local has no such
// per-item cap).
const CHUNK_SIZE = 1800;

function chunkKeys(key: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => `${key}_${i}`);
}

const secureStoreAdapter: SupabaseAuthStorage = {
  async getItem(key: string): Promise<string | null> {
    const countRaw = await SecureStore.getItemAsync(`${key}_chunks`);
    if (!countRaw) return null;
    const count = parseInt(countRaw, 10);
    if (isNaN(count) || count <= 0) return null;
    const parts = await Promise.all(chunkKeys(key, count).map(k => SecureStore.getItemAsync(k)));
    if (parts.some(p => p === null)) return null;
    return parts.join('');
  },
  async setItem(key: string, value: string): Promise<void> {
    // Clear any previous (possibly differently-sized) chunk set first, so a
    // shrink doesn't leave stale trailing chunks behind for getItem to pick
    // up as if they were still part of the current value.
    const prevCountRaw = await SecureStore.getItemAsync(`${key}_chunks`);
    const prevCount = prevCountRaw ? parseInt(prevCountRaw, 10) : 0;
    if (prevCount > 0) {
      await Promise.all(chunkKeys(key, prevCount).map(k => SecureStore.deleteItemAsync(k)));
    }
    const chunks: string[] = [];
    for (let i = 0; i < value.length; i += CHUNK_SIZE) {
      chunks.push(value.slice(i, i + CHUNK_SIZE));
    }
    await Promise.all(chunks.map((chunk, i) => SecureStore.setItemAsync(`${key}_${i}`, chunk)));
    await SecureStore.setItemAsync(`${key}_chunks`, String(chunks.length));
  },
  async removeItem(key: string): Promise<void> {
    const countRaw = await SecureStore.getItemAsync(`${key}_chunks`);
    const count = countRaw ? parseInt(countRaw, 10) : 0;
    if (count > 0) {
      await Promise.all(chunkKeys(key, count).map(k => SecureStore.deleteItemAsync(k)));
    }
    await SecureStore.deleteItemAsync(`${key}_chunks`);
  },
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
