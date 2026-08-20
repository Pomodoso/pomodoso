import * as SecureStore from 'expo-secure-store';

// SecureStore (iOS Keychain / Android Keystore) caps individual values at
// ~2048 bytes. Chunk across numbered keys and reassemble on read — shared by
// lib/supabase.ts (a Supabase session routinely exceeds the cap) and
// utils/googleCalendar.ts (a calendar_connections record can too, once more
// than one workspace has connected).
const CHUNK_SIZE = 1800;

function chunkKeys(key: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => `${key}_${i}`);
}

export async function getChunkedItem(key: string): Promise<string | null> {
  const countRaw = await SecureStore.getItemAsync(`${key}_chunks`);
  if (!countRaw) return null;
  const count = parseInt(countRaw, 10);
  if (isNaN(count) || count <= 0) return null;
  const parts = await Promise.all(chunkKeys(key, count).map(k => SecureStore.getItemAsync(k)));
  if (parts.some(p => p === null)) return null;
  return parts.join('');
}

export async function setChunkedItem(key: string, value: string): Promise<void> {
  // Clear any previous (possibly differently-sized) chunk set first, so a
  // shrink doesn't leave stale trailing chunks behind for getChunkedItem to
  // pick up as if they were still part of the current value.
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
}

export async function removeChunkedItem(key: string): Promise<void> {
  const countRaw = await SecureStore.getItemAsync(`${key}_chunks`);
  const count = countRaw ? parseInt(countRaw, 10) : 0;
  if (count > 0) {
    await Promise.all(chunkKeys(key, count).map(k => SecureStore.deleteItemAsync(k)));
  }
  await SecureStore.deleteItemAsync(`${key}_chunks`);
}
