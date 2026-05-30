# Changelog

## v0.0.2 (2026-xx-xx)

### Extension

- **Pomodoro count not persisting across sessions** — Fixed a bug where the daily pomodoro counter reset to 0 after each completed session. The `pomosDate` field was not being carried over when transitioning between timer states, causing the date check to always reset the counter.

- **arXiv detection** — Papers on arxiv.org are now automatically detected. Opening the popup on any `arxiv.org/abs/*` page surfaces the paper title and ID with a one-click option to add it to the backlog or link it to an existing task.

- **Detection banner no longer repeats for known tickets** — Once a ticket or paper is added to the backlog or linked to a task, the detection banner no longer appears on subsequent visits to that page. The banner is now a discovery tool for new items only.

- **Persistent dismiss** — Dismissing a detection banner now survives popup close/reopen within the same browser session. Previously, the banner would reappear every time the popup was opened on the same page.

- **Detection banner visible during active pomodoro** — The detection banner is now shown even when a pomodoro is running, so tickets can be added to the backlog or linked to tasks without interrupting the session.

- **"Complete pomo" button label** — Renamed from "Finish pomo" to "Complete pomo" for clarity.

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
