// Minimal OOXML (xlsx / xlsm / docx) read + write helpers. Pure Node, no dependencies.
// Used by read-spec.mjs (read), import-cases.mjs (read cells) and export-cases.mjs (write cells into a copy).
import { inflateRawSync, deflateRawSync } from "node:zlib";
import path from "node:path";

// ── ZIP (central directory; stored + deflate; no ZIP64) ───────────────────────
export function readZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a ZIP file (no end of central directory)");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = new Map();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("bad central directory entry");
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28);
    const elen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nlen);
    entries.set(name, { method, csize, local });
    p += 46 + nlen + elen + clen;
  }
  const raw = (name) => {
    const e = entries.get(name);
    if (!e) return null;
    const start = e.local + 30 + buf.readUInt16LE(e.local + 26) + buf.readUInt16LE(e.local + 28);
    const data = buf.subarray(start, start + e.csize);
    if (e.method === 0) return Buffer.from(data);
    if (e.method === 8) return inflateRawSync(data);
    throw new Error(`unsupported ZIP method ${e.method} for ${name}`);
  };
  const get = (name) => {
    const b = raw(name);
    return b === null ? null : b.toString("utf8");
  };
  return { names: [...entries.keys()], get, raw };
}

const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(b) {
  let c = -1;
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/** files: [{ name, data: Buffer|string }] in order → ZIP Buffer (deflate). */
export function writeZip(files) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const data = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data, "utf8");
    const comp = deflateRawSync(data);
    const name = Buffer.from(f.name, "utf8");
    const crc = crc32(data);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0);
    h.writeUInt16LE(20, 4);
    h.writeUInt16LE(0x0800, 6); // utf-8 names
    h.writeUInt16LE(8, 8);
    h.writeUInt32LE(crc, 14);
    h.writeUInt32LE(comp.length, 18);
    h.writeUInt32LE(data.length, 22);
    h.writeUInt16LE(name.length, 26);
    locals.push(h, name, comp);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0x0800, 8);
    c.writeUInt16LE(8, 10);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(comp.length, 20);
    c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(name.length, 28);
    c.writeUInt32LE(offset, 42);
    central.push(c, name);
    offset += 30 + name.length + comp.length;
  }
  const cd = Buffer.concat(central);
  const e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0);
  e.writeUInt16LE(files.length, 8);
  e.writeUInt16LE(files.length, 10);
  e.writeUInt32LE(cd.length, 12);
  e.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, e]);
}

// ── XML helpers (regex based; enough for OOXML) ───────────────────────────────
export const unxml = (s) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&");
export const xmlEsc = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    // characters not allowed in XML 1.0
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
export const attr = (tag, name) => {
  const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`));
  return m ? unxml(m[1]) : null;
};
export const tText = (xml) => {
  let s = "";
  for (const m of xml.matchAll(/<(?:\w+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?t>|<(?:\w+:)?t\s*\/>/g)) s += unxml(m[1] || "");
  return s;
};
export function rels(zip, partPath) {
  const dir = path.posix.dirname(partPath);
  const relXml = zip.get(`${dir}/_rels/${path.posix.basename(partPath)}.rels`) || "";
  const map = {};
  for (const m of relXml.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = attr(m[0], "Id");
    const t = attr(m[0], "Target") || "";
    map[id] = t.startsWith("/") ? t.slice(1) : path.posix.normalize(path.posix.join(dir, t));
  }
  return map;
}
/** 0 → "A", 26 → "AA" */
export const colName = (n) => {
  let s = "";
  for (n += 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};
/** "A" → 0, "AA" → 26 */
export const colIndex = (c) => [...c.toUpperCase()].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
export const splitRef = (ref) => {
  const m = /^([A-Z]+)(\d+)$/i.exec(ref);
  return m ? { col: m[1].toUpperCase(), row: Number(m[2]) } : null;
};

// ── xlsx cells ────────────────────────────────────────────────────────────────
export function sharedStrings(zip) {
  const shared = [];
  const ss = zip.get("xl/sharedStrings.xml");
  if (ss) for (const m of ss.matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(tText(m[1].replace(/<rPh\b[\s\S]*?<\/rPh>/g, "")));
  return shared;
}
/** [{ name, state, part }] in workbook order */
export function sheetList(zip) {
  const wb = zip.get("xl/workbook.xml");
  if (!wb) throw new Error("xl/workbook.xml missing");
  const wbRels = rels(zip, "xl/workbook.xml");
  return [...wb.matchAll(/<sheet\b[^>]*>/g)].map((m) => ({ name: attr(m[0], "name"), state: attr(m[0], "state"), part: wbRels[attr(m[0], "r:id")] }));
}
/** plain text of every non-empty cell: Map<"B9", text> (no date formatting). */
export function sheetCells(zip, part, shared = sharedStrings(zip)) {
  const xml = zip.get(part) || "";
  const cells = new Map();
  for (const c of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const ref = attr(c[0], "r");
    const t = attr(c[0], "t");
    const body = c[2] || "";
    const v = body.match(/<v>([\s\S]*?)<\/v>/);
    let text = "";
    if (t === "s" && v) text = shared[Number(v[1])] ?? "";
    else if (t === "inlineStr") text = tText(body.match(/<is>([\s\S]*?)<\/is>/)?.[1] || "");
    else if (t === "b" && v) text = v[1] === "1" ? "TRUE" : "FALSE";
    else if (v) text = unxml(v[1]);
    if (ref && text.trim()) cells.set(ref, text.trim());
  }
  return cells;
}

/**
 * Set cells in a worksheet XML to inline strings, keeping each cell's style. Creates missing cells / rows
 * in order. values: { "F9": "OK", ... }. Formulas in those cells are replaced by the value.
 */
export function setCells(xml, values) {
  const byRow = {};
  for (const [ref, v] of Object.entries(values)) {
    const r = splitRef(ref);
    if (r) (byRow[r.row] ||= []).push({ ref: `${r.col}${r.row}`, col: colIndex(r.col), v });
  }
  const cellXml = (ref, v, style) =>
    v === "" || v == null
      ? `<c r="${ref}"${style ? ` s="${style}"` : ""}/>`
      : `<c r="${ref}"${style ? ` s="${style}"` : ""} t="inlineStr"><is><t xml:space="preserve">${xmlEsc(v)}</t></is></c>`;
  const fixRow = (rowXml, rowNo) => {
    const open = rowXml.match(/^<row\b[^>]*?(\/?)>/);
    let inner = open[1] ? "" : rowXml.slice(open[0].length, rowXml.lastIndexOf("</row>"));
    for (const { ref, col, v } of byRow[rowNo]) {
      const re = new RegExp(`<c\\b[^>]*\\br="${ref}"[^>]*?(?:/>|>[\\s\\S]*?</c>)`);
      const hit = inner.match(re);
      if (hit) inner = inner.replace(re, cellXml(ref, v, attr(hit[0], "s")));
      else {
        // insert before the first cell with a larger column
        const cells = [...inner.matchAll(/<c\b[^>]*\br="([A-Z]+)\d+"[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g)];
        const after = cells.find((m) => colIndex(m[1]) > col);
        const x = cellXml(ref, v, null);
        inner = after ? inner.slice(0, after.index) + x + inner.slice(after.index) : inner + x;
      }
    }
    return `${open[0].replace(/\/>$/, ">")}${inner}</row>`;
  };
  const done = new Set();
  let out = xml.replace(/<row\b[^>]*?(?:\/>|>[\s\S]*?<\/row>)/g, (rowXml) => {
    const n = Number(attr(rowXml, "r"));
    if (!byRow[n]) return rowXml;
    done.add(n);
    return fixRow(rowXml, n);
  });
  const missing = Object.keys(byRow).map(Number).filter((n) => !done.has(n)).sort((a, b) => a - b);
  for (const n of missing) {
    const rowXml = fixRow(`<row r="${n}">`.replace(">", "/>"), n);
    const rows = [...out.matchAll(/<row\b[^>]*\br="(\d+)"[^>]*?(?:\/>|>[\s\S]*?<\/row>)/g)];
    const after = rows.find((m) => Number(m[1]) > n);
    if (after) out = out.slice(0, after.index) + rowXml + out.slice(after.index);
    else if (/<sheetData\s*\/>/.test(out)) out = out.replace(/<sheetData\s*\/>/, `<sheetData>${rowXml}</sheetData>`);
    else out = out.replace("</sheetData>", `${rowXml}</sheetData>`);
  }
  return out;
}

/** Rewrite a workbook: same entries in the same order, with replaced parts; drops calcChain (Excel rebuilds it). */
export function rewriteZip(zip, replaced) {
  const files = [];
  for (const name of zip.names) {
    if (name === "xl/calcChain.xml") continue;
    let data = name in replaced ? Buffer.from(replaced[name], "utf8") : zip.raw(name);
    if (name === "[Content_Types].xml" && zip.names.includes("xl/calcChain.xml"))
      data = Buffer.from(data.toString("utf8").replace(/<Override[^>]*calcChain[^>]*\/>/, ""), "utf8");
    if (name === "xl/_rels/workbook.xml.rels")
      data = Buffer.from(data.toString("utf8").replace(/<Relationship[^>]*calcChain[^>]*\/>/, ""), "utf8");
    files.push({ name, data });
  }
  return writeZip(files);
}

/** New single-sheet xlsx: rows = [[cell, ...], ...]; first row bold; widths in characters. */
export function newXlsx(sheetName, rows, widths = []) {
  const sheet =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    (widths.length ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>` : "") +
    `<sheetData>${rows
      .map(
        (r, i) =>
          `<row r="${i + 1}">${r
            .map((v, j) => `<c r="${colName(j)}${i + 1}" s="${i === 0 ? 1 : 2}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(v ?? "")}</t></is></c>`)
            .join("")}</row>`
      )
      .join("")}</sheetData>` +
    (rows.length > 1 ? `<autoFilter ref="A1:${colName(Math.max(0, rows[0].length - 1))}${rows.length}"/>` : "") +
    `</worksheet>`;
  const files = [
    { name: "[Content_Types].xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>` },
    { name: "_rels/.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: "xl/workbook.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xmlEsc(sheetName.slice(0, 31))}" sheetId="1" r:id="rId1"/></sheets></workbook>` },
    { name: "xl/_rels/workbook.xml.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: "xl/styles.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="10"/><name val="Arial"/></font><font><b/><sz val="10"/><name val="Arial"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFDDE5F0"/></patternFill></fill></fills><borders count="2"><border/><border><left style="thin"/><right style="thin"/><top style="thin"/><bottom style="thin"/></border></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="3"><xf/><xf fontId="1" fillId="2" borderId="1" applyFont="1" applyFill="1" applyBorder="1"><alignment vertical="top" wrapText="1"/></xf><xf borderId="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs></styleSheet>` },
    { name: "xl/worksheets/sheet1.xml", data: sheet },
  ];
  return writeZip(files);
}
