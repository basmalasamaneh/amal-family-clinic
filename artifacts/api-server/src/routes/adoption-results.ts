import { Router, type IRouter } from "express";
import { GetAdoptionResultsResponse } from "@workspace/api-zod";
import { authenticateReadOnly, requireRoles } from "../lib/auth";
import { fail } from "../lib/auth-errors";
import { adoptionResults } from "../adoption/results";

const router: IRouter = Router();
router.use("/adoption/results", (_req, res, next) => {
  res.set("Cache-Control", "private, no-store");
  next();
});
router.get("/adoption/results", authenticateReadOnly, requireRoles("doctor", "front-desk"), async (req, res) => {
  if (Object.keys(req.query).length) throw fail(400, "VALIDATION", "validation");
  const result = await adoptionResults();
  if (!GetAdoptionResultsResponse.safeParse(result).success) throw fail(500, "INTERNAL", "internal");
  res.json(result);
});
export default router;
