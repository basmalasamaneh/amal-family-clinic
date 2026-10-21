import { Router, type IRouter } from "express";
import { GetKpisResponse } from "@workspace/api-zod";
import { authenticate, authenticateReadOnly, csrf, enforceScope, requireRoles } from "../lib/auth";
import { refreshKpis } from "../kpis/service";
import { ingestLookup } from "../kpis/lookup";
import { parseKpiQuery } from "../kpis/period";

const router: IRouter = Router();
router.post("/kpis/lookup-duration", authenticateReadOnly, csrf, requireRoles("doctor"), async (req, res) => {
  await ingestLookup(req.auth!, req.body, res.locals.lookupReceivedAt);
  res.status(204).end();
});
router.get("/kpis", authenticate, requireRoles("admin"), async (req, res) => {
  const query = parseKpiQuery(req.query);
  if (query.clinicId !== null) enforceScope(req.auth!, query.clinicId);
  // A clinic administrator must never acquire the default network-wide scope.
  const clinicId = req.auth!.clinicId ?? query.clinicId;
  const result = await refreshKpis({
    ...req.query, ...(clinicId === null ? {} : { clinicId: String(clinicId) }),
  }, new Date(), false);
  GetKpisResponse.parse(result);
  res.json(result);
});
export default router;
