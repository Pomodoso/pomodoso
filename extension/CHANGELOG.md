# Changelog


## v0.0.5 (2026-06-01)

### Extension

- **Welcome screen & sample data** — New users now see a welcome screen on first install that previews the pre-seeded sample habits (Drink Water, Read, Exercise) and tasks (Set up workspace, First pomodoro, Connect Calendar, Customize habits, Explore backlog). Dismissing the screen marks the user as onboarded and the sample data is already in place — no extra step needed.

- **WeekStrip now uses real habit data** — The 7-day completion grid in the Habits tab previously showed hardcoded placeholder data. It now queries actual `habitHistory` records from the local DB and computes per-day completions for the current week based on each habit's goal. Future days are faded out. Respects the "Week starts on" setting configured in Settings → General.

- **Calendar connect UI improved** — The "not connected" state in Settings → Calendar now shows a structured layout with a short description, a bulleted benefit list ("Meetings appear in the Schedule tab", "Choose which calendars to sync", "Log time per meeting with one click"), and a prominent connect button. Previously it was a plain text paragraph.

- **Fix: `weekStart is not defined` crash** — `HabitsContent` and `TodayHabits` were referencing `weekStart` and `timezone` without having them in scope, crashing the Habits tab on every open. Fixed by propagating the settings as props through both components.

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
