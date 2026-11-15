import { useEffect, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { api, type Board, type DashboardPageInfo } from "../lib/api";
import { useDashboard } from "../lib/queries";
import { Callout } from "../components/ui";
import { BoardEditor } from "../dashboard/BoardEditor";
import { DashboardDataProvider } from "../dashboard/DataContext";
import { SalesDataProvider } from "../widgets/SalesWidgets";
import { PageSkeleton } from "../components/Skeletons";
import { ExportButton } from "../dashboard/ExportButton";

// The main Dashboard (decision #60): pages as tabs, each a board that takes any widget, email or sales, arranged by
// the user or by the assistant ("make a page with what I owe and this month's revenue"). The Email dashboard (#/email)
// and Sales (#/sales) are separate boards with their own widgets.

const pageFromHash = (): Board => (/^#\/dashboard\/(page-[a-z0-9]{6})\b/.exec(window.location.hash)?.[1] as Board) ?? "main";
const hashFor = (board: Board) => (board === "main" ? "#/dashboard" : `#/dashboard/${board}`);

/** A one-field form for naming a page (new page or rename). */
function NameForm({ initial, submitLabel, busy, error, onSubmit, onCancel }: { initial: string; submitLabel: string; busy: boolean; error: unknown; onSubmit: (name: string) => void; onCancel: () => void }) {
  const [name, setName] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  return (
    <form className="page-name-form" onSubmit={(e) => { e.preventDefault(); if (name.trim()) onSubmit(name.trim()); }}>
      <input ref={ref} className="input" aria-label="Page name" placeholder="e.g. Money, Suppliers, Weekly review" maxLength={40} value={name}
        onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") onCancel(); }} />
      <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !name.trim()}>
        {busy ? <Loader2 size={14} className="spin" aria-hidden /> : <Check size={14} aria-hidden />} {submitLabel}
      </button>
      <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel} disabled={busy}>Cancel</button>
      {Boolean(error) && <span className="agent-error" role="alert"><AlertTriangle size={13} aria-hidden /> {(error as Error).message}</span>}
    </form>
  );
}

export default function MainDashboardPage() {
  const qc = useQueryClient();
  const [board, setBoard] = useState<Board>(pageFromHash);
  const [naming, setNaming] = useState<null | "new" | "rename">(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => {
    const onHash = () => setBoard(pageFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const go = (b: Board) => {
    setNaming(null);
    setConfirmDelete(false);
    setBoard(b);
    if (window.location.hash !== hashFor(b)) window.location.hash = hashFor(b);
  };

  const pagesQ = useQuery({ queryKey: ["dashboard-pages"], queryFn: api.pages });
  const pages: DashboardPageInfo[] = pagesQ.data?.pages ?? [];
  const current = pages.find((p) => p.id === board);
  // A page that was deleted (here or by the assistant) falls back to the first page.
  useEffect(() => { if (pagesQ.data && !current) go("main"); }, [pagesQ.data, current]); // eslint-disable-line react-hooks/exhaustive-deps

  const refreshPages = () => qc.invalidateQueries({ queryKey: ["dashboard-pages"] });
  const create = useMutation({ mutationFn: (name: string) => api.createPage(name), onSuccess: async (p) => { await refreshPages(); go(p.id); } });
  const rename = useMutation({ mutationFn: (name: string) => api.renamePage(board, name), onSuccess: async () => { setNaming(null); await refreshPages(); void qc.invalidateQueries({ queryKey: ["dashboard-spec", board] }); } });
  const remove = useMutation({ mutationFn: () => api.deletePage(board), onSuccess: async () => { setConfirmDelete(false); await refreshPages(); go("main"); } });

  // Both kinds of data, for whichever widgets the page holds. Missing data shows inside the widgets that need it.
  const email = useDashboard();
  const salesStatus = useQuery({ queryKey: ["sales-status"], queryFn: api.salesStatus });
  const salesReady = Boolean(salesStatus.data?.connected && salesStatus.data.counts?.orders);
  const sales = useQuery({ queryKey: ["sales", 12], queryFn: () => api.salesDashboard(12), enabled: salesReady });
  const emailData = email.data && email.data.connected ? email.data : null;
  const salesData = sales.data ? { d: sales.data, vsLabel: "vs the same months last year" } : null;

  // Wait for both kinds of data, so a widget never shows "no data yet" for data that's still on its way.
  if (pagesQ.isLoading || email.isLoading || salesStatus.isLoading || (salesReady && sales.isLoading)) return <PageSkeleton kind="dashboard" />;
  if (pagesQ.error) return <div className="page"><Callout tone="danger" icon={<AlertTriangle size={18} />} title="Can't load your dashboard pages" text={(pagesQ.error as Error).message} /></div>;

  const wrap = (grid: ReactNode) => (
    <DashboardDataProvider value={emailData}>
      <SalesDataProvider value={salesData}>{grid}</SalesDataProvider>
    </DashboardDataProvider>
  );

  return (
    <div className="page page-wide main-dashboard">
      <nav className="page-tabs-bar" aria-label="Dashboard pages and page actions" data-export-hide="">
        <div className="page-tabs" role="tablist" aria-label="Dashboard pages">
          {pages.map((p) => (
            <button key={p.id} type="button" role="tab" className="page-tab" aria-selected={p.id === board} onClick={() => go(p.id)}>{p.name}</button>
          ))}
          {naming !== "new" && (
            <button type="button" className="btn btn-ghost btn-sm page-tab-new" onClick={() => { create.reset(); setNaming("new"); }}><Plus size={14} aria-hidden /> New page</button>
          )}
        </div>
        <div className="page-tab-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => { rename.reset(); setNaming("rename"); }}><Pencil size={14} aria-hidden /> Rename page</button>
          {board !== "main" && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmDelete(true)}><Trash2 size={14} aria-hidden /> Delete page</button>
          )}
        </div>
      </nav>
      {naming === "new" && <NameForm initial="" submitLabel="Create page" busy={create.isPending} error={create.error} onSubmit={(n) => create.mutate(n)} onCancel={() => setNaming(null)} />}
      {naming === "rename" && <NameForm initial={current?.name ?? ""} submitLabel="Save name" busy={rename.isPending} error={rename.error} onSubmit={(n) => rename.mutate(n)} onCancel={() => setNaming(null)} />}
      {confirmDelete && (
        <div className="cal-confirm surface" role="alertdialog" aria-label={`Delete the ${current?.name ?? ""} page?`}>
          <strong>Delete the “{current?.name}” page?</strong>
          <p className="muted">Its widgets go with it. Your data isn't touched, and the other pages stay as they are.</p>
          {remove.error && <p className="agent-error" role="alert"><AlertTriangle size={13} aria-hidden /> {(remove.error as Error).message}</p>}
          <div className="cal-confirm-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setConfirmDelete(false)} disabled={remove.isPending}>Cancel</button>
            <button type="button" className="btn btn-danger" onClick={() => remove.mutate()} disabled={remove.isPending}>
              {remove.isPending ? <Loader2 size={15} className="spin" aria-hidden /> : <X size={15} aria-hidden />} Delete
            </button>
          </div>
        </div>
      )}
      <BoardEditor
        // Redrawn when a data source appears later (e.g. Gmail connected), so widgets that had none retry.
        key={`${board}-${emailData ? "email" : "no-email"}-${salesData ? "sales" : "no-sales"}`}
        board={board}
        subtitle={<span>Email and sales together{emailData ? "" : " · connect Gmail for the email widgets"}{salesData ? "" : " · load sales data for the sales widgets"}</span>}
        actions={<ExportButton title={current?.name ?? "Dashboard"} />}
        wrap={wrap}
      />
    </div>
  );
}
