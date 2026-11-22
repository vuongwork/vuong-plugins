// Pure rendering of report.html (no browser): units on every number, verdict lines, plain font reasons, grouping of
// repeated findings, the "How to read this report" section.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderReportHtml, describeDelta, verdictLine } from '../core/report-html.mjs';

const summary = (o = {}) => ({
  file: 'f.html', screen: 's0', checked: 10, total: 10, unchecked: 0, unexplainedRoots: 0, needsApproval: 0, approvalMax: 0,
  crop: 0, cropLinked: 0, data: {}, flags: {}, skipped: [], allowed: 0, specBytes: 20618, payloadOver50k: false,
  pixel: [0.0067, 0], pass: true, ...o,
});
const view = (o = {}) => ({
  file: 'f.html', summary: summary(o.summary), items: [], data: [], unchecked: [], skipped: [],
  norm: { fontSubs: [], modelSubs: [], lineHeight: 3, original: null, measured: null },
  mutations: null, W: [304, 424], widen: { by: 120, unsafe: false }, tol: { frame: 0.5, text: 1, model: 2 }, ...o, summary: summary(o.summary),
});
const root = (o = {}) => ({ kind: 'root', id: 'n.1', width: 'B', node: 'span.badge "New"', proxy: 'layout proxy', src: [10, 20, 30, 12], box: [9.39, 20, 30, 12],
  x: { id: 'n.1', width: 'B', delta: [-0.61, 0, 0, 0], why: ['x'] }, flags: [], ...o });
const approval = (o = {}) => ({ kind: 'approval', id: 'n.2', width: 'A', node: 'p.t', proxy: 'modelled proxy', src: null, box: null,
  x: { id: 'n.2', width: 'A', delta: [0, 3.25, 0, 0.5], magnitude: 3.25, explainedBy: 'figmaModel' }, flags: [], ...o });
const crop = (o = {}) => ({ kind: 'crop', id: 'n.3', width: 'A', node: 'img', proxy: 'layout proxy', src: null, box: null,
  x: { id: 'n.3', width: 'A', ratio: 0.205, diff: 517, peak: 48 }, flags: [], ...o });

test('describeDelta names directions in px and leaves out zero components', () => {
  assert.equal(describeDelta([-0.61, 0, 0, 0]), 'moved left 0.61 px');
  assert.equal(describeDelta([2.28, 0.75, 0.23, 0]), 'moved right 2.28 px, moved down 0.75 px, wider by 0.23 px');
  assert.equal(describeDelta([0, -1, -2, 3]), 'moved up 1 px, narrower by 2 px, taller by 3 px');
  assert.equal(describeDelta([0, 0, 0, -4.004]), 'shorter by 4 px');
  assert.equal(describeDelta([0, 0, 0, 0]), 'no change');
});

test('items carry units: layout delta, model delta with tolerance, crop percentages', () => {
  const v = view({ summary: { pass: false, unexplainedRoots: 1, needsApproval: 1, crop: 1 }, items: [root(), approval(), crop()] });
  const html = renderReportHtml({ screens: [v] });
  assert.match(html, /moved left 0\.61 px, at width B \(424 px\)/);
  assert.match(html, /moved down 3\.25 px, taller by 0\.5 px, at width A \(304 px\); total 3\.25 px, over the tolerance of 2 px/);
  assert.match(html, /20\.5% of pixels differ; largest colour difference 48\/255; 517 px differ/);
  assert.match(html, /pixel difference 0\.7% at A \/ 0% at B \(for reference only, not used for pass\/fail\)/);
  assert.match(html, /A = 304 px, B = 424 px \(stretched by 120 px to test resizing\)/);
  assert.match(html, /20\.6 KB/);
  assert.doesNotMatch(html, /dx -0\.61/);
});

test('verdict line under each screen heading', () => {
  assert.equal(verdictLine(view()), 'Matches.');
  const failing = view({ summary: { pass: false, unexplainedRoots: 1, crop: 2 }, items: [root(), crop(), crop({ width: 'B' })] });
  assert.equal(verdictLine(failing), '1 layout error the plugin cannot explain (span.badge), 2 image mismatches. Nothing for you to approve.');
  const appr = view({ summary: { pass: false, needsApproval: 2 }, items: [approval(), approval({ width: 'B' })] });
  assert.match(verdictLine(appr), /^2 items need your approval \(Figma model limitation[^)]*\)\.$/);
  const html = renderReportHtml({ screens: [failing] });
  assert.match(html, /<p class="verdict[^"]*">1 layout error the plugin cannot explain/);
});

test('font substitution reasons and the line-height count read as sentences; thumbnails are captioned', () => {
  const v = view({ norm: {
    fontSubs: [{ from: 'Inter', to: 'Inter', reason: 'version' }, { from: 'Segoe UI', to: 'Inter', reason: 'not-in-figma' }, { from: 'system-ui', to: 'Inter', reason: 'system' }],
    modelSubs: [], lineHeight: 12, original: 'data:image/png;base64,AA', measured: 'data:image/png;base64,AA' } });
  const html = renderReportHtml({ screens: [v] });
  assert.match(html, /the installed copy differs from the one Figma uses; measured with Figma&#39;s version/);
  assert.match(html, /Segoe UI is not available in Figma; replaced with Inter/);
  assert.match(html, /system-ui depends on the machine; fixed to Inter/);
  assert.match(html, /12 text elements had line-height: normal; written as exact px because Figma has no &#39;normal&#39;/);
  assert.match(html, /identical = normalisation changed nothing/i);
});

test('identical findings across screens are grouped; counts and verdicts are unchanged', () => {
  const s = (screen) => view({ summary: { screen, pass: false, needsApproval: 1 }, items: [approval()] });
  const other = view({ file: 'g.html', summary: { file: 'g.html', screen: 's2', pass: false, needsApproval: 1 }, items: [approval()] });
  const html = renderReportHtml({ screens: [s('s0'), s('s1'), other] });
  assert.match(html, /Repeated across screens/);
  assert.equal((html.match(/class="item[^"]*" data-kind="approval"/g) || []).length, 2, 'one full item in f.html, one in g.html');
  assert.equal((html.match(/class="item repeat"/g) || []).length, 1, 's1 gets a one-line reference');
  assert.match(html, /needs approval 3|items needing approval 3/);
  assert.equal((html.match(/1 item needs your approval/g) || []).length, 3);
});

test('a fixed, collapsible "How to read this report" section near the top', () => {
  const html = renderReportHtml({ screens: [view()] });
  const i = html.indexOf('How to read this report');
  assert.ok(i > 0 && i < html.indexOf('<table'));
  assert.match(html, /<details class="howto">/);
  for (const w of [/plugin bug/, /approved: ?true/, /magenta/, /caught/, /yellow/, /width A/i]) assert.match(html, w);
});

test('R52: an open finding is never shown as a repeat of an allowlisted one, nor of a finding on another node', () => {
  // probe-group: s0 has the root allowlisted, s1 has the identical root open
  const s0 = view({ summary: { screen: 's0', pass: true, allowed: 1 }, items: [root({ allowedBy: 'approved: badge rounding' })] });
  const s1 = view({ summary: { screen: 's1', pass: false, unexplainedRoots: 1 }, items: [root()] });
  let html = renderReportHtml({ screens: [s0, s1] });
  const sec = html.slice(html.indexOf('id="s-f_html-s1"'));
  assert.doesNotMatch(sec.slice(0, sec.indexOf('</section>')), /class="item repeat"/);
  assert.match(sec, /<div class="item" data-kind="root"/);
  // the same id with the same numbers on another node (another tag / class / text) is not a repeat either
  const s2 = view({ summary: { screen: 's2', pass: false, unexplainedRoots: 1 }, items: [root({ node: 'span.pill "Old"' })] });
  html = renderReportHtml({ screens: [s1, s2] });
  assert.equal((html.match(/class="item repeat"/g) || []).length, 0);
  // two open identical findings on the same node still group
  const s3 = view({ summary: { screen: 's3', pass: false, unexplainedRoots: 1 }, items: [root()] });
  html = renderReportHtml({ screens: [s1, s3] });
  assert.equal((html.match(/class="item repeat"/g) || []).length, 1);
});
