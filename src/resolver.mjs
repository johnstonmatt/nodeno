// Resolves `npm:` and `jsr:` specifiers to packages installed in a global cache.
//
// On launch, the entry module's local import graph is scanned for npm:/jsr:
// specifiers and they're installed together into one shared tree, so peer
// deps (react + react-dom, etc.) dedupe the way they do in Deno. Anything the
// scan misses (computed dynamic imports, conflicting ranges) is installed
// lazily into its own isolated tree when first resolved.

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const CACHE_DIR = process.env.NODENO_DIR ?? join(homedir(), ".cache", "nodeno");
const JSR_REGISTRY = "https://npm.jsr.io";

const SPEC_RE = /^(@[^/@]+\/[^/@]+|[^/@]+)(?:@([^/]+))?(\/.*)?$/;

/**
 * Parses `npm:name@range/sub` or `jsr:@scope/name@range/sub` into the npm
 * package that serves it. JSR packages are fetched via JSR's npm
 * compatibility registry as `@jsr/scope__name`.
 */
export function parseSpecifier(specifier) {
  let protocol;
  if (specifier.startsWith("npm:")) protocol = "npm";
  else if (specifier.startsWith("jsr:")) protocol = "jsr";
  else return null;

  const rest = specifier.slice(4).replace(/^\//, "");
  const m = SPEC_RE.exec(rest);
  if (!m) throw new Error(`Invalid ${protocol}: specifier: ${specifier}`);
  let [, name, range = "latest", subpath = ""] = m;

  if (protocol === "jsr") {
    if (!name.startsWith("@")) throw new Error(`JSR packages must be scoped: ${specifier}`);
    name = `@jsr/${name.slice(1).replace("/", "__")}`;
  }
  return { name, range, subpath };
}

const IMPORT_RE =
  /\b(?:import|export)\s[^'"`;]*?\bfrom\s*(['"])([^'"]+)\1|\bimport\s*(['"])([^'"]+)\3|\b(?:import|require)\s*\(\s*(['"])([^'"]+)\5\s*\)/g;

function scanSpecifiers(source) {
  const out = [];
  for (const m of source.matchAll(IMPORT_RE)) out.push(m[2] ?? m[4] ?? m[6]);
  return out;
}

// Stripping drops `import type` lines so they don't trigger installs. Silences
// the one-time ExperimentalWarning, which would otherwise leak into user output.
function stripTypes(source) {
  const emitWarning = process.emitWarning;
  process.emitWarning = () => {};
  try {
    return stripTypeScriptTypes(source);
  } catch {
    // Non-erasable syntax; the regex scan copes with raw TS well enough.
    return source;
  } finally {
    process.emitWarning = emitWarning;
  }
}

/**
 * Walks local files reachable from `entryUrl`. Returns the npm:/jsr:
 * specifiers they import, plus each file's (type-stripped) source.
 */
export function scanGraph(entryUrl) {
  const found = new Set();
  const files = [];
  const seen = new Set();
  const queue = [entryUrl];
  while (queue.length) {
    const url = queue.pop();
    if (seen.has(url)) continue;
    seen.add(url);

    let source;
    try {
      source = readFileSync(fileURLToPath(url), "utf8");
    } catch {
      continue;
    }
    if (/\.[mc]?tsx?$/.test(url)) source = stripTypes(source);
    files.push({ url, source });

    for (const spec of scanSpecifiers(source)) {
      if (spec.startsWith("npm:") || spec.startsWith("jsr:")) found.add(spec);
      else if (/^(\.{1,2}\/|\/|file:)/.test(spec)) queue.push(new URL(spec, url).href);
    }
  }
  return { specifiers: [...found], files };
}

function npmBin() {
  const sibling = join(dirname(process.execPath), "npm");
  return existsSync(sibling) ? sibling : "npm";
}

/**
 * Installs `deps` ({ name: range }) into a cache dir keyed by their contents
 * and returns that dir. Installs into a temp dir and renames, so concurrent
 * launches don't trip over each other.
 */
function install(deps) {
  const key = JSON.stringify(Object.entries(deps).sort());
  const hash = createHash("sha256").update(key).digest("hex").slice(0, 16);
  const dir = join(CACHE_DIR, "npm", hash);
  if (existsSync(join(dir, "node_modules"))) return dir;

  const tmp = `${dir}.tmp-${process.pid}`;
  mkdirSync(tmp, { recursive: true });
  writeFileSync(
    join(tmp, "package.json"),
    JSON.stringify({ private: true, dependencies: deps }, null, 2),
  );
  writeFileSync(join(tmp, ".npmrc"), `@jsr:registry=${JSR_REGISTRY}\n`);

  const label = Object.entries(deps).map(([n, r]) => `${n}@${r}`).join(", ");
  process.stderr.write(`\x1b[32mDownload\x1b[0m ${label}\n`);
  try {
    execFileSync(npmBin(), ["install", "--no-audit", "--no-fund", "--loglevel=error"], {
      cwd: tmp,
      stdio: ["ignore", "ignore", "inherit"],
    });
  } catch (err) {
    rmSync(tmp, { recursive: true, force: true });
    throw new Error(`nodeno: failed to install ${label}`, { cause: err });
  }

  try {
    renameSync(tmp, dir);
  } catch {
    // Another process won the race; use its install.
    rmSync(tmp, { recursive: true, force: true });
  }
  return dir;
}

let shared = { dir: null, deps: {} };

/** Installs the entry's statically reachable npm:/jsr: dependencies into one tree. */
export function prepare(specifiers) {
  const deps = {};
  for (const spec of specifiers) {
    const { name, range } = parseSpecifier(spec);
    // First range wins the shared tree; conflicting ones get isolated installs.
    deps[name] ??= range;
  }
  if (Object.keys(deps).length) shared = { dir: install(deps), deps };
}

/** Maps an npm:/jsr: specifier to a bare specifier and the dir to resolve it from. */
export function locate(specifier) {
  const parsed = parseSpecifier(specifier);
  if (!parsed) return null;
  const { name, range, subpath } = parsed;
  const dir = shared.deps[name] === range ? shared.dir : install({ [name]: range });
  return {
    specifier: name + subpath,
    parentURL: pathToFileURL(join(dir, "package.json")).href,
  };
}
