CREATE TABLE IF NOT EXISTS workspace (
  id          UUID        PRIMARY KEY,
  owner_id    UUID        NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  color       TEXT        NOT NULL DEFAULT '#6366f1',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at  TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS workspace_member (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID        NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  user_id      UUID        NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  role         TEXT        NOT NULL DEFAULT 'owner' CHECK (role IN ('owner')),
  joined_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, user_id)
);

CREATE INDEX IF NOT EXISTS workspace_owner_idx ON workspace(owner_id);
CREATE INDEX IF NOT EXISTS workspace_member_user_idx ON workspace_member(user_id);
