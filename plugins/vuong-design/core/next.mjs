#!/usr/bin/env node
// What to run next (R91): reads the project file and what the earlier steps wrote, prints where each step stands and
// the one command to run now. No browser, no Figma, no model; it never runs a step itself.
//
//   node core/next.mjs --project <vd-project.json>
//
// Steps, in order (the first one not done is the next):
//   html        the source page exists (else: write it, e.g. with the spec-to-html skill)
//   ds          <out>/report.json and design-system.html exist and are newer than the page, the rules, names and
//               allowlist files (else: ds.mjs --project)
//   questions   no open question in <out>/questions.json (else: answer.mjs --project, then ds again)
//   approve     every screen passes (report.json pass). Open findings with a draft entry the gate can allowlist:
//               approve.mjs --project, then ds again. Others (an unexplained norm root, a data finding, an unchecked
//               node) cannot be approved: the HTML or the plugin must change; next.mjs stops there.
//   components  only with "components" in the project: <out>/components.json newer than that file (else: cmp.mjs)
//   figma       only with "figma": { "out" } in the project: plan (state.json newer than the ds report), send
//               (every batch done; serve --send pending --shots through the Figma bridge), shots (shot-<id>.png of
//               every done screen), check (<figma out>/report.json newer than the state and the shots), approve
//               (the check passes: approve.mjs --project --figma, then check again).
//
// nextSteps(project) -> { steps: [{ id, done, note }], next: { id, why, cmd } | null } (pure but for file reads).
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { readProject } from './project-file.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const mtime = (p) => (p && existsSync(p) ? statSync(p).mtimeMs : 0);
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const q = (s) => (/[\s"]/.test(s) ? `"${String(s).replace(/"/g, '\\"')}"` : s);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// an open finding the gate cannot allowlist (pipeline.gate: an unexplained norm root outside a real-Figma check, or
// any norm root from the record check or the norm layout)
const fixedOnly = (s) => (s.gate.open.roots || []).filter((r) => r.layer === 'norm' && !(s.report && s.report.figmaReal && !r.recordCheck && !r.on));

function gateState(rep) {
  const failing = rep.screens.filter((s) => !s.summary.pass);
  const approvable = failing.reduce((n, s) => n + (s.allowlistDraft || []).filter((d) => !(d.kind === 'root' && fixedOnly(s).some((r) => r.id === d.node && r.width === d.width))).length, 0);
  const plugin = failing.reduce((n, s) => n + fixedOnly(s).length, 0);
  const data = failing.reduce((n, s) => n + ((s.report && s.report.data) || []).length + ((s.report && s.report.unchecked) || []).length, 0);
  return { failing: failing.length, total: rep.screens.length, approvable, plugin, data };
}

export function nextSteps(p) {
  const tool = (f, args) => `node ${q(join(HERE, f))} ${args}`;
  const proj = `--project ${q(p.path)}`;
  const steps = [];
  let next = null;
  const step = (id, done, note, cmd, why) => {
    steps.push({ id, done, note });
    if (!done && !next) next = { id, why: why || note, cmd };
    return done;
  };

  if (!step('html', existsSync(p.html), existsSync(p.html) ? p.html : `${p.html} does not exist`, null,
    `write the source page ${p.html} (in Claude: "use the spec-to-html skill on <spec>"), or point "html" in ${p.path} at it`)) return { steps, next };

  if (!p.out) { step('ds', false, '"out" is missing in the project file', null, `add "out": "<ds output folder>" to ${p.path}`); return { steps, next }; }
  const repPath = join(p.out, 'report.json');
  const rep = readJson(repPath);
  const dsHtml = join(p.out, 'design-system.html');
  const inputs = [['the page', p.html], ['the rules', p.rules], ['the names', p.names], ['the allowlist', p.allowlist]].filter(([, f]) => f && existsSync(f));
  const newer = rep ? inputs.filter(([, f]) => mtime(f) > mtime(repPath)).map(([n]) => n) : [];
  const dsCmd = tool('ds.mjs', proj);
  if (!rep || !existsSync(dsHtml)) { step('ds', false, 'not run yet', dsCmd, 'build the design system (about 10 s per screen)'); return { steps, next }; }
  if (newer.length) { step('ds', false, `${newer.join(', ')} changed since the last run`, dsCmd, `run ds again: ${newer.join(', ')} changed since the last run`); return { steps, next }; }
  const g = gateState(rep);
  step('ds', true, `${g.total - g.failing}/${plural(g.total, 'screen', 'screens')} pass (${new Date(mtime(repPath)).toLocaleString()})`);

  const questions = readJson(join(p.out, 'questions.json')) || [];
  const open = questions.filter((x) => x.answered === undefined && !x.resolved).length;
  if (!step('questions', !open, open ? `${plural(open, 'open question', 'open questions')}` : 'all answered', tool('answer.mjs', proj),
    `answer ${plural(open, 'question', 'questions')} in the browser, Submit, then run ds again`)) return { steps, next };

  if (g.failing) {
    if (g.approvable) {
      step('approve', false, `${plural(g.failing, 'screen fails', 'screens fail')}, ${plural(g.approvable, 'finding', 'findings')} to review`, tool('approve.mjs', proj),
        `review ${plural(g.approvable, 'finding', 'findings')} in report.html (tick the ones that are fine, Submit), then run ds again`);
    } else {
      const why = [g.plugin ? `${plural(g.plugin, 'layout error', 'layout errors')} the plugin cannot explain (report it as a plugin bug)` : '',
        g.data ? `${plural(g.data, 'data finding or unchecked node', 'data findings or unchecked nodes')} (fix the HTML)` : ''].filter(Boolean).join('; ');
      step('approve', false, why || 'screens fail with nothing to approve', null, `nothing to approve: ${why || 'see report.html'}; see ${join(p.out, 'report.html')}`);
    }
    return { steps, next };
  }
  step('approve', true, 'every screen passes');

  if (p.components) {
    const cj = join(p.out, 'components.json');
    const ok = existsSync(cj) && mtime(cj) >= mtime(p.components) && mtime(cj) >= mtime(repPath);
    if (!step('components', ok, ok ? 'built' : existsSync(cj) ? 'out of date' : 'not built yet', tool('cmp.mjs', proj), 'build the components from the components file')) return { steps, next };
  }

  if (!p.figma || !p.figma.out) return { steps, next };
  const F = p.figma.out;
  const FD = join(F, 'figma'); // figma.mjs writes everything into <out>/figma/
  const fig = (args) => tool('figma.mjs', args);
  const st = readJson(join(FD, 'state.json'));
  const planCmd = fig(`plan --ds ${q(p.out)} --out ${q(F)}${p.figma.page ? ` --page ${q(p.figma.page)}` : ''}`);
  if (!st) { step('figma-plan', false, 'not planned yet', planCmd, 'split the design system into Figma batches'); return { steps, next }; }
  // state.json is rewritten by plan and by every ingest: older than the ds report = planned before the last ds run
  if (mtime(repPath) > mtime(join(FD, 'state.json'))) { step('figma-plan', false, 'the design system changed since the plan', planCmd, 'plan again (only changed screens are sent again)'); return { steps, next }; }
  step('figma-plan', true, 'planned');
  const batches = Object.values(st.batches || {});
  const pending = batches.filter((b) => b.status !== 'done').length;
  const fileArg = st.figmaFile ? '' : p.figma.file ? ` --file ${q(p.figma.file)}` : ' --file <Figma file name>';
  const sendCmd = fig(`serve --out ${q(F)}${fileArg} --send pending --shots`);
  const bridge = 'open the Figma file in Figma Desktop and run Plugins > Development > vuong-design bridge (once per machine: Import plugin from manifest... with the path serve prints)';
  if (!step('figma-send', !pending, pending ? `${plural(pending, 'batch', 'batches')} not sent` : 'every batch built', sendCmd, `${bridge}; then send the batches`)) return { steps, next };
  const done = Object.entries(st.screens || {}).filter(([, s]) => s.status === 'done').map(([id]) => id);
  const missing = done.filter((id) => !existsSync(join(FD, `shot-${id}.png`)));
  if (!step('figma-shots', !missing.length, missing.length ? `${plural(missing.length, 'screenshot', 'screenshots')} missing` : 'taken',
    fig(`serve --out ${q(F)} --shots`), `${bridge}; then take the screenshots`)) return { steps, next };
  const shots = done.map((id) => mtime(join(FD, `shot-${id}.png`)));
  const chk = join(FD, 'report.json');
  const checkCmd = fig(`check --out ${q(F)}${p.allowlist ? ` --allowlist ${q(p.allowlist)}` : ''}`);
  const fresh = existsSync(chk) && mtime(chk) >= Math.max(mtime(join(FD, 'state.json')), ...shots, p.allowlist ? mtime(p.allowlist) : 0);
  if (!step('figma-check', fresh, fresh ? 'checked' : existsSync(chk) ? 'out of date' : 'not checked yet', checkCmd, 'check the real Figma screens node by node')) return { steps, next };
  const fr = readJson(chk);
  const fg = gateState(fr);
  if (fg.failing) {
    step('figma-approve', false, `${plural(fg.failing, 'screen fails', 'screens fail')} on Figma`, fg.approvable ? tool('approve.mjs', `${proj} --figma`) : null,
      fg.approvable ? `review ${plural(fg.approvable, 'finding', 'findings')} of the Figma check, Submit, then check again` : `nothing to approve; see ${join(FD, 'report.html')}`);
    return { steps, next };
  }
  step('figma-approve', true, `${fg.total}/${plural(fg.total, 'screen', 'screens')} pass on Figma`);
  return { steps, next };
}

const USAGE = 'usage: node core/next.mjs --project <vd-project.json>';

export function main(argv, { log = (s) => process.stdout.write(`${s}\n`), cwd = process.cwd() } = {}) {
  let o;
  try { o = parseArgs({ args: argv, options: { project: { type: 'string' } }, strict: true }).values; } catch (e) { log(`${e.message}\n${USAGE}`); return 2; }
  if (!o.project) { log(USAGE); return 2; }
  let p;
  try { p = readProject(resolve(cwd, o.project)); } catch (e) { log(e.message); return 2; }
  const { steps, next } = nextSteps(p);
  for (const s of steps) log(`${s.done ? '[x]' : '[ ]'} ${s.id}: ${s.note}`);
  if (!next) { log('\nall done'); return 0; }
  log(`\nnext (${next.id}): ${next.why}`);
  if (next.cmd) log(`  ${next.cmd}`);
  if (next.cmd && /ds\.mjs|figma\.mjs check/.test(next.cmd) && !process.env.VD_PLAYWRIGHT_FROM) log('  (Playwright: set VD_PLAYWRIGHT_FROM to a folder with node_modules/playwright, unless the project has it)');
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
