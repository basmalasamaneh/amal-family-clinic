import { Router, type IRouter } from "express";
import { GetKpisResponse } from "@workspace/api-zod";
import { authenticate, requireRoles } from "../lib/auth";
import { refreshKpis } from "../kpis/service";

const router: IRouter = Router();
router.get("/kpis", authenticate, requireRoles("admin"), async (req, res) => {
  const result = await refreshKpis(req.query);
  GetKpisResponse.parse(result);
  res.json(result);
});
export default router;
