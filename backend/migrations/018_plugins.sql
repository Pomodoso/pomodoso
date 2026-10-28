-- Plugins: declarative YAML mini-apps the user installs (a quit-smoking
-- tracker, a year in pixels, a reading list…) and the records they keep.
--
-- User-scoped, like habit and achievement (spec rule 6's exemption list): a
-- plugin is personal, not a work context, so it syncs outside the workspace
-- loop. Keyed by (user_id, id) for the reason achievement is: ids are
-- client-generated, and a global key would let one account claim an id it saw
-- in a shared profile or an exported plugin file.
--
-- Two clocks, kept apart. `updated_at` is the client's edit time and only
-- decides last-write-wins, so it is never overwritten by the server (these
-- tables don't use set_updated_at, which stamps NOW() over it).
-- `server_updated_at` is when the row last changed on the server, written by
-- the trigger below; incremental pulls filter on it, so an offline edit
-- uploaded late still reaches devices that pulled in between.
--
-- The manifest is stored as the client validated it (the same zod schema runs
-- on every client). The server doesn't interpret it: it only stores and
-- returns it, so a plugin is data here, never code.
CREATE TABLE IF NOT EXISTS plugin (
  id                   UUID        NOT NULL,
  user_id              UUID        NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  -- The file's own id (`id: quit-smoking`). Not unique: two devices can
  -- install the same plugin offline, and dropping one of them on sync would
  -- lose its records. The client keeps one live install per slug.
  slug                 TEXT        NOT NULL,
  -- 'file' today; 'directory' once installs come from the public directory.
  source               TEXT        NOT NULL DEFAULT 'file',
  -- The directory version it came from. No FK yet: the directory tables land
  -- with the directory itself.
  directory_version_id UUID,
  manifest             JSONB       NOT NULL,
  -- The user's values for the plugin's settings, plus edited select options
  -- and the Today switch (reserved keys).
  settings             JSONB       NOT NULL DEFAULT '{}'::jsonb,
  enabled              BOOLEAN     NOT NULL DEFAULT TRUE,
  auto_update          BOOLEAN     NOT NULL DEFAULT FALSE,
  -- Local day of install: where `taper` starts and how far back `streak`
  -- looks. A calendar date, as the client saw it.
  installed_on         DATE        NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  server_updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at           TIMESTAMPTZ,
  synced_at            TIMESTAMPTZ,
  PRIMARY KEY (user_id, id)
);

CREATE OR REPLACE FUNCTION set_server_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.server_updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE INDEX IF NOT EXISTS plugin_pull_idx ON plugin(user_id, server_updated_at);

DROP TRIGGER IF EXISTS set_server_updated_at_plugin ON plugin;
CREATE TRIGGER set_server_updated_at_plugin
  BEFORE INSERT OR UPDATE ON plugin
  FOR EACH ROW EXECUTE FUNCTION set_server_updated_at();

-- One record of one of a plugin's collections: a cigarette, a book, a day's
-- state. Daily records have a deterministic id (UUIDv5 of plugin, collection
-- and day), so the same day saved on two devices is one row and LWW decides.
CREATE TABLE IF NOT EXISTS plugin_record (
  id          UUID        NOT NULL,
  user_id     UUID        NOT NULL,
  plugin_id   UUID        NOT NULL,
  -- The collection key from the manifest ('cigarette', 'book', ...).
  collection  TEXT        NOT NULL,
  -- Daily collections only: the local day the record is about.
  day         DATE,
  -- Event collections only: when it happened.
  occurred_at TIMESTAMPTZ,
  data        JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  server_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at  TIMESTAMPTZ,
  synced_at   TIMESTAMPTZ,
  PRIMARY KEY (user_id, id),
  -- Same-user FK: a record can only hang off the pushing user's own plugin.
  FOREIGN KEY (user_id, plugin_id) REFERENCES plugin(user_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS plugin_record_pull_idx ON plugin_record(user_id, server_updated_at);
CREATE INDEX IF NOT EXISTS plugin_record_plugin_idx ON plugin_record(user_id, plugin_id, collection);

DROP TRIGGER IF EXISTS set_server_updated_at_plugin_record ON plugin_record;
CREATE TRIGGER set_server_updated_at_plugin_record
  BEFORE INSERT OR UPDATE ON plugin_record
  FOR EACH ROW EXECUTE FUNCTION set_server_updated_at();
