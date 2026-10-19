import { createHmac } from "node:crypto";

/**
 * Separate login identity for the application. Never authenticate the runtime
 * pool as the database administrator then SET ROLE: RESET ROLE would escape it.
 * The bootstrap installs this password; no credential is persisted in source.
 */
export function runtimeConnectionString() {
  if (!process.env.DATABASE_URL || !process.env.SESSION_SECRET) {
    throw new Error("DATABASE_URL and SESSION_SECRET are required for restricted database access");
  }
  const url = new URL(process.env.DATABASE_URL);
  // pg parses query-string credentials ahead of URL authority credentials.
  for (const key of ["user", "password", "options"]) url.searchParams.delete(key);
  const password = createHmac("sha256", process.env.SESSION_SECRET)
    .update(`amal-app-database-login:${url.pathname}`).digest("hex");
  url.username = "amal_app";
  url.password = password;
  return url.toString();
}
