import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';

import { showsOnToday } from '@pomodoso/types/plugins';
import { TodayWidget } from '@pomodoso/ui/plugins';

import { db, localDate, type PluginRow } from '../../db';
import { addRecord, setDaily } from '../../plugins';
import { isSupported } from './supported';
import { usePluginData } from './usePluginData';

// The "Apps" section of Today: a widget for every app whose file declares
// one and that the user switched on. Lazy-loaded with the plugin engine;
// HomeState renders it only when signed in (signed out, widgets are off).

export function TodayApps({ timezone, weekStart, onOpenApp }: { timezone: string; weekStart: number; onOpenApp: (id: string) => void }) {
  const pinned = useLiveQuery(
    async () => (await db.plugins.toArray()).filter((p) => !p.deletedAt && p.enabled && isSupported(p) && showsOnToday(p.manifest, p.settings)).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [],
  );
  if (!pinned || pinned.length === 0) return null;
  return (
    <div style={{ padding: '12px 14px 0' }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-text-muted)', marginBottom: 6 }}>Apps</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 6 }}>
        {pinned.map((p) => (
          <PinnedApp key={p.id} plugin={p} timezone={timezone} weekStart={weekStart} onOpen={() => onOpenApp(p.id)} />
        ))}
      </div>
    </div>
  );
}

function PinnedApp({ plugin, timezone, weekStart, onOpen }: { plugin: PluginRow; timezone: string; weekStart: number; onOpen: () => void }) {
  const { evaluator } = usePluginData(plugin, timezone, weekStart);
  const env = useMemo(() => ({ timezone, weekStart }), [timezone, weekStart]);
  if (!evaluator) return null;
  return (
    <TodayWidget
      manifest={plugin.manifest}
      settings={plugin.settings}
      evaluator={evaluator}
      today={localDate(timezone)}
      now={new Date().toISOString()}
      readOnly={false}
      add={(c, data) => addRecord(plugin, c, data, env)}
      setDay={(c, day, data) => setDaily(plugin, c, day, data, env)}
      onOpen={onOpen}
    />
  );
}
