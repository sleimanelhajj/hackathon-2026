// The assistant's LangGraph agent (server/agent/sales-agent.js), driven by a scripted fake model so the control flow
// is tested without Gemini: tools run, answers come back, and an invoice is only created after the user confirms.
import assert from "node:assert/strict";
import test from "node:test";
import { createSalesAgent } from "../../server/agent/sales-agent.js";

const call = (name, args = {}) => ({ role: "model", parts: [{ functionCall: { name, args }, thoughtSignature: "sig" }] });
const say = (text) => ({ role: "model", parts: [{ text }] });

/** A fake model that plays back `script`, recording what it was shown each turn. */
function fakeModel(script) {
  const seen = [];
  const fn = async ({ contents, tools }) => {
    seen.push({ contents: structuredClone(contents), tools });
    const next = script.shift();
    if (!next) throw new Error("script ran out");
    return { content: typeof next === "function" ? next(contents) : next, model: "fake" };
  };
  fn.seen = seen;
  return fn;
}

const DRAFT = {
  invoiceNumber: "DRAFT", currency: "USD", issueDate: "2026-11-14", dueDate: "2026-12-14",
  from: { name: "Cornerstone Hardware & Supply", email: "billing@cornerstonehardware.example", address: "418 Market Street" },
  customer: { name: "Summit Plumbing", email: "accounts@summitplumbing.example", address: "1 Oak Street" },
  lineItems: [{ description: "Push-fit coupling 1/2 in (CH-0027), 5% account discount", quantity: 4, unitPriceMinor: 854, totalMinor: 3416, sku: "CH-0027" }],
  subtotalMinor: 3416, taxRateBps: 825, taxMinor: 282, totalMinor: 3698, notes: "Job 42", sourceIds: [], readiness: { ready: true, reasons: [] }, warnings: [],
};

function fakeTools() {
  const calls = [];
  return {
    calls,
    async run(name, args) { calls.push([name, args]); if (name === "find_customers") return { customers: [{ id: 7, name: "Summit Plumbing" }] }; return { ok: true, name }; },
    async draftInvoice(args) { calls.push(["draftInvoice", args]); if (args.customerId !== 7) throw new Error("No customer with id 99."); return structuredClone(DRAFT); },
  };
}

test("answers a question by calling a read-only tool, then replying", async () => {
  const model = fakeModel([call("sales_summary", { months: 3 }), say("Revenue was $41,200 over the last 3 months.")]);
  const tools = fakeTools();
  const agent = createSalesAgent({ generate: model, tools, saveInvoice: async () => assert.fail("no invoice") });
  const out = await agent.send({ threadId: "t1", message: "How did we do this quarter?" });
  assert.equal(out.reply, "Revenue was $41,200 over the last 3 months.");
  assert.deepEqual(tools.calls, [["sales_summary", { months: 3 }]]);
  assert.deepEqual(out.toolsUsed, ["sales_summary"]);
  assert.equal(out.pendingInvoice, null);
  // The tool result went back to the model as a functionResponse, after the model's own call (signature intact).
  const last = model.seen[1].contents;
  assert.equal(last.at(-2).parts[0].thoughtSignature, "sig");
  assert.equal(last.at(-1).parts[0].functionResponse.name, "sales_summary");
});

test("remembers the conversation per thread", async () => {
  const model = fakeModel([say("Hi!"), say("You asked about drills.")]);
  const agent = createSalesAgent({ generate: model, tools: fakeTools(), saveInvoice: async () => {} });
  await agent.send({ threadId: "t2", message: "Do you sell drills?" });
  await agent.send({ threadId: "t2", message: "What did I ask?" });
  const texts = model.seen[1].contents.filter((c) => c.role === "user").map((c) => c.parts[0].text);
  assert.deepEqual(texts, ["Do you sell drills?", "What did I ask?"]);
});

test("an invoice waits for the user's confirmation, then is created exactly once", async () => {
  const model = fakeModel([call("find_customers", { query: "Summit" }), call("propose_invoice", { customerId: 7, items: [{ sku: "CH-0027", quantity: 4 }], notes: "Job 42" })]);
  const tools = fakeTools();
  const saved = [];
  const agent = createSalesAgent({ generate: model, tools, saveInvoice: async (draft) => { saved.push(draft); return { id: "inv-1", invoiceNumber: "INV-20261114-AB12", pdfUrl: "/api/invoices/inv-1/pdf", totalMinor: draft.totalMinor }; } });

  const first = await agent.send({ threadId: "t3", message: "Invoice Summit Plumbing for 4 push-fit couplings, job 42" });
  assert.equal(saved.length, 0, "nothing is created before the user confirms");
  assert.equal(first.pendingInvoice.totalMinor, 3698);
  assert.equal(first.pendingInvoice.customer.name, "Summit Plumbing");
  assert.match(first.reply, /review/i);

  const done = await agent.resume({ threadId: "t3", approve: true });
  assert.equal(saved.length, 1);
  assert.equal(saved[0].totalMinor, 3698, "the saved invoice is the draft the user saw");
  assert.equal(done.invoice.pdfUrl, "/api/invoices/inv-1/pdf");
  assert.equal(done.pendingInvoice, null);
  assert.match(done.reply, /INV-20261114-AB12/);

  await assert.rejects(agent.resume({ threadId: "t3", approve: true }), /nothing waiting/i);
  assert.equal(saved.length, 1);
});

test("asking for a change goes back to the model with the user's words, and nothing is created", async () => {
  const model = fakeModel([
    call("propose_invoice", { customerId: 7, items: [{ sku: "CH-0027", quantity: 4 }] }),
    (contents) => say(`Changing it: ${contents.at(-1).parts.at(-1).text}`),
  ]);
  const saved = [];
  const agent = createSalesAgent({ generate: model, tools: fakeTools(), saveInvoice: async (d) => { saved.push(d); return {}; } });
  await agent.send({ threadId: "t4", message: "invoice please" });
  const out = await agent.send({ threadId: "t4", message: "make it 6 couplings" });
  assert.equal(saved.length, 0);
  assert.equal(out.pendingInvoice, null);
  assert.match(out.reply, /make it 6 couplings/);
});

test("a tool error is shown to the model, not thrown at the user", async () => {
  const model = fakeModel([
    call("propose_invoice", { customerId: 99, items: [{ sku: "CH-0027", quantity: 1 }] }),
    (contents) => say(`Problem: ${contents.at(-1).parts[0].functionResponse.response.error}`),
  ]);
  const agent = createSalesAgent({ generate: model, tools: fakeTools(), saveInvoice: async () => assert.fail() });
  const out = await agent.send({ threadId: "t5", message: "invoice customer 99" });
  assert.match(out.reply, /No customer with id 99/);
  assert.equal(out.pendingInvoice, null);
});

test("stops a runaway tool loop", async () => {
  const model = fakeModel(Array.from({ length: 30 }, () => call("low_stock")));
  const agent = createSalesAgent({ generate: model, tools: fakeTools(), saveInvoice: async () => {}, maxSteps: 4 });
  const out = await agent.send({ threadId: "t6", message: "loop" });
  assert.ok(model.seen.length <= 4);
  assert.match(out.reply, /couldn't finish/i);
});

test("the model is given the tool list and never a write tool", async () => {
  const model = fakeModel([say("ok")]);
  const agent = createSalesAgent({ generate: model, tools: fakeTools(), saveInvoice: async () => {} });
  await agent.send({ threadId: "t7", message: "hi" });
  const names = model.seen[0].tools.map((t) => t.name);
  assert.ok(names.includes("find_products") && names.includes("propose_invoice"));
  assert.ok(!names.some((n) => /send|delete|update|create_invoice|sql/i.test(n)));
});
