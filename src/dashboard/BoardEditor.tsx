import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, Check, LayoutGrid, Loader2, RotateCcw, Undo2 } from "lucide-react";
import { BOARDS } from "../../shared/spec.js";
import type { Board, GridItem, Widget, WidgetType } from "../lib/api";
import { useDashboardSpec, useSaveSpec, useUndoSpec } from "../lib/queries";
import { useUi } from "../lib/store";
import { Callout } from "../components/ui";
import { DashboardGrid } from "./DashboardGrid";
import { WidgetFrame } from "./WidgetFrame";
import { WidgetLibrary, type Catalog } from "./WidgetLibrary";
import { cleanLayout, findSpace, nextId, normalizeLayout, settleLayout, type Size } from "./layout";

// A customisable dashboard ("board"): the saved layout, edit mode with the widget panel, save, undo and reset.
// The email dashboard and the Sales page both use it; each page supplies its own data, header and banners.

/** A draft stores real grid coordinates, including intentional empty space. */
type Draft = { widgets: Widget[]; layout: GridItem[] };
const panelKey = (board: Board, id: string) => (board === "default" ? `w:${id}` : `${board}:${id}`);
function fromSpec(widgets: Widget[], layout: GridItem[]): Draft {
  return { widgets: widgets.map((widget) => ({ ...widget })), layout: normalizeLayout(widgets, layout) };
}

export type BoardTools = {
  widgets: Widget[];
  /** Unfolds a widget and scrolls to it. */
  openWidget: (id: string) => void;
};

type Props = {
  board: Board;
  /** Shown under the title when not editing. */
  subtitle: ReactNode;
  /** Extra buttons before "Edit layout" (e.g. Sync now, a period picker). */
  actions?: ReactNode;
  /** A tag shown while editing (e.g. "Sample data"). */
  editTag?: ReactNode;
  /** Messages above the grid when not editing. */
  banners?: (tools: BoardTools) => ReactNode;
  /** Wraps the grid in the page's data provider. */
  wrap: (grid: ReactNode) => ReactNode;
  /** An error from the page's own actions (e.g. a failed sync), shown with the editor's errors. */
  pageError?: unknown;
};

export function BoardEditor({ board, subtitle, actions, editTag, banners, wrap, pageError }: Props) {
  const { catalog, spec: defaultSpec } = BOARDS[board] as { catalog: Catalog & Record<string, { create: () => object; size: Size }>; spec: { widgets: unknown[]; layout: GridItem[] } };
  const specQuery = useDashboardSpec(board);
  const save = useSaveSpec(board);
  const undo = useUndoSpec(board);

  const closedPanels = useUi((s) => s.closedPanels);
  const togglePanel = useUi((s) => s.togglePanel);
  const openPanel = useUi((s) => s.openPanel);

  const [draft, setDraft] = useState<Draft | null>(null);
  const [editSession, setEditSession] = useState(0);
  const sessionRef = useRef(0);
  const baselineRef = useRef<{ draft: Draft; version: number; title: string } | null>(null);
  const [notice, setNotice] = useState<"saved" | "reset" | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [addingType, setAddingType] = useState<WidgetType | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const spec = specQuery.data;
  const editing = draft !== null;

  // The saved layout can contain widget types this version of the app doesn't have (e.g. a teammate saved one
  // from a newer branch into the shared database). Hide them instead of crashing, and block editing so a save
  // from here can't silently delete them.
  const { savedWidgets, savedLayout, unknownTypes } = useMemo(() => {
    const all = spec?.widgets ?? [];
    const known = all.filter((w) => (w.type as string) in catalog);
    const ids = new Set(known.map((w) => w.id));
    return {
      savedWidgets: known,
      savedLayout: (spec?.layout ?? []).filter((l) => ids.has(l.i)),
      unknownTypes: [...new Set(all.filter((w) => !((w.type as string) in catalog)).map((w) => w.type as string))],
    };
  }, [spec, catalog]);

  const view = useMemo(() => draft ?? (spec ? fromSpec(savedWidgets, savedLayout) : null), [draft, spec, savedWidgets, savedLayout]);
  const positionsById = useMemo(() => Object.fromEntries((view?.layout ?? []).map((item) => [item.i, item])), [view?.layout]);
  const dirty = useMemo(() => {
    if (!draft || !spec) return false;
    const before = baselineRef.current?.draft ?? fromSpec(savedWidgets, savedLayout);
    return JSON.stringify([draft.widgets, cleanLayout(draft.layout)]) !== JSON.stringify([before.widgets, cleanLayout(before.layout)]);
  }, [draft, spec, savedWidgets, savedLayout]);

  // Warn before leaving the page with unsaved layout changes.
  useEffect(() => {
    if (!dirty) return;
    const onLeave = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [dirty]);

  const collapsed = useMemo(() => {
    const out: Record<string, boolean> = {};
    for (const w of view?.widgets ?? []) if (closedPanels[panelKey(board, w.id)]) out[w.id] = true;
    return out;
  }, [view, closedPanels, board]);

  // ---- edit mode ----
  // The sidebar folds while editing to give the grid room next to the widget panel,
  // and goes back to how the user had it afterwards.
  const sidebarBefore = useRef<boolean | null>(null);
  const restoreSidebar = () => {
    if (sidebarBefore.current !== null) useUi.getState().setSidebarCollapsed(sidebarBefore.current);
    sidebarBefore.current = null;
  };
  useEffect(() => restoreSidebar, []); // leaving the page mid-edit

  const startEditing = () => {
    if (!spec) return;
    setNotice(null);
    save.reset();
    baselineRef.current = { draft: fromSpec(savedWidgets, savedLayout), version: spec.version, title: spec.title };
    setEditSession(++sessionRef.current);
    sidebarBefore.current = useUi.getState().sidebarCollapsed;
    useUi.getState().setSidebarCollapsed(true);
    setDraft(fromSpec(savedWidgets, savedLayout));
  };
  const stopEditing = () => {
    ++sessionRef.current; // Ignore callbacks from a discarded grid gesture.
    baselineRef.current = null;
    setDraft(null);
    setConfirmReset(false);
    setAddingType(null);
    restoreSidebar();
  };

  const addWidget = useCallback((type: WidgetType, position?: GridItem, base?: GridItem[]) => {
    setDraft((draft) => {
      if (!draft || draft.widgets.length >= 24 || !(type in catalog)) return draft;
      const id = nextId(type, new Set(draft.widgets.map((widget) => widget.id)));
      const widget = { id, ...catalog[type].create() } as Widget;
      const layout = base ?? draft.layout;
      const item = position ? { ...position, i: id } : findSpace(layout, id, catalog[type].size);
      return { widgets: [...draft.widgets, widget], layout: settleLayout([...layout, item], 12, id) };
    });
    setAddingType(null);
    setAnnouncement("Widget added to the dashboard.");
  }, [catalog]);
  const addAtEnd = useCallback((type: WidgetType) => addWidget(type), [addWidget]);
  const removeWidget = useCallback((id: string) => {
    setDraft((draft) => draft ? { widgets: draft.widgets.filter((widget) => widget.id !== id), layout: draft.layout.filter((item) => item.i !== id) } : draft);
  }, []);
  const changeWidget = useCallback((next: Widget) => {
    setDraft((draft) => draft ? { ...draft, widgets: draft.widgets.map((widget) => widget.id === next.id ? next : widget) } : draft);
  }, []);
  const resizeWidget = useCallback((id: string, size: Size) => {
    setDraft((draft) => draft ? { ...draft, layout: settleLayout(draft.layout.map((item) => item.i === id ? { ...item, ...size } : item), 12, id) } : draft);
  }, []);
  const moveWidget = useCallback((id: string, dx: number, dy: number, resize: boolean) => {
    setDraft((draft) => draft ? { ...draft, layout: settleLayout(draft.layout.map((item) => {
      if (item.i !== id) return item;
      return resize ? { ...item, w: Math.max(2, Math.min(12, item.w + dx)), h: Math.max(3, Math.min(30, item.h + dy)) }
        : { ...item, x: item.x + dx, y: item.y + dy };
    }), 12, id) } : draft);
    setAnnouncement(resize ? "Widget resized." : "Widget moved.");
  }, []);
  const changeLayout = useCallback((layout: GridItem[]) => {
    if (sessionRef.current !== editSession) return;
    setDraft((draft) => draft ? { ...draft, layout } : draft);
    setAnnouncement("Widget placement updated. Save to keep your changes.");
  }, [editSession]);
  const dropWidget = useCallback((type: WidgetType, item: GridItem, layout: GridItem[]) => {
    if (sessionRef.current === editSession) addWidget(type, item, layout);
  }, [editSession, addWidget]);
  const toggleCollapse = useCallback((id: string) => togglePanel(panelKey(board, id)), [togglePanel, board]);

  const renderCard = useCallback(
    (widget: Widget) => (
      <WidgetFrame
        widget={widget}
        editing={editing}
        collapsed={!!collapsed[widget.id]}
        size={positionsById[widget.id] ?? { w: 6, h: 9 }}
        onToggleCollapse={toggleCollapse}
        onRemove={removeWidget}
        onChange={changeWidget}
        onResize={resizeWidget}
        onMove={moveWidget}
      />
    ),
    [editing, collapsed, positionsById, toggleCollapse, removeWidget, changeWidget, resizeWidget, moveWidget]
  );

  const saveDraft = () => {
    const baseline = baselineRef.current;
    if (!draft || !baseline || save.isPending) return;
    save.mutate(
      { title: baseline.title, widgets: draft.widgets.map((widget) => ({ ...widget })), layout: cleanLayout(draft.layout), version: baseline.version },
      { onSuccess: () => { stopEditing(); setNotice("saved"); } }
    );
  };

  const resetLayout = () => {
    if (!draft || save.isPending) return;
    setDraft(fromSpec(defaultSpec.widgets as Widget[], defaultSpec.layout));
    setEditSession(++sessionRef.current);
    setConfirmReset(false);
    setAddingType(null);
    setAnnouncement("Preview reset to the default. Save layout to keep it, or Cancel to discard it.");
  };

  const widgets = view?.widgets ?? [];
  const openWidget = useCallback((id: string) => {
    openPanel(panelKey(board, id));
    requestAnimationFrame(() => document.getElementById(`widget-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }, [openPanel, board]);

  if (specQuery.isLoading) return <div className="skeleton" style={{ height: 420 }} />;
  if (specQuery.error) return <Callout tone="danger" icon={<AlertTriangle size={18} />} title="Can't load the dashboard layout" text={(specQuery.error as Error).message} />;

  const canEditHere = unknownTypes.length === 0;
  const mutationError = save.error || undo.error || pageError;

  return (
    <div className="board" data-layout-editing={editing}>
      <header className="page-head">
        <div>
          <h1 className="page-title">{editing ? "Edit dashboard" : (spec?.title ?? "Dashboard")}</h1>
          <p className="page-sub">
            {editing ? <span>Drag cards anywhere on the grid. Pull the bottom-right corner to resize.</span> : subtitle}
          </p>
        </div>
        <div className="head-actions">
          {editing ? (
            <>
              {editTag}
              {dirty && <span className="tag" data-tone="accent">Unsaved changes</span>}
              <button className="btn btn-secondary" onClick={stopEditing} disabled={save.isPending}>Cancel</button>
              <button className="btn btn-primary" onClick={saveDraft} disabled={!dirty || save.isPending}>
                {save.isPending ? <Loader2 size={15} className="spin" /> : <Check size={15} />} Save layout
              </button>
              <a className="btn btn-secondary mobile-library-link" href="#widget-library" onClick={(event) => {
                event.preventDefault(); document.getElementById("widget-library")?.scrollIntoView({ behavior: "smooth" });
              }}>Add widgets</a>
            </>
          ) : (
            <>
              {actions}
              <button
                className="btn btn-secondary"
                onClick={startEditing}
                disabled={!canEditHere || !spec}
                title={canEditHere ? "Rearrange, resize, add or remove widgets" : "This layout has widgets from a newer version of the app. Pull the latest code to edit it."}
              >
                <LayoutGrid size={15} /> Edit layout
              </button>
            </>
          )}
        </div>
      </header>

      {!editing && unknownTypes.length > 0 && (
        <Callout
          tone="warn"
          icon={<AlertTriangle size={18} />}
          title={`${unknownTypes.length === 1 ? "A widget" : "Some widgets"} in this layout can't be shown`}
          text={`The saved layout uses ${unknownTypes.join(", ")}, which this version of the app doesn't have. They're hidden here and editing is off so they aren't lost. Pull the latest code to see them.`}
        />
      )}

      {mutationError ? <Callout tone="danger" icon={<AlertTriangle size={18} />} title="That didn't work" text={(mutationError as Error).message} /> : null}

      {notice && !editing && (
        <Callout
          tone="ok"
          icon={<Check size={18} />}
          title={notice === "saved" ? "Layout saved" : "Layout reset to the default"}
          action={
            spec?.canUndo ? (
              <button className="btn btn-secondary" onClick={() => undo.mutate(undefined, { onSuccess: () => setNotice(null) })} disabled={undo.isPending}>
                <Undo2 size={15} /> Undo
              </button>
            ) : undefined
          }
        />
      )}

      {editing && (
        <WidgetLibrary
          catalog={catalog}
          onAdd={addAtEnd}
          onDragBegin={setAddingType}
          onDragFinish={() => setAddingType(null)}
          full={widgets.length >= 24}
          busy={save.isPending}
          footer={
            confirmReset ? (
              <>
                <p className="side-panel-confirm">Reset this preview to the default? Save layout to keep it, or Cancel to discard it.</p>
                <div className="side-panel-actions">
                  <button className="btn btn-ghost" onClick={() => setConfirmReset(false)}>Keep mine</button>
                  <button className="btn btn-danger" onClick={resetLayout} disabled={save.isPending}>Reset layout</button>
                </div>
              </>
            ) : (
              <div className="side-panel-actions">
                <button className="btn btn-ghost" onClick={() => setConfirmReset(true)} disabled={save.isPending}><RotateCcw size={15} /> Reset</button>
                <span className="spacer" />
                <button className="btn btn-secondary" onClick={stopEditing} disabled={save.isPending}>Discard</button>
                <button className="btn btn-primary" onClick={saveDraft} disabled={!dirty || save.isPending}>
                  {save.isPending ? <Loader2 size={15} className="spin" /> : <Check size={15} />} Save
                </button>
              </div>
            )
          }
        />
      )}

      {!editing && banners?.({ widgets, openWidget })}

      {widgets.length === 0 && !editing ? (
        <div className="surface empty">
          <div className="empty-icon"><LayoutGrid size={24} /></div>
          <h2 className="empty-title">Your dashboard is empty</h2>
          <p className="empty-text">Edit the layout to add widgets, or reset to the default.</p>
          <div className="empty-actions"><button className="btn btn-primary" onClick={startEditing}>Edit layout</button></div>
        </div>
      ) : (
        wrap(
          <DashboardGrid key={editing ? `edit-${editSession}` : `saved-${spec?.version}`}
            widgets={widgets}
            layout={view?.layout ?? []}
            collapsed={collapsed}
            editing={editing}
            busy={save.isPending}
            addingType={addingType}
            catalog={catalog}
            onChange={changeLayout}
            onDrop={dropWidget}
            renderCard={renderCard}
          />
        )
      )}
      <p className="sr-only" role="status" aria-live="polite">{announcement}</p>
    </div>
  );
}
