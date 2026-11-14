// Invoice maths, readiness and PDF output are deterministic: the model may suggest fields,
// but code decides every amount and whether the draft is safe to offer for sending.
import assert from "node:assert/strict";
import test from "node:test";

const { prepareInvoice, renderInvoicePdf } = await import("../../server/agent/invoice.js");
const { validateInvoiceEvidence } = await import("../../server/agent/chat.js");

const base = {
  invoiceNumber: "INV-20261114-0001",
  from: { name: "Northwind", email: "you@northwind.example" },
  customer: { name: "Lena Ortiz", email: "lena@ortiz.example", address: "12 Port Road" },
  currency: "USD",
  issueDate: "2026-11-14",
  dueDate: "2026-11-28",
  lineItems: [
    { description: "Workspace setup", quantity: 2, unitPriceMinor: 12500 },
    { description: "Support", quantity: 1, unitPriceMinor: 4999 },
  ],
  taxRateBps: 825,
  notes: "Thank you.",
  sourceIds: ["customer-14", "pricing-standard"],
};

test("computes line totals, tax and grand total in minor units", () => {
  const invoice = prepareInvoice(base);
  assert.deepEqual(invoice.lineItems.map((item) => item.totalMinor), [25000, 4999]);
  assert.equal(invoice.subtotalMinor, 29999);
  assert.equal(invoice.taxMinor, 2475);
  assert.equal(invoice.totalMinor, 32474);
  assert.equal(invoice.readiness.ready, true);
  assert.deepEqual(invoice.readiness.reasons, []);
});

test("does not mark an invoice ready when delivery details or dates are unsafe", () => {
  const invoice = prepareInvoice({
    ...base,
    customer: { ...base.customer, email: null },
    dueDate: "2026-11-01",
  });
  assert.equal(invoice.readiness.ready, false);
  assert.match(invoice.readiness.reasons.join(" "), /customer email/i);
  assert.match(invoice.readiness.reasons.join(" "), /due date/i);
});

test("renders a real PDF for the reviewed invoice", async () => {
  const pdf = await renderInvoicePdf(prepareInvoice(base));
  assert.equal(Buffer.isBuffer(pdf), true);
  assert.equal(pdf.subarray(0, 5).toString("ascii"), "%PDF-");
  assert.ok(pdf.length > 1000);
});

test("still renders when company data contains text outside the built-in PDF font", async () => {
  const pdf = await renderInvoicePdf(prepareInvoice({
    ...base,
    customer: { ...base.customer, name: "شركة الأرز" },
    lineItems: [{ description: "إعداد مساحة العمل", quantity: 1, unitPriceMinor: 50000 }],
  }));
  assert.equal(pdf.subarray(0, 5).toString("ascii"), "%PDF-");
});

test("rejects a model-proposed price that is absent from company records and the user's request", () => {
  const proposal = {
    customerName: "Lena Ortiz", customerEmail: "lena@ortiz.example", customerAddress: null,
    currency: "USD", issueDate: "2026-11-14", dueDate: "2026-11-28",
    lineItems: [{ description: "Workspace rollout", quantity: 1, unitPriceMinor: 99900 }],
    taxRateBps: 0, notes: null, sourceIds: ["customer-14", "price-rollout"],
  };
  const records = [
    { id: "customer-14", kind: "customer", label: "Lena", url: null, updatedAt: null, facts: { name: "Lena Ortiz", email: "lena@ortiz.example" } },
    { id: "price-rollout", kind: "pricing", label: "Rollout price", url: null, updatedAt: null, facts: { unitPriceMinor: 50000, currency: "USD", paymentTermsDays: 14 } },
  ];
  const reasons = validateInvoiceEvidence(proposal, records, "Create Lena's rollout invoice", "2026-11-14");
  assert.match(reasons.join(" "), /unit price/i);
});

test("accepts customer, price and payment terms grounded in normalized company records", () => {
  const proposal = {
    customerName: "Lena Ortiz", customerEmail: "lena@ortiz.example", customerAddress: null,
    currency: "USD", issueDate: "2026-11-14", dueDate: "2026-11-28",
    lineItems: [{ description: "Workspace rollout", quantity: 1, unitPriceMinor: 50000 }],
    taxRateBps: 0, notes: null, sourceIds: ["customer-14", "price-rollout"],
  };
  const records = [
    { id: "customer-14", kind: "customer", label: "Lena", url: null, updatedAt: null, facts: { name: "Lena Ortiz", email: "lena@ortiz.example" } },
    { id: "price-rollout", kind: "pricing", label: "Rollout price", url: null, updatedAt: null, facts: { description: "Workspace rollout", unitPriceMinor: 50000, currency: "USD", paymentTermsDays: 14 } },
  ];
  assert.deepEqual(validateInvoiceEvidence(proposal, records, "Create Lena's rollout invoice", "2026-11-14"), []);
});
