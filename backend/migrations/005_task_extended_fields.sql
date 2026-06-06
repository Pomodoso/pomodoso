-- Extend task table with fields the extension tracks
ALTER TABLE task
  ADD COLUMN IF NOT EXISTS status      TEXT    NOT NULL DEFAULT 'todo'
    CHECK (status IN ('todo','in_progress','done','delayed','cancelled')),
  ADD COLUMN IF NOT EXISTS project_id  UUID    REFERENCES project(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS parent_id   UUID    REFERENCES task(id)    ON DELETE SET NULL;

-- Make scheduled_for nullable (extension tasks don't always have a date)
ALTER TABLE task ALTER COLUMN scheduled_for DROP NOT NULL;

-- Workspace needs synced_at for sync tracking
ALTER TABLE workspace ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ;

-- Extra indexes
CREATE INDEX IF NOT EXISTS task_project_idx ON task(project_id) WHERE project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS task_parent_idx  ON task(parent_id)  WHERE parent_id  IS NOT NULL;

-- Trigger for workspace updated_at
DROP TRIGGER IF EXISTS set_updated_at_workspace ON workspace;
CREATE TRIGGER set_updated_at_workspace
  BEFORE UPDATE ON workspace
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
