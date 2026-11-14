// Making plain-text email readable in the viewer (src/lib/emailText.ts): rejoin hard-wrapped lines into paragraphs,
// keep real lists and sign-offs, and fold away the quoted earlier conversation.
import assert from "node:assert/strict";
import test from "node:test";
import { reflowEmail, splitQuoted } from "../../src/lib/emailText.ts";

const rfp = `Dear supplier,

Brightwater Insurance invites you to respond to our Request for Proposal
for the 2027 corporate gift programme: employee welcome kits, client
thank-you boxes and event giveaways.

Attached:
- RFP_Brightwater_Corporate_Gifts_2027.docx: scope, requirements and how
we'll evaluate responses
- RFP_Pricing_Template.xlsx: please fill in your unit prices; totals
calculate automatically

Responses are due by 28 November. Questions about the RFP must reach us by
20 November; we'll share all answers with every bidder.

Kind regards,
Dana Price
Procurement, Brightwater Insurance`;

test("rejoins hard-wrapped sentences into one paragraph", () => {
  const p = reflowEmail(rfp);
  assert.equal(
    p[1],
    "Brightwater Insurance invites you to respond to our Request for Proposal for the 2027 corporate gift programme: employee welcome kits, client thank-you boxes and event giveaways."
  );
  assert.equal(p[3], "Responses are due by 28 November. Questions about the RFP must reach us by 20 November; we'll share all answers with every bidder.");
});

test("keeps list items on their own lines, with their wrapped continuations joined", () => {
  assert.equal(
    reflowEmail(rfp)[2],
    "Attached:\n- RFP_Brightwater_Corporate_Gifts_2027.docx: scope, requirements and how we'll evaluate responses\n- RFP_Pricing_Template.xlsx: please fill in your unit prices; totals calculate automatically"
  );
});

test("keeps short lines such as greetings and sign-offs as they are", () => {
  const p = reflowEmail(rfp);
  assert.equal(p[0], "Dear supplier,");
  assert.equal(p[4], "Kind regards,\nDana Price\nProcurement, Brightwater Insurance");
});

test("handles Windows line endings, extra blank lines and numbered lists", () => {
  assert.deepEqual(reflowEmail("Hi,\r\n\r\n\r\n1. First point that is quite long and wraps onto the next\r\nline here\r\n2. Second"), [
    "Hi,",
    "1. First point that is quite long and wraps onto the next line here\n2. Second",
  ]);
  assert.deepEqual(reflowEmail(""), []);
});

test("splits off the quoted earlier conversation", () => {
  const text = "Thanks, we'll send it Friday.\n\nOn Tue, 10 Nov 2026 at 09:00, Lena <lena@x.example> wrote:\n> Can you send the quote?\n> Thanks";
  assert.deepEqual(splitQuoted(text), {
    main: "Thanks, we'll send it Friday.",
    quoted: "On Tue, 10 Nov 2026 at 09:00, Lena <lena@x.example> wrote:\n> Can you send the quote?\n> Thanks",
  });
  assert.deepEqual(splitQuoted("Just this."), { main: "Just this.", quoted: "" });
  assert.equal(splitQuoted("Fine\n\n-----Original Message-----\nFrom: x").quoted.startsWith("-----Original Message-----"), true);
  assert.equal(splitQuoted("Ok\n> a\n> b").main, "Ok");
});
