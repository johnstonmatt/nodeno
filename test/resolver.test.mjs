import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { parseSpecifier, scanGraph } from "../src/resolver.mjs";

test("parses npm specifiers", () => {
  assert.deepEqual(parseSpecifier("npm:chalk"), { name: "chalk", range: "latest", subpath: "" });
  assert.deepEqual(parseSpecifier("npm:chalk@^5.3"), { name: "chalk", range: "^5.3", subpath: "" });
  assert.deepEqual(parseSpecifier("npm:@types/node@26/fs"), {
    name: "@types/node",
    range: "26",
    subpath: "/fs",
  });
  assert.equal(parseSpecifier("node:fs"), null);
  assert.equal(parseSpecifier("./local.ts"), null);
});

test("maps jsr specifiers to the npm compatibility registry", () => {
  assert.deepEqual(parseSpecifier("jsr:@std/path@^1/posix"), {
    name: "@jsr/std__path",
    range: "^1",
    subpath: "/posix",
  });
  assert.throws(() => parseSpecifier("jsr:unscoped"), /must be scoped/);
});

test("collects specifiers across the local graph, skipping type-only imports", () => {
  const dir = mkdtempSync(join(tmpdir(), "nodeno-"));
  writeFileSync(
    join(dir, "main.ts"),
    `import type { Foo } from "npm:types-only@1";
     import a from "npm:a@1";
     export * from "./lib.ts";
     const b = await import("jsr:@x/b");`,
  );
  writeFileSync(join(dir, "lib.ts"), `import "npm:c"; import fs from "node:fs";`);
  const specs = scanGraph(pathToFileURL(join(dir, "main.ts")).href).specifiers.sort();
  assert.deepEqual(specs, ["jsr:@x/b", "npm:a@1", "npm:c"]);
});
