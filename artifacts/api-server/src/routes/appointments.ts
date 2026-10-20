import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { AcquireAppointmentHoldResponse, CheckAppointmentsResponse, CreateAppointmentResponse, ListAppointmentsResponse, UpdateAppointmentResponse } from "@workspace/api-zod";
import { authenticate, csrf, requireRoles } from "../lib/auth";
import { checkAppointment, createAppointment, createHold, listAppointments, releaseHold, updateAppointment } from "../appointments/service";

const router: IRouter = Router();
router.use("/appointments", authenticate);
// Validate projections against generated contract without replacing exact ISO strings with coerced Dates.
function checked<T>(schema: { parse: (value: unknown) => unknown }, value: T): T { schema.parse(value); return value; }
router.get("/appointments", requireRoles("doctor", "front-desk"), async (req, res) => {
  res.json(checked(ListAppointmentsResponse, await listAppointments(req.auth!, req.query)));
});
router.post("/appointments/check", csrf, requireRoles("doctor", "front-desk"), async (req, res) => {
  res.json(checked(CheckAppointmentsResponse, await checkAppointment(req.auth!, req.body)));
});
router.post("/appointments/holds", csrf, requireRoles("doctor", "front-desk"), async (req, res) => {
  res.status(201).json(checked(AcquireAppointmentHoldResponse, await createHold(req.auth!, req.body)));
});
router.delete("/appointments/holds/:token", csrf, requireRoles("doctor", "front-desk"), async (req, res) => {
  await releaseHold(req.auth!, String(req.params.token), req.body);
  res.status(204).end();
});
router.post("/appointments", csrf, requireRoles("doctor", "front-desk"), async (req, res) => {
  res.status(201).json(checked(CreateAppointmentResponse, await createAppointment(req.auth!, req.body)));
});
router.patch("/appointments/:id", csrf, requireRoles("doctor", "front-desk"), async (req, res) => {
  res.json(checked(UpdateAppointmentResponse, await updateAppointment(req.auth!, z.coerce.number().int().positive().parse(req.params.id), req.body)));
});
export default router;
