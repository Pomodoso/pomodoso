import { useEffect, useState } from 'react';

import { checkUpdate, compareVersions, validatePluginData, type PluginManifest, type UpdateReport } from '@pomodoso/types/plugins';

import type { PluginRow } from '../../db';
import { openListing } from './directory';

// Newer versions of apps installed from the directory. Asked of the backend
// (public, or the user's own for a private app) at most once an hour per app; the answer is checked
// here with checkUpdate, whatever the directory said about it.

const API_URL = import.meta.env.VITE_API_URL as string | undefined;
const TTL_MS = 60 * 60 * 1000;

export interface AvailableUpdate {
  next: PluginManifest;
  report: UpdateReport;
}

/** slug → when it was asked and the latest file the directory had. */
const latestBySlug = new Map<string, { at: number; manifest: PluginManifest | null }>();

async function latest(slug: string): Promise<PluginManifest | null> {
  const hit = latestBySlug.get(slug);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.manifest;
  let manifest: PluginManifest | null = null;
  try {
    const page = await openListing(slug);
    const r = validatePluginData(page.manifest);
    manifest = r.ok ? r.manifest : null;
  } catch {
    // Taken down, offline or unreachable: no update to offer.
  }
  latestBySlug.set(slug, { at: Date.now(), manifest });
  return manifest;
}

/** What `next` would do to an install of `current`, or null when it isn't newer. */
export function updateFor(current: PluginManifest, next: PluginManifest): AvailableUpdate | null {
  if (compareVersions(next.version, current.version) <= 0) return null;
  return { next, report: checkUpdate(current, next) };
}

/** Plugin id → its available update, for the given installs. */
export function useDirectoryUpdates(plugins: readonly PluginRow[] | undefined): Map<string, AvailableUpdate> {
  const [updates, setUpdates] = useState<Map<string, AvailableUpdate>>(new Map());
  const key = (plugins ?? [])
    .filter((p) => p.source === 'directory' && !p.deletedAt)
    .map((p) => `${p.id}@${p.manifest.version}`)
    .join(',');

  useEffect(() => {
    if (!API_URL || !plugins) return;
    let live = true;
    const fromDirectory = plugins.filter((p) => p.source === 'directory' && !p.deletedAt);
    void Promise.all(
      fromDirectory.map(async (p) => {
        const next = await latest(p.slug);
        const u = next ? updateFor(p.manifest, next) : null;
        return u ? ([p.id, u] as const) : null;
      }),
    ).then((found) => {
      if (live) setUpdates(new Map(found.filter((x): x is readonly [string, AvailableUpdate] => x !== null)));
    });
    return () => {
      live = false;
    };
    // Re-asked when the set of installs or their versions change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return updates;
}

/** A migrate step in words, for the confirmation of a breaking update. */
export function describeStep(step: NonNullable<PluginManifest['migrate']>['steps'][number]): string {
  if ('rename_collection' in step) return `“${step.rename_collection.from}” entries become “${step.rename_collection.to}”`;
  if ('rename_field' in step) return `“${step.rename_field.from}” is renamed to “${step.rename_field.to}”`;
  if ('map_values' in step) {
    const pairs = Object.entries(step.map_values.map).map(([a, b]) => `${a} → ${b}`);
    return `In “${step.map_values.field}”: ${pairs.join(', ')}`;
  }
  return `“${step.drop_field.field}” is no longer shown (your values are kept)`;
}
