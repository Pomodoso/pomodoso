-- Habits are personal, not work-context — they should not be tied to a workspace.
-- Make habit + habit_log user-scoped (like user_setting / detection_rule).
-- Spec rule 6 ("workspaces own everything") is amended to exempt habits.

-- habit
ALTER TABLE habit ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES "user"(id) ON DELETE CASCADE;
UPDATE habit h
   SET user_id = w.owner_id
  FROM workspace w
 WHERE w.id = h.workspace_id
   AND h.user_id IS NULL;
ALTER TABLE habit ALTER COLUMN workspace_id DROP NOT NULL;
CREATE INDEX IF NOT EXISTS habit_user_idx ON habit(user_id);

-- habit_log
ALTER TABLE habit_log ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES "user"(id) ON DELETE CASCADE;
UPDATE habit_log hl
   SET user_id = h.user_id
  FROM habit h
 WHERE h.id = hl.habit_id
   AND hl.user_id IS NULL;
ALTER TABLE habit_log ALTER COLUMN workspace_id DROP NOT NULL;
CREATE INDEX IF NOT EXISTS habit_log_user_idx ON habit_log(user_id);
