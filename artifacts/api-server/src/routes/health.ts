import { Router, type IRouter, type Request, type Response } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";

const router: IRouter = Router();

/** Exact, payload-free liveness probe only. Never grants application authority.
 * Internal startup probes may use plain HTTP and must not depend on PostgreSQL.
 * Noncanonical URLs and requests with payloads retain ordinary validation.
 */
export function deploymentLiveness(req: Request, res: Response): boolean {
  if (!["GET", "HEAD"].includes(req.method) || req.originalUrl !== "/api/healthz" ||
      req.get("transfer-encoding") !== undefined ||
      (req.get("content-length") !== undefined && req.get("content-length") !== "0")) return false;
  // These headers have existing bounded validation on ordinary API routes.
  for (const header of ["x-csrf-token", "x-amal-demo-generation"]) {
    const value = req.headers[header];
    if (value !== undefined && (typeof value !== "string" || !/^[A-Za-z0-9_-]{0,256}$/.test(value))) return false;
  }
  res.json(HealthCheckResponse.parse({ status: "ok" }));
  return true;
}

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

export default router;
