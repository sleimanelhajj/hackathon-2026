// Production HTTP basics: security headers, a health check, and serving the built web app (dist/) from the API so one
// process is the whole app. In development Vite serves the web app on :5173 and proxies /api here.
import fs from "node:fs";
import path from "node:path";
import express from "express";

// The page loads its own scripts, styles and fonts; images can be data/blob URLs (exports, attachment previews);
// the PDF and image viewers open blob: URLs. Google sign-in is a full-page redirect, so it needs no exception here.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

/** Headers on every response; also stops Express announcing itself. */
export function applySecurity(app) {
  app.disable("x-powered-by");
  // Behind a hosting proxy (Render, Fly, a load balancer) the client's address and https come from X-Forwarded-*.
  if (process.env.TRUST_PROXY) app.set("trust proxy", process.env.TRUST_PROXY === "true" ? 1 : process.env.TRUST_PROXY);
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    res.setHeader("Content-Security-Policy", CSP);
    if (req.secure) res.setHeader("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
    next();
  });
}

/** GET /api/health: 200 when the database answers, 503 when it doesn't (for uptime checks and load balancers). */
export function healthRoute(ping) {
  return async (_req, res) => {
    let database = false;
    try { database = (await ping()) !== false; } catch { database = false; }
    res.status(database ? 200 : 503).json({ ok: database, database, uptimeSeconds: Math.round(process.uptime()) });
  };
}

/**
 * Serves the built app when dist/ exists. Hashed files under /assets are cached for a year; index.html is always
 * revalidated so a deploy shows up on the next load. Unknown /api paths answer a JSON 404, everything else the app.
 */
export function serveClient(app, distDir) {
  app.use("/api", (_req, res) => res.status(404).json({ error: "Not found." }));
  const index = path.join(distDir, "index.html");
  if (!fs.existsSync(index)) return false;
  app.use("/assets", express.static(path.join(distDir, "assets"), { immutable: true, maxAge: "1y", fallthrough: false }));
  app.use(express.static(distDir, { index: false, setHeaders: (res) => res.setHeader("Cache-Control", "no-cache") }));
  app.get(/.*/, (_req, res) => { res.setHeader("Cache-Control", "no-cache"); res.sendFile(index); });
  return true;
}
