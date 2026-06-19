-- Sync gaps found in two-device testing:
--   1. Task-detection rules never synced — they live only in each install's
--      IndexedDB. Make them a user-scoped, syncable entity.
--   2. project.end_date and habit unit/unitAmount were dropped by sync, so those
--      fields looked wrong/empty on a second device.

-- Detection rules are user-global config (not workspace-scoped). Their ids are
-- stable string keys ('r-linear', 'r-github', …) so identical presets seeded on
-- every install converge to the same row — hence TEXT id, not UUID.
CREATE TABLE IF NOT EXISTS detection_rule (
  id          TEXT        NOT NULL,
  user_id     UUID        NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL DEFAULT '',
  url_pattern TEXT        NOT NULL DEFAULT '',
  active      BOOLEAN     NOT NULL DEFAULT true,
  kind        TEXT        NOT NULL DEFAULT 'custom' CHECK (kind IN ('preset', 'custom')),
  preset_id   TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at  TIMESTAMPTZ,
  synced_at   TIMESTAMPTZ,
  PRIMARY KEY (user_id, id)
);

-- Project end date (client ProjectRow.endDate).
ALTER TABLE project ADD COLUMN IF NOT EXISTS end_date DATE;

-- Extra client-side habit fields (unit, unitAmount, …) round-trip through a
-- single JSONB column, mirroring task.extra — the server stays field-agnostic.
ALTER TABLE habit ADD COLUMN IF NOT EXISTS extra JSONB NOT NULL DEFAULT '{}'::jsonb;
