import { randomUUID } from "node:crypto";
import { Router, type IRouter, type ErrorRequestHandler, type RequestHandler } from "express";
import { authenticate, csrf, requireFreshPin, requireRoles } from "../lib/auth";
import { auditDenied, getConsent, idSchema, lookupNetwork, recordConsent, withdrawConsent } from "../consent/service";

const router: IRouter = Router();
const prepare: RequestHandler = (_req, res, next) => {
  res.locals.consentCorrelationId = randomUUID();
  res.set({ "Cache-Control": "private, no-store", "Pragma": "no-cache", "Vary": "Cookie" });
  res.set("X-Request-ID", res.locals.consentCorrelationId);
  next();
};
router.get("/patients/:id/consent", prepare, authenticate, requireRoles("doctor", "front-desk"), async (req, res) => {
  res.json(await getConsent(req.auth!, idSchema.parse(req.params.id)));
});
router.post("/patients/:id/consent", prepare, authenticate, requireRoles("front-desk"), csrf, requireFreshPin, async (req, res) => {
  res.status(201).json(await recordConsent(req.auth!, idSchema.parse(req.params.id), req.body, res.locals.consentCorrelationId));
});
router.post("/consent/:id/withdraw", prepare, authenticate, requireRoles("front-desk"), csrf, requireFreshPin, async (req, res) => {
  res.json(await withdrawConsent(req.auth!, idSchema.parse(req.params.id), req.body, res.locals.consentCorrelationId));
});
router.get("/network/lookup", prepare, authenticate, requireRoles("doctor"), async (req, res) => {
  res.json(await lookupNetwork(req.auth!, req.query, res.locals.consentCorrelationId));
});
const denied: ErrorRequestHandler = async (error, req, res, next) => {
  if (!res.locals.consentCorrelationId) { next(error); return; }
  try {
    await auditDenied(req.auth, req.path === "/network/lookup" ? "network.lookup.denied" : "consent.denied", res.locals.consentCorrelationId);
    next(error);
  } catch (auditError) { next(auditError); }
};
router.use(denied);
export default router;
