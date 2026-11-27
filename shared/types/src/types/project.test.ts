import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectArchived, projectArchiveEndDate } from './project.ts';

test('a project is archived only after its end date', () => {
  assert.equal(projectArchived(undefined, '2026-11-27'), false);
  assert.equal(projectArchived(null, '2026-11-27'), false);
  assert.equal(projectArchived('2026-11-27', '2026-11-27'), false);
  assert.equal(projectArchived('2026-11-28', '2026-11-27'), false);
  assert.equal(projectArchived('2026-11-26', '2026-11-27'), true);
});

test('archiving ends the project yesterday, so it is archived today', () => {
  const end = projectArchiveEndDate('2026-03-01');
  assert.equal(end, '2026-02-28');
  assert.equal(projectArchived(end, '2026-03-01'), true);
});
