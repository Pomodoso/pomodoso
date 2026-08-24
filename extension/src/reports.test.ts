import assert from 'node:assert/strict';
import { test } from 'node:test';

import { formatReport } from './reportFormat.ts';
import { buildReport, formatDuration, getEffectiveDate, type ReportInput } from './reports.ts';

// Fixed dates throughout: a report is arithmetic over days, so anything
// derived from "now" would make these pass or fail depending on when they run.
const FROM = '2026-08-17';
const TO = '2026-08-24';

function log(day: string, minutes: number, mode: 'pomodoro' | 'stopwatch' = 'pomodoro') {
  return { id: `log-${day}-${minutes}-${mode}`, startedAt: `${day}T09:00:00.000Z`, durationSeconds: minutes * 60, mode };
}

function task(over: Partial<ReportInput['tasks'][number]> = {}) {
  return {
    id: 'task-1',
    title: 'Fix the thing',
    ticketId: null,
    projectId: null,
    workspaceId: 'ws-1',
    status: 'todo' as const,
    updatedAt: `${TO}T10:00:00.000Z`,
    timeLogs: [],
    ...over,
  } as ReportInput['tasks'][number];
}

function input(over: Partial<ReportInput> = {}): ReportInput {
  return { tasks: [], projects: [], meetings: [], range: 'week', from: FROM, to: TO, ...over };
}

// ─── Range filtering ──────────────────────────────────────────────────────────

test('counts only time logged inside the range', () => {
  const report = buildReport(input({
    tasks: [task({ timeLogs: [log('2026-08-16', 30), log('2026-08-20', 25), log('2026-08-25', 45)] })],
  }));
  assert.equal(report.focusSeconds, 25 * 60, 'the day before and the day after must both be excluded');
});

test('range boundaries are inclusive on both ends', () => {
  const report = buildReport(input({
    tasks: [task({ timeLogs: [log(FROM, 10), log(TO, 20)] })],
  }));
  assert.equal(report.focusSeconds, 30 * 60);
});

test('a task with no time in range produces no line', () => {
  const report = buildReport(input({ tasks: [task({ timeLogs: [log('2026-01-01', 60)] })] }));
  assert.deepEqual(report.lines, []);
  assert.equal(report.focusSeconds, 0);
});

// ─── Pomo counting ────────────────────────────────────────────────────────────

test('pomos count pomodoro logs only, while time counts every mode', () => {
  const report = buildReport(input({
    tasks: [task({ timeLogs: [log('2026-08-20', 25, 'pomodoro'), log('2026-08-21', 40, 'stopwatch')] })],
  }));
  assert.equal(report.pomos, 1, 'stopwatch time is real work but not a pomodoro');
  assert.equal(report.focusSeconds, 65 * 60);
});

// ─── Completed tasks ──────────────────────────────────────────────────────────

test('counts a task completed in range even with no time logged there', () => {
  // Finishing something is worth reporting whether or not the work happened
  // in this window — which is why it is counted separately from the lines.
  const report = buildReport(input({
    tasks: [task({ status: 'done', timeLogs: [], updatedAt: `2026-08-20T10:00:00.000Z` })],
  }));
  assert.equal(report.tasksCompleted, 1);
  assert.deepEqual(report.lines, [], 'and still contributes no line');
});

test('a task completed outside the range is not counted', () => {
  const report = buildReport(input({
    tasks: [task({ status: 'done', updatedAt: '2026-07-01T10:00:00.000Z' })],
  }));
  assert.equal(report.tasksCompleted, 0);
});

test('an unfinished task is never counted as completed', () => {
  const report = buildReport(input({
    tasks: [task({ status: 'in_progress', timeLogs: [log('2026-08-20', 25)] })],
  }));
  assert.equal(report.tasksCompleted, 0);
  assert.equal(report.lines.length, 1, 'but it does show up as worked-on');
});

// ─── Grouping ─────────────────────────────────────────────────────────────────

test('groups by project and sorts the heaviest first', () => {
  const report = buildReport(input({
    projects: [
      { id: 'p1', name: 'Alpha', color: '#f00', updatedAt: TO },
      { id: 'p2', name: 'Beta', color: '#0f0', updatedAt: TO },
    ] as ReportInput['projects'],
    tasks: [
      task({ id: 't1', projectId: 'p1', timeLogs: [log('2026-08-18', 25)] }),
      task({ id: 't2', projectId: 'p2', timeLogs: [log('2026-08-19', 50)] }),
      task({ id: 't3', projectId: 'p1', timeLogs: [log('2026-08-20', 25)] }),
    ],
  }));
  assert.deepEqual(
    report.byProject.map(p => [p.name, p.focusSeconds / 60, p.pomos]),
    [['Beta', 50, 1], ['Alpha', 50, 2]],
    'Beta first on a tie only because it was inserted first — both total 50m',
  );
});

test('tasks without a project group under a single "No project"', () => {
  const report = buildReport(input({
    tasks: [
      task({ id: 't1', projectId: null, timeLogs: [log('2026-08-18', 10)] }),
      task({ id: 't2', projectId: null, timeLogs: [log('2026-08-19', 20)] }),
    ],
  }));
  assert.equal(report.byProject.length, 1);
  assert.equal(report.byProject[0]?.name, 'No project');
  assert.equal(report.byProject[0]?.focusSeconds, 30 * 60);
});

test('a project deleted since the work happened still groups, unnamed', () => {
  const report = buildReport(input({
    projects: [],
    tasks: [task({ projectId: 'gone', timeLogs: [log('2026-08-18', 15)] })],
  }));
  assert.equal(report.byProject[0]?.name, 'No project', 'rather than dropping the time entirely');
  assert.equal(report.focusSeconds, 15 * 60);
});

test('lines are sorted by time spent, heaviest first', () => {
  const report = buildReport(input({
    tasks: [
      task({ id: 'small', title: 'Small', timeLogs: [log('2026-08-18', 5)] }),
      task({ id: 'big', title: 'Big', timeLogs: [log('2026-08-19', 90)] }),
    ],
  }));
  assert.deepEqual(report.lines.map(l => l.title), ['Big', 'Small']);
});

// ─── Meetings ─────────────────────────────────────────────────────────────────

test('counts only logged meetings inside the range', () => {
  const report = buildReport(input({
    meetings: [
      { id: 'm1', time: '2026-08-19T10:00:00.000Z', logged: true, loggedMinutes: 30, updatedAt: TO },
      { id: 'm2', time: '2026-08-19T14:00:00.000Z', logged: false, loggedMinutes: 60, updatedAt: TO },
      { id: 'm3', time: '2026-07-01T10:00:00.000Z', logged: true, loggedMinutes: 45, updatedAt: TO },
    ] as ReportInput['meetings'],
  }));
  assert.equal(report.meetingsCount, 1, 'unlogged and out-of-range meetings both excluded');
  assert.equal(report.meetingSeconds, 30 * 60);
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

test('getEffectiveDate prefers the last logged day over updatedAt', () => {
  assert.equal(
    getEffectiveDate({ updatedAt: '2026-08-24T10:00:00.000Z', timeLogs: [log('2026-08-18', 10), log('2026-08-20', 10)] }),
    '2026-08-20',
  );
});

test('getEffectiveDate falls back to updatedAt with nothing logged', () => {
  assert.equal(getEffectiveDate({ updatedAt: '2026-08-24T10:00:00.000Z', timeLogs: [] }), '2026-08-24');
});

test('formatDuration drops the hour part below an hour', () => {
  assert.equal(formatDuration(0), '0m');
  assert.equal(formatDuration(59), '0m');
  assert.equal(formatDuration(25 * 60), '25m');
  assert.equal(formatDuration(3600), '1h 0m');
  assert.equal(formatDuration(5100), '1h 25m');
});

// ─── Formatting ───────────────────────────────────────────────────────────────

const SAMPLE = buildReport(input({
  projects: [{ id: 'p1', name: 'Alpha', color: '#f00', updatedAt: TO }] as ReportInput['projects'],
  tasks: [task({ ticketId: 'POM-89', projectId: 'p1', status: 'done', timeLogs: [log('2026-08-20', 25)] })],
}));

test('markdown leads with the range and the headline numbers', () => {
  const md = formatReport(SAMPLE, 'markdown');
  assert.match(md, /^## Pomodoso — 2026-08-17 → 2026-08-24/);
  assert.match(md, /1 pomo · 25m · 1 task completed/);
});

test('markdown uses tables and the ticket reference', () => {
  const md = formatReport(SAMPLE, 'markdown');
  assert.match(md, /\| Project \| Time \| Pomos \|/);
  assert.match(md, /POM-89 — Fix the thing/);
});

test('slack uses bullets, never tables', () => {
  // Slack's composer renders no markdown table — one pasted arrives as a wall
  // of pipes, which is the whole reason these are two formats.
  const slack = formatReport(SAMPLE, 'slack');
  assert.ok(!slack.includes('|'), 'a pipe here means a table leaked into the Slack format');
  assert.match(slack, /^\*Pomodoso — /);
  assert.match(slack, /• POM-89 — Fix the thing/);
});

test('a single-day report skips the project breakdown', () => {
  const today = buildReport(input({
    range: 'today',
    from: TO,
    to: TO,
    projects: [{ id: 'p1', name: 'Alpha', color: '#f00', updatedAt: TO }] as ReportInput['projects'],
    tasks: [task({ projectId: 'p1', timeLogs: [log(TO, 25)] })],
  }));
  assert.ok(!formatReport(today, 'markdown').includes('By project'));
  assert.ok(!formatReport(today, 'slack').includes('By project'));
});

test('both formats say so plainly when nothing was logged', () => {
  const empty = buildReport(input());
  for (const format of ['markdown', 'slack'] as const) {
    assert.match(formatReport(empty, format), /No time logged in this range/, `for ${format}`);
  }
});

test('a title containing a pipe cannot break the markdown table', () => {
  const risky = buildReport(input({
    tasks: [task({ title: 'Fix a | b parsing', timeLogs: [log('2026-08-20', 25)] })],
  }));
  const row = formatReport(risky, 'markdown').split('\n').find(l => l.includes('parsing')) ?? '';
  assert.match(row, /Fix a \\\| b parsing/, 'the pipe inside the title must be escaped');
  // Count only structural pipes — an escaped one is still the character `|`,
  // so dropping those first is what actually measures the column count.
  const structural = row.replace(/\\\|/g, '').split('|').length - 1;
  assert.equal(structural, 5, 'a raw pipe in the title would add a phantom column');
});
