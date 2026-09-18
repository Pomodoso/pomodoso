import { isNull } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';

import { db } from '@/db/client';
import { achievements } from '@/db/schema';

/**
 * Earned achievements, counted per kind.
 *
 * Only `challenge_21` exists today; the hook returns the count rather than a
 * boolean so the `xN` chip and the tier both come from one number.
 */
export function useAchievements() {
  const { data } = useLiveQuery(
    db.select().from(achievements).where(isNull(achievements.deletedAt)),
  );
  const rows = data ?? [];
  return {
    rows,
    count: rows.filter(a => a.kind === 'challenge_21').length,
  };
}
