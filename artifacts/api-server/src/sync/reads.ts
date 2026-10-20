import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod/v4";
import type { Auth } from "../lib/auth";
import { forbidden } from "../lib/auth";
import { fail } from "../lib/auth-errors";
import { canonical, projectStoredOperationResult, transaction } from "../appointments/service";

const page = { limit: z.coerce.number().int().min(1).max(100).default(25) };
const pullInput = z.object({ ...page, since: z.string().max(2048).optional() }).strict();
const conflictsInput = z.object({
  ...page, status: z.enum(["open", "resolved", "all"]).default("open"),
  cursor: z.string().max(2048).optional(),
}).strict();
const cursorSchema = z.object({
  v: z.literal(1), kind: z.enum(["pull", "conflicts"]), scope: z.string(),
  after: z.string(), filter: z.string(),
}).strict();
type Cursor = z.infer<typeof cursorSchema>;
function scope(actor: Auth) {
  if (!["doctor", "front-desk"].includes(actor.role) || !actor.clinicId ||
    (actor.role === "doctor" && !actor.doctorId)) throw forbidden();
  return createHash("sha256").update(canonical({
    actor: actor.id, role: actor.role, clinic: actor.clinicId, doctor: actor.doctorId,
    device: actor.device?.id ?? null, session: actor.sessionDigest,
  })).digest("hex");
}
function signature(body: string) {
  if (!process.env.SESSION_SECRET) throw new Error("SESSION_SECRET required for sync cursors");
  return createHmac("sha256", process.env.SESSION_SECRET).update(`amal-sync-cursor:${body}`).digest();
}
function encode(value: Cursor) {
  const body = Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${body}.${signature(body).toString("base64url")}`;
}
function decode(raw: string | undefined, expected: Omit<Cursor, "after">, initial: string): Cursor {
  if (!raw) return { ...expected, after: initial };
  let value: Cursor;
  try {
    const parts = raw.split(".");
    if (parts.length !== 2 || !parts.every(p => /^[A-Za-z0-9_-]+$/.test(p))) throw new Error();
    const supplied = Buffer.from(parts[1]!, "base64url"), actual = signature(parts[0]!);
    if (supplied.length !== actual.length || !timingSafeEqual(supplied, actual)) throw new Error();
    value = cursorSchema.parse(JSON.parse(Buffer.from(parts[0]!, "base64url").toString("utf8")));
  } catch { throw fail(400, "INVALID_CURSOR", "invalidCursor"); }
  if (value.scope !== expected.scope) throw fail(409, "CURSOR_SCOPE_CHANGED", "cursorScopeChanged");
  if (value.kind !== expected.kind || value.filter !== expected.filter) throw fail(400, "INVALID_CURSOR", "invalidCursor");
  return value;
}
function schedulingProjection(payload: Record<string, unknown>) {
  return {
    ...payload,
    startsAt: new Date(String(payload.startsAt)).toISOString(),
    endsAt: new Date(String(payload.endsAt)).toISOString(),
  };
}

/** IDs are allocated while holding the writer lock until commit. Never page by timestamps. */
export async function pullSync(auth: Auth, raw: unknown) {
  const input = pullInput.parse(raw);
  return transaction(auth, async (client, actor) => {
    const cursor = decode(input.since, { v: 1, kind: "pull", scope: scope(actor), filter: "" }, "0");
    if (!/^(0|[1-9][0-9]{0,18})$/.test(cursor.after) || BigInt(cursor.after) > 9223372036854775807n)
      throw fail(400, "INVALID_CURSOR", "invalidCursor");
    const { rows } = await client.query(`SELECT id::text,kind,entity_id,payload FROM operational.sync_changes
      WHERE clinic_id=$1 AND ($2::integer IS NULL OR doctor_id=$2)
        AND (kind='appointment' OR (payload->>'actorId')::integer=$3)
        AND id>$4::bigint ORDER BY id LIMIT $5`,
    [actor.clinicId, actor.role === "doctor" ? actor.doctorId : null, actor.id, cursor.after, input.limit + 1]);
    const delivered = rows.slice(0, input.limit);
    const since = encode({ ...cursor, after: delivered.at(-1)?.id ?? cursor.after });
    return {
      changes: delivered.map(row => ({
        id: row.id as string, kind: row.kind as "appointment" | "conflict", entityId: row.entity_id as string,
        payload: row.kind === "appointment" ? schedulingProjection(row.payload) : row.payload,
      })),
      nextCursor: rows.length > input.limit ? since : null, since,
    };
  });
}

export async function listSyncConflicts(auth: Auth, raw: unknown) {
  const input = conflictsInput.parse(raw);
  return transaction(auth, async (client, actor) => {
    const cursor = decode(input.cursor, { v: 1, kind: "conflicts", scope: scope(actor), filter: input.status }, "0");
    if (!/^(0|[1-9][0-9]{0,18})$/.test(cursor.after) || BigInt(cursor.after) > 9223372036854775807n)
      throw fail(400, "INVALID_CURSOR", "invalidCursor");
    const { rows } = await client.query(`SELECT c.*, first_change.receipt::text AS receipt FROM operational.sync_conflicts c
      JOIN LATERAL (SELECT min(id) AS receipt FROM operational.sync_changes
        WHERE kind='conflict' AND entity_id=c.id::text) first_change ON true
      WHERE actor_id=$1 AND c.clinic_id=$2 AND ($3::integer IS NULL OR c.doctor_id=$3)
        AND ($4='all' OR status=$4) AND first_change.receipt>$5::bigint
      ORDER BY first_change.receipt LIMIT $6`, [actor.id, actor.clinicId, actor.role === "doctor" ? actor.doctorId : null,
      input.status, cursor.after, input.limit + 1]);
    const selected = rows.slice(0, input.limit);
    const items = [];
    for (const row of selected) {
      const { rows: history } = await client.query(`SELECT id::text,client_op_id,action,result,created_at
        FROM operational.sync_resolution_history WHERE conflict_id=$1 ORDER BY id`, [row.id]);
      // Preserve the durable original proposal, but do not return its hold capability.
      const { holdToken: _hold, ...proposal } = row.operation.payload;
      // Evidence was captured under the actor's former permissions. Re-check
      // references before returning it after a role/doctor-scope change.
      const reasons = [];
      for (const storedReason of row.reasons) {
        const { httpStatus: _httpStatus, ...reason } = storedReason;
        // Anonymous remote evidence cannot be reauthorized: the old redaction
        // discarded its source clinic. Do not expose its existence or the slots
        // computed from former cross-clinic occupancy, even to a Full clinic.
        if (reason.type === "same-day-other-clinic") continue;
        if (!reason.with) {
          if (!["patient-overlap", "doctor-overlap"].includes(reason.type)) reasons.push(projectStoredOperationResult({ ...reason,
            ...(reason.suggestedSlots ? { suggestedSlots: [] } : {}) }));
          continue;
        }
        const { rows: visible } = await client.query(`SELECT 1 FROM operational.appointments
          WHERE appointment_id=$1 AND clinic_id=$2 AND ($3::integer IS NULL OR doctor_id=$3)`,
        [reason.with.appointmentId, actor.clinicId, actor.role === "doctor" ? actor.doctorId : null]);
        if (!visible.length) continue;
        reasons.push({ ...reason, with: reason.with, suggestedSlots: [] });
      }
      items.push({
        id: row.id, clientOpId: row.client_op_id, operation: { target: row.operation.target, payload: proposal },
        targetId: row.target_id, baseVersion: row.base_version, serverState: row.server_state,
        reasons, status: row.status, version: row.version,
        createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(),
        history: history.map(item => {
          const { phone: _phone, ...result } = projectStoredOperationResult(item.result);
          return { id: item.id, clientOpId: item.client_op_id, action: item.action, result, createdAt: item.created_at.toISOString() };
        }),
      });
    }
    return { items, nextCursor: rows.length > input.limit ? encode({ ...cursor, after: selected.at(-1)!.receipt }) : null };
  });
}
