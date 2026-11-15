// The payments widget (decision #59) and the stock-changes log with Undo (decision #58).
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { api, type Payment, type StockChange } from "../src/lib/api";
import { PaymentsWidget } from "../src/widgets/PaymentsWidget";
import { StockChangesWidget } from "../src/widgets/StockChangesWidget";
import { ConfirmHost, dismissConfirm } from "../src/components/ConfirmDialog";

afterEach(() => { dismissConfirm(); cleanup(); vi.restoreAllMocks(); });
const wrap = (ui: React.ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);

const pay = (extra: Partial<Payment>): Payment => ({
  id: "doc:a", source: "email", direction: "to-pay", counterparty: "Northstar Trade Co.", number: "NS-1", total: 1200, currency: "USD", issueDate: "2026-11-10",
  dueDate: "2026-11-12", threadId: "t1", filename: "NS-1.pdf", ai: true, status: "overdue", priority: "high", ...extra,
});

test("payments: totals to pay and to collect, then each invoice with who, how much, when and how urgent", async () => {
  vi.spyOn(api, "payments").mockResolvedValue({
    items: [pay({}), pay({ id: "app:1", source: "app", direction: "to-collect", counterparty: "Frem Electric", number: "INV-9", total: 207.74, dueDate: "2026-12-14", status: "due", priority: "low", ai: false })],
    totals: { toPay: 1200, toCollect: 207.74, overdue: 1, currency: "USD" }, generatedAt: "2026-11-15T10:00:00Z",
  });
  wrap(<PaymentsWidget widget={{ id: "p", type: "payments", title: "Payments", show: "all" }} />);
  const totals = await screen.findByRole("list", { name: "Payment totals" });
  expect(totals.textContent).toMatch(/To pay\$1,200\.00/);
  expect(totals.textContent).toMatch(/To collect\$207\.74/);
  expect(totals.textContent).toMatch(/1 overdue/);
  const row = screen.getByRole("listitem", { name: /Northstar Trade Co\./ });
  expect(row.textContent).toMatch(/Overdue/);
  expect(row.textContent).toMatch(/Urgent/);
  expect(row.textContent).toMatch(/NS-1/);
  expect(screen.getByText(/read from the invoice files by AI/i)).toBeTruthy();
});

test("payments can show only what you owe", async () => {
  vi.spyOn(api, "payments").mockResolvedValue({
    items: [pay({}), pay({ id: "app:1", direction: "to-collect", counterparty: "Frem Electric" })],
    totals: { toPay: 1200, toCollect: 207.74, overdue: 1, currency: "USD" }, generatedAt: "2026-11-15T10:00:00Z",
  });
  wrap(<PaymentsWidget widget={{ id: "p", type: "payments", title: "Invoices to pay", show: "to-pay" }} />);
  await screen.findByRole("listitem", { name: /Northstar/ });
  expect(screen.queryByRole("listitem", { name: /Frem Electric/ })).toBeNull();
});

const change = (extra: Partial<StockChange>): StockChange => ({
  key: "purchase:northstar:NS-1", kind: "purchase", number: "NS-1", counterparty: "Northstar Trade Co.", total: 1200, currency: "USD", invoiceDate: "2026-11-15T10:00:00Z",
  source: "email", appliedAt: "2026-11-15T10:01:00Z", undoneAt: null, lines: [{ sku: "CH-0001", name: "Solar panel 450W", change: 10 }],
  unmatched: [{ description: "Delivery", reason: "no product matches" }], ...extra,
});

test("stock changes: what each invoice moved, what it couldn't match, and Undo after a confirm", async () => {
  vi.spyOn(api, "stockChanges").mockResolvedValue({ configured: true, changes: [change({}), change({ key: "sale:INV-9", kind: "sale", number: "INV-9", counterparty: "Frem Electric", lines: [{ sku: "CH-0001", name: "Solar panel 450W", change: -2 }], unmatched: [], undoneAt: "2026-11-15T11:00:00Z" })] });
  const undo = vi.spyOn(api, "undoStockChange").mockResolvedValue({ key: "purchase:northstar:NS-1", undone: true });
  wrap(<><StockChangesWidget widget={{ id: "s", type: "stock-changes", title: "Stock changes" }} /><ConfirmHost /></>);
  const row = await screen.findByRole("listitem", { name: /Northstar Trade Co\./ });
  expect(row.textContent).toMatch(/Solar panel 450W \+10/);
  expect(row.textContent).toMatch(/1 line not matched: Delivery/);
  const sold = screen.getByRole("listitem", { name: /Frem Electric/ });
  expect(sold.textContent).toMatch(/Solar panel 450W −2/);
  expect(sold.textContent).toMatch(/Undone/);
  expect(within(sold).queryByRole("button", { name: "Undo" })).toBeNull();
  fireEvent.click(within(row).getByRole("button", { name: "Undo" }));
  expect(undo).not.toHaveBeenCalled();
  const dialog = await screen.findByRole("alertdialog", { name: "Undo this purchase?" });
  fireEvent.click(within(dialog).getByRole("button", { name: "Undo stock change" }));
  await waitFor(() => expect(undo).toHaveBeenCalledWith("purchase:northstar:NS-1"));
});

test("'to collect' counts only late invoices owed to you", async () => {
  vi.spyOn(api, "payments").mockResolvedValue({
    items: [pay({}), pay({ id: "app:1", direction: "to-collect", counterparty: "Frem Electric", status: "due", priority: "low" })],
    totals: { toPay: 1200, toCollect: 207.74, overdue: 1, currency: "USD" }, generatedAt: "2026-11-15T10:00:00Z",
  });
  wrap(<PaymentsWidget widget={{ id: "p", type: "payments", title: "Invoices to collect", show: "to-collect" }} />);
  const totals = await screen.findByRole("list", { name: "Payment totals" });
  expect(totals.textContent).toMatch(/0 overdue/);
});
