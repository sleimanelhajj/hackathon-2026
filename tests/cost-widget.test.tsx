// The ready-made Costs widget (decision #62): the cost of the goods sold, by category or by product, as a bar chart.
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { api } from "../src/lib/api";
import { SalesCostWidget } from "../src/widgets/SalesCostWidget";
import { WIDGET_KINDS, widgetFromKind } from "../server/widget-kinds.js";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

test("it asks for the cost of goods sold, grouped the way the widget is set, and shows the result", async () => {
  const custom = vi.spyOn(api, "salesCustom").mockResolvedValue({
    metric: "cost", groupBy: "category", unit: "USD", period: { from: "2025-12-01", to: "2026-11-15", months: 12 },
    rows: [{ key: "Solar & power", value: 120000 }, { key: "Plumbing", value: 30000 }], total: 150000, previousTotal: 140000, filters: [],
  } as never);
  render(<QueryClientProvider client={new QueryClient()}><SalesCostWidget widget={{ id: "c", type: "sales-cost", title: "Cost by category", by: "category" }} /></QueryClientProvider>);
  await waitFor(() => expect(custom).toHaveBeenCalledWith(expect.objectContaining({ metric: "cost", groupBy: "category", months: 12 })));
  expect(await screen.findByText(/Cost of goods sold/)).toBeTruthy();
});

test("the assistant can add it by name, by category or by product", () => {
  const kinds = WIDGET_KINDS.map((k) => k.kind);
  expect(kinds).toContain("sales-cost:category");
  expect(kinds).toContain("sales-cost:product");
  expect(widgetFromKind("sales-cost:product").widget).toEqual({ type: "sales-cost", title: "Cost by product", by: "product" });
});
