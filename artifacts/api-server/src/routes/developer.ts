import { Router, type IRouter, type RequestHandler } from "express";
import { pool } from "@workspace/db";
import {
  GetDemoContextResponse, GetDeveloperStatusResponse, SetDeveloperOutageParams,
  SetDeveloperOutageBody, SetDeveloperOutageResponse, ResetDeveloperDemoBody,
  ResetDeveloperDemoResponse, GetDeveloperResetReceiptParams, GetDeveloperResetReceiptResponse,
} from "@workspace/api-zod";
import { authenticateReadOnly, csrf, forbidden, lockAdministration } from "../lib/auth";
import { ApiError, fail } from "../lib/auth-errors";
import { developerToolsEnabled, DemoResetError, getDemoGeneration, getResetReceipt, resetDemo } from "../developer/reset";

const router: IRouter = Router();
function inputContract<T>(schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } }, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw fail(400, "VALIDATION", "validation");
  return result.data;
}
const enabled: RequestHandler = (_req, _res, next) =>
  next(developerToolsEnabled() ? undefined : fail(403, "DEVELOPER_TOOLS_DISABLED", "developerToolsDisabled"));
// Whole-demo reset and outage controls require network-wide administrator
// authority. An administrator scoped to one clinic cannot affect its peers.
const administrator: RequestHandler = (req, _res, next) =>
  next(req.auth?.role === "admin" && req.auth.clinicId === null ? undefined : forbidden());

router.get("/demo/context", async (req, res, next) => {
  if (!developerToolsEnabled()) {
    res.json(GetDemoContextResponse.parse({ enabled: false, generation: null, clinicId: null, outage: false }));
    return;
  }
  // The public generation is only an invalidation signal, never authorization.
  // Expired sessions must still learn that their old pending work was discarded.
  authenticateReadOnly(req, res, async error => {
    try {
      if (error && (!(error instanceof ApiError) || error.status !== 401)) throw error;
      const clinicId = error ? null : req.auth?.clinicId ?? null;
      const outage = clinicId !== null && (await pool.query(
        "SELECT 1 FROM operational.developer_outages WHERE clinic_id=$1", [clinicId])).rowCount !== 0;
      res.json(GetDemoContextResponse.parse({ enabled: true, generation: await getDemoGeneration(), clinicId, outage }));
    } catch (e) { next(e); }
  });
});
router.use("/admin/developer", enabled, authenticateReadOnly, administrator);
router.get("/admin/developer/status", async (_req, res) => {
  const { rows } = await pool.query(`SELECT c.clinic_id AS id,c.clinic_name AS name,
    (o.clinic_id IS NOT NULL) AS outage FROM operational.clinics c
    LEFT JOIN operational.developer_outages o USING(clinic_id) ORDER BY c.clinic_id`);
  res.json(GetDeveloperStatusResponse.parse({ generation: await getDemoGeneration(), clinics: rows }));
});
router.put("/admin/developer/clinics/:clinicId/outage", csrf, async (req, res) => {
  const { clinicId } = inputContract(SetDeveloperOutageParams, req.params);
  const input = inputContract(SetDeveloperOutageBody, req.body);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Drain already-admitted requests before changing clinic availability.
    await client.query("SELECT pg_advisory_xact_lock(761930)");
    await lockAdministration(client, req.auth!);
    const generation = await getDemoGeneration();
    if (input.expectedGeneration !== generation) throw fail(409, "DEMO_RESET_REQUIRED", "demoResetRequired", { generation });
    const { rows: [clinic] } = await client.query(
      "SELECT clinic_id AS id,clinic_name AS name FROM operational.clinics WHERE clinic_id=$1 FOR SHARE", [clinicId]);
    if (!clinic) throw fail(404, "NOT_FOUND", "notFound");
    if (input.enabled) await client.query(
      "INSERT INTO operational.developer_outages(clinic_id,enabled_by) VALUES($1,$2) ON CONFLICT DO NOTHING", [clinicId, req.auth!.id]);
    else await client.query("DELETE FROM operational.developer_outages WHERE clinic_id=$1", [clinicId]);
    await client.query("COMMIT");
    res.json(SetDeveloperOutageResponse.parse({ ...clinic, outage: input.enabled }));
  } catch (e) { await client.query("ROLLBACK"); throw e; }
  finally { client.release(); }
});
router.get("/admin/developer/resets/:requestId", async (req, res) => {
  const { requestId } = inputContract(GetDeveloperResetReceiptParams, req.params);
  const receipt = await getResetReceipt(requestId);
  if (!receipt) throw fail(404, "NOT_FOUND", "notFound");
  res.json(GetDeveloperResetReceiptResponse.parse(receipt));
});
router.post("/admin/developer/reset", csrf, async (req, res) => {
  const input = inputContract(ResetDeveloperDemoBody, req.body);
  try {
    const receipt = await resetDemo({ ...input, actor: { id: req.auth!.id, sessionDigest: req.auth!.sessionDigest } });
    res.set("X-Amal-Demo-Generation", receipt.generation);
    res.json(ResetDeveloperDemoResponse.parse(receipt));
  } catch (e) {
    if (!(e instanceof DemoResetError)) throw e;
    const key = e.code === "DEMO_RESET_REQUIRED" ? "demoResetRequired"
      : e.status === 401 ? "unauthorized" : e.status === 403 ? "developerToolsDisabled" : "demoResetFailed";
    throw fail(e.status, e.code, key);
  }
});
export default router;
