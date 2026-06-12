-- The get_workspaces query orders by MAX(t.synced_at) per workspace.
-- The existing partial index (WHERE deleted_at IS NULL) is not used because
-- the subquery has no deleted_at filter. This full index covers it.
CREATE INDEX IF NOT EXISTS task_synced_ws_idx ON task(workspace_id, synced_at DESC NULLS LAST);
