// Publishes Pomodoso's own apps (src/plugins/examples) to the directory, as the
// Pomodoso account. Safe to run again: an app already at its version is
// skipped, a newer one goes up as an update (additive or breaking, from
// checkUpdate), and one whose id another account owns is reported.
//
//   POMODOSO_APPS_EMAIL=… POMODOSO_APPS_PASSWORD=… make seed-apps [API_URL=…]
//
// Signs in with Supabase's password grant. VITE_SUPABASE_URL and
// VITE_SUPABASE_ANON_KEY come from the environment or web/.env.local.

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkUpdate, compareVersions, parsePluginFile, validatePluginData } from '../src/plugins/index.ts';

const here = dirname(fileURLToPath(import.meta.url));
const examples = join(here, '../src/plugins/examples');

function webEnv(key: string): string | undefined {
  try {
    const text = readFileSync(join(here, '../../../web/.env.local'), 'utf8');
    return new RegExp(`^${key}=(.*)$`, 'm').exec(text)?.[1]?.trim();
  } catch {
    return undefined;
  }
}

function need(name: string, value: string | undefined): string {
  if (!value) {
    console.error(`Missing ${name}.`);
    process.exit(2);
  }
  return value;
}

const apiUrl = (process.env.API_URL ?? 'http://localhost:8080').replace(/\/$/, '');
const supabaseUrl = need('VITE_SUPABASE_URL', process.env.VITE_SUPABASE_URL ?? webEnv('VITE_SUPABASE_URL'));
const anonKey = need('VITE_SUPABASE_ANON_KEY', process.env.VITE_SUPABASE_ANON_KEY ?? webEnv('VITE_SUPABASE_ANON_KEY'));
const email = need('POMODOSO_APPS_EMAIL', process.env.POMODOSO_APPS_EMAIL);
const password = need('POMODOSO_APPS_PASSWORD', process.env.POMODOSO_APPS_PASSWORD);

const auth = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: anonKey, 'content-type': 'application/json' },
  body: JSON.stringify({ email, password }),
});
if (!auth.ok) {
  console.error(`Couldn't sign in as ${email}: ${auth.status} ${await auth.text()}`);
  process.exit(1);
}
const { access_token: token } = (await auth.json()) as { access_token: string };

const call = (path: string, init: RequestInit = {}) =>
  fetch(`${apiUrl}${path}`, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` } });

// The first call also creates the account's user row on a fresh backend.
const me = await call('/me');
if (!me.ok) {
  console.error(`${apiUrl}/me answered ${me.status}. Is the backend running?`);
  process.exit(1);
}

let failed = 0;
for (const file of readdirSync(examples).filter((f) => f.endsWith('.yaml')).sort()) {
  const parsed = parsePluginFile(readFileSync(join(examples, file), 'utf8'));
  if (!parsed.ok) {
    console.error(`✗ ${file}: not a valid app file`);
    failed++;
    continue;
  }
  const next = parsed.manifest;

  const current = await call(`/plugins/mine/${next.id}`);
  let changeKind: 'additive' | 'breaking' | undefined;
  if (current.ok) {
    const page = (await current.json()) as { latest_version: string; manifest: unknown };
    if (compareVersions(next.version, page.latest_version) <= 0) {
      console.log(`· ${next.id} ${page.latest_version}: up to date`);
      continue;
    }
    const prev = validatePluginData(page.manifest);
    const report = prev.ok ? checkUpdate(prev.manifest, next) : null;
    if (report && report.issues.length > 0) {
      console.error(`✗ ${next.id} ${next.version}: ${report.issues.map((i) => i.message).join('; ')}`);
      failed++;
      continue;
    }
    changeKind = report?.kind === 'breaking' ? 'breaking' : 'additive';
  }

  const r = await call('/plugins/publish', {
    method: 'POST',
    body: JSON.stringify({ manifest: next, visibility: 'public', change_kind: changeKind, changelog: changeKind ? undefined : 'First version' }),
  });
  if (r.ok) {
    console.log(`✓ ${next.id} ${next.version}${changeKind ? ` (${changeKind} update)` : ''}`);
  } else if (r.status === 403) {
    console.error(`✗ ${next.id}: another account already owns this id`);
    failed++;
  } else {
    console.error(`✗ ${next.id}: ${r.status} ${await r.text()}`);
    failed++;
  }
}
process.exit(failed > 0 ? 1 : 0);
