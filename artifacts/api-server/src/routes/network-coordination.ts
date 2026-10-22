import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import { GetNetworkCoordinationResponse, GetNetworkCoordinationAccessResponse } from "@workspace/api-zod";
import { authenticateReadOnly, requireRoles, unauthorized, forbidden, type Auth } from "../lib/auth";
import { fail } from "../lib/auth-errors";
import { resultMetrics, resultsWindow } from "../adoption/results";

/** Fresh authorization under locks, not a cached capability or a clinical grant.
 * READ COMMITTED deliberately establishes the auth snapshot AFTER lock waits.
 * User then session matches administrative disable/recovery ordering.
 */
export async function coordination(auth: Auth, accessOnly = false) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock_shared(160005)");
    await client.query("SELECT id FROM operational.users WHERE id=$1 FOR SHARE", [auth.id]);
    await client.query("SELECT token_digest FROM operational.auth_sessions WHERE token_digest=$1 FOR SHARE", [auth.sessionDigest]);
    const { rows: [actor] } = await client.query(`SELECT u.id FROM operational.users u
      JOIN operational.auth_sessions s ON s.user_id=u.id
      JOIN operational.doctors d ON d.doctor_id=u.doctor_id AND d.clinic_id=u.clinic_id AND d.user_id=u.id
      WHERE u.id=$1 AND u.role='doctor' AND u.disabled_at IS NULL
        AND u.clinic_id=$3 AND u.doctor_id=$4
        AND s.token_digest=$2 AND s.revoked_at IS NULL
        AND s.last_seen_at>clock_timestamp()-interval '30 minutes'
        AND s.device_id IS NULL`, [auth.id, auth.sessionDigest, auth.clinicId, auth.doctorId]);
    if (!actor) throw unauthorized();
    const { rows } = await client.query<{ id: number; name: string; mode: "full" | "lite"; membershipStatus: string }>(`
      SELECT c.clinic_id AS id,c.clinic_name AS name,c.network_mode AS mode,c.membership_status AS "membershipStatus"
      FROM operational.network_coordinator_scope g JOIN operational.clinics c USING(clinic_id)
      WHERE g.user_id=$1 ORDER BY c.clinic_id`, [actor.id]);
    const allowed = rows.length > 0 && rows.some(row => row.id === auth.clinicId);
    if (accessOnly) {
      await client.query("COMMIT");
      return { canCoordinate: allowed };
    }
    if (!allowed) throw forbidden();
    const { rows: [clock] } = await client.query<{ at: Date }>("SELECT clock_timestamp() AS at");
    const window = resultsWindow(clock!.at);
    const clinics = [];
    for (const row of rows) {
      const metrics = await resultMetrics(client, window, row.id);
      // These observations never claim complete population coverage.
      const project = (metric: { available: boolean; value: number | null; sampleCount: number }) => ({
        value: metric.available ? metric.value : null, sampleCount: metric.sampleCount,
        coverage: metric.available ? "partial" as const : "unavailable" as const,
      });
      clinics.push({ ...row, metrics: {
        preventedConflicts: project(metrics.preventedBlocks),
        medianLookupSeconds: project(metrics.medianLookupSeconds),
      } });
    }
    const response = { asOf: clock!.at.toISOString(), period: { from: window.start, to: window.end, timeZone: "Asia/Hebron" as const }, clinics };
    await client.query("COMMIT");
    return response;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

const router: IRouter = Router();
router.use("/network/coordination", (_req, res, next) => { res.set("Cache-Control", "private, no-store"); next(); });
for (const accessOnly of [true, false]) {
  router.get(`/network/coordination${accessOnly ? "/access" : ""}`, authenticateReadOnly, requireRoles("doctor"), async (req, res) => {
    if (Object.keys(req.query).length) throw fail(400, "VALIDATION", "validation");
    const result = await coordination(req.auth!, accessOnly);
    const schema = accessOnly ? GetNetworkCoordinationAccessResponse : GetNetworkCoordinationResponse;
    if (!schema.safeParse(result).success) throw fail(500, "INTERNAL", "internal");
    res.json(result);
  });
}
export default router;
