import { formatDuration, type ReportModel } from './reports.ts';

// Spec 6.6: "Export formats: Markdown, Slack-friendly, copy to clipboard.
// Fixed template in MVP, configurable in later phase." Both are pure
// string-building over a ReportModel, so they're tested without a clipboard.
//
// The two differ for a reason. Markdown targets somewhere that renders it —
// a PR description, a doc — so it uses headings and tables. Slack's message
// composer renders neither: a table arrives as a wall of pipes. It gets
// bullets and bold instead, which is what actually survives being pasted.

export type ReportFormat = 'markdown' | 'slack';

function rangeLabel(report: ReportModel): string {
  if (report.range === 'today') return report.from;
  return `${report.from} → ${report.to}`;
}

function headline(report: ReportModel): string {
  const parts = [
    `${report.pomos} pomo${report.pomos === 1 ? '' : 's'}`,
    formatDuration(report.focusSeconds),
    `${report.tasksCompleted} task${report.tasksCompleted === 1 ? '' : 's'} completed`,
  ];
  if (report.meetingsCount > 0) {
    parts.push(`${report.meetingsCount} meeting${report.meetingsCount === 1 ? '' : 's'} (${formatDuration(report.meetingSeconds)})`);
  }
  return parts.join(' · ');
}

/** The ticket reference if the task has one, else its title — the line's
 *  most recognisable handle in a standup. */
function lineLabel(line: ReportModel['lines'][number]): string {
  return line.ticketId ? `${line.ticketId} — ${line.title}` : line.title;
}

/** Escapes a value going into a markdown table cell. A raw pipe in a task
 *  title would otherwise open a phantom column and shift every cell after it
 *  — the row still renders, just wrong, which is the kind of breakage nobody
 *  reports. Slack needs none of this: it has no table to break. */
function cell(value: string): string {
  return value.replace(/\|/g, '\\|');
}

function toMarkdown(report: ReportModel): string {
  const out: string[] = [`## Pomodoso — ${rangeLabel(report)}`, '', headline(report), ''];

  if (report.lines.length === 0) {
    out.push('_No time logged in this range._');
    return out.join('\n');
  }

  // Skipped for a single-day report: one project heading over the whole list
  // is noise, and "today" is the view where the flat list is the point.
  if (report.range !== 'today' && report.byProject.length > 0) {
    out.push('### By project', '');
    out.push('| Project | Time | Pomos |', '| --- | --- | --- |');
    for (const p of report.byProject) {
      out.push(`| ${cell(p.name)} | ${formatDuration(p.focusSeconds)} | ${p.pomos} |`);
    }
    out.push('');
  }

  out.push('### Tickets', '');
  out.push('| Item | Status | Time | Pomos |', '| --- | --- | --- | --- |');
  for (const line of report.lines) {
    out.push(`| ${cell(lineLabel(line))} | ${line.status} | ${formatDuration(line.focusSeconds)} | ${line.pomos} |`);
  }
  return out.join('\n');
}

function toSlack(report: ReportModel): string {
  const out: string[] = [`*Pomodoso — ${rangeLabel(report)}*`, headline(report), ''];

  if (report.lines.length === 0) {
    out.push('_No time logged in this range._');
    return out.join('\n');
  }

  if (report.range !== 'today' && report.byProject.length > 0) {
    out.push('*By project*');
    for (const p of report.byProject) {
      out.push(`• ${p.name} — ${formatDuration(p.focusSeconds)} (${p.pomos} pomo${p.pomos === 1 ? '' : 's'})`);
    }
    out.push('');
  }

  out.push('*Tickets*');
  for (const line of report.lines) {
    out.push(`• ${lineLabel(line)} — ${formatDuration(line.focusSeconds)} · ${line.status}`);
  }
  return out.join('\n');
}

export function formatReport(report: ReportModel, format: ReportFormat): string {
  return format === 'slack' ? toSlack(report) : toMarkdown(report);
}
