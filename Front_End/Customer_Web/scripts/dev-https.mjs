// PMS-CAL-001.1 correction C6: development-only HTTPS launcher for Customer Web.
//
// Why this exists: the API runs on https://localhost:7145 and issues its
// antiforgery cookie as `Secure; SameSite=Lax`. Under schemeful same-site,
// http://localhost and https://localhost are *different sites*, so a Customer
// page served over HTTP never gets that cookie back on a credentialed
// mutation — CORS and the CSRF token both succeed, and the request still fails
// antiforgery with 400. Serving Customer Web over HTTPS on the same host makes
// the two origins same-site (still cross-origin by port), so the cookie flows
// without weakening SameSite, Secure, or antiforgery validation anywhere.
//
// Next.js is pinned to 13.4.3, whose `next dev` CLI has no HTTPS option, so
// this wraps the same public programmatic API the CLI uses
// (`getRequestHandler` / `getUpgradeHandler`) in a `node:https` server. It uses
// only Node standard-library modules and the installed `next` package — no
// proxy, no extra dependency, no `next/dist/**` internals. Production `build`
// and `start` are untouched and still use the standard Next commands.

import { createServer } from "node:https";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "node:url";
import next from "next";

const HOST = "localhost";
const PORT = 3000;
const CERT_PATH = resolve(process.cwd(), ".certs/localhost.pem");
const KEY_PATH = resolve(process.cwd(), ".certs/localhost-key.pem");

/** Reads one PEM file, failing closed with an actionable message. */
function readPem(path, label) {
  try {
    return readFileSync(path);
  } catch (error) {
    const reason = error && error.code === "ENOENT" ? "not found" : "not readable";
    // Never print file contents — only the path and why it failed.
    console.error(
      `[dev-https] ${label} is ${reason}: ${path}\n` +
        `[dev-https] Generate a trusted localhost certificate first (see README.md):\n` +
        `[dev-https]   mkcert -key-file .certs/localhost-key.pem -cert-file .certs/localhost.pem localhost 127.0.0.1 ::1`
    );
    process.exit(1);
  }
}

const httpsOptions = {
  cert: readPem(CERT_PATH, "TLS certificate"),
  key: readPem(KEY_PATH, "TLS private key"),
};

const app = next({ dev: true, hostname: HOST, port: PORT });
const handleRequest = app.getRequestHandler();
const handleUpgrade = app.getUpgradeHandler();

await app.prepare();

const server = createServer(httpsOptions, (req, res) => {
  handleRequest(req, res, parse(req.url, true)).catch((error) => {
    console.error("[dev-https] request failed:", error);
    res.statusCode = 500;
    res.end("Internal Server Error");
  });
});

// Development HMR/WebSocket traffic.
server.on("upgrade", (req, socket, head) => {
  handleUpgrade(req, socket, head);
});

// Never fall back to another port: the API's CORS allowlist and the
// SameSite reasoning above both depend on this exact origin.
server.on("error", (error) => {
  if (error && error.code === "EADDRINUSE") {
    console.error(
      `[dev-https] port ${PORT} is already in use. Stop the other process; ` +
        `this launcher will not silently pick a different port.`
    );
  } else {
    console.error("[dev-https] server error:", error);
  }
  process.exit(1);
});

// Bind to the loopback interface only — never 0.0.0.0.
server.listen(PORT, HOST, () => {
  console.log(`[dev-https] Customer Web ready on https://${HOST}:${PORT}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    console.log(`[dev-https] ${signal} received, shutting down.`);
    server.close(() => process.exit(0));
    // Do not leave the port held if a connection lingers.
    setTimeout(() => process.exit(0), 5_000).unref();
  });
}
