import { useEffect, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';

import { db } from '../../db';
import { applyPluginUpdate } from '../../plugins';
import { useDirectoryUpdates } from './useDirectoryUpdates';

// Runs whenever the popup is open with apps installed (signed in), on any
// tab, lazy-loaded with the plugin engine. It applies the small updates of
// apps that allow it, and reports how many updates are left for the user,
// for the badge on the Apps tab. The directory is asked at most once an
// hour per app (useDirectoryUpdates), shared with the Apps tab.

export function UpdatesWatcher({ onCount }: { onCount: (n: number) => void }) {
  const plugins = useLiveQuery(() => db.plugins.filter((p) => !p.deletedAt).toArray(), []);
  const { updates } = useDirectoryUpdates(plugins);

  // Each version is tried once per popup, so a failing one doesn't retry in a loop.
  const tried = useRef(new Set<string>());
  useEffect(() => {
    if (!plugins) return;
    let pending = 0;
    for (const [id, u] of updates) {
      const p = plugins.find((x) => x.id === id);
      if (!p || u.report.issues.length > 0) continue; // can't be applied: nothing to ask
      const automatic = p.autoUpdate && u.report.kind !== 'breaking';
      if (!automatic) {
        pending++;
        continue;
      }
      const attempt = `${id}@${u.next.version}`;
      if (tried.current.has(attempt)) continue;
      tried.current.add(attempt);
      void applyPluginUpdate(id, u.next).catch(() => {});
    }
    onCount(pending);
  }, [updates, plugins, onCount]);

  return null;
}
