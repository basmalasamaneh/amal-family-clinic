import { readFileSync } from "node:fs";
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import SwaggerParser from "@apidevtools/swagger-parser";
import { pathToFileURL } from "node:url";

// JSON is a YAML 1.2 subset. Keep this reader deliberately database-independent.
export const contractPath = new URL("./openapi.yaml", import.meta.url);
export const contract = JSON.parse(readFileSync(contractPath, "utf8"));
const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);
ajv.addSchema({ $id: "amal-contract", components: contract.components });
const cache = new Map();
export function validate(schema, value) {
  const key = JSON.stringify(schema);
  if (!cache.has(key)) {
    const absolute = JSON.parse(key.replaceAll("#/components/", "amal-contract#/components/"));
    cache.set(key, ajv.compile(absolute));
  }
  const check = cache.get(key);
  return { valid: check(value), errors: check.errors };
}
export function assertValid(schema, value, label) {
  const result = validate(schema, value);
  if (!result.valid) throw new Error(`${label}: ${JSON.stringify(result.errors)}`);
}
export async function validateContract() {
  await SwaggerParser.validate(structuredClone(contract));
  const ids = new Set();
  let examples = 0;
  for(const [name,schema] of Object.entries(contract.components.schemas)) {
    for(const example of schema.examples??[]) {
      assertValid({$ref:`#/components/schemas/${name}`},example,`Component ${name}`);
      examples++;
    }
  }
  for (const [path, methods] of Object.entries(contract.paths)) {
    for (const [method, operation] of Object.entries(methods)) {
      if (ids.has(operation.operationId)) throw new Error(`Duplicate operationId: ${operation.operationId}`);
      ids.add(operation.operationId);
      if (!operation.security || !operation["x-roles"]?.length) throw new Error(`Missing security/roles: ${path}`);
      for (const parameter of operation.parameters ?? []) {
        if (parameter.example !== undefined) {
          assertValid(parameter.schema, parameter.example, `${method} ${path} ${parameter.name}`);
          examples++;
        }
      }
      for (const content of [operation.requestBody?.content, ...Object.values(operation.responses).map(r=>r.content)]) {
        for (const media of Object.values(content ?? {})) {
          if (media.example === undefined) throw new Error(`Missing example: ${method} ${path}`);
          assertValid(media.schema, media.example, `${method} ${path}`);
          examples++;
        }
      }
    }
  }
  return { operations: ids.size, examples };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(await validateContract());
}
