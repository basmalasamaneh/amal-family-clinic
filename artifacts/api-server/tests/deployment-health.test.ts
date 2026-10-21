import assert from "node:assert/strict";
import { test } from "node:test";
import { fork, spawnSync } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";

// A closed loopback port and synthetic credential material only. No source DB
// connection is used by either the child API or readiness failure probes.
const env = {
  ...process.env,
  DATABASE_URL: "postgresql://unused:unused@127.0.0.1:1/unavailable",
  SESSION_SECRET: "isolated-deployment-probe-not-a-real-secret",
  NODE_ENV: "production",
  LOG_LEVEL: "silent",
  AUTH_ALLOWED_ORIGINS: "https://demo.example",
  AUTH_PROXY_HOPS: "0",
  AUTH_TRUSTED_PROXIES: "",
  AMAL_DEVELOPER_TOOLS: "0",
};

if (process.env.AMAL_HEALTH_CHILD === "1") {
  const { default: app } = await import("../src/app");
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  process.send?.((server.address() as { port: number }).port);
} else {
  test("production liveness works without database or proxy trust; other requests do not bypass security", { timeout: 20_000 }, async () => {
    const child = fork(fileURLToPath(import.meta.url), [], {
      env: { ...env, AMAL_HEALTH_CHILD: "1" }, silent: true,
    });
    try {
      const [port] = await once(child, "message", { signal: AbortSignal.timeout(10_000) });
      const base = `http://127.0.0.1:${port}`;
      const result = await fetch(base + "/api/healthz");
      assert.equal(result.status, 200);
      assert.deepEqual(await result.json(), { status: "ok" });
      assert.equal(result.headers.get("cache-control"), "no-store");
      assert.equal(result.headers.get("x-content-type-options"), "nosniff");
      assert.equal(result.headers.get("set-cookie"), null);
      const head = await fetch(base + "/api/healthz", { method: "HEAD" });
      assert.equal(head.status, 200);
      assert.equal(await head.text(), "");
      for (const path of ["/api/auth/me", "/api/healthz?x=1", "/api/healthz/", "/api/HEALTHZ"]) {
        assert.equal((await fetch(base + path, { headers: { "x-forwarded-proto": "https" } })).status, 403);
      }
      assert.equal((await fetch(base + "/api/healthz", {
        method: "POST", headers: { origin: "https://demo.example" },
      })).status, 403);
      assert.equal((await fetch(base + "/api/healthz", {
        headers: { origin: "https://untrusted.example" },
      })).status, 403);
      for (const value of ["invalid!", "x".repeat(257), "one,two"]) {
        assert.equal((await fetch(base + "/api/healthz", {
          headers: { "x-csrf-token": value },
        })).status, 403);
      }
    } finally {
      const exited = once(child, "exit");
      child.kill();
      await exited;
    }
  });

  test("built readiness reports unavailable without leaking diagnostics for absent DB/config", () => {
    for (const config of [env, { ...env, SESSION_SECRET: "" }]) {
      const result = spawnSync(process.execPath, ["dist/readiness.mjs"], {
        env: config, encoding: "utf8", timeout: 7000,
      });
      assert.equal(result.error, undefined);
      assert.equal(result.status, 1);
      assert.equal(result.stdout.trim(), '{"database":"unavailable"}');
      assert.equal(result.stderr, "");
    }
  });

  test("readiness is bounded when a reachable socket never completes database handshake", async () => {
    const server = createServer(socket => socket.destroy());
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      // spawnSync blocks JS accepts, leaving the OS listening socket reachable
      // but unable to complete PostgreSQL negotiation until the probe exits.
      const port = (server.address() as { port: number }).port;
      const result = spawnSync(process.execPath, ["dist/readiness.mjs"], {
        env: { ...env, DATABASE_URL: `postgresql://unused:unused@127.0.0.1:${port}/unavailable` },
        encoding: "utf8", timeout: 7000,
      });
      assert.equal(result.error, undefined);
      assert.equal(result.status, 1);
      assert.equal(result.stdout.trim(), '{"database":"unavailable"}');
      assert.equal(result.stderr, "");
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
}
