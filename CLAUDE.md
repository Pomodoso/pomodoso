# Pomodoso — Claude Code Instructions

Read `pomodoso-spec.md` for the complete product and technical context. This file contains operational rules and conventions for working on the codebase.

## Stack overview

- **Backend:** Rust + Axum + sqlx + PostgreSQL
- **Frontend (web app):** React + Vite + TypeScript
- **Frontend (extension):** Chrome MV3 + React + TypeScript
- **Local storage on clients:** IndexedDB via Dexie.js
- **Monorepo:** pnpm workspaces, optionally Turborepo for build orchestration
- **Real-time:** WebSockets between clients and backend

## Repository layout

```
pomodoso/
├── apps/
│   ├── backend/         # Rust, self-contained Cargo project
│   ├── web/             # React + Vite web app
│   ├── extension/       # Chrome MV3 extension
│   └── marketing/       # Landing page (optional)
├── packages/
│   ├── shared/          # TS types, sync engine, validation schemas
│   ├── ui/              # Shared React components
│   └── api-client/      # HTTP + WS client
├── docs/
│   ├── decisions/       # ADRs (architectural decision records)
│   └── mockups/
├── infra/
└── .github/workflows/
```

## Critical conventions

### TypeScript

- `strict: true` always. No `any` unless explicitly justified with a comment.
- Prefer named exports over default exports for shared code.
- Types live in `packages/shared/src/types`. Apps consume from there.

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

6. **Workspaces own everything user-data.** Every entity (except `user`, `workspace`, `workspace_member`, `subscription`) has a `workspace_id` FK.

7. **Last-Write-Wins (LWW) at the record level.** Conflicts resolve by comparing `updated_at`. No field-level merging.

8. **The pomodoro timer is server-authoritative** when sync is enabled, device-local when disabled. UI shows the active timer from server state.

9. **Ticket parsing is DOM-first, no auth required.** Use Open Graph metadata first, provider-specific selectors second. Linear/GitHub API integrations are post-MVP optional enrichment.

10. **No AI features in MVP.** Listed as nice-to-have in spec but explicitly out of scope for v1.

## What NOT to do

- **Don't** add new top-level dependencies without checking they're necessary. Prefer standard library and existing deps.
- **Don't** write generic abstractions before duplication appears. WET (Write Everything Twice) before refactoring.
- **Don't** mix Rust and Node tooling in the same directory. Backend lives in `apps/backend` and uses Cargo only.
- **Don't** introduce a state management library (Redux, Zustand, etc.) without strong justification. React state + TanStack Query is the default.
- **Don't** put business logic in components. Components consume hooks; hooks consume `@pomodoso/shared`.
- **Don't** call third-party APIs from the client (extension or web app). All external API calls go through the backend.

## Extension: IndexedDB schema changes

The extension uses Dexie.js (`extension/src/db.ts`). When adding or removing a table:

1. **Add a new Dexie version** with the schema migration.
2. **Update `extension/src/backup.ts`** — add the new table to `EXPECTED_TABLES`, the `exportDb()` reads, and the `importDb()` clears/bulkPuts. Omitting a table silently breaks import/export for that data.
3. If the table contains sensitive data (e.g. OAuth tokens), add its key to `EXCLUDED_SETTINGS` instead of including it in the backup.

## Working on features

When implementing a feature from the spec:

1. **Read the relevant spec section first.** Don't infer from the code; the spec is source of truth.
2. **Update the schema before the code.** New tables go in `apps/backend/migrations/` with a numbered SQL file.
3. **Define types in `packages/shared` first.** Both apps consume from there.
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

# Run backend (from apps/backend)
cd apps/backend && cargo run

# Run web app dev server
pnpm --filter web dev

# Build extension for side-loading
pnpm --filter extension build

# Run all tests
pnpm test                  # frontend
cd apps/backend && cargo test  # backend

# Database migrations
cd apps/backend && sqlx migrate run
```

## When in doubt

1. Check the spec first. The spec has decisions; trust them.
2. If the spec is silent, ask before assuming.
3. If you must assume, document the assumption in `docs/decisions/` as an ADR.
4. Smaller PRs are always better than larger ones.

## Spec versioning

The spec (`pomodoso-spec.md`) is the source of truth. When you make a decision that contradicts or extends the spec:

1. Update the spec in the same PR.
2. Bump the version in the spec header.
3. Add a line to the spec changelog explaining what changed.
