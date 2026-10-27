import { useState, type CSSProperties } from 'react';

import {
  fieldLabel,
  fieldOptions,
  missingFields,
  type PluginCollection,
  type PluginField,
} from '@pomodoso/types/plugins';

import { buttonStyle, inputStyle, labelStyle } from './styles.js';

interface RecordFormProps {
  collection: PluginCollection;
  settings: Record<string, unknown>;
  initial: Record<string, unknown>;
  submitLabel: string;
  disabled?: boolean | undefined;
  /** May return a promise; Save stays disabled until it settles. */
  onSubmit: (data: Record<string, unknown>) => void | Promise<unknown>;
  onCancel?: (() => void) | undefined;
  onDelete?: (() => void) | undefined;
}

/** One input per field of a collection. Submitting is blocked until required fields are filled. */
export function RecordForm({ collection, settings, initial, submitLabel, disabled, onSubmit, onCancel, onDelete }: RecordFormProps) {
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
        const result = onSubmit(clean(data));
        if (result instanceof Promise) {
          setPending(true);
          void result.finally(() => setPending(false));
        }
      }}
      style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
    >
      {collection.fields.map((f) => (
        <label key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={labelStyle}>
            {fieldLabel(f)}
            {f.optional ? <span style={{ color: 'var(--color-text-faint)', fontWeight: 400 }}> · optional</span> : null}
          </span>
          <FieldInput field={f} collection={collection.key} settings={settings} value={data[f.key]} disabled={disabled} onChange={(v) => set(f.key, v)} />
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

/** Drops empty strings so an untouched optional field isn't stored as "". */
function clean(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (typeof v === 'string' && v.trim() === '') continue;
    out[k] = typeof v === 'string' ? v.trim() : v;
  }
  return out;
}

interface FieldInputProps {
  field: PluginField;
  collection: string;
  settings: Record<string, unknown>;
  value: unknown;
  disabled?: boolean | undefined;
  onChange: (v: unknown) => void;
}

export function FieldInput({ field: f, collection, settings, value, disabled, onChange }: FieldInputProps) {
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
          disabled={disabled}
          placeholder={f.type === 'text' ? '' : 'https://'}
          onChange={(e) => onChange(e.target.value)}
          style={inputStyle}
        />
      );
    case 'longtext':
      return <textarea value={str} disabled={disabled} rows={3} onChange={(e) => onChange(e.target.value)} style={{ ...inputStyle, resize: 'vertical' }} />;
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
  }
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
