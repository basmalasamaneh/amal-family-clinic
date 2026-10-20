import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import cookieParser from "cookie-parser";
import { ZodError } from "zod/v4";
import { ApiError, fail } from "./lib/auth-errors";
import { resolve } from "node:path";

const app: Express = express();
app.disable("x-powered-by");
// Only trust a known reverse-proxy hop count when deployment explicitly opts in.
const proxyHops = Number(process.env.AUTH_PROXY_HOPS ?? 0);
if (!Number.isInteger(proxyHops) || proxyHops < 0) throw new Error("Invalid AUTH_PROXY_HOPS");
app.set("trust proxy", proxyHops);
const origins = (process.env.AUTH_ALLOWED_ORIGINS ?? "").split(",").map(v => v.trim()).filter(Boolean);
if (process.env.NODE_ENV === "production" && (!origins.length || origins.some(v => !v.startsWith("https://")))) throw new Error("Production requires explicit HTTPS AUTH_ALLOWED_ORIGINS");
for (const origin of origins) if (new URL(origin).origin !== origin) throw new Error("AUTH_ALLOWED_ORIGINS must contain exact origins");
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
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0].replace(/\/doctor\/patients\/[^/]+/, "/doctor/patients/:id"),
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
app.use(cors({ origin: origins, credentials: true, allowedHeaders: ["Content-Type", "X-CSRF-Token"], methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"] }));
app.use(express.json({ limit: "32kb" }));
app.use(cookieParser());

// Resolve from either workspace-root or artifact working directory.
const specPath = resolve(process.cwd(), process.cwd().endsWith("artifacts/api-server") ? "../../lib/api-spec/openapi.yaml" : "lib/api-spec/openapi.yaml");
app.get("/docs/openapi.yaml", (_req, res) => { res.type("application/yaml").sendFile(specPath); });

app.use("/api", router);
app.use((_req, _res, next) => { next(fail(404, "NOT_FOUND", "notFound")); });
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const invalid = error instanceof ZodError || (error instanceof SyntaxError && "body" in error) || (typeof error === "object" && error !== null && "type" in error && error.type === "entity.too.large");
  const safe = error instanceof ApiError ? error : invalid ? fail(400, "VALIDATION", "validation") : fail(500, "INTERNAL", "internal");
  // Never serialize raw exceptions: database errors can contain credentials/query values.
  if (safe.status === 500) logger.error({ code: safe.code }, "Request failed");
  if (safe.params.retryAfterSeconds) res.set("Retry-After", String(safe.params.retryAfterSeconds));
  res.status(safe.status).json({ code: safe.code, messageKey: `error.${safe.key}`, params: safe.params });
});

export default app;
