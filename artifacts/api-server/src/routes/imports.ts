import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import {
  UploadImportBody, UploadImportResponse, GetImportBatchResponse,
  MapImportBody, MapImportResponse, CommitImportBody, CommitImportResponse,
  DownloadImportReportQueryParams, DownloadImportReportResponse,
} from "@workspace/api-zod";
import { authenticate, csrf, requireFreshPin, requireRoles } from "../lib/auth";
import { uploadImport, getImport, mapImport, commitImport, importReport } from "../imports/service";
import { fail } from "../lib/auth-errors";
const router: IRouter = Router();
const id = z.coerce.number().int().positive().max(2147483647);
// Validate generated contracts without coercing response ISO strings into Dates.
function checked<T>(schema: { parse(value: unknown): unknown }, value: T): T { schema.parse(value); return value; }
function input<T>(schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } }, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw fail(400, "VALIDATION", "validation");
  return result.data;
}
router.use("/import", authenticate, requireRoles("doctor", "front-desk"), (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});
router.post("/import/upload", csrf, async (req, res) => {
  input(UploadImportBody, req.body);
  res.json(checked(UploadImportResponse, await uploadImport(req.auth!, req.body)));
});
router.get("/import/:id", async (req, res) => { res.json(checked(GetImportBatchResponse, await getImport(req.auth!, id.parse(req.params.id)))); });
router.post("/import/:id/map", csrf, async (req, res) => {
  input(MapImportBody, req.body);
  res.json(checked(MapImportResponse, await mapImport(req.auth!, id.parse(req.params.id), req.body)));
});
router.post("/import/:id/commit", csrf, requireFreshPin, async (req, res) => {
  input(CommitImportBody, req.body);
  res.json(checked(CommitImportResponse, await commitImport(req.auth!, id.parse(req.params.id), req.body)));
});
router.get("/import/:id/report", async (req, res) => {
  const batchId = id.parse(req.params.id), { locale } = input(DownloadImportReportQueryParams, req.query);
  const report = checked(DownloadImportReportResponse, await importReport(req.auth!, batchId, locale));
  res.setHeader("Content-Disposition", `attachment; filename="import-${batchId}-${locale}.json"`);
  res.setHeader("Cache-Control", "no-store");
  res.type("application/json; charset=utf-8").send(JSON.stringify(report));
});
export default router;
