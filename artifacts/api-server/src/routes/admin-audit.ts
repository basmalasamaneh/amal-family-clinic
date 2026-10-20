import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { pool } from "@workspace/db";
import { ListAdminAuditResponse } from "@workspace/api-zod";
import { authenticateReadOnly, enforceScope, lockAdministration, requireRoles } from "../lib/auth";
import { fail } from "../lib/auth-errors";

// Deliberately exact: new actions are invisible until their privacy is reviewed.
const actions = [
  "admin.clinic.created", "admin.clinic.updated", "admin.doctor.created", "admin.doctor.updated",
  "admin.user.created", "admin.user.updated", "admin.user.deactivated", "admin.user.pin_reset",
  "auth.device.enrolled", "auth.device.revoked", "auth.login", "auth.logout",
  "auth.password.denied", "auth.pin.denied", "auth.pin.reauthenticated",
] as const;
const denied = ["auth.password.denied", "auth.pin.denied"];
const id = z.string().regex(/^[1-9]\d{0,9}$/).transform(Number).pipe(z.number().int().max(2147483647));
const querySchema = z.object({
  limit: id.pipe(z.number().max(100)).optional().default(25),
  beforeId: id.optional(), clinicId: id.optional(), actorId: id.optional(),
  action: z.enum(actions).optional(), outcome: z.enum(["success", "denied"]).optional(),
  from: z.iso.datetime({ offset: true }).optional(), to: z.iso.datetime({ offset: true }).optional(),
}).strict().refine(q => !q.from || !q.to || Date.parse(q.from) < Date.parse(q.to));

const router: IRouter = Router();
router.get("/admin/audit", authenticateReadOnly, requireRoles("admin"), async (req, res) => {
  res.set("Cache-Control", "no-store");
  const q = querySchema.parse(req.query);
  const auth = req.auth!;
  if (q.clinicId !== undefined) enforceScope(auth, q.clinicId);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await lockAdministration(client, auth);
    // Never SELECT detail (or patient_id). Extract only a bounded numeric target
    // for actions whose writer explicitly stores an administrative targetId.
    const { rows } = await client.query(`SELECT id,user_id AS "actorId",action,clinic_id AS "clinicId",
      CASE WHEN action LIKE 'admin.clinic.%' THEN 'clinic'
        WHEN action LIKE 'admin.doctor.%' THEN 'doctor'
        WHEN action LIKE 'admin.user.%' THEN 'user'
        WHEN action IN ('auth.device.enrolled','auth.device.revoked') THEN 'device'
        ELSE NULL END AS "targetType",
      CASE WHEN (action LIKE 'admin.%' OR action IN ('auth.device.enrolled','auth.device.revoked'))
        AND jsonb_typeof(detail->'targetId')='number'
        AND (detail->>'targetId') ~ '^[1-9][0-9]{0,9}$'
        THEN CASE WHEN (detail->>'targetId')::bigint<=2147483647 THEN (detail->>'targetId')::bigint ELSE NULL END
        ELSE NULL END AS "targetId",
      CASE WHEN action=ANY($2::text[]) THEN 'denied' ELSE 'success' END AS outcome,
      at AS "eventTime"
      FROM operational.audit_log
      WHERE patient_id IS NULL AND action=ANY($1::text[])
        AND ($3::integer IS NULL OR clinic_id=$3)
        AND ($4::integer IS NULL OR id<$4)
        AND ($5::integer IS NULL OR user_id=$5)
        AND ($6::text IS NULL OR action=$6)
        AND ($7::text IS NULL OR (CASE WHEN action=ANY($2::text[]) THEN 'denied' ELSE 'success' END)=$7)
        AND ($8::timestamptz IS NULL OR at >= $8) AND ($9::timestamptz IS NULL OR at < $9)
      ORDER BY id DESC LIMIT $10`,
    [actions, denied, auth.clinicId ?? q.clinicId ?? null, q.beforeId ?? null, q.actorId ?? null,
      q.action ?? null, q.outcome ?? null, q.from ?? null, q.to ?? null, q.limit + 1]);
    const items = rows.slice(0, q.limit).map(row => ({
      ...row, targetId: row.targetId === null ? null : Number(row.targetId), eventTime: row.eventTime.toISOString(),
    }));
    const result = { items, nextBeforeId: rows.length > q.limit ? items.at(-1)!.id : null };
    if (!ListAdminAuditResponse.safeParse(result).success) throw fail(500, "INTERNAL", "internal");
    await client.query("COMMIT");
    res.json(result);
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
});
export default router;
