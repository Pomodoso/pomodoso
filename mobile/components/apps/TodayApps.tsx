import { showsOnToday, sortTodayApps, todayOrderChanges, TODAY_ORDER_KEY } from '@pomodoso/types/plugins';
import { Ionicons } from '@expo/vector-icons';
import type { PluginRow } from '@pomodoso/types/plugins/rows';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { colors } from '@/constants/theme';
import { useAuth } from '@/hooks/useAuth';
import { isSupported, usePluginClock, usePluginData, usePlugins } from '@/hooks/usePlugins';
import { addRecord, deleteRecord, localToday, setDaily, updatePluginSetting, updateRecord, type PluginClock } from '@/utils/plugins';

import { TodayWidget, widgetIsWide } from './TodayWidget';

// Ports the extension's TodayApps: the "Apps" section of Today, a widget for
// every app whose file declares one and that the user switched on. Like the
// extension it shows only when signed in (signed out, widgets are off).
//
// Long-press a card to move it: the section enters move mode with that card
// picked, and ‹ › move it earlier or later. The order is stored in each app's
// settings (TODAY_ORDER_KEY), the same as the extension's drag, so it syncs.

const GAP = 8;

export function TodayApps(): React.JSX.Element | null {
  const { session } = useAuth();
  const plugins = usePlugins();
  const clock = usePluginClock();
  const { width: screen } = useWindowDimensions();
  const pinned = useMemo(
    () => sortTodayApps((plugins ?? []).filter(p => p.enabled && isSupported(p) && showsOnToday(p.manifest, p.settings))),
    [plugins],
  );
  const [moving, setMoving] = useState<string | null>(null);
  if (!session || pinned.length === 0) return null;
  const row = screen - 40;
  const canMove = pinned.length > 1;

  function move(id: string, delta: number): void {
    const ids = pinned.map(p => p.id);
    const from = ids.indexOf(id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= ids.length) return;
    ids.splice(to, 0, ...ids.splice(from, 1));
    try {
      for (const { id: changed, order } of todayOrderChanges(ids, pinned)) {
        updatePluginSetting(changed, TODAY_ORDER_KEY, order);
      }
    } catch (e) {
      Alert.alert("Couldn't save", e instanceof Error ? e.message : 'Unknown error');
    }
  }

  return (
    <View style={{ gap: 8 }}>
      <View style={styles.header}>
        <Text style={styles.title}>Apps</Text>
        {moving && (
          <Pressable style={styles.done} onPress={() => setMoving(null)} hitSlop={6}>
            <Ionicons name="checkmark" size={12} color={colors.accent} />
            <Text style={styles.doneText}>Done</Text>
          </Pressable>
        )}
      </View>
      <View style={styles.grid}>
        {pinned.map((p, i) => (
          <Pinned
            key={p.id}
            plugin={p}
            clock={clock}
            row={row}
            onLongPress={canMove ? () => setMoving(p.id) : undefined}
            mover={moving ? {
              picked: moving === p.id,
              pick: () => setMoving(p.id),
              earlier: i > 0 ? () => move(p.id, -1) : undefined,
              later: i < pinned.length - 1 ? () => move(p.id, 1) : undefined,
            } : undefined}
          />
        ))}
      </View>
    </View>
  );
}

interface Mover {
  picked: boolean;
  pick: () => void;
  earlier: (() => void) | undefined;
  later: (() => void) | undefined;
}

function Pinned({ plugin, clock, row, onLongPress, mover }: {
  plugin: PluginRow;
  clock: PluginClock;
  row: number;
  onLongPress: (() => void) | undefined;
  /** Move mode: the card's own controls are off, and the picked one shows ‹ ›. */
  mover: Mover | undefined;
}): React.JSX.Element | null {
  const { evaluator } = usePluginData(plugin, clock);
  if (!evaluator) return null;
  const today = localToday(clock.timeZone);
  const wide = widgetIsWide(plugin.manifest, evaluator, today);
  const width = wide ? row : (row - GAP) / 2;
  const guard = (f: () => void) => {
    try {
      f();
    } catch (e) {
      Alert.alert("Couldn't save", e instanceof Error ? e.message : 'Unknown error');
    }
  };
  return (
    <View style={[{ width }, mover?.picked && styles.picked]}>
      <View pointerEvents={mover ? 'none' : 'auto'} style={mover && !mover.picked ? styles.dimmed : undefined}>
      <TodayWidget
        manifest={plugin.manifest}
        settings={plugin.settings}
        evaluator={evaluator}
        today={today}
        now={new Date().toISOString()}
        timeZone={clock.timeZone}
        weekStart={clock.weekStart}
        readOnly={false}
        width={width}
        add={(c, data) => guard(() => addRecord(plugin, c, data, clock))}
        remove={r => guard(() => deleteRecord(plugin, r.id))}
        update={(r, data) => guard(() => updateRecord(plugin, r.id, data, clock))}
        setDay={(c, day, data) => guard(() => setDaily(plugin, c, day, data, clock))}
        onOpen={() => router.push(`/apps/${plugin.id}`)}
        // A list row opens its record's screen; the "more" row, another view.
        open={(view, record) =>
          router.push({ pathname: '/apps/[id]', params: { id: plugin.id, view, ...(record ? { record } : {}) } })
        }
        onLongPress={onLongPress}
      />
      </View>
      {mover && (
        // Over the card: in move mode a tap picks it, and the picked one
        // carries the arrows.
        <Pressable style={StyleSheet.absoluteFill} onPress={mover.pick}>
          {mover.picked && (
            <View style={styles.arrows}>
              <Pressable style={[styles.arrow, !mover.earlier && styles.arrowOff]} onPress={mover.earlier} disabled={!mover.earlier} hitSlop={4} accessibilityLabel="Move earlier">
                <Ionicons name="chevron-back" size={16} color={colors.textSecondary} />
              </Pressable>
              <Pressable style={[styles.arrow, !mover.later && styles.arrowOff]} onPress={mover.later} disabled={!mover.later} hitSlop={4} accessibilityLabel="Move later">
                <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
              </Pressable>
            </View>
          )}
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 12, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', color: colors.textTertiary, marginTop: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  done: {
    flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 8,
    paddingVertical: 2, paddingHorizontal: 7,
    borderWidth: 1, borderColor: colors.accent, borderRadius: 6, backgroundColor: colors.accentSoft,
  },
  doneText: { fontSize: 10, fontWeight: '600', color: colors.accent },
  picked: { borderRadius: 14, borderWidth: 2, borderColor: colors.accent },
  dimmed: { opacity: 0.55 },
  arrows: { position: 'absolute', right: 6, bottom: 6, flexDirection: 'row', gap: 6 },
  arrow: {
    width: 30, height: 30, borderRadius: 8,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  arrowOff: { opacity: 0.3 },
});
