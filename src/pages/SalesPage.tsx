import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Database } from "lucide-react";
import { api } from "../lib/api";
import { Callout } from "../components/ui";
import { Select } from "../components/Select";
import { BoardEditor } from "../dashboard/BoardEditor";
import { SalesDataProvider, monthLabel } from "../widgets/SalesWidgets";
import { BoardSkeleton } from "../components/Skeletons";
import { ExportButton } from "../dashboard/ExportButton";
import { errorMessage } from "../lib/errors";
import { confirm } from "../components/ConfirmDialog";
import { toast } from "../components/Toaster";

// The Sales page: a customisable board (like the email dashboard) over Postgres sales data (server/sales).

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
  // Loading the starter records writes to the database, so it asks first. It is only offered while there are no orders.
  const setUp = async () => {
    const ok = await confirm({
      title: "Load the store's sales records?",
      message: "This fills the empty sales database with the store's products, customers, orders and stock so the board has data to show.",
      confirmLabel: "Load sales records",
      icon: <Database size={18} />,
      action: () => api.seedSales(),
    });
    if (!ok) return;
    toast.success("Sales records loaded");
    void qc.invalidateQueries({ queryKey: ["sales-status"] });
    void qc.invalidateQueries({ queryKey: ["sales"] });
  };
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
            text={<>Set <span className="code">POSTGRES_URL</span> on the server and restart it. The Sales board appears here once the database is reachable.</>}
          />
        )}
        {status.data?.configured && !status.data.connected && (
          <Callout tone="danger" icon={<AlertTriangle size={18} />} title="Can't connect to Postgres" text={status.data.error ?? "Check POSTGRES_URL on the server."} />
        )}
        {status.data?.connected && !status.data.counts?.orders && (
          <Callout
            icon={<Database size={18} />}
            title="Connected. No sales yet"
            text="The sales database is empty. Load the store's records to fill the board."
            action={
              <button type="button" className="btn btn-primary" onClick={() => void setUp()} aria-haspopup="dialog">
                <Database size={15} aria-hidden /> Load sales records
              </button>
            }
          />
        )}
        {ready && dash.error && <Callout tone="danger" icon={<AlertTriangle size={18} />} title="Can't load sales" text={errorMessage(dash.error)} />}
      </div>
    );

  const d = dash.data;
  return (
    <div className="page page-wide">
      <BoardEditor
        board="sales"
        subtitle={<span>{monthLabel(d.monthly[0].month, true)} to today, {vsLabel}{dash.isFetching ? " · updating…" : ""}</span>}
        actions={<><Select label="Period" value={String(months)} onChange={(v) => setMonths(Number(v))} options={PERIODS} /><ExportButton title="Sales" /></>}
        wrap={(grid) => <SalesDataProvider value={{ d, vsLabel }}>{grid}</SalesDataProvider>}
      />
      <p className="howto sales-howto">
        Revenue is the order lines' quantity × price after discount, refunded orders left out. Margin is revenue minus product cost.
        Win rate counts deals won or lost in the period.
      </p>
    </div>
  );
}
