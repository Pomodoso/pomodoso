import { useCallback, useEffect, useMemo, useState } from 'react';
import { listInstalledPlugins, pushEntities, type InstalledPlugin } from '@pomodoso/api';
import {
  applyRules,
  createEvaluator,
  dailyRecordId,
  localDayOf,
  validatePluginData,
  type EvalContext,
  type PluginEvaluator,
  type PluginManifest,
  type PluginRecord,
} from '@pomodoso/types/plugins';
import type { PluginActions } from '@pomodoso/ui/plugins';
import { api } from './api.ts';

// The user's installed apps in the dashboard: what their devices synced, read
// from the backend. Writes go through /sync/push like any device's, so the
// extension gets them on its next pull and conflicts resolve the same way
// (last write by updated_at). Mirrors the extension's addRecord / setDaily /
// updateRecord / deleteRecord, rules included.

export interface InstalledApp {
  id: string;
  slug: string;
  manifest: PluginManifest;
  settings: Record<string, unknown>;
  installedOn: string;
  records: PluginRecord[];
}

const timeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

export function evalContext(app: InstalledApp, now = new Date().toISOString()): EvalContext {
  const tz = timeZone();
  return { today: localDayOf(now, tz), now, timeZone: tz, weekStart: 0, installedOn: app.installedOn, settings: app.settings, records: app.records };
}

export function evaluatorFor(app: InstalledApp): PluginEvaluator {
  return createEvaluator(app.manifest, evalContext(app));
}

function fromApi(p: InstalledPlugin): InstalledApp | null {
  const r = validatePluginData(p.manifest);
  // A file this web app can't read yet (made for a newer version): left out.
  if (!r.ok) return null;
  return {
    id: p.id,
    slug: p.slug,
    manifest: r.manifest,
    settings: p.settings ?? {},
    installedOn: p.installed_on,
    records: p.records.map((x) => ({ ...x })),
  };
}

function entity(app: InstalledApp, r: PluginRecord, deletedAt: string | null = null) {
  return {
    table: 'plugin_record',
    id: r.id,
    data: { plugin_id: app.id, collection: r.collection, day: r.day ?? null, occurred_at: r.occurred_at ?? null, data: r.data, created_at: r.created_at },
    updated_at: r.updated_at ?? r.created_at,
    deleted_at: deletedAt,
  };
}

export function useInstalledApps(canWrite: boolean) {
  const [apps, setApps] = useState<InstalledApp[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);

  const load = useCallback(() => {
    listInstalledPlugins(api)
      .then((list) => {
        setApps(list.map(fromApi).filter((a): a is InstalledApp => a !== null));
        setError(null);
      })
      .catch(() => setError("Couldn't load your apps."));
  }, []);

  useEffect(load, [load]);

  /** Shows `next` right away, pushes it, and goes back to the server's copy if the push fails. */
  const commit = useCallback((app: InstalledApp, next: PluginRecord, deletedAt: string | null = null) => {
    setWriteError(null);
    setApps((list) =>
      list?.map((a) => {
        if (a.id !== app.id) return a;
        const rest = a.records.filter((r) => r.id !== next.id);
        return { ...a, records: deletedAt ? rest : [...rest, next] };
      }) ?? list,
    );
    return pushEntities(api, { entities: [entity(app, next, deletedAt)] }).catch(() => {
      setWriteError("Couldn't save that. Check your connection and try again.");
      load();
    });
  }, [load]);

  const actionsFor = useCallback((app: InstalledApp): PluginActions => {
    const withRules = (prev: PluginRecord | undefined, next: PluginRecord) =>
      app.manifest.rules?.some((r) => r.collection === next.collection) ? applyRules(app.manifest, prev, next, evalContext(app)) : next.data;
    return {
      add: (collection, data) => {
        if (!canWrite) return;
        const ts = new Date().toISOString();
        const kind = app.manifest.collections.find((c) => c.key === collection)?.kind;
        const next: PluginRecord = { id: crypto.randomUUID(), collection, occurred_at: kind === 'event' ? ts : null, data, created_at: ts, updated_at: ts };
        next.data = withRules(undefined, next);
        return commit(app, next);
      },
      setDay: (collection, day, data) => {
        if (!canWrite) return;
        const ts = new Date().toISOString();
        const id = dailyRecordId(app.id, collection, day);
        const prev = app.records.find((r) => r.id === id);
        const next: PluginRecord = { id, collection, day, data: { ...prev?.data, ...data }, created_at: prev?.created_at ?? ts, updated_at: ts };
        next.data = withRules(prev, next);
        return commit(app, next);
      },
      update: (record, data) => {
        if (!canWrite) return;
        const next: PluginRecord = { ...record, data, updated_at: new Date().toISOString() };
        next.data = withRules(record, next);
        return commit(app, next);
      },
      remove: (record) => {
        if (!canWrite) return;
        const ts = new Date().toISOString();
        return commit(app, { ...record, updated_at: ts }, ts);
      },
      openUrl: (url) => window.open(url, '_blank', 'noopener,noreferrer'),
    };
  }, [canWrite, commit]);

  return useMemo(() => ({ apps, error, writeError, actionsFor, reload: load }), [apps, error, writeError, actionsFor, load]);
}
