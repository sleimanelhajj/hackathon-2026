// The chat bubble (src/agent/AgentAssistant.tsx): a LangGraph agent over the store's sales database. Invoices are
// shown as a draft first; only the user's "Confirm and create PDF" creates one, and sending is a separate reviewed step.
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AgentAssistant } from "../src/agent/AgentAssistant";
import { ConfirmHost, dismissConfirm } from "../src/components/ConfirmDialog";
import { api, type AssistantReply, type InvoiceDraft, type InvoiceProposal, type Status } from "../src/lib/api";

afterEach(() => { dismissConfirm(); cleanup(); vi.restoreAllMocks(); });

/** Click the confirm button in the open confirmation dialog. */
async function confirmDialog(title: RegExp | string, button: string) {
  const dialog = await screen.findByRole("alertdialog", { name: title });
  fireEvent.click(within(dialog).getByRole("button", { name: button }));
}

function renderAssistant() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AgentAssistant />
      <ConfirmHost />
    </QueryClientProvider>
  );
}

const connectedStatus: Status = {
  database: true,
  googleConfigured: true,
  gemini: { configured: true, model: "test-model" },
  companyData: { configured: false, name: "Company database" },
  gmail: {
    mode: "live", email: "billing@cornerstone.example", status: "connected", scopes: [], canSend: true,
    lastSyncAt: null, lastSyncCount: null, error: null, connectedAt: null, syncProgress: null, mailbox: null, analysis: null,
  },
};

const proposal: InvoiceProposal = {
  customer: { name: "Summit Plumbing", email: "accounts@summitplumbing.example", address: "12 Oak Street, Maple Falls" },
  currency: "USD", issueDate: "2026-11-14", dueDate: "2026-12-14",
  lineItems: [{ description: "Push-fit coupling 1/2 in (CH-0027), 5% account discount", quantity: 4, unitPriceMinor: 854, totalMinor: 3416 }],
  subtotalMinor: 3416, taxRateBps: 825, taxMinor: 282, totalMinor: 3698, notes: "Job 42", warnings: ["Only 3 of Push-fit coupling 1/2 in in stock (invoice asks for 4)."],
};

const invoice: InvoiceDraft = {
  id: "invoice-1", invoiceNumber: "INV-20261114-AB12", customer: proposal.customer, currency: "USD", issueDate: "2026-11-14", dueDate: "2026-12-14",
  lineItems: proposal.lineItems, subtotalMinor: 3416, taxRateBps: 825, taxMinor: 282, totalMinor: 3698, notes: "Job 42",
  status: "draft", readiness: { ready: true, reasons: [] }, pdfUrl: "/api/invoices/invoice-1/pdf",
};

const reply = (extra: Partial<AssistantReply>): AssistantReply => ({ reply: "", pendingInvoice: null, invoice: null, toolsUsed: [], widgets: [], removed: [], resized: [], ...extra });

async function ask(text: string) {
  fireEvent.change(screen.getByRole("textbox", { name: "Ask the assistant" }), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
}

test("survives browsers where scrollIntoView returns a Promise (sending a message used to blank the app)", async () => {
  // Newer Chrome returns a Promise from scrollIntoView; an effect that returned it gave React a non-function cleanup.
  const original = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = (() => Promise.resolve()) as unknown as typeof original;
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    vi.spyOn(api, "assistantMessage").mockResolvedValue(reply({ reply: "First." }));
    renderAssistant();
    fireEvent.click(screen.getByRole("button", { name: "Open assistant" }));
    await ask("hello");
    await screen.findByText("First.");
    await ask("again");
    await waitFor(() => expect(screen.getAllByText("First.")).toHaveLength(2));
    expect(errors.mock.calls.filter((c) => /must not return anything|destroy is not a function/.test(String(c[0]) + String(c[1])))).toHaveLength(0);
  } finally {
    Element.prototype.scrollIntoView = original;
  }
});

test("starts as a bubble in the corner and opens an accessible chat panel", () => {
  renderAssistant();
  const bubble = screen.getByRole("button", { name: "Open assistant" });
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(bubble);
  expect(screen.getByRole("dialog", { name: "Assistant" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Close assistant" }));
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("answers a sales question, keeps one conversation thread, and says what it checked", async () => {
  const send = vi.spyOn(api, "assistantMessage")
    .mockResolvedValueOnce(reply({ reply: "Revenue was **$41,200** over the last 3 months.\n\n- Plumbing led with $9,800", toolsUsed: ["sales_summary", "sales_breakdown"] }))
    .mockResolvedValueOnce(reply({ reply: "Paint was second." }));
  renderAssistant();
  fireEvent.click(screen.getByRole("button", { name: "Open assistant" }));
  await ask("How did we do this quarter?");

  expect(await screen.findByText("$41,200")).toBeTruthy();
  expect(screen.getByText("$41,200").tagName).toBe("STRONG");
  expect(screen.getByRole("listitem").textContent).toBe("Plumbing led with $9,800");
  expect(screen.getByText(/Checked: sales summary, sales breakdown/i)).toBeTruthy();

  await ask("And second?");
  await screen.findByText("Paint was second.");
  const [first, second] = send.mock.calls;
  expect(first[0]).toMatch(/^[0-9a-f-]{36}$/);
  expect(second[0]).toBe(first[0]);
});

test("an invoice draft is shown for review; nothing is created until Confirm", async () => {
  vi.spyOn(api, "assistantMessage").mockResolvedValue(reply({ reply: "Here's the draft.", pendingInvoice: proposal, toolsUsed: ["find_customers", "propose_invoice"] }));
  const confirm = vi.spyOn(api, "assistantConfirm").mockResolvedValue(reply({ reply: "Invoice **INV-20261114-AB12** is ready.", invoice }));
  renderAssistant();
  fireEvent.click(screen.getByRole("button", { name: "Open assistant" }));
  await ask("Invoice Summit Plumbing for 4 couplings");

  const card = await screen.findByRole("region", { name: "Invoice draft for Summit Plumbing" });
  expect(within(card).getByText("$36.98")).toBeTruthy();
  expect(within(card).getByText(/Tax 8.25%/)).toBeTruthy();
  expect(within(card).getByText(/Only 3 of Push-fit/)).toBeTruthy();
  expect(confirm).not.toHaveBeenCalled();
  expect(screen.queryByRole("link", { name: /Download invoice PDF/ })).toBeNull();

  fireEvent.click(within(card).getByRole("button", { name: "Confirm and create PDF" }));
  await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
  expect(confirm.mock.calls[0][1]).toBe(true);
  expect((await screen.findByRole("link", { name: /Download invoice PDF/ })).getAttribute("href")).toBe("/api/invoices/invoice-1/pdf");
  expect(within(card).queryByRole("button", { name: "Confirm and create PDF" })).toBeNull();
});

test("a widget the assistant added shows as a card with Open and Remove, and the Sales board refreshes", async () => {
  vi.spyOn(api, "assistantMessage").mockResolvedValue(reply({
    reply: "Added **Cordless drill sales** to your Sales dashboard.",
    widgets: [{ board: "sales", id: "ai-cordless-drill-1a2b", title: "Cordless drill sales", chart: "line", summary: "Cordless drill/driver 20V kit · last 6 months" }],
    toolsUsed: ["add_dashboard_widget"],
  }));
  const remove = vi.spyOn(api, "removeWidget").mockResolvedValue({} as never);
  renderAssistant();
  fireEvent.click(screen.getByRole("button", { name: "Open assistant" }));
  await ask("Show me the sales of the cordless drill");
  const card = await screen.findByRole("region", { name: "Widget Cordless drill sales" });
  expect(within(card).getByText("Added to Sales dashboard")).toBeTruthy();
  expect(within(card).getByText("Cordless drill/driver 20V kit · last 6 months")).toBeTruthy();
  expect(within(card).getByRole("link", { name: /Open/ }).getAttribute("href")).toBe("#/sales");
  expect(screen.getByText(/Checked: dashboard builder/)).toBeTruthy();
  fireEvent.click(within(card).getByRole("button", { name: /Remove/ }));
  expect(remove).not.toHaveBeenCalled();
  await confirmDialog(/Remove "Cordless drill sales"/, "Remove widget");
  await waitFor(() => expect(remove).toHaveBeenCalledWith("sales", "ai-cordless-drill-1a2b"));
  expect(await within(card).findByText("Removed from the dashboard")).toBeTruthy();
});

test("a widget the assistant removed shows a card with Undo, which only restores if nothing changed since", async () => {
  vi.spyOn(api, "assistantMessage").mockResolvedValue(reply({
    reply: "Removed **Plumbing revenue by branch**.",
    removed: [{ board: "sales", id: "ai-plumbing-1", title: "Plumbing revenue by branch", version: 23 }],
  }));
  const spec = vi.spyOn(api, "spec").mockResolvedValueOnce({ version: 24 } as never).mockResolvedValueOnce({ version: 23 } as never);
  const undo = vi.spyOn(api, "undoSpec").mockResolvedValue({} as never);
  renderAssistant();
  fireEvent.click(screen.getByRole("button", { name: "Open assistant" }));
  await ask("remove the plumbing chart");
  const card = await screen.findByRole("region", { name: "Removed Plumbing revenue by branch" });
  expect(within(card).getByText("Removed from Sales dashboard")).toBeTruthy();

  // The board changed after the removal: Undo would roll back something else, so it refuses and says why.
  fireEvent.click(within(card).getByRole("button", { name: /Undo/ }));
  expect(await within(card).findByRole("alert")).toBeTruthy();
  expect(undo).not.toHaveBeenCalled();

  fireEvent.click(within(card).getByRole("button", { name: /Undo/ }));
  await waitFor(() => expect(undo).toHaveBeenCalledWith("sales"));
  expect(await within(card).findByText("Put back on Sales dashboard")).toBeTruthy();
  expect(spec).toHaveBeenCalledWith("sales");
});

test("a widget the assistant resized shows what changed, refreshes that board, and Undo puts the old size back", async () => {
  vi.spyOn(api, "assistantMessage").mockResolvedValue(reply({
    reply: "The **Pipeline** is now full width.",
    resized: [{ board: "sales", id: "pipeline", title: "Pipeline", version: 7, from: { w: 6, h: 10 }, to: { w: 12, h: 10 }, limited: false }],
  }));
  vi.spyOn(api, "spec").mockResolvedValue({ version: 7 } as never);
  const undo = vi.spyOn(api, "undoSpec").mockResolvedValue({} as never);
  renderAssistant();
  fireEvent.click(screen.getByRole("button", { name: "Open assistant" }));
  await ask("make the pipeline full width");
  const card = await screen.findByRole("region", { name: "Resized Pipeline" });
  expect(within(card).getByText("Now full width on Sales dashboard")).toBeTruthy();
  fireEvent.click(within(card).getByRole("button", { name: /Undo/ }));
  await waitFor(() => expect(undo).toHaveBeenCalledWith("sales"));
  expect(await within(card).findByText("Back to its old size")).toBeTruthy();
});

test("Change something hands the draft back to the conversation", async () => {
  vi.spyOn(api, "assistantMessage").mockResolvedValue(reply({ reply: "Here's the draft.", pendingInvoice: proposal }));
  const confirm = vi.spyOn(api, "assistantConfirm").mockResolvedValue(reply({ reply: "What would you like to change?" }));
  renderAssistant();
  fireEvent.click(screen.getByRole("button", { name: "Open assistant" }));
  await ask("Invoice Summit");
  fireEvent.click(await screen.findByRole("button", { name: "Change something" }));
  await waitFor(() => expect(confirm).toHaveBeenCalledWith(expect.any(String), false, undefined));
  expect(await screen.findByText("What would you like to change?")).toBeTruthy();
});

test("sending a created invoice is a separate, reviewed step", async () => {
  vi.spyOn(api, "status").mockResolvedValue(connectedStatus);
  vi.spyOn(api, "assistantMessage").mockResolvedValue(reply({ reply: "Draft.", pendingInvoice: proposal }));
  vi.spyOn(api, "assistantConfirm").mockResolvedValue(reply({ reply: "Ready.", invoice }));
  const send = vi.spyOn(api, "sendInvoice").mockResolvedValue({ ...invoice, status: "sent", sentAt: "2026-11-14T12:00:00.000Z" });
  renderAssistant();
  fireEvent.click(screen.getByRole("button", { name: "Open assistant" }));
  await ask("Invoice Summit");
  fireEvent.click(await screen.findByRole("button", { name: "Confirm and create PDF" }));
  await screen.findByRole("link", { name: /Download invoice PDF/ });
  fireEvent.click(screen.getByRole("button", { name: "Review sending" }));
  expect(send).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Send invoice" }));
  expect(send).not.toHaveBeenCalled();
  await confirmDialog(/Send invoice/, "Send invoice");
  await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
  expect(await screen.findByText(/Sent to accounts@summitplumbing\.example/)).toBeTruthy();
});

test("shows a readable error and New chat starts a fresh thread", async () => {
  const send = vi.spyOn(api, "assistantMessage").mockRejectedValueOnce(new Error("I can't reach the sales database. Is Postgres running?"))
    .mockResolvedValueOnce(reply({ reply: "Hello again." }));
  renderAssistant();
  fireEvent.click(screen.getByRole("button", { name: "Open assistant" }));
  await ask("hi");
  expect(await screen.findByText(/can't reach the sales database/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "New chat" }));
  await confirmDialog("Start a new chat?", "Start new chat");
  await waitFor(() => expect(screen.queryByText(/can.t reach the sales database/)).toBeNull());
  expect(screen.queryByText(/can't reach the sales database/)).toBeNull();
  await ask("hi again");
  await screen.findByText("Hello again.");
  expect(send.mock.calls[1][0]).not.toBe(send.mock.calls[0][0]);
});
