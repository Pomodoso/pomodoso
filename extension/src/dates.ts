// Pure date helpers, split out of db.ts so modules that only need the
// arithmetic don't drag Dexie in with it. reports.ts is the reason: importing
// db.ts there would pull a database that wants IndexedDB into a plain Node
// test run. db.ts re-exports localDate, so existing callers are unaffected.

/** YYYY-MM-DD in the given IANA timezone (e.g. 'America/Argentina/Buenos_Aires').
 *  daysOffset shifts by that many days before formatting (negative = past). */
export function localDate(tz: string, daysOffset = 0): string {
  const d = daysOffset ? new Date(Date.now() + daysOffset * 86400_000) : new Date();
  return d.toLocaleDateString('en-CA', { timeZone: tz });
}
