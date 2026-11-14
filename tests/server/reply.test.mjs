// Replies: who a reply goes to (server/agent/reply.js) and the exact email we hand to Gmail (server/gmail.js).
import assert from "node:assert/strict";
import test from "node:test";

process.env.TOKEN_SECRET ||= "a".repeat(64);
const { replyTarget } = await import("../../server/agent/reply.js");
const { buildReplyMime, buildAttachmentMime } = await import("../../server/gmail.js");

const me = "you@northwind.example";
const msg = (direction, extra = {}) => ({
  direction,
  from: direction === "in" ? { name: "Lena Ortiz", email: "lena@ortiz.example" } : { name: "You", email: me },
  to: direction === "in" ? [{ name: "You", email: me }] : [{ name: "Lena Ortiz", email: "lena@ortiz.example" }],
  ...extra,
});

test("a reply goes to the sender of the latest message from someone else", () => {
  const list = [msg("out"), msg("in", { gmailId: "m2" }), msg("out", { gmailId: "m3" })];
  const { to, replyingTo } = replyTarget(list, me);
  assert.deepEqual(to, [{ name: "Lena Ortiz", email: "lena@ortiz.example" }]);
  assert.equal(replyingTo.gmailId, "m2");
});

test("Reply-To wins over From", () => {
  const list = [msg("in", { replyTo: { name: "Billing", email: "billing@ortiz.example" } })];
  assert.deepEqual(replyTarget(list, me).to, [{ name: "Billing", email: "billing@ortiz.example" }]);
});

test("when only you wrote, a follow-up goes to your recipients, never to yourself", () => {
  const list = [msg("out", { to: [{ name: "Lena", email: "lena@ortiz.example" }, { name: "Me", email: me }] })];
  assert.deepEqual(replyTarget(list, me).to.map((a) => a.email), ["lena@ortiz.example"]);
});

// ---- the MIME message given to Gmail ----
const decode = (raw) => Buffer.from(raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
const base = {
  from: me,
  to: [{ name: "Lena Ortiz", email: "lena@ortiz.example" }],
  subject: "Re: Pricing",
  body: "Hi Lena,\nSee you Thursday.\n\nBest regards,",
  inReplyTo: "<abc@mail.example>",
  references: ["<root@mail.example>", "<abc@mail.example>"],
};

test("buildReplyMime threads the reply and keeps the body intact", () => {
  const mime = decode(buildReplyMime(base));
  assert.match(mime, /^From: you@northwind\.example\r\n/);
  assert.match(mime, /\r\nTo: Lena Ortiz <lena@ortiz\.example>\r\n/);
  assert.match(mime, /\r\nSubject: Re: Pricing\r\n/);
  assert.match(mime, /\r\nIn-Reply-To: <abc@mail\.example>\r\n/);
  assert.match(mime, /\r\nReferences: <root@mail\.example> <abc@mail\.example>\r\n/);
  const [, body] = mime.split("\r\n\r\n");
  assert.equal(Buffer.from(body.replace(/\r\n/g, ""), "base64").toString("utf8"), base.body.replace(/\n/g, "\r\n"));
});

test("buildReplyMime blocks header injection through the subject or a name", () => {
  const mime = decode(buildReplyMime({ ...base, subject: "Hi\r\nBcc: attacker@evil.example", to: [{ name: "Lena\nBcc: x@evil.example", email: "lena@ortiz.example" }] }));
  const headers = mime.split("\r\n\r\n")[0].split("\r\n");
  assert.equal(headers.filter((h) => /^Bcc:/i.test(h)).length, 0);
});

test("buildReplyMime encodes non-ASCII subjects and leaves out empty threading headers", () => {
  const mime = decode(buildReplyMime({ ...base, subject: "Re: Café menu", inReplyTo: null, references: [] }));
  assert.match(mime, /\r\nSubject: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=\r\n/);
  assert.doesNotMatch(mime, /In-Reply-To|References/);
});

test("buildAttachmentMime makes an email with a PDF attachment and blocks filename header injection", () => {
  const raw = buildAttachmentMime({
    from: me,
    to: [{ name: "Lena Ortiz", email: "lena@ortiz.example" }],
    subject: "Invoice INV-1",
    body: "Please review the attached invoice.",
    attachment: { filename: "invoice.pdf\r\nBcc: attacker@evil.example", contentType: "application/pdf", data: Buffer.from("%PDF-test") },
  });
  const mime = decode(raw);
  assert.match(mime, /Content-Type: multipart\/mixed; boundary=/);
  assert.match(mime, /Content-Type: application\/pdf/);
  assert.match(mime, /Content-Disposition: attachment; filename="invoice\.pdf_Bcc_ attacker@evil\.example"/);
  assert.doesNotMatch(mime, /\r\nBcc:/i);
  assert.match(mime, /JVBERi10ZXN0/); // base64 for %PDF-test
});
