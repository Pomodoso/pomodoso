import {
  fieldOptions,
  formatStat,
  initialRecordData,
  recordTitle,
  templateFormat,
  type PluginEvaluator,
  type PluginManifest,
  type PluginRecord,
  type PluginValue,
} from '@pomodoso/types/plugins';
import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { colors } from '@/constants/theme';

import { latestToday, progressStyleOf } from './PluginView';
import { Chip, DotGrid, DotRing, PluginIcon, progressUnits, ui, YearGrid } from './primitives';

// The native counterpart of @pomodoso/ui's TodayWidget: an app's compact card
// on Today, one number and its action (or a few numbers), from the file's
// `today.widget`. Kept in step with shared/ui/src/plugins/TodayWidget.tsx.

export interface TodayWidgetProps {
  manifest: PluginManifest;
  settings: Record<string, unknown>;
  evaluator: PluginEvaluator;
  today: string;
  now: string;
  timeZone: string;
  weekStart: number;
  readOnly: boolean;
  /** Full row width in points, for the wide cards' grids. */
  width: number;
  add(collection: string, data: Record<string, unknown>): void | Promise<unknown>;
  remove(record: PluginRecord): void | Promise<unknown>;
  update(record: PluginRecord, data: Record<string, unknown>): void | Promise<unknown>;
  setDay(collection: string, day: string, data: Record<string, unknown>): void | Promise<unknown>;
  onOpen(): void;
  open?: ((view: string, record?: string) => void) | undefined;
  /** Long-press on the card: picks it up to move it among the Today cards. */
  onLongPress?: (() => void) | undefined;
}

/** Whether a widget spans the whole row rather than half of it. */
export function widgetIsWide(manifest: PluginManifest, evaluator: PluginEvaluator, today: string): boolean {
  const w = manifest.today?.widget;
  if (!w) return false;
  if (w.type === 'list') return true;
  if (w.type === 'progress') {
    const style = progressStyleOf(typeof w.style === 'string' && w.style.startsWith('$') ? evaluator.value(w.style) : w.style);
    return style === 'dots';
  }
  if (w.type === 'select-today' && w.after === 'year-grid') {
    const c = manifest.collections.find(x => x.key === w.collection);
    return Boolean(c && evaluator.records(c.key).some(r => r.day === today && r.data[w.field] !== undefined));
  }
  return false;
}

export function TodayWidget(props: TodayWidgetProps): React.JSX.Element | null {
  const { manifest, evaluator, now } = props;
  const w = manifest.today?.widget;
  if (!w) return null;
  const label = evaluator.template(w.label, templateFormat(manifest, now));

  switch (w.type) {
    case 'mini-counter': {
      const v = num(evaluator.value(w.value)) ?? 0;
      const max = w.max === undefined ? undefined : num(evaluator.value(w.max));
      const over = max !== undefined && v > max;
      const c = manifest.collections.find(x => x.key === w.adds);
      const last = c && w.subtract ? latestToday(evaluator.records(c.key), props.today, props.timeZone) : undefined;
      return (
        <Card {...props} label={label}>
          <View style={s.row}>
            <Text style={[s.value, { flex: 1 }, over && { color: colors.accent }]}>
              {formatStat(v, 'number', now)}
              {max !== undefined ? <Text style={s.of}> / {formatStat(max, 'number', now)}</Text> : null}
            </Text>
            {c && w.subtract ? (
              <Pressable
                accessibilityLabel={`Remove the last one from ${label}`}
                disabled={props.readOnly || !last}
                onPress={() => last && void props.remove(last)}
                style={[s.round, s.minus, (props.readOnly || !last) && { opacity: 0.4 }]}
                hitSlop={4}
              >
                <Text style={{ fontSize: 17, fontWeight: '700', color: colors.textSecondary }}>−</Text>
              </Pressable>
            ) : null}
            {c ? (
              <Pressable
                accessibilityLabel={`Add to ${label}`}
                disabled={props.readOnly}
                onPress={() => void props.add(c.key, initialRecordData(c))}
                style={[s.round, s.plus, props.readOnly && { opacity: 0.5 }]}
                hitSlop={4}
              >
                <Text style={{ fontSize: 17, fontWeight: '700', color: '#fff' }}>+</Text>
              </Pressable>
            ) : null}
          </View>
          {max !== undefined && max > 0 ? (
            <View style={s.track}>
              <View style={{ height: '100%', width: `${Math.max(0, Math.min(100, (v / max) * 100))}%`, backgroundColor: over ? colors.accent : colors.success }} />
            </View>
          ) : null}
        </Card>
      );
    }

    case 'select-today':
      return <SelectToday {...props} widget={w} label={label} />;

    case 'record':
      return <RecordCard {...props} widget={w} label={label} />;

    case 'list': {
      const c = manifest.collections.find(x => x.key === w.collection);
      const rows = c ? evaluator.records(c.key, w.where) : [];
      const shown = rows.slice(0, LIST_ROWS);
      const fmt = (v: PluginValue) => (v === null || v === undefined || v === '' ? '' : formatStat(v, 'number', now));
      const row = (key: string, title: string, badge: string, onPress: () => void) => (
        <Pressable key={key} disabled={!props.open} onPress={onPress} style={s.listRow}>
          <Text style={{ flex: 1, fontSize: 14, color: colors.text }} numberOfLines={1}>{title}</Text>
          {badge ? <Text style={{ fontSize: 12, fontWeight: '700', color: colors.textSecondary }}>{badge}</Text> : null}
          <Text style={{ color: colors.textTertiary, fontSize: 14 }}>›</Text>
        </Pressable>
      );
      return (
        <Card {...props} label={label}>
          <View style={{ gap: 3 }}>
            {shown.map(r => {
              const one = evaluator.forRecord(r.id);
              const badge = w.badge === undefined ? '' : fmt(one.value(w.badge));
              const of = w.badge_of === undefined ? '' : fmt(one.value(w.badge_of));
              return row(r.id, recordTitle(manifest, r), badge && of ? `${badge}/${of}` : badge, () => props.open?.(w.opens, r.id));
            })}
            {w.more ? row('more', evaluator.template(w.more.label, templateFormat(manifest, now)), w.more.badge === undefined ? '' : fmt(evaluator.value(w.more.badge)), () => props.open?.(w.more!.view)) : null}
            {rows.length > shown.length ? <Text style={s.muted}>+{rows.length - shown.length} more in the app</Text> : null}
            {rows.length === 0 && !w.more ? <Text style={s.muted}>Nothing here yet.</Text> : null}
          </View>
        </Card>
      );
    }

    case 'count-badge':
    case 'stat': {
      const v = evaluator.value(w.value);
      return (
        <Card {...props} label={label}>
          <Text style={s.value}>{formatStat(v, w.type === 'stat' ? w.format : 'number', now)}</Text>
        </Card>
      );
    }

    case 'progress': {
      const v = num(evaluator.value(w.value)) ?? 0;
      const max = w.max === undefined ? 1 : num(evaluator.value(w.max));
      const fraction = max && max > 0 ? Math.max(0, Math.min(1, v / max)) : 0;
      const style = progressStyleOf(typeof w.style === 'string' && w.style.startsWith('$') ? evaluator.value(w.style) : w.style);
      const shown = w.format === 'share' && max ? formatStat(v / max, 'share', now) : formatStat(v, w.format ?? 'number', now);
      const caption = w.caption !== undefined ? evaluator.template(w.caption, templateFormat(manifest, now)) : null;
      if (style === 'ring') {
        return (
          <Card {...props} label={label}>
            <View style={[s.row, { gap: 10 }]}>
              <DotRing fraction={fraction} units={progressUnits(max, 120, 60)} size={64}>
                <Text style={{ fontSize: 12, fontWeight: '700', color: colors.text }}>{shown}</Text>
              </DotRing>
              {caption ? <Text style={[s.caption, { flex: 1 }]}>{caption}</Text> : null}
            </View>
          </Card>
        );
      }
      return (
        <Card {...props} label={label}>
          <View style={[s.row, { alignItems: 'baseline' }]}>
            <Text style={s.value}>{shown}</Text>
            {caption ? <Text style={[s.caption, { flex: 1 }]} numberOfLines={1}>{caption}</Text> : null}
          </View>
          {style === 'dots' ? (
            <DotGrid fraction={fraction} units={progressUnits(max, 400, 100)} width={props.width - 24} />
          ) : (
            <View style={s.track}>
              <View style={{ height: '100%', width: `${fraction * 100}%`, backgroundColor: colors.accent }} />
            </View>
          )}
        </Card>
      );
    }

    case 'stats': {
      const fmt = templateFormat(manifest, now);
      return (
        <Card {...props} label={label}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: 6 }}>
            {w.items.map((it, i) => (
              <View key={i} style={{ width: w.items.length > 1 ? '50%' : '100%', alignItems: 'center' }}>
                <Text style={[s.value, { fontSize: 17 }]}>{formatStat(evaluator.value(it.value), it.format ?? 'number', now)}</Text>
                <Text style={s.muted} numberOfLines={1}>{evaluator.template(it.label, fmt)}</Text>
              </View>
            ))}
          </View>
        </Card>
      );
    }
  }
}

const LIST_ROWS = 6;

type RecordSpec = Extract<NonNullable<PluginManifest['today']>['widget'], { type: 'record' }>;

/** The latest item matching `where`, with its number `field` edited right here, saved on submit or blur. */
function RecordCard(props: TodayWidgetProps & { widget: RecordSpec; label: string }): React.JSX.Element {
  const { manifest, evaluator, widget: w, label, now } = props;
  const c = manifest.collections.find(x => x.key === w.collection);
  const rows = c ? evaluator.records(c.key, w.where) : [];
  const rec = rows.reduce<PluginRecord | undefined>((a, r) => (!a || (r.updated_at ?? r.created_at) > (a.updated_at ?? a.created_at) ? r : a), undefined);
  const caption = w.caption !== undefined ? evaluator.template(w.caption, templateFormat(manifest, now)) : null;
  const value = rec ? num(rec.data[w.field] as PluginValue) : undefined;
  const max = rec && w.max ? num(rec.data[w.max] as PluginValue) : undefined;
  const field = c?.fields.find(f => f.key === w.field);
  return (
    <Card {...props} label={label}>
      {rec ? (
        <>
          <Text style={{ fontSize: 14, fontWeight: '600', color: colors.text }} numberOfLines={1}>
            {String(rec.data[w.title] ?? 'Untitled')}
            {rows.length > 1 ? <Text style={{ fontWeight: '400', color: colors.textTertiary }}> +{rows.length - 1}</Text> : null}
          </Text>
          <View style={[s.row, { gap: 6 }]}>
            <Text style={s.caption}>{field?.label ?? w.field}</Text>
            <NumberBox key={`${rec.id}:${value ?? ''}`} value={value} disabled={props.readOnly} onSave={v => void props.update(rec, { ...rec.data, [w.field]: v })} />
            {max !== undefined ? <Text style={s.caption}>/ {formatStat(max, 'number', now)}</Text> : null}
          </View>
          {max !== undefined && max > 0 ? (
            <View style={s.track}>
              <View style={{ height: '100%', width: `${Math.max(0, Math.min(100, ((value ?? 0) / max) * 100))}%`, backgroundColor: colors.accent }} />
            </View>
          ) : null}
        </>
      ) : (
        <Text style={s.muted}>Nothing here yet.</Text>
      )}
      {caption ? <Text style={s.muted} numberOfLines={1}>{caption}</Text> : null}
    </Card>
  );
}

function NumberBox({ value, disabled, onSave }: { value: number | undefined; disabled: boolean; onSave: (v: number | null) => void }): React.JSX.Element {
  const [text, setText] = useState(value === undefined ? '' : String(value));
  const save = () => {
    const v = text.trim() === '' ? null : Number(text.replace(',', '.'));
    if (v !== null && !Number.isFinite(v)) return;
    if ((v ?? undefined) !== value) onSave(v);
  };
  return (
    <TextInput
      style={s.numberBox}
      value={text}
      editable={!disabled}
      keyboardType="decimal-pad"
      returnKeyType="done"
      accessibilityLabel="Value"
      onChangeText={setText}
      onBlur={save}
      onSubmitEditing={save}
    />
  );
}

type SelectTodaySpec = Extract<NonNullable<PluginManifest['today']>['widget'], { type: 'select-today' }>;

/** Today's option chips; with `after: year-grid`, the year in pixels once today is set. */
function SelectToday(props: TodayWidgetProps & { widget: SelectTodaySpec; label: string }): React.JSX.Element | null {
  const { manifest, evaluator, widget: w, label } = props;
  const [changing, setChanging] = useState(false);
  const c = manifest.collections.find(x => x.key === w.collection);
  const field = c?.fields.find(f => f.key === w.field);
  if (!c || !field) return null;
  const options = fieldOptions(c.key, field, props.settings);
  const records = evaluator.records(c.key);
  const current = records.find(r => r.day === props.today)?.data[field.key];
  const chosen = options.find(o => o.value === current);

  if (w.after === 'year-grid' && chosen && !changing) {
    const colorMap = new Map(options.map(o => [o.value, o.color]));
    const byDay = new Map(records.flatMap(r => (r.day ? [[r.day, r.data[field.key]] as const] : [])));
    return (
      <Card {...props} label={label}>
        <View style={[s.row, { gap: 6 }]}>
          {chosen.color ? <View style={{ width: 9, height: 9, borderRadius: 2, backgroundColor: chosen.color }} /> : null}
          <Text style={{ fontSize: 13, fontWeight: '600', color: colors.text }}>{chosen.label}</Text>
          <Pressable disabled={props.readOnly} onPress={() => setChanging(true)} style={{ marginLeft: 'auto' }} hitSlop={6}>
            <Text style={{ fontSize: 12, color: colors.textSecondary, textDecorationLine: 'underline' }}>Change</Text>
          </Pressable>
        </View>
        <YearGrid
          year={Number(props.today.slice(0, 4))}
          weekStart={props.weekStart}
          today={props.today}
          width={props.width - 24}
          colorOf={day => {
            const v = byDay.get(day);
            return v === undefined ? undefined : colorMap.get(String(v)) ?? colors.accent;
          }}
        />
      </Card>
    );
  }

  return (
    <Card {...props} label={label}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5 }}>
        {options.map(o => (
          <Chip
            key={o.value}
            label={o.label}
            color={o.color}
            on={current === o.value}
            disabled={props.readOnly}
            onPress={() => {
              setChanging(false);
              void props.setDay(c.key, props.today, { [field.key]: o.value });
            }}
          />
        ))}
      </View>
    </Card>
  );
}

function num(v: PluginValue): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function Card({ manifest, label, onOpen, onLongPress, children }: TodayWidgetProps & { label: string; children: ReactNode }): React.JSX.Element {
  return (
    <Pressable onPress={onOpen} onLongPress={onLongPress} style={[ui.card, { paddingHorizontal: 12, paddingVertical: 10, gap: 8 }]}>
      <View style={[s.row, { gap: 6 }]}>
        <PluginIcon icon={manifest.icon} name={manifest.name} size={20} />
        <Text style={[ui.label, { flex: 1, fontSize: 12 }]} numberOfLines={1}>{label}</Text>
      </View>
      {children}
    </Pressable>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  value: { fontSize: 20, fontWeight: '700', color: colors.text },
  of: { fontSize: 13, fontWeight: '400', color: colors.textSecondary },
  round: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  minus: { borderWidth: 1, borderColor: colors.borderStrong },
  plus: { backgroundColor: colors.accent },
  track: { height: 5, backgroundColor: colors.border, borderRadius: 99, overflow: 'hidden' },
  caption: { fontSize: 12.5, color: colors.textSecondary },
  muted: { fontSize: 12, color: colors.textTertiary },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 8, paddingVertical: 7, borderRadius: 6, backgroundColor: colors.bg },
  numberBox: {
    width: 60, paddingVertical: 4, fontSize: 14, fontWeight: '700', textAlign: 'center', color: colors.text,
    backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border, borderRadius: 6,
  },
});
