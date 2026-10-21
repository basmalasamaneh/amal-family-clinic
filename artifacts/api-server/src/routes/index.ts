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
import kpisRouter from "./kpis";
import adminUsersRouter from "./admin-users";
import adminDirectoryRouter from "./admin-directory";
import networkHealthRouter from "./network-health";
import adminAuditRouter from "./admin-audit";
import adoptionRouter from "./adoption";
import adoptionResultsRouter from "./adoption-results";
import developerRouter from "./developer";
import { demoBoundary } from "../developer/boundary";
import { validateRouteInputs } from "../lib/route-validation";
import remindersRouter from "./reminders";

const router: IRouter = Router();
router.use(validateRouteInputs);
router.use(demoBoundary);
router.use(developerRouter);

router.use(healthRouter);
router.use(authRouter);
router.use(adoptionRouter);
router.use(adoptionResultsRouter);
router.use(adminUsersRouter);
router.use(adminAuditRouter);
router.use(adminDirectoryRouter);
router.use(networkHealthRouter);
router.use(appointmentsRouter);
router.use(remindersRouter);
router.use(syncRouter);
router.use(kpisRouter);
router.use(consentRouter);
router.use(doctorRouter);
router.use(importsRouter);
// Literal /patients/duplicates must precede the /patients/:id route.
router.use(patientMergeRouter);
router.use(patientsRouter);
router.use(directoryRouter);

export default router;
