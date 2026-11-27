// Drag-and-drop pieces shared by every sortable list in the popup.
import { MeasuringStrategy } from '@dnd-kit/core';
import { useEffect, useRef } from 'react';
import type React from 'react';

// Chrome's browser-action popup emits spurious `resize` events — three of them
// during a single drag, with innerWidth/innerHeight identical (360x600) before
// and after, so nothing has actually resized. dnd-kit registers
// `window.resize -> handleCancel` for the lifetime of a drag, so each of those
// phantom events cancelled the drag a few pixels in. Its own live region said
// it out loud: "Dragging was cancelled."
//
// This is why reordering worked everywhere it was tested except the one place
// that matters: the popup HTML in a tab never fires them.
//
// The listener below is registered at mount, so it precedes dnd-kit's (added
// when a drag starts) and wins the registration-order race at the event target,
// letting stopImmediatePropagation keep the cancel handler from running. It
// only swallows while a drag is in flight; a genuine resize outside one is left
// alone.
export function useDragResizeGuard() {
  const dragging = useRef(false);
  useEffect(() => {
    const swallow = (e: Event) => { if (dragging.current) e.stopImmediatePropagation(); };
    window.addEventListener('resize', swallow, true);
    return () => window.removeEventListener('resize', swallow, true);
  }, []);
  return {
    onDragStart: () => { dragging.current = true; },
    onDragSettled: () => { dragging.current = false; },
  };
}

// Shared by every DndContext here.
//
// collisionDetection: dnd-kit defaults to rectIntersection, which only reports
// a drop target when the dragged rect genuinely overlaps it. That makes drops
// fail outright whenever pointer coordinates and measured rects disagree —
// which is what happens when the popup is rendered at a browser zoom above
// 100%: the row lifts and follows the cursor, nothing else shifts, and the
// drop is silently discarded because `over` was never set. closestCenter just
// picks the nearest droppable centre, so a small coordinate skew costs
// accuracy rather than the whole interaction.
//
// measuring Always: re-measure droppables during the drag instead of once at
// the start, so a list that reflows mid-drag (or a scroll container that
// moves) doesn't leave dnd-kit working from stale rects.
export const DND_MEASURING = { droppable: { strategy: MeasuringStrategy.Always } } as const;

// Applied to the whole row. There is no visible grip: a row is picked up by
// dragging it anywhere, and PointerSensor's distance constraint is what keeps
// that from swallowing the click that opens the task.
//
// userSelect:'none' is the part that makes dragging actually feel like
// dragging. A row is mostly text, and PointerSensor does not preventDefault on
// mousedown, so without this a press-and-drag starts a native text selection:
// the row stays put, the title highlights blue, and the gesture reads as
// "reordering is broken". Synthetic pointer events never reproduce it, which is
// why it survived a pass of automated checking.
//
// touchAction:'none' is the same story for touch and pen input, where the
// browser would otherwise claim the vertical drag as a scroll of .scroll-area
// before dnd-kit sees it.
export function dragStyle(transform: string | null | undefined, transition: string | undefined, isDragging: boolean): React.CSSProperties {
  return {
    transform: transform ?? undefined,
    transition,
    opacity: isDragging ? 0.4 : 1,
    userSelect: 'none',
    WebkitUserSelect: 'none',
    touchAction: 'none',
    cursor: isDragging ? 'grabbing' : undefined,
  };
}
