import { P, readJSON, writeJSON, log } from './util.js';
import { collect, apply, carryOver } from './collect.js';
import { roll } from './roll.js';
import { research } from './research.js';
import { judge } from './judge.js';
import { usage } from './llm.js';
import { memo, memoDue } from './memo.js';
import { raiseAlert, clearAlerts } from './gh.js';
import { validate, previousState } from './validate.js';

const only = (process.argv.find(a => a.startsWith('--only=')) || '').slice(7);
const state = readJSON(P('site', 'data', 'state.json'));
const limits = readJSON(P('pipeline', 'config', 'limits.json'));
const cfg = readJSON(P('pipeline', 'config', 'watchlist.json'));
const changelog = readJSON(P('site', 'data', 'changelog.json'), []);
const prev = previousState();
const status = { agents: 'skipped', memo: 'skipped', error: null, alert: null };

if (!only || only === 'roll') roll(state, changelog, limits);
if (!only || only === 'collect') { const { obs, errs } = await collect(state, cfg, limits, changelog); apply(state, obs, limits, changelog); carryOver(state, changelog, limits); if (errs.length) log('collector errors:', errs.join(' | ')); }
if (!only || only === 'agents') {
  const canRun = cfg.agents_enabled && (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || process.env.AGENTS_MOCK === '1');
  if (canRun) {
    try { const { proposals } = await research(state, cfg, limits, changelog); const r = await judge(state, proposals || [], limits, changelog, cfg); status.agents = 'ok'; log('judge', r); await clearAlerts(); }
    catch (e) { status.agents = 'failed'; status.error = String(e && e.message || e).slice(0, 400); log('agents failed:', String(e && e.stack || e).slice(0, 600)); status.alert = await raiseAlert('researcher/judge', e); }
  } else log('agents skipped (disabled or no credentials)');
}
if (!only || only === 'memo') {
  const want = process.env.MEMO === '1' || memoDue();
  const can = cfg.agents_enabled && status.agents !== 'failed' && (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || process.env.AGENTS_MOCK === '1');
  if (want && can) { try { const r = await memo(state, cfg, changelog); status.memo = 'ok'; log('memo', r && (r.url || r.title)); } catch (e) { status.memo = 'failed'; log('memo failed (will retry next run):', String(e && e.stack || e).slice(0, 400)); } }
}
state.generated_at = new Date().toISOString();
const errs = validate(state, limits, prev, changelog);
if (errs.length) { console.error('VALIDATION FAILED\n' + errs.join('\n')); process.exit(1); }
writeJSON(P('site', 'data', 'state.json'), state);
writeJSON(P('site', 'data', 'changelog.json'), changelog.slice(0, 400));
// Usage ledger (60 runs) and run status; the workflow's last step turns the run red when the agents failed.
const u = usage();
if (u.calls) { const ledger = readJSON(P('pipeline', 'state', 'usage.json'), []); ledger.push({ date: new Date().toISOString().slice(0, 10), est_usd: u.est_usd, input: u.input, output: u.output, cache_read: u.cache_read, cache_write: u.cache_write, searches: u.searches, fetches: u.fetches, calls: u.calls, by: Object.fromEntries(Object.entries(u.by).map(([k, v]) => [k, v.est_usd])) }); writeJSON(P('pipeline', 'state', 'usage.json'), ledger.slice(-60)); log('usage: est $' + u.est_usd, JSON.stringify(Object.fromEntries(Object.entries(u.by).map(([k, v]) => [k, '$' + v.est_usd]))), '| in', u.input, 'out', u.output, 'cache read', u.cache_read, 'cache write', u.cache_write, 'searches', u.searches, 'fetches', u.fetches); }
writeJSON(P('pipeline', 'work', 'status.json'), status);
log('done; changelog entries today:', changelog.filter(c => c.date === new Date().toISOString().slice(0, 10)).length, '| agents', status.agents, '| memo', status.memo);
