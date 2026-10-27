import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import type { PluginRecord } from './compute.ts';
import { checkUpdate } from './diff.ts';
import type { PluginIssue } from './issues.ts';
import type { PluginManifest } from './manifest.ts';
import { applyMigration } from './migrate.ts';
import { parsePluginFile, validatePluginData } from './parse.ts';

type Mutable = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- test fixtures poke at arbitrary paths

const v1 = (() => {
  const r = parsePluginFile(readFileSync(new URL('./examples/bookshelf.yaml', import.meta.url), 'utf8'));
  if (!r.ok) assert.fail(JSON.stringify(r.issues));
  return r.manifest;
})();

/** A valid next version of bookshelf: clone v1, change it, validate it. */
function next(change: (m: Mutable) => void): PluginManifest {
  const m = structuredClone(v1) as Mutable;
  change(m);
  const r = validatePluginData(m);
  if (!r.ok) assert.fail(`next version is invalid:\n${r.issues.map((i) => `  ${i.path}: ${i.message}`).join('\n')}`);
  return r.manifest;
}

const book = (m: Mutable) => m.collections[0];
const fieldOf = (m: Mutable, key: string) => book(m).fields.find((f: Mutable) => f.key === key);
const messages = (issues: PluginIssue[]) => issues.map((i) => i.message).join('\n');

// ─── Additive ───────────────────────────────────────────────────────────────

test('wording and new optional things are additive and publishable', () => {
  const r = checkUpdate(
    v1,
    next((m) => {
      m.version = '1.1.0';
      m.description = 'Your reading, organized.';
      book(m).fields.push({ key: 'pages', type: 'number', optional: true });
      fieldOf(m, 'status').options.push('abandoned');
      fieldOf(m, 'title').label = 'Book title';
    }),
  );
  assert.equal(r.kind, 'additive');
  assert.deepEqual(r.issues, []);
  assert.ok(r.changes.some((c) => c.message === 'new options for "status": abandoned'));
});

test('a new field with a default is additive: old records read the default', () => {
  const r = checkUpdate(v1, next((m) => {
    m.version = '1.1.0';
    book(m).fields.push({ key: 'format', type: 'select', options: ['paper', 'ebook'], default: 'paper' });
  }));
  assert.equal(r.kind, 'additive');
  assert.deepEqual(r.issues, []);
});

test('the version must go up', () => {
  const r = checkUpdate(v1, next((m) => (m.description = 'x')));
  assert.match(messages(r.issues), /version must go up from 1\.0\.0/);
});

test('the id can not change', () => {
  const r = checkUpdate(v1, next((m) => {
    m.version = '1.0.1';
    m.id = 'my-books';
  }));
  assert.match(messages(r.issues), /must keep the id/);
});

// ─── Breaking ───────────────────────────────────────────────────────────────

const renameAuthor = (m: Mutable) => {
  fieldOf(m, 'author').key = 'authors';
  m.views[0].blocks[2].card.subtitle = 'authors';
};

test('renaming a field without a migration needs a major version and a migrate block', () => {
  const r = checkUpdate(v1, next((m) => {
    m.version = '1.1.0';
    renameAuthor(m);
  }));
  assert.equal(r.kind, 'breaking');
  assert.match(messages(r.issues), /new major version: 2\.0\.0/);
  assert.match(messages(r.issues), /migrate block from "1\.x"/);
});

test('a migrate block that covers the rename makes it publishable', () => {
  const r = checkUpdate(v1, next((m) => {
    m.version = '2.0.0';
    renameAuthor(m);
    m.migrate = { from: '1.x', steps: [{ rename_field: { collection: 'book', from: 'author', to: 'authors' } }] };
  }));
  assert.equal(r.kind, 'breaking');
  assert.equal(r.migrates, true);
  assert.deepEqual(r.issues, []);
});

test('a removed option is covered by mapping it to a remaining one', () => {
  const dropWant = (m: Mutable) => {
    m.version = '2.0.0';
    const status = fieldOf(m, 'status');
    status.options = ['reading', 'read'];
    status.default = 'reading';
  };
  const without = checkUpdate(v1, next((m) => {
    dropWant(m);
    m.migrate = { from: '1.x', steps: [{ drop_field: { collection: 'book', field: 'gone' } }] };
  }));
  assert.match(messages(without.issues), /not covered by migrate: option "want"/);

  const withMap = checkUpdate(v1, next((m) => {
    dropWant(m);
    m.migrate = { from: '1.x', steps: [{ map_values: { collection: 'book', field: 'status', map: { want: 'reading' } } }] };
  }));
  assert.deepEqual(withMap.issues, []);
});

test('a removed field is covered by drop_field', () => {
  const r = checkUpdate(v1, next((m) => {
    m.version = '2.0.0';
    book(m).fields = book(m).fields.filter((f: Mutable) => f.key !== 'cover');
    delete m.views[0].blocks[2].card.image;
    m.migrate = { from: '1.x', steps: [{ drop_field: { collection: 'book', field: 'cover' } }] };
  }));
  assert.deepEqual(r.issues, []);
});

test('a renamed collection is covered by rename_collection', () => {
  const renamed = JSON.parse(JSON.stringify(v1).replaceAll('"book"', '"novel"')) as Mutable;
  renamed.version = '2.0.0';
  renamed.migrate = { from: '1.x', steps: [{ rename_collection: { from: 'book', to: 'novel' } }] };
  const r = checkUpdate(v1, next((m) => Object.assign(m, renamed)));
  assert.deepEqual(r.issues, []);
});

test('a type change can not be migrated: it says to add a new field instead', () => {
  const r = checkUpdate(v1, next((m) => {
    m.version = '2.0.0';
    fieldOf(m, 'rating').type = 'number';
    m.migrate = { from: '1.x', steps: [{ rename_field: { collection: 'book', from: 'author', to: 'author' } }] };
  }));
  assert.match(messages(r.issues), /not covered by migrate: field "rating" changed type rating → number.*Add a new field instead/);
});

test('a new required field with no default is breaking', () => {
  const r = checkUpdate(v1, next((m) => {
    m.version = '1.1.0';
    book(m).fields.push({ key: 'isbn', type: 'text' });
  }));
  assert.equal(r.kind, 'breaking');
  assert.match(messages(r.issues), /new field "isbn" is required/);
});

test('migrate steps must match the previous version', () => {
  const r = checkUpdate(v1, next((m) => {
    m.version = '2.0.0';
    renameAuthor(m);
    m.migrate = { from: '1.x', steps: [{ rename_field: { collection: 'book', from: 'writer', to: 'authors' } }] };
  }));
  assert.match(messages(r.issues), /previous version has no field "writer"/);
  assert.match(messages(r.issues), /not covered by migrate: field "author" was removed/);
});

test('a migrate block for another major does not apply', () => {
  const r = checkUpdate(v1, next((m) => {
    m.version = '2.0.0';
    renameAuthor(m);
    m.migrate = { from: '0.x', steps: [{ rename_field: { collection: 'book', from: 'author', to: 'authors' } }] };
  }));
  assert.equal(r.migrates, false);
  assert.match(messages(r.issues), /migrate block from "1\.x"/);
});

// ─── The new version's own migrate block is checked on its own ──────────────

test('migrate steps are checked against the new version', () => {
  const bad = structuredClone(v1) as Mutable;
  bad.version = '2.0.0';
  bad.migrate = {
    from: '1.x',
    steps: [
      { drop_field: { collection: 'book', field: 'cover' } },
      { map_values: { collection: 'book', field: 'status', map: { want: 'wishlist' } } },
      { rename_field: { collection: 'book', from: 'x', to: 'writer' } },
    ],
  };
  const r = validatePluginData(bad);
  assert.equal(r.ok, false);
  const text = r.ok ? '' : messages(r.issues);
  assert.match(text, /"cover" still exists/);
  assert.match(text, /unknown option "wishlist"/);
  assert.match(text, /unknown field in "book" "writer"/);
});

// ─── Applying a migration to records ────────────────────────────────────────

const rec = (id: string, collection: string, data: Record<string, unknown>): PluginRecord => ({
  id,
  collection,
  created_at: '2026-10-01T00:00:00Z',
  data,
});

test('applyMigration replays the steps in order and reports what changed', () => {
  const records = [
    rec('a', 'book', { title: 'A', author: 'Le Guin', status: 'want' }),
    rec('b', 'book', { title: 'B', status: 'read' }),
    rec('c', 'note', { author: 'not a book' }),
  ];
  const { records: out, changedIds } = applyMigration(records, {
    from: '1.x',
    steps: [
      { rename_collection: { from: 'book', to: 'novel' } },
      { rename_field: { collection: 'novel', from: 'author', to: 'authors' } },
      { map_values: { collection: 'novel', field: 'status', map: { want: 'reading' } } },
      { drop_field: { collection: 'novel', field: 'title' } },
    ],
  });
  assert.deepEqual(out[0], rec('a', 'novel', { title: 'A', authors: 'Le Guin', status: 'reading' }));
  assert.deepEqual(out[1], rec('b', 'novel', { title: 'B', status: 'read' }));
  assert.deepEqual(out[2], records[2]);
  assert.deepEqual(changedIds, ['a', 'b']);
  assert.equal(records[0]!.collection, 'book', 'input records are not mutated');
});

test('map_values maps every element of a multiselect and drops duplicates', () => {
  const { records: out } = applyMigration([rec('a', 'book', { moods: ['sad', 'blue', 'happy'] })], {
    from: '1.x',
    steps: [{ map_values: { collection: 'book', field: 'moods', map: { sad: 'down', blue: 'down' } } }],
  });
  assert.deepEqual(out[0]!.data.moods, ['down', 'happy']);
});

test('a rename onto a field that already exists is rejected', () => {
  const r = checkUpdate(v1, next((m) => {
    m.version = '2.0.0';
    book(m).fields = book(m).fields.filter((f: Mutable) => f.key !== 'cover');
    m.views[0].blocks[2].card.image = undefined;
    m.migrate = { from: '1.x', steps: [{ rename_field: { collection: 'book', from: 'cover', to: 'title' } }] };
  }));
  assert.match(messages(r.issues), /"title" already exists in "book"/);
});

test('an additive update still checks the migration it carries', () => {
  const r = checkUpdate(v1, next((m) => {
    m.version = '2.0.0';
    book(m).fields.push({ key: 'authors', type: 'text', optional: true });
    m.migrate = { from: '1.x', steps: [{ rename_field: { collection: 'book', from: 'author', to: 'authors' } }] };
  }));
  assert.equal(r.kind, 'additive');
  assert.match(messages(r.issues), /moves or drops "author", but this version still declares it/);
});

test('a kind change still lists the field changes next to it', () => {
  const withNotes = next((m) => {
    m.collections.push({ key: 'note', kind: 'item', fields: [{ key: 'text', type: 'text' }, { key: 'mood', type: 'text', optional: true }] });
  });
  const r = checkUpdate(withNotes, next((m) => {
    m.version = '2.0.0';
    m.collections.push({ key: 'note', kind: 'event', fields: [{ key: 'text', type: 'text' }] });
  }));
  const paths = r.changes.map((c) => c.path);
  assert.ok(paths.includes('collections.note.kind'));
  assert.ok(paths.includes('collections.note.fields.mood'));
});

test('map_values only uses the map\'s own keys', () => {
  const { records: out, changedIds } = applyMigration([rec('a', 'book', { status: 'constructor' })], {
    from: '1.x',
    steps: [{ map_values: { collection: 'book', field: 'status', map: { want: 'reading' } } }],
  });
  assert.equal(out[0]!.data.status, 'constructor');
  assert.deepEqual(changedIds, []);
});
