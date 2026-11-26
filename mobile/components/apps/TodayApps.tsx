import { showsOnToday } from '@pomodoso/types/plugins';
import type { PluginRow } from '@pomodoso/types/plugins/rows';
import { router } from 'expo-router';
import { useMemo } from 'react';
import { Alert, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { colors } from '@/constants/theme';
import { useAuth } from '@/hooks/useAuth';
import { isSupported, usePluginClock, usePluginData, usePlugins } from '@/hooks/usePlugins';
import { addRecord, deleteRecord, localToday, setDaily, updateRecord, type PluginClock } from '@/utils/plugins';

import { TodayWidget, widgetIsWide } from './TodayWidget';

// Ports the extension's TodayApps: the "Apps" section of Today, a widget for
// every app whose file declares one and that the user switched on. Like the
// extension it shows only when signed in (signed out, widgets are off).

const GAP = 8;

export function TodayApps(): React.JSX.Element | null {
  const { session } = useAuth();
  const plugins = usePlugins();
  const clock = usePluginClock();
  const { width: screen } = useWindowDimensions();
  const pinned = useMemo(
    () => (plugins ?? []).filter(p => p.enabled && isSupported(p) && showsOnToday(p.manifest, p.settings)),
    [plugins],
  );
  if (!session || pinned.length === 0) return null;
  const row = screen - 40;
  return (
    <View style={{ gap: 8 }}>
      <Text style={styles.title}>Apps</Text>
      <View style={styles.grid}>
        {pinned.map(p => (
          <Pinned key={p.id} plugin={p} clock={clock} row={row} />
        ))}
      </View>
    </View>
  );
}

function Pinned({ plugin, clock, row }: { plugin: PluginRow; clock: PluginClock; row: number }): React.JSX.Element | null {
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
    <View style={{ width }}>
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
        open={() => router.push(`/apps/${plugin.id}`)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 12, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', color: colors.textTertiary, marginTop: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP },
});
