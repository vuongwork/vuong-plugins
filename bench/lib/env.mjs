// Environment for a child `claude -p`: variables of the Claude Code session that launched the bench must not leak
// into the child (auth via ANTHROPIC_API_KEY, messaging sockets, effort), so the child uses the claude.ai login.
export function childEnvFor(env = process.env) {
  const out = {};
  for (const [k, v] of Object.entries(env)) {
    if (k === 'ANTHROPIC_API_KEY' || k === 'CLAUDECODE' || k === 'CLAUDE_PID' || k === 'CLAUDE_EFFORT') continue;
    if (k.startsWith('CLAUDE_CODE_')) continue;
    out[k] = v;
  }
  return out;
}
