import { createHmac } from "node:crypto";

/** Login credentials are domain-separated from amal_app; RESET ROLE cannot
 * escape to the database administrator. No caller-provided connection options. */
export function resetConnectionString() {
  if (!process.env.DATABASE_URL || !process.env.SESSION_SECRET) {
    throw new Error("DATABASE_URL and SESSION_SECRET are required for restricted reset access");
  }
  const url = new URL(process.env.DATABASE_URL);
  for (const key of ["user", "password", "options"]) url.searchParams.delete(key);
  url.username = "amal_reset_login";
  url.password = createHmac("sha256", process.env.SESSION_SECRET)
    .update(`amal-reset-database-login:${url.pathname}`).digest("hex");
  return url.toString();
}
