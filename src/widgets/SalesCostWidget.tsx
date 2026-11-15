import { memo } from "react";
import type { Widget } from "../lib/api";
import { CustomSalesWidget } from "./CustomSalesWidget";

/**
 * Costs (decision #62): what the goods sold cost (quantity × unit cost), by category or by product, last 12 months.
 * A ready-made custom sales chart, so it loads and reads exactly like the ones the assistant builds.
 */
export const SalesCostWidget = memo(function SalesCostWidget({ widget }: { widget: Extract<Widget, { type: "sales-cost" }> }) {
  return (
    <CustomSalesWidget
      widget={{
        id: widget.id, type: "sales-custom", title: widget.title, chart: "bar",
        query: { metric: "cost", groupBy: widget.by, months: 12, limit: 10, filters: { products: [], categories: [], branches: [], segments: [], channels: [], customers: [] } },
      }}
    />
  );
});
