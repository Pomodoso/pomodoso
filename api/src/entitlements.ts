import type { Entitlements, User } from '@pomodoso/types';
import type { IApiClient } from './client.ts';

export interface MeResponse {
  user: User;
  entitlements: Entitlements;
}

export async function getMe(client: IApiClient): Promise<MeResponse> {
  return client.get<MeResponse>('/me');
}

export async function getEntitlements(client: IApiClient): Promise<Entitlements> {
  return client.get<Entitlements>('/me/entitlements');
}
