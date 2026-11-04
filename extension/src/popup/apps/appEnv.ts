import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';

import type { PluginRecord } from '@pomodoso/types/plugins';
import type { PluginActions, PluginTasks } from '@pomodoso/ui/plugins';

import { db, type PluginRow } from '../../db';
import { addRecord, deleteRecord, setDaily, updateRecord } from '../../plugins';

// What an app's screens need from the extension, shared by the Apps tab and
// the full-page app view (app/index.html).

/** The writes an app's blocks perform. They return promises, so a form resets once stored. */
export function pluginActions(plugin: PluginRow, timezone: string, weekStart: number): PluginActions {
  const env = { timezone, weekStart };
  return {
    add: (c, data, opts) => addRecord(plugin, c, data, env, opts?.occurredAt ? { occurredAt: opts.occurredAt } : {}),
    setDay: (c, day, data) => setDaily(plugin, c, day, data, env),
    update: (r: PluginRecord, data, opts) => updateRecord(plugin, r.id, data, env, opts?.occurredAt ? { occurredAt: opts.occurredAt } : {}),
    remove: (r: PluginRecord) => deleteRecord(plugin, r.id),
    openUrl: (url) => {
      if (/^https?:\/\//i.test(url)) void chrome.tabs.create({ url });
    },
  };
}

/**
 * The user's tasks for `task` fields: ids and titles only, newest first.
 * Every workspace's, since apps aren't tied to one. Apps get nothing else.
 */
export function usePluginTasks(): PluginTasks {
  const tasks = useLiveQuery(
    async () => (await db.tasks.toArray()).filter((t) => !t.deletedAt).sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')),
    [],
  );
  return useMemo(() => {
    const byId = new Map((tasks ?? []).map((t) => [t.id, t.title]));
    return {
      list: () => (tasks ?? []).map((t) => ({ value: t.id, label: t.title || 'Untitled task' })),
      title: (id) => byId.get(id),
    };
  }, [tasks]);
}

/** The full-page view of an app, or of one of its records' screens. */
export function appPageUrl(pluginId: string, view?: string, record?: string): string {
  const q = new URLSearchParams({ plugin: pluginId });
  if (view) q.set('view', view);
  if (record) q.set('record', record);
  return chrome.runtime.getURL(`app/index.html?${q.toString()}`);
}
