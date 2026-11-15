// Custom email widgets the assistant builds (server/email-custom.js, decision #60): a typed query (count what, grouped
// how, which emails) run over the synced mail, never free-form code.
import assert from "node:assert/strict";
import test from "node:test";
import { aggregateEmails } from "../../server/email-custom.js";
import { EmailCustomQuery, categoryInfo, emailChartProblems } from "../../shared/spec.js";

const now = new Date("2026-11-15T12:00:00Z");
let n = 0;
const msg = (extra = {}) => ({
  gmailId: `g${++n}`, threadId: `t${n}`, direction: "in", date: new Date("2026-11-14T10:00:00Z"), hasAttachments: false,
  from: { name: "Karim Haddad", email: "karim@haddad-plumbing.example" }, to: [{ name: "Me", email: "me@shop.example" }], ...extra,
});
const messages = [
  msg({ threadId: "a" }), msg({ threadId: "a", date: new Date("2026-11-13T10:00:00Z") }),
  msg({ threadId: "b", from: { name: "Rania Khoury", email: "rania@gmail.com" }, hasAttachments: true }),
  msg({ threadId: "c", direction: "out", from: { name: "Me", email: "me@shop.example" }, to: [{ name: "Lina Farah", email: "lina@farah-build.example" }], date: new Date("2026-11-10T10:00:00Z") }),
  msg({ threadId: "d", date: new Date("2026-10-01T10:00:00Z") }), // outside 30 days
];
const labels = [
  { _id: "a", threadId: "a", category: "request", priority: "high", needsReply: true },
  { _id: "b", threadId: "b", category: "support", priority: "medium", needsReply: false },
  { _id: "c", threadId: "c", category: "proposal", priority: "low", needsReply: false },
];
const q = (over) => EmailCustomQuery.parse(over);

test("counts emails, conversations or people in the window, with filters", () => {
  assert.equal(aggregateEmails({ messages, labels, query: q({ metric: "emails", groupBy: "none" }), now }).total, 4);
  assert.equal(aggregateEmails({ messages, labels, query: q({ metric: "conversations", groupBy: "none" }), now }).total, 3);
  assert.equal(aggregateEmails({ messages, labels, query: q({ metric: "people", groupBy: "none" }), now }).total, 3);
  assert.equal(aggregateEmails({ messages, labels, query: q({ metric: "emails", groupBy: "none", filters: { direction: "in" } }), now }).total, 3);
  assert.equal(aggregateEmails({ messages, labels, query: q({ metric: "emails", groupBy: "none", filters: { priorities: ["high"] } }), now }).total, 2);
  assert.equal(aggregateEmails({ messages, labels, query: q({ metric: "conversations", groupBy: "none", filters: { needsReply: true } }), now }).total, 1);
  assert.equal(aggregateEmails({ messages, labels, query: q({ metric: "emails", groupBy: "none", filters: { from: "haddad" } }), now }).total, 2);
  assert.equal(aggregateEmails({ messages, labels, query: q({ metric: "emails", groupBy: "none", filters: { withAttachments: true } }), now }).total, 1);
  assert.equal(aggregateEmails({ messages, labels, query: q({ metric: "emails", groupBy: "none", days: 3 }), now }).total, 3);
});

test("groups by sender, company, category, priority or direction, biggest first", () => {
  const rows = (groupBy, extra = {}) => aggregateEmails({ messages, labels, query: q({ metric: "emails", groupBy, ...extra }), now }).rows;
  assert.deepEqual(rows("sender"), [{ key: "Karim Haddad", value: 2 }, { key: "Lina Farah", value: 1 }, { key: "Rania Khoury", value: 1 }]);
  assert.deepEqual(rows("company"), [{ key: "haddad-plumbing.example", value: 2 }, { key: "farah-build.example", value: 1 }, { key: "gmail.com", value: 1 }]);
  assert.deepEqual(rows("category")[0], { key: categoryInfo("request").title, value: 2 });
  assert.equal(rows("category").length, 3);
  assert.deepEqual(rows("priority")[0], { key: "High", value: 2 });
  assert.deepEqual(rows("direction"), [{ key: "Received", value: 3 }, { key: "Sent", value: 1 }]);
  assert.equal(rows("sender", { limit: 3 }).length, 3);
});

test("over time: every day (or week) in the window, oldest first, zeros included", () => {
  const { rows } = aggregateEmails({ messages, labels, query: q({ metric: "emails", groupBy: "day", days: 7 }), now });
  assert.equal(rows.length, 7);
  assert.deepEqual(rows.at(-2), { key: "2026-11-14", value: 2 });
  assert.equal(rows[0].key, "2026-11-09");
  assert.ok(rows.every((r, i) => i === 0 || r.key > rows[i - 1].key));
  const weeks = aggregateEmails({ messages, labels, query: q({ metric: "emails", groupBy: "week", days: 30 }), now }).rows;
  assert.ok(weeks.length >= 4 && weeks.length <= 6);
  assert.equal(weeks.reduce((s, r) => s + r.value, 0), 4);
});

test("the chart has to suit the grouping", () => {
  assert.deepEqual(emailChartProblems("number", q({ metric: "emails", groupBy: "none" })), []);
  assert.match(emailChartProblems("line", q({ metric: "emails", groupBy: "sender" })).join(), /over time/);
  assert.match(emailChartProblems("bar", q({ metric: "emails", groupBy: "none" })).join(), /group/);
  assert.match(emailChartProblems("number", q({ metric: "emails", groupBy: "sender" })).join(), /single total/);
});

test("a query straight from the assistant, with no filters at all, gets the default filters", () => {
  const out = aggregateEmails({ messages, labels, query: { metric: "emails", groupBy: "company", days: 30, limit: 5 }, now });
  assert.equal(out.total, 4);
  assert.deepEqual(EmailCustomQuery.parse({ metric: "emails", groupBy: "none" }).filters, { direction: "any", categories: [], priorities: [], needsReply: null, from: "", withAttachments: false });
});
