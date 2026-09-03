import { execSync } from 'node:child_process';
import { P, readJSON } from './util.js';
import { simulate, resolveEvents, paramsOf, EVENTS, qParse } from '../../site/model.js';

export function validate(state, limits, prev, changelog = null) {
  const errs = [];
  const today = new Date().toISOString().slice(0, 10);
  const manual = new Set((changelog || []).filter(c => c.manual && c.date === today).map(c => c.target));
  const req = ['version', 'generated_at', 'quarter0', 'horizon_quarters', 'history_quarters', 'params', 'history', 'scenarios', 'gauges'];
  for (const k of req) if (!(k in state)) errs.push(`missing ${k}`);
  try { qParse(state.quarter0); } catch { errs.push('bad quarter0'); }
  for (const [k, p] of Object.entries(state.params)) {
    if (typeof p.value !== 'number' || !isFinite(p.value)) errs.push(`param ${k} not finite`);
    const lim = limits[k]; if (lim) { if (lim.min != null && p.value < lim.min) errs.push(`param ${k} below min`); if (lim.max != null && p.value > lim.max) errs.push(`param ${k} above max`); }
    if (prev && prev.params[k] && lim && !manual.has(k)) { const old = prev.params[k].value; const maxMove = lim.abs != null ? lim.abs : lim.rel != null ? Math.abs(old) * lim.rel : Infinity; if (Math.abs(p.value - old) > maxMove + 1e-9) errs.push(`param ${k} moved ${old} → ${p.value}, over speed limit`); }
  }
  const active = state.scenarios.filter(s => s.status !== 'retired');
  if (active.length > (state.scenario_cap || 16)) errs.push(`scenario cap exceeded: ${active.length}`);
  if (!active.some(s => s.id === 'base')) errs.push('base scenario missing');
  for (const id of (state.core_scenarios || [])) if (!active.some(s => s.id === id)) errs.push(`core scenario ${id} is not active`);
  for (const s of active) {
    if (!['base', 'bull', 'bear', 'structural'].includes(s.camp)) errs.push(`scenario ${s.id} bad camp`);
    for (const e of s.e || []) { if (!EVENTS[e.type]) errs.push(`scenario ${s.id} unknown event ${e.type}`); if (!(Number.isInteger(e.t) || e.q)) errs.push(`scenario ${s.id} event without timing`); }
    try { const rows = simulate(paramsOf(state, s.p), resolveEvents(s.e || [], state.quarter0), null, state.horizon_quarters); if (rows.some(r => !isFinite(r.revenue) || !isFinite(r.demand))) errs.push(`scenario ${s.id} produced non-finite values`); } catch (e) { errs.push(`scenario ${s.id} failed: ${e.message}`); }
  }
  if (state.history.length !== state.history_quarters) errs.push(`history length ${state.history.length} != ${state.history_quarters}`);
  for (const h of state.history) if (typeof h.revenue !== 'number' || h.revenue <= 0) errs.push(`history ${h.q} bad revenue`);
  for (const g of state.gauges) if (!g.id || g.value == null) errs.push(`gauge ${g.id} incomplete`);
  return errs;
}
export function previousState() { try { return JSON.parse(execSync('git show HEAD:site/data/state.json', { cwd: P(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })); } catch { return null; } }
if (import.meta.url === `file://${process.argv[1]}`) {
  const state = readJSON(P('site', 'data', 'state.json')); const limits = readJSON(P('pipeline', 'config', 'limits.json'));
  const errs = validate(state, limits, previousState(), readJSON(P('site', 'data', 'changelog.json'), [])); if (errs.length) { console.error(errs.join('\n')); process.exit(1); } console.log('valid');
}
