import type { Request, RequestHandler } from "express";
import pg from "pg";
import { pool } from "@workspace/db";
import { runtimeConnectionString } from "@workspace/db/runtime-connection";
import { fail } from "../lib/auth-errors";
import { developerToolsEnabled, getDemoGeneration } from "./reset";

// Separate admission connections prevent handlers from exhausting the normal
// query pool while waiting for their own queries. Both use the restricted login.
let gates: pg.Pool | undefined;
function gatePool() {
  return gates ??= new pg.Pool({ connectionString: runtimeConnectionString(), max: 16 });
}
export function recoveryRequest(req: Pick<Request, "path">) {
  return req.path === "/me" || req.path === "/healthz" || req.path === "/demo/context"
    || req.path.startsWith("/admin/developer/")
    || (req.path.startsWith("/auth/") && !req.path.startsWith("/auth/devices"));
}
export function exclusiveControl(req: Pick<Request, "path" | "method">) {
  return req.method === "POST" && req.path === "/admin/developer/reset"
    || req.method === "PUT" && /^\/admin\/developer\/clinics\/[1-9]\d*\/outage$/.test(req.path);
}
/**
 * Hold admission through handler completion, not socket close: a disconnected
 * request can still commit. Reset/outage activation wait for its real outcome.
 * Exclusive controls acquire the same lock in their own transaction.
 */
export const demoBoundary: RequestHandler = async (req, res, next) => {
  if (!developerToolsEnabled() || exclusiveControl(req)) { next(); return; }
  const client = await gatePool().connect();
  let released = false;
  const release = async () => {
    if (released) return;
    released = true;
    try { await client.query("SELECT pg_advisory_unlock_shared(761930)"); client.release(); }
    catch { client.release(true); }
  };
  try {
    await client.query("SELECT pg_advisory_lock_shared(761930)");
    const generation = await getDemoGeneration();
    res.set("X-Amal-Demo-Generation", generation);
    if (!recoveryRequest(req) && req.get("X-Amal-Demo-Generation") !== generation) {
      throw fail(409, "DEMO_RESET_REQUIRED", "demoResetRequired", { generation });
    }
    const end = res.end;
    // Never unlock on req/res 'close': that may precede a service COMMIT.
    res.end = function (...args: Parameters<typeof end>) {
      void release();
      return end.apply(res, args);
    } as typeof res.end;
    next();
  } catch (error) { await release(); next(error); }
};

/** Called only after authenticated clinic authority was established. */
export async function checkClinicOutage(req: Request) {
  // req.path is relative to a router mount, so use the original API pathname.
  const path = req.originalUrl.split("?")[0].replace(/^\/api/, "") || "/";
  if (!developerToolsEnabled() || recoveryRequest({ path }) || !req.auth?.clinicId) return;
  const { rows } = await pool.query("SELECT 1 FROM operational.developer_outages WHERE clinic_id=$1", [req.auth.clinicId]);
  if (rows.length) throw fail(503, "CLINIC_OUTAGE", "clinicOutage", { retryAfterSeconds: 5 });
}

export async function closeDemoBoundary() { await gates?.end(); gates = undefined; }
