// Loading skeletons (src/components/Skeletons.tsx): each page shows a placeholder shaped like the page it's loading,
// so nothing jumps when the data arrives. They're announced to screen readers once, and their shapes are hidden.
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { PageSkeleton, BoardSkeleton, TableSkeleton } from "../src/components/Skeletons";
import { api } from "../src/lib/api";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const withQuery = (ui: ReactNode) =>
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
const never = () => new Promise<never>(() => {});

test.each([
  ["dashboard", "Loading dashboard"],
  ["data", "Loading emails"],
  ["sales", "Loading sales"],
  ["integrations", "Loading integrations"],
] as const)("the %s skeleton is announced once and its shapes are hidden", (kind, label) => {
  render(<PageSkeleton kind={kind} />);
  const region = screen.getByRole("status", { name: label });
  expect(region.getAttribute("aria-busy")).toBe("true");
  expect(region.querySelector(".page-head-skeleton")).toBeTruthy();
  for (const bone of region.querySelectorAll(".bone")) expect(bone.closest("[aria-hidden='true']")).toBeTruthy();
});

test("the dashboard skeleton looks like a board: a row of numbers, then widget cards", () => {
  const { container } = render(<BoardSkeleton kind="dashboard" />);
  expect(container.querySelectorAll(".skeleton-card[data-shape='stat']")).toHaveLength(4);
  expect(container.querySelectorAll(".skeleton-card[data-shape='list']").length).toBeGreaterThanOrEqual(2);
  expect(container.querySelectorAll(".skeleton-card[data-shape='chart']").length).toBeGreaterThanOrEqual(1);
});

test("a skeleton that announces itself still lays its cards out on the board grid", () => {
  // The labelled version once wrapped the cards in an extra element, so the 12-column grid had one child and every
  // card was squeezed into a single narrow column.
  for (const kind of ["dashboard", "sales"] as const) {
    const { container, unmount } = render(<BoardSkeleton kind={kind} label="Loading your layout" />);
    const cards = container.querySelectorAll(".skeleton-card");
    expect(cards.length).toBe(8);
    for (const card of cards) expect(card.parentElement!.classList.contains("skeleton-board")).toBe(true);
    expect(screen.getByRole("status", { name: "Loading your layout" })).toBeTruthy();
    unmount();
  }
  const { container } = render(<TableSkeleton rows={3} label="Loading emails" />);
  for (const row of container.querySelectorAll(".skeleton-row")) expect(row.parentElement!.classList.contains("skeleton-table")).toBe(true);
});

test("the sales skeleton has KPI cards, a chart and lists", () => {
  const { container } = render(<BoardSkeleton kind="sales" />);
  expect(container.querySelectorAll(".skeleton-card[data-shape='stat']")).toHaveLength(4);
  expect(container.querySelector(".skeleton-card[data-shape='chart']")).toBeTruthy();
  expect(container.querySelector(".skeleton-card[data-shape='list']")).toBeTruthy();
});

test("the table skeleton has a header and the requested rows", () => {
  const { container } = render(<TableSkeleton rows={7} />);
  expect(container.querySelectorAll(".skeleton-row")).toHaveLength(7);
  expect(container.querySelector(".skeleton-row-head")).toBeTruthy();
});

test("the dashboard page shows its skeleton while loading", async () => {
  vi.spyOn(api, "dashboard").mockImplementation(never);
  const { DashboardPage } = await import("../src/pages/DashboardPage");
  withQuery(<DashboardPage />);
  expect(await screen.findByRole("status", { name: "Loading dashboard" })).toBeTruthy();
});

test("the integrations page shows connector-card skeletons under its real header", async () => {
  vi.spyOn(api, "status").mockImplementation(never);
  const { IntegrationsPage } = await import("../src/pages/IntegrationsPage");
  withQuery(<IntegrationsPage />);
  expect(screen.getByRole("heading", { name: "Integrations" })).toBeTruthy();
  const region = await screen.findByRole("status", { name: "Loading integrations" });
  expect(within(region).queryByRole("heading")).toBeNull();
  expect(region.querySelectorAll(".skeleton-card").length).toBeGreaterThanOrEqual(2);
});
