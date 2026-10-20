import { Router, type IRouter } from "express";
import { GetKpisResponse } from "@workspace/api-zod";
import { authenticate, authenticateReadOnly, csrf, requireRoles } from "../lib/auth";
import { refreshKpis } from "../kpis/service";
import { ingestLookup } from "../kpis/lookup";

const router: IRouter = Router();
router.post("/kpis/lookup-duration", authenticateReadOnly, csrf, requireRoles("doctor"), async (req, res) => {
  await ingestLookup(req.auth!, req.body, res.locals.lookupReceivedAt);
  res.status(204).end();
});
router.get("/kpis", authenticate, requireRoles("admin"), async (req, res) => {
  const result = await refreshKpis(req.query);
  GetKpisResponse.parse(result);
  res.json(result);
});
export default router;
