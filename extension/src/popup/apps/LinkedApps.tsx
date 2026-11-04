import { useLiveQuery } from 'dexie-react-hooks';

import type { PluginManifest } from '@pomodoso/types/plugins';

import { db } from '../../db';
import { appPageUrl } from './appEnv';

// A task's records in apps that link to it (a `task` field): "Publish the
// app" shows its issue, and opens its board. Kept free of the plugin engine
// (it renders in the task detail): plain lookups over the stored manifests.

interface Linked {
  pluginId: string;
  app: string;
  recordId: string;
  title: string;
  /** The record's screen, if the app has one (a view with `of` its collection). */
  view: string | undefined;
}

function titleOf(m: PluginManifest, collection: string, data: Record<string, unknown>): string {
  const c = m.collections.find((x) => x.key === collection);
  const key = c?.title_field ?? c?.fields.find((f) => f.type === 'text')?.key;
  const v = key ? data[key] : undefined;
  return typeof v === 'string' && v.trim() ? v : 'Untitled';
}

export function LinkedApps({ taskId, label }: { taskId: string; label: (children: React.ReactNode) => React.ReactNode }) {
  const linked = useLiveQuery(async () => {
    const out: Linked[] = [];
    for (const p of await db.plugins.toArray()) {
      if (p.deletedAt || !p.enabled || !Array.isArray(p.manifest?.collections)) continue;
      const m = p.manifest;
      const fields = m.collections.flatMap((c) => (Array.isArray(c.fields) ? c.fields : []).filter((f) => f.type === 'task').map((f) => ({ collection: c.key, field: f.key })));
      if (fields.length === 0) continue;
      const rows = await db.pluginRecords.where('pluginId').equals(p.id).toArray();
      for (const r of rows) {
        if (r.deletedAt || !fields.some((f) => f.collection === r.collection && r.data[f.field] === taskId)) continue;
        out.push({ pluginId: p.id, app: m.name, recordId: r.id, title: titleOf(m, r.collection, r.data), view: m.views.find((v) => v.of === r.collection)?.id });
      }
    }
    return out;
  }, [taskId]);
  if (!linked || linked.length === 0) return null;

  return (
    <div style={{ padding: '12px 14px 0' }}>
      {label('In apps')}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {linked.map((l) => (
          <button
            key={l.recordId}
            type="button"
            onClick={() => void chrome.tabs.create({ url: appPageUrl(l.pluginId, l.view, l.view ? l.recordId : undefined) })}
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}
          >
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.title}</span>
              <span style={{ display: 'block', fontSize: 10, color: 'var(--color-text-faint)' }}>{l.app}</span>
            </span>
            <span style={{ fontSize: 11, color: 'var(--color-accent)', fontWeight: 600, flexShrink: 0 }}>Open ↗</span>
          </button>
        ))}
      </div>
    </div>
  );
}
