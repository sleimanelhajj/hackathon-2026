import { memo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowDownLeft, ArrowUpRight, Mail, Sparkles } from "lucide-react";
import { api, type Payment, type Widget } from "../lib/api";
import { useViewer } from "../components/EmailViewer";
import { errorMessage } from "../lib/errors";

const STATUS = { overdue: "Overdue", "due-soon": "Due soon", due: "Due", "no-due-date": "No due date", paid: "Paid" } as const;
const PRIORITY = { high: "Urgent", medium: "Soon", low: "Later" } as const;
const money = (n: number | null, currency: string | null) => {
  if (n === null || n === undefined) return "Amount not stated";
  try { return new Intl.NumberFormat("en-US", { style: "currency", currency: currency && currency !== "mixed" ? currency : "USD" }).format(n); } catch { return `${currency ?? ""} ${n.toFixed(2)}`.trim(); }
};
const day = (iso: string | null) => (iso ? new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : null);

function Row({ p }: { p: Payment }) {
  const Icon = p.direction === "to-pay" ? ArrowUpRight : ArrowDownLeft;
  const who = p.counterparty ?? "Unknown";
  return (
    <li className="pay-row" aria-label={`${who}${p.number ? ` ${p.number}` : ""}`} data-status={p.status}>
      <span className="pay-icon" data-dir={p.direction} aria-hidden><Icon size={15} /></span>
      <span className="pay-text">
        <strong>{who}</strong>
        <span className="muted small">{p.direction === "to-pay" ? "You pay" : "They pay you"}{p.number ? ` · ${p.number}` : ""}{p.dueDate ? ` · due ${day(p.dueDate)}` : ""}</span>
      </span>
      <span className="pay-side">
        <span className="num pay-amount">{money(p.total, p.currency)}</span>
        <span className="pay-tags">
          <span className="tag tag-sm" data-tone={p.status === "overdue" ? "error" : p.status === "due-soon" ? "warn" : p.status === "paid" ? "ok" : undefined}>{STATUS[p.status]}</span>
          {p.status !== "paid" && <span className="tag tag-sm" data-tone={p.priority === "high" ? "warn" : undefined}>{PRIORITY[p.priority]}</span>}
        </span>
      </span>
      {p.threadId && (
        <button type="button" className="icon-btn pay-open" aria-label={`Read the email from ${who}`} onClick={() => useViewer.getState().open(p.threadId!)}><Mail size={15} aria-hidden /></button>
      )}
    </li>
  );
}

/** Invoices to pay and to collect, most urgent first (decision #59). */
export const PaymentsWidget = memo(function PaymentsWidget({ widget }: { widget: Extract<Widget, { type: "payments" }> }) {
  const { data, isLoading, error } = useQuery({ queryKey: ["payments"], queryFn: api.payments, refetchInterval: 60_000 });
  if (isLoading) return <div className="skeleton widget-skeleton" />;
  if (error) return <p className="widget-empty">{errorMessage(error)}</p>;
  const items = (data?.items ?? []).filter((p) => widget.show === "all" || p.direction === widget.show);
  const t = data!.totals;
  // Late counts only what this widget shows ("to collect" never counts a bill you have to pay).
  const overdue = items.filter((p) => p.status === "overdue").length;
  return (
    <div className="pay-widget">
      <ul className="pay-totals" aria-label="Payment totals">
        {widget.show !== "to-collect" && <li><span>To pay</span><strong className="num">{money(t.toPay, t.currency)}</strong></li>}
        {widget.show !== "to-pay" && <li><span>To collect</span><strong className="num">{money(t.toCollect, t.currency)}</strong></li>}
        <li data-tone={overdue ? "warn" : undefined}><span>Late</span><strong className="num">{overdue} overdue</strong></li>
      </ul>
      {items.length ? (
        <ul className="pay-list">{items.map((p) => <Row key={p.id} p={p} />)}</ul>
      ) : (
        <p className="widget-empty">No invoices yet. Invoices you send and receive by email show up here with their due dates.</p>
      )}
      <p className="widget-how"><Sparkles size={12} aria-hidden /> Amounts and due dates are read from the invoice files by AI, so check them before paying; the app's own invoices are exact.</p>
    </div>
  );
});
