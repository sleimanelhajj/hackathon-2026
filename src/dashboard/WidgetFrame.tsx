import { memo, useEffect, useRef, useState } from "react";
import { ChevronDown, GripVertical, Settings2, Trash2, X } from "lucide-react";
import type { Widget } from "../lib/api";
import { REGISTRY, WidgetBody } from "../widgets/registry";
import { WidgetErrorBoundary } from "./ErrorBoundary";
import { Select } from "../components/Select";
import type { Size } from "./layout";

type Props = {
  widget: Widget;
  editing: boolean;
  collapsed: boolean;
  size: Size;
  onToggleCollapse: (id: string) => void;
  onRemove: (id: string) => void;
  onChange: (widget: Widget) => void;
  onResize: (id: string, size: Size) => void;
  onMove: (id: string, dx: number, dy: number, resize: boolean) => void;
  /** Removes the widget from the saved dashboard (outside edit mode), after the user confirms. */
  onRemoveSaved?: (id: string) => void;
};

export const WidgetFrame = memo(function WidgetFrame({ widget, editing, collapsed, size, onToggleCollapse, onRemove, onChange, onResize, onMove, onRemoveSaved }: Props) {
  const def = REGISTRY[widget.type];
  const canCollapse = def.collapsible && !editing;
  const bodyId = `widget-body-${widget.id}`;
  const [configOpen, setConfigOpen] = useState(false);
  const configRef = useRef<HTMLDivElement>(null);
  const settingsRef = useRef<HTMLButtonElement>(null);
  // Remove (outside edit mode): a small confirmation anchored to the widget. Only its Remove button removes.
  const [confirming, setConfirming] = useState(false);
  const confirmRef = useRef<HTMLDivElement>(null);
  const removeRef = useRef<HTMLButtonElement>(null);
  const canRemove = Boolean(onRemoveSaved) && !editing;
  useEffect(() => {
    if (!confirming) return;
    confirmRef.current?.querySelector<HTMLButtonElement>(".btn-danger")?.focus();
    const outside = (event: PointerEvent) => {
      if (!confirmRef.current?.contains(event.target as Node) && !removeRef.current?.contains(event.target as Node)) setConfirming(false);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setConfirming(false); removeRef.current?.focus(); } };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [confirming]);

  useEffect(() => {
    if (!configOpen) return;
    // The dropdown's menu renders in a portal outside the popover; using it isn't "outside".
    const inMenu = (target: EventTarget | null) => target instanceof Element && Boolean(target.closest(".select-menu"));
    const outside = (event: PointerEvent) => {
      if (inMenu(event.target)) return;
      if (!configRef.current?.contains(event.target as Node) && !settingsRef.current?.contains(event.target as Node)) setConfigOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !inMenu(event.target)) { setConfigOpen(false); settingsRef.current?.focus(); }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [configOpen]);

  return (
    <section className="widget" data-editing={editing} data-config-open={(configOpen && editing) || confirming || undefined}
      data-collapsed={collapsed && !editing} data-kind={widget.type} aria-label={widget.title}>
      <header className="widget-head">
        {editing ? (
          <div className="widget-handle" role="button" tabIndex={0} aria-label={`Move ${widget.title}`} aria-describedby="grid-keyboard-help"
            title="Drag to move. Arrow keys move; Shift + arrows resize."
            onKeyDown={(event) => {
              const directions: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
              const direction = directions[event.key];
              if (direction) { event.preventDefault(); event.stopPropagation(); onMove(widget.id, ...direction, event.shiftKey); }
            }}>
            <GripVertical size={15} aria-hidden /><span className="widget-title">{widget.title}</span>
          </div>
        ) : canCollapse ? (
          <button className="widget-title-btn" aria-expanded={!collapsed} aria-controls={bodyId} onClick={() => onToggleCollapse(widget.id)}>
            <ChevronDown size={16} className="widget-chevron" aria-hidden /><h2 className="widget-title">{widget.title}</h2>
          </button>
        ) : <h2 className={widget.type === "stat" ? "widget-title widget-title-stat" : "widget-title"}>{widget.title}</h2>}
        {canRemove && (
          <button ref={removeRef} type="button" className="icon-btn icon-btn-sm widget-remove-btn" aria-label={`Remove ${widget.title}`}
            title="Remove from the dashboard" aria-expanded={confirming} aria-haspopup="dialog" onClick={() => setConfirming((open) => !open)}>
            <Trash2 size={14} aria-hidden />
          </button>
        )}
        {editing && <button ref={settingsRef} className="icon-btn icon-btn-sm" aria-label={`Configure ${widget.title}`}
          aria-expanded={configOpen} aria-controls={`widget-config-${widget.id}`} onClick={() => setConfigOpen((open) => !open)}><Settings2 size={15} /></button>}
      </header>
      {canRemove && confirming && (
        <div ref={confirmRef} className="widget-config widget-confirm" role="alertdialog" aria-label={`Remove ${widget.title}?`} aria-describedby={`widget-confirm-${widget.id}`}>
          <div className="widget-confirm-head">
            <strong>Remove this widget?</strong>
            <button type="button" className="icon-btn icon-btn-sm" aria-label="Close" onClick={() => setConfirming(false)}><X size={14} aria-hidden /></button>
          </div>
          <p id={`widget-confirm-${widget.id}`} className="muted small">“{widget.title}” comes off this dashboard and the widgets below move up. You can undo this right after.</p>
          <div className="widget-confirm-actions">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setConfirming(false); removeRef.current?.focus(); }}>Cancel</button>
            <button type="button" className="btn btn-danger btn-sm" aria-label="Remove widget" onClick={() => { setConfirming(false); onRemoveSaved?.(widget.id); }}>
              <Trash2 size={14} aria-hidden /> Remove
            </button>
          </div>
        </div>
      )}
      {editing && configOpen && <div ref={configRef} id={`widget-config-${widget.id}`} className="widget-config" role="group" aria-label={`Settings for ${widget.title}`}>
        <strong>Widget settings</strong>
        {def.setting && (
          <Select
            block
            showLabel
            label={def.setting.label}
            value={String(def.setting.get(widget))}
            onChange={(value) => onChange(def.setting!.set(widget, value))}
            options={def.setting.options.map((option) => ({ value: String(option.value), label: option.label }))}
          />
        )}
        <div className="widget-dimensions">
          <label>Width<input type="number" min={2} max={12} value={size.w} onChange={(event) => {
            const value = event.target.valueAsNumber;
            if (Number.isFinite(value)) onResize(widget.id, { w: Math.max(2, Math.min(12, value)), h: size.h });
          }} /></label>
          <label>Height<input type="number" min={3} max={30} value={size.h} onChange={(event) => {
            const value = event.target.valueAsNumber;
            if (Number.isFinite(value)) onResize(widget.id, { w: size.w, h: Math.max(3, Math.min(30, value)) });
          }} /></label>
        </div>
        <button className="btn btn-ghost widget-remove" onClick={() => onRemove(widget.id)}><Trash2 size={14} /> Remove widget</button>
      </div>}
      <div className="widget-body" id={bodyId} hidden={collapsed && !editing}>
        <WidgetErrorBoundary><WidgetBody widget={widget} /></WidgetErrorBoundary>
      </div>
    </section>
  );
}, (a, b) =>
  // Moving one card hands every card a fresh layout object; only redraw a card when something it shows changed.
  a.size.w === b.size.w && a.size.h === b.size.h &&
  a.widget === b.widget && a.editing === b.editing && a.collapsed === b.collapsed &&
  a.onToggleCollapse === b.onToggleCollapse && a.onRemove === b.onRemove && a.onChange === b.onChange &&
  a.onResize === b.onResize && a.onMove === b.onMove && a.onRemoveSaved === b.onRemoveSaved);
