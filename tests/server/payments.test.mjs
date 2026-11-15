// The payments widget (server/payments.js, decision #59): invoices to pay (received) and to collect (sent), from the
// email attachments and the app's own invoices, each with its due date and a priority.
import assert from "node:assert/strict";
import test from "node:test";
import { buildPayments } from "../../server/payments.js";

const now = new Date("2026-11-15T10:00:00Z");
const doc = (extra) => ({
  _id: "g1:1", gmailId: "g1", threadId: "t1", filename: "INV-1.pdf", direction: "in", sentAt: new Date("2026-11-10T09:00:00Z"), status: "ok",
  docType: "invoice", number: "NS-1", issueDate: "2026-11-10", dueDate: "2026-11-30", currency: "USD", total: 1200, issuer: "Northstar Trade Co.", billedTo: "Cedar Hardware",
  contact: { name: "Northstar", email: "billing@northstar.example" }, ...extra,
});

test("received invoices are to pay, sent ones to collect, each with who, how much and when", () => {
  const { items, totals } = buildPayments({
    docs: [doc({}), doc({ _id: "g2:1", gmailId: "g2", threadId: "t2", direction: "out", number: "INV-9", issuer: "Cedar Hardware", billedTo: "Frem Electric", total: 300, dueDate: "2026-12-10" })],
    appInvoices: [], extractions: [], now,
  });
  const pay = items.find((i) => i.number === "NS-1");
  assert.deepEqual([pay.direction, pay.counterparty, pay.total, pay.dueDate], ["to-pay", "Northstar Trade Co.", 1200, "2026-11-30"]);
  const collect = items.find((i) => i.number === "INV-9");
  assert.deepEqual([collect.direction, collect.counterparty], ["to-collect", "Frem Electric"]);
  assert.deepEqual(totals, { toPay: 1200, toCollect: 300, overdue: 0, currency: "USD" });
});

test("priority follows the due date: overdue and due within 3 days are urgent; the email's AI priority can raise it", () => {
  const { items } = buildPayments({
    docs: [
      doc({ _id: "a", number: "A", dueDate: "2026-11-12" }),
      doc({ _id: "b", number: "B", dueDate: "2026-11-17" }),
      doc({ _id: "c", number: "C", dueDate: "2026-11-21" }),
      doc({ _id: "d", number: "D", dueDate: "2026-12-30" }),
      doc({ _id: "e", number: "E", dueDate: null, threadId: "urgent-thread" }),
    ],
    appInvoices: [], extractions: [{ _id: "urgent-thread", priority: "high" }], now,
  });
  const by = Object.fromEntries(items.map((i) => [i.number, [i.status, i.priority]]));
  assert.deepEqual(by, {
    A: ["overdue", "high"], B: ["due-soon", "high"], C: ["due", "medium"], D: ["due", "low"], E: ["no-due-date", "high"],
  });
  assert.deepEqual(items.map((i) => i.number), ["A", "B", "E", "C", "D"], "most urgent first, then by due date");
});

test("the app's sent invoices count, once even when Gmail also has the PDF; quotes and receipts aren't payments", () => {
  const { items } = buildPayments({
    docs: [
      doc({ _id: "x", direction: "out", number: "INV-20261114-83D3", issuer: "Cedar Hardware", billedTo: "Frem Electric", total: 207.74 }),
      doc({ _id: "q", docType: "quote", number: "Q-1" }),
    ],
    appInvoices: [{ _id: "app-1", invoiceNumber: "INV-20261114-83D3", status: "sent", customer: { name: "Frem Electric" }, totalMinor: 20774, currency: "USD", issueDate: "2026-11-14", dueDate: "2026-12-14", sentAt: new Date("2026-11-14T12:00:00Z") },
      { _id: "app-2", invoiceNumber: "INV-DRAFT", status: "draft", customer: { name: "X" }, totalMinor: 100, currency: "USD", issueDate: "2026-11-14", dueDate: "2026-12-14" }],
    extractions: [], now,
  });
  assert.deepEqual(items.map((i) => [i.number, i.source, i.dueDate]), [["INV-20261114-83D3", "app", "2026-12-14"]]);
});

test("a receipt with the same number marks an invoice paid; paid ones drop out of the totals", () => {
  const { items, totals } = buildPayments({
    docs: [doc({}), doc({ _id: "r", docType: "receipt", number: "NS-1", total: 1200 })],
    appInvoices: [], extractions: [], now,
  });
  assert.equal(items[0].status, "paid");
  assert.equal(items[0].priority, "low");
  assert.equal(totals.toPay, 0);
});
