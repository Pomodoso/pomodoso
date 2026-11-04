import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';

import { showsOnToday } from '@pomodoso/types/plugins';
import { TodayWidget } from '@pomodoso/ui/plugins';

import { db, localDate, type PluginRow } from '../../db';
import { addRecord, deleteRecord, setDaily, updateRecord } from '../../plugins';
import { useLocalStorage } from '../useStorage';
import { TodaySectionHeader } from '../TodaySectionHeader';
import { isSupported } from './supported';
import { usePluginData } from './usePluginData';

// The "Apps" section of Today: a widget for every app whose file declares
// one and that the user switched on. Lazy-loaded with the plugin engine;
// HomeState renders it only when signed in (signed out, widgets are off).
// Foldable (open by default); folded, it says how many apps it holds.

export function TodayApps({ timezone, weekStart, onOpenApp }: { timezone: string; weekStart: number; onOpenApp: (id: string) => void }) {
  const pinned = useLiveQuery(
    async () => (await db.plugins.toArray()).filter((p) => !p.deletedAt && p.enabled && isSupported(p) && showsOnToday(p.manifest, p.settings)).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [],
  );
  const [open, setOpen] = useLocalStorage<boolean>('pom_today_apps_open', true);
  if (!pinned || pinned.length === 0) return null;
  return (
    <div style={{ padding: '12px 14px 0' }}>
      <TodaySectionHeader label="Apps" open={open} onToggle={() => setOpen((o) => !o)} summary={`${pinned.length} app${pinned.length === 1 ? '' : 's'}`} />
      {open ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 6 }}>
          {pinned.map((p) => (
            <PinnedApp key={p.id} plugin={p} timezone={timezone} weekStart={weekStart} onOpen={() => onOpenApp(p.id)} />
          ))}
        </div>
      ) : null}
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
      timeZone={timezone}
      weekStart={weekStart}
      readOnly={false}
      add={(c, data) => addRecord(plugin, c, data, env)}
      remove={(r) => deleteRecord(r.id)}
      update={(r, data) => updateRecord(plugin, r.id, data, env)}
      setDay={(c, day, data) => setDaily(plugin, c, day, data, env)}
      onOpen={onOpen}
    />
  );
}
