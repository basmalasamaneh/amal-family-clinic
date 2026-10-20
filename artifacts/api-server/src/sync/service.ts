import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { type Auth, forbidden } from "../lib/auth";
import { ApiError, fail } from "../lib/auth-errors";
import { bookingScope, createAppointment, existing, project, record, replay, transaction, updateAppointment } from "../appointments/service";
import { pushInput, resolveInput } from "./validation";
import { patientScopeSql } from "../lib/patient-access";

export async function requireSyncDevice(client: Pick<PoolClient, "query">, actor: Auth) {
  if (!actor.device || !["doctor", "front-desk"].includes(actor.role)) throw forbidden();
  const { rows: [device] } = await client.query(`SELECT d.id FROM operational.devices d
    JOIN operational.auth_devices a ON a.device_id=d.id
    WHERE d.id=$1 AND d.clinic_id=$2 AND a.revoked_at IS NULL`, [actor.device.id, actor.clinicId]);
  if (!device) throw fail(403, "DEVICE_UNTRUSTED", "deviceUntrusted");
  return device.id as number;
}
const envelope = (e: ApiError) => ({ code: e.code, messageKey: `error.${e.key}`, params: e.params });

/** Read-only sequence bootstrap; device identity comes from the trusted cookie. */
export async function syncDeviceState(auth: Auth) {
  return transaction(auth, async (client, actor) => {
    const deviceId = await requireSyncDevice(client, actor);
    const { rows: [stream] } = await client.query(
      "SELECT COALESCE(max(sequence),0)::integer + 1 AS next FROM operational.sync_device_operations WHERE device_id=$1", [deviceId]);
    return { deviceId, nextSequence: stream.next as number };
  });
}

export async function pushSync(auth: Auth, raw: unknown) {
  const input = pushInput.parse(raw);
  return transaction(auth, async (client, actor, now) => {
    const deviceId = await requireSyncDevice(client, actor);
    const outcomes: Record<string, unknown>[] = [];
    let blocked = false;
    for (const operation of input.operations) {
      const base = { sequence: operation.sequence, clientOpId: operation.input.clientOpId };
      if (blocked) { outcomes.push({ ...base, status: "blocked", code: "PREDECESSOR_UNRESOLVED", messageKey: "error.conflict", params: {} }); continue; }
      const { rows: [receipt] } = await client.query(`SELECT client_op_id FROM operational.sync_device_operations
        WHERE device_id=$1 AND sequence=$2`, [deviceId, operation.sequence]);
      if (receipt && receipt.client_op_id !== operation.input.clientOpId) {
        outcomes.push({ ...base, status: "rejected", error: envelope(fail(409, "SEQUENCE_REUSE", "conflict")) }); blocked = true; continue;
      }
      if (!receipt) {
        const { rows: [stream] } = await client.query(`SELECT COALESCE(max(sequence),0)::integer AS last FROM operational.sync_device_operations WHERE device_id=$1`, [deviceId]);
        if (operation.sequence !== stream.last + 1) {
          outcomes.push({ ...base, status: "blocked", code: "SEQUENCE_GAP", messageKey: "error.conflict", params: {}, expectedSequence: stream.last + 1 }); blocked = true; continue;
        }
        const { rows: [unresolved] } = await client.query(`SELECT 1 FROM operational.sync_device_operations d
          JOIN operational.appointment_operations o USING(client_op_id)
          LEFT JOIN operational.sync_conflicts c ON c.id=o.conflict_id
          WHERE d.device_id=$1 AND (c.status='open' OR o.status='rejected') LIMIT 1`, [deviceId]);
        if (unresolved) { outcomes.push({ ...base, status: "blocked", code: "PREDECESSOR_UNRESOLVED", messageKey: "error.conflict", params: {} }); blocked = true; continue; }
        const { rows: [duplicate] } = await client.query("SELECT 1 FROM operational.sync_device_operations WHERE device_id=$1 AND client_op_id=$2", [deviceId, operation.input.clientOpId]);
        if (duplicate) {
          outcomes.push({ ...base, status: "rejected", error: envelope(fail(409, "SEQUENCE_REUSE", "conflict")) }); blocked = true; continue;
        }
      }
      let outcome: Record<string, unknown>;
      try {
        const context = { client, actor, now };
        const result = operation.type === "create"
          ? await createAppointment(actor, operation.input, context)
          : await updateAppointment(actor, operation.appointmentId, operation.input, context);
        outcome = { ...base, status: "applied", result };
      } catch (error) {
        if (!(error instanceof ApiError)) throw error; // Transient errors roll back the batch, safe to retry.
        const { rows: [op] } = await client.query("SELECT * FROM operational.appointment_operations WHERE client_op_id=$1", [operation.input.clientOpId]);
        if ("operationId" in error && "operationHash" in error &&
          error.operationId === operation.input.clientOpId && error.operationHash === op?.payload_hash &&
          op?.actor_id === actor.id && ["conflict", "rejected"].includes(op.status)) {
          bookingScope(actor, op.clinic_id, op.doctor_id);
          const { httpStatus: _httpStatus, ...publicResult } = op.result;
          outcome = op.status === "conflict" ? { ...base, status: "conflict", ...publicResult }
            : { ...base, status: "rejected", error: publicResult };
          if (op.status === "rejected") blocked = true;
          else {
            const { rows: [state] } = await client.query("SELECT status FROM operational.sync_conflicts WHERE id=$1", [op.conflict_id]);
            blocked = state?.status !== "resolved";
          }
        } else {
          outcomes.push({ ...base, status: "rejected", error: envelope(error) }); blocked = true; continue;
        }
      }
      if (!receipt) await client.query(`INSERT INTO operational.sync_device_operations(device_id,sequence,client_op_id) VALUES($1,$2,$3)`,
        [deviceId, operation.sequence, operation.input.clientOpId]);
      outcomes.push(outcome);
    }
    return { outcomes };
  });
}

export async function resolveSync(auth: Auth, raw: unknown) {
  const input = resolveInput.parse(raw);
  return transaction(auth, async (client, actor, now) => {
    await requireSyncDevice(client, actor);
    const { rows: [conflict] } = await client.query("SELECT * FROM operational.sync_conflicts WHERE id=$1 FOR UPDATE", [input.conflictId]);
    if (!conflict) throw fail(404, "NOT_FOUND", "notFound");
    bookingScope(actor, conflict.clinic_id, conflict.doctor_id);
    if (conflict.actor_id !== actor.id) throw forbidden();
    const proposal = conflict.operation.payload;
    const patientId = conflict.target_id ? (await existing(client, actor, conflict.target_id)).patient_id : proposal.patientId;
    const { rows: [patient] } = await client.query(`SELECT p.phone FROM operational.patients p
      WHERE p.patient_id=$2 AND ${patientScopeSql("$1")}`, [conflict.clinic_id, patientId]);
    if (!patient) throw forbidden();
    if (input.action === "move-other") await existing(client, actor, input.otherAppointmentId);
    const { hash, op } = await replay(client, actor, input.clientOpId, `resolve:${input.conflictId}`, input);
    if (op) return op.result;
    if (conflict.version !== input.expectedVersion || conflict.status !== "open") throw fail(409, "VERSION_CONFLICT", "conflict", { currentVersion: conflict.version });
    let result: Record<string, unknown>;
    await client.query("SAVEPOINT sync_resolution");
    try {
      if (input.action === "call") {
        result = { status: "follow-up", conflictId: conflict.id, patientId, phone: patient.phone, called: false };
      } else {
        const context = { client, actor, now };
        if (input.action === "move-other") {
          if (input.otherAppointmentId === conflict.target_id) throw fail(400, "VALIDATION", "validation");
          if (!conflict.reasons.some((reason: { with?: { appointmentId?: number } }) =>
            reason.with?.appointmentId === input.otherAppointmentId)) throw fail(400, "UNRELATED_APPOINTMENT", "validation");
          const other = await existing(client, actor, input.otherAppointmentId);
          const target = conflict.target_id ? project(await existing(client, actor, conflict.target_id)) : null;
          const candidate = { ...target, ...proposal };
          if (!["booked", "double_booked"].includes(other.status) ||
            (other.doctor_id !== conflict.doctor_id && other.patient_id !== patientId) ||
            other.scheduled_at.getTime() >= Date.parse(candidate.endsAt) ||
            Date.parse(candidate.startsAt) >= other.scheduled_at.getTime() + other.duration_minutes * 60000) {
            throw fail(409, "CONFLICT_CHANGED", "conflict");
          }
          await updateAppointment(actor, input.otherAppointmentId, {
            clientOpId: randomUUID(), expectedVersion: input.otherExpectedVersion,
            startsAt: input.startsAt, endsAt: input.endsAt, overrideReason: input.overrideReason,
          }, context);
        }
        // Never reuse an offline hold: it conveys no guarantee during explicit resolution.
        const { holdToken: _hold, clientOpId: _id, ...values } = proposal;
        const changes = input.action === "move-self" ? { startsAt: input.startsAt, endsAt: input.endsAt } : {};
        let appointment;
        if (conflict.target_id) {
          const row = await existing(client, actor, conflict.target_id);
          if (input.targetExpectedVersion === undefined) throw fail(400, "VALIDATION", "validation");
          if (row.version !== input.targetExpectedVersion) throw fail(409, "VERSION_CONFLICT", "conflict", { currentVersion: row.version });
          appointment = await updateAppointment(actor, conflict.target_id, { ...values, ...changes,
            expectedVersion: input.targetExpectedVersion, clientOpId: randomUUID(),
            overrideReason: input.overrideReason ?? values.overrideReason }, context);
        } else {
          appointment = await createAppointment(actor, { ...values, ...changes, clientOpId: randomUUID(),
            overrideReason: input.overrideReason ?? values.overrideReason }, context);
        }
        result = { status: "resolved", conflictId: conflict.id, appointment };
      }
      await client.query("RELEASE SAVEPOINT sync_resolution");
    } catch (error) {
      await client.query("ROLLBACK TO SAVEPOINT sync_resolution");
      if (!(error instanceof ApiError) || ![400, 409, 422].includes(error.status)) throw error;
      result = { status: "open", conflictId: conflict.id, error: envelope(error) };
    }
    await client.query(`UPDATE operational.sync_conflicts SET status=$2,version=version+1,updated_at=clock_timestamp() WHERE id=$1`,
      [conflict.id, result.status === "resolved" ? "resolved" : "open"]);
    result.version = conflict.version + 1;
    await record(client, actor, input.clientOpId, conflict.clinic_id, conflict.doctor_id, hash, result);
    await client.query("UPDATE operational.appointment_operations SET request=$2,device_id=$3 WHERE client_op_id=$1",
      [input.clientOpId, JSON.stringify({ target: `resolve:${conflict.id}`, payload: input }), actor.device!.id]);
    await client.query(`INSERT INTO operational.sync_resolution_history(conflict_id,client_op_id,actor_id,action,result) VALUES($1,$2,$3,$4,$5)`,
      [conflict.id, input.clientOpId, actor.id, input.action, JSON.stringify(result)]);
    await client.query(`INSERT INTO operational.audit_log(user_id,clinic_id,patient_id,action,detail)
      VALUES($1,$2,$3,'sync.conflict_resolution',$4)`,
      [actor.id, conflict.clinic_id, patientId, JSON.stringify({
        conflictId: conflict.id, clientOpId: input.clientOpId, action: input.action,
        status: result.status, version: result.version,
      })]);
    return result;
  });
}
