import { defineConfig } from "drizzle-kit";
import path from "path";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

export default defineConfig({
  // Introspection/generation only. Apply tracked SQL via operational:migrate;
  // push cannot reproduce deferred constraints, audit triggers or privileges.
  schema: path.join(__dirname, "./src/schema/operational-*.ts"),
  schemaFilter: ["operational"],
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
