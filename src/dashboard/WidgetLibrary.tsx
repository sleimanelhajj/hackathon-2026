import { memo, useEffect, useState, type ReactNode } from "react";
import { GridStack } from "gridstack";
import { createPortal } from "react-dom";
import { GripVertical, Lightbulb, Plus, Search } from "lucide-react";
import { CATALOG } from "../../shared/spec.js";

/** A board's widget catalogue (CATALOG for email, SALES_CATALOG for sales). */
export type Catalog = Record<string, { label: string; description: string; size: { w: number; h: number }; hidden?: boolean }>;
import type { WidgetType } from "../lib/api";
import { REGISTRY } from "../widgets/registry";
import { LIBRARY_ITEM_CLASS, NEW_PREFIX } from "./DashboardGrid";

export const WIDGET_DRAG_MIME = "application/x-workspace-widget";

type Props = {
  onAdd: (type: WidgetType) => void;
  /** Save / Cancel / Reset, pinned to the bottom of the panel. */
  footer: ReactNode;
  full: boolean;
  busy?: boolean;
  onDragBegin: (type: WidgetType) => void;
  onDragFinish: () => void;
  /** Which widgets this board offers. Defaults to the email catalogue. */
  catalog?: Catalog;
};

/** One panel entry: GridStack makes it draggable onto the canvas (see setupDragIn below); + adds it to free space. */
function LibraryItem({ type, onAdd, full, catalog }: { type: WidgetType; onAdd: (t: WidgetType) => void; full: boolean; catalog: Catalog }) {
  const Icon = REGISTRY[type].icon;
  return (
    <li className="library-item" data-full={full || undefined}>
      <div className={LIBRARY_ITEM_CLASS} data-type={type}>
        <span className="library-grip" aria-hidden><GripVertical size={15} /></span>
        <span className="library-icon" aria-hidden><Icon size={16} /></span>
        <span className="library-text"><span className="library-name">{catalog[type].label}</span>
          <span className="library-desc">{catalog[type].description}</span></span>
      </div>
      <button className="icon-btn icon-btn-sm library-add" onClick={() => onAdd(type)} disabled={full}
        aria-label={"Add " + catalog[type].label} title="Add widget"><Plus size={16} /></button>
    </li>
  );
}

/** Right-hand "Add widgets" panel shown while editing. Rendered into the shell's #side-panel slot. */
export const WidgetLibrary = memo(function WidgetLibrary({ onAdd, footer, full, busy, catalog = CATALOG as Catalog }: Props) {
  // Hidden entries (custom charts) are made by the assistant, not picked from the panel.
  const TYPES = (Object.keys(catalog) as WidgetType[]).filter((t) => !catalog[t].hidden);
  const [query, setQuery] = useState("");
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => setSlot(document.getElementById("side-panel")), []);

  const q = query.trim().toLowerCase();
  const types = q ? TYPES.filter((t) => `${catalog[t].label} ${catalog[t].description}`.toLowerCase().includes(q)) : TYPES;

  // Register the visible entries with GridStack: each one drags as a clone and creates a widget of
  // its catalogue size where it is dropped. Runs again when the list changes (search).
  const typeKey = types.join(",");
  useEffect(() => {
    if (!slot) return;
    const els = [...slot.querySelectorAll<HTMLElement>(`.${LIBRARY_ITEM_CLASS}`)];
    GridStack.setupDragIn(els, { appendTo: "body", helper: "clone" },
      els.map((el) => { const type = el.dataset.type as WidgetType; return { id: NEW_PREFIX + type, w: catalog[type].size.w, h: catalog[type].size.h }; }));
  }, [slot, typeKey]);

  if (!slot) return null;
  return createPortal(
    <section id="widget-library" className="side-panel" aria-label="Add widgets" inert={busy}>
      <header className="side-panel-head">
        <h2 className="side-panel-title">Add widgets</h2>
        <p className="side-panel-sub">Drag a widget onto the dashboard and drop it where you want it, or press + to add it to an open space.</p>
      </header>

      <label className="search">
        <Search size={15} aria-hidden />
        <span className="sr-only">Search widgets</span>
        <input type="search" placeholder="Search widgets" value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>

      <ul className="library-list">
        {types.map((type) => <LibraryItem key={type} type={type} onAdd={onAdd} full={full} catalog={catalog} />)}
        {types.length === 0 && <li className="library-none">No widget matches “{query}”.</li>}
      </ul>

      <p className="side-panel-tip">
        <Lightbulb size={14} aria-hidden />
        {full ? "You have 24 widgets. Remove one to add another." : "Cards stay where you drop them. Drop one on another and that one moves down."}
      </p>

      <footer className="side-panel-foot">{footer}</footer>
    </section>,
    slot
  );
});
