import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';

import { db, type PluginRow } from '../../db';
import { evaluatorFor } from '../../plugins';

/** A plugin's live records and evaluator, refreshed when its data changes and once a minute (for "today" and "time ago"). */
export function usePluginData(plugin: PluginRow, timezone: string, weekStart: number, tab?: { url: string; title: string }) {
  const records = useLiveQuery(
    async () => (await db.pluginRecords.where('pluginId').equals(plugin.id).toArray()).filter((r) => !r.deletedAt),
    [plugin.id],
  );
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);
  const evaluator = useMemo(
    () => (records ? evaluatorFor(plugin, records, { timezone, weekStart, ...(tab ? { tab } : {}) }) : undefined),
    // tick re-evaluates "today" and "now" as time passes
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [plugin, records, timezone, weekStart, tab?.url, tab?.title, tick],
  );
  return { records, evaluator };
}
