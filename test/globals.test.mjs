import assert from "node:assert/strict";
import { test } from "node:test";
import { blankNonCode, findUnavailableGlobals } from "../src/globals.mjs";

const find = (source) =>
  findUnavailableGlobals([{ url: "file:///main.ts", source }]).map(
    ({ member, line, column }) => `${member}@${line}:${column}`,
  );

test("reports Deno and Bun references with positions", () => {
  assert.deepEqual(find(`const port = 8000;\nDeno.serve(() => new Response("hi"));\nBun.file("x");`), [
    "Deno.serve@2:1",
    "Bun.file@3:1",
  ]);
  assert.deepEqual(find(`const env = Deno?.env.get("X");`), ["Deno.env@1:13"]);
  assert.deepEqual(find(`const d = Deno;`), ["Deno@1:11"]);
});

test("ignores comments, strings, templates and regexes", () => {
  assert.deepEqual(
    find(`// Deno.exit()
/* Bun.serve */
const a = "Deno.env", b = 'Bun';
const c = \`Deno.args \${1 + 1} Bun.file\`;
const r = /Deno["']/g;
const half = 4 / 2; const q = "x" / 2; // Deno`),
    [],
  );
});

test("still sees code inside template substitutions", () => {
  assert.deepEqual(find("const t = `cwd: ${Deno.cwd()}`;"), ["Deno.cwd@1:19"]);
});

test("ignores properties, keys, declarations and feature detection", () => {
  assert.deepEqual(find(`runtimes.Deno.x; const o = { Deno: 1 };`), []);
  assert.deepEqual(find(`const Deno = shim(); Deno.env;`), []);
  assert.deepEqual(find(`import { Deno } from "./shim.ts"; Deno.env;`), []);
  assert.deepEqual(find(`if (typeof Deno !== "undefined") Deno.exit(0);`), []);
  assert.deepEqual(find(`const isDeno = !!globalThis.Deno; if (isDeno) Deno.exit(0);`), []);
});

test("blanking preserves length and newlines", () => {
  const src = `a // x\n"str", /re/ \`t\${b}t\``;
  const out = blankNonCode(src);
  assert.equal(out.length, src.length);
  assert.equal(out, `a     \n"   ", /  / \` \${b} \``);
});
