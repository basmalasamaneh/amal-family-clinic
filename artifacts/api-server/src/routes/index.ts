import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import appointmentsRouter from "./appointments";
import patientsRouter from "./patients";
import directoryRouter from "./directory";
import consentRouter from "./consent";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(appointmentsRouter);
router.use(consentRouter);
router.use(patientsRouter);
router.use(directoryRouter);

export default router;
