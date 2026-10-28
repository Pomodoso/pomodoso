-- The public plugin directory: plugins people publish so others can install
-- them. Server-side data, never synced (an install becomes a user's own
-- `plugin` row, which is). Ids are server-generated here: nothing is created
-- offline.

-- One per slug: the slug belongs to whoever published it first.
CREATE TABLE IF NOT EXISTS plugin_listing (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug              TEXT        NOT NULL UNIQUE,
  owner_user_id     UUID        NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  -- 'public' shows in search; 'unlisted' opens by link only; 'private' is
  -- visible to its owner alone.
  visibility        TEXT        NOT NULL DEFAULT 'public'
                    CHECK (visibility IN ('public', 'private')),
  -- Copied from the latest version's manifest for listing and search, so a
  -- search never has to open manifests.
  name              TEXT        NOT NULL,
  description       TEXT,
  icon              TEXT,
  author            TEXT,
  has_today         BOOLEAN     NOT NULL DEFAULT FALSE,
  latest_version    TEXT        NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Taken down (by its owner, or after a report). The slug stays taken.
  deleted_at        TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS plugin_listing_owner_idx ON plugin_listing(owner_user_id);
CREATE INDEX IF NOT EXISTS plugin_listing_public_idx ON plugin_listing(updated_at DESC)
  WHERE visibility = 'public' AND deleted_at IS NULL;

DROP TRIGGER IF EXISTS set_updated_at_plugin_listing ON plugin_listing;
CREATE TRIGGER set_updated_at_plugin_listing
  BEFORE UPDATE ON plugin_listing
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Every published version, immutable: a version number is never reused and
-- its manifest never changes, so an install can always be traced to exactly
-- what it installed.
CREATE TABLE IF NOT EXISTS plugin_version (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id  UUID        NOT NULL REFERENCES plugin_listing(id) ON DELETE CASCADE,
  version     TEXT        NOT NULL,
  manifest    JSONB       NOT NULL,
  changelog   TEXT,
  -- How it differs from the previous version, as the publishing client
  -- classified it (checkUpdate in @pomodoso/types). Advisory: clients run
  -- the same check again before offering an update.
  change_kind TEXT        NOT NULL CHECK (change_kind IN ('initial', 'additive', 'breaking')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (listing_id, version)
);

CREATE INDEX IF NOT EXISTS plugin_version_listing_idx ON plugin_version(listing_id, created_at DESC);

-- Reports of a listing's content (spam, offensive text). Resolved by hand.
CREATE TABLE IF NOT EXISTS plugin_report (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id       UUID        NOT NULL REFERENCES plugin_listing(id) ON DELETE CASCADE,
  reporter_user_id UUID        NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  reason           TEXT        NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS plugin_report_open_idx ON plugin_report(created_at) WHERE resolved_at IS NULL;
