# Pomodoso

Unified daily work tracking — pomodoro timer, tasks & priorities, habits, and Google
Calendar — as a Chrome extension with a companion web dashboard. Local-first, with
real-time sync across devices for paid users.

## Stack

- **Backend:** Rust · Axum · sqlx · PostgreSQL
- **Extension / Web:** React · Vite · TypeScript
- **Local storage (clients):** IndexedDB via Dexie
- **Monorepo:** pnpm workspaces
- **Auth:** Supabase · **Email:** Resend · **Billing:** Stripe

## Layout

```
backend/      Rust API (self-contained Cargo project)
extension/    Chrome MV3 extension (React + Vite)
web/          Web dashboard (React + Vite)
marketing/    Landing page (pomodoso.com)
api/          Shared TS HTTP/WS client (@pomodoso/api)
shared/       Shared TS types/utils
docs/         Spec, ADRs, logos
```

## Prerequisites

- Node 20 + pnpm 9
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
Dev points at `http://localhost:8080` and the dev Supabase project.

## Run locally

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

**Every normal build is dev** (loads `.env.development` → `localhost:8080`, dev Supabase).
Production only happens when packaging the store zip — and it flips back to dev afterward,
so you can never accidentally load a prod-pointing build locally.

| Command | Output |
|---|---|
| `pnpm --filter extension dev` | dev build, watch mode |
| `pnpm --filter extension build` | dev build (load `extension/dist`) |
| `pnpm --filter extension build:prod` | explicit production build (rare) |
| **`pnpm --filter extension zip`** | **prod zip** `pomodoso-extension-v<version>.zip`, then **restores the dev build** |

So: load `extension/dist` for local work; run `zip` only to produce the Chrome Web Store
upload.

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
