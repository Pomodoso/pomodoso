-- Earned achievements, stored rather than derived.
--
-- Deriving the count from completed challenges was the cheaper option and the
-- wrong one: "Go again" clears the run's completion so the habit can start
-- another, which would quietly decrement a badge the user had already earned.
-- An award is a historical fact, so it gets its own append-only row.
--
-- User-scoped, like habit and detection_rule (spec rule 6's exemption list):
-- an achievement belongs to the person, not to a work context.
CREATE TABLE IF NOT EXISTS achievement (
  id           UUID        PRIMARY KEY,
  user_id      UUID        NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  -- 'challenge_21' today. Kept as free text rather than an enum so a new badge
  -- ships without a migration on a table that is pure history.
  kind         TEXT        NOT NULL,
  -- Local date the award was earned, as the client saw it. Not a timestamp:
  -- "which day did I finish" is a calendar question, and the client's timezone
  -- is what answers it.
  earned_on    DATE        NOT NULL,
  -- The habit whose run earned it. Nullable and ON DELETE SET NULL: deleting a
  -- habit must not erase the achievement it produced.
  habit_id     UUID        REFERENCES habit(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at   TIMESTAMPTZ,
  synced_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS achievement_user_idx ON achievement(user_id);

DROP TRIGGER IF EXISTS set_updated_at_achievement ON achievement;
CREATE TRIGGER set_updated_at_achievement
  BEFORE UPDATE ON achievement
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
