import { randomUUID } from "node:crypto";
import { Router, type IRouter, type RequestHandler, type ErrorRequestHandler } from "express";
import { authenticate, requireRoles } from "../lib/auth";
import { auditDenied, idSchema } from "../consent/service";
import { doctorAudit, doctorDay, doctorPatient, doctorPrivacy } from "../doctor/service";

const router: IRouter = Router();
const prepare: RequestHandler = (_req, res, next) => {
  res.locals.doctorCorrelationId = randomUUID();
  res.set({ "Cache-Control": "private, no-store", Pragma: "no-cache", Vary: "Cookie" });
  next();
};
router.get("/doctor/day", prepare, authenticate, requireRoles("doctor"), async (req, res) => {
  res.json(await doctorDay(req.auth!, req.query));
});
router.get("/doctor/patients/:id", prepare, authenticate, requireRoles("doctor"), async (req, res) => {
  res.json(await doctorPatient(req.auth!, idSchema.parse(req.params.id), req.query));
});
router.get("/doctor/privacy", prepare, authenticate, requireRoles("doctor"), async (req, res) => {
  res.json(await doctorPrivacy(req.auth!, req.query));
});
router.get("/audit", prepare, authenticate, requireRoles("doctor"), async (req, res) => {
  res.json(await doctorAudit(req.auth!, req.query));
});
const denied: ErrorRequestHandler = async (error, req, res, next) => {
  if (!res.locals.doctorCorrelationId) { next(error); return; }
  try {
    await auditDenied(req.auth, "doctor.read.denied", res.locals.doctorCorrelationId);
    next(error);
  } catch (auditError) { next(auditError); }
};
router.use(denied);
export default router;
