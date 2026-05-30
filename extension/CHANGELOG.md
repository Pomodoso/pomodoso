# Changelog

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
