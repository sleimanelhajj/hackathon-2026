import { memo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PackageMinus, PackagePlus, Undo2 } from "lucide-react";
import { api, type StockChange, type Widget } from "../lib/api";
import { confirm } from "../components/ConfirmDialog";
import { toast } from "../components/Toaster";
import { errorMessage } from "../lib/errors";

const money = (n: number | null, currency: string | null) => {
  if (n === null) return null;
  try { return new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "USD" }).format(n); } catch { return `${n}`; }
};
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const signed = (n: number) => (n > 0 ? `+${n}` : `−${Math.abs(n)}`);

function Row({ c }: { c: StockChange }) {
  const qc = useQueryClient();
  // Undo changes stock and Sales, so it asks first; the dialog shows progress and any error.
  const askUndo = async () => {
    const what = c.kind === "sale" ? "sale" : "purchase";
    const ok = await confirm({
      title: `Undo this ${what}?`,
      message: `The stock goes back to what it was and the ${what} ${c.number ?? ""} from ${c.counterparty ?? "this invoice"} is removed from Sales.`.replace(/\s+/g, " "),
      confirmLabel: "Undo stock change",
      tone: "danger",
      icon: <Undo2 size={18} />,
      action: () => api.undoStockChange(c.key),
    });
    if (!ok) return;
    toast.success("Stock change undone");
    for (const key of [["stock-changes"], ["sales"], ["payments"]]) void qc.invalidateQueries({ queryKey: key });
  };
  const who = c.counterparty ?? "Unknown";
  const Icon = c.kind === "sale" ? PackageMinus : PackagePlus;
  return (
    <li className="stock-row" aria-label={`${who} ${c.number ?? ""}`.trim()} data-undone={Boolean(c.undoneAt) || undefined}>
      <span className="pay-icon" data-dir={c.kind === "sale" ? "to-collect" : "to-pay"} aria-hidden><Icon size={15} /></span>
      <div className="stock-text">
        <span>
          <strong>{c.kind === "sale" ? "Sold to" : "Bought from"} {who}</strong>
          <span className="muted small"> · {c.number ?? "no number"}{money(c.total, c.currency) ? ` · ${money(c.total, c.currency)}` : ""} · {c.source === "app" ? "sent from the app" : "read from email"} · {when(c.appliedAt)}</span>
        </span>
        <span className="small">{c.lines.length ? c.lines.map((l) => `${l.name} ${signed(l.change)}`).join(", ") : "No stock moved"}</span>
        {c.unmatched.length > 0 && (
          <span className="small stock-unmatched">{c.unmatched.length} line{c.unmatched.length === 1 ? "" : "s"} not matched: {c.unmatched.map((u) => u.description).join(", ")}</span>
        )}
      </div>
      {c.undoneAt ? <span className="tag tag-sm">Undone</span> : (
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void askUndo()} aria-haspopup="dialog"><Undo2 size={13} aria-hidden /> Undo</button>
      )}
    </li>
  );
}

/** Every invoice that moved stock, newest first, with Undo (decision #58). */
export const StockChangesWidget = memo(function StockChangesWidget(_: { widget: Extract<Widget, { type: "stock-changes" }> }) {
  const { data, isLoading, error } = useQuery({ queryKey: ["stock-changes"], queryFn: api.stockChanges, refetchInterval: 60_000 });
  if (isLoading) return <div className="skeleton widget-skeleton" />;
  if (error) return <p className="widget-empty" role="alert">Couldn't load stock changes. {errorMessage(error)}</p>;
  if (!data?.configured) return <p className="widget-empty">Stock needs the sales database. Set POSTGRES_URL on the server.</p>;
  return data.changes.length ? (
    <ul className="stock-list">{data.changes.map((c) => <Row key={c.key} c={c} />)}</ul>
  ) : (
    <p className="widget-empty">No invoice has moved stock yet. Invoices you send lower stock; supplier invoices you receive raise it.</p>
  );
});
