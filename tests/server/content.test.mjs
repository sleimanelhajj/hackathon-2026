// What the AI is allowed to read from an email: cleaned body text and readable attachments (server/agent/content.js).
import assert from "node:assert/strict";
import test from "node:test";

process.env.TOKEN_SECRET ||= "a".repeat(64); // tests never touch real data
const { encrypt } = await import("../../server/crypto.js");
const { stripQuoted, messageBody, readableAttachments } = await import("../../server/agent/content.js");

test("stripQuoted cuts the quoted history after an 'On … wrote:' line", () => {
  const text = "Thanks, see below.\n\nOn Tue, 3 Nov 2026 at 10:00, Lena <lena@x.example> wrote:\n> old stuff\n> more";
  assert.equal(stripQuoted(text).trim(), "Thanks, see below.");
});

test("stripQuoted drops '>' quoted lines but keeps the rest", () => {
  assert.equal(stripQuoted("Yes.\n> quoted\nAlso this.").trim(), "Yes.\nAlso this.");
});

test("stripQuoted stops at a signature marker and at forwarded/original message blocks", () => {
  assert.equal(stripQuoted("Hi\n--\nJane Doe\nCEO").trim(), "Hi");
  assert.equal(stripQuoted("FYI\n---------- Forwarded message ---------\nFrom: a").trim(), "FYI");
  assert.equal(stripQuoted("Ok\n-----Original Message-----\nFrom: b").trim(), "Ok");
});

test("stripQuoted cuts an Outlook-style From:/Sent: header block", () => {
  const text = "Line one\nLine two\nLine three\nFrom: Tom Reyes\nSent: Monday\nTo: you\nSubject: Re: x\nold body";
  assert.equal(stripQuoted(text).trim(), "Line one\nLine two\nLine three");
});

test("stripQuoted keeps a 'From:' line that is part of the message itself", () => {
  const text = "From: our side, the price is fixed.\nThanks";
  assert.equal(stripQuoted(text).trim(), text);
});

test("messageBody decrypts, redacts email addresses and truncates", () => {
  const m = { bodyEnc: encrypt("Write to lena@ortiz.example or tom@reyes.example.\n\n\n\nThanks!") };
  assert.equal(messageBody(m, 1000), "Write to [email] or [email].\n\nThanks!");
  const short = messageBody(m, 12);
  assert.equal(short.length, 12);
  assert.ok(short.endsWith("…"));
});

test("messageBody returns an empty string when there is no body or it can't be decrypted", () => {
  assert.equal(messageBody({}, 100), "");
  assert.equal(messageBody({ bodyEnc: null }, 100), "");
  assert.equal(messageBody({ bodyEnc: "bm9wZQ.bm9wZQ.bm9wZQ" }, 100), "");
});

test("readableAttachments keeps real PDF, Word, text and CSV files and skips the rest", () => {
  const a = (filename, mimeType, extra = {}) => ({ filename, mimeType, size: 1000, attachmentId: "x", partId: filename, inline: false, ...extra });
  const m = {
    attachments: [
      a("invoice.pdf", "application/pdf"),
      a("notes.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
      a("list.csv", "text/csv"),
      a("photo.png", "image/png"), // not text
      a("logo.png", "image/png", { inline: true }),
      a("invite.ics", "text/calendar"), // calendar file
      a("huge.pdf", "application/pdf", { size: 6 * 1024 * 1024 }), // over 5 MB
      a("ghost.pdf", "application/pdf", { attachmentId: null }), // nothing to fetch
    ],
  };
  assert.deepEqual(readableAttachments(m).map((x) => x.filename), ["invoice.pdf", "notes.docx", "list.csv"]);
  assert.deepEqual(readableAttachments({}), []);
});
