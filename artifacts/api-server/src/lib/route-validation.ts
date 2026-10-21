import type { RequestHandler } from "express";
import { z } from "zod/v4";
import { fail } from "./auth-errors";

/**
 * Wire-level checks shared by live routes. Service schemas remain authoritative
 * for required fields, enums, object keys and authorization. In particular an
 * import upload's raw rows deliberately remain row-level reportable data.
 */
type RouteContract = { method: string; path: string; query: string[]; body: boolean };
const route = (method: string, path: string, query = "", body = false): RouteContract =>
  ({ method, path, query: query ? query.split(" ") : [], body });
export const routeContracts: RouteContract[] = [
  route("GET", "/reminders/log", "clinicId limit cursor status from to"),
  route("GET", "/reminders/clinics/:clinicId"),
  route("PUT", "/reminders/clinics/:clinicId", "", true),
  route("GET", "/reminders/patients/:patientId"),
  route("PUT", "/reminders/patients/:patientId", "", true),
  route("GET", "/healthz"),
  route("GET", "/demo/context"),
  route("GET", "/admin/developer/status"),
  route("PUT", "/admin/developer/clinics/:clinicId/outage", "", true),
  route("GET", "/admin/developer/resets/:requestId"),
  route("POST", "/admin/developer/reset", "", true),
  route("GET", "/auth/device-context"),
  route("POST", "/auth/login", "", true),
  route("POST", "/auth/pin", "", true),
  route("GET", "/me"),
  route("GET", "/auth/offline-permit", "nonce"),
  route("POST", "/auth/logout"),
  route("POST", "/auth/reauth", "", true),
  route("GET", "/auth/devices", "page pageSize clinicId revoked"),
  route("POST", "/auth/devices", "", true),
  route("DELETE", "/auth/devices/:id"),
  route("GET", "/clinics/:id/adoption"),
  route("POST", "/clinics/:id/adoption", "", true),
  route("POST", "/clinics/:id/leave", "", true),
  route("POST", "/clinics/:id/export", "", true),
  route("GET", "/adoption/results"),
  route("GET", "/admin/users", "page pageSize role clinicId active q"),
  route("GET", "/admin/users/:id"),
  route("POST", "/admin/users", "", true),
  route("PATCH", "/admin/users/:id", "", true),
  route("DELETE", "/admin/users/:id"),
  route("POST", "/admin/users/:id/reset-pin", "", true),
  route("GET", "/admin/audit", "limit beforeId clinicId actorId action outcome from to"),
  route("GET", "/clinics/:id"),
  route("GET", "/admin/clinics", "limit cursor"),
  route("GET", "/admin/clinics/:id"),
  route("GET", "/admin/doctors", "limit cursor clinicId"),
  route("GET", "/admin/doctors/:id"),
  route("POST", "/clinics", "", true),
  route("PATCH", "/clinics/:id", "", true),
  route("POST", "/doctors", "", true),
  route("PATCH", "/doctors/:id", "", true),
  route("GET", "/network/health"),
  route("POST", "/network/heartbeat", "", true),
  route("GET", "/appointments", "clinicId doctorId patientId status upcoming from to cursor limit"),
  route("GET", "/appointments/availability", "clinicId patientId"),
  route("POST", "/appointments/check", "", true),
  route("POST", "/appointments/holds", "", true),
  route("DELETE", "/appointments/holds/:token", "", true),
  route("POST", "/appointments", "", true),
  route("PATCH", "/appointments/:id", "", true),
  route("GET", "/sync/state"),
  route("POST", "/sync/push", "", true),
  route("GET", "/sync/pull", "limit since"),
  route("GET", "/sync/conflicts", "limit status cursor"),
  route("POST", "/sync/resolve", "", true),
  route("POST", "/kpis/lookup-duration", "", true),
  route("GET", "/kpis", "range date clinicId"),
  route("GET", "/patients/:id/consent"),
  route("POST", "/patients/:id/consent", "", true),
  route("POST", "/patients/:id/access-history", "", true),
  route("POST", "/consent/:id/withdraw", "", true),
  route("GET", "/network/lookup", "q limit cursor"),
  route("GET", "/doctor/day", "limit cursor"),
  route("GET", "/doctor/patients/:id"),
  route("GET", "/doctor/privacy"),
  route("GET", "/audit", "limit cursor patientId"),
  route("POST", "/import/upload", "", true),
  route("GET", "/import/:id"),
  route("POST", "/import/:id/map", "", true),
  route("POST", "/import/:id/commit", "", true),
  route("GET", "/import/:id/report", "locale"),
  route("POST", "/patients/merge/preview", "", true),
  route("GET", "/patients/duplicates", "limit cursor"),
  route("POST", "/patients/merge", "", true),
  route("GET", "/patients", "q cursor limit"),
  route("GET", "/patients/:id"),
  route("POST", "/patients", "", true),
  route("PATCH", "/patients/:id", "", true),
  route("DELETE", "/patients/:id"),
  route("GET", "/clinics", "cursor limit"),
  route("GET", "/doctors", "cursor limit clinicId"),
];
// Literal routes take precedence over parameter routes, as in routes/index.ts.
const contracts = routeContracts.map(contract => ({
  ...contract,
  segments: contract.path.split("/"),
})).sort((a, b) =>
  a.segments.filter(s => s.startsWith(":")).length - b.segments.filter(s => s.startsWith(":")).length);
const invalid = () => fail(400, "VALIDATION", "validation");
const numericQuery = new Set(["id", "clinicId", "doctorId", "patientId", "actorId", "beforeId", "limit", "page", "pageSize"]);
const integerBody = /^(?:id|(?:clinic|doctor|patient|appointment|otherAppointment|associateAppointment|source|target|row|user|device)Id|(?:expected|targetExpected|otherExpected|source|target)Version|sequence)$/;
const utcInstant = z.iso.datetime({ offset: false });
function bodyBounds(value: unknown, depth = 0): void {
  if (depth > 16) throw invalid();
  if (Array.isArray(value)) { for (const item of value) bodyBounds(item, depth + 1); return; }
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    if (integerBody.test(key) && item !== null &&
      (typeof item !== "number" || !Number.isInteger(item) || item < 1 || item > 2147483647)) throw invalid();
    if (["startsAt", "endsAt"].includes(key)) {
      if (!utcInstant.safeParse(item).success || typeof item !== "string" ||
        new Date(item).toISOString().slice(0, 19) !== item.slice(0, 19)) throw invalid();
    }
    bodyBounds(item, depth + 1);
  }
}

export const validateRouteInputs: RequestHandler = (req, _res, next) => {
  try {
    let segments: string[];
    try { segments = req.path.replace(/\/$/, "").split("/").map(decodeURIComponent); }
    catch { throw invalid(); }
    const contract = contracts.find(c => c.method === (req.method === "HEAD" ? "GET" : req.method) &&
      c.segments.length === segments.length &&
      c.segments.every((s, i) => s.startsWith(":") || s.toLowerCase() === segments[i]!.toLowerCase()));
    if (!contract) { next(); return; } // Unknown paths retain the normal 404.
    contract.segments.forEach((segment, index) => {
      if (!segment.startsWith(":")) return;
      const value = segments[index]!;
      if ([":id", ":clinicId", ":patientId"].includes(segment)) {
        if (!/^[1-9]\d{0,9}$/.test(value) || Number(value) > 2147483647) throw invalid();
      } else if (!z.uuid().safeParse(value).success) throw invalid();
    });
    for (const [key, value] of Object.entries(req.query)) {
      if (!contract.query.includes(key) || typeof value !== "string" || value.length > 2048) throw invalid();
      if (numericQuery.has(key) && (!/^[1-9]\d{0,9}$/.test(value) || Number(value) > 2147483647)) throw invalid();
    }
    for (const header of ["x-csrf-token", "x-amal-demo-generation"]) {
      const value = req.headers[header];
      if (value !== undefined && (typeof value !== "string" || !/^[A-Za-z0-9_-]{0,256}$/.test(value))) throw invalid();
    }
    const hasPayload = Number(req.headers["content-length"] ?? 0) > 0 || req.headers["transfer-encoding"] !== undefined;
    if (hasPayload && !req.is("application/json")) throw invalid();
    if (!contract.body) {
      if (req.body !== undefined && (!req.body || typeof req.body !== "object" ||
        Array.isArray(req.body) || Object.keys(req.body).length)) throw invalid();
    } else {
      if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) throw invalid();
      if (contract.path === "/import/upload") {
        const { rows: _rows, ...metadata } = req.body;
        bodyBounds(metadata);
      } else bodyBounds(req.body);
    }
    next();
  } catch (error) { next(error); }
};
