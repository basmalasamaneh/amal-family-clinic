import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import cookieParser from "cookie-parser";
import { ZodError } from "zod/v4";
import { ApiError, fail } from "./lib/auth-errors";
import { resolve } from "node:path";
import { isLookupTelemetryPath } from "./kpis/lookup";
import helmet from "helmet";
import { isIP } from "node:net";
import { securityRateLimit } from "./lib/security-rate";

const app: Express = express();
// Capture receipt before security checks, authentication or body parsing.
app.use((req, res, next) => {
  if (isLookupTelemetryPath(req.originalUrl)) res.locals.lookupReceivedAt = new Date();
  next();
});
app.disable("x-powered-by");
// Only trust a known reverse-proxy hop count when deployment explicitly opts in.
const proxyHops = Number(process.env.AUTH_PROXY_HOPS ?? 0);
if (!Number.isInteger(proxyHops) || proxyHops < 0) throw new Error("Invalid AUTH_PROXY_HOPS");
const trustedProxies = (process.env.AUTH_TRUSTED_PROXIES ?? "").split(",").map(v => v.trim()).filter(Boolean);
for (const proxy of trustedProxies) {
  const [ip, prefix, extra] = proxy.split("/");
  const family = isIP(ip!);
  if (!family || extra !== undefined || (prefix !== undefined &&
    (!/^\d+$/.test(prefix) || +prefix < 1 || +prefix > (family === 4 ? 32 : 128))) ||
    (family === 6 && ip!.toLowerCase().includes("ffff:"))) throw new Error("Invalid AUTH_TRUSTED_PROXIES");
}
if (process.env.NODE_ENV === "production" && proxyHops) throw new Error("Production requires explicit AUTH_TRUSTED_PROXIES, not hop-count trust");
app.set("trust proxy", trustedProxies.length ? trustedProxies : proxyHops);
const origins = (process.env.AUTH_ALLOWED_ORIGINS ?? "").split(",").map(v => v.trim()).filter(Boolean);
if (process.env.NODE_ENV === "production" && (!origins.length || origins.some(v => !v.startsWith("https://")))) throw new Error("Production requires explicit HTTPS AUTH_ALLOWED_ORIGINS");
for (const origin of origins) if (new URL(origin).origin !== origin) throw new Error("AUTH_ALLOWED_ORIGINS must contain exact origins");
app.use(helmet({
  contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
  strictTransportSecurity: process.env.NODE_ENV === "production" ? { maxAge: 31536000, includeSubDomains: true } : false,
}));
app.use((req, res, next) => {
  res.set({ "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'", "Cache-Control": "no-store" });
  if (process.env.NODE_ENV === "production") {
    res.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    if (!req.secure) { next(fail(403, "FORBIDDEN", "forbidden")); return; }
  }
  const origin = req.get("origin");
  if ((origin && !origins.includes(origin)) || (!["GET", "HEAD", "OPTIONS"].includes(req.method) && !origin)) {
    next(fail(403, "CSRF", "csrf")); return;
  }
  next();
});

app.use(
  pinoHttp({
    logger,
    autoLogging: { ignore: req => isLookupTelemetryPath(req.url ?? "") },
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          // Do not log arbitrary path/query input (it may contain clinical data).
          url: "[redacted]",
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(securityRateLimit);
app.use(cors({ origin: origins, credentials: true, allowedHeaders: ["Content-Type", "X-CSRF-Token", "X-Amal-Demo-Generation"], exposedHeaders: ["X-Amal-Demo-Generation"], methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] }));
// The calendar-export adapter has its own bounded 100-row upload contract.
// Keep all other API payload limits unchanged.
app.use("/api/import/upload", express.json({ limit: "128kb" }));
app.use("/api/import/:id/map", express.json({ limit: "1mb" }));
app.use("/api/sync/push", express.json({ limit: "2mb" }));
app.use(express.json({ limit: "32kb" }));
app.use(cookieParser());

// Resolve from either workspace-root or artifact working directory.
const specPath = resolve(process.cwd(), process.cwd().endsWith("artifacts/api-server") ? "../../lib/api-spec/openapi.yaml" : "lib/api-spec/openapi.yaml");
app.get("/docs/openapi.yaml", (req, res) => {
  if (Object.keys(req.query).length || req.body !== undefined ||
    Number(req.get("content-length") ?? 0) > 0 || req.get("transfer-encoding")) throw fail(400, "VALIDATION", "validation");
  res.type("application/yaml").sendFile(specPath);
});

app.use("/api", router);
app.use((_req, _res, next) => { next(fail(404, "NOT_FOUND", "notFound")); });
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const invalid = error instanceof ZodError || (error instanceof SyntaxError && "body" in error) ||
    (typeof error === "object" && error !== null && "type" in error &&
      ["entity.too.large", "encoding.unsupported", "charset.unsupported", "request.aborted", "entity.parse.failed"].includes(String(error.type)));
  const safe = error instanceof ApiError ? error : invalid ? fail(400, "VALIDATION", "validation") : fail(500, "INTERNAL", "internal");
  // Never serialize raw exceptions: database errors can contain credentials/query values.
  if (safe.status === 500) logger.error({ code: safe.code }, "Request failed");
  if (safe.params.retryAfterSeconds) res.set("Retry-After", String(safe.params.retryAfterSeconds));
  res.status(safe.status).json({ code: safe.code, messageKey: `error.${safe.key}`, params: safe.params });
});

export default app;
