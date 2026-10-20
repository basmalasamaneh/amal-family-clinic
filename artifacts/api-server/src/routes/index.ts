import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import appointmentsRouter from "./appointments";
import patientsRouter from "./patients";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(appointmentsRouter);
router.use(patientsRouter);

export default router;
