#!/usr/bin/env node
// Page map for step 6: the controls of each page with a selector that matches exactly one element, so an E2E
// writer does not guess selectors from the page source and dry-run again and again.
//
//   node page-map.mjs --base <url> [--paths .,x?id=1] [--out W/page-map.md] [--from <dir with node_modules>]
//   (normally through run.mjs: `run.mjs <scope> --page-map .,x` starts / stops the server and writes W/page-map.md)
//
// Per path: one row per element with an id, data-testid / data-test / data-qa, name, role or aria-label, and
// every button, link, input, select, textarea: selector · element · text / label · state. State says
// hidden / disabled / readonly; a `hidden` container whose own box is 0×0 once shown (all children fixed /
// absolute) is flagged: Playwright never sees it visible — wait on a child instead. Read-only: every request other
// than GET / HEAD / OPTIONS is aborted. Playwright is resolved from --from, VT_PLAYWRIGHT_FROM or the cwd.
import { createRequire } from "node:module";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const opt = { base: process.env.BASE_URL || null, paths: ["."], out: null, from: process.env.VT_PLAYWRIGHT_FROM || process.cwd() };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  const v = () => argv[++i] ?? die(`${a}: value missing`);
  if (a === "--base") opt.base = v();
  else if (a === "--paths") opt.paths = v().split(",").filter(Boolean);
  else if (a === "--out") opt.out = v();
  else if (a === "--from") opt.from = v();
  else if (a === "--help" || a === "-h") {
    console.log("page-map.mjs --base <url> [--paths .,x?id=1 (relative to --base)] [--out W/page-map.md] [--from <dir>]");
    process.exit(0);
  } else die(`unknown argument: ${a}`);
}
function die(m) {
  console.error(`[vuong-test page-map] ${m}`);
  process.exit(2);
}
if (!opt.base) die("--base <url> (or BASE_URL) needed");

let chromium;
try {
  ({ chromium } = createRequire(path.join(path.resolve(opt.from), "noop.js"))("playwright"));
} catch {
  die(`playwright not found from ${opt.from} (--from <dir with node_modules/playwright>)`);
}

// runs in the page: the rows of one page
function scan() {
  const cssEsc = (s) => (window.CSS && CSS.escape ? CSS.escape(s) : s.replace(/[^\w-]/g, "\\$&"));
  const q = (s) => JSON.stringify(s);
  const one = (sel) => {
    try {
      return document.querySelectorAll(sel).length === 1;
    } catch {
      return false;
    }
  };
  const text = (el) => (el.getAttribute("aria-label") || el.innerText || el.value || el.getAttribute("placeholder") || el.title || "").replace(/\s+/g, " ").trim();
  const labelOf = (el) => {
    if (el.id) {
      const l = document.querySelector(`label[for="${cssEsc(el.id)}"]`);
      if (l) return l.innerText.trim();
    }
    const f = el.closest(".field, .form-group, .form-item, label");
    const l = f && f.querySelector("label, .label");
    return l && l !== el ? l.innerText.replace(/\s+/g, " ").trim() : "";
  };
  const selectorOf = (el) => {
    const tag = el.tagName.toLowerCase();
    for (const a of ["data-testid", "data-test", "data-qa"]) if (el.getAttribute(a)) return `[${a}=${q(el.getAttribute(a))}]`;
    if (el.id && one(`#${cssEsc(el.id)}`)) return `#${cssEsc(el.id)}`;
    if (el.name && one(`${tag}[name=${q(el.name)}]`)) return `${tag}[name=${q(el.name)}]`;
    for (const a of el.getAttributeNames().filter((n) => n.startsWith("data-") || n === "aria-label" || n === "href")) {
      const v = el.getAttribute(a);
      if (v && v.length <= 60 && one(`${tag}[${a}=${q(v)}]`)) return `${tag}[${a}=${q(v)}]`;
    }
    const t = text(el);
    if (t && t.length <= 40 && ["button", "a"].includes(tag)) {
      const same = [...document.querySelectorAll(tag)].filter((x) => text(x) === t).length;
      return `${tag}:has-text(${q(t)})${same > 1 ? ` (×${same})` : ""}`;
    }
    return null;
  };
  const SEL = "[id], [data-testid], [data-test], [data-qa], [name], [role], [aria-label], button, a[href], input, select, textarea, h1, h2, h3";
  const skip = (el) => el.closest("svg, head, script, style, template") || el.tagName === "OPTION";
  const visible = (el) => (el.checkVisibility ? el.checkVisibility() : !!el.offsetParent);
  const rows = [];
  for (const el of document.querySelectorAll(SEL)) {
    if (skip(el)) continue;
    const sel = selectorOf(el);
    if (!sel) continue;
    const tag = el.tagName.toLowerCase();
    let kind = tag;
    if (tag === "input") kind = `input[${el.type}]`;
    if (el.getAttribute("role")) kind += ` role=${el.getAttribute("role")}`;
    let t = ["input", "textarea"].includes(tag) ? labelOf(el) : tag === "select" ? labelOf(el) : text(el);
    if (tag === "select") t += ` — options: ${[...el.options].map((o) => o.value || "''").slice(0, 8).join(", ")}${el.options.length > 8 ? ", …" : ""}`;
    // a container of controls: its text is its children's (they have their own rows)
    if (["div", "section", "span", "p", "form", "ul"].includes(tag) && (el.children.length > 2 || el.querySelector("button, input, select, textarea, a"))) t = "";
    const state = [];
    if (!visible(el)) state.push("hidden");
    if (el.disabled) state.push("disabled");
    if (el.readOnly) state.push("readonly");
    if (el.hasAttribute("hidden") && el.children.length) {
      el.removeAttribute("hidden");
      const r = el.getBoundingClientRect();
      el.setAttribute("hidden", "");
      if (!r.width || !r.height) state.push("0×0 box when shown: wait on a child, not on it");
    }
    rows.push([sel, kind, t.slice(0, 80), state.join(", ")]);
  }
  return { title: document.title, rows };
}

const md = [`# Page map — ${opt.base}`, "", "Generated by `core/page-map.mjs` (read-only). Selectors match exactly one element unless `(×n)`.", ""];
const browser = await chromium.launch();
let bad = 0;
try {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  await ctx.route("**/*", (r) => (["GET", "HEAD", "OPTIONS"].includes(r.request().method()) ? r.fallback() : r.abort("blockedbyclient")));
  const page = await ctx.newPage();
  for (const p of opt.paths) {
    const url = new URL(p, opt.base.replace(/\/?$/, "/")).href;
    try {
      await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
      const { title, rows } = await page.evaluate(scan);
      md.push(`## ${p} — ${title || "(no title)"}`, "", "| Selector | Element | Text / label | State |", "|---|---|---|---|");
      for (const r of rows) md.push(`| ${r.map((c) => String(c).replace(/\|/g, "\\|")).join(" | ")} |`);
      md.push("");
      console.log(`[page-map] ${p}: ${rows.length} elements`);
    } catch (e) {
      bad++;
      md.push(`## ${p}`, "", `Could not open: ${e.message.split("\n")[0]}`, "");
      console.log(`[page-map] ${p}: ${e.message.split("\n")[0]}`);
    }
  }
} finally {
  await browser.close();
}
const text = md.join("\n");
if (opt.out) {
  mkdirSync(path.dirname(path.resolve(opt.out)), { recursive: true });
  writeFileSync(opt.out, text);
  console.log(`[page-map] → ${opt.out}`);
} else console.log(text);
process.exit(bad ? 1 : 0);
