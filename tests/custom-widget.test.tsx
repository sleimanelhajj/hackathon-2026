// Custom sales widgets made by the assistant (src/widgets/CustomSalesWidget.tsx): each loads its own data from its
// typed query, says exactly what it counts, and shows a readable table for screen readers alongside any chart.
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { api, type CustomResult, type Widget } from "../src/lib/api";
import { CustomSalesWidget } from "../src/widgets/CustomSalesWidget";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const query = { metric: "revenue", groupBy: "month", months: 3, limit: 10, filters: { products: ["CH-0010"], categories: [], branches: [], segments: [], channels: [], customers: [] } } as const;
const widget = (chart: "number" | "line" | "bar" | "table", groupBy = query.groupBy as string) =>
  ({ id: "ai-drill", type: "sales-custom", title: "Cordless drill sales", chart, query: { ...query, groupBy } }) as unknown as Extract<Widget, { type: "sales-custom" }>;
const result: CustomResult = {
  metric: "revenue", groupBy: "month", unit: "USD", period: { from: "2026-09-01", to: "2026-11-14", months: 3 },
  rows: [{ key: "2026-09", value: 1290 }, { key: "2026-10", value: 2584.5 }, { key: "2026-11", value: 860 }],
  total: 4734.5, previousTotal: 3900, filters: ["Product: Cordless drill/driver 20V kit"],
};
const show = (w: ReturnType<typeof widget>, data: CustomResult = result) => {
  const spy = vi.spyOn(api, "salesCustom").mockResolvedValue(data);
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><CustomSalesWidget widget={w} /></QueryClientProvider>);
  return spy;
};

test("loads its own data from its query and says what it counts", async () => {
  const spy = show(widget("line"));
  expect(await screen.findByText(/Cordless drill\/driver 20V kit · Sep 1 – Nov 14/)).toBeTruthy();
  expect(spy).toHaveBeenCalledWith(widget("line").query);
  expect(screen.getByText(/Made by the assistant/)).toBeTruthy();
});

test("a period that crosses a year shows the years", async () => {
  show(widget("line"), { ...result, period: { from: "2025-12-01", to: "2026-11-14", months: 12 } });
  expect(await screen.findByText(/Dec 1, 2025 – Nov 14, 2026/)).toBeTruthy();
});

test("a line chart also has a table for screen readers, with every month", async () => {
  show(widget("line"));
  const table = await screen.findByRole("table", { name: "Cordless drill sales" });
  expect(within(table).getAllByRole("row")).toHaveLength(4); // header + 3 months
  expect(within(table).getByText("$2,584.50")).toBeTruthy();
});

test("a number shows the total and the change from the previous period", async () => {
  show(widget("number", "none"), { ...result, groupBy: "none", rows: [] });
  expect(await screen.findByText("$4.73K")).toBeTruthy();
  expect(screen.getByText(/Up 21%/)).toBeTruthy();
});

test("a table ranks the groups", async () => {
  show(widget("table", "product"), { ...result, groupBy: "product", rows: [{ key: "Drill", value: 900 }, { key: "Saw", value: 400 }] });
  const table = await screen.findByRole("table", { name: "Cordless drill sales" });
  const cells = within(table).getAllByRole("cell").map((c) => c.textContent);
  expect(cells).toEqual(["Drill", "$900.00", "Saw", "$400.00"]);
});

test("no sales in the period is said plainly, not drawn as an empty chart", async () => {
  show(widget("bar", "branch"), { ...result, groupBy: "branch", rows: [], total: 0 });
  expect(await screen.findByText(/No sales match this in the period/)).toBeTruthy();
});
