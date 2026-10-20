// Domain fragments keep the review/merge contract readable while the published
// OpenAPI document remains a single portable file for clients and /docs.
import { readFileSync, writeFileSync } from "node:fs";

const path = new URL("./openapi.yaml", import.meta.url);
const spec = JSON.parse(readFileSync(path, "utf8"));
for (const name of ["import", "merge", "admin-audit"]) {
  const fragment = JSON.parse(readFileSync(new URL(`../../docs/${name}-contract.json`, import.meta.url), "utf8"));
  Object.assign(spec.paths, fragment.paths);
  Object.assign(spec.components.schemas, fragment.components.schemas);
  if (fragment.components.responses) {
    spec.components.responses ??= {};
    Object.assign(spec.components.responses, fragment.components.responses);
  }
}
writeFileSync(path, `${JSON.stringify(spec, null, 2)}\n`);
