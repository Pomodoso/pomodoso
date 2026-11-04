# Pomodoso — Claude Code Instructions

Read `docs/pomodoso-spec-en.md` for the complete product and technical context. This file contains operational rules and conventions for working on the codebase.

## Stack overview

- **Backend:** Rust + Axum + sqlx + PostgreSQL
- **Auth:** Supabase. Each client owns its Supabase client and session (`web/src/lib/supabase.ts`, `extension/src/supabaseClient.ts`, `mobile/hooks/useAuth.ts`); `@pomodoso/api` holds the shared auth helpers (sign in, sign up, magic link, reset)
- **Frontend (web):** React + Vite (`vite-react-ssg`) + TypeScript — public site and dashboard
- **Frontend (extension):** Chrome MV3 + React + TypeScript
- **Mobile:** Expo + React Native + TypeScript
- **Local storage on clients:** extension → IndexedDB via Dexie.js; mobile → SQLite via `expo-sqlite` + Drizzle
- **Monorepo:** pnpm workspaces
- **Real-time:** WebSockets between clients and backend

## Repository layout

```
pomodoso/
├── backend/             # Rust, self-contained Cargo project (migrations in backend/migrations)
├── web/                 # React + Vite web app (landing, pricing, dashboard)
├── extension/           # Chrome MV3 extension
├── mobile/              # Expo app (db/ holds the Drizzle schema)
├── api/                 # @pomodoso/api — HTTP + WS client, Supabase client
├── shared/
│   ├── types/           # @pomodoso/types — TS types, shared rules, validation
│   ├── ui/              # @pomodoso/ui — shared React components
│   └── plugin/          # @pomodoso/plugin — app file validator CLI (published to npm)
├── docs/                # Local only: gitignored on purpose (the repo is public). Never commit it.
│   ├── pomodoso-spec-en.md
│   ├── decisions/       # ADRs (architectural decision records)
│   └── mockups/
└── .github/workflows/
```

## Critical conventions

### TypeScript

- `strict: true` always. No `any` unless explicitly justified with a comment.
- Prefer named exports over default exports for shared code.
- Types live in `shared/types/src/types` (`@pomodoso/types`). Apps consume from there.

### Rust

- `cargo fmt` + `cargo clippy` mandatory before committing.
- Use `sqlx::query!` macros for compile-time SQL verification.
- Errors with `thiserror` for libraries, `anyhow` for application code.
- Async with `tokio`.

### Naming

- Database tables: `snake_case`, singular (`task`, `pomodoro_session`).
- API endpoints: kebab-case in URLs, `snake_case` keys in JSON bodies.
- TypeScript interfaces and types: `PascalCase`.
- Rust structs and enums: `PascalCase`.
- Files: kebab-case for TS, snake_case for Rust modules.

### Git

- **Conventional commits**: `feat:`, `fix:`, `refactor:`, `chore:`, `docs:`, `test:`.
- Main branch is `main`. No `develop` branch.
- Feature branches: `feat/<short-description>` or `fix/<short-description>`.
- Squash and merge on PRs.

## Architectural rules (non-negotiable)

1. **Entitlements gate every paid feature.** Never check `plan === "pro"` in the UI. Always check `entitlements.features.<flag>`. See spec section 15.

2. **Sync is built but disabled in MVP.** All users start as Free. Free users don't open WebSocket connections nor call sync push/pull endpoints. The sync engine code exists from day 1 but is gated.

3. **All IDs are client-generated UUIDs.** Never use database auto-increment IDs. This enables offline creation and conflict-free sync.

4. **Soft delete via `deleted_at`.** Never `DELETE FROM` directly. Sync needs tombstones.

5. **Every syncable entity has `created_at`, `updated_at`, `deleted_at` (nullable), `synced_at` (nullable).**

6. **Workspaces own work-context data.** Tasks, projects, pomodoro sessions and task orders carry a `workspace_id` FK. The exceptions are: `user`, `workspace`, `workspace_member`, `subscription`, and the **user-scoped** entities `user_setting`, `device`, `detection_rule`, `habit`, `habit_log`, `plugin`, `plugin_record` — these are keyed by `user_id` and sync globally (habits are personal, not per-work-context; see spec v0.10). User-scoped entities are pushed/pulled outside the workspace loop in `sync.rs`.

7. **Last-Write-Wins (LWW) at the record level.** Conflicts resolve by comparing `updated_at`. No field-level merging.

8. **The pomodoro timer is server-authoritative** when sync is enabled, device-local when disabled. UI shows the active timer from server state.

9. **Ticket parsing is DOM-first, no auth required.** Use Open Graph metadata first, provider-specific selectors second. Linear/GitHub API integrations are post-MVP optional enrichment.

10. **No AI features in MVP.** Listed as nice-to-have in spec but explicitly out of scope for v1.

## What NOT to do

- **Don't** add new top-level dependencies without checking they're necessary. Prefer standard library and existing deps.
- **Don't** write generic abstractions before duplication appears. WET (Write Everything Twice) before refactoring.
- **Don't** mix Rust and Node tooling in the same directory. Backend lives in `backend/` and uses Cargo only.
- **Don't** introduce a state management library (Redux, Zustand, etc.) without strong justification. React state + TanStack Query is the default.
- **Don't** put business logic in components. Components consume hooks; hooks consume `@pomodoso/types`.
- **Don't** call third-party APIs from the client (extension, web or mobile); new external calls go through the backend. The one exception today is Google Calendar: the extension (`extension/src/calendarSync.ts`) and mobile (`mobile/utils/googleCalendar.ts`) call Google directly with the user's own OAuth token.

## Extension: IndexedDB schema changes

The extension uses Dexie.js (`extension/src/db.ts`). When adding or removing a table:

1. **Add a new Dexie version** with the schema migration.
2. **Update `extension/src/backup.ts`** — add the new table to `EXPECTED_TABLES`, the `exportDb()` reads, and the `importDb()` clears/bulkPuts. Omitting a table silently breaks import/export for that data.
3. If the table contains sensitive data (e.g. OAuth tokens), add its key to `EXCLUDED_SETTINGS` instead of including it in the backup.

## Apps (plugins)

Apps are single YAML files rendered from a closed catalog (`shared/types/src/plugins/`). See the README's Apps section for the map.

- **The format never becomes a language.** No expressions, scripts, HTML or remote code: Chrome Web Store policy (MV3 remote code) and a public directory both depend on it. New power means a new catalog entry, not an escape hatch. zod runs jitless for the same reason.
- **The catalog is the source of truth.** A new block, field type, computed value or hook needs its entry in `docs.ts` (the typecheck fails without it). Then regenerate: `pnpm --filter @pomodoso/types gen:plugin-schema` and `gen:llms`; a test fails if they're stale. The schema is copied to `backend/schema/`, which the server validates against.
- **Every new piece of the format gets documented twice, in the same PR: for people and for LLMs.** Whenever you add or change anything an app file can use (block, Today widget, hook, computed operator, field type, stat format, top-level key, rule or migrate step):
  1. **Human docs** — the web page `/apps/docs` (`web/src/pages/apps/DocsPage.tsx`). Add a worked example in `shared/types/src/plugins/guide.ts` (blocks, widgets, hooks and operators are typed over the catalog, so a missing one fails the typecheck; `guide.test.ts` checks each example validates and it renders live on the page). Anything not covered by those maps (a new top-level key, rule option, migrate step, field option) needs its explanation written into `DocsPage.tsx` by hand.
  2. **LLM docs** — the description in `docs.ts` (and `TOP_LEVEL_DOCS` in `llms.ts` for top-level keys), then run `gen:llms` so `web/public/llms.txt` and `llms-full.txt` are current. If the change affects how agents should write apps, update the skill in `shared/plugin/skill/pomodoso-plugin/SKILL.md` too.
  A format change without both is not done.
- **The format has its own version, `APPS_VERSION`** (`shared/types/src/plugins/apps-version.ts`, ADR 0006), separate from the extension's. Extension 1.4.0 supports 0.1. Each published app version stores the lowest one that opens it (`min_apps_version`), and the directory only shows a client what it can open (clients send `?apps_version=`; none means 0.1). When you add to the format:
  1. Tag the new catalog entry with the version it arrives in (the `Record`s in `apps-version.ts` fail the typecheck otherwise). A new *property* needs its own check in `requiredAppsVersion`.
  2. If the current `APPS_VERSION` has already shipped in a release, first freeze its schema: copy `schema/plugin.v1.json` to `schema/apps/<that version>.json` in `shared/types` and `backend` and add it to `FROZEN_SCHEMAS` in `plugin_directory.rs`. Then raise `APPS_VERSION` here and in the Rust constant (a test checks they match). One bump per release, not per feature.
- **The server validates every publish**; client checks only give feedback.
- **An `id` belongs to its first publisher for good,** taken down or not, and reserved slugs stay blocked. A breaking update needs a new major and a `migrate` block.
- **Sync:** `plugin` and `plugin_record` are user-scoped, keyed `(user_id, id)`. `updated_at` is the client's edit time (LWW); `server_updated_at` is trigger-set and drives pull. A daily record's id is derived (`dailyRecordId`), so devices converge.
- **Private listings are a paid feature:** `entitlements.features.private_plugins`, enforced on the server.
- **Web and extension talk through** `content-scripts/web-bridge.ts`, on Pomodoso's site only; the background re-checks the origin.
- **`extension/e2e` doesn't cover apps yet.** Exercise app changes in a browser.

## Working on features

When implementing a feature from the spec:

1. **Read the relevant spec section first.** Don't infer from the code; the spec is source of truth.
2. **Update the schema before the code.** New tables go in `backend/migrations/` with a numbered SQL file.
3. **Define types in `shared/types` first.** Every client (extension, web, mobile) consumes from there.
4. **Backend endpoint before frontend integration.** Get the API working with `curl` before wiring UI.
5. **Add to entitlements if it's a paid feature.** Default to `false` for the free tier.
6. **Test the sync path.** Any new entity must round-trip through push/pull correctly.

## Phase awareness

The product is built in three phases (spec section 5):

- **Phase 0:** Foundation (auth, schema, sync engine, basic infra).
- **Phase 1:** MVP core (pomodoro, work log, tasks, habits, daily/weekly reports, single workspace, no sync active).
- **Phase 2:** Calendar integration, advanced reports, history heatmap, multi-workspace, sync activated for paid users.
- **Phase 3:** AI features, API integrations (Linear/GitHub OAuth), custom providers.

**Do not implement Phase 2 or 3 features unless explicitly asked.** Even if a feature is "easy" to add, scope creep is the enemy of shipping.

## Plan and pricing context

- **MVP:** Everyone is on the Free plan. No billing infrastructure. No Stripe.
- **The `subscription` table exists from day 1.** Every new user gets a row with `plan = "free"`, `status = "active"`.
- **Owner override:** Use `subscription.feature_overrides` (JSONB) to enable paid features for specific users during development.
- **No upgrade flow in MVP.** Show "Coming soon" or grayed-out states for paid features.

## Common commands

```bash
# Install all dependencies
pnpm install

# Run backend
cd backend && cargo run

# Run web app dev server
pnpm --filter web dev

# Run extension dev build
pnpm dev:extension

# Build extension for side-loading
pnpm --filter extension build

# Run mobile app
pnpm --filter mobile start

# Run all tests
pnpm -r test             # TS packages (shared/types, extension)
pnpm typecheck           # workspaces with a typecheck script (not web)
pnpm --filter web exec tsc -b   # web (also what its build runs)
cd backend && cargo test  # backend

# Database migrations
cd backend && sqlx migrate run
```

## When in doubt

1. Check the spec first. The spec has decisions; trust them.
2. If the spec is silent, ask before assuming.
3. If you must assume, document the assumption in `docs/decisions/` as an ADR.
4. Smaller PRs are always better than larger ones.

## Spec versioning

The spec (`docs/pomodoso-spec-en.md`) is the source of truth. When you make a decision that contradicts or extends the spec:

1. Update the spec alongside the change. It lives in `docs/`, which is local only (gitignored, never committed), so the spec update stays on your machine and the PR says what changed.
2. Bump the version in the spec header.
3. Add a line to the spec changelog explaining what changed.
