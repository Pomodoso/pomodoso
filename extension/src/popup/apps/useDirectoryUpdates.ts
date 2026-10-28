import { useEffect, useState } from 'react';

import { ApiError } from '@pomodoso/api';
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

interface Latest {
  manifest: PluginManifest | null;
  /** The directory answered that it doesn't have it (taken down, or private
   *  to someone else): it keeps working here, with no more updates. */
  gone: boolean;
}

/** slug → when it was asked and what the directory had. */
const latestBySlug = new Map<string, Latest & { at: number }>();

async function latest(slug: string): Promise<Latest> {
  const hit = latestBySlug.get(slug);
  if (hit && Date.now() - hit.at < TTL_MS) return hit;
  let found: Latest = { manifest: null, gone: false };
  try {
    const page = await openListing(slug);
    const r = validatePluginData(page.manifest);
    found = { manifest: r.ok ? r.manifest : null, gone: false };
  } catch (e) {
    // Offline or unreachable says nothing; a 404 means it's not there anymore.
    found = { manifest: null, gone: e instanceof ApiError && e.status === 404 };
  }
  latestBySlug.set(slug, { ...found, at: Date.now() });
  return found;
}

/** What `next` would do to an install of `current`, or null when it isn't newer. */
export function updateFor(current: PluginManifest, next: PluginManifest): AvailableUpdate | null {
  if (compareVersions(next.version, current.version) <= 0) return null;
  return { next, report: checkUpdate(current, next) };
}

export interface DirectoryState {
  /** Plugin id → its available update. */
  updates: Map<string, AvailableUpdate>;
  /** Plugin ids the directory no longer has. */
  gone: Set<string>;
}

/** Available updates, and installs no longer in the directory, for the given installs. */
export function useDirectoryUpdates(plugins: readonly PluginRow[] | undefined): DirectoryState {
  const [state, setState] = useState<DirectoryState>({ updates: new Map(), gone: new Set() });
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
        const l = await latest(p.slug);
        return { id: p.id, gone: l.gone, update: l.manifest ? updateFor(p.manifest, l.manifest) : null };
      }),
    ).then((found) => {
      if (!live) return;
      setState({
        updates: new Map(found.flatMap((f) => (f.update ? [[f.id, f.update] as const] : []))),
        gone: new Set(found.filter((f) => f.gone).map((f) => f.id)),
      });
    });
    return () => {
      live = false;
    };
    // Re-asked when the set of installs or their versions change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return state;
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
