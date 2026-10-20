import pg from "pg";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { root } from "./seed-source";
import { runtimeConnectionString } from "@workspace/db/runtime-connection";

export function queries() {
  // import.meta.url changes when the API server is bundled; use the existing
  // checked-in exploration queries, never a second population mapping.
  const path = [root + "docs/data/exploration.sql", resolve("docs/data/exploration.sql"),
    resolve("../../docs/data/exploration.sql")].find(existsSync);
  if (!path) throw new Error("Demo population exploration queries are missing");
  return readFileSync(path, "utf8")
    .split(/-- (Q\d+):/).slice(1).reduce<{ id: string; sql: string }[]>((all, value, i, parts) => {
      if (i % 2 === 0) all.push({ id: value, sql: parts[i+1]!.replace(/^[^\n]*\n/, "") });
      return all;
    }, []);
}
export async function baseline(client: pg.Client) {
  const results: Record<string, pg.QueryResultRow[]> = {};
  for (const q of queries()) results[q.id] = (await client.query(q.sql)).rows;
  return results;
}
if (process.argv[1]?.endsWith("/baseline.ts")) {
  const client = new pg.Client({ connectionString: runtimeConnectionString() });
  await client.connect();
  try {
    await client.query("BEGIN READ ONLY");
    console.log(JSON.stringify(await baseline(client), null, 2));
    await client.query("COMMIT");
  } finally { await client.end(); }
}
