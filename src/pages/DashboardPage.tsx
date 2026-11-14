import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  FlaskConical,
  LayoutGrid,
  Loader2,
  Mail,
  MailCheck,
  RefreshCw,
  Reply,
  RotateCcw,
  Undo2,
} from "lucide-react";
import { CATALOG, DEFAULT_SPEC } from "../../shared/spec.js";
import { timeAgo, type GridItem, type Widget, type WidgetType } from "../lib/api";
import { useDashboard, useDashboardSpec, useSaveSpec, useSync, useUndoSpec } from "../lib/queries";
import { useUi } from "../lib/store";
import { Callout } from "../components/ui";
import { DashboardDataProvider } from "../dashboard/DataContext";
import { DashboardGrid } from "../dashboard/DashboardGrid";
import { WidgetFrame } from "../dashboard/WidgetFrame";
import { WidgetLibrary } from "../dashboard/WidgetLibrary";
import { cleanLayout, findSpace, nextId, normalizeLayout, settleLayout, type Size } from "../dashboard/layout";
import { waitingLabel } from "../widgets/ThreadListWidget";

/** A draft stores real grid coordinates, including intentional empty space. */
type Draft = { widgets: Widget[]; layout: GridItem[] };
const panelKey = (id: string) => `w:${id}`;
function fromSpec(widgets: Widget[], layout: GridItem[]): Draft {
  return { widgets: widgets.map((widget) => ({ ...widget })), layout: normalizeLayout(widgets, layout) };
}

export function DashboardPage() {
  const data = useDashboard();
  const specQuery = useDashboardSpec();
  const sync = useSync();
  const save = useSaveSpec();
  const undo = useUndoSpec();

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
  const view = useMemo(() => draft ?? (spec ? fromSpec(spec.widgets, spec.layout) : null), [draft, spec]);
  const positionsById = useMemo(() => Object.fromEntries((view?.layout ?? []).map((item) => [item.i, item])), [view?.layout]);
  const dirty = useMemo(() => {
    if (!draft || !spec) return false;
    const before = baselineRef.current?.draft ?? fromSpec(spec.widgets, spec.layout);
    return JSON.stringify([draft.widgets, cleanLayout(draft.layout)]) !== JSON.stringify([before.widgets, cleanLayout(before.layout)]);
  }, [draft, spec]);

  // Warn before leaving the page with unsaved layout changes.
  useEffect(() => {
    if (!dirty) return;
    const onLeave = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [dirty]);

  const collapsed = useMemo(() => {
    const out: Record<string, boolean> = {};
    for (const w of view?.widgets ?? []) if (closedPanels[panelKey(w.id)]) out[w.id] = true;
    return out;
  }, [view, closedPanels]);

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
    baselineRef.current = { draft: fromSpec(spec.widgets, spec.layout), version: spec.version, title: spec.title };
    setEditSession(++sessionRef.current);
    sidebarBefore.current = useUi.getState().sidebarCollapsed;
    useUi.getState().setSidebarCollapsed(true);
    setDraft(fromSpec(spec.widgets, spec.layout));
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
      if (!draft || draft.widgets.length >= 24) return draft;
      const id = nextId(type, new Set(draft.widgets.map((widget) => widget.id)));
      const widget = { id, ...CATALOG[type].create() } as Widget;
      const layout = base ?? draft.layout;
      const item = position ? { ...position, i: id } : findSpace(layout, id, CATALOG[type].size);
      return { widgets: [...draft.widgets, widget], layout: settleLayout([...layout, item], 12, id) };
    });
    setAddingType(null);
    setAnnouncement("Widget added to the dashboard.");
  }, []);
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
  const toggleCollapse = useCallback((id: string) => togglePanel(panelKey(id)), [togglePanel]);

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
    setDraft(fromSpec(DEFAULT_SPEC.widgets as Widget[], DEFAULT_SPEC.layout));
    setEditSession(++sessionRef.current);
    setConfirmReset(false);
    setAddingType(null);
    setAnnouncement("Preview reset to the default. Save layout to keep it, or Cancel to discard it.");
  };

  const widgets = view?.widgets ?? [];
  const awaitingListId = widgets.find((w) => w.type === "thread-list" && w.list === "awaitingYou")?.id;
  const reviewReplies = () => {
    if (!awaitingListId) return;
    openPanel(panelKey(awaitingListId));
    requestAnimationFrame(() =>
      document.getElementById(`widget-${awaitingListId}`)?.scrollIntoView({ behavior: "smooth", block: "start" })
    );
  };

  // ---- states before the grid ----
  if (data.isLoading || specQuery.isLoading) return <div className="page"><div className="skeleton" style={{ height: 420 }} /></div>;
  const loadError = data.error || specQuery.error;
  if (loadError)
    return (
      <div className="page">
        <Callout tone="danger" icon={<AlertTriangle size={18} />} title="Can't load the dashboard" text={(loadError as Error).message} />
      </div>
    );

  const d = data.data;
  if (!d || !d.connected)
    return (
      <div className="page">
        <header className="page-head"><div><h1 className="page-title">Dashboard</h1></div></header>
        <div className="surface empty">
          <div className="empty-icon"><Mail size={24} /></div>
          <h2 className="empty-title">Connect Gmail to see your dashboard</h2>
          <p className="empty-text">We'll show who's waiting on your reply, which conversations went quiet, and how your week is going. Read-only, nothing is sent.</p>
          <div className="empty-actions">
            <a className="btn btn-primary btn-lg" href="#/integrations">Connect Gmail <ArrowRight size={16} /></a>
          </div>
        </div>
      </div>
    );

  const t = d.totals;
  const syncing = sync.isPending || d.status === "syncing";
  const mutationError = save.error || undo.error || sync.error;

  return (
    <div className="page page-wide" data-layout-editing={editing}>
      <header className="page-head">
        <div>
          <h1 className="page-title">{editing ? "Edit dashboard" : (spec?.title ?? "Dashboard")}</h1>
          <p className="page-sub">
            {editing ? (
              <span>Drag cards anywhere on the grid. Pull the bottom-right corner to resize.</span>
            ) : (
              <>
                <span>{d.account}</span>
                <span className="sep">·</span>
                <span>Last {d.windowDays} days</span>
                <span className="sep">·</span>
                <span>{syncing ? "Syncing…" : `Synced ${timeAgo(d.lastSyncAt)}`}</span>
              </>
            )}
          </p>
        </div>
        <div className="head-actions">
          {editing ? (
            <>
              {d.mode === "sample" && <span className="tag" data-tone="warn">Sample data</span>}
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
              {d.mode === "live" && (
                <button className="btn btn-ghost" onClick={() => sync.mutate()} disabled={syncing}>
                  {syncing ? <Loader2 size={15} className="spin" /> : <RefreshCw size={15} />} Sync now
                </button>
              )}
              <button
                className="btn btn-secondary"
                onClick={startEditing}
                disabled={!spec}
                title="Rearrange, resize, add or remove widgets"
              >
                <LayoutGrid size={15} /> Edit layout
              </button>
            </>
          )}
        </div>
      </header>

      {mutationError && <Callout tone="danger" icon={<AlertTriangle size={18} />} title="That didn't work" text={(mutationError as Error).message} />}

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

      {!editing && d.mode === "sample" && (
        <Callout
          tone="warn"
          icon={<FlaskConical size={18} />}
          title="You're looking at sample data"
          text="These people and emails are fictional. Connect Gmail to see your own."
          action={<a className="btn btn-secondary" href="#/integrations">Connect Gmail</a>}
        />
      )}
      {!editing && d.status === "error" && (
        <Callout tone="danger" icon={<AlertTriangle size={18} />} title="The last sync failed" text={d.error ?? undefined} action={<a className="btn btn-secondary" href="#/integrations">Fix in Integrations</a>} />
      )}
      {!editing &&
        (t.awaitingYou > 0 ? (
          <Callout
            icon={<Reply size={18} />}
            title={`${t.awaitingYou} ${t.awaitingYou === 1 ? "conversation is" : "conversations are"} waiting on your reply`}
            text={`The longest has been waiting ${waitingLabel(d.awaitingYou[0]?.waitingDays ?? 0).toLowerCase()}.`}
            action={awaitingListId ? <button className="btn btn-primary" onClick={reviewReplies}>Review replies <ArrowRight size={16} /></button> : undefined}
          />
        ) : (
          <Callout tone="ok" icon={<MailCheck size={18} />} title="You're all caught up" text="No one is waiting on a reply from you." />
        ))}

      {widgets.length === 0 && !editing ? (
        <div className="surface empty">
          <div className="empty-icon"><LayoutGrid size={24} /></div>
          <h2 className="empty-title">Your dashboard is empty</h2>
          <p className="empty-text">{editing ? "Add a widget from the panel on the right." : "Edit the layout to add widgets, or reset to the default."}</p>
          {!editing && <div className="empty-actions"><button className="btn btn-primary" onClick={startEditing}>Edit layout</button></div>}
        </div>
      ) : (
        <DashboardDataProvider value={d}>
          <DashboardGrid key={editing ? `edit-${editSession}` : `saved-${spec?.version}`}
            widgets={widgets}
            layout={view?.layout ?? []}
            collapsed={collapsed}
            editing={editing}
            busy={save.isPending}
            addingType={addingType}
            onChange={changeLayout}
            onDrop={dropWidget}
            renderCard={renderCard}
          />
        </DashboardDataProvider>
      )}
      <p className="sr-only" role="status" aria-live="polite">{announcement}</p>
    </div>
  );
}

export default DashboardPage;
