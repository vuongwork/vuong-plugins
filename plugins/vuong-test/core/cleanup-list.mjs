#!/usr/bin/env node
// Cleanup checklist from data-created.md (step 7/8). Prints records grouped by how they are removed:
//   UI       status `left`      — the tester deletes/reverts them in the app (path in "How to delete / revert")
//   BE / DB  status `needs-be`  — cannot be removed in the UI; hand the list to whoever owns the backend/DB
//   done     status `deleted` / `reverted`
//
//   node cleanup-list.mjs W/data-created.md
// Exit 1 while any record is still `left` or `needs-be`, 0 when everything is cleaned. Never deletes anything.
import { existsSync } from "node:fs";
import { parseDataCreated } from "./parsers.mjs";

const file = process.argv[2];
if (!file || !existsSync(file)) {
  console.error("usage: cleanup-list.mjs <data-created.md>");
  process.exit(2);
}
const rows = parseDataCreated(file);
const group = (re) => rows.filter((r) => re.test(r.status));
const ui = group(/^left$/i);
const be = group(/needs-?be/i);
const done = group(/^(deleted|reverted)$/i);
const other = rows.filter((r) => !ui.includes(r) && !be.includes(r) && !done.includes(r));

const line = (r, box) => `  ${box} ${r.case} · ${r.environment || "?"} · ${r.record} (${r.action || "?"})${r.cleanup ? ` → ${r.cleanup}` : ""}`;
const section = (title, list, box) => {
  console.log(`\n${title} (${list.length})`);
  if (!list.length) console.log("  —");
  for (const r of list) console.log(line(r, box));
};
console.log(`# Cleanup — ${file}`);
section("Delete in the UI (status left)", ui, "[ ]");
section("Needs BE / DB (status needs-be) — cannot be removed in the UI", be, "[ ]");
section("Already deleted / reverted", done, "[x]");
if (other.length) section("Unknown status — fix the Status column (left / needs-be / deleted / reverted)", other, "[?]");
const open = ui.length + be.length + other.length;
console.log(`\n[vuong-test] ${rows.length} records: ${ui.length} left (UI), ${be.length} needs-be, ${done.length} done, ${other.length} unknown`);
process.exit(open ? 1 : 0);
