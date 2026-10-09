// Detects references to runtime globals Node doesn't have (Deno, Bun), so a
// script fails before anything installs or runs instead of halfway through.

const UNAVAILABLE = ["Deno", "Bun"];

const HINTS = {
  "Deno.args": "process.argv.slice(2)",
  "Deno.env": "process.env",
  "Deno.exit": "process.exit()",
  "Deno.cwd": "process.cwd()",
  "Deno.readTextFile": 'readFile(path, "utf8") from "node:fs/promises"',
  "Deno.writeTextFile": 'writeFile(path, data) from "node:fs/promises"',
  "Deno.serve": '"node:http" createServer()',
  "Bun.file": '"node:fs/promises"',
  "Bun.serve": '"node:http" createServer()',
};

// Keywords after which `/` starts a regex literal rather than a division.
const REGEX_KEYWORDS = new Set([
  "return", "typeof", "instanceof", "in", "of", "new", "delete", "void",
  "throw", "case", "do", "else", "yield", "await",
]);

function regexAllowed(out, i) {
  let j = i - 1;
  while (j >= 0 && /\s/.test(out[j])) j--;
  if (j < 0) return true;
  if (/[\w$]/.test(out[j])) {
    let k = j;
    while (k >= 0 && /[\w$]/.test(out[k])) k--;
    return REGEX_KEYWORDS.has(out.slice(k + 1, j + 1).join(""));
  }
  // After a value (closing paren/bracket or a blanked string), `/` divides.
  return !")]\"'`".includes(out[j]);
}

/**
 * Replaces the contents of comments, strings, template text and regex
 * literals with spaces (newlines kept, so offsets and line numbers survive),
 * leaving only real code for identifier matching. A heuristic lexer, not a
 * parser, but it handles the cases that matter for spotting globals.
 */
export function blankNonCode(src) {
  const out = src.split("");
  const n = src.length;
  const blank = (from, to) => {
    for (let k = from; k < to && k < n; k++) if (out[k] !== "\n") out[k] = " ";
  };
  // One entry per open `{`: true if it opened a template `${` substitution.
  const braces = [];
  let i = 0;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === "/" && d === "/") {
      const end = src.indexOf("\n", i);
      const e = end === -1 ? n : end;
      blank(i, e);
      i = e;
    } else if (c === "/" && d === "*") {
      const end = src.indexOf("*/", i + 2);
      const e = end === -1 ? n : end + 2;
      blank(i, e);
      i = e;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && src[j] !== c && src[j] !== "\n") j += src[j] === "\\" ? 2 : 1;
      blank(i + 1, j);
      i = j + 1;
    } else if (c === "`" || (c === "}" && braces.at(-1) === true)) {
      if (c === "}") braces.pop();
      let j = i + 1;
      while (j < n && src[j] !== "`" && !(src[j] === "$" && src[j + 1] === "{")) {
        j += src[j] === "\\" ? 2 : 1;
      }
      blank(i + 1, j);
      if (src[j] === "$") {
        braces.push(true);
        i = j + 2;
      } else {
        i = j + 1;
      }
    } else if (c === "/" && regexAllowed(out, i)) {
      let j = i + 1;
      let inClass = false;
      while (j < n && src[j] !== "\n" && (inClass || src[j] !== "/")) {
        if (src[j] === "\\") j++;
        else if (src[j] === "[") inClass = true;
        else if (src[j] === "]") inClass = false;
        j++;
      }
      blank(i + 1, j);
      i = j + 1;
    } else {
      if (c === "{") braces.push(false);
      else if (c === "}") braces.pop();
      i++;
    }
  }
  return out.join("");
}

function position(source, index) {
  const before = source.slice(0, index);
  const line = before.split("\n").length;
  return { line, column: index - before.lastIndexOf("\n") };
}

/**
 * Returns every reference to an unavailable global in `files`
 * ([{ url, source }]). Files that declare the name themselves, or
 * feature-detect it (`typeof Deno`, `globalThis.Deno`), are skipped:
 * they're written to run on several runtimes.
 */
export function findUnavailableGlobals(files) {
  const problems = [];
  for (const { url, source } of files) {
    const code = blankNonCode(source);
    for (const name of UNAVAILABLE) {
      const declared = new RegExp(
        `\\b(?:const|let|var|function|class)\\s+${name}\\b|\\bimport\\b[^;]*\\b${name}\\b[^;]*\\bfrom\\b`,
      );
      const guarded = new RegExp(`\\btypeof\\s+${name}\\b|\\bglobalThis\\s*\\??\\.\\s*${name}\\b`);
      if (declared.test(code) || guarded.test(code)) continue;

      // A bare identifier: not a property (`x.Deno`) or object key (`{ Deno: 1 }`).
      const ref = new RegExp(`(?<![\\w$.])${name}(?![\\w$]|\\s*:(?!:))(?:\\s*\\??\\.\\s*([\\w$]+))?`, "g");
      for (const m of code.matchAll(ref)) {
        const member = m[1] ? `${name}.${m[1]}` : name;
        problems.push({ url, name, member, hint: HINTS[member], ...position(source, m.index) });
      }
    }
  }
  return problems;
}
