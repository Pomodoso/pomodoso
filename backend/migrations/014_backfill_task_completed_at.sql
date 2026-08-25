-- Freeze a completion date for tasks that lost theirs.
--
-- Mobile pushed `completed_at: null` for every task (it had no such column and
-- hardcoded the field), and the task upsert assigned EXCLUDED.completed_at
-- unconditionally, so each sync erased the column account-wide. The web's Today
-- view then fell back to `COALESCE(completed_at, updated_at)` and, because the
-- same sync had just bumped updated_at, reported nearly every finished task as
-- completed today.
--
-- The overwrite is fixed at the source (sync.rs now COALESCEs), but the rows
-- already nulled need something. `updated_at` is the same guess the fallback was
-- already making — the difference is that writing it down stops it drifting
-- every time the row is touched again.
--
-- This is deliberately a guess, and it is wrong for any task edited after it was
-- finished. The real dates are gone from the server; a client that still holds
-- its own `completedAt` locally (the extension keeps one) will overwrite this
-- with the true value the next time that row syncs, because COALESCE prefers a
-- non-null incoming value.
--
-- Only touches rows that are already resolved and already null, so it cannot
-- move a date that survived.

UPDATE task
SET completed_at = updated_at
WHERE completed_at IS NULL
  AND status IN ('done', 'cancelled')
  AND deleted_at IS NULL;
