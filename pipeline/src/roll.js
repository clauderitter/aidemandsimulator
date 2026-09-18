// Rolling horizon: when a new quarter starts, the quarter that just ended moves into history and quarter0 advances.
import { qAdd, qDiff, qOfDate, EVENTS } from '../../site/model.js';
import { today } from './util.js';
import { setParam } from './collect.js';

export function roll(state, changelog, limits = {}, now = new Date()) {
  const nowQ = qOfDate(now); const steps = qDiff(nowQ, state.quarter0); if (steps <= 0) return false;
  for (let i = 0; i < steps; i++) {
    const closing = state.quarter0; const p = state.params;
    state.history.push({ q: closing, revenue: p.R0.value, K: p.K0.value, H: p.H0.value, provisional: true, note: 'Carried from quarter-0 parameters at roll-over; the collector refines revenue and horizon from Epoch and METR.' });
    while (state.history.length > state.history_quarters) state.history.shift();
    state.quarter0 = qAdd(closing, 1);
    // Capacity that the model had arriving during the closed quarter is now online. Evidence-based estimates override this later.
    const arrived = +(p.pipe.value / (p.lead.value + 1)).toFixed(1);
    setParam(state, changelog, limits, 'K0', +(p.K0.value + arrived).toFixed(1), `Roll-over: ${arrived} GW of the committed pipeline (pipe ÷ (lead + 1)) came online during ${closing}.`, p.K0.source, today(), { type: 'derived' });
    // Pinned shocks: a one-off expires once its quarter has passed; a lasting one only after its last quarter.
    for (const s of state.scenarios) for (const e of s.e || []) {
      if (!e.q || e.expired) continue; const d = EVENTS[e.type]; const lastQ = d && d.lasting ? qAdd(e.q, (e.dur || 1) - 1) : e.q;
      if (qDiff(lastQ, state.quarter0) < 0) { e.expired = true; changelog.unshift({ date: today(), kind: 'expired', target: `scenario:${s.id}`, old: e.q, new: null, reason: `Calendar-pinned shock ${e.type} at ${e.q} is now in the past; the judge grades whether it happened.`, source: '' }); }
    }
    changelog.unshift({ date: today(), kind: 'rolled', target: 'quarter0', old: closing, new: state.quarter0, reason: 'New quarter: the closed quarter moved into history.', source: '' });
  }
  return true;
}
