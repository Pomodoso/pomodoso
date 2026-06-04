-- Projects
CREATE TABLE IF NOT EXISTS project (
  id           UUID        PRIMARY KEY,
  workspace_id UUID        NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  name         TEXT        NOT NULL,
  color        TEXT        NOT NULL DEFAULT '#6366f1',
  archived_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at   TIMESTAMPTZ,
  synced_at    TIMESTAMPTZ
);

-- Tasks
CREATE TABLE IF NOT EXISTS task (
  id             UUID        PRIMARY KEY,
  workspace_id   UUID        NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  title          TEXT        NOT NULL,
  is_priority    BOOLEAN     NOT NULL DEFAULT FALSE,
  ticket_id      UUID,
  scheduled_for  DATE        NOT NULL,
  completed_at   TIMESTAMPTZ,
  notes          TEXT        NOT NULL DEFAULT '',
  position       INTEGER     NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at     TIMESTAMPTZ,
  synced_at      TIMESTAMPTZ
);

-- Habits
CREATE TABLE IF NOT EXISTS habit (
  id              UUID        PRIMARY KEY,
  workspace_id    UUID        NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  name            TEXT        NOT NULL,
  icon            TEXT        NOT NULL DEFAULT '✓',
  kind            TEXT        NOT NULL DEFAULT 'boolean' CHECK (kind IN ('boolean', 'counter')),
  target_count    INTEGER,
  frequency       TEXT        NOT NULL DEFAULT 'daily'
                    CHECK (frequency IN ('daily', 'weekdays', 'custom')),
  frequency_days  TEXT,
  position        INTEGER     NOT NULL DEFAULT 0,
  archived_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ,
  synced_at       TIMESTAMPTZ
);

-- Habit logs
CREATE TABLE IF NOT EXISTS habit_log (
  id           UUID        PRIMARY KEY,
  habit_id     UUID        NOT NULL REFERENCES habit(id) ON DELETE CASCADE,
  workspace_id UUID        NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  date         DATE        NOT NULL,
  value        INTEGER     NOT NULL DEFAULT 0,
  completed_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  synced_at    TIMESTAMPTZ,
  UNIQUE (habit_id, date)
);

-- Pomodoro sessions
CREATE TABLE IF NOT EXISTS pomodoro_session (
  id                       UUID        PRIMARY KEY,
  workspace_id             UUID        NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  task_id                  UUID,
  ticket_id                UUID,
  mode                     TEXT        NOT NULL CHECK (mode IN ('pomodoro', 'stopwatch', 'manual')),
  started_at               TIMESTAMPTZ NOT NULL,
  ended_at                 TIMESTAMPTZ,
  planned_duration_seconds INTEGER,
  actual_duration_seconds  INTEGER     NOT NULL DEFAULT 0,
  kind                     TEXT        NOT NULL CHECK (kind IN ('focus', 'break_short', 'break_long')),
  status                   TEXT        NOT NULL CHECK (status IN ('active', 'completed', 'interrupted', 'cancelled')),
  note                     TEXT        NOT NULL DEFAULT '',
  device_id                TEXT        NOT NULL DEFAULT '',
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  synced_at                TIMESTAMPTZ
);

-- Indexes
CREATE INDEX IF NOT EXISTS project_workspace_idx  ON project(workspace_id)  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS task_workspace_idx      ON task(workspace_id)     WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS task_scheduled_idx      ON task(workspace_id, scheduled_for);
CREATE INDEX IF NOT EXISTS habit_workspace_idx     ON habit(workspace_id)    WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS habit_log_habit_idx     ON habit_log(habit_id, date);
CREATE INDEX IF NOT EXISTS pomo_workspace_idx      ON pomodoro_session(workspace_id);
CREATE INDEX IF NOT EXISTS pomo_started_idx        ON pomodoro_session(workspace_id, started_at);

-- updated_at trigger helper
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_updated_at_project ON project;
CREATE TRIGGER set_updated_at_project
  BEFORE UPDATE ON project
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_task ON task;
CREATE TRIGGER set_updated_at_task
  BEFORE UPDATE ON task
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_habit ON habit;
CREATE TRIGGER set_updated_at_habit
  BEFORE UPDATE ON habit
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_habit_log ON habit_log;
CREATE TRIGGER set_updated_at_habit_log
  BEFORE UPDATE ON habit_log
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_pomodoro_session ON pomodoro_session;
CREATE TRIGGER set_updated_at_pomodoro_session
  BEFORE UPDATE ON pomodoro_session
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
