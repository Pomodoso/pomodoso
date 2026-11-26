import { validatePluginData, type PluginEvaluator } from '@pomodoso/types/plugins';
import type { PluginRecordRow, PluginRow } from '@pomodoso/types/plugins/rows';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { useEffect, useMemo, useState } from 'react';

import { db } from '@/db/client';
import { plugin as pluginTable, pluginRecord, task } from '@/db/schema';
import { deviceTimeZone, evaluatorFor, type PluginClock } from '@/utils/plugins';
import { pluginFromColumns, recordFromColumns } from '@/utils/pluginStore';

import { useSettings } from './useSettings';

/** Installed apps, oldest first (the extension's order). */
export function usePlugins(): PluginRow[] | undefined {
  const { data } = useLiveQuery(db.select().from(pluginTable).where(isNull(pluginTable.deletedAt)).orderBy(asc(pluginTable.createdAt)));
  return useMemo(() => data?.map(pluginFromColumns), [data]);
}

export function usePlugin(id: string | undefined): PluginRow | null | undefined {
  const { data } = useLiveQuery(db.select().from(pluginTable).where(eq(pluginTable.id, id ?? '')), [id]);
  return useMemo(() => {
    if (!data) return undefined;
    const c = data[0];
    return c && !c.deletedAt ? pluginFromColumns(c) : null;
  }, [data]);
}

/** The device's clock as apps read it: its time zone and the user's week start. */
export function usePluginClock(): PluginClock {
  const { settings } = useSettings();
  return useMemo(() => ({ timeZone: deviceTimeZone(), weekStart: settings.weekStart }), [settings.weekStart]);
}

/** An app's live records and evaluator, refreshed when its data changes and once a minute (for "today" and "time ago"). */
export function usePluginData(plugin: PluginRow, clock: PluginClock): { records: PluginRecordRow[] | undefined; evaluator: PluginEvaluator | undefined } {
  const { data } = useLiveQuery(
    db.select().from(pluginRecord).where(and(eq(pluginRecord.pluginId, plugin.id), isNull(pluginRecord.deletedAt))),
    [plugin.id],
  );
  const records = useMemo(() => data?.map(recordFromColumns), [data]);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);
  const evaluator = useMemo(
    () => (records ? evaluatorFor(plugin, records, clock) : undefined),
    // tick re-evaluates "today" and "now" as time passes
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [plugin, records, clock.timeZone, clock.weekStart, tick],
  );
  return { records, evaluator };
}

/** The user's tasks for `task` fields: ids and titles only, newest first, every workspace's. Apps see nothing else. */
export function usePluginTasks(): { list(): { value: string; label: string }[]; title(id: string): string | undefined } {
  const { data } = useLiveQuery(
    db.select({ id: task.id, title: task.title }).from(task).where(isNull(task.deletedAt)).orderBy(desc(task.updatedAt)),
  );
  return useMemo(() => {
    const byId = new Map((data ?? []).map(t => [t.id, t.title]));
    return {
      list: () => (data ?? []).map(t => ({ value: t.id, label: t.title || 'Untitled task' })),
      title: (id: string) => byId.get(id),
    };
  }, [data]);
}

const verdicts = new WeakMap<object, boolean>();

/**
 * Whether this build can open an app: its stored manifest must still pass
 * validation here (a newer format synced from a newer client may not).
 * Cached per manifest object.
 */
export function isSupported(p: PluginRow): boolean {
  const m = p.manifest as unknown;
  if (m === null || typeof m !== 'object') return false;
  let ok = verdicts.get(m);
  if (ok === undefined) {
    ok = validatePluginData(m).ok;
    verdicts.set(m, ok);
  }
  return ok;
}
