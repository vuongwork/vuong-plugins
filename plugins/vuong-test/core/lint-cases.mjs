#!/usr/bin/env node
// Lint cases.md before approval (step 4) and before running (step 7: --require-approval).
//
//   node lint-cases.mjs W/cases.md [--require-approval]
// Exit 1 on errors. Warnings do not fail.
import { parseCases } from "./parsers.mjs";

const file = process.argv[2];
const requireApproval = process.argv.includes("--require-approval");
if (!file) {
  console.error("usage: lint-cases.mjs <cases.md> [--require-approval]");
  process.exit(2);
}
const spec = parseCases(file);
const errors = [];
const warns = [];
const LAYERS = ["ut", "mount", "it", "api", "e2e"];
// expected results that cannot fail
const VAGUE = /^(ok|works?|success(ful)?|correct(ly)?|as expected|đúng|thành công|hoạt động( bình thường)?|bình thường|hiển thị đúng|no error|không lỗi)\.?$/i;

if (!spec.cases.length) errors.push("no case table found (header row must start with `| ID |`)");
// data that does not say what the case needs; "none: <reason>" is allowed
const VAGUE_DATA = /^(-+|—|–|n\/?a|any|anything|tbd|todo|\?|some data|existing( data)?|test data|bất kỳ|có sẵn|none|no)\.?$/i;
const seen = new Set();
for (const c of spec.cases) {
  const at = `case ${c.id || "(no id)"}`;
  if (!c.id) errors.push(`${at}: empty ID`);
  else if (!/^[A-Za-z][\w.\- ]*$/.test(c.id)) errors.push(`${at}: ID must start with a letter and use letters, digits, . - _`);
  if (seen.has(c.id)) errors.push(`${at}: duplicate ID`);
  seen.add(c.id);
  if (!LAYERS.includes(c.layer.toLowerCase())) errors.push(`${at}: layer "${c.layer}" not one of ${LAYERS.join("/")}`);
  if (!c.flow) errors.push(`${at}: Flow empty — link the flow ref (E1, B3...)`);
  if (!c.expected) errors.push(`${at}: Expected empty`);
  else if (/^⚠ not concrete/.test(c.expected.trim()))
    errors.push(`${at}: Expected from the tester's file is not concrete — replace it with the value + spec source, or write the source "assumption"`);
  else if (VAGUE.test(c.expected.trim())) errors.push(`${at}: Expected "${c.expected}" is not checkable — state the value, message, code or state`);
  if (!c.source) errors.push(`${at}: Source empty — cite a source or write "assumption"`);
  else if (/assumption/i.test(c.source)) warns.push(`${at}: assumption — cannot be approved until BA answers (or mark BLOCKED)`);
  if (!c.data || VAGUE_DATA.test(c.data.trim()))
    warns.push(`${at}: Data "${c.data}" is vague — say concretely which record/state the case needs (or "none: <why>"), see data-plan.md`);
  if (!/^[YN]$/i.test(c.writes)) errors.push(`${at}: Writes must be Y or N`);
}

const approved = spec.approvedBy && !/^</.test(spec.approvedBy);
if (requireApproval && !approved) errors.push("not approved: fill `Approved by` and `Date` in the header (step 5)");
if (requireApproval && spec.cases.some((c) => /assumption/i.test(c.source)))
  warns.push("running with assumption cases: they will be reported BLOCKED if they have no tests");

for (const w of warns) console.log(`warn  ${w}`);
for (const e of errors) console.log(`ERROR ${e}`);
console.log(`[vuong-test] ${spec.cases.length} cases, ${spec.notCovered.length} not covered, ${errors.length} errors, ${warns.length} warnings`);
process.exit(errors.length ? 1 : 0);
