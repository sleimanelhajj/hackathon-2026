// The full-email view of one conversation (server/threads.js): every message with its readable body and files,
// plus the AI's summary — and nothing that must stay on the server.
import assert from "node:assert/strict";
import test from "node:test";

process.env.TOKEN_SECRET ||= "a".repeat(64);
const { encrypt } = await import("../../server/crypto.js");
const { threadView } = await import("../../server/threads.js");

const msg = (id, direction, extra = {}) => ({
  _id: `mongo-${id}`,
  gmailId: id,
  threadId: "t1",
  direction,
  source: "gmail",
  date: new Date(`2026-11-1${id.length}T10:00:00Z`),
  from: direction === "in" ? { name: "Lena Ortiz", email: "lena@ortiz.example" } : { name: "You", email: "you@northwind.example" },
  to: [{ name: "You", email: "you@northwind.example" }],
  cc: [],
  subject: "Invoice #1042",
  snippet: "Following up on invoice #1042",
  attachments: [],
  headers: [{ name: "Authentication-Results", value: "secret-ish" }],
  bodyEnc: encrypt("Hi,\nInvoice 1042 is 3,450 USD.\n\nOn Tue, Lena wrote:\n> old"),
  ...extra,
});

const extraction = {
  _id: "t1", category: "billing", priority: "high", needsReply: true, summary: "Invoice 1042 for 3,450 USD is overdue.",
  reason: "Mentions an overdue invoice", suggestedAction: "Confirm the payment date",
};

test("returns the messages oldest first with readable bodies (quoted history kept for the reader)", () => {
  const view = threadView([msg("bb", "out"), msg("a", "in")].sort((x, y) => x.date - y.date), extraction);
  assert.equal(view.threadId, "t1");
  assert.equal(view.subject, "Invoice #1042");
  assert.equal(view.messages.length, 2);
  assert.match(view.messages[0].body, /Invoice 1042 is 3,450 USD/);
  assert.match(view.messages[0].body, /> old/, "the person reading sees the whole email, unlike the AI");
  assert.equal(view.messages[0].from.name, "Lena Ortiz");
});

test("falls back to Gmail's preview when a body can't be read", () => {
  const view = threadView([msg("a", "in", { bodyEnc: null }), msg("bb", "in", { bodyEnc: "bad.bad.bad" })], extraction);
  assert.equal(view.messages[0].body, "Following up on invoice #1042");
  assert.equal(view.messages[1].body, "Following up on invoice #1042");
});

test("lists real attachments with whether they can be downloaded", () => {
  const view = threadView(
    [msg("a", "in", {
      attachments: [
        { filename: "Invoice-1042.pdf", mimeType: "application/pdf", size: 45210, attachmentId: "att1", partId: "1", inline: false },
        { filename: "logo.png", mimeType: "image/png", size: 900, attachmentId: "att2", partId: "2", inline: true },
      ],
    })],
    extraction
  );
  assert.deepEqual(view.messages[0].attachments, [
    { filename: "Invoice-1042.pdf", mimeType: "application/pdf", size: 45210, gmailId: "a", attachmentId: "att1", downloadable: true },
  ]);
});

test("includes the AI's take, and none when the conversation wasn't analysed", () => {
  assert.deepEqual(threadView([msg("a", "in")], extraction).ai, {
    summary: extraction.summary, category: "billing", priority: "high", needsReply: true,
    suggestedAction: "Confirm the payment date", reason: "Mentions an overdue invoice",
  });
  assert.equal(threadView([msg("a", "in")], null).ai, null);
});

test("never exposes encrypted bodies, raw headers or database ids, and links to Gmail", () => {
  const view = threadView([msg("a", "in")], extraction);
  const json = JSON.stringify(view);
  assert.doesNotMatch(json, /bodyEnc|Authentication-Results|mongo-/);
  assert.equal(view.link, "https://mail.google.com/mail/u/0/#all/t1");
  assert.equal(threadView([msg("a", "in", { source: "sample" })], extraction).link, null);
});
