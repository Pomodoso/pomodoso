# Pomodoso

Unified daily work tracking — pomodoro timer, tasks & priorities, habits, and Google
Calendar — as a Chrome extension with a companion web dashboard. Local-first, with
real-time sync across devices for paid users.

**[Apps](#apps)** let anyone add their own trackers: a single YAML file, usually written by
an AI assistant, becomes a small app inside Pomodoso.

## Stack

- **Backend:** Rust · Axum · sqlx · PostgreSQL
- **Extension / Web:** React · Vite · TypeScript
- **Local storage (clients):** IndexedDB via Dexie
- **Monorepo:** pnpm workspaces
- **Auth:** Supabase · **Email:** Postmark · **Billing:** Stripe

## Layout

```
backend/      Rust API (self-contained Cargo project)
extension/    Chrome MV3 extension (React + Vite)
web/          Landing (pomodoso.com), public app directory + web dashboard (React + Vite)
mobile/       Expo app
api/          Shared TS HTTP/WS client (@pomodoso/api)
shared/
  types/      Shared TS types and rules, including the app format (@pomodoso/types)
  ui/         Shared React components (@pomodoso/ui)
  plugin/     App file validator CLI, published to npm (@pomodoso/plugin)
docs/         Spec, ADRs, logos
```

## Prerequisites

- Node 22 + pnpm 9
- Rust (stable) + a PostgreSQL 16 instance (local or Docker)
- Stripe CLI (for local webhook forwarding)

## Setup

```bash
pnpm install                      # all workspace deps

# Backend env + DB
cp backend/.env.example backend/.env   # fill DATABASE_URL, Supabase, Stripe, Resend
cd backend && sqlx migrate run && cd ..
```

Client env files are committed with dev/prod values:
`extension/.env.development` + `extension/.env.production`, and `web/.env.local`.
Dev points at `http://localhost:8080`, with the same Supabase project as production: sign-in emails are real.

## Run locally

`make dev` starts Postgres (Docker or Podman), the API, the web app and the extension's
watch build together; `make help` lists the targets. Load `extension/dist` unpacked in
`chrome://extensions`, and reload it there after the manifest changes. One by one:

```bash
# Backend (port 8080)
cd backend && cargo run

# Stripe webhooks (separate shell) — needed for checkout to provision plans
stripe listen --forward-to localhost:8080/webhooks/stripe
#   put the printed whsec_… in backend/.env as STRIPE_WEBHOOK_SECRET

# Web dashboard
pnpm --filter web dev

# Extension — build (dev) then load extension/dist unpacked in chrome://extensions
pnpm --filter extension dev        # watch-rebuild on change
```

## Extension: dev vs. production build

**Every normal build is dev** (loads `.env.development` → `localhost:8080`).
Production only happens when packaging the store zip — and it flips back to dev afterward,
so you can never accidentally load a prod-pointing build locally.

| Command | Output |
|---|---|
| `pnpm --filter extension dev` | dev build, watch mode |
| `pnpm --filter extension build` | dev build (load `extension/dist`) |
| `pnpm --filter extension build:prod` | explicit production build (rare) |
| **`cd extension && make zip`** | **prod zip** `releases/pomodoso-<version>.zip`, then **restores the dev build** |

So: load `extension/dist` for local work; run `make zip` only to produce the Chrome Web
Store upload.

Before cutting a release, run `pnpm --filter extension e2e` — it drives the real
popup window, which is where drag-and-drop and the challenge flow can break
while every other check passes. See `extension/e2e/README.md`.

Packaging lives in `extension/Makefile` and nowhere else. There used to be a second
path (`pnpm --filter extension zip`) that produced the same artifact under a different
name — `pomodoso-extension-v<version>.zip` against the Makefile's `pomodoso-<version>.zip`
— and every release from 1.1.2 on used the Makefile's. Two ways to build one thing is
how you end up uploading the wrong file.

## Apps

An app (a "plugin" in the code) is one YAML file: its data, what it computes and which of
Pomodoso's built-in components to show. It's never code: the file is validated against a
closed catalog and rendered with components that ship in the clients, which is what keeps
it within Chrome's MV3 remote-code rules and makes a public directory safe.

**Using them:** browse at [pomodoso.com/apps](https://pomodoso.com/apps), or in the extension
under Apps → Add an app.

**Writing one:** start at [pomodoso.com/apps/build](https://pomodoso.com/apps/build). Point an AI
assistant at [`llms-full.txt`](https://pomodoso.com/llms-full.txt) and check the result:

```bash
npx @pomodoso/plugin validate my-app.yaml
```

To update an app, keep its `id` and raise its `version`. Add the new file in the extension, or
publish it from Dashboard → Apps; entries carry over.

**In this repo:**

| Where | What |
|---|---|
| `shared/types/src/plugins/` | The format: schema, validation, computed values, update checks, migrations, docs for LLMs, example apps |
| `shared/ui/src/plugins/` | The components an app renders with |
| `shared/plugin/` | The CLI (`shared/plugin/skill/` has the agent skill) |
| `extension/src/popup/apps/`, `extension/src/plugins.ts` | Apps tab, storage, hooks, install and updates |
| `web/src/pages/apps/`, `web/src/pages/dashboard/AppsPage.tsx` | Public directory, publishing, installed apps |
| `backend/src/routes/plugin_directory.rs`, `installed_plugins.rs` | Directory API, installed apps; sync lives in `sync.rs` |

The JSON Schema and `llms.txt` / `llms-full.txt` are generated from the catalog, and a test
fails if they go stale:

```bash
pnpm --filter @pomodoso/types gen:plugin-schema
pnpm --filter @pomodoso/types gen:llms
```

`make seed-apps` publishes the example apps as the Pomodoso account
(`POMODOSO_APPS_EMAIL`, `POMODOSO_APPS_PASSWORD`, `API_URL`).

## Mobile: local builds

No EAS. Builds run on this machine, cost nothing and wait in no queue — EAS
becomes worth it when a build has to happen without the Mac. Everything lives in
`mobile/Makefile`:

```bash
cd mobile
make devices                      # UDIDs of connected iPhones
make ios DEVICE=<udid>            # Release build → iPhone
make install DEVICE=<udid>        # install the last build without rebuilding
make sim                          # Release build → booted simulator
make prebuild                     # regenerate ios/ + android/ from app.json
```

**Use `make ios`, not `make ios-dev`, for real testing.** A Release build embeds
the JS bundle, so the app runs with the Mac closed and off the network. A
dev-client build fetches JS from Metro at launch and shows "No script URL
provided" without it.

`make install` exists because `expo run:ios` fails its *launch* step when the
phone is locked — after having built and signed successfully. That target picks
up the finished build instead of repeating twenty minutes of work.

Signing comes from `ios.appleTeamId` in `mobile/app.json`. With the paid Apple
Developer account a build lasts a year on the device; under the free personal
team it expired after seven days.

`ios.buildNumber` must increase on **every** upload of the same `version`, or
App Store Connect rejects it. `version` is the marketing string users see.

### TestFlight

```bash
cd mobile
make archive        # build + export a signed .ipa
make upload         # send it to App Store Connect
make testflight     # bump, archive, upload
```

One-time setup, both in App Store Connect:

1. Create the app with bundle id `com.pomodoso.app`.
2. **Users and Access → Integrations → App Store Connect API** → generate a key
   with the **App Manager** role. Save the `.p8` to
   `~/.appstoreconnect/private_keys/AuthKey_<KEYID>.p8` — it downloads exactly
   once — and export `ASC_KEY_ID` and `ASC_ISSUER_ID` from your shell profile.

The `.p8` is a real upload credential and this repo is public, so it stays
outside it. The Team ID in `app.json` is not: it ships inside every signed
binary and is readable from any App Store download.

`make bump` runs on its own inside `make testflight`. App Store Connect rejects
a build carrying a `buildNumber` it has already seen — even after that build was
deleted — and it rejects it *after* the whole upload finishes.

Run `make prebuild` after changing plugins, icons or entitlements in `app.json`
— `expo run:ios` alone reuses whatever `ios/` already holds, which is why icon
and splash changes appear to do nothing until it runs.

## Tests / CI

```bash
cd backend && SQLX_OFFLINE=true cargo clippy -- -D warnings && cargo test
pnpm --filter web build            # tsc + vite
pnpm --filter extension build
```

CI mirrors this in `.github/workflows/` (`backend.yml`, `frontend.yml`). The backend uses
the committed `.sqlx` offline cache — after changing a `sqlx::query!`, regenerate it with
`cargo sqlx prepare` against a running DB.

See `docs/pomodoso-spec-en.md` for the full product/technical spec and `CLAUDE.md` for
conventions.
