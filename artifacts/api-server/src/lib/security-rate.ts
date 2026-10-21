import { createHash } from "node:crypto";
import type { RequestHandler } from "express";
import ipaddr from "ipaddr.js";
import { pool } from "@workspace/db";
import { fail } from "./auth-errors";

function setting(name: string, fallback: number, maximum: number) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new Error(`Invalid ${name}`);
  return value;
}
export const ratePolicy = {
  window: setting("SECURITY_RATE_WINDOW_SECONDS", 60, 3600),
  general: setting("SECURITY_RATE_GENERAL", 1200, 100000),
  lookup: setting("SECURITY_RATE_LOOKUP", 120, 10000),
  expensive: setting("SECURITY_RATE_EXPENSIVE", 30, 10000),
  sync: setting("SECURITY_RATE_SYNC", 240, 10000),
  authWindow: setting("AUTH_RATE_WINDOW_SECONDS", 900, 3600),
  authIp: setting("AUTH_RATE_IP", 100, 10000),
  authAccount: setting("AUTH_RATE_ACCOUNT", 20, 1000),
  authDevice: setting("AUTH_RATE_DEVICE", 30, 1000),
};
export function networkKey(ip: string | undefined): string {
  if (!ip || !ipaddr.isValid(ip)) return "unknown";
  const address = ipaddr.process(ip);
  // A host must not obtain new budgets by cycling addresses in its IPv6 /64.
  return address.kind() === "ipv6"
    ? address.toByteArray().slice(0, 8).map(v => v.toString(16).padStart(2, "0")).join("") + "/64"
    : address.toString();
}
/** PostgreSQL atomic fixed window: durable across processes/restarts, fail closed.
 * Saturation bounds the integer even under sustained rejected traffic. */
export async function consumeRate(key: string, limit: number, seconds: number) {
  const hash = createHash("sha256").update(key).digest("hex");
  const { rows: [row] } = await pool.query(`INSERT INTO operational.auth_throttles(key_digest,attempts)
    VALUES($1,1) ON CONFLICT(key_digest) DO UPDATE SET
      attempts=CASE WHEN operational.auth_throttles.window_started_at <= statement_timestamp()-$2*interval '1 second'
        THEN 1 ELSE LEAST(operational.auth_throttles.attempts+1,$3+1) END,
      window_started_at=CASE WHEN operational.auth_throttles.window_started_at <= statement_timestamp()-$2*interval '1 second'
        THEN statement_timestamp() ELSE operational.auth_throttles.window_started_at END
    RETURNING attempts,GREATEST(1,ceil(extract(epoch FROM window_started_at+$2*interval '1 second'-statement_timestamp())))::integer AS retry`,
  [hash, seconds, limit]);
  if (row.attempts > limit) throw fail(429, "RATE_LIMITED", "rateLimited", { retryAfterSeconds: row.retry });
}
export function sensitiveCategory(path: string) {
  let normalized: string;
  try { normalized = decodeURIComponent(path).toLowerCase().replace(/\/+$/, ""); }
  catch { throw fail(400, "VALIDATION", "validation"); }
  if (/^\/api\/sync(?:\/|$)/.test(normalized)) return "sync";
  if (/^\/api\/(?:network\/lookup|patients(?:\/duplicates)?|appointments\/availability)$/.test(normalized)) return "lookup";
  if (/^\/api\/(?:import(?:\/|$)|patients\/merge(?:\/|$)|kpis$|network\/health$|admin\/developer\/reset$|(?:admin\/)?audit$)/.test(normalized) ||
      /^\/api\/clinics\/[^/]+\/export$/.test(normalized)) return "expensive";
  return undefined;
}
export const securityRateLimit: RequestHandler = async (req, _res, next) => {
  try {
    const ip = networkKey(req.ip);
    await consumeRate(`general:${ip}`, ratePolicy.general, ratePolicy.window);
    const category = sensitiveCategory(req.path);
    if (category) await consumeRate(`${category}:${ip}`, ratePolicy[category], ratePolicy.window);
    next();
  } catch (error) { next(error); }
};
