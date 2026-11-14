// The only file that talks to Gemini. Plain fetch against the REST API (same pattern as gmail.js), no SDK,
// so swapping endpoints or providers later only touches this file.
// Endpoint: POST /v1beta/models/{model}:generateContent, key in the x-goog-api-key header (never in the URL).
//
// Resilience: if the main model is overloaded (503), rate-limited (429) or too slow, we retry once and then fall
// back to GEMINI_FALLBACK_MODEL. Callers get back the model that actually answered, so labels record it.

const BASE = "https://generativelanguage.googleapis.com/v1beta";
export const DEFAULT_MODEL = "gemini-3.8-flash";
export const DEFAULT_FALLBACK_MODEL = "gemini-3.5-flash-lite";
const TIMEOUT_MS = 60_000;
const RETRY_DELAYS_MS = [2_000]; // per model, for 429 / 5xx / timeouts only

export function geminiConfigured() {
  return Boolean(process.env.GEMINI_API_KEY?.trim());
}

export function geminiModel() {
  return process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL;
}

/** Main model first, then the fallback (set GEMINI_FALLBACK_MODEL=none to disable). */
export function geminiModels() {
  const fallback = process.env.GEMINI_FALLBACK_MODEL?.trim() || DEFAULT_FALLBACK_MODEL;
  const list = [geminiModel()];
  if (fallback.toLowerCase() !== "none" && fallback !== list[0]) list.push(fallback);
  return list;
}

export class GeminiError extends Error {
  constructor(message, status, retryable = false) {
    super(message);
    this.status = status;
    this.retryable = retryable;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function friendlyError(status, apiMessage, model) {
  if (status === 400 && /api key/i.test(apiMessage)) return "Gemini rejected the API key. Check GEMINI_API_KEY in .env.";
  if (status === 401 || status === 403) return "Gemini refused the request. Check GEMINI_API_KEY in .env and that the Gemini API is enabled for it.";
  if (status === 404) return `Gemini model "${model}" wasn't found. Check GEMINI_MODEL in .env.`;
  if (status === 429) return "Gemini rate limit or quota reached. Wait a minute and try again.";
  if (status === 503) return "Gemini is overloaded right now. Try again in a few minutes.";
  return `Gemini error ${status}${apiMessage ? `: ${apiMessage}` : ""}`;
}

function parseJson(text) {
  // Structured output should be bare JSON; tolerate a markdown fence just in case.
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(cleaned);
  } catch {
    throw new GeminiError("Gemini returned JSON we couldn't read.");
  }
}

/** One HTTP call to one model. Throws GeminiError with `retryable` set for 429 / 5xx / network / timeout. */
async function callOnce(model, body) {
  let res;
  try {
    res = await fetch(`${BASE}/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY.trim() },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    const msg = err?.name === "TimeoutError" ? "Gemini took too long to answer." : "Can't reach Gemini. Check your internet connection.";
    throw new GeminiError(msg, undefined, true);
  }

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const retryable = res.status === 429 || res.status >= 500;
    throw new GeminiError(friendlyError(res.status, json?.error?.message ?? "", model), res.status, retryable);
  }

  if (json.promptFeedback?.blockReason) throw new GeminiError(`Gemini blocked the request (${json.promptFeedback.blockReason}).`);
  const candidate = json.candidates?.[0];
  // Thinking models can return "thought" parts; only the answer parts matter here.
  const text = (candidate?.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? "").join("");
  if (candidate?.finishReason === "MAX_TOKENS") throw new GeminiError("Gemini's answer was cut off (too long).");
  if (!text) throw new GeminiError(`Gemini returned no answer (${candidate?.finishReason ?? "no candidates"}).`);
  return { data: parseJson(text), usage: json.usageMetadata ?? null };
}

/**
 * Ask Gemini for JSON that follows `schema` (Gemini Schema object: OpenAPI subset, uppercase types).
 * The schema guides the model; callers must still validate the result with zod before using it.
 * `system` holds our rules. `prompt` may contain untrusted email data, so it goes in the user turn only.
 * Returns { data, model, usage } where `model` is the one that actually answered.
 */
export async function generateJson({ system, prompt, schema, maxOutputTokens = 8192 }) {
  if (!geminiConfigured()) throw new GeminiError("Gemini isn't set up. Add GEMINI_API_KEY to .env and restart the server.");
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: "application/json", responseSchema: schema, maxOutputTokens },
  });

  const models = geminiModels();
  // Skip a model that just failed from overload, as long as there's another one to try.
  const usable = models.filter((m) => !(cooling.get(m) > Date.now()));
  let lastError;
  for (const model of usable.length ? usable : models) {
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      try {
        const { data, usage } = await callOnce(model, body);
        cooling.delete(model);
        return { data, model, usage };
      } catch (err) {
        lastError = err;
        if (!err.retryable && err.status !== 404) throw err; // bad key, blocked, unreadable: switching models won't help
        if (err.status === 404) break; // unknown model: go straight to the fallback
        if (attempt < RETRY_DELAYS_MS.length) await sleep(RETRY_DELAYS_MS[attempt]);
        else if (models.length > 1) cooling.set(model, Date.now() + COOL_DOWN_MS);
      }
    }
  }
  throw lastError;
}

const COOL_DOWN_MS = 5 * 60_000;
/** model -> timestamp until which we skip it (it was overloaded / timing out). In-memory, per server process. */
const cooling = new Map();
export const _resetCooling = () => cooling.clear(); // for tests
