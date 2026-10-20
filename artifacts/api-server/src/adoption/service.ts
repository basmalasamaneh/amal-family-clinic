import type { PoolClient, QueryResultRow } from "pg";
import { pool } from "@workspace/db";
import { forbidden, type Auth } from "../lib/auth";
import { fail } from "../lib/auth-errors";

export async function manager(client: PoolClient, auth: Auth, clinicId: number) {
  if (auth.clinicId !== clinicId || auth.role !== "doctor") throw forbidden();
  const { rows } = await client.query(`SELECT u.id FROM operational.users u
    JOIN operational.clinic_managers m ON m.user_id=u.id AND m.clinic_id=u.clinic_id
    JOIN operational.auth_sessions s ON s.user_id=u.id
    WHERE u.id=$1 AND u.clinic_id=$2 AND u.role='doctor' AND u.disabled_at IS NULL
    AND s.token_digest=$3 AND s.revoked_at IS NULL
    AND s.last_seen_at>now()-interval '30 minutes' FOR SHARE OF u,s`,
  [auth.id, clinicId, auth.sessionDigest]);
  if (!rows.length) throw forbidden();
}
export function adoption(row: QueryResultRow, canManage: boolean) {
  const iso = (value: Date | null) => value?.toISOString() ?? null;
  return {
    clinicId: row.clinic_id, state: row.adoption_state, membershipStatus: row.membership_status,
    changedAt: iso(row.adoption_changed_at), trialStartedAt: iso(row.trial_started_at),
    liteStartedAt: iso(row.lite_started_at), fullStartedAt: iso(row.full_started_at),
    leftAt: iso(row.left_at), leftBy: row.left_by,
    capabilities: { canManage, canExport: canManage, canLeave: canManage && row.membership_status === "active",
      localBooking: true, networkSharing: row.network_mode === "full" },
    allowedTransitions: !canManage || row.membership_status === "left" ? [] :
      row.adoption_state === "trial" ? ["lite", "full"] : row.adoption_state === "lite" ? ["full"] : ["lite"],
  };
}
export async function lifecycleTransaction<T>(work: (client: PoolClient) => Promise<T>, snapshot = false) {
  const client = await pool.connect();
  const sessionLocks: number[] = [];
  let discard = false;
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout='15s'");
    // The same cross-instance ordering used by protected clinical and scheduling reads.
    for (const key of [160005, 761910]) {
      if (snapshot) {
        // Session locks survive the short acquisition transaction. Starting
        // REPEATABLE READ before a blocking SELECT would freeze a stale snapshot
        // before a waiting delegation revocation or leave has committed.
        sessionLocks.push(key);
        await client.query("SELECT pg_advisory_lock($1)", [key]);
      } else {
        await client.query("SELECT pg_advisory_xact_lock($1)", [key]);
      }
    }
    if (snapshot) {
      await client.query("COMMIT");
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
      await client.query("SET LOCAL statement_timeout='15s'");
    }
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { discard = true; }
    if (["40001","40P01","57014"].includes((error as {code?:string}).code ?? ""))
      throw fail(409, "LIFECYCLE_RETRY", "lifecycleRetry");
    throw error;
  } finally {
    try {
      if (!discard) {
        for (const key of sessionLocks.reverse()) {
          await client.query("SELECT pg_advisory_unlock($1)", [key]);
        }
      }
    } catch (error) {
      discard = true;
      throw error;
    } finally {
      // Never return a connection with uncertain session-lock ownership.
      client.release(discard);
    }
  }
}
export async function state(client: PoolClient, clinicId: number) {
  const { rows: [row] } = await client.query("SELECT * FROM operational.clinics WHERE clinic_id=$1 FOR UPDATE", [clinicId]);
  if (!row) throw fail(404,"NOT_FOUND","notFound");
  return row;
}
export async function transition(client: PoolClient, auth: Auth, clinicId: number, target: "lite" | "full" | "left") {
  await manager(client, auth, clinicId);
  const row = await state(client, clinicId);
  if (row.membership_status === "left") {
    if (target === "left") return adoption(row,true);
    throw fail(409,"CLINIC_LEFT","clinicLeft");
  }
  if (target === row.adoption_state) return adoption(row,true);
  const leaving = target === "left";
  const next = leaving ? "lite" : target;
  const { rows: [updated] } = await client.query(`UPDATE operational.clinics
    SET adoption_state=$2::text,network_mode=$2::text::operational.network_mode,adoption_changed_at=clock_timestamp(),
      membership_status=CASE WHEN $3 THEN 'left' ELSE membership_status END,
      left_at=CASE WHEN $3 THEN clock_timestamp() ELSE left_at END,
      left_by=CASE WHEN $3 THEN $4 ELSE left_by END,
      lite_started_at=CASE WHEN $2::text='lite' THEN clock_timestamp() ELSE lite_started_at END,
      full_started_at=CASE WHEN $2::text='full' THEN clock_timestamp() ELSE full_started_at END
    WHERE clinic_id=$1 RETURNING *`, [clinicId,next,leaving,auth.id]);
  await client.query(`INSERT INTO operational.audit_log(user_id,clinic_id,action,detail)
    VALUES($1,$2,$3,$4::jsonb)`, [auth.id,clinicId,leaving ? "clinic.left" : "clinic.adoption.changed",
    JSON.stringify({from:row.adoption_state,to:next,membershipStatus:updated.membership_status})]);
  return adoption(updated,true);
}
