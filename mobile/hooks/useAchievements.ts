import { isNull } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';

import { db } from '@/db/client';
import { achievements } from '@/db/schema';

/**
 * Earned achievements, counted per kind.
 *
 * Counts rather than booleans, because the `xN` chip and the tier both come
 * from the same number.
 */
export function useAchievements() {
  const { data } = useLiveQuery(
    db.select().from(achievements).where(isNull(achievements.deletedAt)),
  );
  const rows = data ?? [];
  // Counted per kind rather than for one hard-coded kind: `kind` is free text
  // on the wire so a new badge ships without a migration, and a medal awarded
  // by a newer client must not be invisible here.
  const counts = new Map<string, number>();
  for (const a of rows) counts.set(a.kind, (counts.get(a.kind) ?? 0) + 1);
  return { rows, counts };
}
