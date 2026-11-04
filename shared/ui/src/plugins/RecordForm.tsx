import { useState, type CSSProperties } from 'react';

import {
  fieldLabel,
  fieldOptions,
  missingFields,
  type PluginCollection,
  type PluginField,
} from '@pomodoso/types/plugins';

import { buttonStyle, inputStyle, labelStyle } from './styles.js';

/** A record or task a `ref` / `task` field can point to. */
export interface FieldChoice {
  value: string;
  label: string;
}

interface RecordFormProps {
  collection: PluginCollection;
  /** What a `ref` or `task` field can be set to (records of its collection, the user's tasks). */
  choices?: ((field: PluginField) => FieldChoice[] | undefined) | undefined;
  settings: Record<string, unknown>;
  initial: Record<string, unknown>;
  submitLabel: string;
  disabled?: boolean | undefined;
  /**
   * Event collections only: when it happened (ISO). The form shows a "When"
   * input starting here, so a forgotten one can be logged on its real day.
   */
  occurredAt?: string | undefined;
  /** May return a promise; Save stays disabled until it settles. `occurredAt` is set for events. */
  onSubmit: (data: Record<string, unknown>, occurredAt?: string) => void | Promise<unknown>;
  onCancel?: (() => void) | undefined;
  onDelete?: (() => void) | undefined;
}

/** One input per field of a collection. Submitting is blocked until required fields are filled. */
export function RecordForm({ collection, settings, initial, occurredAt, choices, submitLabel, disabled, onSubmit, onCancel, onDelete }: RecordFormProps) {
  const isEvent = collection.kind === 'event';
  const [when, setWhen] = useState(() => toLocalInput(occurredAt ?? new Date().toISOString()));
  // Untouched, a new event happens when it's saved, not when the form opened.
  const [whenTouched, setWhenTouched] = useState(false);
  // A checkbox has no "unanswered" look: an unset boolean starts as its
  // default (a record may predate it), else as the false it shows.
  const [data, setData] = useState<Record<string, unknown>>(() => {
    const out = { ...initial };
    for (const f of collection.fields) if (f.type === 'boolean' && out[f.key] === undefined) out[f.key] = f.default ?? false;
    return out;
  });
  // Blocks a second submit while the first write is in flight (it would add a duplicate).
  const [pending, setPending] = useState(false);
  const missing = missingFields(collection, data);
  const set = (key: string, v: unknown) => setData((d) => ({ ...d, [key]: v }));

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (missing.length > 0 || disabled || pending) return;
        const at = isEvent && whenTouched ? fromLocalInput(when) : undefined;
        const result = onSubmit(clean(data), at);
        if (result instanceof Promise) {
          setPending(true);
          void result.finally(() => setPending(false));
        }
      }}
      style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
    >
      {isEvent ? (
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={labelStyle}>When</span>
          <input
            type="datetime-local"
            value={when}
            max={toLocalInput(new Date().toISOString())}
            disabled={disabled}
            onChange={(e) => {
              setWhen(e.target.value);
              setWhenTouched(true);
            }}
            style={inputStyle}
          />
        </label>
      ) : null}
      {collection.fields.map((f) => (
        <label key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={labelStyle}>
            {fieldLabel(f)}
            {f.optional ? <span style={{ color: 'var(--color-text-faint)', fontWeight: 400 }}> · optional</span> : null}
          </span>
          <FieldInput field={f} collection={collection.key} settings={settings} value={data[f.key]} disabled={disabled} choices={choices?.(f)} onChange={(v) => set(f.key, v)} />
        </label>
      ))}
      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', alignItems: 'center' }}>
        {onDelete ? (
          <button type="button" onClick={onDelete} disabled={disabled} style={{ ...buttonStyle('ghost'), color: 'var(--color-accent)', marginRight: 'auto' }}>
            Delete
          </button>
        ) : null}
        {onCancel ? (
          <button type="button" onClick={onCancel} style={buttonStyle('ghost')}>
            Cancel
          </button>
        ) : null}
        <button type="submit" disabled={disabled || pending || missing.length > 0} style={buttonStyle('primary')}>
          {submitLabel}
        </button>
      </div>
    </form>
  );
}

/** An ISO timestamp as a datetime-local value, in the browser's time zone. */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** A datetime-local value back to ISO; empty or invalid means "now". */
function fromLocalInput(v: string): string {
  const d = v ? new Date(v) : new Date();
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

/** Drops empty strings so an untouched optional field isn't stored as "". */
function clean(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (typeof v === 'string' && v.trim() === '') continue;
    out[k] = typeof v === 'string' ? v.trim() : v;
  }
  return out;
}

// Typing limits, so a single field can't take a record past the stored size
// limit (PLUGIN_VALUES_MAX_BYTES, 64 KB); the write still checks the total.
const TEXT_MAX = 2000;
const LONGTEXT_MAX = 20000;

interface FieldInputProps {
  field: PluginField;
  collection: string;
  settings: Record<string, unknown>;
  value: unknown;
  disabled?: boolean | undefined;
  /** For `ref` and `task` fields. */
  choices?: FieldChoice[] | undefined;
  onChange: (v: unknown) => void;
}

export function FieldInput({ field: f, collection, settings, value, disabled, choices, onChange }: FieldInputProps) {
  const str = typeof value === 'string' ? value : '';
  const num = typeof value === 'number' ? value : undefined;

  switch (f.type) {
    case 'text':
    case 'url':
    case 'image_url':
      return (
        <input
          type={f.type === 'text' ? 'text' : 'url'}
          value={str}
          maxLength={TEXT_MAX}
          disabled={disabled}
          placeholder={f.type === 'text' ? '' : 'https://'}
          onChange={(e) => onChange(e.target.value)}
          style={inputStyle}
        />
      );
    case 'longtext':
      return <textarea value={str} disabled={disabled} rows={3} maxLength={LONGTEXT_MAX} onChange={(e) => onChange(e.target.value)} style={{ ...inputStyle, resize: 'vertical' }} />;
    case 'date':
      return <input type="date" value={str} disabled={disabled} onChange={(e) => onChange(e.target.value)} style={inputStyle} />;
    case 'number':
    case 'duration':
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input
            type="number"
            step="any"
            value={num ?? ''}
            min={f.min}
            max={f.max}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
            style={{ ...inputStyle, flex: 1 }}
          />
          {f.unit ?? (f.type === 'duration' ? 'min' : null) ? (
            <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{f.unit ?? 'min'}</span>
          ) : null}
        </div>
      );
    case 'boolean':
      return <input type="checkbox" checked={value === true} disabled={disabled} onChange={(e) => onChange(e.target.checked)} style={{ alignSelf: 'flex-start' }} />;
    case 'scale':
    case 'rating': {
      const min = f.min ?? 1;
      const max = f.max ?? 5;
      // Up to ten buttons; a wider range gets a number input so no value is out of reach.
      if (max - min + 1 > 10 || !Number.isInteger(min) || !Number.isInteger(max)) {
        return (
          <input
            type="number"
            step={Number.isInteger(min) ? 1 : 'any'}
            value={num ?? ''}
            min={min}
            max={max}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
            style={inputStyle}
          />
        );
      }
      const steps = Array.from({ length: Math.max(0, max - min + 1) }, (_, i) => min + i);
      return (
        <div style={{ display: 'flex', gap: 4 }}>
          {steps.map((n) => {
            const on = f.type === 'rating' ? num !== undefined && n <= num : num === n;
            return (
              <button
                key={n}
                type="button"
                disabled={disabled}
                onClick={() => onChange(num === n && f.optional ? undefined : n)}
                style={f.type === 'rating' ? starStyle(on) : chipStyle(on)}
              >
                {f.type === 'rating' ? '★' : n}
              </button>
            );
          })}
        </div>
      );
    }
    case 'select':
    case 'multiselect': {
      const options = fieldOptions(collection, f, settings);
      const selected = f.type === 'multiselect' ? (Array.isArray(value) ? (value as string[]) : []) : [str];
      return (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {options.map((o) => {
            const on = selected.includes(o.value);
            return (
              <button
                key={o.value}
                type="button"
                disabled={disabled}
                onClick={() => {
                  if (f.type === 'select') onChange(on && f.optional ? undefined : o.value);
                  else onChange(on ? selected.filter((v) => v !== o.value) : [...selected, o.value]);
                }}
                style={chipStyle(on, o.color)}
              >
                {o.color ? <span style={{ width: 8, height: 8, borderRadius: 2, background: o.color, display: 'inline-block', marginRight: 5 }} /> : null}
                {o.label}
              </button>
            );
          })}
        </div>
      );
    }
    case 'tags':
      return <TagsInput value={Array.isArray(value) ? (value as string[]) : []} disabled={disabled} onChange={onChange} />;
    case 'ref':
    case 'task': {
      // Tasks only list where they live (the extension); elsewhere the link is kept as is.
      if (choices === undefined && f.type === 'task') {
        return (
          <select value={str} disabled style={inputStyle}>
            <option value={str}>{str ? 'Linked task' : 'Link a task from the Pomodoso extension'}</option>
          </select>
        );
      }
      return <SearchSelect value={str} choices={choices ?? []} optional={f.optional === true} disabled={disabled} gone={f.type === 'task' ? 'Task deleted' : 'Deleted'} empty={f.type === 'task' ? 'No tasks to link' : 'Nothing to pick yet'} onChange={onChange} />;
    }
  }
}

/**
 * A pick from a long list (a task among dozens): type to filter, pick a
 * match. Shows the picked one's label while not searching.
 */
function SearchSelect({ value, choices, optional, disabled, gone, empty, onChange }: {
  value: string;
  choices: FieldChoice[];
  optional: boolean;
  disabled?: boolean | undefined;
  /** Shown for a value no longer among the choices (a deleted task). */
  gone: string;
  empty: string;
  onChange: (v: unknown) => void;
}) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const picked = choices.find((c) => c.value === value);
  const needle = q.trim().toLowerCase();
  const matches = (needle ? choices.filter((c) => c.label.toLowerCase().includes(needle)) : choices).slice(0, 8);
  const pick = (v: string | undefined) => {
    onChange(v);
    setQ('');
    setOpen(false);
  };
  if (choices.length === 0 && !value) return <input type="text" disabled placeholder={empty} style={inputStyle} />;
  return (
    <div style={{ position: 'relative' }}>
      <input
        type="text"
        value={open ? q : picked?.label ?? (value ? gone : '')}
        placeholder={open ? 'Search…' : optional ? 'None' : 'Pick one'}
        disabled={disabled}
        onFocus={() => setOpen(true)}
        // Late enough for a click on a match to land first.
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            if (matches[0]) pick(matches[0].value);
          }
          if (e.key === 'Escape') setOpen(false);
        }}
        style={inputStyle}
      />
      {open ? (
        <div role="listbox" style={{ position: 'absolute', zIndex: 10, top: '100%', left: 0, right: 0, marginTop: 2, maxHeight: 220, overflowY: 'auto', background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', boxShadow: '0 6px 18px rgba(0,0,0,0.12)' }}>
          {optional && value ? (
            <div role="option" aria-selected={false} onMouseDown={(e) => { e.preventDefault(); pick(undefined); }} style={optionStyle(false)}>
              <span style={{ color: 'var(--color-text-muted)' }}>None</span>
            </div>
          ) : null}
          {matches.map((c) => (
            <div key={c.value} role="option" aria-selected={c.value === value} onMouseDown={(e) => { e.preventDefault(); pick(c.value); }} style={optionStyle(c.value === value)}>
              {c.label}
            </div>
          ))}
          {matches.length === 0 ? <div style={{ ...optionStyle(false), color: 'var(--color-text-faint)', cursor: 'default' }}>No matches</div> : null}
        </div>
      ) : null}
    </div>
  );
}

function optionStyle(on: boolean): CSSProperties {
  return { padding: '6px 10px', fontSize: 12, cursor: 'pointer', color: 'var(--color-text)', background: on ? 'var(--color-accent-soft)' : 'transparent', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
}

/**
 * Tags as one comma-separated text box. Every keystroke reports the parsed
 * list, so whatever is typed is saved on submit — no pending half-tag.
 */
function TagsInput({ value, disabled, onChange }: { value: string[]; disabled?: boolean | undefined; onChange: (v: string[]) => void }) {
  const [text, setText] = useState(value.join(', '));
  return (
    <input
      type="text"
      value={text}
      disabled={disabled}
      placeholder="Comma separated, e.g. rust, async"
      onChange={(e) => {
        setText(e.target.value);
        onChange([...new Set(e.target.value.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean))]);
      }}
      style={inputStyle}
    />
  );
}

export function chipStyle(on: boolean, color?: string): CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '3px 9px',
    fontSize: 11,
    fontWeight: on ? 600 : 400,
    fontFamily: 'inherit',
    borderRadius: 'var(--radius-sm)',
    cursor: 'pointer',
    border: `1px solid ${on ? (color ?? 'var(--color-accent)') : 'var(--color-border)'}`,
    background: on ? 'var(--color-accent-soft)' : 'transparent',
    color: on ? 'var(--color-text)' : 'var(--color-text-muted)',
  };
}

function starStyle(on: boolean): CSSProperties {
  return {
    border: 'none',
    background: 'none',
    cursor: 'pointer',
    fontSize: 18,
    lineHeight: 1,
    padding: 0,
    color: on ? 'var(--color-warning)' : 'var(--color-border-strong)',
  };
}
