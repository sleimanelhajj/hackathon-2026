import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Database, FlaskConical, Loader2, RefreshCw } from "lucide-react";
import { api } from "../lib/api";
import { Callout } from "../components/ui";
import { Select } from "../components/Select";
import { BoardEditor } from "../dashboard/BoardEditor";
import { SalesDataProvider, monthLabel } from "../widgets/SalesWidgets";
import { BoardSkeleton } from "../components/Skeletons";
import { ExportButton } from "../dashboard/ExportButton";

// The Sales page: a customisable board (like the email dashboard) over Postgres sales data (server/sales).
// For now it runs on demo data, and says so above the board.

const PERIODS = [
  { value: "1", label: "This month" },
  { value: "3", label: "Last 3 months" },
  { value: "6", label: "Last 6 months" },
  { value: "12", label: "Last 12 months" },
];

export default function SalesPage() {
  const qc = useQueryClient();
  const [months, setMonths] = useState(12);
  const status = useQuery({ queryKey: ["sales-status"], queryFn: api.salesStatus });
  const ready = Boolean(status.data?.connected && status.data.counts?.orders);
  const dash = useQuery({ queryKey: ["sales", months], queryFn: () => api.salesDashboard(months), enabled: ready });
  const seed = useMutation({
    mutationFn: api.seedSales,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sales-status"] });
      qc.invalidateQueries({ queryKey: ["sales"] });
    },
  });
  const vsLabel = months === 12 ? "vs the same months last year" : "vs the period before";

  // Until there's data to show: the page header and what to do next.
  if (!dash.data)
    return (
      <div className="page page-wide">
        <header className="page-head">
          <div>
            <h1 className="page-title">Sales</h1>
            <p className="page-sub">Revenue, orders, pipeline and your sales team, from Postgres</p>
          </div>
        </header>

        {(status.isLoading || (ready && dash.isLoading)) && <BoardSkeleton kind="sales" label="Loading sales" />}

        {status.data && !status.data.configured && (
          <Callout
            icon={<Database size={18} />}
            title="Connect your Postgres database"
            text={<>Add <span className="code">POSTGRES_URL=postgres://USER:PASSWORD@localhost:5432/ai_workspace_sales</span> to <span className="code">.env</span>, restart the server, then load the demo data here.</>}
          />
        )}
        {status.data?.configured && !status.data.connected && (
          <Callout tone="danger" icon={<AlertTriangle size={18} />} title="Can't connect to Postgres" text={status.data.error ?? "Check POSTGRES_URL in .env."} />
        )}
        {status.data?.connected && !status.data.counts?.orders && (
          <Callout
            icon={<Database size={18} />}
            title="Connected. No sales data yet"
            text="Load two years of realistic demo sales (fictional customers, products and deals) to try the dashboard."
            action={
              <button className="btn btn-primary" onClick={() => seed.mutate()} disabled={seed.isPending}>
                {seed.isPending ? <Loader2 size={15} className="spin" /> : <Database size={15} />} Load demo data
              </button>
            }
          />
        )}
        {seed.error && <Callout tone="danger" icon={<AlertTriangle size={18} />} title="Couldn't load the demo data" text={(seed.error as Error).message} />}
        {ready && dash.error && <Callout tone="danger" icon={<AlertTriangle size={18} />} title="Can't load sales" text={(dash.error as Error).message} />}
      </div>
    );

  const d = dash.data;
  return (
    <div className="page page-wide">
      <BoardEditor
        board="sales"
        pageError={seed.error}
        subtitle={<span>{monthLabel(d.monthly[0].month, true)} to today, {vsLabel}{dash.isFetching ? " · updating…" : ""}</span>}
        actions={<><Select label="Period" value={String(months)} onChange={(v) => setMonths(Number(v))} options={PERIODS} /><ExportButton title="Sales" /></>}
        editTag={d.sample && <span className="tag" data-tone="warn">Demo data</span>}
        banners={() =>
          d.sample && (
            <Callout
              tone="warn"
              icon={<FlaskConical size={18} />}
              title="This is demo data"
              text="Fictional customers, products and deals, generated to show how the dashboard works. Connect your real sales tables later."
              action={
                <button className="btn btn-secondary" onClick={() => seed.mutate()} disabled={seed.isPending}>
                  {seed.isPending ? <Loader2 size={15} className="spin" /> : <RefreshCw size={15} />} Reload demo data
                </button>
              }
            />
          )
        }
        wrap={(grid) => <SalesDataProvider value={{ d, vsLabel }}>{grid}</SalesDataProvider>}
      />
      <p className="howto sales-howto">
        Revenue is the order lines' quantity × price after discount, refunded orders left out. Margin is revenue minus product cost.
        Win rate counts deals won or lost in the period.
      </p>
    </div>
  );
}
