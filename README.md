# nodeno

Run scripts on Node 26 with Deno-style `npm:` and `jsr:` imports. No `package.json` or `npm install` needed.

```ts
import chalk from "npm:chalk@5";
import { join } from "jsr:@std/path@^1";
```

```sh
nodeno [node flags] main.ts [args...]
# or, already on Node 26:
node --import nodeno/register main.ts
```

## How it works

- `bin/nodeno.mjs` finds a Node 26 binary (`$NODENO_NODE`, the current node, or `mise where node@26`) and re-execs with `--import src/register.mjs`.
- On launch, it scans the entry's local import graph for `npm:`/`jsr:` specifiers and installs them together into one shared tree under `~/.cache/nodeno/npm/<hash>`, so peer deps dedupe. Override the location with `$NODENO_DIR`.
- A `module.registerHooks` resolve hook rewrites each specifier to a bare import resolved from that tree. Specifiers the scan misses (computed dynamic imports, a second range of an already-used package) get installed lazily into their own tree.
- The same scan rejects references to `Deno` and `Bun` globals before anything installs or runs, with a location and a Node equivalent where there's an obvious one. Files that feature-detect (`typeof Deno`, `globalThis.Deno`) or declare their own `Deno` are skipped. Set `NODENO_SKIP_GLOBALS_CHECK=1` to bypass.
- `jsr:@scope/name` is fetched from JSR's npm registry (`npm.jsr.io`) as `@jsr/scope__name`.

Cache entries are keyed by the requested ranges and never refreshed, so `npm:foo` stays pinned to whatever `latest` was on first run. Delete the cache dir to re-resolve.
