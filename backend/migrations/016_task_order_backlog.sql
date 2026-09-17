-- Backlog ordering.
--
-- priority_ids/today_ids already carry the two Today sections; the Backlog list
-- had no persisted order at all and rendered in whatever order the client's
-- IndexedDB scan returned. backlog_ids gives it the same treatment: a
-- client-owned list of task ids, ordered, with anything missing from it
-- appended at the end (so tasks created elsewhere still show up).
ALTER TABLE task_order ADD COLUMN IF NOT EXISTS backlog_ids JSONB NOT NULL DEFAULT '[]'::jsonb;
