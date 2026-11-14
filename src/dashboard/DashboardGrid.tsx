import { memo, useEffect, useMemo, useRef, type ReactNode } from "react";
import { GridStack, type GridItemHTMLElement } from "gridstack";
import "gridstack/dist/gridstack.min.css";
import { CATALOG } from "../../shared/spec.js";
import type { GridItem, Widget, WidgetType } from "../lib/api";
import { COLLAPSED_H, GAP, ROW_HEIGHT, collapseLayout } from "./layout";

/** Class on the panel entries GridStack accepts as new widgets (see WidgetLibrary). */
export const LIBRARY_ITEM_CLASS = "library-drag";
/** Panel entries carry the id `new:<type>` so a drop tells us which widget to create. */
export const NEW_PREFIX = "new:";

const COLUMNS = 12;
const MIN_W = 2;
const MIN_H = 2;

type Props = {
  widgets: Widget[];
  layout: GridItem[];
  collapsed: Record<string, boolean>;
  editing: boolean;
  busy?: boolean;
  /** Kept for API compatibility with the page; GridStack reads the type from the dragged element. */
  addingType?: WidgetType | null;
  onChange: (layout: GridItem[]) => void;
  onDrop: (type: WidgetType, item: GridItem, layout: GridItem[]) => void;
  renderCard: (widget: Widget) => ReactNode;
  /** Widget types this board accepts from the panel (defaults to the email catalogue). */
  catalog?: Record<string, unknown>;
};

/**
 * The dashboard canvas, built on GridStack (https://gridstackjs.com).
 *
 * GridStack owns all pointer work: dragging, resizing, pushing other cards out of the way,
 * and accepting cards dragged in from the side panel. `float: true` means cards stay exactly
 * where they are dropped (empty space is kept); dropping onto another card pushes that card down.
 *
 * React owns the card contents. React renders one `.grid-stack-item` per widget; the effects
 * below register new ones with GridStack (`makeWidget`), unregister removed ones, and push
 * layout changes that came from outside a drag (keyboard moves, size inputs, reset, undo).
 * GridStack reports finished gestures through `change` / `dropped`, which update React state.
 */
export const DashboardGrid = memo(function DashboardGrid({ widgets, layout, collapsed, editing, busy, onChange, onDrop, renderCard, catalog = CATALOG }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<GridStack | null>(null);
  const syncing = useRef(false);
  const handlers = useRef({ onChange, onDrop, catalog });
  handlers.current = { onChange, onDrop, catalog };

  // Folded cards give their space back to the cards below them (view mode only; editing shows the saved layout).
  const positions = useMemo(() => {
    const shown = editing ? layout : collapseLayout(layout, collapsed, COLLAPSED_H);
    return Object.fromEntries(shown.map((l) => [l.i, l])) as Record<string, GridItem>;
  }, [layout, collapsed, editing]);

  // Create the grid once per mount (the page remounts this component when edit mode toggles).
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const grid: GridStack = GridStack.init(
      {
        column: COLUMNS,
        cellHeight: ROW_HEIGHT + GAP,
        margin: GAP / 2,
        mode: "float",
        animate: true,
        staticGrid: !editing,
        minRow: editing ? 10 : 0,
        draggable: { handle: ".widget-handle", cancel: "input, select, textarea, a, .icon-btn, .widget-config" },
        resizable: { handles: "se" },
        alwaysShowResizeHandle: true,
        acceptWidgets: editing ? (el: Element) => el.classList.contains(LIBRARY_ITEM_CLASS) : false,
        columnOpts: { breakpoints: [{ w: 640, c: 1 }], layout: "list" },
      },
      host
    )!;
    gridRef.current = grid;

    const read = (): GridItem[] =>
      grid.engine.nodes
        .filter((n) => n.id && !String(n.id).startsWith(NEW_PREFIX))
        .map((n) => ({ i: String(n.id), x: n.x ?? 0, y: n.y ?? 0, w: n.w ?? 1, h: n.h ?? 1 }));

    grid.on("change", () => {
      // Ignore our own programmatic updates and the temporary one-column phone layout.
      if (syncing.current || grid.getColumn() !== COLUMNS) return;
      handlers.current.onChange(read());
    });
    grid.on("dragstart resizestart", () => host.setAttribute("data-active", "true"));
    grid.on("dragstop resizestop", () => host.removeAttribute("data-active"));
    grid.on("dropped", (_event, _previous, node) => {
      if (!node) return;
      const type = String(node.id ?? "").slice(NEW_PREFIX.length) as WidgetType;
      const item: GridItem = { i: "__new__", x: node.x ?? 0, y: node.y ?? 0, w: node.w ?? 3, h: node.h ?? 3 };
      // GridStack inserted its own placeholder element; React will render the real card instead.
      syncing.current = true;
      if (node.el) grid.removeWidget(node.el, true, false);
      syncing.current = false;
      if (type in handlers.current.catalog) handlers.current.onDrop(type, item, read());
    });

    return () => {
      grid.destroy(false);
      gridRef.current = null;
    };
  }, [editing]);

  // Keep GridStack in step with React: register new cards, drop removed ones, apply outside changes.
  useEffect(() => {
    const grid = gridRef.current;
    const host = hostRef.current;
    if (!grid || !host) return;
    syncing.current = true;
    grid.batchUpdate();
    for (const node of [...grid.engine.nodes]) {
      if (node.el && !node.el.isConnected) grid.removeWidget(node.el, false, false);
    }
    const moves: { el: GridItemHTMLElement; p: GridItem; rank: number }[] = [];
    host.querySelectorAll<GridItemHTMLElement>(":scope > .grid-stack-item").forEach((el) => {
      const id = el.getAttribute("gs-id");
      const p = id ? positions[id] : undefined;
      if (!id || !p) return;
      const node = el.gridstackNode;
      if (!node) grid.makeWidget(el, { id, x: p.x, y: p.y, w: p.w, h: p.h, minW: MIN_W, minH: MIN_H });
      else if (grid.getColumn() === COLUMNS && (node.x !== p.x || node.y !== p.y || node.w !== p.w || node.h !== p.h))
      {
        // Order matters so nothing collides on the way and gets pushed: shrink folded cards, lift cards top-down,
        // lower cards bottom-up, then grow unfolded cards.
        const h = node.h ?? p.h, y = node.y ?? p.y;
        const rank = p.h < h ? -1e6 + p.y : p.y < y ? -1e5 + p.y : p.y > y ? -p.y : p.h > h ? 1e6 : 0;
        moves.push({ el, p, rank });
      }
    });
    moves.sort((a, b) => a.rank - b.rank);
    for (const { el, p } of moves) grid.update(el, { x: p.x, y: p.y, w: p.w, h: p.h });
    grid.batchUpdate(false);
    syncing.current = false;
  }, [positions, widgets]);

  return (
    <div className="dashboard-canvas" inert={busy} data-editing={editing}>
      {editing && <p className="canvas-instructions">Drag a card by its title to place it anywhere. Drop it on another card and that card moves down. Resize from the bottom-right corner.</p>}
      <p id="grid-keyboard-help" className="sr-only">Focus a widget title and use arrow keys to move it. Hold Shift and use arrow keys to resize.</p>
      <div ref={hostRef} className="grid-stack dashboard-layout">
        {widgets.map((widget) => {
          const p = positions[widget.id];
          if (!p) return null;
          return (
            <div key={widget.id} id={`widget-${widget.id}`} className="grid-stack-item" data-kind={widget.type}
              gs-id={widget.id} gs-x={p.x} gs-y={p.y} gs-w={p.w} gs-h={p.h} gs-min-w={MIN_W} gs-min-h={MIN_H}>
              <div className="grid-stack-item-content">{renderCard(widget)}</div>
            </div>
          );
        })}
      </div>
      {widgets.length === 0 && <div className="canvas-empty"><strong>Your workspace starts here</strong><p>Add a widget from the panel, then place it anywhere on the grid.</p></div>}
    </div>
  );
});
