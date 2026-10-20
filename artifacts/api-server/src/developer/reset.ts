import { randomUUID } from "node:crypto";
import pg from "pg";
import { pool } from "@workspace/db";
import { resetConnectionString } from "@workspace/db/reset-connection";
import { clearOperational } from "../../../../scripts/src/demo-reset";
import { populate } from "../../../../scripts/src/demo-populate";
import { transaction } from "../../../../scripts/src/operational-support";
import { extractVisitInTransaction } from "../alerts/service";

export function developerToolsEnabled() {
  return process.env.AMAL_DEVELOPER_TOOLS === "1"
    && process.env.NODE_ENV !== "production" && process.env.REPLIT_DEPLOYMENT !== "1";
}
export class DemoResetError extends Error {
  constructor(public readonly status: number, public readonly code: string) { super(code); }
}
function guard() {
  if (!developerToolsEnabled()) throw new DemoResetError(403, "DEVELOPER_TOOLS_DISABLED");
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function validateUuid(value: string) {
  if (!uuid.test(value)) throw new DemoResetError(400, "INVALID_REQUEST");
}
export interface ResetReceipt {
  requestId: string;
  previousGeneration: string;
  generation: string;
  completedAt: string;
  reauthenticationRequired: true;
}
function receipt(row: pg.QueryResultRow): ResetReceipt {
  return { requestId: row.request_id, previousGeneration: row.previous_generation,
    generation: row.generation, completedAt: new Date(row.completed_at).toISOString(),
    reauthenticationRequired: true };
}
export async function getDemoGeneration(): Promise<string> {
  guard();
  const { rows: [state] } = await pool.query("SELECT generation FROM operational_meta.demo_state WHERE singleton");
  if (!state) throw new DemoResetError(503, "DEVELOPER_TOOLS_NOT_READY");
  return state.generation;
}
/** Caller must authenticate an administrator, including after reset re-login.
 * This read never performs a reset; receipt IDs cannot be used as credentials. */
export async function getResetReceipt(requestId: string): Promise<ResetReceipt | null> {
  guard();
  validateUuid(requestId);
  const { rows: [row] } = await pool.query("SELECT * FROM operational_meta.demo_reset_receipts WHERE request_id=$1", [requestId]);
  return row ? receipt(row) : null;
}
export interface ResetInput {
  requestId: string;
  expectedGeneration: string;
  actor: { id: number; sessionDigest: string };
}
export async function resetDemo(input: ResetInput): Promise<ResetReceipt> {
  guard();
  validateUuid(input.requestId);
  validateUuid(input.expectedGeneration);
  // Not an administrator connection with SET ROLE: this authenticates directly
  // as an isolated LOGIN with ordinary app access plus audit-delete capability.
  const client = new pg.Client({ connectionString: resetConnectionString() });
  await client.connect();
  try {
    const { rows: [identity] } = await client.query("SELECT session_user");
    if (identity.session_user !== "amal_reset_login") throw new DemoResetError(503, "UNSAFE_RESET_IDENTITY");
    return await transaction(client, async () => {
      // transaction takes exclusive 761930 before any population/table locks.
      // Recheck authorization after waiting: another reset may delete sessions.
      const { rows: [actor] } = await client.query(`SELECT u.id FROM operational.users u
        JOIN operational.auth_sessions s ON s.user_id=u.id
        WHERE u.id=$1 AND s.token_digest=$2 AND u.role='administrator'
        AND u.clinic_id IS NULL AND u.disabled_at IS NULL AND s.revoked_at IS NULL
        AND s.last_seen_at>clock_timestamp()-interval '30 minutes' FOR SHARE OF u,s`,
      [input.actor.id, input.actor.sessionDigest]);
      if (!actor) throw new DemoResetError(401, "UNAUTHENTICATED");
      const { rows: [previous] } = await client.query(
        "SELECT * FROM operational_meta.demo_reset_receipts WHERE request_id=$1", [input.requestId]);
      if (previous) {
        if (previous.previous_generation !== input.expectedGeneration.toLowerCase()) {
          throw new DemoResetError(409, "RESET_REQUEST_REUSED");
        }
        return receipt(previous);
      }
      const { rows: [state] } = await client.query("SELECT generation FROM operational_meta.demo_state WHERE singleton FOR UPDATE");
      if (!state) throw new DemoResetError(503, "DEVELOPER_TOOLS_NOT_READY");
      if (state.generation !== input.expectedGeneration.toLowerCase()) {
        throw new DemoResetError(409, "DEMO_RESET_REQUIRED");
      }
      await clearOperational(client);
      await populate(client, { restrictedReset: true });
      // Reuse the normal generated-alert extraction, inside this transaction.
      const visits = await client.query("SELECT visit_id FROM operational.patient_visit_history ORDER BY visit_id");
      for (const visit of visits.rows) await extractVisitInTransaction(client, visit.visit_id);
      const generation = randomUUID();
      await client.query("UPDATE operational_meta.demo_state SET generation=$1,changed_at=clock_timestamp() WHERE singleton", [generation]);
      const { rows: [saved] } = await client.query(`INSERT INTO operational_meta.demo_reset_receipts
        (request_id,previous_generation,generation) VALUES($1,$2,$3) RETURNING *`,
      [input.requestId, state.generation, generation]);
      // Seeds are fingerprinted before/after by transaction(); failed checks,
      // deferred constraints and extraction failures roll back state and receipt.
      return receipt(saved);
    });
  } finally { await client.end(); }
}
