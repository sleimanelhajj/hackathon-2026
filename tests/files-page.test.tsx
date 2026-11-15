// The Files page (src/pages/FilesPage.tsx, decision #56): a folder per contact, each file with its AI summary and the
// figures it states, and a way back to the email.
import { afterEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { api, type DocFolder, type FilesResponse } from "../src/lib/api";
import FilesPage from "../src/pages/FilesPage";
import { useViewer } from "../src/components/EmailViewer";

afterEach(() => { cleanup(); vi.restoreAllMocks(); act(() => useViewer.getState().close()); });

const invoice = {
  _id: "g1:1", gmailId: "g1", threadId: "t1", attachmentId: "a1", partId: "1", filename: "Invoice-1042.pdf", mimeType: "application/pdf", size: 52000,
  direction: "in" as const, sentAt: "2026-11-12T10:00:00Z", subject: "Invoice 1042", status: "ok" as const, docType: "invoice", title: "Invoice 1042 from Haddad Plumbing",
  summary: "Invoice for 10 solar panels, due 30 November.", number: "1042", issueDate: "2026-11-12", dueDate: "2026-11-30", currency: "USD", total: 2450.5,
  issuer: "Haddad Plumbing", billedTo: "Cedar Hardware", lines: [{ description: "Solar panel 450W", sku: null, quantity: 10, unitPrice: 245.05, total: 2450.5 }],
  contact: { key: "company:haddad-plumbing.example", name: "Haddad Plumbing", kind: "company" as const, email: "karim@haddad-plumbing.example", domain: "haddad-plumbing.example" },
};
const folders: DocFolder[] = [
  { key: "company:haddad-plumbing.example", name: "Haddad Plumbing", kind: "company", emails: ["karim@haddad-plumbing.example"], count: 2, lastAt: "2026-11-12T10:00:00Z", types: { invoice: 1, quote: 1 },
    docs: [invoice, { ...invoice, _id: "g2:1", gmailId: "g2", filename: "Quote-77.pdf", docType: "quote", title: "Quote 77", summary: "Quote for PVC pipe.", number: "77", total: 900, dueDate: null, lines: [] }] },
  { key: "person:rania.k@gmail.com", name: "Rania Khoury", kind: "person", emails: ["rania.k@gmail.com"], count: 1, lastAt: "2026-11-10T10:00:00Z", types: { other: 1 },
    docs: [{ ...invoice, _id: "g3:1", gmailId: "g3", threadId: "t3", filename: "photo.jpg", docType: "other", title: "Valve photo", summary: "Photo of a leaking valve.", number: null, total: null, dueDate: null, issueDate: null, lines: [] }] },
];
function show(data: Partial<FilesResponse> = {}) {
  vi.spyOn(api, "files").mockResolvedValue({ folders, pending: 0, reading: false, aiConfigured: true, ...data });
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><FilesPage /></QueryClientProvider>);
}

test("a folder per contact, with how many files and of what kind", async () => {
  show();
  const list = await screen.findByRole("list", { name: "Folders" });
  expect(within(list).getByRole("button", { name: /Haddad Plumbing/ }).textContent).toMatch(/2 files/);
  expect(within(list).getByRole("button", { name: /Rania Khoury/ }).textContent).toMatch(/1 file\b/);
});

test("opening a folder shows each file's summary and figures, and leads back to its email or a download", async () => {
  show();
  fireEvent.click(await screen.findByRole("button", { name: /Haddad Plumbing/ }));
  const file = screen.getByRole("article", { name: "Invoice 1042 from Haddad Plumbing" });
  expect(file.textContent).toMatch(/Invoice for 10 solar panels/);
  expect(file.textContent).toMatch(/Invoice/);
  expect(file.textContent).toMatch(/\$2,450\.50/);
  expect(file.textContent).toMatch(/Due/);
  expect(within(file).getByRole("link", { name: /Download/ }).getAttribute("href")).toBe("/api/attachments/g1/a1");
  fireEvent.click(within(file).getByRole("button", { name: /Read the email/ }));
  expect(useViewer.getState().threadId).toBe("t1");
  expect(screen.getByRole("article", { name: "Quote 77" })).toBeTruthy();
});

test("searching narrows the folders", async () => {
  show();
  fireEvent.change(await screen.findByRole("searchbox", { name: "Search files" }), { target: { value: "valve" } });
  const list = screen.getByRole("list", { name: "Folders" });
  expect(within(list).queryByRole("button", { name: /Haddad Plumbing/ })).toBeNull();
  expect(within(list).getByRole("button", { name: /Rania Khoury/ })).toBeTruthy();
});

test("while files are being read, it says so", async () => {
  show({ pending: 12, reading: true });
  expect(await screen.findByText(/Reading 12 files/)).toBeTruthy();
});

test("nothing yet: one clear next step", async () => {
  show({ folders: [], pending: 0 });
  expect(await screen.findByText(/No attachments yet/)).toBeTruthy();
});
