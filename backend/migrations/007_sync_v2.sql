-- Sync v2: user-global sync (not workspace-scoped), rich task data,
-- pomodoro session sync, task ordering (Today/Priorities), and devices.

-- Ticket ids are display strings from providers (e.g. "INT-455", "#8825"), not UUIDs.
ALTER TABLE task ALTER COLUMN ticket_id TYPE TEXT USING ticket_id::text;
ALTER TABLE pomodoro_session ALTER COLUMN ticket_id TYPE TEXT USING ticket_id::text;

-- Rich client-side task fields round-trip through a single JSONB column so two
-- extensions can sync description, links, note entries, recurrence, etc. without
-- the server needing to understand each field.
ALTER TABLE task ADD COLUMN IF NOT EXISTS extra JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Today/Priorities membership and ordering — one row per workspace (LWW).
CREATE TABLE IF NOT EXISTS task_order (
  workspace_id UUID        PRIMARY KEY REFERENCES workspace(id) ON DELETE CASCADE,
  priority_ids JSONB       NOT NULL DEFAULT '[]'::jsonb,
  today_ids    JSONB       NOT NULL DEFAULT '[]'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  synced_at    TIMESTAMPTZ
);

DROP TRIGGER IF EXISTS set_updated_at_task_order ON task_order;
CREATE TRIGGER set_updated_at_task_order
  BEFORE UPDATE ON task_order
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Devices: each install (extension, web, future mobile) registers itself with a
-- client-generated UUID and reports version + sync heartbeats.
CREATE TABLE IF NOT EXISTS device (
  id           UUID        PRIMARY KEY,
  user_id      UUID        NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  kind         TEXT        NOT NULL DEFAULT 'extension' CHECK (kind IN ('extension', 'web', 'mobile')),
  name         TEXT        NOT NULL DEFAULT '',
  browser      TEXT        NOT NULL DEFAULT '',
  version      TEXT        NOT NULL DEFAULT '',
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_sync_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS device_user_idx ON device(user_id);

DROP TRIGGER IF EXISTS set_updated_at_device ON device;
CREATE TRIGGER set_updated_at_device
  BEFORE UPDATE ON device
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Clean up server-provisioned "Personal" workspaces that never received any
-- client data (synced_at IS NULL means no client ever pushed this workspace).
-- They duplicate the workspace the extension creates locally and confuse the
-- web dashboard's workspace picker.
DELETE FROM workspace w
WHERE w.synced_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM task t    WHERE t.workspace_id = w.id)
  AND NOT EXISTS (SELECT 1 FROM project p WHERE p.workspace_id = w.id)
  AND NOT EXISTS (SELECT 1 FROM habit h   WHERE h.workspace_id = w.id)
  AND NOT EXISTS (SELECT 1 FROM pomodoro_session s WHERE s.workspace_id = w.id);
