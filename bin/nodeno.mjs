#!/usr/bin/env node
// nodeno [node flags] <entry> [args]
//
// Runs <entry> on Node 26 with npm:/jsr: specifier support. Works when invoked
// from any Node version: it locates a Node 26 binary and re-execs under it.

import { execFileSync, spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const NODE_MAJOR = 26;
const register = fileURLToPath(new URL("../src/register.mjs", import.meta.url));

function findNode() {
  if (process.env.NODENO_NODE) return process.env.NODENO_NODE;
  if (process.versions.node.split(".")[0] === String(NODE_MAJOR)) return process.execPath;
  try {
    const dir = execFileSync("mise", ["where", `node@${NODE_MAJOR}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return join(dir, "bin", "node");
  } catch {
    console.error(
      `nodeno: Node ${NODE_MAJOR} not found. Install it (\`mise install node@${NODE_MAJOR}\`) ` +
        `or point NODENO_NODE at a Node ${NODE_MAJOR} binary.`,
    );
    process.exit(1);
  }
}

const args = process.argv.slice(2);
// Leading --flags go to node; the first positional is the entry. Node flags
// that take a value must use the --flag=value form.
const entryIndex = args.findIndex((a) => !a.startsWith("-"));
if (entryIndex === -1) {
  console.error("usage: nodeno [node flags] <entry> [args...]");
  process.exit(1);
}
const nodeFlags = args.slice(0, entryIndex);
const rest = args.slice(entryIndex);

const result = spawnSync(findNode(), [...nodeFlags, "--import", register, ...rest], {
  stdio: "inherit",
});
if (result.error) throw result.error;
if (result.signal) process.kill(process.pid, result.signal);
process.exit(result.status ?? 1);
