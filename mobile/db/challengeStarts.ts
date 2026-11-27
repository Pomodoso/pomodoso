// Start dates for challenges that predate recorded runs. Kept free of imports
// so it can be tested with node's runner, without Expo or SQLite.

/** A local YYYY-MM-DD shifted by n days. Midday avoids DST edges. */
function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString('en-CA');
}

/**
 * Where a pre-existing challenge's run began: the start of the streak it is
 * on. Walks back over scheduled days while they were done; a habit with no
 * streak starts today.
 *
 * Today is skipped when it isn't done yet rather than ending the walk: the day
 * isn't over, so a user on day 20 who simply hasn't ticked today must not have
 * their run reset to "starts today".
 *
 * Only right for a challenge that was already running when runs started being
 * recorded. Used on a challenge switched on later, it dates the run from the
 * habit's streak, so days done before the challenge existed count toward it.
 */
export function challengeStartFromStreak(
  today: string,
  scheduled: (date: string) => boolean,
  isDone: (date: string) => boolean,
): string {
  let started = today;
  for (let i = 0; i < 3650; i++) {
    const date = addDays(today, -i);
    if (!scheduled(date)) continue;
    if (!isDone(date)) {
      if (i === 0) continue;
      break;
    }
    started = date;
  }
  return started;
}

export const CHALLENGE_COLUMNS_DDL = [
  'ALTER TABLE habits ADD COLUMN challenge_started_at TEXT;',
  'ALTER TABLE habits ADD COLUMN challenge_completed_at TEXT;',
  "ALTER TABLE habits ADD COLUMN challenge_skipped_days TEXT NOT NULL DEFAULT '[]';",
] as const;

/**
 * Adds the challenge-run columns, and backfills start dates only on the
 * launch that adds them. Returns whether the backfill ran.
 *
 * The backfill used to run on every launch, which made it a second way of
 * stamping a start date: a challenge switched on just before the app closed,
 * or pulled from another device before useHabits stamped it, reached the next
 * launch with no start date and was dated from the habit's existing streak.
 * Any run without a start date after the upgrade is a new one, and useHabits
 * starts it today.
 *
 * `exec` throws when a column is already there, as SQLite's ALTER TABLE does.
 */
export function migrateChallengeColumns(exec: (sql: string) => void, backfill: () => void): boolean {
  let added = false;
  for (const ddl of CHALLENGE_COLUMNS_DDL) {
    try {
      exec(ddl);
      if (ddl.includes('challenge_started_at')) added = true;
    } catch {
      /* column already present */
    }
  }
  if (added) backfill();
  return added;
}
