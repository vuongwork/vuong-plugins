#!/usr/bin/env node
// read-spec: convert spec documents (xlsx / xlsm / docx) to Markdown with a citation label on every cell
// or paragraph, so rules can cite `file / Sheet!Cell` or `file / ¶12` / `Table 3 r2c4` consistently.
//
//   node read-spec.mjs <file>... [--out <dir>] [--sheets <glob>] [--max-rows N]
//
// One <out>/<file-basename>.md per input (default out: <cwd>/test-work/_spec/) plus one index line per file
// on stdout. Reads the source only; never writes next to it. Pure Node, no npm dependencies.
// Exit: 0 ok · 3 a file is of an unsupported type (others still processed) · 1 a file could not be read.
import { readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { readZip, unxml, attr, tText, rels, colName } from "./ooxml.mjs";
import path from "node:path";

// ── args ──────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const files = [];
let outDir = path.join(process.cwd(), "test-work", "_spec");
let sheetGlob = null;
let maxRows = Infinity;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--out") outDir = path.resolve(argv[++i]);
  else if (a === "--sheets") sheetGlob = argv[++i];
  else if (a === "--max-rows") maxRows = Number(argv[++i]) || Infinity;
  else if (a === "-h" || a === "--help") {
    console.log("usage: read-spec.mjs <file>... [--out <dir>] [--sheets <glob>] [--max-rows N]");
    process.exit(0);
  } else files.push(a);
}
if (!files.length) {
  console.error("usage: read-spec.mjs <file>... [--out <dir>] [--sheets <glob>] [--max-rows N]");
  process.exit(2);
}
const globRe = (g) => new RegExp(`^${g.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`, "i");
const sheetOk = sheetGlob ? ((re) => (n) => re.test(n))(globRe(sheetGlob)) : () => true;

const cellText = (s) => s.replace(/\r?\n/g, " ↵ ").replace(/\|/g, "\\|").trim();

// ── xlsx / xlsm ───────────────────────────────────────────────────────────────
function xlsx(zip) {
  const out = [];
  const stats = { sheets: 0, rows: 0 };
  const shared = [];
  const ss = zip.get("xl/sharedStrings.xml");
  if (ss) for (const m of ss.matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(tText(m[1].replace(/<rPh\b[\s\S]*?<\/rPh>/g, "")));
  // date-formatted numbers → ISO date (serial 44386 → 2021-07-09)
  const st = zip.get("xl/styles.xml") || "";
  const fmts = {};
  for (const m of st.matchAll(/<numFmt\b[^>]*>/g)) fmts[attr(m[0], "numFmtId")] = attr(m[0], "formatCode") || "";
  const isDateFmt = (id) => (id >= 14 && id <= 22) || (id >= 45 && id <= 47) || /[ymd]/i.test((fmts[id] || "").replace(/"[^"]*"|\[[^\]]*\]/g, ""));
  const xfDate = [...(st.match(/<cellXfs\b[\s\S]*?<\/cellXfs>/)?.[0] || "").matchAll(/<xf\b[^>]*>/g)].map((m) => isDateFmt(Number(attr(m[0], "numFmtId"))));
  const toDate = (n) => new Date(Math.round((n - 25569) * 86400000)).toISOString().replace(/T00:00:00\.000Z$/, "").replace(/\.000Z$/, "Z");
  const wb = zip.get("xl/workbook.xml");
  if (!wb) throw new Error("xl/workbook.xml missing");
  const wbRels = rels(zip, "xl/workbook.xml");
  for (const m of wb.matchAll(/<sheet\b[^>]*>/g)) {
    const name = attr(m[0], "name");
    const state = attr(m[0], "state");
    const part = wbRels[attr(m[0], "r:id")];
    if (!sheetOk(name)) continue;
    const xml = part && zip.get(part);
    stats.sheets++;
    out.push("", `## Sheet: ${name}${state && state !== "visible" ? ` (${state})` : ""}`, "");
    if (!xml) {
      out.push("_(not a worksheet — chart or dialog sheet; skipped)_");
      continue;
    }
    let n = 0;
    let cut = false;
    for (const r of xml.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const cells = [];
      for (const c of (r[1] || "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = attr(c[0], "r");
        const t = attr(c[0], "t");
        const body = c[2] || "";
        const v = body.match(/<v>([\s\S]*?)<\/v>/);
        let text = "";
        if (t === "s" && v) text = shared[Number(v[1])] ?? "";
        else if (t === "inlineStr") text = tText(body.match(/<is>([\s\S]*?)<\/is>/)?.[1] || "");
        else if (t === "b" && v) text = v[1] === "1" ? "TRUE" : "FALSE";
        else if (v && !t && xfDate[Number(attr(c[0], "s") || 0)] && Number(v[1]) > 0) text = toDate(Number(v[1]));
        else if (v) text = unxml(v[1]);
        text = cellText(text);
        if (text && ref) cells.push([ref, text]);
      }
      if (!cells.length) continue;
      if (n >= maxRows) {
        cut = true;
        break;
      }
      n++;
      out.push(`- ${cells.map(([ref, t], i) => `**${i === 0 ? `${name}!` : ""}${ref}** ${t}`).join(" | ")}`);
    }
    stats.rows += n;
    if (cut) out.push(`- _(truncated at --max-rows ${maxRows})_`);
    const merges = [...xml.matchAll(/<mergeCell\b[^>]*ref="([^"]+)"/g)].map((x) => x[1]);
    if (merges.length) out.push("", `Merged: ${merges.map((x) => `merged ${name}!${x}`).join(", ")}`);
    const sRels = rels(zip, part);
    for (const d of xml.matchAll(/<drawing\b[^>]*>/g)) {
      const dx = zip.get(sRels[attr(d[0], "r:id")] || "");
      if (!dx) continue;
      for (const a of dx.matchAll(/<(?:\w+:)?(twoCellAnchor|oneCellAnchor|absoluteAnchor)\b[\s\S]*?<\/(?:\w+:)?\1>/g)) {
        if (!/<(?:\w+:)?pic\b/.test(a[0])) continue;
        const from = a[0].match(/<(?:\w+:)?from>[\s\S]*?<(?:\w+:)?col>(\d+)<\/(?:\w+:)?col>[\s\S]*?<(?:\w+:)?row>(\d+)<\/(?:\w+:)?row>/);
        const nv = a[0].match(/<(?:\w+:)?cNvPr\b[^>]*>/);
        const label = nv ? [attr(nv[0], "name"), attr(nv[0], "descr")].filter(Boolean).join(" — ") : "";
        out.push(`- image in sheet ${name}${from ? ` near cell ${name}!${colName(Number(from[1]))}${Number(from[2]) + 1}` : ""}${label ? ` (${cellText(label)})` : ""}`);
      }
    }
  }
  return { body: out, info: `sheets=${stats.sheets} rows=${stats.rows}` };
}

// ── docx ──────────────────────────────────────────────────────────────────────
/** split top-level <w:p>/<w:tbl> elements of the body, depth-aware for tables */
function blocks(xml, tags) {
  const res = [];
  const open = new RegExp(`<w:(${tags.join("|")})(?=[\\s>/])[^>]*?(\\/?)>`, "g");
  let m;
  while ((m = open.exec(xml))) {
    const tag = m[1];
    if (m[2] === "/") {
      res.push({ tag, xml: "" });
      continue;
    }
    const re = new RegExp(`<w:${tag}(?=[\\s>/])[^>]*?(\\/?)>|<\\/w:${tag}>`, "g");
    re.lastIndex = open.lastIndex;
    let depth = 1;
    let x;
    while (depth && (x = re.exec(xml))) {
      if (x[0].startsWith("</")) depth--;
      else if (x[1] !== "/") depth++;
    }
    const end = x ? re.lastIndex : xml.length;
    res.push({ tag, xml: xml.slice(open.lastIndex, end) });
    open.lastIndex = end;
  }
  return res;
}
const pText = (p) => cellText(tText(p.replace(/<w:tab\/>/g, "<w:t>\t</w:t>").replace(/<w:br\/>/g, "<w:t>\n</w:t>")));
function docx(zip) {
  const doc = zip.get("word/document.xml");
  if (!doc) throw new Error("word/document.xml missing");
  const styleName = {};
  for (const m of (zip.get("word/styles.xml") || "").matchAll(/<w:style\b[^>]*w:styleId="([^"]+)"[^>]*>[\s\S]*?<w:name w:val="([^"]+)"/g)) styleName[m[1]] = m[2];
  const body = doc.match(/<w:body>([\s\S]*)<\/w:body>/)?.[1] || doc;
  const out = [];
  let para = 0;
  let tbl = 0;
  for (const b of blocks(body, ["p", "tbl"])) {
    if (b.tag === "p") {
      para++;
      const text = pText(b.xml);
      if (!text) continue;
      const sid = b.xml.match(/<w:pStyle w:val="([^"]+)"/)?.[1] || "";
      const h = `${styleName[sid] || ""} ${sid}`.match(/(?:heading|見出し|title)\s*(\d)?/i);
      const level = h ? Math.min(Number(h[1] || 1), 5) + 1 : 0;
      out.push("", level ? `${"#".repeat(level)} ${text} ¶${para}` : `**¶${para}** ${text}`);
    } else {
      tbl++;
      out.push("", `Table ${tbl}:`);
      let r = 0;
      for (const row of blocks(b.xml, ["tr"])) {
        r++;
        const cells = blocks(row.xml, ["tc"])
          .map((c, i) => [i + 1, pText(c.xml.replace(/<\/w:p>/g, "<w:t>\n</w:t></w:p>"))])
          .filter(([, t]) => t);
        if (cells.length) out.push(`- ${cells.map(([c, t]) => `**Table ${tbl} r${r}c${c}** ${t}`).join(" | ")}`);
      }
    }
  }
  return { body: out, info: `paragraphs=${para} tables=${tbl}` };
}

// ── main ──────────────────────────────────────────────────────────────────────
let exit = 0;
mkdirSync(outDir, { recursive: true });
for (const f of files) {
  const src = path.resolve(f);
  const ext = path.extname(src).toLowerCase();
  if (![".xlsx", ".xlsm", ".docx"].includes(ext)) {
    console.log(`${f}: unsupported by read-spec — use a document reader skill (doc-to-md / read-excel-spec) or convert first`);
    exit = Math.max(exit, 3);
    continue;
  }
  if (path.dirname(src) === outDir) {
    console.error(`${f}: --out is the source folder; read-spec never writes next to the source`);
    exit = Math.max(exit, 1);
    continue;
  }
  try {
    const buf = readFileSync(src);
    const st = statSync(src);
    const sha = createHash("sha256").update(buf).digest("hex");
    const zip = readZip(buf);
    const r = ext === ".docx" ? docx(zip) : xlsx(zip);
    const md = [
      `# ${path.basename(src)}`,
      "",
      `- Source: ${src}`,
      `- Size: ${st.size} bytes`,
      `- Modified: ${st.mtime.toISOString()}`,
      `- sha256: ${sha}`,
      `- Read by: vuong-test read-spec (${r.info})`,
      "",
      ext === ".docx" ? "Cite as `file / ¶N` or `file / Table T rRcC`." : "Cite as `file / Sheet!Cell` (the bold labels).",
      ...r.body,
      "",
    ].join("\n");
    const dest = path.join(outDir, `${path.basename(src)}.md`);
    writeFileSync(dest, md);
    console.log(`${dest}  ${r.info}  sha256=${sha.slice(0, 12)}`);
  } catch (e) {
    console.error(`${f}: cannot read — ${e.message}`);
    exit = Math.max(exit, 1);
  }
}
process.exit(exit);
