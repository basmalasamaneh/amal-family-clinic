import { Router, type IRouter } from "express";
import { ListPatientDuplicatesResponse, MergePatientsBody, MergePatientsResponse, PreviewPatientMergeBody, PreviewPatientMergeResponse } from "@workspace/api-zod";
import { authenticate, authenticateReadOnly, csrf, requireFreshPin, requireRoles } from "../lib/auth";
import { listPatientDuplicates, mergePatients, previewPatientMerge } from "../patients/merge";
import { fail } from "../lib/auth-errors";

// Mount before the generic /patients/:id router.
const router: IRouter = Router();
function input(schema: { safeParse(value: unknown): { success: boolean } }, value: unknown): void {
  if (!schema.safeParse(value).success) throw fail(400, "VALIDATION", "validation");
}
router.post("/patients/merge/preview", authenticateReadOnly, requireRoles("doctor", "front-desk"), csrf, async (req, res) => {
  res.set("Cache-Control", "no-store");
  input(PreviewPatientMergeBody, req.body);
  const result = await previewPatientMerge(req.auth!, req.body);
  res.json(PreviewPatientMergeResponse.parse(result));
});
router.get("/patients/duplicates", authenticate, requireRoles("doctor", "front-desk"), async (req, res) => {
  const result = await listPatientDuplicates(req.auth!, req.query);
  ListPatientDuplicatesResponse.parse(result);
  res.json(result);
});
router.post("/patients/merge", authenticate, requireRoles("doctor", "front-desk"), csrf, requireFreshPin, async (req, res) => {
  input(MergePatientsBody, req.body);
  const result = await mergePatients(req.auth!, req.body);
  MergePatientsResponse.parse(result);
  res.json(result);
});
export default router;
