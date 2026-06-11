-- Per-user key-value store: settings sync + active timer beacon
CREATE TABLE IF NOT EXISTS user_setting (
  user_id    UUID        NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  key        TEXT        NOT NULL,
  value      JSONB       NOT NULL DEFAULT 'null',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  PRIMARY KEY (user_id, key)
);

CREATE INDEX IF NOT EXISTS user_setting_user_idx ON user_setting(user_id);

DROP TRIGGER IF EXISTS set_updated_at_user_setting ON user_setting;
CREATE TRIGGER set_updated_at_user_setting
  BEFORE UPDATE ON user_setting
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
