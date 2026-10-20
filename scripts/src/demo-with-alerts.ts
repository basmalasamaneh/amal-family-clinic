import { execFileSync } from "node:child_process";
import { root } from "./seed-source";
import { requireDemo } from "./operational-support";

// Composition only: keep existing seed/populate/reset implementations unchanged.
// Fail before demo writes if the caller has not installed the alert prerequisite.
requireDemo();
const [action, ...args] = process.argv.slice(2);
if (action !== "populate" && action !== "reset") throw new Error("Unknown demo action");
execFileSync("pnpm", ["--filter", "@workspace/api-server", "alerts:migrate"], { cwd: root, stdio: "inherit" });
execFileSync("pnpm", ["--filter", "@workspace/scripts", "exec", "tsx", `src/demo-${action}.ts`, ...args],
  { cwd: root, stdio: "inherit" });
execFileSync("pnpm", ["--filter", "@workspace/api-server", "alerts:extract", "--initialize"],
  { cwd: root, stdio: "inherit" });
