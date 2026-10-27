import { useState } from 'react';

import {
  fieldLabel,
  fieldOptions,
  humanize,
  normalizeOption,
  optionsSettingKey,
  type PluginManifest,
  type PluginOption,
} from '@pomodoso/types/plugins';

// Inputs for a plugin's declared `settings` and its `user_editable` select
// options. Used by the install preview and by the plugin's settings screen.

const input: React.CSSProperties = {
  padding: '6px 8px', fontSize: 12, fontFamily: 'inherit',
  color: 'var(--color-text)', background: 'var(--color-bg)',
  border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)',
  outline: 'none', boxSizing: 'border-box',
};

const label: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)' };

/**
 * The settings a plugin starts with: each declared setting's default. A
 * select without one starts on its first option, which is what its dropdown
 * shows, so what the user sees is what gets saved.
 */
export function defaultSettings(manifest: PluginManifest): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const s of manifest.settings ?? []) {
    if (s.default !== undefined) out[s.key] = s.default;
    else if (s.type === 'select' && s.options?.[0] !== undefined) out[s.key] = normalizeOption(s.options[0]).value;
  }
  return out;
}

export function SettingsFields({ manifest, values, disabled, onChange }: {
  manifest: PluginManifest;
  values: Record<string, unknown>;
  disabled?: boolean;
  onChange: (key: string, value: unknown) => void;
}) {
  const settings = manifest.settings ?? [];
  if (settings.length === 0) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {settings.map((s) => {
        const v = values[s.key] ?? s.default;
        return (
          <label key={s.key} style={{ display: 'flex', alignItems: s.type === 'boolean' ? 'center' : 'stretch', flexDirection: s.type === 'boolean' ? 'row' : 'column', gap: 4 }}>
            {s.type === 'boolean' ? (
              <input type="checkbox" checked={v === true} disabled={disabled} onChange={(e) => onChange(s.key, e.target.checked)} />
            ) : null}
            <span style={label}>{s.label}</span>
            {s.type === 'number' ? (
              <NumberSetting value={typeof v === 'number' ? v : undefined} min={s.min} max={s.max} disabled={disabled} onChange={(n) => onChange(s.key, n)} />
            ) : s.type === 'text' ? (
              <input type="text" style={input} disabled={disabled} value={typeof v === 'string' ? v : ''} onChange={(e) => onChange(s.key, e.target.value)} />
            ) : s.type === 'select' ? (
              <select style={input} disabled={disabled} value={typeof v === 'string' ? v : ''} onChange={(e) => onChange(s.key, e.target.value)}>
                {typeof v !== 'string' ? <option value="" disabled>Choose…</option> : null}
                {(s.options ?? []).map(normalizeOption).map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            ) : null}
          </label>
        );
      })}
    </div>
  );
}

/**
 * A number setting saves only values inside its range; anything else stays
 * in the box with a hint, so a typo can't flip a limit's meaning.
 */
function NumberSetting({ value, min, max, disabled, onChange }: {
  value: number | undefined;
  min?: number | undefined;
  max?: number | undefined;
  disabled?: boolean | undefined;
  onChange: (n: number | undefined) => void;
}) {
  const [draft, setDraft] = useState(value === undefined ? '' : String(value));
  const n = draft.trim() === '' ? undefined : Number(draft);
  const problem =
    n === undefined ? undefined
    : !Number.isFinite(n) ? 'Enter a number'
    : min !== undefined && n < min ? `At least ${min}`
    : max !== undefined && n > max ? `At most ${max}`
    : undefined;
  return (
    <>
      <input
        type="number" step="any" style={{ ...input, borderColor: problem ? 'var(--color-accent)' : 'var(--color-border)' }} disabled={disabled}
        value={draft} min={min} max={max}
        onChange={(e) => {
          setDraft(e.target.value);
          const next = e.target.value.trim() === '' ? undefined : Number(e.target.value);
          const ok = next === undefined || (Number.isFinite(next) && (min === undefined || next >= min) && (max === undefined || next <= max));
          if (ok) onChange(next);
        }}
      />
      {problem ? <span style={{ fontSize: 10, color: 'var(--color-accent)' }}>{problem}</span> : null}
    </>
  );
}

/** Option keys must stay lower_snake_case like the file's, so a label becomes `my_label`. */
function keyFromLabel(text: string, taken: string[]): string {
  const base = text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'o_$1').slice(0, 36) || 'option';
  let key = base;
  for (let n = 2; taken.includes(key); n++) key = `${base}_${n}`;
  return key;
}

/**
 * Editors for every `user_editable` select. Existing options keep their value
 * (records point at it), so only the label and color change; new options get
 * a value from their label. Removing an option leaves its records untouched.
 */
export function EditableOptions({ manifest, values, disabled, onChange }: {
  manifest: PluginManifest;
  values: Record<string, unknown>;
  disabled?: boolean;
  onChange: (key: string, value: PluginOption[]) => void;
}) {
  const editable = manifest.collections.flatMap((c) => c.fields.filter((f) => f.user_editable).map((f) => ({ c, f })));
  if (editable.length === 0) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {editable.map(({ c, f }) => {
        const key = optionsSettingKey(c.key, f.key);
        const options = fieldOptions(c.key, f, values);
        return (
          <OptionList
            key={key}
            title={fieldLabel(f)}
            options={options}
            disabled={disabled}
            onChange={(next) => onChange(key, next)}
          />
        );
      })}
    </div>
  );
}

function OptionList({ title, options, disabled, onChange }: {
  title: string;
  options: PluginOption[];
  disabled?: boolean | undefined;
  onChange: (next: PluginOption[]) => void;
}) {
  const [draft, setDraft] = useState('');
  const patch = (i: number, p: Partial<PluginOption>) => onChange(options.map((o, k) => (k === i ? { ...o, ...p } : o)));
  const add = () => {
    const text = draft.trim();
    if (!text) return;
    onChange([...options, { value: keyFromLabel(text, options.map((o) => o.value)), label: text, color: '#9B9890' }]);
    setDraft('');
  };
  return (
    <div>
      <div style={{ ...label, marginBottom: 6 }}>{title} options</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {options.map((o, i) => (
          <div key={o.value} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input
              type="color" value={o.color ?? '#9B9890'} disabled={disabled}
              onChange={(e) => patch(i, { color: e.target.value.toUpperCase() })}
              aria-label={`${o.label} color`}
              style={{ width: 26, height: 26, padding: 0, border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', background: 'none', cursor: 'pointer' }}
            />
            <input
              type="text" value={o.label} disabled={disabled} maxLength={80}
              onChange={(e) => patch(i, { label: e.target.value || humanize(o.value) })}
              style={{ ...input, flex: 1 }}
            />
            <button
              type="button" disabled={disabled || options.length <= 1} aria-label={`Remove ${o.label}`}
              onClick={() => onChange(options.filter((_, k) => k !== i))}
              style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-text-faint)', fontSize: 14, opacity: options.length <= 1 ? 0.3 : 1 }}
            >
              ×
            </button>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            type="text" placeholder="New option" value={draft} disabled={disabled} maxLength={80}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
            style={{ ...input, flex: 1 }}
          />
          <button type="button" disabled={disabled || !draft.trim()} onClick={add} style={{ ...input, cursor: 'pointer', fontWeight: 600 }}>Add</button>
        </div>
      </div>
    </div>
  );
}
