// Layla updating the records (decision #68), with a scripted fake model and a fake change desk: a propose_ tool only
// makes a draft; the draft waits for the user; Save applies exactly that draft once; anything else applies nothing.
import assert from "node:assert/strict";
import test from "node:test";
import { createSalesAgent } from "../../server/agent/sales-agent.js";

const call = (name, args = {}) => ({ role: "model", parts: [{ functionCall: { name, args }, thoughtSignature: "sig" }] });
const say = (text) => ({ role: "model", parts: [{ text }] });
function fakeModel(script) {
  const seen = [];
  const fn = async ({ system, contents, tools }) => {
    seen.push({ system, contents: structuredClone(contents), tools });
    const next = script.shift();
    if (!next) throw new Error("script ran out");
    return { content: next, model: "fake" };
  };
  fn.seen = seen;
  return fn;
}
const tools = { async run() { return { customers: [] }; }, async draftInvoice() { throw new Error("no invoices here"); } };
const DRAFT = {
  id: "c-1", kind: "new_customer", entity: "customers", title: "Add a new customer", target: "Zahle Green Farms", warnings: [],
  fields: [{ label: "Name", before: null, after: "Zahle Green Farms" }, { label: "Segment", before: null, after: "Commercial account" }],
  payload: { set: { name: "Zahle Green Farms", segment: "Commercial account" } },
};
function fakeDesk({ failApply = false } = {}) {
  const calls = { propose: [], apply: [] };
  return {
    calls,
    async propose(name, args) {
      calls.propose.push([name, args]);
      if (args.name === "?") throw new Error("name: must be at least 2 characters");
      return structuredClone(DRAFT);
    },
    async apply(d) {
      calls.apply.push(d);
      if (failApply) throw new Error("The customer changed since this draft was made. Ask for the change again.");
      return { applied: true, id: d.id, kind: d.kind, title: d.title, target: d.target, summary: "Zahle Green Farms added as a customer." };
    },
    async expensesSummary(args) { return { total: 1200, byCategory: [{ category: "Rent", amount: 1200 }], args }; },
  };
}
const agentWith = (model, desk) => createSalesAgent({ generate: model, tools, saveInvoice: async () => assert.fail("no invoice"), changes: desk });

test("a proposed change waits for the user; Save applies exactly that draft once and the chat says what was saved", async () => {
  const desk = fakeDesk();
  const model = fakeModel([call("propose_new_customer", { name: "Zahle Green Farms", segment: "commercial" }), say("Here's the new customer. Press Save to add them.")]);
  const agent = agentWith(model, desk);
  const first = await agent.send({ threadId: "c1", message: "Add Zahle Green Farms as a commercial customer" });
  assert.equal(first.pendingChange.title, "Add a new customer");
  assert.equal(first.pendingChange.payload, undefined, "the chat never gets the internal payload");
  assert.equal(desk.calls.apply.length, 0, "nothing saved yet");
  const names = model.seen[0].tools.map((t) => t.name);
  assert.ok(names.includes("propose_sale") && names.includes("propose_expense") && names.includes("expenses_summary"));
  assert.match(model.seen[0].system, /Only propose a change the user asked for/);

  const done = await agent.resume({ threadId: "c1", approve: true });
  assert.equal(desk.calls.apply.length, 1);
  assert.deepEqual(desk.calls.apply[0].payload, DRAFT.payload, "the stored draft is applied, not anything from the client");
  assert.equal(done.pendingChange, null);
  assert.equal(done.applied[0].id, "c-1");
  assert.match(done.reply, /Zahle Green Farms added as a customer/);
  await assert.rejects(agent.resume({ threadId: "c1", approve: true }), /nothing waiting/i);
});

test("not confirming saves nothing and hands the user's words back to the model", async () => {
  const desk = fakeDesk();
  const model = fakeModel([call("propose_new_customer", { name: "Zahle Green Farms" }), say("Draft ready."), say("Sure, which branch should they be under?")]);
  const agent = agentWith(model, desk);
  await agent.send({ threadId: "c2", message: "Add Zahle Green Farms" });
  const out = await agent.send({ threadId: "c2", message: "Actually put them under Jounieh" });
  assert.equal(desk.calls.apply.length, 0);
  assert.equal(out.pendingChange, null);
  const lastUser = model.seen.at(-1).contents.filter((c) => c.role === "user").at(-1).parts[0].text;
  assert.match(lastUser, /didn't confirm the change.*Jounieh/);
});

test("a request that doesn't hold up goes back to the model as an error, with nothing waiting", async () => {
  const desk = fakeDesk();
  const model = fakeModel([call("propose_new_customer", { name: "?" }), say("What's the customer's full name?")]);
  const out = await agentWith(model, desk).send({ threadId: "c3", message: "add a customer" });
  assert.equal(out.pendingChange, null);
  const response = model.seen[1].contents.at(-1).parts[0].functionResponse.response;
  assert.match(response.error, /at least 2 characters/);
});

test("one change at a time: a second proposal in the same turn is refused until the first is answered", async () => {
  const desk = fakeDesk();
  const model = fakeModel([{ role: "model", parts: [{ functionCall: { name: "propose_new_customer", args: { name: "A Farms" } } }, { functionCall: { name: "propose_new_customer", args: { name: "B Farms" } } }] }, say("First one ready.")]);
  const out = await agentWith(model, desk).send({ threadId: "c4", message: "add A Farms and B Farms" });
  assert.equal(desk.calls.propose.length, 1);
  assert.ok(out.pendingChange);
});

test("if saving fails (it changed meanwhile), the chat says so and nothing waits", async () => {
  const desk = fakeDesk({ failApply: true });
  const model = fakeModel([call("propose_new_customer", { name: "Zahle Green Farms" }), say("Ready.")]);
  const agent = agentWith(model, desk);
  await agent.send({ threadId: "c5", message: "add them" });
  const out = await agent.resume({ threadId: "c5", approve: true });
  assert.match(out.reply, /couldn't save it.*changed since/i);
  assert.deepEqual(out.applied, []);
  assert.equal(out.pendingChange, null);
});

test("expenses can be read without confirming anything", async () => {
  const desk = fakeDesk();
  const model = fakeModel([call("expenses_summary", { months: 1 }), say("You spent **$1,200** on rent this month.")]);
  const out = await agentWith(model, desk).send({ threadId: "c6", message: "what did we spend this month?" });
  assert.match(out.reply, /\$1,200/);
  assert.equal(out.pendingChange, null);
});
