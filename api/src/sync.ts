import type { ISOTimestamp, UUID } from '@pomodoso/types';
import type { ApiClient } from './client.ts';

export interface SyncEntity {
  table: string;
  id: UUID;
  data: Record<string, unknown>;
  updated_at: ISOTimestamp;
  deleted_at: ISOTimestamp | null;
}

export interface PushBody {
  workspace_id: UUID;
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
  client: ApiClient,
  body: PushBody,
): Promise<PushResponse> {
  return client.post<PushResponse>('/sync/push', body);
}

export async function pullEntities(
  client: ApiClient,
  workspaceId: UUID,
  since?: ISOTimestamp,
): Promise<PullResponse> {
  const params = new URLSearchParams({ workspace_id: workspaceId });
  if (since) params.set('since', since);
  return client.get<PullResponse>(`/sync/pull?${params}`);
}
