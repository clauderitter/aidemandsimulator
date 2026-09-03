// Rolling horizon: when a new quarter starts, the quarter that just ended moves into history and quarter0 advances.
import { qAdd, qDiff, qOfDate } from '../../site/model.js';
import { today } from './util.js';
export function roll(state, changelog, now = new Date()) {
  const nowQ = qOfDate(now); const steps = qDiff(nowQ, state.quarter0); if (steps <= 0) return false;
  for (let i = 0; i < steps; i++) {
    const closing = state.quarter0;
    state.history.push({ q: closing, revenue: state.params.R0.value, K: state.params.K0.value, H: state.params.H0.value, provisional: true, note: 'Carried from quarter-0 parameters at roll-over; the collector refines revenue and horizon from Epoch and METR.' });
    while (state.history.length > state.history_quarters) state.history.shift();
    state.quarter0 = qAdd(closing, 1);
    for (const s of state.scenarios) for (const e of s.e || []) if (e.q && qDiff(e.q, state.quarter0) < 0 && !e.expired) { e.expired = true; changelog.unshift({ date: today(), kind: 'expired', target: `scenario:${s.id}`, old: e.q, new: null, reason: `Calendar-pinned shock ${e.type} at ${e.q} is now in the past; the judge grades whether it happened.`, source: '' }); }
    changelog.unshift({ date: today(), kind: 'rolled', target: 'quarter0', old: closing, new: state.quarter0, reason: 'New quarter: the closed quarter moved into history.', source: '' });
  }
  return true;
}
