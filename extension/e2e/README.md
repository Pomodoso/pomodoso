# Extension end-to-end checks

```bash
pnpm --filter extension e2e
```

Builds the extension, launches a throwaway Chrome, loads it, and drives the
**real browser-action popup** — the window that opens when you click the
toolbar icon.

## Why this exists

Reordering tasks was completely broken in the popup while every check in CI
passed. Type-checking, builds and unit tests all run against code nobody opens;
the popup's HTML rendered in a *tab* was tested by hand and worked fine.

It worked in a tab because a tab is not a popup. The popup **window** emits
`resize` events that aren't resizes, and dnd-kit treats a resize as "cancel the
drag" — so every drag cancelled itself a few pixels in. Two fixes shipped for
symptoms that only existed in the tab before the real popup was driven, which
reproduced the actual bug on the first attempt.

So: the checks here are few, slow, and deliberately end-to-end. They cover
behaviour no cheaper test can see.

| check | the regression it guards |
|---|---|
| dragging a task reorders it | the popup's phantom `resize` cancelling every drag |
| a plain click still opens the task | the row is both a drag target and a click target |
| a missed day offers keep-going / start-over | a missed day used to silently reset a run to day 0 |
| the skip cost is on the button | learning at day 21 that the badge died on day 8 |
| a run complete from history records it | completion was recomputed, so a rest day revoked the trophy |
| a clean 21-day run awards a medal | awards written only on a fresh toggle were lost |
| the medal shows its tier | — |
| a backup carries the run and its medal | a new table missed in `backup.ts` loses that data silently |
| import restores both | challenge state rides on the habit row, where partial writes drop it |

## It needs an unlocked screen

`chrome.action.openPopup()` requires a **focused** browser window, and macOS
will not let a background app take focus while the session is locked — not via
CDP (`Page.bringToFront`, `Target.activateTarget`), not via the extension API
(`chrome.windows.update({focused: true})`), and not via AppleScript. With the
screen locked every run fails on the first check with "Could not find an active
browser window", which looks like a product bug and is not one.

If you get that error, check the session first:

```bash
ioreg -n Root -d1 -a | grep -A1 CGSSessionScreenIsLocked   # <true/> means locked
```

This is also the part of wiring it into CI that needs real thought: a headless
Linux runner has no focused window either, so it would want Xvfb plus a window
manager that grants focus — not just a `CHROME_PATH`.

## Not in CI

Deliberately, for now. It needs a real Chrome, takes a couple of minutes, and a
flaky end-to-end check blocking every PR is worse than none. Run it before
cutting a release, and after touching anything drag- or challenge-related.

Wiring it into CI is a reasonable next step — it would want a Linux Chrome path
via `CHROME_PATH`, a verification that the pipe transport behaves the same on a
runner, and an answer to the focus problem above.

## How it works

Two Chrome details shape the whole thing:

- **Chrome 137+ ignores `--load-extension`.** `Extensions.loadUnpacked` is the
  supported replacement, gated behind `--enable-unsafe-extension-debugging`,
  which itself requires `--remote-debugging-pipe` rather than a debugging port.
  So the transport is fds 3/4 carrying NUL-delimited JSON, not a websocket.
- **`chrome.action.openPopup()` needs a focused browser window**, or it fails
  with "Could not find an active browser window". Tests that open and close
  tabs can leave none focused, so `openPopup` makes one and retries.

Other things that cost time once, recorded so they don't again:

- The Dexie database is named `pomodoso`, not `PomoDB`.
- `chrome.storage.local` is extension storage, **not** web storage for the
  origin, so `Storage.clearDataForOrigin` leaves `pom_onboarded` behind.
  `resetStorage` clears both.
- Buttons wrap an icon and a label across lines, so anchored patterns must be
  matched against trimmed `innerText`.
- A 21-day run can't be produced by clicking for 21 days; `fixtures.mjs` writes
  history straight into IndexedDB.
- Settings lives behind the header's icon-only **Menu** button, which has no
  text to match on — only `title="Menu"`.
- Exporting must not actually download. A real download hands focus to Chrome's
  download UI, and a popup closes the moment it loses focus, so the download
  takes the window the rest of the test needs. The export check stubs the
  anchor's `click` and reads the blob instead; `exportDb()` still runs for real.
- Reading a list right after a drop counts dnd-kit's `DragOverlay` clone — four
  titles for three tasks. Scope DOM reads to `[aria-roledescription="sortable"]`.

## Files

- `driver.mjs` — Chrome launch, CDP pipe transport, popup/tab sessions, `drag`
- `fixtures.mjs` — seeding and reading habit/challenge/achievement state
- `run.mjs` — the checks themselves
