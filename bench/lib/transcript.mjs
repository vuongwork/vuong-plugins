// Read a `claude -p --output-format stream-json --verbose` trace.
// Lines are either raw events or `{ t, e }` (t = ms since the run started, stamped by run.mjs as lines arrive).
// Usage is counted once per API message id (one message can be split over several assistant events).

export function readTrace(text) {
  const events = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    if (o && o.e && typeof o.t === 'number') events.push({ t: o.t, ...o.e });
    else events.push(o);
  }
  return events;
}

// Price weights relative to input tokens (list-price ratios, same for every current model).
// Used only to split a model's reported cost over its messages; totals always come from the result event.
export const WEIGHT = { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 2 };
const weight = (u) => u.input * WEIGHT.input + u.output * WEIGHT.output + u.cacheRead * WEIGHT.cacheRead + u.cacheWrite * WEIGHT.cacheWrite;

export function parseTrace(events) {
  const init = events.find((e) => e.type === 'system' && e.subtype === 'init') || {};
  const result = events.find((e) => e.type === 'result') || null;
  const byId = new Map();
  const messages = [];
  const toolResults = new Map();
  for (const e of events) {
    if (e.type === 'assistant' && e.message) {
      const m = e.message;
      let msg = byId.get(m.id);
      if (!msg) {
        const u = m.usage || {};
        msg = {
          id: m.id, model: m.model, t: e.t ?? null, sub: e.parent_tool_use_id || null,
          usage: { input: u.input_tokens || 0, output: u.output_tokens || 0, cacheRead: u.cache_read_input_tokens || 0, cacheWrite: u.cache_creation_input_tokens || 0 },
          tools: [], text: '',
        };
        byId.set(m.id, msg);
        messages.push(msg);
      } else if (m.usage && (m.usage.output_tokens || 0) > msg.usage.output) {
        msg.usage.output = m.usage.output_tokens; // later event of the same message carries the final count
      }
      if (e.t != null) msg.tEnd = e.t;
      for (const c of m.content || []) {
        if (c.type === 'tool_use') msg.tools.push({ id: c.id, name: c.name, input: c.input || {} });
        else if (c.type === 'text') msg.text += c.text;
      }
    } else if (e.type === 'user' && e.message && Array.isArray(e.message.content)) {
      for (const c of e.message.content) {
        if (c.type !== 'tool_result') continue;
        const body = typeof c.content === 'string' ? c.content : (c.content || []).map((x) => x.text || '').join('');
        toolResults.set(c.tool_use_id, { bytes: Buffer.byteLength(body), isError: !!c.is_error, text: body });
      }
    }
  }
  // Cost per message: the model's reported cost split by price weight.
  const modelUsage = (result && result.modelUsage) || {};
  const wSum = {};
  for (const m of messages) wSum[m.model] = (wSum[m.model] || 0) + weight(m.usage);
  for (const m of messages) {
    const c = modelUsage[m.model]?.costUSD;
    m.costUsd = c != null && wSum[m.model] ? (c * weight(m.usage)) / wSum[m.model] : null;
  }
  for (const m of messages) for (const tl of m.tools) tl.result = toolResults.get(tl.id) || null;
  return {
    init: { model: init.model, plugins: (init.plugins || []).map((p) => p.name), skills: init.skills || [], tools: init.tools || [] },
    messages,
    result: result && {
      isError: !!result.is_error, text: result.result || '', costUsd: result.total_cost_usd ?? null, durationMs: result.duration_ms ?? null,
      turns: result.num_turns ?? null, terminalReason: result.terminal_reason || result.subtype || null,
      denials: (result.permission_denials || []).map((d) => ({ tool: d.tool_name, input: d.tool_input })),
      modelUsage,
    },
  };
}

export function totals(messages) {
  const t = { apiCalls: messages.length, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, toolCalls: 0, costUsd: 0, models: {} };
  for (const m of messages) {
    for (const k of ['input', 'output', 'cacheRead', 'cacheWrite']) t[k] += m.usage[k];
    t.toolCalls += m.tools.length;
    t.costUsd += m.costUsd || 0;
    t.models[m.model] = (t.models[m.model] || 0) + 1;
  }
  t.costUsd = Math.round(t.costUsd * 10000) / 10000;
  return t;
}
