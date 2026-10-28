import type { IApiClient } from './client.ts';

// The plugin directory (backend/src/routes/plugin_directory.rs). Browsing is
// public; publishing, reporting and "my plugins" need a signed-in client.

export type DirectoryVisibility = 'public' | 'unlisted' | 'private';

export interface DirectoryListing {
  slug: string;
  name: string;
  description: string | null;
  icon: string | null;
  author: string | null;
  has_today: boolean;
  latest_version: string;
  visibility: DirectoryVisibility;
  updated_at: string;
}

export interface DirectoryVersion {
  version: string;
  change_kind: 'initial' | 'additive' | 'breaking';
  changelog: string | null;
  created_at: string;
}

export interface DirectoryPage extends DirectoryListing {
  /** The latest version's plugin file, parsed. Validate it before use. */
  manifest: unknown;
  versions: DirectoryVersion[];
}

export interface DirectorySearch {
  q?: string;
  /** Only plugins with a Today widget. */
  today?: boolean;
  sort?: 'newest' | 'name';
  limit?: number;
}

export function searchDirectory(client: IApiClient, search: DirectorySearch = {}): Promise<DirectoryListing[]> {
  const params = new URLSearchParams();
  if (search.q) params.set('q', search.q);
  if (search.today) params.set('today', 'true');
  if (search.sort) params.set('sort', search.sort);
  if (search.limit) params.set('limit', String(search.limit));
  const qs = params.toString();
  return client.get(`/plugins/directory${qs ? `?${qs}` : ''}`);
}

export function getDirectoryPage(client: IApiClient, slug: string): Promise<DirectoryPage> {
  return client.get(`/plugins/directory/${encodeURIComponent(slug)}`);
}

export function getDirectoryVersion(client: IApiClient, slug: string, version: string): Promise<unknown> {
  return client.get(`/plugins/directory/${encodeURIComponent(slug)}/versions/${encodeURIComponent(version)}`);
}

export interface PublishBody {
  manifest: unknown;
  changelog?: string;
  /** Omitted keeps the listing's current one. `private` needs entitlements.features.private_plugins (403 otherwise). */
  visibility?: DirectoryVisibility;
  /** From checkUpdate against the latest published version; omitted for a first version. */
  change_kind?: 'additive' | 'breaking';
}

export function publishPlugin(client: IApiClient, body: PublishBody): Promise<DirectoryListing> {
  return client.post('/plugins/publish', body);
}

export function myPlugins(client: IApiClient): Promise<DirectoryListing[]> {
  return client.get('/plugins/mine');
}

export function takeDownPlugin(client: IApiClient, slug: string): Promise<unknown> {
  return client.fetch(`/plugins/mine/${encodeURIComponent(slug)}`, { method: 'DELETE' });
}

export function reportPlugin(client: IApiClient, slug: string, reason: string): Promise<unknown> {
  return client.post(`/plugins/directory/${encodeURIComponent(slug)}/report`, { reason });
}
