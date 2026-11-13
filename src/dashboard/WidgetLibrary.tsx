import { memo, useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { GripVertical, Lightbulb, Plus, Search } from "lucide-react";
import { CATALOG } from "../../shared/spec.js";
import type { WidgetType } from "../lib/api";
import { REGISTRY } from "../widgets/registry";

type Props = {
  onAdd: (type: WidgetType) => void;
  onDragType: (type: WidgetType | null) => void;
  /** Save / Cancel / Reset, pinned to the bottom of the panel. */
  footer: ReactNode;
  /** Shown above the list when editing isn't possible at this width. */
  notice?: ReactNode;
};

const TYPES = Object.keys(CATALOG) as WidgetType[];

/** Right-hand "Add widgets" panel shown while editing. Rendered into the shell's #side-panel slot. */
export const WidgetLibrary = memo(function WidgetLibrary({ onAdd, onDragType, footer, notice }: Props) {
  const [query, setQuery] = useState("");
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => setSlot(document.getElementById("side-panel")), []);

  const q = query.trim().toLowerCase();
  const types = q ? TYPES.filter((t) => `${CATALOG[t].label} ${CATALOG[t].description}`.toLowerCase().includes(q)) : TYPES;

  if (!slot) return null;
  return createPortal(
    <section className="side-panel" aria-label="Add widgets">
      <header className="side-panel-head">
        <h2 className="side-panel-title">Add widgets</h2>
        <p className="side-panel-sub">Drag one onto the dashboard, or press + to add it at the end.</p>
      </header>

      {notice}

      <label className="search">
        <Search size={15} aria-hidden />
        <span className="sr-only">Search widgets</span>
        <input type="search" placeholder="Search widgets" value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>

      <ul className="library-list">
        {types.map((type) => {
          const Icon = REGISTRY[type].icon;
          return (
            <li
              key={type}
              className="library-item"
              draggable
              onDragStart={(e) => {
                // Firefox needs data on the transfer for the drag to start.
                e.dataTransfer.setData("text/plain", type);
                e.dataTransfer.effectAllowed = "copy";
                onDragType(type);
              }}
              onDragEnd={() => onDragType(null)}
            >
              <span className="library-grip" aria-hidden><GripVertical size={15} /></span>
              <span className="library-icon" aria-hidden><Icon size={16} /></span>
              <span className="library-text">
                <span className="library-name">{CATALOG[type].label}</span>
                <span className="library-desc">{CATALOG[type].description}</span>
              </span>
              <button className="icon-btn icon-btn-sm library-add" onClick={() => onAdd(type)} aria-label={`Add ${CATALOG[type].label}`} title="Add to the end">
                <Plus size={16} />
              </button>
            </li>
          );
        })}
        {types.length === 0 && <li className="library-none">No widget matches “{query}”.</li>}
      </ul>

      <p className="side-panel-tip">
        <Lightbulb size={14} aria-hidden />
        Folded widgets open up while you edit, so you can see their real size.
      </p>

      <footer className="side-panel-foot">{footer}</footer>
    </section>,
    slot
  );
});
