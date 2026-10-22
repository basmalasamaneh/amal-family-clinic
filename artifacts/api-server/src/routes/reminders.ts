import { Router, type IRouter } from "express";
import {
  ListReminderLogResponse, GetReminderClinicPreferenceResponse, GetReminderPatientPreferenceResponse,
} from "@workspace/api-zod";
import { authenticate, csrf, requireRoles } from "../lib/auth";
import { clinicPreference, listReminderLog, patientPreference, reminderId } from "../reminders/access";
import { fail } from "../lib/auth-errors";

const router: IRouter = Router();
router.use("/reminders", authenticate, requireRoles("admin", "front-desk", "doctor"), (_req, res, next) => {
  res.set("Cache-Control", "private, no-store"); next();
});
function checked<T>(schema: { parse: (v: unknown) => unknown }, value: T): T { schema.parse(value); return value; }
router.get("/reminders/log", async (req, res) => {
  res.json(checked(ListReminderLogResponse, await listReminderLog(req.auth!, req.query)));
});
router.get("/reminders/clinics/:clinicId", async (req, res) => {
  res.json(checked(GetReminderClinicPreferenceResponse, await clinicPreference(req.auth!, reminderId.parse(req.params.clinicId))));
});
router.put("/reminders/clinics/:clinicId", csrf, requireRoles("admin", "doctor"), async (req, res) => {
  if (req.body === undefined) throw fail(400, "VALIDATION", "validation");
  res.json(checked(GetReminderClinicPreferenceResponse, await clinicPreference(req.auth!, reminderId.parse(req.params.clinicId), req.body)));
});
router.get("/reminders/patients/:patientId", requireRoles("front-desk"), async (req, res) => {
  res.json(checked(GetReminderPatientPreferenceResponse, await patientPreference(req.auth!, reminderId.parse(req.params.patientId))));
});
router.put("/reminders/patients/:patientId", csrf, requireRoles("front-desk"), async (req, res) => {
  if (req.body === undefined) throw fail(400, "VALIDATION", "validation");
  res.json(checked(GetReminderPatientPreferenceResponse, await patientPreference(req.auth!, reminderId.parse(req.params.patientId), req.body)));
});
export default router;
