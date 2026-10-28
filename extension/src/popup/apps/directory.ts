import { ApiError, PublicApiClient, TokenApiClient, getDirectoryPage, getMyPlugin, type DirectoryPage } from '@pomodoso/api';

import { ensureFreshSession } from '../../supabaseClient';

const API_URL = import.meta.env.VITE_API_URL as string | undefined;

/** Not public, and nobody signed in to ask for it as their own. */
export class SignInToOpen extends Error {}

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
