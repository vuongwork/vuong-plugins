#!/usr/bin/env node
// Split the approved cases of a scope into parallel writer groups (step 6), the same way every time, 0 tokens.
//
//   node split.mjs W/cases.md [--per <max weight per agent, default 75>] [--max <agents, default 5>]
//
// Weight per case: e2e 3 · api / mount 2 · ut 1 (manual: no test code, not split). Groups weigh
// up to --per each (1 E2E case ≈ 2 API ≈ 3 UT; 75 ≈ 25 E2E cases): the fewest agents that fit, at most --max. E2E cases get their own groups, split first;
// the other layers share the rest. Groups are contiguous runs of the table (a case stays with the case it needs
// first, column Pre). Prints the fixed template of SKILL.md › 6 (Agent | Cases | Test file | Out dir | Notes | Data)
// for the main session to show; file names follow core/run.mjs "each" (W/e2e-a.mjs → results in W/e2e-a/).
import path from "node:path";
import { existsSync } from "node:fs";
import { parseCases } from "./parsers.mjs";

const argv = process.argv.slice(2);
const opt = { per: 75, max: 5, file: null };
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--per") opt.per = Number(argv[++i]);
  else if (argv[i] === "--max") opt.max = Number(argv[++i]);
  else if (!argv[i].startsWith("--") && !opt.file) opt.file = argv[i];
  else {
    console.error(`[vuong-test] split: unknown argument ${argv[i]}`);
    process.exit(2);
  }
}
if (!opt.file || !existsSync(opt.file) || !(opt.per > 0) || !(opt.max >= 1)) {
  console.error("usage: split.mjs W/cases.md [--per 75] [--max 5]");
  process.exit(2);
}
const W = path.dirname(opt.file).replace(/\\/g, "/");
const { cases } = parseCases(opt.file);
const WEIGHT = { e2e: 3, api: 2, mount: 2, ut: 1 };
const layer = (c) => c.layer.trim().toLowerCase();
const auto = cases.filter((c) => layer(c) !== "manual");
const manual = cases.filter((c) => layer(c) === "manual");
const w = (c) => WEIGHT[layer(c)] ?? 2;
const sum = (xs) => xs.reduce((n, c) => n + w(c), 0);
const e2e = auto.filter((c) => layer(c) === "e2e");
const core = auto.filter((c) => layer(c) !== "e2e");
const total = sum(auto);
// fewest agents whose heaviest group stays within --per; for each count, the E2E / other split with the lightest
// heaviest group (every extra agent re-reads the inputs: more cost, so not more agents than needed)
let nE = e2e.length ? 1 : 0;
let nC = core.length ? 1 : 0;
const single = total <= opt.per; // small scope: one agent writes every layer
if (!single) {
  for (let n = nE + nC; n <= Math.max(opt.max, nE + nC); n++) {
    let best = null;
    for (let e = e2e.length ? 1 : 0; e <= Math.min(e2e.length, n); e++) {
      const c = n - e;
      if ((core.length && !c) || c > core.length) continue;
      const m = Math.max(c ? sum(core) / c : 0, e ? sum(e2e) / e : 0);
      if (!best || m < best.m) best = { e, c, m };
    }
    if (!best) continue;
    (nE = best.e), (nC = best.c);
    if (best.m <= opt.per) break;
  }
}

// contiguous chunks of about equal weight; a boundary moves forward while the next case needs (Pre) one inside
function chunks(list, k) {
  if (k <= 1) return list.length ? [list] : [];
  const out = [];
  let cur = [];
  let left = sum(list);
  let groupsLeft = k;
  for (let i = 0; i < list.length; i++) {
    cur.push(list[i]);
    const target = left / groupsLeft;
    const next = list[i + 1];
    const tied = next && next.pre.some((p) => cur.some((c) => c.id === p));
    if (groupsLeft > 1 && sum(cur) >= target && next && !tied) {
      out.push(cur);
      left -= sum(cur);
      groupsLeft--;
      cur = [];
    }
  }
  if (cur.length) out.push(cur);
  return out;
}
const letters = "abcdefghij";
const groups = single ? [{ name: "all", cases: auto }] : [];
const coreChunks = single ? [] : chunks(core, nC);
coreChunks.forEach((g, i) => groups.push({ name: coreChunks.length > 1 ? `core-${letters[i]}` : "core", cases: g }));
const e2eChunks = single ? [] : chunks(e2e, nE);
e2eChunks.forEach((g, i) => groups.push({ name: e2eChunks.length > 1 ? `e2e-${letters[i]}` : "e2e", cases: g }));

// L01-E01..L01-E05 for consecutive numbers
function ids(list) {
  const parts = [];
  let run = [];
  const flush = () => {
    if (run.length > 2) parts.push(`${run[0].id}..${run[run.length - 1].id}`);
    else parts.push(...run.map((r) => r.id));
    run = [];
  };
  for (const c of list) {
    const m = c.id.match(/^(.*?)(\d+)$/);
    const prev = run[run.length - 1];
    const pm = prev?.id.match(/^(.*?)(\d+)$/);
    if (prev && m && pm && m[1] === pm[1] && Number(m[2]) === Number(pm[2]) + 1) run.push(c);
    else {
      if (run.length) flush();
      run = [c];
    }
  }
  if (run.length) flush();
  return parts.join(", ");
}
const files = (g) => {
  const ls = new Set(g.cases.map(layer));
  const f = [];
  const o = [];
  const sfx = g.name.includes("-") ? `-${g.name.split("-")[1]}` : "";
  if (ls.has("ut")) f.push(`\`${W}/ut/\` (\`*${sfx || ""}.test.*\`)`);
  if (ls.has("mount")) f.push(`\`${W}/mount/\``);
  if (ls.has("api")) (f.push(`\`${W}/api${sfx}.mjs\``), o.push(`\`${W}/api${sfx}/\``));
  if (ls.has("e2e")) (f.push(`\`${W}/e2e${sfx}.mjs\``), o.push(`\`${W}/e2e${sfx}/\``));
  return [f.join(" · "), o.join(" · ") || "—"];
};
const byLayer = (g) =>
  Object.entries(g.cases.reduce((m, c) => ((m[layer(c)] = (m[layer(c)] || 0) + 1), m), {}))
    .map(([l, k]) => `${l} ${k}`)
    .join(", ");
const writes = groups.filter((g) => g.cases.some((c) => /^y/i.test(c.writes.trim())));

console.log(`[vuong-test] split: ${auto.length} automated cases (weight ${total}) → ${groups.length} writer agent${groups.length > 1 ? "s" : ""}${manual.length ? ` · ${manual.length} manual (runbook, no agent)` : ""}`);
console.log("");
console.log("| Agent | Cases | Test file (own) | Out dir (own) | Notes (own) | Data |");
console.log("|---|---|---|---|---|---|");
for (const g of groups) {
  const [tf, od] = files(g);
  const wy = g.cases.filter((c) => /^y/i.test(c.writes.trim())).length;
  console.log(`| \`${g.name}\` | ${g.cases.length} (${byLayer(g)}): ${ids(g.cases)} | ${tf} | ${od} | \`${W}/run-notes-${g.name}.md\` | ${wy ? `Writes = Y: ${wy}` : "read-only"} |`);
}
if (writes.length > 1)
  console.log(`\nWrites = Y in ${writes.length} groups (${writes.map((g) => g.name).join(", ")}): fine on a local server (core/run.mjs gives each dry run a fresh one); on a shared environment move those cases into one group.`);
// what test.config.json (cwd) already has, so the main session need not look it up
let cfg = null;
try {
  cfg = (await import("./config.mjs")).loadConfig("test.config.json");
} catch {
  /* no config here */
}
const e2eStack = (cfg?.stacks || []).find((x) => /playwright|e2e/i.test(`${x.id} ${x.stack}`));
const envs = Array.isArray(cfg?.environments) ? cfg.environments : Object.values(cfg?.environments || {});
const srv = envs.find((e) => e.server)?.server;
if (groups.some((g) => g.name.startsWith("e2e")))
  console.log(e2eStack?.each
    ? `E2E stack: "each" set (${e2eStack.each}) ✓ — a group dry-runs its own file with core/run.mjs <scope> --only e2e --files <its file>.`
    : `E2E stack: set "each": "${W}/e2e*.mjs", "run": "node {file}" in test.config.json before starting — a group dry-runs its own file with core/run.mjs <scope> --only e2e --files <its file>.`);
if (groups.length > 1 && srv)
  console.log(srv.portEnv
    ? `Server: portEnv ${srv.portEnv} set ✓ — every dry run gets its own server, none waits.`
    : `Server: no portEnv — dry runs queue for the one server. If "${srv.start}" reads its port from an env var and keeps its data per instance, add "portEnv": "<that var>".`);
