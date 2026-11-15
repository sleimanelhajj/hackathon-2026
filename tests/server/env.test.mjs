// Startup configuration check (server/env.js): names what's missing in plain words, never prints a value.
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkEnv } from "../../server/env.js";

const full = {
  MONGODB_URI: "mongodb+srv://u:secret@x/y", TOKEN_SECRET: "a".repeat(64), GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "s",
  GOOGLE_REDIRECT_URI: "https://app.example/api/integrations/gmail/callback", APP_URL: "https://app.example", GEMINI_API_KEY: "k",
  POSTGRES_URL: "postgres://u:p@h/db", TELEGRAM_API_ID: "123", TELEGRAM_API_HASH: "abc",
};

test("a complete configuration passes", () => {
  const r = checkEnv(full);
  assert.deepEqual(r.missing, []);
  assert.deepEqual(r.warnings, []);
});

test("missing database or token secret is fatal, and the message names them without values", () => {
  const r = checkEnv({ ...full, MONGODB_URI: "", TOKEN_SECRET: undefined });
  assert.deepEqual(r.missing.map((m) => m.name), ["MONGODB_URI", "TOKEN_SECRET"]);
  assert.doesNotMatch(JSON.stringify(r), /secret@x/);
});

test("optional features that are off become warnings saying what stops working", () => {
  const r = checkEnv({ MONGODB_URI: full.MONGODB_URI, TOKEN_SECRET: full.TOKEN_SECRET });
  const names = r.warnings.map((w) => w.name);
  for (const n of ["GOOGLE_CLIENT_ID", "GEMINI_API_KEY", "POSTGRES_URL", "TELEGRAM_API_ID"]) assert.ok(names.includes(n), n);
});

test("in production, APP_URL must be set and not localhost", () => {
  const r = checkEnv({ ...full, APP_URL: "http://localhost:5173" }, { production: true });
  assert.deepEqual(r.missing.map((m) => m.name), ["APP_URL"]);
});

test("Telegram keys count under the same spellings the Telegram code reads (api_id / api_hash)", () => {
  const { TELEGRAM_API_ID, TELEGRAM_API_HASH, ...rest } = full;
  assert.deepEqual(checkEnv({ ...rest, api_id: "123", api_hash: "abc" }).warnings, []);
  assert.deepEqual(checkEnv({ ...rest, API_ID: "123", API_HASH: "abc" }).warnings, []);
});
