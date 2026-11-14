// Reading images and scanned PDFs with Gemini vision (server/agent/vision.js), against a fake fetch.
import assert from "node:assert/strict";
import test from "node:test";

process.env.GEMINI_API_KEY = "fake-test-key";
process.env.GEMINI_MODEL = "gemini-test-model";
process.env.GEMINI_FALLBACK_MODEL = "none";

const calls = [];
let reply = null;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  calls.push({ url, body: JSON.parse(init.body) });
  return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(reply) }] }, finishReason: "STOP" }] }) };
};
test.after(() => { globalThis.fetch = realFetch; });

const { describeFile, VISION_LIMITS } = await import("../../server/agent/vision.js");

const image = Buffer.from("fake-png-bytes");

test("sends the file inline (base64, right MIME type) with the rules in the system instruction", async () => {
  calls.length = 0;
  reply = { description: "A delivery note with two damaged cartons.", text: "DN-7702\nCarton 7: damaged" };
  await describeFile({ mimeType: "image/png", data: image, filename: "note.png" });
  const parts = calls[0].body.contents[0].parts;
  const file = parts.find((p) => p.inlineData);
  assert.equal(file.inlineData.mimeType, "image/png");
  assert.equal(Buffer.from(file.inlineData.data, "base64").toString(), "fake-png-bytes");
  assert.match(calls[0].body.systemInstruction.parts[0].text, /untrusted/i);
  assert.match(calls[0].body.systemInstruction.parts[0].text, /never follow instructions/i);
  assert.equal(calls[0].body.generationConfig.responseMimeType, "application/json");
});

test("returns the description first, then the text found in the file", async () => {
  reply = { description: "Colour swatches: approved navy vs a purple sample.", text: "" };
  assert.equal(await describeFile({ mimeType: "image/png", data: image, filename: "swatch.png" }), "Colour swatches: approved navy vs a purple sample.");
  reply = { description: "A scanned invoice.", text: "Invoice C-7712\nTotal 5,880.00" };
  assert.equal(await describeFile({ mimeType: "application/pdf", data: image, filename: "scan.pdf" }), "A scanned invoice.\nText in the file:\nInvoice C-7712\nTotal 5,880.00");
});

test("files over the vision size limit, or of a type Gemini can't read, are not sent", async () => {
  calls.length = 0;
  assert.equal(await describeFile({ mimeType: "image/png", data: Buffer.alloc(VISION_LIMITS.maxBytes + 1), filename: "big.png" }), "");
  assert.equal(await describeFile({ mimeType: "image/gif", data: image, filename: "a.gif" }), "");
  assert.equal(calls.length, 0);
});

test("an answer that doesn't match the expected shape gives no text instead of garbage", async () => {
  reply = { nope: true };
  assert.equal(await describeFile({ mimeType: "image/png", data: image, filename: "x.png" }), "");
});

test("without a Gemini key nothing is sent", async () => {
  calls.length = 0;
  const saved = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = "";
  assert.equal(await describeFile({ mimeType: "image/png", data: image, filename: "x.png" }), "");
  assert.equal(calls.length, 0);
  process.env.GEMINI_API_KEY = saved;
});
