import { test } from 'node:test';
import assert from 'node:assert/strict';
import { urlsMatch } from './urlMatch.ts';

test('the same page matches, ignoring a trailing slash and an empty hash', () => {
  assert.ok(urlsMatch('https://linear.app/acme/issue/ENG-412', 'https://linear.app/acme/issue/ENG-412/'));
  assert.ok(urlsMatch('https://github.com/a/b/pull/7#', 'https://github.com/a/b/pull/7'));
  assert.ok(urlsMatch('https://GitHub.com/a/b/pull/7', 'https://github.com/a/b/pull/7'));
});

test('a sub-page matches its parent, either way round', () => {
  assert.ok(urlsMatch('https://linear.app/acme/issue/ENG-412', 'https://linear.app/acme/issue/ENG-412/fix-login'));
  assert.ok(urlsMatch('https://github.com/a/b/pull/7/files', 'https://github.com/a/b/pull/7'));
  assert.ok(urlsMatch('https://example.com/doc', 'https://example.com/doc?tab=2'));
});

test('a longer id is not a sub-page', () => {
  assert.equal(urlsMatch('https://linear.app/acme/issue/ENG-41', 'https://linear.app/acme/issue/ENG-412'), false);
  assert.equal(urlsMatch('https://github.com/a/b/pull/7', 'https://github.com/a/b/pull/70'), false);
});

test('a site root only matches itself', () => {
  assert.equal(urlsMatch('https://github.com', 'https://github.com/a/b/pull/7'), false);
  assert.equal(urlsMatch('https://github.com/a/b', 'https://github.com/'), false);
  assert.ok(urlsMatch('https://github.com/', 'https://github.com'));
});

test('the hash tells Gmail threads apart', () => {
  const inbox = 'https://mail.google.com/mail/u/0/#inbox';
  const thread = 'https://mail.google.com/mail/u/0/#inbox/FMfcgzQXJ';
  assert.ok(urlsMatch(thread, thread));
  assert.equal(urlsMatch(thread, 'https://mail.google.com/mail/u/0/#inbox/OTHER'), false);
  // The inbox itself is a parent of every thread; that's acceptable, the
  // thread link is what a task stores.
  assert.ok(urlsMatch(inbox, thread));
});

test('non-web and unparseable URLs never match', () => {
  assert.equal(urlsMatch('chrome://extensions', 'chrome://extensions'), false);
  assert.equal(urlsMatch('not a url', 'https://example.com/a'), false);
});
