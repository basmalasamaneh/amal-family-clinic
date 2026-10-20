import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { pool } from "@workspace/db";
import { ListClinicsResponse, ListDoctorsResponse } from "@workspace/api-zod";
import { authenticate, enforceScope, forbidden, requireRoles, type Auth } from "../lib/auth";
import { fail } from "../lib/auth-errors";
import { adoption } from "../adoption/service";

const router: IRouter = Router();
const page = z.object({
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
}).strict();
const doctorQuery = page.extend({ clinicId: z.coerce.number().int().positive() });

function clinicScope(auth: Auth): number {
  if (!auth.clinicId) throw forbidden();
  enforceScope(auth, auth.clinicId);
  return auth.clinicId;
}
function after(cursor: string | undefined, scope: string): number {
  if (cursor === undefined) return 0;
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error();
    return z.object({ scope: z.literal(scope), after: z.number().int().positive() }).strict()
      .parse(JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"))).after;
  } catch { throw fail(400, "VALIDATION", "validation"); }
}
function next(scope: string, id: number): string {
  return Buffer.from(JSON.stringify({ scope, after: id })).toString("base64url");
}
router.get("/clinics", authenticate, requireRoles("doctor", "front-desk"), async (req, res) => {
  const query = page.parse(req.query), auth = req.auth!, clinicId = clinicScope(auth);
  const scope = `clinics:${auth.id}:${clinicId}`, afterId = after(query.cursor, scope);
  const { rows } = await pool.query(
    `SELECT c.*, EXISTS(SELECT 1 FROM operational.clinic_managers m
      WHERE m.clinic_id=c.clinic_id AND m.user_id=$3) AS can_manage
      FROM operational.clinics c WHERE clinic_id=$1 AND clinic_id>$2`,
    [clinicId, afterId, req.auth!.id]);
  const result = { items: rows.map(row => ({ id: row.clinic_id, name: row.clinic_name,
    mode: row.network_mode === "full" ? "network" : "lite", timezone: row.timezone,
    adoption: adoption(row,req.auth!.role==="doctor" && row.can_manage) })), nextCursor: null };
  ListClinicsResponse.parse(result);
  res.json(result);
});
router.get("/doctors", authenticate, requireRoles("doctor", "front-desk"), async (req, res) => {
  const query = doctorQuery.parse(req.query), auth = req.auth!, clinicId = clinicScope(auth);
  enforceScope(auth, query.clinicId);
  const scope = `doctors:${auth.id}:${clinicId}:${auth.doctorId ?? "all"}`;
  const afterId = after(query.cursor, scope);
  const { rows } = await pool.query(
    `SELECT doctor_id,doctor_name,clinic_id FROM operational.doctors
      WHERE clinic_id=$1 AND ($2::integer IS NULL OR doctor_id=$2) AND doctor_id>$3 ORDER BY doctor_id LIMIT $4`,
    [clinicId, auth.role === "doctor" ? auth.doctorId : null, afterId, query.limit + 1]);
  const items = rows.slice(0, query.limit).map(row => ({
    id: row.doctor_id, name: row.doctor_name, clinicId: row.clinic_id,
    // This adapter grants scheduling access only, never network/clinical visibility.
    networkVisible: false,
  }));
  const result = { items, nextCursor: rows.length > query.limit ? next(scope, items.at(-1)!.id) : null };
  ListDoctorsResponse.parse(result);
  res.json(result);
});

export default router;
