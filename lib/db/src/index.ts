import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";
import { runtimeConnectionString } from "./runtime-connection";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// Fail closed if the seed bootstrap has not installed the restricted runtime role.
// Administrative import/migration scripts must use their own connection, not this pool.
export const pool = new Pool({
  connectionString: runtimeConnectionString(),
});
export const db = drizzle(pool, { schema });

export * from "./schema";
