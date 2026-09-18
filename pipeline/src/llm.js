// Thin wrapper over the Anthropic SDK: one agentic loop that supports server tools (web search / fetch) and a strict
// "submit" tool that ends the run. Mock mode (AGENTS_MOCK=1) returns canned submissions for local tests.
import Anthropic from '@anthropic-ai/sdk';
import { log } from './util.js';

export const MODEL = process.env.AGENT_MODEL || 'claude-opus-5';
let client = null;
function getClient() {
  if (!client) {
    const opts = { maxRetries: 3, timeout: 15 * 60 * 1000 };
    // Identity-linked API keys must be scoped to a workspace: the API requires the anthropic-workspace-id header.
    if (process.env.ANTHROPIC_WORKSPACE_ID) { opts.workspaceID = process.env.ANTHROPIC_WORKSPACE_ID; opts.defaultHeaders = { 'anthropic-workspace-id': process.env.ANTHROPIC_WORKSPACE_ID }; }
    client = new Anthropic(opts);
  }
  return client;
}

// Usage accounting. Cache writes and server-tool requests are billed too, so they are counted; cost is an estimate
// from list prices ($ per million tokens: input, output; cache write 1.25x input, cache read 0.1x input; web search $10 per 1,000).
const PRICES = { 'claude-opus-5': [5, 25], 'claude-sonnet-5': [2, 10], 'claude-haiku-4-5': [1, 5], 'claude-fable-5-1': [10, 50] };
const blank = () => ({ input: 0, output: 0, cache_read: 0, cache_write: 0, searches: 0, fetches: 0, calls: 0 });
const usageTotal = blank(); const usageBy = {};
export function costOf(u) { const [pi, po] = PRICES[MODEL] || PRICES['claude-opus-5']; return +(((u.input * pi) + (u.output * po) + (u.cache_write * pi * 1.25) + (u.cache_read * pi * 0.1)) / 1e6 + u.searches * 0.01).toFixed(3); }
export const usage = () => ({ ...usageTotal, est_usd: costOf(usageTotal), by: Object.fromEntries(Object.entries(usageBy).map(([k, v]) => [k, { ...v, est_usd: costOf(v) }])) });
function addUsage(u, label = 'other') {
  if (!u) return; const st = u.server_tool_use || {};
  for (const t of [usageTotal, (usageBy[label] = usageBy[label] || blank())]) { t.input += u.input_tokens || 0; t.output += u.output_tokens || 0; t.cache_read += u.cache_read_input_tokens || 0; t.cache_write += u.cache_creation_input_tokens || 0; t.searches += st.web_search_requests || 0; t.fetches += st.web_fetch_requests || 0; t.calls++; }
}

async function createMessage(params) {
  const c = getClient();
  try {
    const stream = c.beta.messages.stream({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' });
    return await stream.finalMessage();
  } catch (e) {
    if (e instanceof Anthropic.BadRequestError) { log('llm: fallbacks/beta rejected, retrying plain', String(e.message).slice(0, 120)); const stream = c.messages.stream(params); return await stream.finalMessage(); }
    throw e;
  }
}

/**
 * Run an agent until it calls `submitTool` (returns its input) or gives up.
 * @param {object} o  { system, user, tools, submitTool, maxIters, effort, mock }
 */
export async function runAgent(o) {
  if (process.env.AGENTS_MOCK === '1') return o.mock ? o.mock() : null;
  const messages = [{ role: 'user', content: [{ type: 'text', text: o.user, cache_control: { type: 'ephemeral' } }] }];
  let submission = null;
  for (let i = 0; i < (o.maxIters || 10); i++) {
    const params = { model: MODEL, max_tokens: 32000, system: [{ type: 'text', text: o.system, cache_control: { type: 'ephemeral' } }], messages, tools: o.tools, output_config: { effort: o.effort || 'high' }, tool_choice: { type: 'auto' } };
    const msg = await createMessage(params);
    addUsage(msg.usage, o.label);
    if (msg.stop_reason === 'refusal') { log('llm: refusal', msg.stop_details && msg.stop_details.category); return null; }
    const toolUses = msg.content.filter(b => b.type === 'tool_use');
    const sub = toolUses.find(b => b.name === o.submitTool);
    if (sub) { submission = sub.input; break; }
    if (msg.stop_reason === 'pause_turn') { messages.push({ role: 'assistant', content: msg.content }); continue; }
    if (msg.stop_reason === 'tool_use' && toolUses.length) {
      // Only server tools and the submit tool exist; any other tool_use is unexpected.
      messages.push({ role: 'assistant', content: msg.content });
      messages.push({ role: 'user', content: toolUses.map(t => ({ type: 'tool_result', tool_use_id: t.id, content: 'Unknown tool. Use web_search, web_fetch, or ' + o.submitTool + '.', is_error: true })) });
      continue;
    }
    if (msg.stop_reason === 'end_turn' || msg.stop_reason === 'max_tokens') {
      messages.push({ role: 'assistant', content: msg.content });
      messages.push({ role: 'user', content: `You stopped without calling ${o.submitTool}. Call it now with what you have (an empty list is fine).` });
      continue;
    }
    break;
  }
  return submission;
}
