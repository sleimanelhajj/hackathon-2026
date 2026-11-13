import { memo, useCallback, useEffect, useMemo, useReducer, useRef, type ReactElement } from "react";
import { Responsive, useContainerWidth, type Layout, type LayoutItem } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import { CATALOG } from "../../shared/spec.js";
import type { GridItem, Widget, WidgetType } from "../lib/api";
import { BREAKPOINTS, COLS, MARGIN, ROW_HEIGHT, deriveLayouts, toGridItems, type Breakpoint } from "./layout";

type Props = {
  widgets: Widget[];
  layout: GridItem[];
  collapsed: Record<string, boolean>;
  editing: boolean;
  /** Type being dragged in from the library (null when nothing is). */
  dragType: WidgetType | null;
  children: ReactElement[];
  /** Called once per finished drag or resize, never during one. */
  onLayoutCommit: (layout: GridItem[]) => void;
  onDropWidget: (type: WidgetType, at: { x: number; y: number }) => void;
  onBreakpointChange: (bp: Breakpoint) => void;
};

/**
 * Thin wrapper around react-grid-layout.
 *
 * Smoothness rule: the grid owns positions while the pointer is down. We only read the result
 * on drag/resize stop. Feeding every intermediate layout back as props makes the library
 * re-sync mid-drag, which is what causes jitter.
 */
export const DashboardGrid = memo(function DashboardGrid({
  widgets,
  layout,
  collapsed,
  editing,
  dragType,
  children,
  onLayoutCommit,
  onDropWidget,
  onBreakpointChange,
}: Props) {
  const { width, containerRef, mounted } = useContainerWidth();

  // Workaround for react-grid-layout 2.3.0: GridItem is memoized on x/y/w/h and on the
  // identity of the onDrag/onResize callbacks, so the item under the pointer only redraws
  // when it crosses a grid cell (it jumps ~100px at a time). Bumping a counter on every move
  // gives the grid a fresh callback each frame, so the active item follows the pointer.
  // Widget contents stay memoized (WidgetFrame), so this costs a few cheap renders per frame.
  // Remove once the library redraws the dragged item itself.
  const [, nudge] = useReducer((n: number) => n + 1, 0);
  const onLiveMove = () => nudge();
  const hostRef = useRef<HTMLDivElement | null>(null);

  const layouts = useMemo(() => deriveLayouts(layout, widgets, collapsed, editing), [layout, widgets, collapsed, editing]);
  const ids = useMemo(() => new Set(widgets.map((w) => w.id)), [widgets]);
  const dropSize = dragType ? CATALOG[dragType].size : { w: 4, h: 6 };

  // Work out the breakpoint from the measured width: the library's callback only fires on change.
  const bp: Breakpoint = width >= BREAKPOINTS.lg ? "lg" : width >= BREAKPOINTS.md ? "md" : "sm";
  useEffect(() => {
    if (mounted) onBreakpointChange(bp);
  }, [bp, mounted, onBreakpointChange]);
  const canEdit = editing && bp === "lg";

  // Toggle a DOM flag (not React state) so widget bodies stop taking pointer events mid-drag
  // without re-rendering anything.
  const setDragging = (on: boolean) => {
    const el = hostRef.current;
    if (el) el.dataset.dragging = on ? "true" : "false";
  };

  const commit = useCallback(
    (current: Layout) => {
      setDragging(false);
      if (!canEdit) return;
      onLayoutCommit(toGridItems(current.filter((it: LayoutItem) => ids.has(it.i))));
    },
    [canEdit, ids, onLayoutCommit]
  );

  const handleDrop = useCallback(
    (_layout: Layout, item: LayoutItem | undefined, e: Event) => {
      const type = ((e as DragEvent).dataTransfer?.getData("text/plain") || dragType) as WidgetType | null;
      if (item && type && type in CATALOG) onDropWidget(type, { x: item.x, y: item.y });
    },
    [dragType, onDropWidget]
  );

  const setRefs = useCallback(
    (el: HTMLDivElement | null) => {
      hostRef.current = el;
      (containerRef as { current: HTMLDivElement | null }).current = el;
    },
    [containerRef]
  );

  return (
    <div ref={setRefs} className="grid-host" data-editing={canEdit} data-dragging="false">
      {mounted && (
        <Responsive
          width={width}
          layouts={layouts}
          breakpoints={BREAKPOINTS}
          cols={COLS}
          rowHeight={ROW_HEIGHT}
          margin={MARGIN}
          containerPadding={[0, 0]}
          dragConfig={{ enabled: canEdit, handle: ".widget-handle", threshold: 3 }}
          resizeConfig={{ enabled: canEdit, handles: ["se"] }}
          dropConfig={{ enabled: canEdit, defaultItem: { w: dropSize.w, h: dropSize.h } }}
          droppingItem={{ i: "__dropping__", x: 0, y: 0, w: dropSize.w, h: dropSize.h }}
          onDragStart={() => setDragging(true)}
          onResizeStart={() => setDragging(true)}
          onDrag={onLiveMove}
          onResize={onLiveMove}
          onDragStop={commit}
          onResizeStop={commit}
          onDrop={handleDrop}
        >
          {children}
        </Responsive>
      )}
    </div>
  );
});
