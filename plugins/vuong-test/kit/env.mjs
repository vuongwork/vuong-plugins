// Shared by e2e-kit and api-kit: which environments may receive writes (test.config.json `environments`).
import { existsSync } from "node:fs";
import { loadConfig } from "../core/config.mjs";

/** Environments from test.config.json (+ this machine's test.config.local.json) → [{name, match, writable}]. Array or object form. */
export function loadEnvironments(cfgFile) {
  if (!cfgFile || !existsSync(cfgFile)) return [];
  let envs;
  try {
    envs = loadConfig(cfgFile, { strict: false }).environments;
  } catch {
    return [];
  }
  const norm = (name, e) => ({ name, match: e.match ?? e.baseUrl ?? name, writable: e.writable === true, apiBase: e.apiBase });
  if (Array.isArray(envs)) return envs.map((e) => norm(e.name, e));
  return Object.entries(envs || {}).map(([name, e]) => norm(name, e));
}

/** string: substring match (placeholders like "<url>" never match); RegExp: test. */
export const matches = (m, s) =>
  m instanceof RegExp ? m.test(s) : typeof m === "string" && m && !m.startsWith("<") ? s.includes(m) : false;

/** null when `detected` may receive writes, otherwise the reason. */
export function writeBlockReason(detected, environments, expect) {
  if (expect && !expect.test(detected)) return `environment ${detected} not allowed for writes (expected ${expect})`;
  const hit = environments.find((e) => matches(e.match, detected) || matches(e.apiBase, detected) || matches(e.name, detected));
  if (!hit || !hit.writable) return `environment ${hit?.name || detected} not allowed for writes (needs environments[].writable === true)`;
  return null;
}

/** shorten a stored body */
export const clip = (t, n = 2000) => (t == null ? undefined : t.length > n ? `${t.slice(0, n)}… (${t.length} chars)` : t);
/** hide secrets in a JSON/form body before it is stored in results */
export const redact = (t) =>
  t == null ? t : String(t).replace(/("?(?:password|passwd|pwd|secret|token|access_token|refresh_token|authorization)"?\s*[:=]\s*)("[^"]*"|[^&,}\s]+)/gi, '$1"***"');

/**
 * Readable failures: verify(what, expected, actual[, ok]) records a mismatch instead of throwing; the case fails
 * at the end with every mismatch as
 *   ✗ <what>
 *     Expected: <expected>
 *     Actual:   <actual>
 * expected may be a RegExp (tested against String(actual)) or a value (JSON-equal); ok(actual) overrides.
 */
export function makeVerify() {
  const list = [];
  const show = (v) => (v instanceof RegExp ? String(v) : typeof v === "string" ? JSON.stringify(v) : JSON.stringify(v) ?? String(v));
  const verify = (what, expected, actual, ok) => {
    const pass = typeof ok === "function" ? !!ok(actual) : expected instanceof RegExp ? expected.test(String(actual)) : JSON.stringify(expected) === JSON.stringify(actual);
    if (!pass) list.push(`✗ ${what}\n  Expected: ${clip(show(expected), 300)}\n  Actual:   ${clip(show(actual), 300)}`);
    return pass;
  };
  const flush = () => {
    if (!list.length) return;
    const msg = list.join("\n");
    list.length = 0;
    throw new Error(msg);
  };
  return { verify, flush };
}
