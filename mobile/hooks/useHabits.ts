import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { eq } from 'drizzle-orm';

import { db } from '@/db/client';
import { habits } from '@/db/schema';

export function useHabits() {
  const { data } = useLiveQuery(db.select().from(habits).orderBy(habits.sortOrder));

  function toggleHabit(id: string, done: boolean): void {
    db.update(habits).set({ done }).where(eq(habits.id, id)).run();
  }

  return { habits: data ?? [], toggleHabit };
}
