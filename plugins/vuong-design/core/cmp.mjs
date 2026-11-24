#!/usr/bin/env node
// Component CLI (plan 3b Task 4): the component step after ds.mjs. No browser, no Figma, no model.
//
//   node core/cmp.mjs --ds <ds output dir> [--components <vd-components.json>] [--rules <vd-rules.json>]
//
// Reads from <ds>: ir.json (screens, svgDefs, fontCss), spec-norm-<id>.json, tokens.json. Declarations: --components,
// else vd-components.json in the current working directory when it exists, else none. Rules: --rules, else
// vd-rules.json in the current working directory when it exists (the same default as ds.mjs). Both are only read.
// Writes into <ds>:
//   components.json          findComponents() result
//   states.json              componentStates() result (proposed states listed even before approval; forFigma() filters)
//   vd-components.draft.json componentsDraft() suggestions
//   vd-rules.draft.json      ds.mjs's draft with a `states` section added (statesDraft) while the rules file has no
//                            approved states; the section is removed once they are approved. Other keys unchanged.
//   coverage.json            ds.mjs's coverage with `components` = { missing: [...], summary } added (replaced on rerun)
//   components.html          the preview page (components-report.mjs)
//   design-system.html       a "Components" summary section with a link, between <!--vd:components--> markers
//                            before </body> (replaced on rerun; the page is left alone when it does not exist)
// Every file but the two HTML pages is deterministic. Exit codes: 0 done; 2 usage / setup error.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { findComponents, componentsDraft, readComponentsFile } from './components.mjs';
import { componentStates, statesDraft, stateRules } from './states.mjs';
import { readRules } from './rules-file.mjs';
import { renderComponents, componentsSummary } from './components-report.mjs';
import { defaultFontMap } from './font-map.mjs';

export const CMP_USAGE = 'usage: node core/cmp.mjs --ds <ds output dir> [--components <vd-components.json>] [--rules <vd-rules.json>]';
class UsageError extends Error {}
const json = (x) => `${JSON.stringify(x, null, 1)}\n`;
const safe = (s) => String(s).replace(/[^A-Za-z0-9._-]/g, '_');
const MARK = /<!--vd:components-->[\s\S]*?<!--\/vd:components-->\n?/;
const readJson = (p, what) => {
  if (!existsSync(p)) throw new UsageError(`${what} not found: ${p}`);
  try { return JSON.parse(readFileSync(p, 'utf8').replace(/^﻿/, '')); } catch (e) { throw new UsageError(`${p}: not valid JSON (${e.message})`); }
};

export function runComponents(dsDir, { decl, rules, fontMap = defaultFontMap(), generated = '' } = {}) {
  const ir = readJson(join(dsDir, 'ir.json'), 'ir.json (pass the --out folder of ds.mjs)');
  const screens = (ir.screens || []).map((s) => {
    const id = String(s.id ?? s.name);
    return { screen: s, spec: readJson(join(dsDir, `spec-norm-${safe(id)}.json`), `spec-norm of screen ${id}`) };
  });
  if (!screens.length) throw new UsageError(`${dsDir}/ir.json has no screens`);
  const tokens = existsSync(join(dsDir, 'tokens.json')) ? readJson(join(dsDir, 'tokens.json')) : null;
  const specs = Object.fromEntries(screens.map((s) => [String(s.screen.id ?? s.screen.name), s.spec]));
  const cmps = findComponents(screens, { decl });
  const states = componentStates(cmps, { specs, tokens, rules, decl });
  const draft = componentsDraft(screens);
  const rulesDraft = statesDraft(rules);
  const html = renderComponents({
    cmps, states, specs, fontMap, draft, rulesDraft, generated, title: `Components: ${ir.file || dsDir}`,
    screens: Object.fromEntries(screens.map((s) => [String(s.screen.id ?? s.screen.name), { svgDefs: s.screen.svgDefs || {}, fontCss: s.screen.fontCss || {} }])),
  });
  return { cmps, states, draft, rulesDraft, html };
}

export async function main(argv, deps = {}) {
  const log = deps.log || ((s) => process.stdout.write(`${s}\n`));
  const err = deps.err || ((s) => process.stderr.write(`${s}\n`));
  try {
    let o;
    try { o = parseArgs({ args: argv, options: { ds: { type: 'string' }, components: { type: 'string' }, rules: { type: 'string' } }, strict: true, allowPositionals: false }).values; } catch (e) { throw new UsageError(e.message); }
    if (!o.ds) throw new UsageError('--ds is required');
    const cwd = deps.cwd || process.cwd();
    const pick = (given, file) => (given ? resolve(cwd, given) : existsSync(join(cwd, file)) ? join(cwd, file) : null);
    const declPath = pick(o.components, 'vd-components.json'), rulesPath = pick(o.rules, 'vd-rules.json');
    if (o.components && !existsSync(declPath)) throw new UsageError(`components file not found: ${declPath}`);
    if (o.rules && !existsSync(rulesPath)) throw new UsageError(`rules file not found: ${rulesPath}`);
    let decl, rules;
    try { decl = readComponentsFile(declPath); rules = readRules(rulesPath); stateRules(rules); } catch (e) { throw new UsageError(e.message); }
    const ds = resolve(cwd, o.ds);
    let r;
    try { r = runComponents(ds, { decl, rules, fontMap: deps.fontMap, generated: deps.generated ?? new Date().toISOString() }); } catch (e) { throw e instanceof UsageError ? e : new UsageError(e.message); }
    const { cmps, states, draft, rulesDraft, html } = r;
    writeFileSync(join(ds, 'components.json'), json(cmps));
    writeFileSync(join(ds, 'states.json'), json(states));
    writeFileSync(join(ds, 'vd-components.draft.json'), json(draft));
    const rdPath = join(ds, 'vd-rules.draft.json');
    const rd = existsSync(rdPath) ? readJson(rdPath) : { version: 1, answers: {}, notes: {} };
    if (states.approved) delete rd.states; else rd.states = rulesDraft;
    writeFileSync(rdPath, json(rd));
    const covPath = join(ds, 'coverage.json');
    if (existsSync(covPath)) {
      const cov = readJson(covPath);
      const all = states.components.flatMap((c) => c.states);
      cov.components = { missing: states.missing, summary: { components: cmps.components.length, html: all.filter((s) => s.source === 'html').length, proposed: all.filter((s) => s.source === 'proposed').length, missing: states.missing.length, approved: states.approved } };
      writeFileSync(covPath, json(cov));
    }
    writeFileSync(join(ds, 'components.html'), html);
    const dsHtml = join(ds, 'design-system.html');
    if (existsSync(dsHtml)) {
      const page = readFileSync(dsHtml, 'utf8').replace(MARK, '');
      const sec = `<!--vd:components-->${componentsSummary({ cmps, states })}<!--/vd:components-->\n`;
      writeFileSync(dsHtml, page.includes('</body>') ? page.replace('</body>', `${sec}</body>`) : page + sec);
    }
    const all = states.components.flatMap((c) => c.states);
    log(`${cmps.components.length} components, ${cmps.proposed.length} bare proposals, ${cmps.skipped.length} skipped groups`);
    log(`states: ${all.filter((s) => s.source === 'html').length} from the HTML, ${all.filter((s) => s.source === 'proposed').length} proposed (${states.approved ? 'rules approved' : 'rules not approved: nothing proposed goes to Figma'}), ${states.missing.length} missing`);
    log(`declarations: ${declPath || 'none'}; rules: ${rulesPath || 'none'}; preview: ${join(ds, 'components.html')}`);
    return 0;
  } catch (e) {
    if (e instanceof UsageError) { err(`error: ${e.message}\n${CMP_USAGE}`); return 2; }
    throw e;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (e) => { process.stderr.write(`error: ${e.stack || e.message}\n`); process.exit(2); });
}
