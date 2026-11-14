// One attachment as the dashboard lists it (server/dashboard.js fileItem): who sent it, the conversation's topic and
// a short summary of the email, plus what's needed to download it.
import assert from "node:assert/strict";
import test from "node:test";

process.env.TOKEN_SECRET ||= "a".repeat(64);
const { fileItem } = await import("../../server/dashboard.js");

const pdf = { filename: "bill-of-lading-NS-7842.pdf", mimeType: "application/pdf", size: 3000, attachmentId: "att1", partId: "2" };
const received = {
  gmailId: "m1", threadId: "t1", direction: "in", source: "gmail", date: new Date("2026-11-14T10:00:00Z"),
  from: { name: "Maroun Hanna", email: "maroun@example.com" }, to: [{ name: "You", email: "me@example.com" }],
  subject: "Shipment NS-7842 delayed at customs", snippet: "Hi team, shipment NS-7842 arrived at the Port of Beirut",
};

test("a received file names its sender and carries the AI topic and summary", () => {
  const item = fileItem(received, pdf, { category: "request", summary: "Customs needs a signed bill of lading for NS-7842." });
  assert.deepEqual(item.sender, { name: "Maroun Hanna", email: "maroun@example.com" });
  assert.equal(item.threadId, "t1");
  assert.equal(item.topic, "request");
  assert.equal(item.summary, "Customs needs a signed bill of lading for NS-7842.");
  assert.equal(item.at.toISOString(), "2026-11-14T10:00:00.000Z");
  assert.equal(item.downloadable, true);
  assert.equal(item.id, "m1:2");
});

test("without an AI label the summary falls back to Gmail's preview and the topic is empty", () => {
  const item = fileItem(received, pdf, undefined);
  assert.equal(item.topic, null);
  assert.equal(item.summary, "Hi team, shipment NS-7842 arrived at the Port of Beirut");
});

test("files you sent are filed under you", () => {
  const sent = { ...received, direction: "out", from: { name: "Me", email: "me@example.com" }, to: [{ name: "Maroun Hanna", email: "maroun@example.com" }] };
  assert.deepEqual(fileItem(sent, pdf, undefined).sender, { name: "You", email: "" });
});

test("sample files can't be downloaded", () => {
  assert.equal(fileItem({ ...received, source: "sample" }, pdf, undefined).downloadable, false);
});
