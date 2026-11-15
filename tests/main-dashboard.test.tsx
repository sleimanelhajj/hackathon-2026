// The main Dashboard (src/pages/MainDashboardPage.tsx, decision #60): pages as tabs, each a board that takes email and
// sales widgets; add, rename and delete pages. The Email dashboard and Sales keep their own pages.
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DEFAULT_MAIN_SPEC } from "../shared/spec.js";
import { api, type Dashboard, type SavedDashboard } from "../src/lib/api";
import MainDashboardPage from "../src/pages/MainDashboardPage";
import { ConfirmHost, dismissConfirm } from "../src/components/ConfirmDialog";
import { Toaster, toast } from "../src/components/Toaster";

vi.mock("../src/widgets/registry", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/widgets/registry")>(),
  WidgetBody: ({ widget }: { widget: { title: string } }) => <span data-testid="widget-body">{widget.title}</span>,
}));

let pages = [{ id: "main", name: "Overview" }, { id: "page-abc123", name: "Money" }];
beforeEach(() => {
  pages = [{ id: "main", name: "Overview" }, { id: "page-abc123", name: "Money" }];
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 1000 });
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  window.location.hash = "#/dashboard";
  vi.spyOn(api, "pages").mockImplementation(async () => ({ pages: structuredClone(pages) as never }));
  vi.spyOn(api, "spec").mockImplementation(async (board) => (board === "main"
    ? { ...structuredClone(DEFAULT_MAIN_SPEC), id: "main", version: 3, canUndo: false, updatedAt: "" }
    : { title: "Money", widgets: [{ id: "p", type: "payments", title: "Invoices to pay", show: "to-pay" }], layout: [{ i: "p", x: 0, y: 0, w: 6, h: 10 }], id: board, version: 1, canUndo: false, updatedAt: "" }) as SavedDashboard);
  vi.spyOn(api, "dashboard").mockResolvedValue({ connected: false } as unknown as Dashboard);
  vi.spyOn(api, "salesStatus").mockResolvedValue({ configured: true, connected: true, counts: { orders: 0 } } as never);
  const slot = document.createElement("aside"); slot.id = "side-panel"; document.body.append(slot);
});
afterEach(() => { act(() => { dismissConfirm(); toast.clear(); }); cleanup(); document.body.innerHTML = ""; vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function open() {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}><MainDashboardPage /><ConfirmHost /><Toaster /></QueryClientProvider>);
}

test("pages are tabs; the first page's board mixes email and sales widgets", async () => {
  open();
  const tabs = await screen.findByRole("tablist", { name: "Dashboard pages" });
  expect(within(tabs).getByRole("tab", { name: "Overview" }).getAttribute("aria-selected")).toBe("true");
  expect(within(tabs).getByRole("tab", { name: "Money" })).toBeTruthy();
  await waitFor(() => expect(api.spec).toHaveBeenCalledWith("main"));
  expect((await screen.findAllByText("Revenue")).length).toBeGreaterThan(0);
  expect(screen.getAllByText("Waiting on you").length).toBeGreaterThan(0);
});

test("another tab opens that page's board", async () => {
  open();
  fireEvent.click(await screen.findByRole("tab", { name: "Money" }));
  await waitFor(() => expect(api.spec).toHaveBeenCalledWith("page-abc123"));
  expect((await screen.findAllByText("Invoices to pay")).length).toBeGreaterThan(0);
  expect(window.location.hash).toBe("#/dashboard/page-abc123");
});

test("a new page is named, created and opened", async () => {
  const create = vi.spyOn(api, "createPage").mockImplementation(async (name) => { pages.push({ id: "page-new111", name }); return { id: "page-new111", name } as never; });
  open();
  fireEvent.click(await screen.findByRole("button", { name: /New page/ }));
  fireEvent.change(screen.getByRole("textbox", { name: "Page name" }), { target: { value: "Suppliers" } });
  fireEvent.click(within(screen.getByRole("dialog", { name: "Add a page" })).getByRole("button", { name: "Add page" }));
  await waitFor(() => expect(create).toHaveBeenCalledWith("Suppliers"));
  await waitFor(() => expect(window.location.hash).toBe("#/dashboard/page-new111"));
});

test("a page can be renamed, and deleted after a confirm; the first page can't be deleted", async () => {
  const rename = vi.spyOn(api, "renamePage").mockResolvedValue({ id: "page-abc123", name: "Cash" } as never);
  const del = vi.spyOn(api, "deletePage").mockResolvedValue({ id: "page-abc123", deleted: true } as never);
  open();
  expect(await screen.findByRole("button", { name: "Rename page" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Delete page" })).toBeNull();
  fireEvent.click(await screen.findByRole("tab", { name: "Money" }));
  fireEvent.click(await screen.findByRole("button", { name: "Rename page" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Page name" }), { target: { value: "Cash" } });
  fireEvent.click(screen.getByRole("button", { name: "Save name" }));
  await waitFor(() => expect(rename).toHaveBeenCalledWith("page-abc123", "Cash"));
  fireEvent.click(screen.getByRole("button", { name: "Delete page" }));
  expect(del).not.toHaveBeenCalled();
  fireEvent.click(within(await screen.findByRole("alertdialog", { name: /Delete the ".+" page/ })).getByRole("button", { name: "Delete page" }));
  await waitFor(() => expect(del).toHaveBeenCalledWith("page-abc123"));
  await waitFor(() => expect(window.location.hash).toBe("#/dashboard"));
});
