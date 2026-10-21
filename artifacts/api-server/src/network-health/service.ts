import type { PoolClient } from "pg";
import { z } from "zod/v4";
import { pool } from "@workspace/db";
import { type Auth, forbidden } from "../lib/auth";
import { fail } from "../lib/auth-errors";
import { currentAuth } from "../appointments/service";

export const heartbeatInput = z.object({
  sequence: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  unsubmittedOperationCount: z.number().int().min(0).max(1000000),
}).strict();

export function heartbeatTimeoutSeconds() {
  const seconds = Number(process.env.NETWORK_HEARTBEAT_TIMEOUT_SECONDS ?? 120);
  if (!Number.isInteger(seconds) || seconds < 10 || seconds > 86400) throw new Error("Invalid NETWORK_HEARTBEAT_TIMEOUT_SECONDS (10..86400)");
  return seconds;
}

/** Retain both row locks until commit, serializing telemetry/sync with revocation. */
export async function lockNetworkDevice(client: Pick<PoolClient, "query">, auth: Auth) {
  if (!auth.device || auth.device.clinicId !== auth.clinicId) throw forbidden();
  const { rows: [device] } = await client.query(`SELECT d.id FROM operational.devices d
    JOIN operational.auth_devices a ON a.device_id=d.id
    WHERE d.id=$1 AND d.clinic_id=$2 AND a.revoked_at IS NULL FOR UPDATE OF a,d`,
  [auth.device.id, auth.clinicId]);
  if (!device) throw fail(403, "DEVICE_UNTRUSTED", "deviceUntrusted");
  return device.id as number;
}

/** Only the existing successful push transaction calls this; never accepts client time. */
export async function recordSuccessfulSync(client: Pick<PoolClient, "query">, deviceId: number) {
  await client.query(`INSERT INTO operational.device_network_health(device_id,last_successful_sync_at)
    VALUES($1,clock_timestamp()) ON CONFLICT(device_id) DO UPDATE
    SET last_successful_sync_at=clock_timestamp()`, [deviceId]);
}

export async function heartbeat(auth: Auth, raw: unknown) {
  const input = heartbeatInput.parse(raw);
  const timeout = heartbeatTimeoutSeconds();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const deviceId = await lockNetworkDevice(client, auth);
    // Recheck expiry and binding after waiting for revocation/device locks.
    await client.query("SELECT token_digest FROM operational.auth_sessions WHERE token_digest=$1 FOR SHARE", [auth.sessionDigest]);
    const actor = await currentAuth(client, auth);
    if (!actor.device || !["doctor", "front-desk"].includes(actor.role)) throw forbidden();
    const { rows: [receipt] } = await client.query(`INSERT INTO operational.device_network_health
      (device_id,heartbeat_sequence,last_heartbeat_at,unsubmitted_operation_count)
      VALUES($1,$2,clock_timestamp(),$3) ON CONFLICT(device_id) DO UPDATE
      SET heartbeat_sequence=$2,last_heartbeat_at=clock_timestamp(),unsubmitted_operation_count=$3
      WHERE operational.device_network_health.heartbeat_sequence IS NULL
        OR operational.device_network_health.heartbeat_sequence < $2
      RETURNING last_heartbeat_at`, [deviceId, input.sequence, input.unsubmittedOperationCount]);
    if (!receipt) throw fail(409, "HEARTBEAT_REPLAY", "conflict");
    await client.query("COMMIT");
    return { deviceId, clinicId: actor.clinicId!, sequence: input.sequence,
      receivedAt: receipt.last_heartbeat_at.toISOString() as string, heartbeatTimeoutSeconds: timeout };
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

type DeviceRow = {
  id: number; clinic_id: number; label: string; credential_digest: string | null; revoked_at: Date | null;
  heartbeat_sequence: string | null; last_heartbeat_at: Date | null; last_successful_sync_at: Date | null;
  unsubmitted_operation_count: number | null;
};
const iso = (date: Date | null) => date?.toISOString() ?? null;
const latest = (dates: (string | null)[]) => dates.filter((d): d is string => d !== null).sort().at(-1) ?? null;

export async function networkHealth(auth: Auth) {
  const timeout = heartbeatTimeoutSeconds();
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const actor = await currentAuth(client, auth);
    if (actor.role !== "admin") throw forbidden();
    const { rows: [clock] } = await client.query<{ now: Date }>("SELECT clock_timestamp() AS now");
    const { rows: clinics } = await client.query<{ clinic_id: number; clinic_name: string; network_mode: "full" | "lite" }>(
      `SELECT clinic_id,clinic_name,network_mode FROM operational.clinics
        WHERE ($1::integer IS NULL OR clinic_id=$1) ORDER BY clinic_id`, [actor.clinicId]);
    const { rows: devices } = await client.query<DeviceRow>(`SELECT d.id,d.clinic_id,d.label,a.credential_digest,a.revoked_at,
      h.heartbeat_sequence,h.last_heartbeat_at,h.last_successful_sync_at,h.unsubmitted_operation_count
      FROM operational.devices d LEFT JOIN operational.auth_devices a ON a.device_id=d.id
      LEFT JOIN operational.device_network_health h ON h.device_id=d.id
      WHERE ($1::integer IS NULL OR d.clinic_id=$1) ORDER BY d.id`, [actor.clinicId]);
    const { rows: conflicts } = await client.query<{ clinic_id: number; count: number }>(
      `SELECT clinic_id,count(*)::integer AS count FROM operational.sync_conflicts
        WHERE status='open' AND ($1::integer IS NULL OR clinic_id=$1) GROUP BY clinic_id`, [actor.clinicId]);
    const result = clinics.map(clinic => {
      const local = devices.filter(d => d.clinic_id === clinic.clinic_id).map(d => {
        const trustStatus = !d.credential_digest ? "untrusted" as const : d.revoked_at ? "revoked" as const : "trusted" as const;
        const fresh = trustStatus === "trusted" && d.last_heartbeat_at !== null &&
          d.last_heartbeat_at.getTime() <= clock.now.getTime() &&
          d.last_heartbeat_at.getTime() > clock.now.getTime() - timeout * 1000;
        return { deviceId: d.id, label: d.label, trustStatus, connectivity: fresh ? "online" as const : "offline" as const,
          lastHeartbeatAt: iso(d.last_heartbeat_at), lastSuccessfulSyncAt: iso(d.last_successful_sync_at),
          heartbeatSequence: d.heartbeat_sequence === null ? null : Number(d.heartbeat_sequence),
          unsubmittedOperationCount: fresh ? d.unsubmitted_operation_count : null };
      });
      const trusted = local.filter(d => d.trustStatus === "trusted");
      const freshDeviceCount = trusted.filter(d => d.connectivity === "online").length;
      const unknownTrustedCount = trusted.filter(d => d.lastHeartbeatAt === null).length;
      const unknownDeviceCount = unknownTrustedCount + local.filter(d => d.trustStatus === "untrusted").length;
      // No devices is unknown, not an observed empty queue. Never add persisted conflicts to local counts.
      const complete = trusted.length > 0 && freshDeviceCount === trusted.length &&
        local.every(d => d.trustStatus !== "untrusted");
      return { clinicId: clinic.clinic_id, clinicName: clinic.clinic_name, networkMode: clinic.network_mode,
        connectivity: freshDeviceCount > 0 ? "online" as const : "offline" as const,
        lastHeartbeatAt: latest(local.map(d => d.lastHeartbeatAt)),
        lastSuccessfulSyncAt: latest(local.map(d => d.lastSuccessfulSyncAt)),
        serverOpenConflictCount: conflicts.find(c => c.clinic_id === clinic.clinic_id)?.count ?? 0,
        unsubmittedOperationCount: complete ? trusted.reduce((n, d) => n + d.unsubmittedOperationCount!, 0) : null,
        queueCoverage: { registeredDeviceCount: local.length, trustedDeviceCount: trusted.length, freshDeviceCount,
          staleDeviceCount: trusted.length - freshDeviceCount - unknownTrustedCount, unknownDeviceCount,
          revokedDeviceCount: local.filter(d => d.trustStatus === "revoked").length, complete },
        devices: local };
    });
    await client.query("COMMIT");
    return { generatedAt: clock.now.toISOString(), heartbeatTimeoutSeconds: timeout, clinics: result };
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
