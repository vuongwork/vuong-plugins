// spec-to-html on the leave-request spec: the file exists, has the 4 screens, lints with 0 errors, layout passes.
// Re-runs lint and layout itself (exit codes), so the score does not depend on what the session claimed.
import { join, resolve } from 'node:path';
import { check } from '../../../../lib/grade.mjs';

const PLUGIN = resolve('E:/vuongpq/plugins/vuong-plugins-wt-preview/plugins/vuong-design');
const SCREENS = ['L01-N', 'L01-NE', 'L01-V', 'L01-C'];

export default async function grade({ ws, read, sh }) {
  const html = read('ui/L01.html');
  if (!html) return [check('ui/L01.html written', 0)];
  const have = SCREENS.filter((s) => new RegExp(`data-vd-screen=["']${s}["']`).test(html));
  const env = { ...process.env, VD_PLAYWRIGHT_FROM: 'E:/vuongpq/plugins/vd-devdeps' };
  const lint = sh(`node "${join(PLUGIN, 'core/lint.mjs')}" --html ui/L01.html --out grade-out/lint`, { env });
  const warn = (lint.out.match(/(\d+) warning/) || [])[1];
  const layout = lint.code === 0 ? sh(`node "${join(PLUGIN, 'core/layout.mjs')}" --html ui/L01.html --out grade-out/layout`, { env, timeoutMs: 600000 }) : null;
  const passLine = layout ? (layout.out.match(/(\d+)\/(\d+) screens pass/) || []) : [];
  return [
    check('ui/L01.html written', 1),
    check('4 screens present', have.length / SCREENS.length, `missing: ${SCREENS.filter((s) => !have.includes(s)).join(', ') || '-'}`),
    check('lint 0 errors', lint.code === 0 ? 1 : 0, lint.out.trim().split('\n')[0] + (warn ? ` (${warn} warnings)` : '')),
    check('layout passes', layout ? (passLine[2] ? passLine[1] / passLine[2] : layout.code === 0 ? 1 : 0) : 0, layout ? (passLine[0] || layout.out.trim().split('\n').pop()) : 'not run: lint errors'),
  ];
}
