import { Router, type IRouter } from "express";
import { GetNetworkHealthResponse, RecordNetworkHeartbeatBody, RecordNetworkHeartbeatResponse } from "@workspace/api-zod";
import { authenticateReadOnly, csrf, requireRoles, trustedDevice, unauthorized } from "../lib/auth";
import { heartbeat, networkHealth } from "../network-health/service";
import { fail } from "../lib/auth-errors";

const router: IRouter = Router();
router.get("/network/health", authenticateReadOnly, requireRoles("admin"), async (req, res) => {
  const result = await networkHealth(req.auth!);
  GetNetworkHealthResponse.parse(result);
  res.json(result);
});
router.post("/network/heartbeat", authenticateReadOnly, requireRoles("doctor", "front-desk"), csrf, async (req, res) => {
  const device = await trustedDevice(req);
  if (device.id !== req.auth!.device?.id || device.clinic_id !== req.auth!.clinicId) throw unauthorized();
  if (!RecordNetworkHeartbeatBody.safeParse(req.body).success) throw fail(400, "VALIDATION", "validation");
  const result = await heartbeat(req.auth!, req.body);
  RecordNetworkHeartbeatResponse.parse(result);
  res.json(result);
});
export default router;
