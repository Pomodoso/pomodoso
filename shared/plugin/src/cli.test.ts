import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { format, validate } from './cli.ts';

const example = (name: string) => readFileSync(new URL(`../../types/src/plugins/examples/${name}.yaml`, import.meta.url), 'utf8');

test('a valid file passes; a broken one says where and what', () => {
  assert.deepEqual(validate(example('bookshelf')), { ok: true, issues: [] });
  const broken = example('bookshelf').replace('type: board', 'type: bord');
  const r = validate(broken);
  assert.equal(r.ok, false);
  assert.match(format('bookshelf.yaml', r), /views\[0\]\.blocks\[2\]\.type: unknown type "bord"; did you mean "board"\?/);
});

test('--against classifies the update and blocks a breaking one without migrate', () => {
  const v1 = example('bookshelf');
  const additive = v1.replace('version: 1.0.0', 'version: 1.1.0').replace(/description: .*/, 'description: Better.');
  let r = validate(additive, v1);
  assert.equal(r.ok, true);
  assert.equal(r.update?.kind, 'additive');

  const renamed = v1.replace('version: 1.0.0', 'version: 1.1.0').replace('key: author', 'key: writer').replace('subtitle: author', 'subtitle: writer');
  r = validate(renamed, v1);
  assert.equal(r.ok, false);
  assert.equal(r.update?.kind, 'breaking');
  assert.match(format('v2.yaml', r), /new major version: 2\.0\.0/);
});

test('the bin exits 0, 1 and 2, and --json prints the result', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pomodoso-plugin-'));
  const good = join(dir, 'good.yaml');
  const bad = join(dir, 'bad.yaml');
  writeFileSync(good, example('reading-list'));
  writeFileSync(bad, 'schema_version: 1\nid: x\n');
  const run = (...args: string[]) => {
    try {
      return { code: 0, out: execFileSync('node', ['--experimental-strip-types', new URL('./cli.ts', import.meta.url).pathname, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
    } catch (e) {
      const err = e as { status: number; stdout: string };
      return { code: err.status, out: err.stdout };
    }
  };
  assert.equal(run('validate', good).code, 0);
  const failed = run('validate', bad, '--json');
  assert.equal(failed.code, 1);
  assert.equal(JSON.parse(failed.out).ok, false);
  assert.equal(run('nope').code, 2);
});
