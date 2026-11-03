import { useEffect, useState } from 'react';

import { PublicApiClient, getDirectoryPage, searchDirectory, type DirectoryListing } from '@pomodoso/api';
import { validatePluginData, type PluginManifest } from '@pomodoso/types/plugins';
import { PluginIcon } from '@pomodoso/ui/plugins';

// Apps → Add an app → Browse: search the public directory and pick one to
// install. The directory is public, so this works signed out too (installing
// still needs a session, like any write). The file comes from our backend,
// never from a third party, and is validated here like a local file before
// the install preview shows it.

const API_URL = import.meta.env.VITE_API_URL as string | undefined;

export const directoryAvailable = Boolean(API_URL);

export function Browse({ onPick }: { onPick: (text: string, manifest: PluginManifest) => void }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<DirectoryListing[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);

  // Searches as you type, after a short pause.
  useEffect(() => {
    if (!API_URL) return;
    let live = true;
    const t = setTimeout(() => {
      searchDirectory(new PublicApiClient(API_URL), { q: q.trim() })
        .then((r) => {
          if (!live) return;
          setResults(r);
          setError(null);
        })
        .catch(() => live && setError("Couldn't reach the directory. Check your connection and try again."));
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q]);

  const open = async (slug: string) => {
    if (!API_URL || opening) return;
    setOpening(slug);
    try {
      const page = await getDirectoryPage(new PublicApiClient(API_URL), slug);
      const r = validatePluginData(page.manifest);
      if (!r.ok) {
        setError(`"${page.name}" needs a newer version of Pomodoso.`);
        return;
      }
      // JSON is YAML, so the install path parses it like any file.
      onPick(JSON.stringify(page.manifest), r.manifest);
    } catch {
      setError("Couldn't open that app. Try again.");
    } finally {
      setOpening(null);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <input
        type="search" value={q} placeholder="Search apps" autoFocus
        onChange={(e) => setQ(e.target.value)}
        style={{ padding: '7px 10px', fontSize: 12, fontFamily: 'inherit', color: 'var(--color-text)', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', outline: 'none' }}
      />
      {error ? <div style={{ fontSize: 11, color: 'var(--color-accent)' }}>{error}</div> : null}
      {results === null && !error ? <div style={{ fontSize: 11, color: 'var(--color-text-faint)', textAlign: 'center', padding: 12 }}>Loading…</div> : null}
      {results?.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)', textAlign: 'center', padding: '16px 8px' }}>
          {q.trim() ? `No apps match "${q.trim()}".` : 'No apps published yet.'}
        </div>
      ) : null}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {results?.map((l) => (
          <button
            key={l.slug} type="button" disabled={opening !== null} onClick={() => void open(l.slug)}
            style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', opacity: opening && opening !== l.slug ? 0.5 : 1 }}
          >
            <PluginIcon icon={l.icon ?? undefined} name={l.name} />
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--color-text)' }}>
                {l.name}
                <span style={{ fontSize: 10, fontWeight: 400, color: 'var(--color-text-faint)' }}> v{l.latest_version}{l.has_today ? ' · Today widget' : ''}</span>
              </span>
              {l.description ? (
                <span style={{ display: 'block', fontSize: 11, color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.description}</span>
              ) : null}
            </span>
            <span style={{ color: 'var(--color-text-faint)', fontSize: 11 }}>{opening === l.slug ? '…' : '›'}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
