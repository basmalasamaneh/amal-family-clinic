import { Router, type IRouter } from "express";
import {
  GetClinicAdoptionParams, GetClinicAdoptionResponse,
  TransitionClinicAdoptionParams, TransitionClinicAdoptionBody, TransitionClinicAdoptionResponse,
  LeaveClinicParams, LeaveClinicBody, LeaveClinicResponse,
  ExportClinicParams, ExportClinicBody, ExportClinicResponse,
} from "@workspace/api-zod";
import { authenticate, csrf, enforceScope, requireRoles } from "../lib/auth";
import { fail } from "../lib/auth-errors";
import { adoption, lifecycleTransaction, manager, state, transition } from "../adoption/service";
import { buildClinicExport } from "../adoption/export";

const router: IRouter = Router();
router.use("/clinics/:id/adoption", (_req,res,next) => {res.set("Cache-Control","private, no-store");next();});
router.use("/clinics/:id/leave", (_req,res,next) => {res.set("Cache-Control","private, no-store");next();});
// Generated validators use Zod 3; translate failures for the Zod 4 error handler.
function request<T>(schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } }, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw fail(400, "VALIDATION", "validation");
  return result.data;
}
// Validate without replacing serialized ISO strings with generated Date coercions.
function response<T>(schema: { safeParse(value: unknown): { success: boolean } }, value: T): T {
  if (!schema.safeParse(value).success) throw fail(500, "INTERNAL", "internal");
  return value;
}
router.get("/clinics/:id/adoption", authenticate, requireRoles("doctor","front-desk"), async (req,res) => {
  const { id: clinicId }=request(GetClinicAdoptionParams,req.params);
  enforceScope(req.auth!,clinicId);
  res.json(response(GetClinicAdoptionResponse,await lifecycleTransaction(async client => {
    const row=await state(client,clinicId);
    const {rows}=await client.query("SELECT 1 FROM operational.clinic_managers WHERE clinic_id=$1 AND user_id=$2",[clinicId,req.auth!.id]);
    return adoption(row,req.auth!.role==="doctor" && rows.length>0);
  })));
});
router.post("/clinics/:id/adoption", authenticate, csrf, async (req,res) => {
  const { id: clinicId }=request(TransitionClinicAdoptionParams,req.params);
  const input=request(TransitionClinicAdoptionBody,req.body);
  res.json(response(TransitionClinicAdoptionResponse,await lifecycleTransaction(client=>transition(client,req.auth!,clinicId,input.state))));
});
router.post("/clinics/:id/leave", authenticate, csrf, async (req,res) => {
  const { id: clinicId }=request(LeaveClinicParams,req.params);
  request(LeaveClinicBody,req.body);
  res.json(response(LeaveClinicResponse,await lifecycleTransaction(client=>transition(client,req.auth!,clinicId,"left"))));
});
router.post("/clinics/:id/export", authenticate, csrf, async (req,res) => {
  const { id: clinicId }=request(ExportClinicParams,req.params);
  // Orval omits strict() for empty objects, so retain the schema's no-extra-keys rule.
  request(ExportClinicBody.strict(),req.body);
  const result=await lifecycleTransaction(async client=>{
    await manager(client,req.auth!,clinicId);
    const result=await buildClinicExport(client,clinicId);
    await client.query(`INSERT INTO operational.audit_log(user_id,clinic_id,action,detail)
      VALUES($1,$2,'clinic.export.requested','{"format":"amal-clinic-export","schemaVersion":1}')`,[req.auth!.id,clinicId]);
    return result;
  },true);
  response(ExportClinicResponse,result);
  res.set({"Cache-Control":"private, no-store","Content-Disposition":`attachment; filename="clinic-${clinicId}-export.json"`,
    "Content-Type":"application/json; charset=utf-8"}).send(JSON.stringify(result));
});
export default router;
