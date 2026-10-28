import { validatePluginData } from '@pomodoso/types/plugins';

import type { PluginRow } from '../../db';

// A plugin pulled by sync carries whatever manifest another client stored:
// a newer schema version, or a broken one. Installing from a file validates
// it; sync can't (the engine stays out of the popup bundle), so every place
// that renders or evaluates a plugin checks here first and skips the rest.

const verdicts = new WeakMap<object, boolean>();

export function isSupported(plugin: PluginRow): boolean {
  const m = plugin.manifest as unknown;
  if (m === null || typeof m !== 'object') return false;
  let ok = verdicts.get(m);
  if (ok === undefined) {
    ok = validatePluginData(m).ok;
    verdicts.set(m, ok);
  }
  return ok;
}
