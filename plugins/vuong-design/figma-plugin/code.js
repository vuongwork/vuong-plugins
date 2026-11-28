// vuong-design bridge, main thread. Runs the jobs the UI fetches from figma.mjs serve:
//   code: the same script text use_figma would run (top-level await and return), result sent back as JSON text
//   shot: exports a node as PNG at the given scale (its own bounds), bytes sent back
// It never changes a script: the batch loader checks its data hash and adds the result hash, figma.mjs ingest checks it.
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

// figma.getNodeByIdAsync on a frame times out in a development plugin ("Unable to establish connection to Figma after
// 10 seconds", Figma Desktop 2026-11) while a page id and every other API work: look the node up on the pages instead,
// the current page first, a screen root among the page's children before a deep search.
async function findNode(id) {
  const pages = [figma.currentPage, ...figma.root.children.filter((p) => p !== figma.currentPage)];
  for (const pg of pages) {
    await pg.loadAsync();
    const n = pg.children.find((c) => c.id === id) || pg.findOne((c) => c.id === id);
    if (n) return n;
  }
  return null;
}

figma.showUI(__html__, { width: 300, height: 170, themeColors: true });

// the bridge serves a run's jobs only to a plugin in the run's target file: tell the UI this file's name (again when the
// file is renamed), and refuse a job addressed to another file in case one gets here anyway
let fileName = null;
const sendName = () => { if (figma.root.name !== fileName) { fileName = figma.root.name; figma.ui.postMessage({ type: 'file', name: fileName }); } };
sendName();
setInterval(sendName, 1000);
const wrongFile = (m) => m.file != null && m.file !== figma.root.name ? `this job is for Figma file "${m.file}", this file is "${figma.root.name}"` : null;

figma.ui.onmessage = async (m) => {
  if (!m || !m.type) return;
  const wf = (m.type === 'code' || m.type === 'shot') && wrongFile(m);
  if (wf) { figma.ui.postMessage({ type: 'result', id: m.id, ok: false, error: wf }); return; }
  if (m.type === 'code') {
    try {
      const out = await new AsyncFunction('figma', m.code)(figma);
      figma.ui.postMessage({ type: 'result', id: m.id, ok: true, text: JSON.stringify(out === undefined ? null : out) });
    } catch (e) {
      // the message, then the stack (a Figma stack holds only the "at" lines)
      const msg = (e && e.message) || String(e), stack = (e && e.stack) || '';
      figma.ui.postMessage({ type: 'result', id: m.id, ok: false, error: (stack.includes(msg) ? stack : `${msg}\n${stack}`).slice(0, 2000) });
    }
  } else if (m.type === 'shot') {
    try {
      const n = await findNode(m.root);
      if (!n || n.removed || !('exportAsync' in n)) throw new Error(`node ${m.root} not found`);
      const bytes = await n.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: m.scale || 2 }, useAbsoluteBounds: true });
      figma.ui.postMessage({ type: 'shot', id: m.id, ok: true, bytes });
    } catch (e) {
      figma.ui.postMessage({ type: 'result', id: m.id, ok: false, error: String((e && e.message) || e).slice(0, 2000) });
    }
  } else if (m.type === 'close') figma.closePlugin();
};
