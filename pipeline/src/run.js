import { P, readJSON, writeJSON, log } from './util.js';
import { collect, apply } from './collect.js';
import { roll } from './roll.js';
import { research } from './research.js';
import { judge } from './judge.js';
import { usage } from './llm.js';
import { validate, previousState } from './validate.js';

const only = (process.argv.find(a => a.startsWith('--only=')) || '').slice(7);
const state = readJSON(P('site', 'data', 'state.json'));
const limits = readJSON(P('pipeline', 'config', 'limits.json'));
const cfg = readJSON(P('pipeline', 'config', 'watchlist.json'));
const changelog = readJSON(P('site', 'data', 'changelog.json'), []);
const prev = previousState();

if (!only || only === 'roll') roll(state, changelog);
if (!only || only === 'collect') { const { obs, errs } = await collect(state, cfg, limits, changelog); apply(state, obs, limits, changelog); if (errs.length) log('collector errors:', errs.join(' | ')); }
if (!only || only === 'agents') {
  const canRun = cfg.agents_enabled && (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || process.env.AGENTS_MOCK === '1');
  if (canRun) { try { const { proposals } = await research(state, cfg, limits, changelog); const r = await judge(state, proposals || [], limits, changelog, cfg); const u = usage(); log('judge', r, 'tokens in/out', u.input, u.output, 'cache', u.cache_read, 'calls', u.calls); } catch (e) { log('agents failed:', String(e && e.stack || e).slice(0, 600)); } }
  else log('agents skipped (disabled or no credentials)');
}
state.generated_at = new Date().toISOString();
const errs = validate(state, limits, prev);
if (errs.length) { console.error('VALIDATION FAILED\n' + errs.join('\n')); process.exit(1); }
writeJSON(P('site', 'data', 'state.json'), state);
writeJSON(P('site', 'data', 'changelog.json'), changelog.slice(0, 400));
log('done; changelog entries today:', changelog.filter(c => c.date === new Date().toISOString().slice(0, 10)).length);
