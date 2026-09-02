import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * PMS-CAL-001.1 correction C6: static and fail-closed coverage for the
 * development-only HTTPS launcher (`scripts/dev-https.mjs`).
 *
 * Customer Web must be served over HTTPS so that it is same-site with the
 * HTTPS API and the unchanged `Secure; SameSite=Lax` antiforgery cookie is
 * returned on credentialed mutations. These checks guard the launcher's
 * security-relevant contract; the full "it actually serves the app, HMR
 * included" behaviour is covered by the recorded real-browser acceptance,
 * which needs a trusted certificate this suite must never carry.
 */
const projectRoot = resolve(__dirname, "../../../..");
const launcherPath = join(projectRoot, "scripts/dev-https.mjs");
const launcherSource = readFileSync(launcherPath, "utf8");

/**
 * The launcher's own comments explain what it deliberately avoids (0.0.0.0,
 * next/dist internals, proxies). Assertions about what the code does must
 * therefore run against the source with comments stripped, or they would pass
 * or fail for the wrong reason.
 */
const launcherCode = launcherSource
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n")
  .map((line) => line.replace(/(^|\s)\/\/.*$/, "$1"))
  .join("\n");

describe("dev-https launcher", () => {
  it("exists and is wired to the documented development commands", () => {
    expect(existsSync(launcherPath)).toBe(true);

    const packageJson = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8"));
    expect(packageJson.scripts.dev).toBe("node scripts/dev-https.mjs");
    expect(packageJson.scripts["dev:https"]).toBe("node scripts/dev-https.mjs");
    // Production commands stay on the standard Next CLI.
    expect(packageJson.scripts.build).toBe("next build");
    expect(packageJson.scripts.start).toBe("next start");
  });

  it("serves https://localhost:3000 on the loopback interface only", () => {
    expect(launcherSource).toContain('const HOST = "localhost"');
    expect(launcherSource).toContain("const PORT = 3000");
    expect(launcherSource).toContain("server.listen(PORT, HOST");
    expect(launcherCode).not.toContain("0.0.0.0");
  });

  it("never starts a plain-HTTP listener and adds no proxy or server dependency", () => {
    expect(launcherSource).toContain('from "node:https"');
    expect(launcherCode).not.toContain('from "node:http"');
    expect(launcherCode).not.toContain("createServer(app)"); // no express-style app
    for (const forbidden of ["http-proxy", "local-ssl-proxy", "express", "concurrently", "next/dist/"]) {
      expect(launcherCode).not.toContain(forbidden);
    }

    const packageJson = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8"));
    const allDeps = {
      ...(packageJson.dependencies ?? {}),
      ...(packageJson.devDependencies ?? {}),
    };
    for (const forbidden of ["http-proxy", "local-ssl-proxy", "express", "concurrently"]) {
      expect(allDeps).not.toHaveProperty(forbidden);
    }
  });

  it("forwards both normal requests and development upgrade/HMR traffic", () => {
    expect(launcherSource).toContain("getRequestHandler()");
    expect(launcherSource).toContain("getUpgradeHandler()");
    expect(launcherSource).toContain('server.on("upgrade"');
  });

  it("refuses to silently fall back to another port, and shuts down on signals", () => {
    expect(launcherSource).toContain("EADDRINUSE");
    expect(launcherSource).toContain('"SIGINT", "SIGTERM"');
    expect(launcherSource).toContain("server.close(");
  });

  it("never prints certificate or private-key contents", () => {
    // The only thing logged about the PEM files is their path and why they failed.
    expect(launcherSource).not.toMatch(/console\.(log|error)\([^)]*httpsOptions/);
    expect(launcherSource).not.toMatch(/console\.(log|error)\([^)]*\b(key|cert)\b\s*\)/);
  });

  it("keeps local certificates out of version control", () => {
    const gitignore = readFileSync(join(projectRoot, ".gitignore"), "utf8");
    expect(gitignore).toContain(".certs/");
    expect(gitignore).toContain(".env.local");
  });

  it("fails closed with a non-zero exit when the certificate is missing", async () => {
    // Run the launcher from a scratch directory with no .certs/, so it must
    // refuse to start rather than serving anything unencrypted.
    const scratch = mkdtempSync(join(tmpdir(), "thebha-devhttps-"));
    try {
      writeFileSync(join(scratch, "package.json"), JSON.stringify({ name: "scratch" }));
      const result = await new Promise<{ code: number | null; stderr: string }>((resolveRun) => {
        const child = spawn(process.execPath, [launcherPath], {
          cwd: scratch,
          env: { ...process.env, NODE_ENV: "development" },
        });
        let stderr = "";
        child.stderr.on("data", (chunk) => {
          stderr += String(chunk);
        });
        child.on("close", (code) => resolveRun({ code, stderr }));
      });

      expect(result.code).not.toBe(0);
      expect(result.stderr).toContain("TLS certificate");
      expect(result.stderr).toContain("not found");
      // The remediation hint must not leak any key material.
      expect(result.stderr).not.toContain("BEGIN");
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }, 30_000);
});
