import { ApiError, PublicApiClient, TokenApiClient, getDirectoryPage, getMyPlugin, recordInstall, type DirectoryPage } from '@pomodoso/api';

import { ensureFreshSession } from '../../supabaseClient';

const API_URL = import.meta.env.VITE_API_URL as string | undefined;

/** Not public, and nobody signed in to ask for it as their own. */
export class SignInToOpen extends Error {}

/**
 * Tells the directory an app was installed, so it can count installs. Only the
 * slug is sent, never the session. Fire and forget: a failure must not get in
 * the way of the install, which already happened locally.
 */
export function reportInstall(slug: string): void {
  if (!API_URL) return;
  recordInstall(new PublicApiClient(API_URL), slug).catch(() => {});
}

/** A listing's page: public, or one of the signed-in user's own (private ones only open this way). */
export async function openListing(slug: string): Promise<DirectoryPage> {
  if (!API_URL) throw new Error('No directory configured');
  try {
    return await getDirectoryPage(new PublicApiClient(API_URL), slug);
  } catch (e) {
    if (!(e instanceof ApiError && e.status === 404)) throw e;
    const session = await ensureFreshSession();
    if (!session) throw new SignInToOpen(e.message);
    return getMyPlugin(new TokenApiClient(API_URL, session.access_token), slug);
  }
}
