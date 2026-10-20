import { Router, type IRouter } from "express";
import { ListPatientDuplicatesResponse, MergePatientsBody, MergePatientsResponse } from "@workspace/api-zod";
import { authenticate, csrf, requireRoles } from "../lib/auth";
import { listPatientDuplicates, mergePatients } from "../patients/merge";

// Mount before the generic /patients/:id router.
const router: IRouter = Router();
router.get("/patients/duplicates", authenticate, requireRoles("doctor", "front-desk"), async (req, res) => {
  const result = await listPatientDuplicates(req.auth!, req.query);
  ListPatientDuplicatesResponse.parse(result);
  res.json(result);
});
router.post("/patients/merge", authenticate, requireRoles("doctor", "front-desk"), csrf, async (req, res) => {
  MergePatientsBody.parse(req.body);
  const result = await mergePatients(req.auth!, req.body);
  MergePatientsResponse.parse(result);
  res.json(result);
});
export default router;
