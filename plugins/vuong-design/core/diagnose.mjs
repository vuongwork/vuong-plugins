#!/usr/bin/env node
// Diagnose a layout.mjs / ds.mjs output folder in a few lines, so a model (or a person) knows which node of which screen
// failed and why without reading report.json or ir.json (cost principle: compact checks, no bulk data through a model).
//
//   node core/diagnose.mjs --out <layout output dir> [--max <n per screen, default 4>] [--json]
//
// Reads <out>/report.json, <out>/ir.json (node labels) and <out>/lint.json (screen ids from data-vd-screen, when the
// lint gate ran). Prints one header line, then per failing screen its id and up to --max findings:
//   root      a frame or text placed or sized differently from the source (unexplained by the Figma model)
//   approval  a Figma-model difference above the tolerance (text width rounding and the like): pipeline side
//   crop      pixels differ although the box matches (paint: ring borders, line-through, negative margins ...)
//   data      a paint / font / content mismatch; unchecked: nodes the check could not reach
// Each finding names the width (A = as authored, B = widened), the delta [dx, dy, dw, dh] in px and the node as
// tag.class > tag.class (the last three levels) with the first characters of its text. Writes nothing. Exit 0 when
// every screen passes, 1 otherwise, 2 on a usage error or a missing report.
import { parseArgs } from 'node:util';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const readJson = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null);
const r2 = (v) => Math.round(v * 100) / 100;

// id -> 'tag.cls > tag.cls > tag.cls "text"'
export function nodeLabels(irScreen) {
  const out = new Map();
  const walk = (n, chain) => {
    const me = `${n.tag || n.kind || '?'}${n.cls ? '.' + String(n.cls).split(/\s+/)[0] : ''}`;
    const c = [...chain, me];
    const text = n.text ? ` "${String(n.text).replace(/\s+/g, ' ').slice(0, 24)}"` : '';
    out.set(n.id, c.slice(-3).join(' > ') + text);
    for (const k of n.kids || n.children || []) walk(k, c);
  };
  if (irScreen && irScreen.tree) walk(irScreen.tree, []);
  return out;
}

export function diagnose({ report, ir, lint }, { max = 4 } = {}) {
  const screens = (report && report.screens) || [];
  const lintIds = (lint && lint.screens || []).map((s) => s.id);
  const res = [];
  screens.forEach((s, i) => {
    const sm = s.summary || {};
    if (sm.pass) return;
    const v = s.report || {};
    const irS = ir && ir.screens ? ir.screens.find((x) => x.id === sm.screen) : null;
    const label = nodeLabels(irS);
    const name = (id) => label.get(id) || id;
    const items = [];
    for (const x of (v.roots || []).filter((x) => !x.explained && !x.explanation)) {
      items.push({ kind: 'root', width: x.width, delta: (x.delta || []).map(r2), node: name(x.id) });
    }
    for (const x of v.needsApproval || []) {
      items.push({ kind: 'approval', width: x.width, delta: (x.delta || []).map(r2), node: name(x.id), by: x.explainedBy || '' });
    }
    const tol = v.tol || {};
    const ratio = tol.cropRatio ?? 0.05, peak = tol.cropPeak ?? 40;
    for (const x of (v.crop || []).filter((c) => c.ratio > ratio || (c.peak ?? 0) >= peak)) {
      items.push({ kind: 'crop', width: x.width, ratio: r2(x.ratio), node: name(x.id) });
    }
    for (const x of Array.isArray(v.data) ? v.data : []) items.push({ kind: 'data', node: name(x.id || x.node), what: x.kind || x.prop || x.type || '' });
    if (sm.unchecked) items.push({ kind: 'unchecked', n: sm.unchecked, why: [...new Set(Object.values(v.uncheckedReasons || {}))].join('; ').slice(0, 80) });
    // roots first (they cause linked crops), then approvals, crops, data
    const order = { root: 0, unchecked: 1, data: 2, approval: 3, crop: 4 };
    items.sort((a, b) => order[a.kind] - order[b.kind]);
    res.push({ screen: lintIds[i] || sm.screen, capture: sm.screen, counts: { root: sm.unexplainedRoots || 0, approval: sm.needsApproval || 0, crop: (sm.cropA || 0) + (sm.cropB || 0), data: Object.keys(sm.data || {}).length, unchecked: sm.unchecked || 0 }, items: items.slice(0, max), more: Math.max(0, items.length - max) });
  });
  return { total: screens.length, failed: res.length, screens: res };
}

const HINT = {
  root: 'placed/sized differently',
  approval: 'Figma-model rounding (pipeline)',
  crop: 'pixels differ',
  data: 'paint/content mismatch',
  unchecked: 'not checked',
};

export function formatDiagnosis(d) {
  const lines = [`diagnose: ${d.total - d.failed}/${d.total} screens pass`];
  for (const s of d.screens) {
    const c = s.counts;
    lines.push(`${s.screen}${s.screen !== s.capture ? ` (${s.capture})` : ''}: ${c.root} root, ${c.approval} approval, ${c.crop} crop, ${c.data} data, ${c.unchecked} unchecked`);
    for (const it of s.items) {
      const at = it.width ? ` @${it.width}` : '';
      const d4 = it.delta ? ` d[${it.delta.join(',')}]` : '';
      const extra = it.ratio != null ? ` ratio ${it.ratio}` : it.n != null ? ` ${it.n} nodes, ${it.why}` : it.what ? ` ${it.what}` : '';
      lines.push(`  ${it.kind}${at}${d4}${extra}: ${it.node || ''} (${HINT[it.kind]})`.replace(/: \(/, ' ('));
    }
    if (s.more) lines.push(`  ... ${s.more} more`);
  }
  if (d.failed) lines.push('B-only roots: something changes when widened, see PROFILE.md W12-W20; approvals and crops alone are pipeline-side');
  return lines;
}

export function main(argv, log = console.log) {
  let values;
  try {
    ({ values } = parseArgs({ args: argv, options: { out: { type: 'string' }, max: { type: 'string' }, json: { type: 'boolean' }, help: { type: 'boolean', short: 'h' } }, strict: true }));
  } catch (e) { log(e.message); return 2; }
  if (values.help || !values.out) { log('usage: node core/diagnose.mjs --out <layout output dir> [--max <n>] [--json]'); return values.help ? 0 : 2; }
  const report = readJson(join(values.out, 'report.json'));
  if (!report) { log(`no report.json in ${values.out}`); return 2; }
  const max = values.max != null ? Number(values.max) : 4;
  if (!Number.isInteger(max) || max < 1) { log('--max needs a whole number >= 1'); return 2; }
  const d = diagnose({ report, ir: readJson(join(values.out, 'ir.json')), lint: readJson(join(values.out, 'lint.json')) }, { max });
  if (values.json) log(JSON.stringify(d));
  else for (const l of formatDiagnosis(d)) log(l);
  return d.failed ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = main(process.argv.slice(2));
