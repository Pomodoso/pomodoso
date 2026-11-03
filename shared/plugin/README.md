# @pomodoso/plugin

Check [Pomodoso](https://pomodoso.com) app files (plugins) from the command line, with the same validator Pomodoso runs when you install or publish one.

A Pomodoso app is a single YAML file that becomes a small tracker inside Pomodoso: a water counter, a reading list, a year in pixels. Most are written by an AI assistant. This CLI is how the assistant (or you) knows the file is right before installing it.

```
npx @pomodoso/plugin validate my-app.yaml
```

```
✗ my-app.yaml: 1 problem
  views[0].blocks[0].type: unknown type "kanban" available: counter-button, add-button, form, stat, stat-row, progress, chart, list, tag-filter, board, year-grid, day-picker, breakdown, text
```

```
✓ my-app.yaml is a valid plugin file
```

## Updating a published app

Compare a new version with the one in the directory to see whether the update is additive or breaking, and what a breaking one still needs (a new major version and a `migrate` block):

```
npx @pomodoso/plugin validate my-app.yaml --against https://api.pomodoso.com/plugins/directory/my-app/versions/1.2.0
```

`--against` also takes a local file.

## Options

| | |
|---|---|
| `validate <file>` | Check a file the way Pomodoso does. |
| `--against <file or URL>` | Compare with a previous version and classify the update. |
| `--json` | Print the result as JSON, for agents and scripts. |

Exit code: `0` when the file is valid (and, with `--against`, publishable as an update), `1` otherwise, `2` on a usage error.

## Writing an app

- Reference for AI assistants: <https://pomodoso.com/llms-full.txt>
- JSON Schema: <https://pomodoso.com/schema/plugin.v1.json>
- Guide and starter prompt: <https://pomodoso.com/apps/build>
- Browse published apps: <https://pomodoso.com/apps>

Requires Node 20 or later. MIT licensed.
