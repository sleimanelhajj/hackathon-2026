import { memo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2, PackageMinus, PackagePlus, Undo2 } from "lucide-react";
import { api, type StockChange, type Widget } from "../lib/api";

const money = (n: number | null, currency: string | null) => {
  if (n === null) return null;
  try { return new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "USD" }).format(n); } catch { return `${n}`; }
};
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const signed = (n: number) => (n > 0 ? `+${n}` : `−${Math.abs(n)}`);

function Row({ c }: { c: StockChange }) {
  const qc = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const undo = useMutation({
    mutationFn: () => api.undoStockChange(c.key),
    onSuccess: () => {
      setConfirming(false);
      for (const key of [["stock-changes"], ["sales"], ["payments"]]) void qc.invalidateQueries({ queryKey: key });
    },
  });
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
        {confirming && (
          <span className="stock-confirm">
            <span className="small">Put the stock back and remove this {c.kind === "sale" ? "sale" : "purchase"} from Sales?</span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirming(false)} disabled={undo.isPending}>Cancel</button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => undo.mutate()} disabled={undo.isPending} aria-label="Undo stock change">
              {undo.isPending ? <Loader2 size={13} className="spin" aria-hidden /> : <Undo2 size={13} aria-hidden />} Undo it
            </button>
          </span>
        )}
        {undo.error && <span className="agent-error" role="alert"><AlertTriangle size={13} aria-hidden /> {(undo.error as Error).message}</span>}
      </div>
      {c.undoneAt ? <span className="tag tag-sm">Undone</span> : !confirming && (
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirming(true)}><Undo2 size={13} aria-hidden /> Undo</button>
      )}
    </li>
  );
}

/** Every invoice that moved stock, newest first, with Undo (decision #58). */
export const StockChangesWidget = memo(function StockChangesWidget(_: { widget: Extract<Widget, { type: "stock-changes" }> }) {
  const { data, isLoading, error } = useQuery({ queryKey: ["stock-changes"], queryFn: api.stockChanges, refetchInterval: 60_000 });
  if (isLoading) return <div className="skeleton widget-skeleton" />;
  if (error) return <p className="widget-empty">{(error as Error).message}</p>;
  if (!data?.configured) return <p className="widget-empty">Stock needs the sales database. Add POSTGRES_URL to .env and load the demo data.</p>;
  return data.changes.length ? (
    <ul className="stock-list">{data.changes.map((c) => <Row key={c.key} c={c} />)}</ul>
  ) : (
    <p className="widget-empty">No invoice has moved stock yet. Invoices you send lower stock; supplier invoices you receive raise it.</p>
  );
});
