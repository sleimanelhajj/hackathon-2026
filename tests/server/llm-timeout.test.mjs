// Gemini client (server/agent/llm.js): a caller the user is waiting on can give each attempt a shorter time limit, so
// a main model that hangs moves on to the fallback quickly instead of after a minute per try.
import assert from "node:assert/strict";
import test from "node:test";
import { _resetCooling, generateJson } from "../../server/agent/llm.js";

test("timeoutMs: a hanging main model gives way to the fallback within the limit", async (t) => {
  process.env.GEMINI_API_KEY = "test-key";
  process.env.GEMINI_MODEL = "main-model";
  process.env.GEMINI_FALLBACK_MODEL = "backup-model";
  _resetCooling();
  // AbortSignal.timeout doesn't keep Node running; in the app the HTTP server does. Stand in for it here.
  const keepAlive = setInterval(() => {}, 1000);
  t.after(() => clearInterval(keepAlive));
  const calls = [];
  t.mock.method(globalThis, "fetch", (url, init) => {
    const model = decodeURIComponent(String(url).match(/models\/([^:]+):/)[1]);
    calls.push(model);
    if (model === "main-model") {
      // Never answers; only the time limit ends it.
      return new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(Object.assign(new Error("timeout"), { name: "TimeoutError" }))));
    }
    return Promise.resolve(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"ok":"yes"}' }] }, finishReason: "STOP" }] })));
  });
  const started = Date.now();
  const r = await generateJson({ system: "s", prompt: "p", schema: { type: "OBJECT" }, timeoutMs: 100 });
  assert.equal(r.model, "backup-model");
  assert.deepEqual(r.data, { ok: "yes" });
  assert.ok(Date.now() - started < 5000, `took ${Date.now() - started} ms`);
  assert.deepEqual(calls, ["main-model", "main-model", "backup-model"]);
});
