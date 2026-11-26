import { normalizeOption, type PluginManifest } from '@pomodoso/types/plugins';
import { useState } from 'react';
import { StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { colors } from '@/constants/theme';

import { Chip, ui } from './primitives';

// Ports the extension's SettingsFields: one input per declared setting.
// Number settings save only values inside their range.

export function SettingsFields({ manifest, values, disabled, onChange }: {
  manifest: PluginManifest;
  values: Record<string, unknown>;
  disabled?: boolean | undefined;
  onChange: (key: string, value: unknown) => void;
}): React.JSX.Element | null {
  const settings = manifest.settings ?? [];
  if (settings.length === 0) return null;
  return (
    <View style={{ gap: 14 }}>
      {settings.map(s => {
        const v = values[s.key] ?? s.default;
        if (s.type === 'boolean') {
          return (
            <View key={s.key} style={styles.switchRow}>
              <Text style={[ui.label, { flex: 1 }]}>{s.label}</Text>
              <Switch value={v === true} disabled={disabled} onValueChange={x => onChange(s.key, x)} trackColor={{ true: colors.accent, false: colors.border }} />
            </View>
          );
        }
        return (
          <View key={s.key} style={{ gap: 6 }}>
            <Text style={ui.label}>{s.label}</Text>
            {s.type === 'number' ? (
              <NumberSetting value={typeof v === 'number' ? v : undefined} min={s.min} max={s.max} disabled={disabled} onChange={n => onChange(s.key, n)} />
            ) : s.type === 'text' ? (
              <TextInput style={ui.input} editable={!disabled} value={typeof v === 'string' ? v : ''} onChangeText={t => onChange(s.key, t)} />
            ) : s.type === 'select' ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {(s.options ?? []).map(normalizeOption).map(o => (
                  <Chip key={o.value} label={o.label} on={v === o.value} disabled={disabled} onPress={() => onChange(s.key, o.value)} />
                ))}
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

function NumberSetting({ value, min, max, disabled, onChange }: {
  value: number | undefined;
  min?: number | undefined;
  max?: number | undefined;
  disabled?: boolean | undefined;
  onChange: (n: number | undefined) => void;
}): React.JSX.Element {
  const [draft, setDraft] = useState(value === undefined ? '' : String(value));
  const n = draft.trim() === '' ? undefined : Number(draft.replace(',', '.'));
  const problem =
    n === undefined ? undefined
    : !Number.isFinite(n) ? 'Enter a number'
    : min !== undefined && n < min ? `At least ${min}`
    : max !== undefined && n > max ? `At most ${max}`
    : undefined;
  return (
    <>
      <TextInput
        style={[ui.input, problem ? { borderColor: colors.accent } : null]}
        editable={!disabled}
        keyboardType="decimal-pad"
        value={draft}
        onChangeText={t => {
          setDraft(t);
          const next = t.trim() === '' ? undefined : Number(t.replace(',', '.'));
          const ok = next === undefined || (Number.isFinite(next) && (min === undefined || next >= min) && (max === undefined || next <= max));
          if (ok) onChange(next);
        }}
      />
      {problem ? <Text style={{ fontSize: 12, color: colors.accent }}>{problem}</Text> : null}
    </>
  );
}

const styles = StyleSheet.create({
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
});
