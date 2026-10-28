---
name: pomodoso-plugin
description: Write, fix or update a Pomodoso plugin — a single YAML file that becomes a small app inside Pomodoso (a tracker, a list, a year in pixels…). Use when the user asks for a Pomodoso plugin or app, wants to change one, or pastes a plugin file with errors.
---

# Writing a Pomodoso plugin

A Pomodoso plugin is one YAML file. Pomodoso validates it and renders it with built-in components: the file can't run code, so everything has to come from the catalog in the reference. Never invent a block type, field type, operator or key.

## 1. Read the reference first

Fetch https://pomodoso.com/llms-full.txt before writing anything. It lists every block, field type, computed value, Today widget and hook with their properties, the rules that trip people up, and five complete examples. Copy the patterns of the closest example; they are known to be valid.

## 2. Write the whole file

- Start from what the user wants to track or keep, then pick the collection kind: `event` for things that happen (a glass of water), `item` for things you keep (a book), `daily` for one value per day (a mood).
- Keep the first version small: one view, the fields the user mentioned, one or two stats. Offer extras after it validates.
- The plugin `id` is lower-kebab-case and never changes. Every other key is lower_snake_case.
- A one-tap action (counter-button, mini-counter, a hook's `yes`, a day pick) has no form: every required field of its collection must be optional, have a `default`, or be set by the action.
- Read values with `$name`; put them in text with `{$name}`.

## 3. Validate, then fix until it passes

```
npx @pomodoso/plugin validate my-plugin.yaml
```

Each problem names the path (`views[0].blocks[2].type`), what was expected and what's available, with a "did you mean" when there's a near match. Fix exactly what it says and run it again. Don't hand the file over until it prints `✓ … is a valid plugin file`. If `npx` isn't available, check the file against https://pomodoso.com/schema/plugin.v1.json and the rules in the reference.

## 4. Updating a published plugin

Validate the new version against the published one:

```
npx @pomodoso/plugin validate my-plugin.yaml --against https://api.pomodoso.com/plugins/directory/<id>/versions/<published version>
```

- **additive** (new optional fields, options, views, blocks, wording): bump the minor (`1.2.0` → `1.3.0`) or the patch for fixes.
- **breaking** (renaming or removing a field, collection or option; changing a type or kind; a new required field without a default): bump the major (`1.4.0` → `2.0.0`) and add a `migrate` block whose steps cover every breaking change:

  ```yaml
  migrate:
    from: "1.x"
    steps:
      - { rename_field: { collection: book, from: author, to: authors } }
      - { map_values: { collection: book, field: status, map: { wishlist: want } } }
      - { drop_field: { collection: book, field: isbn } }
  ```

  Prefer an additive change when one does the job (add a new field instead of changing a type).

## 5. Explain the result

Tell the user, in a few lines: what the plugin shows, what it stores, how to install it (Pomodoso → Apps → Add an app → From a file, or paste it), and for an update whether it's additive or breaking and what happens to their existing entries.
