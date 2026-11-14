import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AgentAssistant } from "../src/agent/AgentAssistant";
import { api, type AgentChatResponse, type Status } from "../src/lib/api";

afterEach(cleanup);

function renderAssistant() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AgentAssistant />
    </QueryClientProvider>
  );
}

const connectedStatus: Status = {
  database: true,
  googleConfigured: true,
  gemini: { configured: true, model: "test-model" },
  companyData: { configured: true, name: "Company reporting database" },
  gmail: {
    mode: "live", email: "billing@northwind.example", status: "connected", scopes: [], canSend: true,
    lastSyncAt: null, lastSyncCount: null, error: null, connectedAt: null, syncProgress: null, mailbox: null, analysis: null,
  },
};

const response: AgentChatResponse = {
  answer: "Lena is waiting for the revised rollout invoice.",
  sources: [{ id: "customer-14", label: "Lena Ortiz · customer record", url: "https://company.example/customers/14", kind: "customer" }],
  invoice: {
    id: "invoice-1",
    invoiceNumber: "INV-20261114-0001",
    customer: { name: "Lena Ortiz", email: "lena@ortiz.example", address: null },
    currency: "USD",
    issueDate: "2026-11-14",
    dueDate: "2026-11-28",
    lineItems: [{ description: "Rollout", quantity: 1, unitPriceMinor: 50000, totalMinor: 50000 }],
    subtotalMinor: 50000,
    taxRateBps: 0,
    taxMinor: 0,
    totalMinor: 50000,
    notes: null,
    status: "draft",
    readiness: { ready: true, reasons: [] },
    pdfUrl: "/api/invoices/invoice-1/pdf",
  },
};

test("starts as a bubble and opens an accessible chat panel", () => {
  renderAssistant();
  const bubble = screen.getByRole("button", { name: "Open workspace assistant" });
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(bubble);
  expect(screen.getByRole("dialog", { name: "Workspace assistant" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Close workspace assistant" }));
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("sends a question and shows grounded sources plus an invoice action", async () => {
  vi.spyOn(api, "agentChat").mockResolvedValue(response);
  renderAssistant();
  fireEvent.click(screen.getByRole("button", { name: "Open workspace assistant" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Ask about your workspace" }), { target: { value: "Build Lena's $500 invoice" } });
  fireEvent.click(screen.getByRole("button", { name: "Send question" }));

  expect(await screen.findByText(/Lena is waiting/)).toBeTruthy();
  expect(screen.getByRole("link", { name: /Lena Ortiz · customer record/ }).getAttribute("href")).toBe("https://company.example/customers/14");
  expect(screen.getByRole("link", { name: /Download invoice PDF/ }).getAttribute("href")).toBe("/api/invoices/invoice-1/pdf");
  await waitFor(() => expect(api.agentChat).toHaveBeenCalledTimes(1));
});

test("never sends an invoice until the user opens the review and clicks Send invoice", async () => {
  vi.spyOn(api, "status").mockResolvedValue(connectedStatus);
  vi.spyOn(api, "agentChat").mockResolvedValue(response);
  const sent = { ...response.invoice!, status: "sent" as const, sentAt: "2026-11-14T12:00:00.000Z" };
  const send = vi.spyOn(api, "sendInvoice").mockResolvedValue(sent);
  renderAssistant();
  fireEvent.click(screen.getByRole("button", { name: "Open workspace assistant" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Ask about your workspace" }), { target: { value: "Build Lena's invoice" } });
  fireEvent.click(screen.getByRole("button", { name: "Send question" }));
  await screen.findByRole("link", { name: /Download invoice PDF/ });

  fireEvent.click(screen.getByRole("button", { name: "Review sending" }));
  expect(send).not.toHaveBeenCalled();
  expect(screen.getByText(/Nothing is sent until/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Send invoice" }));
  await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
  expect(await screen.findByText(/Sent to lena@ortiz\.example/)).toBeTruthy();
});
