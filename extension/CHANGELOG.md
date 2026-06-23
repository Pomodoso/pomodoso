# Changelog


## v1.1.1(In progress)

### Integrations (web + backend)

- **Crisp support chat** — Loaded on the web (landing + dashboard), identifying the signed-in user by email/name. Set `VITE_CRISP_WEBSITE_ID`.
- **Sentry error reporting** — Web (`@sentry/react`, `VITE_SENTRY_DSN`) and backend (`sentry` crate, `SENTRY_DSN`). Both no-op when the DSN is unset.
- **Analytics** — Google Analytics 4 (`VITE_GA_ID`) via `index.html`, plus Vercel Web Analytics (`@vercel/analytics`). All on the web app.

## v1.1.0

### Sync

- **Detection rules now sync** — Task-detection rules (presets + custom) now travel through sync as their own user-scoped entity (`detection_rule`). Presets share a stable id (`r-linear`, `r-github`, `r-arxiv`) so they converge across installs instead of duplicating. Previously they only lived in each device's IndexedDB. Requires backend migration `009`.
- **Fix: fields dropped by sync** — `project.endDate` and habit `unit`/`unitAmount` weren't syncing, so on a second device projects lost their date and counter habits lost their unit. Now `end_date` travels on `project` and habit extras in `habit.extra` (JSONB), like `task.extra`.

- **Robust import / self-healing** — On import (or when updating the extension via Dexie migration v11) the data is sanitized so it can't break sync: habits with a non-UUID id (e.g. `h2`) get a fresh UUID and their history is remapped; orphan history (pointing at a missing habit) is dropped; habits lose their workspace (they're user-global now); and projects with a dangling `workspaceId` (`'default'` or a workspace not in the backup) are set to `null` so sync re-homes them instead of orphaning them. Verified against a real prod dump: 21 habits / 41 logs / 107 tasks / 14 projects all 100% accepted by the backend.
- **Fix: imports didn't reach other devices** — On import, rows kept their original (old) `updatedAt`. They were pushed to the server with that old date, so a second extension's incremental pull (`updated_at > since`) skipped them — which is why imported habits didn't show on the other extension but a freshly created one (with `updatedAt = now`) did. Import now re-stamps `updatedAt = now()` on every restored row: it propagates to all devices and, via LWW, the restore wins on the server.

- **User-global habits** — Habits are no longer tied to a workspace (they're personal, but the model scoped them per workspace, so they scattered: different habits landed in different workspaces and some wouldn't sync if they fell into one the server didn't accept). Now `habit`/`habit_log` are user-scoped (like settings and detection rules): they show in every workspace and the "All" view, and converge into a single global list across devices. Backend migration `010`; Dexie migration v11 re-pushes all local habits (unsticking ones marked "synced" but never accepted by the server) and drops their workspace. Tasks and projects stay per-workspace.
- **Fix (root cause): colliding habit_log ids → only 1 day per habit synced** — The log id generator derived the UUID from the habit alone (it truncated the date), so EVERY day of a habit shared one id. Locally it's harmless (the key is `[habitId+date]`), but on the server `habit_log.id` is the PRIMARY KEY: the first day inserted and the rest collided on the PK → rejected. That's why "Parallel Bar Dips" (a new habit with a single log) synced and the others didn't. The id is now computed per `(habit, date)` (unique per day), the push always recomputes it (self-healing), and Dexie migration **v13** regenerates existing ids + forces a re-push and full pull. Verified against a real export: 43 logs → 43 unique ids, 0 collisions.
- **Fix: today's habit counts didn't converge** — Habit definitions already synced, but today's value (e.g. Water 1, Pull-ups 2) didn't reach the other devices: v11 cleared `syncedAt` (re-push) but not the pull cursor, so a device that had already pulled never received logs re-pushed with an old `updatedAt` (which is why one device showed the real value and another showed 0). Dexie migration **v12**: clears `sync_last_pull` to force a full pull on each device (receiving all the server's logs) and re-pushes local ones; LWW (the latest real edit) resolves conflicts.

### Web

- **Meetings on the dashboard** — Today's calendar meetings now show on the web (time, title, duration, and "logged Xm" when time was tracked). Meetings became a synced, workspace-scoped entity (backend migration `011`), so they also converge across devices.
- **Tasks shown with Today** — Priorities and other tasks are now one "Today's tasks" card (priorities on top, a divider, then the rest) instead of two separate cards.
- **Workspace badge per task** — In the "All workspaces" view, each task shows a small badge with the workspace it belongs to (hidden in single-workspace views).
- **Counter habits: correct quantity** — The web drew one dot per unit of the goal (`target_count`), so a habit with goal 20 showed 20 dots. It now shows `value/goal` (+ unit) like the extension. `/today` returns `unit`/`unit_amount` (from `habit.extra`).

### Extension

- **Meetings sync** — Calendar meetings (previously local-only) now sync like tasks/projects, including logged time, and round-trip through import/export.
- **"Other tasks" → "Today's tasks"** — Clearer section label in the Today view (pairs with "Today's priorities").
- **Clear local data (after logout)** — The signed-out Account screen now has a "Clear local data" button (with a confirm step) that wipes everything stored in this browser — tasks, habits, projects, settings — and reloads. Synced data on the account is untouched; signing back in restores it. Handy when switching accounts or on a shared browser.
- **Persistent session (no more logout)** — The Supabase client now uses a storage adapter over `chrome.storage.local` (instead of `localStorage`, which doesn't exist in the MV3 service worker), with `onAuthStateChange` mirroring the session to IndexedDB and proactive token refresh from the service worker (on each alarm, before it expires). The extension stops logging itself out after a while.
- **Habits: time unit, unit selector and end date** — The unit field goes from a freeform input to a **select** (None / common units / **Time (min:seg)** / Custom). Time habits store goal and value in seconds and render as `mm:ss` (with a configurable +/- step); they look the same in the extension and web. New **end date** field (optional, with an "End today" button): after that date the habit stops appearing in Today but the history is kept. Everything travels via `habit.extra` (no migration). Renaming a habit keeps its history (referenced by id) and shows it under the new name.
- **Fix: turning a habit field off now syncs** — Switching a habit from time to counter, or removing its unit/end date, didn't propagate: the local save did a shallow merge (kept the stale key) and the sync apply fell back to the previous value. Now the edit replaces the whole row (`put`) and the apply rebuilds the habit purely from the incoming payload, so "field absent = cleared" reaches the other devices. Also covers `unit`/`unitAmount`/`goal`.
- **Onboarding: template, empty, sync or import** — On a first install without a session, the welcome screen offers **Use template** (seeds sample tasks/habits + preset detection rules) or **Start empty** (clean slate, just the default workspace), plus, for existing Pomodoso users, **Sign in to sync** (opens login and pulls their data) and **Import backup** (restores a .json straight from the welcome screen). Signed-in users skip the choice: their data arrives via sync. The screen's logo is now the brand mark (the extension icon), not the 🍅 emoji.
- **Fix: template tasks didn't sync** — "Use template" seeded its tasks and task order under the literal `'default'` workspace, but by then the default workspace had already been migrated to a real UUID (and `'default'` deleted), so the seeded tasks/order were orphaned and never reached the server (the task order's non-UUID id was skipped on push). The template now seeds into the real active workspace, sample habits are user-global (no workspace), and the startup migration also re-homes any stray `'default'`-scoped rows from older seeds so they sync.

### Emails

- **Generic welcome copy** — The welcome email is no longer dev-specific (dropped the "Linear & GitHub tickets" framing). It now speaks to the generic pillars: tasks & priorities, the pomodoro timer, habits, and calendar/meetings. Personalization (first name) and CTA unchanged.
- **Brand logo** — The email header uses the Pomodoso brand mark (hosted PNG) instead of the 🍅 emoji.
- **Fix: sender domain (Resend 403)** — Emails were sent from `hello@pomodoso.com`, an unverified Resend domain → `403 domain is not verified` (welcome/payment emails silently failed; checkout itself was unaffected). For now we send from the already-verified `otpilot.app` (`Pomodoso <noreply@otpilot.app>`), via `RESEND_FROM_EMAIL`. Switch back to a `@pomodoso.com` sender once that domain is verified in Resend.

### Billing

- **Fix: checkout card-only (Stripe Link `link_pay_token` error)** — Stripe's hosted Checkout + Link was throwing `Received unknown parameter: link_pay_token` on the latest API version, which could block the Pay button. The checkout session now requests `payment_method_types=[card]` (card wallets like Apple/Google Pay still work), disabling Link until Stripe fixes it. Subscription provisioning was never affected.

### Tooling

- **Dev-default builds + `zip` for prod** — Every extension build now defaults to development mode (`.env.development` → `localhost:8080`, dev Supabase), so you can't accidentally load a prod-pointing build locally. A new `pnpm --filter extension zip` produces the Web Store zip from `.env.production` and then restores the dev build (`dist/` always ends on dev). Added a project README documenting local setup and this flow.

### Backend

- **Migration `009_detection_rules_and_extra`** — New `detection_rule` table (TEXT id, user-scoped), `project.end_date` column and `habit.extra` (JSONB) column.
- **Migration `010_habits_user_global`** — `user_id` added to `habit` and `habit_log` (backfilled from the workspace owner); `workspace_id` made nullable (kept for back-compat, no longer used for scoping).
- **Migration `011_meetings`** — New `meeting` table (workspace-scoped, synced like task/project); `/today` returns today's meetings and tasks now carry their workspace name/color.


## v1.0.0 (2026-06-11)

### Sync v2 (extensión + backend)

- **Sync global por usuario** — El sync ya no está atado al workspace activo: push y pull cubren todos los workspaces de la cuenta (incluida la vista "All", que antes desactivaba el sync por completo). Cada entidad viaja con su propio `workspace_id`; el backend valida membresía por entidad.
- **Sync en background** — El push ya no muere al cerrar el popup: cada cambio le avisa al service worker, que sincroniza ~2.5s después aunque el popup esté cerrado. Un alarm cada 1 minuto hace pull periódico, así los cambios de otro dispositivo llegan solos (y la UI abierta se actualiza en vivo vía Dexie liveQuery).
- **Pomodoros y work log en la web** — Los time logs de las tareas se sincronizan como `pomodoro_session`; el dashboard web ahora muestra Work log, Today's time, stats de la semana y el timer activo (beacon `active_timer`, con auto-expiración cuando el pomo vence).
- **Today/Priorities sincronizados** — La membresía y orden de las listas (`task_order`) viaja por sync; la web filtra Today igual que la extensión en vez de mostrar todo el backlog.
- **Identidad de workspace = nombre** — Workspaces con el mismo nombre (creados por otra instalación o un import) convergen en cada sync: gana el UUID menor, las tareas/proyectos/hábitos/meetings/órdenes y la config de calendario migran al canónico y el duplicado se elimina. Renombrar mantiene el UUID. Funciona retroactivamente con duplicados existentes.
- **Campos ricos del task sincronizan** — description, links, notas múltiples, recurrencia, completedDates y preferredMode viajan en `task.extra` (JSONB) y hacen round-trip entre extensiones.
- **`ticket_id` como texto** — La DB guardaba UUID y los IDs reales son strings tipo `INT-455`; ahora es TEXT y no se pierde.
- **Timer remoto visible** — Si hay un pomodoro corriendo en otro dispositivo, el popup muestra un banner con la tarea y el tiempo restante.
- **Dispositivos** — Cada instalación se registra con un UUID propio (tipo, browser, versión, last seen/last sync) y se lista en la web en Plan & devices.
- **Estados de sync no alarmantes** — "Sync error — backend offline?" → "Sync paused — will retry automatically"; nuevo estado **Offline** (gris) cuando no hay internet, con reintento automático al volver la conexión.

### Extension

- **Reglas de detección conectadas** — Las reglas de Settings ahora funcionan: las custom (y presets sin content script como Jira/Notion) matchean la URL del tab — el capture group 1 del regex es el ID del ticket y el título del tab el título. Los toggles de Linear/GitHub/arXiv ahora silencian de verdad su detección nativa.
- **Fix: Linear no detectaba keys con dígitos** — `DP1-3584` no matcheaba (el regex solo aceptaba letras en la key del equipo). Ahora soporta keys alfanuméricas.
- **Export/Import arreglado** — El backup ya no incluye estado de sync (`sync_last_pull`, `syncedAt`, `device_id`): al importar, todo se re-pushea y se hace pull completo — los proyectos asociados a tasks ya no se pierden. La config de Google Calendar se exporta/importa y sobrevive los merges de workspace. Importar sobre un workspace existente lo fusiona en vez de duplicarlo.
- **Recuperar contraseña** — Link "Forgot password?" en el login (extensión y web) que manda el mail de reset; nueva página `/reset-password` en la web para definir la nueva.
- **Sin datos de ejemplo duplicados** — Una segunda instalación con sesión iniciada ya no crea las tareas/hábitos de muestra; espera los datos del sync.

### Web

- **Vista "All workspaces"** en el dashboard, igual que en la extensión.
- **Generate report** — Reporte diario en markdown (tareas, work log por proyecto, hábitos, stats) con copiar/descargar.
- **Plan & devices** — Billing rediseñado con el layout del dashboard (sidebar compartido) + lista de dispositivos de la cuenta.
- Empty state claro cuando todavía no hay datos sincronizados; ticket pills en work log y focus banner; íconos de navegadores en la landing.

---

## v0.0.6 (2026-06-02)

### Extension

- **Recurring tasks** — Any task can now repeat on a schedule. Open the task detail and use the new **Repeat** field to set a frequency (daily, weekly, monthly, or yearly), specific days/time, and optional start/end dates. Recurring tasks live in a dedicated **Recurring** section inside the Tasks tab (separate from the backlog) and appear automatically in Today when their scheduled time arrives. Completing a recurring task marks it done for that day only — it resets to `todo` and reappears the next scheduled day. Notes, time logs, and all other task data are shared across every occurrence (it's always the same task object, not a new one per day). A `↺` icon marks recurring tasks in Today.

---

## v0.0.5 (2026-06-01)

### Extension

- **Fix: tab activo se resetea al volver de una tarea** — Al abrir el detalle de una tarea desde Habits, Tasks o Schedule y volver, la vista siempre regresaba a Today. El estado `activeTab` ahora vive en `App` en vez de dentro de `HomeState`, por lo que sobrevive el desmontaje del componente durante la navegación.

- **Welcome screen & sample data** — New users now see a welcome screen on first install that previews the pre-seeded sample habits (Drink Water, Read, Exercise) and tasks (Set up workspace, First pomodoro, Connect Calendar, Customize habits, Explore backlog). Dismissing the screen marks the user as onboarded and the sample data is already in place — no extra step needed.

- **WeekStrip now uses real habit data** — The 7-day completion grid in the Habits tab previously showed hardcoded placeholder data. It now queries actual `habitHistory` records from the local DB and computes per-day completions for the current week based on each habit's goal. Future days are faded out. Respects the "Week starts on" setting configured in Settings → General.

- **Calendar connect UI improved** — The "not connected" state in Settings → Calendar now shows a structured layout with a short description, a bulleted benefit list ("Meetings appear in the Schedule tab", "Choose which calendars to sync", "Log time per meeting with one click"), and a prominent connect button. Previously it was a plain text paragraph.

- **Fix: `weekStart is not defined` crash** — `HabitsContent` and `TodayHabits` were referencing `weekStart` and `timezone` without having them in scope, crashing the Habits tab on every open. Fixed by propagating the settings as props through both components.

- **Fix: drag entre secciones no funciona en workspace "All"** — En la vista All, arrastrar una tarea de Other Tasks a Priorities (o viceversa) no tenía efecto. El problema era que `reorderToday` solo actualizaba la clave de ordering `'all'`, pero la pertenencia a cada sección vive en los órdenes individuales de cada workspace. Ahora detecta los IDs que cambiaron de sección y actualiza el workspace order correspondiente.

---

## v0.0.4 (2026-06-01)

### Extension

- **Habits filter by configured days** — Habits in the Today tab now only appear on the days they're configured for. Previously all habits were shown every day regardless of their schedule.

- **Week start and work days settings** — New options in Settings → General: choose whether the week starts on Monday or Sunday, and configure which days are work days (default Mon–Fri). The week start is used to compute "this week" in task and habit history — previously hardcoded to the last 7 days. Work days are stored for future use in history filtering.

- **Multi-note system** — Task notes are now a list of individual entries instead of a single text field. Each note is timestamped automatically (`Jun 1 · 2:30 PM`), editable inline, and deletable. Notes start collapsed showing a preview of the first line; clicking expands them. New notes open expanded and focused. Existing tasks with a legacy `notes` field are migrated automatically on first open.

---

## v0.0.3 (2026-06-01)

### Extension

- **Import / Export de datos** — Nueva sección "Data" en Settings. Export descarga un JSON (`pomodoso-YYYY-MM-DD.json`) con todas las tablas: tasks, projects, workspaces, habits, habit history, meetings, task orders, detection rules y settings. Import restaura ese archivo reemplazando toda la DB — muestra un warning de confirmación antes de proceder y recarga la extensión al terminar. Útil para mover datos entre instancias (prod ↔ dev) o como backup. Las conexiones OAuth de Google Calendar no se transfieren entre perfiles de Chrome, pero los registros de meetings sí.

---

## v0.0.2 (2026-06-01)

### Extension

- **Compact task cards with tooltips** — Task cards now show only the title and a workspace color dot, reducing card height from ~60px to ~36px. Hovering reveals a tooltip (above the card, using `position: fixed` to escape the scroll container) with status badge, ticket ID, time logged, pomodoro count, link count, follow-up indicator, project, and workspace. Pomodoro count is calculated as `round(totalPomoSeconds / focusSeconds)` rather than counting log entries.

- **WIP / Delayed status indicator** — Tasks with "In Progress" or "Delayed" status now show a colored border on the status checkbox (yellow for WIP, purple for Delayed), matching the existing green fill for Done.

- **Linked tasks banner** — When the current tab URL matches a link saved on one or more tasks, a "Linked task(s)" banner appears above the task list. Each task is listed as a clickable row that opens the task detail directly. The banner is suppressed if all linked tasks are already in Today.

- **Detection banner in view mode** — The "On this page" detection banner now correctly shows in view mode when visiting a known ticket page (Linear, GitHub, Sentry, arXiv) that is already linked to one or more tasks. Supports multiple linked tasks — each listed as a clickable row with its status and a ↩ follow-up button. Previously the banner was always suppressed when a matching task existed.

- **Linked tasks hidden when already in Today** — Neither the detection banner nor the linked tasks banner appear for tasks already visible in Today's list.

- **Task ID now saves on blur** — Editing the Task ID field in the task detail view now persists on blur. Previously changes were lost on navigation.

- **Workspace change moves task order** — Changing a task's workspace now moves it from the old workspace's Today/Priority order to the new one. Previously the task appeared in both workspaces simultaneously.

- **Duplicate time log entries fixed** — Clicking ✓ Done during an active pomodoro was creating two identical log entries. Fixed by clearing the `pendingSegment` the background creates on detach immediately after the popup writes its own entry.

- **Pomodoro count not persisting across sessions** — Fixed a bug where the daily pomodoro counter reset to 0 after each completed session. The `pomosDate` field was not being carried over when transitioning between timer states, causing the date check to always reset the counter.

- **arXiv detection** — Papers on arxiv.org are now automatically detected. Opening the popup on any `arxiv.org/abs/*` page surfaces the paper title and ID with a one-click option to add it to the backlog or link it to an existing task.

- **Detection banner no longer repeats for known tickets** — Once a ticket or paper is added to the backlog or linked to a task, the detection banner no longer appears on subsequent visits to that page. The banner is now a discovery tool for new items only.

- **Persistent dismiss** — Dismissing a detection banner now survives popup close/reopen within the same browser session. Previously, the banner would reappear every time the popup was opened on the same page.

- **Detection banner visible during active pomodoro** — The detection banner is now shown even when a pomodoro is running, so tickets can be added to the backlog or linked to tasks without interrupting the session.

- **"Complete pomo" button label** — Renamed from "Finish pomo" to "Complete pomo" for clarity.

- **Calendar not showing today's meetings** — Fixed three compounding bugs: (1) `timeMin`/`timeMax` were constructed without a timezone offset, so the API query covered the wrong UTC day for non-zero-offset timezones; (2) meetings soft-deleted by a previous bad sync were not being un-deleted when they reappeared in the API response; (3) Google OAuth credentials (`CLIENT_ID`/`CLIENT_SECRET`) were not being injected into the build because Vite was looking for `.env` files in `src/` instead of the project root — fixed by adding `envDir` to `vite.config.ts`.

---

## v0.0.1 (2026-05-30)

### Extension

- **Pomodoro Timer** — 25-minute focus sessions with configurable duration, short breaks (5m), long breaks (15m every 4 pomodoros), and automatic transitions. Badge shows remaining minutes in real time.

- **Break Controls** — Skip, snooze (+5m), or extend breaks from the popup. A 3-second warning appears before each break starts.

- **Stopwatch Mode** — Free-form time tracking for meetings or unplanned work, separate from the pomodoro cycle.

- **Task Management** — Create, prioritize, and track tasks with statuses (todo / in progress / done / delayed / cancelled). Supports a daily "Priorities" list (max 3) and a general backlog. Full drag-and-drop reordering between categories.

- **Task Time Logging** — Time is automatically logged per task during each pomodoro session. Manual log entries can also be added.

- **Task Links** — Attach URLs with labels to tasks (tickets, PRs, docs) directly from the task detail view.

- **Habit Tracking** — Boolean (done/not-done) and counter-based habits with custom icons and units. Completion is detected automatically when the daily goal is met. Includes a 7-day history grid.

- **Multiple Workspaces** — Organize tasks and habits into named, color-coded workspaces. An "All" view merges everything across workspaces.

- **Google Calendar Sync** — Connect a Google account and choose which calendars to sync. Today's meetings appear in the popup with tracking modes: off, always, or ask. Recurring event preferences are inherited from prior occurrences.

- **Automatic Ticket Detection** — Content scripts detect open issues and PRs on Linear, GitHub, and Sentry and surface a one-click "Start working on this" prompt in the popup.

- **Custom Detection Rules** — Add URL patterns to trigger task creation on any site. Preset rules for Linear, GitHub, Gmail, Notion, Jira, Figma, and ClickUp.

- **Text Selection Capture** — Selecting text on any page sends it to the popup for quick task creation.

- **Break Overlay** — A non-intrusive on-page overlay shows the break countdown and pomodoro count without requiring the popup to be open.

- **Sound Notifications** — Configurable audio alerts for pomodoro end, break start, break end, focus start, and task done. Per-event toggles and volume control.

- **Mini Window** — A floating compact timer appears 10 seconds before a pomodoro ends for quick awareness.

- **Settings** — Configure all timer durations, daily goal, sound preferences, timezone, max priorities, and workspace list from a dedicated settings panel.

- **Local Storage** — All data is stored in IndexedDB (Dexie.js) locally on the device. No account required.
