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
  MonitorSmartphone,
  RefreshCw,
  Reply,
  RotateCcw,
  Undo2,
} from "lucide-react";
import { CATALOG } from "../../shared/spec.js";
import { timeAgo, type GridItem, type Widget, type WidgetType } from "../lib/api";
import { useDashboard, useDashboardSpec, useResetSpec, useSaveSpec, useSync, useUndoSpec } from "../lib/queries";
import { useUi } from "../lib/store";
import { Callout } from "../components/ui";
import { DashboardDataProvider } from "../dashboard/DataContext";
import { DashboardGrid } from "../dashboard/DashboardGrid";
import { WidgetFrame } from "../dashboard/WidgetFrame";
import { WidgetLibrary } from "../dashboard/WidgetLibrary";
import { bottomOf, nextId, type Breakpoint } from "../dashboard/layout";
import { waitingLabel } from "../widgets/ThreadListWidget";

type Draft = { widgets: Widget[]; layout: GridItem[] };

const panelKey = (id: string) => `w:${id}`;

export function DashboardPage() {
  const data = useDashboard();
  const specQuery = useDashboardSpec();
  const sync = useSync();
  const save = useSaveSpec();
  const undo = useUndoSpec();
  const reset = useResetSpec();

  const closedPanels = useUi((s) => s.closedPanels);
  const togglePanel = useUi((s) => s.togglePanel);
  const openPanel = useUi((s) => s.openPanel);

  const [draft, setDraft] = useState<Draft | null>(null);
  const [dragType, setDragType] = useState<WidgetType | null>(null);
  const [breakpoint, setBreakpoint] = useState<Breakpoint>("lg");
  const [notice, setNotice] = useState<"saved" | "reset" | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  const spec = specQuery.data;
  const editing = draft !== null;
  const widgets = draft?.widgets ?? spec?.widgets ?? [];
  const layout = draft?.layout ?? spec?.layout ?? [];
  const dirty = editing && spec ? JSON.stringify(draft) !== JSON.stringify({ widgets: spec.widgets, layout: spec.layout }) : false;

  // Warn before leaving the page with unsaved layout changes.
  useEffect(() => {
    if (!dirty) return;
    const onLeave = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [dirty]);

  const collapsed = useMemo(() => {
    const out: Record<string, boolean> = {};
    for (const w of widgets) if (closedPanels[panelKey(w.id)]) out[w.id] = true;
    return out;
  }, [widgets, closedPanels]);

  // ---- edit actions (stable callbacks so memoized widgets don't re-render) ----
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
    sidebarBefore.current = useUi.getState().sidebarCollapsed;
    useUi.getState().setSidebarCollapsed(true);
    setDraft({ widgets: spec.widgets, layout: spec.layout });
  };
  const stopEditing = () => {
    setDraft(null);
    setConfirmReset(false);
    setDragType(null);
    restoreSidebar();
  };

  const onLayoutCommit = useCallback((next: GridItem[]) => {
    setDraft((d) => (d && JSON.stringify(d.layout) !== JSON.stringify(next) ? { ...d, layout: next } : d));
  }, []);

  const addWidget = useCallback((type: WidgetType, at?: { x: number; y: number }) => {
    setDraft((d) => {
      if (!d) return d;
      const id = nextId(type, new Set(d.widgets.map((w) => w.id)));
      const { w, h } = CATALOG[type].size;
      const widget = { id, ...CATALOG[type].create() } as Widget;
      const item: GridItem = { i: id, x: at?.x ?? 0, y: at?.y ?? bottomOf(d.layout), w, h };
      return { widgets: [...d.widgets, widget], layout: [...d.layout, item] };
    });
    setDragType(null);
  }, []);

  const removeWidget = useCallback((id: string) => {
    setDraft((d) => (d ? { widgets: d.widgets.filter((w) => w.id !== id), layout: d.layout.filter((l) => l.i !== id) } : d));
  }, []);

  const changeWidget = useCallback((next: Widget) => {
    setDraft((d) => (d ? { ...d, widgets: d.widgets.map((w) => (w.id === next.id ? next : w)) } : d));
  }, []);

  const toggleCollapse = useCallback((id: string) => togglePanel(panelKey(id)), [togglePanel]);

  const saveDraft = () => {
    if (!draft || !spec) return;
    save.mutate(
      { title: spec.title, ...draft, version: spec.version },
      { onSuccess: () => { stopEditing(); setNotice("saved"); } }
    );
  };

  const resetLayout = () => {
    reset.mutate(undefined, { onSuccess: () => { stopEditing(); setNotice("reset"); } });
  };

  const awaitingListId = widgets.find((w) => w.type === "thread-list" && w.list === "awaitingYou")?.id;
  const reviewReplies = () => {
    if (!awaitingListId) return;
    openPanel(panelKey(awaitingListId));
    requestAnimationFrame(() =>
      document.getElementById(`widget-${awaitingListId}`)?.scrollIntoView({ behavior: "smooth", block: "start" })
    );
  };

  // Children are memoized: react-grid-layout re-renders on every drag frame.
  const children = useMemo(
    () =>
      widgets.map((w) => (
        <div key={w.id} id={`widget-${w.id}`}>
          <WidgetFrame
            widget={w}
            editing={editing}
            collapsed={!!collapsed[w.id]}
            onToggleCollapse={toggleCollapse}
            onRemove={removeWidget}
            onChange={changeWidget}
          />
        </div>
      )),
    [widgets, editing, collapsed, toggleCollapse, removeWidget, changeWidget]
  );

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
  const canEditHere = breakpoint === "lg";
  const mutationError = save.error || undo.error || reset.error || sync.error;

  return (
    <div className="page page-wide">
      <header className="page-head">
        <div>
          <h1 className="page-title">{editing ? "Edit dashboard" : (spec?.title ?? "Dashboard")}</h1>
          <p className="page-sub">
            {editing ? (
              <span>Drag a card by its handle, resize it from the corner, add widgets from the panel on the right.</span>
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
            dirty && <span className="tag" data-tone="accent">Unsaved changes</span>
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
                disabled={!canEditHere || !spec}
                title={canEditHere ? "Rearrange, resize, add or remove widgets" : "Use a wider screen to edit the layout"}
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
          onAdd={addWidget}
          onDragType={setDragType}
          notice={
            !canEditHere && (
              <Callout tone="warn" icon={<MonitorSmartphone size={18} />} title="Make the window wider to edit" text="Layouts are edited at desktop width and adapt on smaller screens." />
            )
          }
          footer={
            confirmReset ? (
              <>
                <p className="side-panel-confirm">Replace your layout with the default? You can undo this.</p>
                <div className="side-panel-actions">
                  <button className="btn btn-ghost" onClick={() => setConfirmReset(false)}>Keep mine</button>
                  <button className="btn btn-danger" onClick={resetLayout} disabled={reset.isPending}>Reset layout</button>
                </div>
              </>
            ) : (
              <div className="side-panel-actions">
                <button className="btn btn-ghost" onClick={() => setConfirmReset(true)}><RotateCcw size={15} /> Reset</button>
                <span className="spacer" />
                <button className="btn btn-secondary" onClick={stopEditing}>Cancel</button>
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
          {!editing && <div className="empty-actions"><button className="btn btn-primary" onClick={startEditing} disabled={!canEditHere}>Edit layout</button></div>}
        </div>
      ) : (
        <DashboardDataProvider value={d}>
          <DashboardGrid
            widgets={widgets}
            layout={layout}
            collapsed={collapsed}
            editing={editing}
            dragType={dragType}
            onLayoutCommit={onLayoutCommit}
            onDropWidget={addWidget}
            onBreakpointChange={setBreakpoint}
          >
            {children}
          </DashboardGrid>
        </DashboardDataProvider>
      )}
    </div>
  );
}

export default DashboardPage;
