// Preload with `node --import nodeno/register main.ts` to enable npm:/jsr: imports.

import { registerHooks } from "node:module";
import { relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { findUnavailableGlobals } from "./globals.mjs";
import { locate, prepare, scanGraph } from "./resolver.mjs";

if (process.argv[1]) {
  const graph = scanGraph(pathToFileURL(resolve(process.argv[1])).href);

  if (!process.env.NODENO_SKIP_GLOBALS_CHECK) {
    const problems = findUnavailableGlobals(graph.files);
    if (problems.length) {
      for (const p of problems) {
        const where = `${relative(process.cwd(), fileURLToPath(p.url))}:${p.line}:${p.column}`;
        const hint = p.hint ? ` (use ${p.hint})` : "";
        process.stderr.write(
          `\x1b[31merror\x1b[0m: ${p.member} is not available in Node.js${hint}\n    at ${where}\n`,
        );
      }
      process.stderr.write("Set NODENO_SKIP_GLOBALS_CHECK=1 to run anyway.\n");
      process.exit(1);
    }
  }

  prepare(graph.specifiers);
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    const target = locate(specifier);
    if (!target) return nextResolve(specifier, context);
    return nextResolve(target.specifier, { ...context, parentURL: target.parentURL });
  },
});
