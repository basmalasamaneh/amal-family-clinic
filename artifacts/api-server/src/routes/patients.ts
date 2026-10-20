import { Router, type IRouter } from "express";
import { CreatePatientResponse, GetPatientResponse, ListPatientsResponse, UpdatePatientResponse } from "@workspace/api-zod";
import { authenticate, csrf, requireRoles } from "../lib/auth";
import { createPatient, deletePatient, getPatient, listPatients, patientId, updatePatient } from "../patients/service";

const router: IRouter = Router();
router.use("/patients", authenticate, requireRoles("doctor", "front-desk"));
// Validate generated shapes while preserving date-only strings on the wire.
function checked<T>(schema: { parse: (value: unknown) => unknown }, value: T): T { schema.parse(value); return value; }
router.get("/patients", async (req, res): Promise<void> => {
  res.json(checked(ListPatientsResponse, await listPatients(req.auth!, req.query)));
});
router.get("/patients/:id", async (req, res): Promise<void> => {
  res.json(checked(GetPatientResponse, await getPatient(req.auth!, patientId.parse(req.params.id))));
});
router.post("/patients", csrf, async (req, res): Promise<void> => {
  res.status(201).json(checked(CreatePatientResponse, await createPatient(req.auth!, req.body)));
});
router.patch("/patients/:id", csrf, async (req, res): Promise<void> => {
  res.json(checked(UpdatePatientResponse, await updatePatient(req.auth!, patientId.parse(req.params.id), req.body)));
});
router.delete("/patients/:id", csrf, async (req, res): Promise<void> => {
  await deletePatient(req.auth!, patientId.parse(req.params.id));
  res.status(204).end();
});
export default router;
