import type { BillingInfo, Entitlements, User } from '@pomodoso/types';
import type { IApiClient } from './client.ts';

export interface MeResponse {
  user: User;
  entitlements: Entitlements;
  billing: BillingInfo;
}

export async function getMe(client: IApiClient): Promise<MeResponse> {
  return client.get<MeResponse>('/me');
}

export async function getEntitlements(client: IApiClient): Promise<Entitlements> {
  return client.get<Entitlements>('/me/entitlements');
}

/**
 * Deletes the signed-in account and everything stored for it on the server,
 * login included. A Stripe subscription is cancelled; an App Store one can only
 * be cancelled by the person from their Apple ID settings.
 */
export async function deleteAccount(client: IApiClient): Promise<void> {
  await client.fetch<void>('/me', { method: 'DELETE' });
}
