#!/usr/bin/env node
// PreToolUse hook for the Bash tool: blocks commands that can destroy data or history while tests run.
// Enabled automatically by hooks/hooks.json while the plugin is installed. Exit 2 = block, the reason on
// stderr is shown to Claude. Project-agnostic; extend with VUONG_TEST_GUARD_EXTRA (a regex source) for
// project-specific patterns; VUONG_TEST_GUARD=off disables it.
import { readFileSync } from "node:fs";

if (/^(off|0|false)$/i.test(process.env.VUONG_TEST_GUARD || "")) process.exit(0);

let input = {};
try {
  input = JSON.parse(readFileSync(0, "utf8") || "{}");
} catch {
  process.exit(0); // not our input format: do not interfere
}
if (input.tool_name && input.tool_name !== "Bash") process.exit(0);
const cmd = String(input.tool_input?.command || "");

// [pattern, reason]
const RULES = [
  [/\b(drop|truncate)\s+(table|database|schema)\b/i, "SQL DROP/TRUNCATE"],
  [/\bdelete\s+from\b/i, "SQL DELETE FROM"],
  [/\b(psql|mysql|sqlcmd|sqlplus|mongo|mongosh|redis-cli)\b/i, "direct DB client — tests change data only through the app"],
  [/\bgit\s+(reset\s+--hard|clean\s+-[a-z]*f|push\s+[^|;&]*(--force|-f)\b|stash\s+[^|;&]*(-u|--include-untracked|--all|-a)\b|checkout\s+--\s+\.|restore\s+--staged\s+\.?\s*$)/i, "git command that discards work"],
  [/\brm\s+-[a-z]*r[a-z]*f?\s+(\/|~|\.\.?|\$HOME|\*)(\s|$)/i, "rm -r on /, ~, . or .."],
  [/\b(curl|wget|http)\b[^|;&]*(-X\s*|--request\s+)(DELETE|PUT|POST|PATCH)\b/i, "direct API write call — writes go through a case declared writes:true"],
  [/\bcurl\b[^|;&]*\s(-d|--data[a-z-]*|-F|--form)\s/i, "direct API write call (curl with a body)"],
  [/\b(mkfs|dd\s+if=|shutdown|reboot)\b/i, "system-level destructive command"],
];
if (process.env.VUONG_TEST_GUARD_EXTRA) RULES.push([new RegExp(process.env.VUONG_TEST_GUARD_EXTRA, "i"), "project rule"]);

const hit = RULES.find(([re]) => re.test(cmd));
if (hit) {
  process.stderr.write(
    `[vuong-test guard] blocked: ${hit[1]}.\nCommand: ${cmd.slice(0, 300)}\n` +
      "If the user really wants this, ask them to run it themselves (prefix ! in the prompt).\n"
  );
  process.exit(2);
}
process.exit(0);
