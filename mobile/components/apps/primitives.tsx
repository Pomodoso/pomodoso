import type { PluginOption, SeriesPoint } from '@pomodoso/types/plugins';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type TextStyle, type ViewStyle } from 'react-native';
import Svg, { Circle, Line, Polyline, Rect, Text as SvgText } from 'react-native-svg';

import { colors } from '@/constants/theme';

// The native counterparts of @pomodoso/ui/plugins' styles, icon, progress and
// charts (web: DOM and CSS variables; here: View and react-native-svg). Same
// geometry and colors, so an app reads the same on every client.

export const NEUTRAL_FILL = colors.accent;
export const EMPTY_FILL = colors.border;

export const ui = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12 },
  label: { fontSize: 12, fontWeight: '600', color: colors.textSecondary },
  input: {
    paddingHorizontal: 10, paddingVertical: 9, fontSize: 15, color: colors.text, backgroundColor: colors.bg,
    borderWidth: 1, borderColor: colors.border, borderRadius: 8,
  },
  empty: { fontSize: 13, color: colors.textTertiary, textAlign: 'center', paddingVertical: 14 },
});

type ButtonKind = 'primary' | 'secondary' | 'ghost';

export function Button({ kind, label, onPress, disabled, style, textStyle }: {
  kind: ButtonKind;
  label: string;
  onPress: () => void;
  disabled?: boolean | undefined;
  style?: ViewStyle | undefined;
  textStyle?: TextStyle | undefined;
}): React.JSX.Element {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[btn.base, kind === 'primary' ? btn.primary : kind === 'secondary' ? btn.secondary : btn.ghost, disabled && btn.disabled, style]}
      accessibilityRole="button"
    >
      <Text style={[btn.text, kind === 'primary' ? btn.textPrimary : kind === 'secondary' ? btn.textSecondary : btn.textGhost, textStyle]}>{label}</Text>
    </Pressable>
  );
}

const btn = StyleSheet.create({
  base: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  primary: { backgroundColor: colors.accent, borderColor: colors.accent },
  secondary: { backgroundColor: colors.accentSoft, borderColor: colors.accent },
  ghost: { backgroundColor: 'transparent', borderColor: 'transparent' },
  disabled: { opacity: 0.5 },
  text: { fontSize: 14, fontWeight: '600' },
  textPrimary: { color: '#fff' },
  textSecondary: { color: colors.accent },
  textGhost: { color: colors.textSecondary, fontWeight: '500' },
});

export function Chip({ label, on, color, onPress, disabled }: {
  label: string;
  on: boolean;
  color?: string | undefined;
  onPress: () => void;
  disabled?: boolean | undefined;
}): React.JSX.Element {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[chip.base, on && { borderColor: color ?? colors.accent, backgroundColor: colors.accentSoft }, disabled && { opacity: 0.6 }]}
    >
      {color ? <View style={[chip.swatch, { backgroundColor: color }]} /> : null}
      <Text style={[chip.text, on && chip.textOn]}>{label}</Text>
    </Pressable>
  );
}

const chip = StyleSheet.create({
  base: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 11, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: colors.border },
  swatch: { width: 9, height: 9, borderRadius: 2, marginRight: 6 },
  text: { fontSize: 13, color: colors.textSecondary },
  textOn: { color: colors.text, fontWeight: '600' },
});

// ─── Icon ────────────────────────────────────────────────────────────────────

// A plugin's `icon` is a plain word from the file. Known words get a glyph;
// anything else shows the app's initial, so a file can never load an image
// through its icon. Same table as @pomodoso/ui's PluginIcon.
const GLYPHS: Record<string, string> = {
  book: '📚', bookmark: '🔖', film: '🎬', movie: '🎬', grid: '🟩', 'no-smoking': '🚭', smoking: '🚬',
  water: '💧', coffee: '☕', run: '🏃', heart: '❤️', mood: '🙂', sleep: '😴', money: '💰', music: '🎵',
  game: '🎮', plant: '🌱', pill: '💊', food: '🍎', star: '⭐', check: '✅', calendar: '📅', pen: '✏️',
  link: '🔗', code: '💻', brain: '🧠', dumbbell: '🏋️',
};

export function PluginIcon({ icon, name, size = 28 }: { icon?: string | undefined; name: string; size?: number }): React.JSX.Element {
  const glyph = icon && Object.hasOwn(GLYPHS, icon) ? GLYPHS[icon] : undefined;
  return (
    <View style={{ width: size, height: size, borderRadius: size / 4, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontSize: glyph ? size * 0.55 : size * 0.45, fontWeight: '700', color: colors.accent }}>
        {glyph ?? name.trim().charAt(0).toUpperCase()}
      </Text>
    </View>
  );
}

// ─── Progress ────────────────────────────────────────────────────────────────

const FILLED = colors.text;
const NOW = colors.accent;
const EMPTY = colors.borderStrong;

/** One dot per unit when `max` is a whole number up to `limit`, else `fallback` (a percent's worth each). */
export function progressUnits(max: number | undefined, limit: number, fallback: number): number {
  return max !== undefined && Number.isInteger(max) && max >= 2 && max <= limit ? max : fallback;
}

function filledOf(fraction: number, units: number): number {
  return Math.max(0, Math.min(units, Math.round(Math.max(0, Math.min(1, fraction)) * units)));
}

/** A ring of dots with something in the middle. */
export function DotRing({ fraction, units, size = 120, children }: { fraction: number; units: number; size?: number; children?: ReactNode }): React.JSX.Element {
  const filled = filledOf(fraction, units);
  const r = size / 2 - 6;
  const dot = Math.max(1.4, Math.min(3.2, (Math.PI * 2 * r) / units / 2.6));
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {Array.from({ length: units }, (_, i) => {
          const a = (i / units) * Math.PI * 2 - Math.PI / 2;
          const fill = i < filled - 1 ? FILLED : i === filled - 1 ? NOW : EMPTY;
          return <Circle key={i} cx={size / 2 + r * Math.cos(a)} cy={size / 2 + r * Math.sin(a)} r={dot} fill={fill} />;
        })}
      </Svg>
      {children ? (
        <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center', padding: size / 5 }]}>{children}</View>
      ) : null}
    </View>
  );
}

/** A grid of dots, left to right and top to bottom: one per day of a year, say. */
export function DotGrid({ fraction, units, width }: { fraction: number; units: number; width: number }): React.JSX.Element {
  const filled = filledOf(fraction, units);
  const cols = units > 120 ? 20 : Math.min(units, 10);
  const rows = Math.ceil(units / cols);
  const step = 10;
  return (
    <Svg width={width} height={(width * rows) / cols} viewBox={`0 0 ${cols * step} ${rows * step}`}>
      {Array.from({ length: units }, (_, i) => {
        const fill = i < filled - 1 ? FILLED : i === filled - 1 ? NOW : EMPTY;
        return <Circle key={i} cx={(i % cols) * step + step / 2} cy={Math.floor(i / cols) * step + step / 2} r={step * 0.32} fill={fill} />;
      })}
    </Svg>
  );
}

// ─── Charts ──────────────────────────────────────────────────────────────────

const W = 320;
const H = 90;
const PAD_BOTTOM = 14;

function shortLabel(start: string, group: 'day' | 'week' | 'month'): string {
  const d = new Date(`${start}T00:00:00Z`);
  return d.toLocaleDateString('en', group === 'month' ? { month: 'short', timeZone: 'UTC' } : { day: 'numeric', timeZone: 'UTC' });
}

/** A bar or line chart of a grouped series, with an optional reference line; nulls leave gaps. */
export function SeriesChart({ kind, group, series, reference, width }: {
  kind: 'bar' | 'line';
  group: 'day' | 'week' | 'month';
  series: SeriesPoint[];
  reference?: number | null | undefined;
  width: number;
}): React.JSX.Element {
  const values = series.flatMap(p => (p.value === null ? [] : [p.value]));
  const bounds = reference != null ? [...values, reference] : values;
  const top = Math.max(1, ...bounds);
  const bottom = Math.min(0, ...bounds);
  const plotH = H - PAD_BOTTOM;
  const slot = series.length > 0 ? W / series.length : W;
  const y = (v: number) => plotH - ((v - bottom) / (top - bottom)) * (plotH - 4);
  const zero = y(0);
  const segments: [number, number][][] = [[]];
  series.forEach((p, i) => {
    if (p.value === null) segments.push([]);
    else segments[segments.length - 1]!.push([i * slot + slot / 2, y(p.value)]);
  });
  return (
    <Svg width={width} height={(width * H) / W} viewBox={`0 0 ${W} ${H}`}>
      {kind === 'bar'
        ? series.map((p, i) => {
            if (p.value === null) return null;
            const v = p.value;
            const over = reference != null && v > reference;
            return (
              <Rect
                key={p.start}
                x={i * slot + slot * 0.15}
                width={slot * 0.7}
                y={Math.min(y(v), zero)}
                height={Math.max(v !== 0 ? 1.5 : 0, Math.abs(zero - y(v)))}
                rx={1.5}
                fill={over ? colors.accent : colors.textSecondary}
                opacity={over ? 1 : 0.55}
              />
            );
          })
        : segments
            .filter(pts => pts.length > 0)
            .map((pts, k) =>
              pts.length === 1 ? (
                <Circle key={k} cx={pts[0]![0]} cy={pts[0]![1]} r={1.75} fill={NEUTRAL_FILL} />
              ) : (
                <Polyline key={k} fill="none" stroke={NEUTRAL_FILL} strokeWidth={1.75} strokeLinejoin="round" points={pts.map(([x, py]) => `${x},${py}`).join(' ')} />
              ),
            )}
      {reference != null ? <Line x1={0} x2={W} y1={y(reference)} y2={y(reference)} stroke={colors.textTertiary} strokeDasharray="3 3" strokeWidth={1} /> : null}
      <Line x1={0} x2={W} y1={zero} y2={zero} stroke={colors.border} strokeWidth={1} />
      {series.map((p, i) =>
        i % Math.ceil(series.length / 8) === 0 ? (
          <SvgText key={p.start} x={i * slot + slot / 2} y={H - 2} textAnchor="middle" fontSize={8} fill={colors.textTertiary}>
            {shortLabel(p.start, group)}
          </SvgText>
        ) : null,
      )}
    </Svg>
  );
}

const CELL = 5;
const GAP = 1;

/** Every day of `year` as a cell, weeks as columns, like the web's YearGrid. Tapping a past day picks it. */
export function YearGrid({ year, weekStart, colorOf, today, onPick, width }: {
  year: number;
  weekStart: number;
  colorOf: (day: string) => string | undefined;
  today: string;
  onPick?: ((day: string) => void) | undefined;
  width: number;
}): React.JSX.Element {
  const first = Date.UTC(year, 0, 1);
  const days = Math.round((Date.UTC(year + 1, 0, 1) - first) / 86_400_000);
  const jsDay = new Date(first).getUTCDay();
  const offset = (((jsDay + 6) % 7) - weekStart + 7) % 7;
  const cols = Math.ceil((days + offset) / 7);
  const vbW = cols * (CELL + GAP);
  const vbH = 7 * (CELL + GAP);
  const scale = width / vbW;
  const cells = [];
  for (let i = 0; i < days; i++) {
    const day = new Date(first + i * 86_400_000).toISOString().slice(0, 10);
    const slot = i + offset;
    const future = day > today;
    cells.push(
      <Rect
        key={day}
        x={Math.floor(slot / 7) * (CELL + GAP)}
        y={(slot % 7) * (CELL + GAP)}
        width={CELL}
        height={CELL}
        rx={1}
        fill={colorOf(day) ?? EMPTY_FILL}
        opacity={future ? 0.35 : 1}
        stroke={day === today ? colors.text : 'none'}
        strokeWidth={day === today ? 0.8 : 0}
      />,
    );
  }
  // Cells are a few points wide: a tap maps to its day by position rather
  // than per-cell handlers, which would be too small to hit.
  const pick = (x: number, y: number) => {
    if (!onPick) return;
    const col = Math.floor(x / scale / (CELL + GAP));
    const row = Math.floor(y / scale / (CELL + GAP));
    const i = col * 7 + row - offset;
    if (i < 0 || i >= days) return;
    const day = new Date(first + i * 86_400_000).toISOString().slice(0, 10);
    if (day <= today) onPick(day);
  };
  return (
    <Pressable disabled={!onPick} onPress={e => pick(e.nativeEvent.locationX, e.nativeEvent.locationY)}>
      <Svg width={width} height={vbH * scale} viewBox={`0 0 ${vbW} ${vbH}`}>
        {cells}
      </Svg>
    </Pressable>
  );
}

export function Legend({ options }: { options: PluginOption[] }): React.JSX.Element {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 12, rowGap: 4 }}>
      {options.map(o => (
        <View key={o.value} style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
          <View style={{ width: 9, height: 9, borderRadius: 2, backgroundColor: o.color ?? NEUTRAL_FILL }} />
          <Text style={{ fontSize: 12, color: colors.textSecondary }}>{o.label}</Text>
        </View>
      ))}
    </View>
  );
}

/** Horizontal bars: how many records carry each option. */
export function BreakdownBars({ rows }: { rows: { option: PluginOption; count: number }[] }): React.JSX.Element {
  const total = rows.reduce((a, r) => a + r.count, 0);
  return (
    <View style={{ gap: 7 }}>
      {rows.map(({ option, count }) => {
        const pct = total > 0 ? Math.round((count / total) * 100) : 0;
        return (
          <View key={option.value} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={{ width: 96, fontSize: 13, color: colors.text }} numberOfLines={1}>{option.label}</Text>
            <View style={{ flex: 1, height: 6, backgroundColor: EMPTY_FILL, borderRadius: 99, overflow: 'hidden' }}>
              <View style={{ height: '100%', width: `${pct}%`, backgroundColor: option.color ?? NEUTRAL_FILL }} />
            </View>
            <Text style={{ width: 64, fontSize: 12, color: colors.textSecondary, textAlign: 'right' }}>{count} · {pct}%</Text>
          </View>
        );
      })}
    </View>
  );
}
