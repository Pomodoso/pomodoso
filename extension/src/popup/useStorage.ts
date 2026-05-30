import { useCallback, useEffect, useRef, useState } from 'react';

function chromeStorageAvailable(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.storage?.local;
}

async function storageRead(key: string): Promise<unknown> {
  if (chromeStorageAvailable()) {
    const result = await chrome.storage.local.get(key);
    return result[key];
  }
  // Dev fallback: window.localStorage
  const raw = window.localStorage.getItem(`pom_dev_${key}`);
  return raw !== null ? (JSON.parse(raw) as unknown) : undefined;
}

function storageWrite(key: string, value: unknown): void {
  if (chromeStorageAvailable()) {
    void chrome.storage.local.set({ [key]: value });
  } else {
    window.localStorage.setItem(`pom_dev_${key}`, JSON.stringify(value));
  }
}

/**
 * Persists a value in chrome.storage.local (or localStorage in dev/browser mode).
 * Returns [value, setValue, loading] — the same shape as useState but with a
 * `loading` flag that is true until the initial read from storage completes.
 *
 * The first time the key has no stored value, `initial` is written immediately
 * so subsequent opens load from storage rather than falling back to the default.
 */
export function useLocalStorage<T>(
  key: string,
  initial: T,
): [T, (updater: T | ((prev: T) => T)) => void, boolean] {
  const [value, setValueState] = useState<T>(initial);
  const [loading, setLoading] = useState(true);
  // Track whether the initial load is done so writes before that are blocked.
  const readyRef = useRef(false);
  // Keep key stable to avoid re-triggering the effect.
  const keyRef = useRef(key);

  useEffect(() => {
    let cancelled = false;
    storageRead(keyRef.current)
      .then((stored) => {
        if (cancelled) return;
        if (stored !== undefined) {
          setValueState(stored as T);
        } else {
          // Seed storage on first run so the value survives the next open.
          storageWrite(keyRef.current, initial);
        }
        readyRef.current = true;
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        readyRef.current = true;
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const setValue = useCallback((updater: T | ((prev: T) => T)) => {
    setValueState((prev) => {
      const next = typeof updater === 'function'
        ? (updater as (p: T) => T)(prev)
        : updater;
      if (readyRef.current) {
        storageWrite(keyRef.current, next);
      }
      return next;
    });
  }, []);

  return [value, setValue, loading];
}
