// Installing an app from the web (Dashboard → Apps → Install). The page asks
// the background through externally_connectable; the background leaves the
// request here and tries to open the popup, which takes it and shows the
// install preview. Nothing is installed without the user confirming there.

export const INSTALL_REQUEST_KEY = 'pom_install_request';

/** A request older than this is dropped: the user has moved on. */
export const INSTALL_REQUEST_TTL_MS = 10 * 60 * 1000;

export interface InstallRequest {
  slug: string;
  at: number;
}

/** Plugin ids are lower-kebab-case (manifest.ts); anything else isn't ours. */
export const isPluginSlug = (s: unknown): s is string => typeof s === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(s);

const WEB_URL = (import.meta.env.VITE_WEB_URL as string | undefined) ?? 'https://pomodoso.com';

/** Origins allowed to ask; manifest.json's externally_connectable matches the same. */
export const WEB_ORIGINS = new Set(['https://pomodoso.com', 'https://www.pomodoso.com', new URL(WEB_URL).origin]);
