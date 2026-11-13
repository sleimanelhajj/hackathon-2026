import { memo } from "react";
import { ChevronDown, GripVertical, X } from "lucide-react";
import type { Widget } from "../lib/api";
import { REGISTRY, WidgetBody } from "../widgets/registry";
import { WidgetErrorBoundary } from "./ErrorBoundary";

type Props = {
  widget: Widget;
  editing: boolean;
  collapsed: boolean;
  onToggleCollapse: (id: string) => void;
  onRemove: (id: string) => void;
  onChange: (widget: Widget) => void;
};

/** The card around every widget: title, drag handle and settings in edit mode, fold toggle in view mode. */
export const WidgetFrame = memo(function WidgetFrame({ widget, editing, collapsed, onToggleCollapse, onRemove, onChange }: Props) {
  const def = REGISTRY[widget.type];
  const canCollapse = def.collapsible && !editing;
  const bodyId = `widget-body-${widget.id}`;
  const isStat = widget.type === "stat";

  return (
    <section className="widget" data-editing={editing} data-collapsed={collapsed && !editing} data-kind={widget.type} aria-label={widget.title}>
      <header className="widget-head">
        {editing && (
          <span className="widget-handle" title="Drag to move" aria-hidden>
            <GripVertical size={16} />
          </span>
        )}
        {canCollapse ? (
          <button className="widget-title-btn" aria-expanded={!collapsed} aria-controls={bodyId} onClick={() => onToggleCollapse(widget.id)}>
            <ChevronDown size={16} className="widget-chevron" aria-hidden />
            <h2 className="widget-title">{widget.title}</h2>
          </button>
        ) : (
          <h2 className={isStat ? "widget-title widget-title-stat" : "widget-title"}>{widget.title}</h2>
        )}
        {editing && def.setting && (
          <label className="widget-setting">
            <span className="sr-only">{def.setting.label}</span>
            <select
              value={String(def.setting.get(widget))}
              onChange={(e) => onChange(def.setting!.set(widget, e.target.value))}
              onMouseDown={(e) => e.stopPropagation()}
            >
              {def.setting.options.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </label>
        )}
        {editing && (
          <button className="icon-btn icon-btn-sm" onClick={() => onRemove(widget.id)} aria-label={`Remove ${widget.title}`} title="Remove widget">
            <X size={15} />
          </button>
        )}
      </header>
      <div className="widget-body" id={bodyId} hidden={collapsed && !editing}>
        <WidgetErrorBoundary>
          <WidgetBody widget={widget} />
        </WidgetErrorBoundary>
      </div>
    </section>
  );
});
