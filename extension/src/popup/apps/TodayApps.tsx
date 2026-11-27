import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

import { showsOnToday, sortTodayApps, todayOrderChanges } from '@pomodoso/types/plugins';
import { TodayWidget } from '@pomodoso/ui/plugins';

import { db, localDate, type PluginRow } from '../../db';
import { addRecord, deleteRecord, setDaily, setTodayOrder, updateRecord } from '../../plugins';
import { triggerSync } from '../../syncEngine';
import { useLocalStorage } from '../useStorage';
import { TodaySectionHeader } from '../TodaySectionHeader';
import { DND_MEASURING, dragStyle, useDragResizeGuard } from '../dragGuard';
import { appPageUrl } from './appEnv';
import { isSupported } from './supported';
import { usePluginData } from './usePluginData';

// The "Apps" section of Today: a widget for every app whose file declares
// one and that the user switched on. Lazy-loaded with the plugin engine;
// HomeState renders it only when signed in (signed out, widgets are off).
// Foldable (open by default); folded, it says how many apps it holds.
//
// The cards can be dragged into any order. The order is stored in each app's
// settings (TODAY_ORDER_KEY), so it syncs with the app.

/**
 * PointerSensor that leaves the card's own controls alone: a press on its +,
 * a chip or the page field is that control's, never the start of a drag, so
 * selecting text in a field can't pick the card up.
 */
class CardPointerSensor extends PointerSensor {
  static override activators = [{
    eventName: 'onPointerDown' as const,
    handler: ({ nativeEvent }: ReactPointerEvent) =>
      nativeEvent.isPrimary && nativeEvent.button === 0
      && !(nativeEvent.target as Element | null)?.closest('button, input, textarea, select, a, [contenteditable="true"]'),
  }];
}

export function TodayApps({ timezone, weekStart, onOpenApp }: { timezone: string; weekStart: number; onOpenApp: (id: string) => void }) {
  const pinned = useLiveQuery(
    async () => sortTodayApps((await db.plugins.toArray()).filter((p) => !p.deletedAt && p.enabled && isSupported(p) && showsOnToday(p.manifest, p.settings))),
    [],
  );
  const [open, setOpen] = useLocalStorage<boolean>('pom_today_apps_open', true);
  // The keyboard picks a card up with Space (Enter still opens it), moves it
  // with the arrow keys, and drops it with Space again; Escape cancels.
  const sensors = useSensors(
    useSensor(CardPointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space'] },
    }),
  );
  const [moveError, setMoveError] = useState<string | null>(null);
  const dragGuard = useDragResizeGuard();
  // A drop ends with a click on the card under the pointer, which would open
  // the app. Swallowed for that one click.
  const justDragged = useRef(false);

  const onDragEnd = (event: DragEndEvent) => {
    dragGuard.onDragSettled();
    setTimeout(() => { justDragged.current = false; }, 0);
    const { active, over } = event;
    if (!pinned || !over || active.id === over.id) return;
    const ids = pinned.map((p) => p.id);
    const next = arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id)));
    setMoveError(null);
    setTodayOrder(todayOrderChanges(next, pinned))
      .then(() => triggerSync())
      .catch((e: unknown) => setMoveError(e instanceof Error ? e.message : "Couldn't save the new order"));
  };

  if (!pinned || pinned.length === 0) return null;
  return (
    <div style={{ padding: '12px 14px 0' }}>
      <TodaySectionHeader label="Apps" open={open} onToggle={() => setOpen((o) => !o)} summary={`${pinned.length} app${pinned.length === 1 ? '' : 's'}`} />
      {open ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          measuring={DND_MEASURING}
          onDragStart={() => { dragGuard.onDragStart(); justDragged.current = true; }}
          onDragEnd={onDragEnd}
          onDragCancel={() => { dragGuard.onDragSettled(); justDragged.current = false; }}
        >
          <SortableContext items={pinned.map((p) => p.id)} strategy={rectSortingStrategy}>
            <div
              style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 6 }}
              onClickCapture={(e) => { if (justDragged.current) { e.stopPropagation(); e.preventDefault(); } }}
            >
              {pinned.map((p) => (
                <PinnedApp key={p.id} plugin={p} timezone={timezone} weekStart={weekStart} onOpen={() => onOpenApp(p.id)} />
              ))}
            </div>
          </SortableContext>
          {moveError ? (
            <div role="alert" style={{ fontSize: 11, color: 'var(--color-accent)', marginTop: 6 }}>{moveError}</div>
          ) : null}
        </DndContext>
      ) : null}
    </div>
  );
}

function PinnedApp({ plugin, timezone, weekStart, onOpen }: { plugin: PluginRow; timezone: string; weekStart: number; onOpen: () => void }) {
  const { evaluator } = usePluginData(plugin, timezone, weekStart);
  const env = useMemo(() => ({ timezone, weekStart }), [timezone, weekStart]);
  const { setNodeRef, transform, transition, isDragging, listeners, attributes } = useSortable({ id: plugin.id });
  if (!evaluator) return null;
  return (
    <TodayWidget
      manifest={plugin.manifest}
      settings={plugin.settings}
      evaluator={evaluator}
      today={localDate(timezone)}
      now={new Date().toISOString()}
      timeZone={timezone}
      weekStart={weekStart}
      readOnly={false}
      add={(c, data) => addRecord(plugin, c, data, env)}
      remove={(r) => deleteRecord(plugin, r.id)}
      update={(r, data) => updateRecord(plugin, r.id, data, env)}
      setDay={(c, day, data) => setDaily(plugin, c, day, data, env)}
      onOpen={onOpen}
      // A record's screen or another view: in the app's own tab, where boards have room.
      open={(view, record) => void chrome.tabs.create({ url: appPageUrl(plugin.id, view, record) })}
      container={{
        ref: setNodeRef,
        style: { ...dragStyle(CSS.Translate.toString(transform), transition, isDragging), position: 'relative', zIndex: isDragging ? 2 : undefined, cursor: isDragging ? 'grabbing' : 'pointer' },
        // The card is already a focusable button; only the description
        // that tells screen readers how to move it is taken from dnd-kit.
        props: { ...listeners, 'aria-describedby': attributes['aria-describedby'] },
      }}
    />
  );
}
