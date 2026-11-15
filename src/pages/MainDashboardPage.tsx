import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, LayoutGrid, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { api, type Board, type DashboardPageInfo } from "../lib/api";
import { useDashboard } from "../lib/queries";
import { Callout } from "../components/ui";
import { BoardEditor } from "../dashboard/BoardEditor";
import { DashboardDataProvider } from "../dashboard/DataContext";
import { SalesDataProvider } from "../widgets/SalesWidgets";
import { PageSkeleton } from "../components/Skeletons";
import { ExportButton } from "../dashboard/ExportButton";
import { Modal } from "../components/Modal";
import { confirm } from "../components/ConfirmDialog";
import { toast } from "../components/Toaster";
import { errorMessage } from "../lib/errors";

// The main Dashboard (decision #60): pages as tabs, each a board that takes any widget, email or sales, arranged by
// the user or by the assistant ("make a page with what I owe and this month's revenue"). The Email dashboard (#/email)
// and Sales (#/sales) are separate boards with their own widgets.

const pageFromHash = (): Board => (/^#\/dashboard\/(page-[a-z0-9]{6})\b/.exec(window.location.hash)?.[1] as Board) ?? "main";
const hashFor = (board: Board) => (board === "main" ? "#/dashboard" : `#/dashboard/${board}`);

/** Naming a page (new page or rename): a small dialog, so creating a page is a deliberate, confirmed step. */
function NameDialog({ open, title, description, initial, submitLabel, busy, error, onSubmit, onClose }: {
  open: boolean; title: string; description: string; initial: string; submitLabel: string; busy: boolean; error: unknown;
  onSubmit: (name: string) => void; onClose: () => void;
}) {
  const [name, setName] = useState(initial);
  useEffect(() => { if (open) setName(initial); }, [open, initial]);
  const formId = "page-name-form";
  return (
    <Modal open={open} onClose={onClose} size="sm" title={title} description={description} icon={<LayoutGrid size={18} />} dismissible={!busy}
      footer={<>
        <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="submit" form={formId} className="btn btn-primary" disabled={busy || !name.trim()}>
          {busy ? <Loader2 size={15} className="spin" aria-hidden /> : <Check size={15} aria-hidden />} {submitLabel}
        </button>
      </>}>
      <form id={formId} onSubmit={(e) => { e.preventDefault(); if (name.trim()) onSubmit(name.trim()); }}>
        <label className="field">
          <span className="field-label">Page name</span>
          <input className="input" autoFocus placeholder="e.g. Money, Suppliers, Weekly review" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
      </form>
      {error ? <p className="ui-modal-error" role="alert"><AlertTriangle size={15} aria-hidden /><span>{errorMessage(error)}</span></p> : null}
    </Modal>
  );
}

export default function MainDashboardPage() {
  const qc = useQueryClient();
  const [board, setBoard] = useState<Board>(pageFromHash);
  const [naming, setNaming] = useState<null | "new" | "rename">(null);
  useEffect(() => {
    const onHash = () => setBoard(pageFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const go = (b: Board) => {
    setNaming(null);
    setBoard(b);
    if (window.location.hash !== hashFor(b)) window.location.hash = hashFor(b);
  };

  const pagesQ = useQuery({ queryKey: ["dashboard-pages"], queryFn: api.pages });
  const pages: DashboardPageInfo[] = pagesQ.data?.pages ?? [];
  const current = pages.find((p) => p.id === board);
  // A page that was deleted (here or by the assistant) falls back to the first page.
  useEffect(() => { if (pagesQ.data && !current) go("main"); }, [pagesQ.data, current]); // eslint-disable-line react-hooks/exhaustive-deps

  const refreshPages = () => qc.invalidateQueries({ queryKey: ["dashboard-pages"] });
  const create = useMutation({
    mutationFn: (name: string) => api.createPage(name),
    onSuccess: async (p) => { await refreshPages(); go(p.id); toast.success(`Page "${p.name}" added`, "Add widgets to it with Edit layout, or ask the assistant."); },
  });
  const rename = useMutation({
    mutationFn: (name: string) => api.renamePage(board, name),
    onSuccess: async () => { setNaming(null); await refreshPages(); void qc.invalidateQueries({ queryKey: ["dashboard-spec", board] }); },
  });
  const deletePage = async () => {
    const name = current?.name ?? "this";
    const ok = await confirm({
      title: `Delete the "${name}" page?`,
      message: "Its widgets go with it. Your data isn't touched, and the other pages stay as they are.",
      confirmLabel: "Delete page",
      tone: "danger",
      action: () => api.deletePage(board),
    });
    if (!ok) return;
    await refreshPages();
    go("main");
    toast.success(`Page "${name}" deleted`);
  };

  // Both kinds of data, for whichever widgets the page holds. Missing data shows inside the widgets that need it.
  const email = useDashboard();
  const salesStatus = useQuery({ queryKey: ["sales-status"], queryFn: api.salesStatus });
  const salesReady = Boolean(salesStatus.data?.connected && salesStatus.data.counts?.orders);
  const sales = useQuery({ queryKey: ["sales", 12], queryFn: () => api.salesDashboard(12), enabled: salesReady });
  const emailData = email.data && email.data.connected ? email.data : null;
  const salesData = sales.data ? { d: sales.data, vsLabel: "vs the same months last year" } : null;

  // Wait for both kinds of data, so a widget never shows "no data yet" for data that's still on its way.
  if (pagesQ.isLoading || email.isLoading || salesStatus.isLoading || (salesReady && sales.isLoading)) return <PageSkeleton kind="dashboard" />;
  if (pagesQ.error) return <div className="page"><Callout tone="danger" icon={<AlertTriangle size={18} />} title="Can't load your dashboard pages" text={errorMessage(pagesQ.error)} /></div>;

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
          <button type="button" className="btn btn-ghost btn-sm page-tab-new" onClick={() => { create.reset(); setNaming("new"); }} aria-haspopup="dialog"><Plus size={14} aria-hidden /> New page</button>
        </div>
        <div className="page-tab-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => { rename.reset(); setNaming("rename"); }} aria-haspopup="dialog"><Pencil size={14} aria-hidden /> Rename page</button>
          {board !== "main" && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void deletePage()} aria-haspopup="dialog"><Trash2 size={14} aria-hidden /> Delete page</button>
          )}
        </div>
      </nav>
      <NameDialog open={naming === "new"} title="Add a page" description="A new, empty dashboard page. You choose what goes on it."
        initial="" submitLabel="Add page" busy={create.isPending} error={create.error} onSubmit={(n) => create.mutate(n)} onClose={() => setNaming(null)} />
      <NameDialog open={naming === "rename"} title="Rename this page" description="Only the name changes; the widgets stay as they are."
        initial={current?.name ?? ""} submitLabel="Save name" busy={rename.isPending} error={rename.error} onSubmit={(n) => rename.mutate(n)} onClose={() => setNaming(null)} />
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
