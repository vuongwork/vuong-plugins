// Coverage summaries → {files:[{path,statements,branches,functions,lines}], total:{...}} in percent.
// Missing metric = null (e.g. JaCoCo has no "statements"; it reports INSTRUCTION, shown as statements).
import { readFileSync } from "node:fs";
import path from "node:path";

const pct = (covered, total) => (total ? (covered / total) * 100 : 100);
const add = (acc, k, c, t) => {
  acc[k] = acc[k] || { c: 0, t: 0 };
  acc[k].c += c;
  acc[k].t += t;
};
const toPct = (acc) =>
  Object.fromEntries(
    ["statements", "branches", "functions", "lines"].map((k) => [k, acc[k] ? pct(acc[k].c, acc[k].t) : null])
  );

function summarize(rows) {
  const total = {};
  const files = rows.map(({ path: p, counts }) => {
    for (const [k, v] of Object.entries(counts)) add(total, k, v.c, v.t);
    return { path: p, ...toPct(counts) };
  });
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { files, total: toPct(total) };
}

/** istanbul coverage-final.json (Jest / Vitest / nyc). */
function istanbul(json, root) {
  return summarize(
    Object.values(json).map((fc) => {
      const s = Object.values(fc.s || {});
      const f = Object.values(fc.f || {});
      const b = Object.values(fc.b || {}).flat();
      const lineHits = {};
      for (const [id, loc] of Object.entries(fc.statementMap || {})) {
        const ln = loc.start.line;
        lineHits[ln] = Math.max(lineHits[ln] || 0, fc.s[id] || 0);
      }
      const l = Object.values(lineHits);
      const cnt = (arr) => ({ c: arr.filter((x) => x > 0).length, t: arr.length });
      return {
        path: path.relative(root, fc.path) || fc.path,
        counts: { statements: cnt(s), branches: cnt(b), functions: cnt(f), lines: cnt(l) },
      };
    })
  );
}

/** JaCoCo XML report (Maven/Gradle). Per sourcefile counters. */
function jacoco(xml) {
  const map = { INSTRUCTION: "statements", BRANCH: "branches", METHOD: "functions", LINE: "lines" };
  const rows = [];
  for (const pkg of xml.matchAll(/<package\b[^>]*name="([^"]*)"[^>]*>([\s\S]*?)<\/package>/g)) {
    for (const sf of pkg[2].matchAll(/<sourcefile\b[^>]*name="([^"]*)"[^>]*>([\s\S]*?)<\/sourcefile>/g)) {
      const counts = {};
      // only the sourcefile's own counters (they follow its <line> elements)
      for (const c of sf[2].matchAll(/<counter\b[^>]*type="(\w+)"[^>]*missed="(\d+)"[^>]*covered="(\d+)"/g)) {
        const k = map[c[1]];
        if (k) counts[k] = { c: Number(c[3]), t: Number(c[2]) + Number(c[3]) };
      }
      rows.push({ path: `${pkg[1]}/${sf[1]}`, counts });
    }
  }
  return summarize(rows);
}

export function readCoverage(file, root = process.cwd()) {
  const text = readFileSync(file, "utf8");
  if (/^\s*</.test(text) && /<report\b/.test(text)) return { format: "jacoco", ...jacoco(text) };
  return { format: "istanbul", ...istanbul(JSON.parse(text), root) };
}

/** Merge several summaries (e.g. FE + BE) into one table, prefixing paths with a label. */
export function mergeCoverage(list) {
  if (!list.length) return null;
  const files = list.flatMap(({ label, cov }) => cov.files.map((f) => ({ ...f, path: label ? `${label}: ${f.path}` : f.path })));
  return { files, totals: list.map(({ label, cov }) => ({ label, format: cov.format, ...cov.total })) };
}
