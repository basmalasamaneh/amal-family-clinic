import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import appointmentsRouter from "./appointments";
import patientsRouter from "./patients";
import directoryRouter from "./directory";
import consentRouter from "./consent";
import doctorRouter from "./doctor";
import patientMergeRouter from "./patient-merge";
import importsRouter from "./imports";
import syncRouter from "./sync";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(appointmentsRouter);
router.use(syncRouter);
router.use(consentRouter);
router.use(doctorRouter);
router.use(importsRouter);
// Literal /patients/duplicates must precede the /patients/:id route.
router.use(patientMergeRouter);
router.use(patientsRouter);
router.use(directoryRouter);

export default router;
