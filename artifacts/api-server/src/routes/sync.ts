import { Router, type IRouter } from "express";
import { ListSyncConflictsResponse, PullSyncResponse, PushSyncResponse, ResolveSyncResponse } from "@workspace/api-zod";
import { authenticate, csrf, requireRoles } from "../lib/auth";
import { pushSync, resolveSync } from "../sync/service";
import { listSyncConflicts, pullSync } from "../sync/reads";

const router: IRouter = Router();
// Check exact service projections without replacing ISO strings with coerced Dates.
function checked<T>(schema: { parse: (value: unknown) => unknown }, value: T): T { schema.parse(value); return value; }
router.use("/sync", authenticate, requireRoles("doctor", "front-desk"));
router.post("/sync/push", csrf, async (req, res) => {
  res.json(checked(PushSyncResponse, await pushSync(req.auth!, req.body)));
});
router.get("/sync/pull", async (req, res) => {
  res.json(checked(PullSyncResponse, await pullSync(req.auth!, req.query)));
});
router.get("/sync/conflicts", async (req, res) => {
  res.json(checked(ListSyncConflictsResponse, await listSyncConflicts(req.auth!, req.query)));
});
router.post("/sync/resolve", csrf, async (req, res) => {
  res.json(checked(ResolveSyncResponse, await resolveSync(req.auth!, req.body)));
});
export default router;
