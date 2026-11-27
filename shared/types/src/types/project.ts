// Project archiving, shared by the extension and mobile.
//
// A project has no archived flag: it has an optional end date, the last day it
// is active (`project.end_date` on the server). After that day it is archived:
// hidden from the project pickers, while tasks that already point at it keep
// showing it. So archiving is "end it yesterday" and unarchiving is "no end
// date", and both clients have to agree on that arithmetic or a project
// archived on one would still show as active on the other.

/** A local YYYY-MM-DD shifted by n days. Midday avoids DST edges. */
function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString('en-CA');
}

/** Whether a project with this end date is archived on `today` (YYYY-MM-DD). */
export function projectArchived(endDate: string | null | undefined, today: string): boolean {
  return Boolean(endDate) && endDate! < today;
}

/** The end date that archives a project as of `today`: the day before. */
export function projectArchiveEndDate(today: string): string {
  return addDays(today, -1);
}
