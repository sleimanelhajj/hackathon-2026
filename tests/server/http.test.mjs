// Production HTTP basics (server/http.js): security headers, a health check, and the built web app served by the API
// with hash routing falling back to index.html, while unknown /api paths stay JSON 404s.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import { applySecurity, healthRoute, serveClient } from "../../server/http.js";

let server, base, dist;
before(async () => {
  dist = fs.mkdtempSync(path.join(os.tmpdir(), "aiw-dist-"));
  fs.mkdirSync(path.join(dist, "assets"));
  fs.writeFileSync(path.join(dist, "index.html"), "<!doctype html><title>app</title>");
  fs.writeFileSync(path.join(dist, "assets", "app-abc123.js"), "console.log(1)");
  const app = express();
  applySecurity(app);
  app.get("/api/health", healthRoute(async () => true));
  app.get("/api/thing", (_req, res) => res.json({ ok: true }));
  serveClient(app, dist);
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server?.close(); fs.rmSync(dist, { recursive: true, force: true }); });

test("every response carries the security headers and hides the framework", async () => {
  const res = await fetch(`${base}/api/thing`);
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.equal(res.headers.get("x-frame-options"), "DENY");
  assert.equal(res.headers.get("referrer-policy"), "strict-origin-when-cross-origin");
  assert.match(res.headers.get("content-security-policy") ?? "", /default-src 'self'/);
  assert.match(res.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/);
  assert.equal(res.headers.get("x-powered-by"), null);
});

test("health says whether the database answers", async () => {
  const res = await fetch(`${base}/api/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.database, true);
  assert.equal(typeof body.uptimeSeconds, "number");
});

test("health is 503 when the database is down", async () => {
  const app = express();
  app.get("/api/health", healthRoute(async () => { throw new Error("down"); }));
  const s = app.listen(0);
  await new Promise((r) => s.once("listening", r));
  const res = await fetch(`http://127.0.0.1:${s.address().port}/api/health`);
  s.close();
  assert.equal(res.status, 503);
  assert.equal((await res.json()).database, false);
});

test("the built app is served, with long caching for hashed assets and none for index.html", async () => {
  const page = await fetch(`${base}/`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<title>app<\/title>/);
  assert.match(page.headers.get("cache-control") ?? "", /no-cache/);
  const asset = await fetch(`${base}/assets/app-abc123.js`);
  assert.equal(asset.status, 200);
  assert.match(asset.headers.get("cache-control") ?? "", /immutable/);
});

test("other paths fall back to the app, but unknown API paths are a JSON 404", async () => {
  const deep = await fetch(`${base}/dashboard`);
  assert.equal(deep.status, 200);
  assert.match(await deep.text(), /<title>app<\/title>/);
  const api = await fetch(`${base}/api/nope`);
  assert.equal(api.status, 404);
  assert.match((await api.json()).error, /not found/i);
});
