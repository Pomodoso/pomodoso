import type { ISOTimestamp, UUID } from '@pomodoso/types';
import type { IApiClient } from './client.ts';

export interface SyncEntity {
  table: string;
  id: UUID;
  data: Record<string, unknown>;
  updated_at: ISOTimestamp;
  deleted_at: ISOTimestamp | null;
}

export interface PushBody {
  // Legacy fallback — sync is user-global; entities carry their own workspace_id.
  workspace_id?: UUID;
  entities: SyncEntity[];
}

export interface PushResponse {
  accepted: number;
}

export interface PullResponse {
  entities: SyncEntity[];
  server_time: ISOTimestamp;
}

export async function pushEntities(
  client: IApiClient,
  body: PushBody,
): Promise<PushResponse> {
  return client.post<PushResponse>('/sync/push', body);
}

export async function pullEntities(
  client: IApiClient,
  since?: ISOTimestamp,
): Promise<PullResponse> {
  const params = new URLSearchParams();
  if (since) params.set('since', since);
  const qs = params.toString();
  return client.get<PullResponse>(`/sync/pull${qs ? `?${qs}` : ''}`);
}
