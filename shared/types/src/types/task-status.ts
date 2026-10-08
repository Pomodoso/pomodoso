// User-defined task statuses, shared by every client.
//
// Every rule in the app — done/cancelled close a task, starting the timer
// marks it in progress, finishing a recurring task schedules the next one,
// Today sorts by status — is keyed on five base statuses. Letting users name
// their own statuses without touching any of that comes down to one move: a
// custom status is a *label over a base status*. "In review" is stored as
// `status: 'in_progress'` plus `statusId` pointing at the custom definition,
// so every existing rule, every backend query and every client that predates
// this keeps reading the base status and keeps behaving correctly.
//
// The definitions travel as one synced setting (`task_statuses`), not as rows:
// they are a handful of entries edited rarely, and the setting pipeline
// already exists on both clients. The cost is that edits from two devices at
// once resolve by last-write-wins on the whole list.

export const BASE_TASK_STATUSES = ['todo', 'in_progress', 'done', 'delayed', 'cancelled'] as const;
export type BaseTaskStatus = (typeof BASE_TASK_STATUSES)[number];

export const BASE_TASK_STATUS_LABELS: Record<BaseTaskStatus, string> = {
  todo: 'Todo',
  in_progress: 'In progress',
  done: 'Done',
  delayed: 'Delayed',
  cancelled: 'Cancelled',
};

/**
 * Bases the app itself moves tasks into — new tasks start in todo, the timer
 * sets in_progress, checking a task sets done — so each must always keep at
 * least one visible status to land on. delayed and cancelled are only ever
 * chosen by hand, so they can be hidden entirely.
 */
export const REQUIRED_BASE_STATUSES: readonly BaseTaskStatus[] = ['todo', 'in_progress', 'done'];

export interface CustomTaskStatus {
  id: string;
  label: string;
  /** The base status this one behaves as. */
  base: BaseTaskStatus;
}

export interface TaskStatusConfig {
  /** Default statuses the user has hidden from pickers. */
  hidden: BaseTaskStatus[];
  custom: CustomTaskStatus[];
}

export const DEFAULT_TASK_STATUS_CONFIG: TaskStatusConfig = { hidden: [], custom: [] };

/** One entry in a status picker, or the resolved status of a task. */
export interface TaskStatusOption {
  base: BaseTaskStatus;
  /** null for a default status. */
  statusId: string | null;
  label: string;
}

export function isBaseTaskStatus(value: unknown): value is BaseTaskStatus {
  return typeof value === 'string' && (BASE_TASK_STATUSES as readonly string[]).includes(value);
}

/**
 * Reads a stored or pulled config, dropping anything malformed instead of
 * throwing. A bad entry from a future or buggy client must cost that entry,
 * not every status picker on this device.
 */
export function parseTaskStatusConfig(value: unknown): TaskStatusConfig {
  if (typeof value !== 'object' || value === null) return DEFAULT_TASK_STATUS_CONFIG;
  const raw = value as { hidden?: unknown; custom?: unknown };
  const hidden = Array.isArray(raw.hidden) ? raw.hidden.filter(isBaseTaskStatus) : [];
  const seen = new Set<string>();
  const custom: CustomTaskStatus[] = [];
  for (const c of Array.isArray(raw.custom) ? raw.custom : []) {
    if (typeof c !== 'object' || c === null) continue;
    const { id, label, base } = c as Partial<CustomTaskStatus>;
    if (typeof id !== 'string' || !id || seen.has(id)) continue;
    if (typeof label !== 'string' || !label.trim() || !isBaseTaskStatus(base)) continue;
    seen.add(id);
    custom.push({ id, label: label.trim(), base });
  }
  return repairRequired({ hidden: [...new Set(hidden)], custom });
}

/**
 * Un-hides a required base that has nothing visible left. Edits are guarded
 * so this can't happen locally, but two devices can each make an edit that is
 * legal alone and illegal together, and LWW keeps only one of them.
 */
function repairRequired(config: TaskStatusConfig): TaskStatusConfig {
  const stranded = REQUIRED_BASE_STATUSES.filter(b => visibleCount(config, b) === 0);
  if (stranded.length === 0) return config;
  return { ...config, hidden: config.hidden.filter(b => !stranded.includes(b)) };
}

function visibleCount(config: TaskStatusConfig, base: BaseTaskStatus): number {
  return (config.hidden.includes(base) ? 0 : 1) + config.custom.filter(c => c.base === base).length;
}

/** Visible statuses, in picker order: each default, followed by the custom
 *  statuses that map to it. */
export function taskStatusOptions(config: TaskStatusConfig): TaskStatusOption[] {
  const out: TaskStatusOption[] = [];
  for (const base of BASE_TASK_STATUSES) {
    if (!config.hidden.includes(base)) {
      out.push({ base, statusId: null, label: BASE_TASK_STATUS_LABELS[base] });
    }
    for (const c of config.custom) {
      if (c.base === base) out.push({ base, statusId: c.id, label: c.label });
    }
  }
  return out;
}

/**
 * What a task with this base status and status id shows as.
 *
 * The base wins over the id: a client that predates custom statuses changes
 * `status` and leaves `statusId` untouched, so an id whose definition maps to
 * a different base is stale and is ignored. An id whose definition is gone
 * (deleted, or not synced yet) falls back to the base too.
 */
export function resolveTaskStatus(
  base: BaseTaskStatus,
  statusId: string | null | undefined,
  config: TaskStatusConfig,
): TaskStatusOption {
  const custom = statusId ? config.custom.find(c => c.id === statusId) : undefined;
  if (custom && custom.base === base) return { base, statusId: custom.id, label: custom.label };
  return { base, statusId: null, label: BASE_TASK_STATUS_LABELS[base] };
}

/**
 * The status id to store when the app — not the user — moves a task to
 * `nextBase` (the timer starting, a recurring task resetting, a quick check).
 *
 * A custom status that already maps to `nextBase` is kept: starting the timer
 * on an "In review" task shouldn't relabel it "In progress". Otherwise the
 * default is used, unless the user has hidden it, in which case the first
 * custom status mapped to that base stands in.
 */
export function statusIdForSystemChange(
  nextBase: BaseTaskStatus,
  currentStatusId: string | null | undefined,
  config: TaskStatusConfig,
): string | null {
  const current = currentStatusId ? config.custom.find(c => c.id === currentStatusId) : undefined;
  if (current && current.base === nextBase) return current.id;
  if (!config.hidden.includes(nextBase)) return null;
  return config.custom.find(c => c.base === nextBase)?.id ?? null;
}

// ─── Edits ────────────────────────────────────────────────────────────────────
//
// Each returns the new config, or null when the edit would leave a required
// base with no visible status. Callers show why instead of applying it.

export function canRemoveFromBase(config: TaskStatusConfig, base: BaseTaskStatus): boolean {
  return !REQUIRED_BASE_STATUSES.includes(base) || visibleCount(config, base) > 1;
}

export function setBaseStatusHidden(
  config: TaskStatusConfig,
  base: BaseTaskStatus,
  hidden: boolean,
): TaskStatusConfig | null {
  if (!hidden) return { ...config, hidden: config.hidden.filter(b => b !== base) };
  if (config.hidden.includes(base)) return config;
  if (!canRemoveFromBase(config, base)) return null;
  return { ...config, hidden: [...config.hidden, base] };
}

export function addCustomTaskStatus(
  config: TaskStatusConfig,
  status: CustomTaskStatus,
): TaskStatusConfig | null {
  const label = status.label.trim();
  if (!label) return null;
  return { ...config, custom: [...config.custom, { ...status, label }] };
}

export function updateCustomTaskStatus(
  config: TaskStatusConfig,
  id: string,
  changes: Partial<Omit<CustomTaskStatus, 'id'>>,
): TaskStatusConfig | null {
  const existing = config.custom.find(c => c.id === id);
  if (!existing) return null;
  const label = (changes.label ?? existing.label).trim();
  if (!label) return null;
  if (changes.base && changes.base !== existing.base && !canRemoveFromBase(config, existing.base)) return null;
  const next = { ...existing, ...changes, label };
  return { ...config, custom: config.custom.map(c => (c.id === id ? next : c)) };
}

/**
 * Removes a custom status. Tasks that carry its id aren't rewritten — they
 * fall back to their base status through resolveTaskStatus, which is the
 * behaviour the custom status already had.
 */
export function removeCustomTaskStatus(config: TaskStatusConfig, id: string): TaskStatusConfig | null {
  const existing = config.custom.find(c => c.id === id);
  if (!existing) return config;
  if (!canRemoveFromBase(config, existing.base)) return null;
  return { ...config, custom: config.custom.filter(c => c.id !== id) };
}
