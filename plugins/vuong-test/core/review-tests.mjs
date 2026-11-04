#!/usr/bin/env node
// Review tests that already exist (written by a dev, by TDD tooling, by an older run) before trusting them.
//
//   node review-tests.mjs <file|dir>... [--cases W/cases.md] [--out W/existing-tests.md]
//
// Static and read-only: reads the given test files (and cases.md), writes only --out. No network, no env.
// JS/TS (Jest, Vitest, Mocha, Playwright, node:assert, chai) and Java (JUnit 4/5, AssertJ, Hamcrest,
// Mockito, MockMvc). Findings per test:
//   error  no-assert       nothing is checked
//   error  tautology       the expected value is computed by the same call as the actual value,
//                          or by a function imported from the code under test
//   error  mocked-subject  the unit under test is mocked in its own test file
//   error  swallowed       a catch block in the test hides failures
//   warn   weak-assert     only weak checks (truthy, defined, not null, does not throw, status 2xx, snapshot)
//   warn   calls-only      only mock calls are checked, no result
//   warn   skipped / only  the test does not run / makes the other tests in the file not run
//   info   untagged        no [ID] tag: its result cannot be linked to a case
//   info   via-helper      no check in the body, but a helper named assert…/expect…/check… is called
// With --cases: which cases have a tagged test, which have none, tags that are not in cases.md.
// Whether an asserted value matches the case's Expected is judged by a person; the report shows both.
// Heuristic: a finding is a lead to read the test, not a verdict. Exit 1 when any error finding exists.
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { parseCases, tagsOf } from "./parsers.mjs";

const argv = process.argv.slice(2);
const VALUED = ["--cases", "--out"];
const opt = (k) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : undefined);
const inputs = argv.filter((a, i) => !a.startsWith("--") && !VALUED.includes(argv[i - 1]));
if (!inputs.length) {
  console.error("usage: review-tests.mjs <file|dir>... [--cases W/cases.md] [--out W/existing-tests.md]");
  process.exit(2);
}
const casesFile = opt("--cases");
const outFile = opt("--out");

// ── files ────────────────────────────────────────────────────────────────────
const SKIP_DIRS = new Set(["node_modules", ".git", "target", "dist", "build", "coverage", ".next", ".gradle"]);
const TEST_FILE = /(\.(test|spec)\.[cm]?[jt]sx?$)|((Test|Tests|IT|TestCase)\.java$)|(^Test[A-Z]\w*\.java$)/;
const langOf = (f) => (/\.java$/.test(f) ? "java" : /\.[cm]?[jt]sx?$/.test(f) ? "js" : null);
const rel = (f) => path.relative(process.cwd(), f).split(path.sep).join("/");

function walk(dir, acc) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walk(p, acc);
    } else if (TEST_FILE.test(e.name) || (/[\\/]__tests__[\\/]/.test(p) && langOf(p))) acc.push(p);
  }
  return acc;
}
const files = [];
const unsupported = [];
for (const p of inputs) {
  let st;
  try {
    st = statSync(p);
  } catch {
    console.error(`not found: ${p}`);
    process.exit(2);
  }
  if (st.isDirectory()) files.push(...walk(p, []));
  else if (langOf(p)) files.push(p);
  else unsupported.push(p);
}

// ── source scanning (comments blanked, strings kept, offsets preserved) ──────
function endOfString(s, i) {
  const q = s[i];
  for (let k = i + 1; k < s.length; k++) {
    if (s[k] === "\\") {
      k++;
      continue;
    }
    if (s[k] === q) return k;
    if (q !== "`" && s[k] === "\n") return k; // unterminated (or a regex / char literal): stop at line end
  }
  return s.length - 1;
}
function blankComments(src) {
  const out = [];
  for (let i = 0; i < src.length; ) {
    const ch = src[i];
    const nx = src[i + 1];
    if (ch === "/" && nx === "/") {
      let e = src.indexOf("\n", i);
      if (e < 0) e = src.length;
      out.push(" ".repeat(e - i));
      i = e;
    } else if (ch === "/" && nx === "*") {
      let e = src.indexOf("*/", i + 2);
      e = e < 0 ? src.length : e + 2;
      out.push(src.slice(i, e).replace(/[^\n]/g, " "));
      i = e;
    } else if (ch === '"' || ch === "'" || ch === "`") {
      const e = endOfString(src, i) + 1;
      out.push(src.slice(i, e));
      i = e;
    } else {
      out.push(ch);
      i++;
    }
  }
  return out.join("");
}
/** index of the bracket closing src[open] ("(" "{" "["), skipping strings; -1 when unbalanced */
function closeOf(s, open) {
  const o = s[open];
  const c = { "(": ")", "{": "}", "[": "]" }[o];
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    const ch = s[i];
    if (ch === '"' || ch === "'" || ch === "`") i = endOfString(s, i);
    else if (ch === o) depth++;
    else if (ch === c && --depth === 0) return i;
  }
  return -1;
}
/** top-level comma split of an argument list */
function splitArgs(s) {
  const out = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '"' || ch === "'" || ch === "`") i = endOfString(s, i);
    else if ("([{".includes(ch)) depth++;
    else if (")]}".includes(ch)) depth--;
    else if (ch === "," && depth === 0) {
      out.push(s.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(s.slice(start).trim());
  return out.filter(Boolean);
}
const lineIndex = (src) => {
  const starts = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === "\n") starts.push(i + 1);
  return (idx) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= idx) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
};
const norm = (s) => s.replace(/\s+/g, "");
const short = (s, n = 40) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

// ── tautology ────────────────────────────────────────────────────────────────
// Names that build values without running the code under test.
const NEUTRAL = new Set(
  ("expect any anything objectContaining arrayContaining stringContaining stringMatching closeTo " +
    "String Number Boolean BigInt Date Array Object Set Map Symbol RegExp Math JSON Promise of from parse stringify " +
    "require is equalTo asList List valueOf toString toFixed new BigDecimal BigInteger LocalDate LocalDateTime " +
    "Instant Optional UUID Arrays Collections fn mock jsonPath status content contains hasSize hasItem not " +
    "nullValue notNullValue instanceOf class trim toLowerCase toUpperCase").split(" ")
);
function callsIn(s) {
  const names = new Set();
  const recv = new Set();
  for (const m of s.matchAll(/(?:([A-Za-z_$][\w$]*)\s*\.\s*)?([A-Za-z_$][\w$]*)\s*\(/g)) {
    if (!NEUTRAL.has(m[2])) names.add(m[2]);
    if (m[1]) recv.add(m[1]);
  }
  return { names, recv };
}
function tautology(actual, expected, imported) {
  if (!expected || !actual) return "";
  if (norm(actual) === norm(expected)) return "expected and actual are the same expression";
  const a = callsIn(actual);
  const b = callsIn(expected);
  const same = [...b.names].find((n) => a.names.has(n));
  if (same) return `expected value calls ${same}() like the actual value`;
  const imp = [...b.names, ...b.recv].find((n) => imported.has(n));
  if (imp) return `expected value is computed by ${imp} from the code under test`;
  return "";
}

// ── JS / TS ──────────────────────────────────────────────────────────────────
const NAME_RE = /^\s*(['"`])((?:\\.|(?!\1)[\s\S])*)\1/;
const EACH = String.raw`(?:\.each\s*(?:` + "`[^`]*`" + String.raw`|\([^)]*\))\s*)?`;
const JS_TEST = new RegExp(String.raw`(^|[^\w.$])(it|test|xit|xtest|fit)((?:\.(?:skip|only|todo|concurrent|failing|fails))*)${EACH}\s*\(`, "g");
const JS_DESC = new RegExp(String.raw`(^|[^\w.$])(describe|xdescribe|fdescribe|suite|context|test\.describe)((?:\.(?:skip|only|serial|parallel))*)${EACH}\s*\(`, "g");

function jsBlocks(src, re) {
  const out = [];
  for (const m of src.matchAll(re)) {
    const open = m.index + m[0].length - 1;
    const close = closeOf(src, open);
    if (close < 0) continue;
    const args = src.slice(open + 1, close);
    const nm = args.match(NAME_RE);
    if (!nm) continue;
    out.push({ kw: m[2], mods: m[3] || "", at: m.index + m[1].length, open, close, name: nm[2], body: args.slice(nm[0].length) });
  }
  return out;
}
function jsImports(src) {
  const names = new Set();
  const local = (p) => /^(\.|@\/|~\/|src\/)/.test(p) && !/(__mocks__|mock|fixture|stub|fake|test-?utils?|testing)/i.test(p);
  for (const m of src.matchAll(/\bimport\s+([\w$*{}\s,]+?)\s+from\s+['"]([^'"]+)['"]/g)) {
    if (!local(m[2])) continue;
    const rest = m[1].replace(/\{([^}]*)\}/, (_, inner) => {
      for (const s of inner.split(",")) {
        const p = s.trim().replace(/^type\s+/, "").split(/\s+as\s+/);
        if (p[p.length - 1]) names.add(p[p.length - 1].trim());
      }
      return "";
    });
    for (const s of rest.split(",")) {
      const t = s.trim().replace(/^\*\s+as\s+/, "");
      if (/^[A-Za-z_$][\w$]*$/.test(t) && t !== "type") names.add(t);
    }
  }
  for (const m of src.matchAll(/\b(?:const|let|var)\s+(\{[^}]*\}|[A-Za-z_$][\w$]*)\s*=\s*require\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    if (!local(m[2])) continue;
    for (const s of m[1].replace(/[{}]/g, "").split(",")) {
      const t = s.split(":").pop().trim();
      if (t) names.add(t);
    }
  }
  return names;
}

const JS_CALL = /^(toHaveBeenCalled|toHaveBeenCalledTimes|toHaveBeenCalledWith|toHaveBeenLastCalledWith|toHaveBeenNthCalledWith|toBeCalled|toBeCalledWith|toBeCalledTimes|toHaveReturned|toHaveReturnedTimes|toHaveReturnedWith|calledWith|calledOnce|called)$/;
const JS_SNAP = /^(toMatchSnapshot|toMatchInlineSnapshot|toThrowErrorMatchingSnapshot|toThrowErrorMatchingInlineSnapshot|toHaveScreenshot)$/;
const JS_WEAK = /^(toBeTruthy|toBeDefined|ok|exist|exists|defined|toBeInstanceOf|instanceOf|instanceof)$/;
const JS_WEAK_NOT = /^(toBeNull|toBeUndefined|toThrow|toBeNaN|toBeFalsy|toBe|toEqual|toStrictEqual|null|undefined|equal|eq|throw)$/;
const STATUS_2XX = (actual, expected) => /\b(status|statusCode)\b/.test(actual) && /^\s*2\d\d\s*$/.test(expected);

function classify({ matcher, negated, actual, expected, text, imported }) {
  if (JS_CALL.test(matcher)) return { kind: "call", text };
  if (JS_SNAP.test(matcher)) return { kind: "snapshot", text: `${text} (expected recorded from the code)` };
  const weak =
    JS_WEAK.test(matcher) ||
    (negated && JS_WEAK_NOT.test(matcher)) ||
    (/^(toThrow|throw|throws|rejects?)$/.test(matcher) && !expected.trim()) ||
    /^\s*expect\s*\.\s*anything\s*\(\s*\)\s*$/.test(expected) ||
    STATUS_2XX(actual, expected);
  return { kind: weak ? "weak" : "strong", text, taut: tautology(actual, expected, imported) };
}

function jsAsserts(body, imported) {
  const out = [];
  for (const m of body.matchAll(/(^|[^\w.$])expect\s*\(/g)) {
    const open = m.index + m[0].length - 1;
    const close = closeOf(body, open);
    if (close < 0) continue;
    const actual = body.slice(open + 1, close);
    const after = body.slice(close + 1);
    const chain = after.match(/^((?:\s*\.\s*[A-Za-z_$][\w$]*)+)(\s*\()?/);
    if (!chain) {
      out.push({ kind: "weak", text: `expect(${short(actual, 20)}) without matcher` });
      continue;
    }
    const words = chain[1].replace(/\s/g, "").split(".").filter(Boolean);
    const matcher = words[words.length - 1];
    const negated = words.includes("not");
    let expected = "";
    if (chain[2]) {
      const bOpen = close + 1 + chain[0].length - 1;
      const bClose = closeOf(body, bOpen);
      expected = bClose < 0 ? "" : body.slice(bOpen + 1, bClose);
    }
    const text = `${negated ? "not." : ""}${matcher}(${short(expected, 24)})`;
    out.push(classify({ matcher, negated, actual, expected, text, imported, js: true }));
  }
  // node:assert / chai assert: assert(x), assert.equal(actual, expected), assert.isDefined(x) ...
  for (const m of body.matchAll(/(^|[^\w.$])assert(?:\s*\.\s*(\w+))?\s*\(/g)) {
    const open = m.index + m[0].length - 1;
    const close = closeOf(body, open);
    if (close < 0) continue;
    const args = splitArgs(body.slice(open + 1, close));
    const fn = m[2] || "ok";
    const weak = /^(isDefined|isNotNull|isNotUndefined|exists|isOk|doesNotThrow|doesNotReject|notEqual|notStrictEqual|notDeepEqual|notDeepStrictEqual|isNotEmpty|instanceOf)$/.test(fn)
      || (/^(throws|rejects)$/.test(fn) && args.length < 2);
    const pair = /equal|Equal|match|include/i.test(fn) && args.length >= 2;
    const taut = pair ? tautology(args[0], args[1], imported) : "";
    out.push({ kind: weak ? "weak" : "strong", text: `assert.${fn}(${short(pair ? args[1] : args[0] || "", 24)})`, taut });
  }
  // vuong-test kits: verify(what, expected, actual)
  for (const m of body.matchAll(/(^|[^\w.$])verify\s*\(/g)) {
    const open = m.index + m[0].length - 1;
    const close = closeOf(body, open);
    if (close < 0) continue;
    const args = splitArgs(body.slice(open + 1, close));
    out.push({ kind: "strong", text: `verify(${short(args[1] || "", 24)})`, taut: tautology(args[2] || "", args[1] || "", imported) });
  }
  return out;
}

function jsTests(file, src) {
  const imported = jsImports(src);
  const descs = jsBlocks(src, JS_DESC);
  const line = lineIndex(src);
  const base = path.basename(file).replace(/\.(test|spec)\.[cm]?[jt]sx?$/, "");
  const fileFindings = [];
  for (const m of src.matchAll(/\b(?:jest|vi)\s*\.\s*(?:mock|doMock|unstable_mockModule)\s*\(\s*['"`]([^'"`]+)['"`]/g)) {
    const stem = m[1].split("/").pop().replace(/\.[cm]?[jt]sx?$/, "");
    if (base && stem === base)
      fileFindings.push({ sev: "error", code: "mocked-subject", msg: `${m[1]} (the module this file tests) is mocked`, line: line(m.index) });
  }
  return jsBlocks(src, JS_TEST).map((t) => {
    const outer = descs.filter((d) => d.open < t.open && t.close < d.close);
    const tags = [...new Set([...outer.flatMap((d) => tagsOf(d.name)), ...tagsOf(t.name)])];
    const skipped = /^x/.test(t.kw) || /\.(skip|todo)/.test(t.mods) || outer.some((d) => /^x/.test(d.kw) || /\.skip/.test(d.mods));
    const only = /^f/.test(t.kw) || /\.only/.test(t.mods) || outer.some((d) => /^f/.test(d.kw) || /\.only/.test(d.mods));
    const asserts = jsAsserts(t.body, imported);
    if (!asserts.length && /(^|[^\w.$])(getBy|getAllBy|findBy|findAllBy)\w*\s*\(/.test(t.body))
      asserts.push({ kind: "weak", text: "only implicit getBy/findBy queries" });
    return {
      file, line: line(t.at), name: t.name, tags, skipped, only, body: t.body, asserts, fileFindings,
      full: [...outer.map((d) => d.name), t.name].join(" › "),
    };
  });
}

// ── Java ─────────────────────────────────────────────────────────────────────
const J_WEAK_THAT = /^(isNotNull|isNotEmpty|isNotBlank|isInstanceOf|doesNotThrowAnyException|isNotEqualTo|hasNoNullFieldsOrProperties|isNotSameAs|exists)$/;

function javaAsserts(body) {
  const out = [];
  const re = /(^|[^\w$])(assert(?:Equals|NotEquals|Same|NotSame|ArrayEquals|IterableEquals|LinesMatch|True|False|Null|NotNull|Throws|ThrowsExactly|DoesNotThrow|That)|verify|verifyNoInteractions|verifyNoMoreInteractions|verifyZeroInteractions|andExpect)\s*\(/g;
  for (const m of body.matchAll(re)) {
    const fn = m[2];
    const open = m.index + m[0].length - 1;
    const close = closeOf(body, open);
    if (close < 0) continue;
    const inner = body.slice(open + 1, close);
    const args = splitArgs(inner);
    const isStr = (s) => /^"/.test(s || "");
    if (/^verify/.test(fn)) {
      out.push({ kind: "call", text: `${fn}(${short(inner, 20)})` });
    } else if (fn === "andExpect") {
      const weak = /status\(\)\s*\.\s*is(Ok|Created|Accepted|NoContent|2xxSuccessful)\s*\(|status\(\)\s*\.\s*is\(\s*2\d\d\s*\)|\.exists\(\)|isNotEmpty\(\)/.test(inner);
      out.push({ kind: weak ? "weak" : "strong", text: `andExpect(${short(inner, 24)})` });
    } else if (/^assert(Equals|ArrayEquals|IterableEquals|Same|LinesMatch)$/.test(fn)) {
      let e = 0;
      let a = 1;
      if (args.length >= 3 && !isStr(args[args.length - 1]) && isStr(args[0])) {
        e = 1; // JUnit 4: (message, expected, actual)
        a = 2;
      }
      out.push({ kind: "strong", text: `${fn}(${short(args[e] || "", 24)}, …)`, taut: tautology(args[a] || "", args[e] || "", new Set()) });
    } else if (fn === "assertThat") {
      const chain = body.slice(close + 1).match(/^\s*\.\s*(\w+)\s*\(/);
      if (chain) {
        const bOpen = close + 1 + chain[0].length - 1;
        const bClose = closeOf(body, bOpen);
        const expected = bClose < 0 ? "" : body.slice(bOpen + 1, bClose);
        out.push({
          kind: J_WEAK_THAT.test(chain[1]) ? "weak" : "strong",
          text: `assertThat(…).${chain[1]}(${short(expected, 24)})`,
          taut: tautology(args[0] || "", expected, new Set()),
        });
      } else if (args.length >= 2) {
        const matcher = args[args.length - 1];
        const weak = /notNullValue|not\s*\(\s*nullValue|instanceOf|isA\s*\(/.test(matcher);
        const mInner = matcher.replace(/^\w+\s*\(([\s\S]*)\)$/, "$1");
        out.push({ kind: weak ? "weak" : "strong", text: `assertThat(…, ${short(matcher, 24)})`, taut: tautology(args[args.length - 2], mInner, new Set()) });
      } else out.push({ kind: "weak", text: "assertThat(…) without matcher" });
    } else {
      const arg = args[args.length > 1 && isStr(args[0]) && /True|False|Null/.test(fn) ? 1 : 0] || "";
      const weak =
        /^(assertNotNull|assertDoesNotThrow|assertNotEquals|assertNotSame)$/.test(fn) ||
        (fn === "assertTrue" && (/!=\s*null|^\s*true\s*$/.test(arg))) ||
        (fn === "assertFalse" && (/==\s*null|^\s*false\s*$/.test(arg))) ||
        (/^assertThrows/.test(fn) && /^(Exception|Throwable|RuntimeException)\.class$/.test(args[0] || ""));
      out.push({ kind: weak ? "weak" : "strong", text: `${fn}(${short(args[0] || "", 24)})` });
    }
  }
  for (const m of body.matchAll(/\bthen\s*\([^)]*\)\s*\.\s*should\b/g)) out.push({ kind: "call", text: short(m[0], 30) });
  if (/\bfail\s*\(/.test(body) && /\bcatch\s*\(/.test(body)) out.push({ kind: "strong", text: "expects an exception (try / fail / catch)" });
  return out;
}

function javaTests(file, src) {
  const line = lineIndex(src);
  const cls = src.match(/\bclass\s+(\w+)/);
  const classSkipped = !!cls && /@(Disabled|Ignore)\b/.test(src.slice(0, cls.index));
  const subject = cls ? cls[1].replace(/(Tests?|IT|TestCase)$/, "").replace(/^Test(?=[A-Z])/, "") : "";
  const fileFindings = [];
  if (subject && cls && subject !== cls[1]) {
    const mocked = new RegExp(String.raw`@(Mock|MockBean|MockitoBean)\b[^;{}]*?\b${subject}\s+\w+\s*;|\bmock\s*\(\s*${subject}\.class`);
    const mm = src.match(mocked);
    if (mm) fileFindings.push({ sev: "error", code: "mocked-subject", msg: `${subject} (the class this file tests) is mocked`, line: line(mm.index) });
  }
  const out = [];
  const seen = new Set();
  for (const m of src.matchAll(/@(Test|ParameterizedTest|RepeatedTest|TestTemplate)\b/g)) {
    const hm = /\bvoid\s+(\w+)\s*\(/g;
    hm.lastIndex = m.index;
    const h = hm.exec(src);
    if (!h || seen.has(h.index)) continue;
    seen.add(h.index);
    const pOpen = h.index + h[0].length - 1;
    const pClose = closeOf(src, pOpen);
    const bOpen = pClose < 0 ? -1 : src.indexOf("{", pClose);
    const bClose = bOpen < 0 ? -1 : closeOf(src, bOpen);
    if (bClose < 0) continue;
    const before = src.slice(0, m.index);
    const start = Math.max(before.lastIndexOf(";"), before.lastIndexOf("}"), before.lastIndexOf("{")) + 1;
    const region = src.slice(start, h.index);
    const dn = region.match(/@DisplayName\s*\(\s*"((?:\\.|[^"])*)"/);
    const name = dn ? dn[1] : h[1];
    const body = src.slice(bOpen + 1, bClose);
    const asserts = javaAsserts(body);
    if (/@Test\s*\(\s*[^)]*\bexpected\s*=/.test(region)) asserts.push({ kind: "strong", text: "@Test(expected = …)" });
    out.push({
      file, line: line(start + (region.length - region.trimStart().length)), name, full: name, method: h[1],
      tags: tagsOf(name), skipped: classSkipped || /@(Disabled|Ignore)\b/.test(region), only: false, body, asserts, fileFindings,
    });
  }
  return out;
}

// ── findings ─────────────────────────────────────────────────────────────────
function findings(t) {
  const f = [];
  const kinds = t.asserts.map((a) => a.kind);
  for (const a of t.asserts) if (a.taut) f.push({ sev: "error", code: "tautology", msg: `${a.text}: ${a.taut}` });
  if (!kinds.length) {
    const helper = t.body.match(/(^|[^\w.$])((?:assert|expect|verify|check|should)[A-Z_]\w*)\s*\(/);
    if (helper) f.push({ sev: "info", code: "via-helper", msg: `no check in the body; ${helper[2]}() may assert — read it` });
    else if (!t.skipped) f.push({ sev: "error", code: "no-assert", msg: "nothing is checked" });
  } else if (!kinds.includes("strong")) {
    if (kinds.every((k) => k === "call")) f.push({ sev: "warn", code: "calls-only", msg: "only mock calls are checked, not the result" });
    else f.push({ sev: "warn", code: "weak-assert", msg: `no value is checked (${t.asserts.map((a) => a.text).join("; ")})` });
  }
  for (const m of t.body.matchAll(/\bcatch\s*(?:\([^)]*\))?\s*\{/g)) {
    const open = m.index + m[0].length - 1;
    const close = closeOf(t.body, open);
    const inner = close < 0 ? "" : t.body.slice(open + 1, close);
    if (!/\b(expect|assert\w*|fail|throw|verify|rethrow)\b/.test(inner) && !/\bfail\s*\(/.test(t.body))
      f.push({ sev: "error", code: "swallowed", msg: "a catch block hides failures" });
  }
  for (const m of t.body.matchAll(/\.catch\s*\(/g)) {
    const open = m.index + m[0].length - 1;
    const close = closeOf(t.body, open);
    const inner = close < 0 ? "" : t.body.slice(open + 1, close);
    if (!/\b(expect|assert\w*|fail|throw)\b/.test(inner)) f.push({ sev: "error", code: "swallowed", msg: ".catch() hides failures" });
  }
  if (t.skipped) f.push({ sev: "warn", code: "skipped", msg: "does not run" });
  if (t.only) f.push({ sev: "warn", code: "only", msg: ".only / f-prefix: the other tests in this file do not run" });
  if (!t.tags.length) f.push({ sev: "info", code: "untagged", msg: "no [ID] tag" });
  return f;
}

const tests = [];
const fileFindings = []; // reported once per file, not per test
for (const file of files) {
  const src = blankComments(readFileSync(file, "utf8"));
  const lang = langOf(file);
  const found = lang === "java" ? javaTests(file, src) : jsTests(file, src);
  for (const t of found) tests.push({ ...t, lang, findings: findings(t) });
  for (const ff of found[0]?.fileFindings || []) fileFindings.push({ ...ff, file, tests: found.length });
}

// ── cases ────────────────────────────────────────────────────────────────────
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
let C = null;
if (casesFile) {
  C = parseCases(casesFile);
  for (const c of C.cases) c.aliases = c.id.split(/\s*\/\s*/).filter(Boolean);
  const known = new Map(C.cases.flatMap((c) => c.aliases.map((a) => [a, c])));
  for (const t of tests) {
    const hits = new Set();
    for (const c of C.cases)
      if (c.aliases.some((a) => t.tags.includes(a) || new RegExp(`(^|[^A-Za-z0-9])${esc(a)}([^A-Za-z0-9]|$)`).test(t.method || "")))
        hits.add(c);
    t.cases = [...hits];
    t.unknownTags = t.tags.filter((g) => !known.has(g));
    if (t.cases.length) t.findings = t.findings.filter((f) => f.code !== "untagged");
  }
  for (const c of C.cases) c.tests = tests.filter((t) => t.cases.includes(c));
}

// ── output ───────────────────────────────────────────────────────────────────
const count = (sev) => tests.reduce((n, t) => n + t.findings.filter((f) => f.sev === sev && f.code !== "untagged").length, 0);
const errors = count("error") + fileFindings.filter((f) => f.sev === "error").length;
const warns = count("warn");
const untagged = tests.filter((t) => t.findings.some((f) => f.code === "untagged")).length;
const where = (t) => `${rel(t.file)}:${t.line}`;

for (const f of fileFindings) console.log(`error ${rel(f.file)}:${f.line}  (whole file, ${f.tests} tests) — ${f.code}: ${f.msg}`);
for (const t of tests)
  for (const f of t.findings.filter((x) => x.sev !== "info"))
    console.log(`${f.sev === "error" ? "error" : "warn "} ${rel(t.file)}:${f.line || t.line}  ${short(t.name, 50)} — ${f.code}: ${f.msg}`);

if (outFile) {
  const cell = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
  const mark = { strong: "✓", weak: "~", call: "⇢", snapshot: "~", query: "~" };
  const L = [];
  const byLang = (l) => tests.filter((t) => t.lang === l).length;
  L.push("# Existing tests — review", "");
  L.push(`- Scanned: ${files.length} files, ${tests.length} tests (js/ts ${byLang("js")}, java ${byLang("java")}) · ${new Date().toISOString().slice(0, 10)} · \`core/review-tests.mjs\``);
  L.push(`- Errors: ${errors} · warnings: ${warns} · untagged: ${untagged}`);
  if (C) {
    const covered = C.cases.filter((c) => c.tests.length).length;
    L.push(`- Cases: \`${rel(casesFile)}\` — ${covered}/${C.cases.length} have a tagged test`);
  }
  L.push(
    "",
    "Asserts: ✓ value checked · ~ weak check · ⇢ mock call. Findings are leads, not verdicts: read the test.",
    "Filled by the reviewer (`references/review-tests.md` › Existing tests): **Case** (proposed for untagged tests, the",
    "user confirms), **Matches Expected?** (the asserted value vs the case's Expected: yes / no: <asserted> ≠ <expected> /",
    "no value), **Decision** (keep · tag <ID> · fix · delete · keep as dev test), decided by a named person.",
    "",
    "## Tests",
    "",
    "| # | Test | file:line | Tags | Asserts | Findings | Case | Matches Expected? | Decision |",
    "|---|---|---|---|---|---|---|---|---|"
  );
  tests.forEach((t, i) => {
    const asserts = t.asserts.length ? t.asserts.slice(0, 4).map((a) => `${mark[a.kind]} ${a.text}`).join("; ") + (t.asserts.length > 4 ? ` (+${t.asserts.length - 4})` : "") : "—";
    const fs = t.findings.filter((f) => f.code !== "untagged").map((f) => `${f.sev} ${f.code}: ${f.msg}`).join("; ") || "—";
    const cs = t.cases?.length ? t.cases.map((c) => c.aliases[0]).join(", ") : "";
    L.push(`| T${i + 1} | ${cell(short(t.full, 70))} | ${where(t)} | ${cell(t.tags.join(", ") || "—")} | ${cell(asserts)} | ${cell(fs)} | ${cell(cs)} |  |  |`);
  });
  if (fileFindings.length) {
    L.push("", "## File findings", "", "Apply to every test in the file.", "");
    for (const f of fileFindings) L.push(`- ${rel(f.file)}:${f.line} — ${f.sev} ${f.code}: ${f.msg} (${f.tests} tests)`);
  }
  if (C) {
    const without = C.cases.filter((c) => !c.tests.length);
    L.push("", "## Cases without a tagged test", "");
    if (!without.length) L.push("None.");
    else {
      L.push("An untagged test above may cover one: propose it in the Case column. Otherwise the case needs a new test (step 6).", "");
      L.push("| ID | Layer | Expected |", "|---|---|---|");
      for (const c of without) L.push(`| ${cell(c.id)} | ${cell(c.layer)} | ${cell(short(c.expected, 80))} |`);
    }
    const unknown = tests.flatMap((t) => (t.unknownTags || []).map((g) => `- \`${g}\` — ${short(t.name, 60)} (${where(t)})`));
    L.push("", "## Tags not in cases.md", "", ...(unknown.length ? unknown : ["None."]));
  }
  if (unsupported.length) L.push("", "## Not reviewed", "", ...unsupported.map((p) => `- ${rel(p)} — language not supported (JS/TS and Java only)`));
  mkdirSync(path.dirname(path.resolve(outFile)), { recursive: true });
  writeFileSync(outFile, L.join("\n") + "\n");
}

for (const p of unsupported) console.log(`skip  ${rel(p)} — language not supported (JS/TS and Java only)`);
const casesNote = C ? `, cases with a tagged test ${C.cases.filter((c) => c.tests.length).length}/${C.cases.length}` : "";
console.log(`[vuong-test] ${files.length} files, ${tests.length} tests, ${errors} errors, ${warns} warnings, ${untagged} untagged${casesNote}${outFile ? ` → ${outFile}` : ""}`);
process.exit(errors ? 1 : 0);
