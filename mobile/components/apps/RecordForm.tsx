import {
  fieldLabel,
  fieldOptions,
  missingFields,
  type PluginCollection,
  type PluginField,
} from '@pomodoso/types/plugins';
import { useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { colors } from '@/constants/theme';

import { Button, Chip, ui } from './primitives';

// The native counterpart of @pomodoso/ui's RecordForm: one input per field
// of a collection, Save blocked until required fields are filled. Dates are
// typed (YYYY-MM-DD, and HH:MM for an event's "When"), since mobile has no
// date picker dependency.

export interface FieldChoice {
  value: string;
  label: string;
}

interface RecordFormProps {
  collection: PluginCollection;
  choices?: ((field: PluginField) => FieldChoice[] | undefined) | undefined;
  settings: Record<string, unknown>;
  initial: Record<string, unknown>;
  submitLabel: string;
  disabled?: boolean | undefined;
  /** Event collections only: when it happened (ISO). */
  occurredAt?: string | undefined;
  onSubmit: (data: Record<string, unknown>, occurredAt?: string) => void | Promise<unknown>;
  onCancel?: (() => void) | undefined;
  onDelete?: (() => void) | undefined;
}

const TEXT_MAX = 2000;
const LONGTEXT_MAX = 20000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function RecordForm({ collection, settings, initial, occurredAt, choices, submitLabel, disabled, onSubmit, onCancel, onDelete }: RecordFormProps): React.JSX.Element {
  const isEvent = collection.kind === 'event';
  const [when, setWhen] = useState(() => toLocalInput(occurredAt ?? new Date().toISOString()));
  const [whenTouched, setWhenTouched] = useState(false);
  const [data, setData] = useState<Record<string, unknown>>(() => {
    const out = { ...initial };
    for (const f of collection.fields) if (f.type === 'boolean' && out[f.key] === undefined) out[f.key] = f.default ?? false;
    return out;
  });
  const [pending, setPending] = useState(false);
  const badDates = collection.fields.filter(f => f.type === 'date' && typeof data[f.key] === 'string' && data[f.key] !== '' && !isRealDate(data[f.key] as string));
  // A number outside its field's range can't be saved (the extension's input
  // enforces the same bounds).
  const outOfRange = collection.fields.filter(f => {
    const v = data[f.key];
    if (typeof v !== 'number' || !['number', 'duration', 'scale', 'rating'].includes(f.type)) return false;
    const min = f.min ?? (f.type === 'scale' || f.type === 'rating' ? 1 : undefined);
    const max = f.max ?? (f.type === 'scale' || f.type === 'rating' ? 5 : undefined);
    return (min !== undefined && v < min) || (max !== undefined && v > max);
  });
  const whenBad = isEvent && whenTouched && fromLocalInput(when) === null;
  const missing = missingFields(collection, data);
  const blocked = disabled || pending || missing.length > 0 || badDates.length > 0 || outOfRange.length > 0 || whenBad;
  const set = (key: string, v: unknown) => setData(d => ({ ...d, [key]: v }));

  function submit(): void {
    if (blocked) return;
    const at = isEvent && whenTouched ? fromLocalInput(when) ?? undefined : undefined;
    const result = onSubmit(clean(data), at);
    if (result instanceof Promise) {
      setPending(true);
      // A failed save keeps the form as it is (the caller already said why).
      void result.catch(() => {}).finally(() => setPending(false));
    }
  }

  return (
    <View style={{ gap: 14 }}>
      {isEvent ? (
        <View style={{ gap: 5 }}>
          <Text style={ui.label}>When</Text>
          <TextInput
            style={[ui.input, whenBad && styles.bad]}
            value={when}
            editable={!disabled}
            placeholder="YYYY-MM-DD HH:MM"
            placeholderTextColor={colors.textTertiary}
            autoCapitalize="none"
            onChangeText={t => {
              setWhen(t);
              setWhenTouched(true);
            }}
          />
          {whenBad ? <Text style={styles.hint}>Use YYYY-MM-DD HH:MM, not in the future.</Text> : null}
        </View>
      ) : null}
      {collection.fields.map(f => (
        <View key={f.key} style={{ gap: 5 }}>
          <Text style={ui.label}>
            {fieldLabel(f)}
            {f.optional ? <Text style={{ color: colors.textTertiary, fontWeight: '400' }}> · optional</Text> : null}
          </Text>
          <FieldInput field={f} collection={collection.key} settings={settings} value={data[f.key]} disabled={disabled} choices={choices?.(f)} onChange={v => set(f.key, v)} />
          {badDates.includes(f) ? <Text style={styles.hint}>Use a real date, YYYY-MM-DD.</Text> : null}
          {outOfRange.includes(f) ? <Text style={styles.hint}>{rangeHint(f)}</Text> : null}
        </View>
      ))}
      <View style={styles.actions}>
        {onDelete ? (
          <Button kind="ghost" label="Delete" onPress={onDelete} disabled={disabled} style={{ marginRight: 'auto' }} textStyle={{ color: colors.accent }} />
        ) : null}
        {onCancel ? <Button kind="ghost" label="Cancel" onPress={onCancel} /> : null}
        <Button kind="primary" label={submitLabel} onPress={submit} disabled={blocked} />
      </View>
    </View>
  );
}

/** YYYY-MM-DD that names a day on the calendar (no month 13, no Feb 30). */
function isRealDate(v: string): boolean {
  if (!DATE.test(v)) return false;
  const [y, m, d] = v.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

function rangeHint(f: PluginField): string {
  const min = f.min ?? (f.type === 'scale' || f.type === 'rating' ? 1 : undefined);
  const max = f.max ?? (f.type === 'scale' || f.type === 'rating' ? 5 : undefined);
  if (min !== undefined && max !== undefined) return `Between ${min} and ${max}.`;
  return min !== undefined ? `At least ${min}.` : `At most ${max}.`;
}

/** An ISO timestamp as "YYYY-MM-DD HH:MM", local. */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** "YYYY-MM-DD HH:MM" (local) back to ISO; null when invalid or in the future. */
function fromLocalInput(v: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})$/.exec(v.trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  if (Number.isNaN(d.getTime()) || d.getTime() > Date.now() + 60_000) return null;
  return d.toISOString();
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

function FieldInput({ field: f, collection, settings, value, disabled, choices, onChange }: {
  field: PluginField;
  collection: string;
  settings: Record<string, unknown>;
  value: unknown;
  disabled?: boolean | undefined;
  choices?: FieldChoice[] | undefined;
  onChange: (v: unknown) => void;
}): React.JSX.Element {
  const str = typeof value === 'string' ? value : '';
  const num = typeof value === 'number' ? value : undefined;

  switch (f.type) {
    case 'text':
    case 'url':
    case 'image_url':
      return (
        <TextInput
          style={ui.input}
          value={str}
          maxLength={TEXT_MAX}
          editable={!disabled}
          placeholder={f.type === 'text' ? '' : 'https://'}
          placeholderTextColor={colors.textTertiary}
          autoCapitalize={f.type === 'text' ? 'sentences' : 'none'}
          keyboardType={f.type === 'text' ? 'default' : 'url'}
          onChangeText={onChange}
        />
      );
    case 'longtext':
      return <TextInput style={[ui.input, { minHeight: 80, textAlignVertical: 'top' }]} value={str} maxLength={LONGTEXT_MAX} editable={!disabled} multiline onChangeText={onChange} />;
    case 'date':
      return <TextInput style={ui.input} value={str} editable={!disabled} placeholder="YYYY-MM-DD" placeholderTextColor={colors.textTertiary} autoCapitalize="none" onChangeText={onChange} />;
    case 'number':
    case 'duration':
      return <NumberInput value={num} unit={f.unit ?? (f.type === 'duration' ? 'min' : undefined)} disabled={disabled} onChange={onChange} />;
    case 'boolean':
      return <Switch value={value === true} disabled={disabled} onValueChange={onChange} trackColor={{ true: colors.accent, false: colors.border }} />;
    case 'scale':
    case 'rating': {
      const min = f.min ?? 1;
      const max = f.max ?? 5;
      if (max - min + 1 > 10 || !Number.isInteger(min) || !Number.isInteger(max)) {
        return <NumberInput value={num} disabled={disabled} onChange={onChange} />;
      }
      const steps = Array.from({ length: Math.max(0, max - min + 1) }, (_, i) => min + i);
      return (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {steps.map(n =>
            f.type === 'rating' ? (
              <Pressable key={n} disabled={disabled} hitSlop={4} onPress={() => onChange(num === n && f.optional ? undefined : n)}>
                <Text style={{ fontSize: 26, color: num !== undefined && n <= num ? colors.warning : colors.borderStrong }}>★</Text>
              </Pressable>
            ) : (
              <Chip key={n} label={String(n)} on={num === n} disabled={disabled} onPress={() => onChange(num === n && f.optional ? undefined : n)} />
            ),
          )}
        </View>
      );
    }
    case 'select':
    case 'multiselect': {
      const options = fieldOptions(collection, f, settings);
      const selected = f.type === 'multiselect' ? (Array.isArray(value) ? (value as string[]) : []) : [str];
      return (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {options.map(o => {
            const on = selected.includes(o.value);
            return (
              <Chip
                key={o.value}
                label={o.label}
                color={o.color}
                on={on}
                disabled={disabled}
                onPress={() => {
                  if (f.type === 'select') onChange(on && f.optional ? undefined : o.value);
                  else onChange(on ? selected.filter(v => v !== o.value) : [...selected, o.value]);
                }}
              />
            );
          })}
        </View>
      );
    }
    case 'tags':
      return <TagsInput value={Array.isArray(value) ? (value as string[]) : []} disabled={disabled} onChange={onChange} />;
    case 'ref':
    case 'task':
      return (
        <PickOne
          value={str}
          choices={choices ?? []}
          optional={f.optional === true}
          disabled={disabled}
          gone={f.type === 'task' ? 'Task deleted' : 'Deleted'}
          empty={f.type === 'task' ? 'No tasks to link' : 'Nothing to pick yet'}
          onChange={onChange}
        />
      );
  }
}

function NumberInput({ value, unit, disabled, onChange }: { value: number | undefined; unit?: string | undefined; disabled?: boolean | undefined; onChange: (v: unknown) => void }): React.JSX.Element {
  const [draft, setDraft] = useState(value === undefined ? '' : String(value));
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <TextInput
        style={[ui.input, { flex: 1 }]}
        value={draft}
        editable={!disabled}
        keyboardType="decimal-pad"
        onChangeText={t => {
          setDraft(t);
          const n = Number(t.replace(',', '.'));
          onChange(t.trim() === '' || !Number.isFinite(n) ? undefined : n);
        }}
      />
      {unit ? <Text style={{ fontSize: 13, color: colors.textSecondary }}>{unit}</Text> : null}
    </View>
  );
}

/** A pick from a list (a task among dozens): type to filter, tap a match. */
function PickOne({ value, choices, optional, disabled, gone, empty, onChange }: {
  value: string;
  choices: FieldChoice[];
  optional: boolean;
  disabled?: boolean | undefined;
  gone: string;
  empty: string;
  onChange: (v: unknown) => void;
}): React.JSX.Element {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const picked = choices.find(c => c.value === value);
  const needle = q.trim().toLowerCase();
  const matches = (needle ? choices.filter(c => c.label.toLowerCase().includes(needle)) : choices).slice(0, 8);
  if (choices.length === 0 && !value) return <Text style={styles.muted}>{empty}</Text>;
  if (!open) {
    return (
      <Pressable style={ui.input} disabled={disabled} onPress={() => setOpen(true)}>
        <Text style={{ fontSize: 15, color: picked ? colors.text : colors.textTertiary }}>{picked?.label ?? (value ? gone : optional ? 'None' : 'Pick one')}</Text>
      </Pressable>
    );
  }
  const pick = (v: string | undefined) => {
    onChange(v);
    setQ('');
    setOpen(false);
  };
  return (
    <View style={styles.pickBox}>
      <TextInput style={ui.input} value={q} autoFocus placeholder="Search…" placeholderTextColor={colors.textTertiary} onChangeText={setQ} />
      {optional && value ? (
        <Pressable style={styles.option} onPress={() => pick(undefined)}>
          <Text style={styles.muted}>None</Text>
        </Pressable>
      ) : null}
      {matches.map(c => (
        <Pressable key={c.value} style={[styles.option, c.value === value && { backgroundColor: colors.accentSoft }]} onPress={() => pick(c.value)}>
          <Text style={{ fontSize: 14, color: colors.text }} numberOfLines={1}>{c.label}</Text>
        </Pressable>
      ))}
      {matches.length === 0 ? <Text style={[styles.muted, { padding: 10 }]}>No matches</Text> : null}
    </View>
  );
}

/** Tags as one comma-separated text box; every keystroke reports the parsed list. */
function TagsInput({ value, disabled, onChange }: { value: string[]; disabled?: boolean | undefined; onChange: (v: string[]) => void }): React.JSX.Element {
  const [text, setText] = useState(value.join(', '));
  return (
    <TextInput
      style={ui.input}
      value={text}
      editable={!disabled}
      autoCapitalize="none"
      placeholder="Comma separated, e.g. rust, async"
      placeholderTextColor={colors.textTertiary}
      onChangeText={t => {
        setText(t);
        onChange([...new Set(t.split(',').map(x => x.trim().toLowerCase()).filter(Boolean))]);
      }}
    />
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 8 },
  bad: { borderColor: colors.accent },
  hint: { fontSize: 12, color: colors.accent },
  muted: { fontSize: 14, color: colors.textTertiary },
  pickBox: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 6, gap: 2, backgroundColor: colors.surface },
  option: { paddingHorizontal: 10, paddingVertical: 9, borderRadius: 6 },
});
