-- Calendar meetings were extension-only (Google Calendar → local IndexedDB).
-- Make them a syncable, workspace-scoped entity so they appear on the web and
-- converge across devices (mirrors task/project).

CREATE TABLE IF NOT EXISTS meeting (
  id               UUID        PRIMARY KEY,
  workspace_id     UUID        NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  title            TEXT        NOT NULL DEFAULT '',
  time             TIMESTAMPTZ NOT NULL,
  duration_minutes INTEGER     NOT NULL DEFAULT 0,
  logged_minutes   INTEGER,
  logged           BOOLEAN     NOT NULL DEFAULT false,
  track_mode       TEXT        NOT NULL DEFAULT 'once',
  project_id       UUID,
  google_event_id  TEXT,
  -- notes, description, recurringEventId, recurringLabel ride here (like task.extra)
  extra            JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at       TIMESTAMPTZ,
  synced_at        TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS meeting_ws_time_idx ON meeting(workspace_id, time);
