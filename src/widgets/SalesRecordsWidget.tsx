import { memo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { api, type RecordsResult, type Widget } from "../lib/api";
import { errorMessage } from "../lib/errors";

// A list the assistant made from a plain request (decision #69): products with stock, customers, orders, supplier
// purchases, expenses, quotes or staff. It stores a typed query, not data, and loads its rows from Postgres
// (POST /api/sales/records) each time, saying what it lists and for which period.

type Props = { widget: Extract<Widget, { type: "sales-records" }> };
type Column = RecordsResult["columns"][number];

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const count = new Intl.NumberFormat("en-US");
const day = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const cell = (v: string | number | null, unit: Column["unit"]) => {
  if (v == null || v === "") return "–";
  if (unit === "USD") return usd.format(Number(v));
  if (unit === "count") return count.format(Number(v));
  if (unit === "percent") return `${Number(v).toFixed(1)}%`;
  if (unit === "date") return day(String(v));
  return String(v);
};
const numeric = (unit: Column["unit"]) => unit === "USD" || unit === "count" || unit === "percent";
/** Stock status gets a tag so low and out of stock stand out. */
const STATUS_TONE: Record<string, string> = { "Out of stock": "error", Low: "warn", "In stock": "ok" };

export const SalesRecordsWidget = memo(function SalesRecordsWidget({ widget }: Props) {
  const { data, isLoading, error } = useQuery({ queryKey: ["sales-records", widget.query], queryFn: () => api.salesRecords(widget.query), staleTime: 60_000 });

  if (isLoading) return <div className="custom-loading" aria-busy="true"><span className="bone" style={{ width: "40%", height: 22 }} /><span className="bone" style={{ flex: 1, height: "auto", minHeight: 60 }} /></div>;
  if (error || !data) return <div className="widget-empty"><p>Couldn't load this list.</p><p className="widget-empty-rule">{errorMessage(error)}</p></div>;

  const what = data.filters.join(", ") || `All ${data.label.toLowerCase()}`;
  const shown = data.rows.length < data.total ? `${data.rows.length} of ${data.total}` : `${data.total}`;
  const periodWord = ["products", "customers", "staff"].includes(data.dataset) ? "figures for" : "";
  const caption = `${what} · ${shown} ${data.total === 1 ? "row" : "rows"} · ${periodWord ? `${periodWord} ` : ""}${day(data.period.from)} – ${day(data.period.to)}`;

  return (
    <div className="sales-widget custom-widget records-widget" data-chart="table">
      {!data.rows.length ? (
        <div className="widget-empty"><p>Nothing matches this list.</p></div>
      ) : (
        <div className="sales-table-wrap">
          <table className="sales-table" aria-label={widget.title}>
            <thead>
              <tr>{data.columns.map((c) => <th key={c.key} scope="col" className={numeric(c.unit) ? "num-col" : undefined}>{c.label}</th>)}</tr>
            </thead>
            <tbody>
              {data.rows.map((row, i) => (
                <tr key={i}>
                  {data.columns.map((c) => (
                    <td key={c.key} className={numeric(c.unit) ? "num-col num" : undefined}>
                      {c.key === "stockStatus" && STATUS_TONE[String(row[c.key])] ? <span className="tag" data-tone={STATUS_TONE[String(row[c.key])]}>{String(row[c.key])}</span> : cell(row[c.key], c.unit)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="custom-caption">
        <span>{caption}</span>
        <span className="custom-by"><Sparkles size={12} aria-hidden /> Made by the assistant</span>
      </p>
      {widget.note && <p className="sr-only">{widget.note}</p>}
    </div>
  );
});
