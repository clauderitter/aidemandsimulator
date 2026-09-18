// Deterministic collectors: no LLM involved. Each returns observations; apply() writes the ones the rules allow.
import { P, readJSON, writeJSON, fetchText, parseCSV, round, today, log } from './util.js';
import { qAdd, qDiff, qOfDate, simulate, paramsOf, resolveEvents } from '../../site/model.js';

const FRONTIER = ['OpenAI', 'Anthropic', 'xAI', 'Mistral', 'Z.ai (Zhipu)', 'MiniMax', 'DeepSeek', 'Moonshot'];

async function fred(series, meanDays = 0) {
  const key = process.env.FRED_API_KEY; let pts;
  if (key) {
    const start = new Date(Date.now() - (meanDays + 10) * 86400000).toISOString().slice(0, 10);
    const j = JSON.parse(await fetchText(`https://api.stlouisfed.org/fred/series/observations?series_id=${series}&api_key=${key}&file_type=json&observation_start=${start}`));
    pts = j.observations.filter(x => x.value !== '.').map(x => ({ date: x.date, value: +x.value }));
  } else {
    const rows = parseCSV(await fetchText(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${series}`));
    pts = rows.filter(r => r[series] && r[series] !== '.').map(r => ({ date: r.observation_date, value: +r[series] }));
  }
  const last = pts[pts.length - 1]; const out = { date: last.date, value: last.value, src: `https://fred.stlouisfed.org/series/${series}` };
  if (meanDays) { const cut = new Date(new Date(last.date) - meanDays * 86400000).toISOString().slice(0, 10); const w = pts.filter(x => x.date > cut); out.mean = w.reduce((a, x) => a + x.value, 0) / w.length; }
  return out;
}
async function vix() {
  const rows = parseCSV(await fetchText('https://cdn.cboe.com/api/global/us_indices/daily_prices/VIX_History.csv'));
  const last = rows[rows.length - 1]; const [m, d, y] = last.DATE.split('/');
  return { date: `${y}-${m}-${d}`, value: +last.CLOSE, src: 'https://www.cboe.com/tradable_products/vix/' };
}
async function polymarket(cfg) {
  const ev = JSON.parse(await fetchText(`https://gamma-api.polymarket.com/events?slug=${cfg.polymarket_event || 'ai-bubble-burst-by'}`))[0];
  if (!ev) throw new Error('event not found');
  const open = ev.markets.filter(m => !m.closed && new Date(m.endDate) > new Date()).sort((a, b) => new Date(a.endDate) - new Date(b.endDate));
  if (!open.length) throw new Error('no open market in event');
  return pmRow(open[0]);
}
function pmRow(mk) { const prices = JSON.parse(mk.outcomePrices || '[]'); const yes = +prices[0]; return { date: today(), value: yes, question: mk.question, src: `https://polymarket.com/market/${mk.slug}` }; }
async function aaii() {
  const html = await fetchText('https://www.aaii.com/sentimentsurvey');
  const pick = re => { const m = re.exec(html); return m ? +m[1] : null; };
  const bull = pick(/Bullish[^0-9]{0,120}?(\d{1,2}\.\d)%/i), bear = pick(/Bearish[^0-9]{0,120}?(\d{1,2}\.\d)%/i);
  if (bull == null || bear == null) throw new Error('AAII parse failed');
  return { date: today(), bull, bear, src: 'https://www.aaii.com/sentimentsurvey' };
}
async function metr() {
  const y = await fetchText('https://metr.org/assets/benchmark_results_1_1.yaml');
  const lines = y.split('\n'); const models = []; let cur = null, inP80 = false, doubling = null, inDoub = false, in2023 = false;
  for (const ln of lines) {
    if (/^doubling_time_in_days:/.test(ln)) { inDoub = true; continue; }
    if (inDoub) { if (/^\S/.test(ln)) inDoub = false; else { if (/^\s{2}from_2023_on:/.test(ln)) in2023 = true; else if (/^\s{2}\S/.test(ln)) in2023 = false; const m = /^\s+point_estimate:\s*([\d.]+)/.exec(ln); if (in2023 && m) doubling = +m[1]; } }
    let m;
    if ((m = /^  ([A-Za-z0-9_.-]+):\s*$/.exec(ln))) { cur = { id: m[1] }; models.push(cur); inP80 = false; continue; }
    if (!cur) continue;
    if (/^\s{6}p80_horizon_length:/.test(ln)) { inP80 = true; continue; }
    if (/^\s{6}\S/.test(ln)) inP80 = false;
    if (inP80 && (m = /^\s{8}estimate:\s*([\d.]+)/.exec(ln))) cur.p80 = +m[1] / 60; // file reports minutes; model uses hours
    if ((m = /^\s{4}release_date:\s*(\d{4}-\d{2}-\d{2})/.exec(ln))) cur.date = m[1];
  }
  const pts = models.filter(x => x.p80 && x.date).sort((a, b) => a.date.localeCompare(b.date));
  let sota = 0; const frontier = []; for (const x of pts) { if (x.p80 > sota) { sota = x.p80; frontier.push(x); } }
  return { doublingDays: doubling, latest: frontier[frontier.length - 1], frontier, src: 'https://metr.org/time-horizons/' };
}
async function epoch() {
  const rows = parseCSV(await fetchText('https://epoch.ai/data/ai_companies_revenue_reports.csv'));
  const pts = rows.filter(r => FRONTIER.includes(r.Company) && r.Scope === 'Full company' && r.Date && +r['Annualized revenue (USD)'] > 0)
    .map(r => ({ company: r.Company, date: r.Date, value: +r['Annualized revenue (USD)'] / 1e9, src: r['Source 1'], confidence: r.Confidence })).sort((a, b) => a.date.localeCompare(b.date));
  const latestAt = (cut) => { const by = {}; for (const p of pts) if (p.date <= cut) by[p.company] = p; return by; };
  const now = latestAt(today());
  const total = Object.values(now).reduce((a, p) => a + p.value, 0);
  return { pts, now, total, src: 'https://epoch.ai/data/ai_companies_revenue_reports.csv', latestAt };
}
async function xPosts(cfg, since) {
  const token = process.env.X_BEARER_TOKEN; if (!token) return { posts: [], since, skipped: 'no X_BEARER_TOKEN' };
  const H = { headers: { authorization: `Bearer ${token}` } };
  const users = JSON.parse(await fetchText(`https://api.x.com/2/users/by?usernames=${cfg.x_handles.join(',')}`, H)).data || [];
  const posts = [];
  for (const u of users) {
    const qs = new URLSearchParams({ max_results: '20', 'tweet.fields': 'created_at,public_metrics,entities', exclude: 'retweets,replies' });
    if (since[u.username]) qs.set('since_id', since[u.username]);
    try {
      const j = JSON.parse(await fetchText(`https://api.x.com/2/users/${u.id}/tweets?${qs}`, H));
      for (const t of j.data || []) posts.push({ handle: u.username, id: t.id, at: t.created_at, text: t.text, likes: t.public_metrics?.like_count, url: `https://x.com/${u.username}/status/${t.id}` });
      if (j.meta?.newest_id) since[u.username] = j.meta.newest_id;
    } catch (e) { log('x', u.username, String(e).slice(0, 80)); }
  }
  return { posts, since };
}

function isoWeek(d) { const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day); const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1)); return `${t.getUTCFullYear()}-W${String(Math.ceil((((t - y0) / 86400000) + 1) / 7)).padStart(2, '0')}`; }
// Quarter-end date for a quarter key
const qEnd = q => { const y = +q.slice(0, 4), n = +q.slice(5); return `${y}-${String(n * 3).padStart(2, '0')}-${n === 1 ? '31' : n === 2 ? '30' : n === 3 ? '30' : '31'}`; };

export async function collect(state, cfg, limits, changelog) {
  const obs = {}; const errs = [];
  const tryGet = async (name, fn) => { try { obs[name] = await fn(); log('ok', name); } catch (e) { errs.push(`${name}: ${String(e).slice(0, 120)}`); log('fail', name, String(e).slice(0, 120)); } };
  await tryGet('dgs10', () => fred('DGS10'));
  await tryGet('dff', () => fred('DFF', 365));
  await tryGet('hy', () => fred('BAMLH0A0HYM2'));
  await tryGet('ig', () => fred('BAMLC0A0CM'));
  await tryGet('vix', vix);
  await tryGet('polymarket', () => polymarket(cfg));
  // AAII publishes no machine-readable feed; its page is script-rendered, so the researcher maintains that gauge instead.
  await tryGet('metr', metr);
  await tryGet('epoch', epoch);
  const since = readJSON(P('pipeline', 'state', 'x_since.json'), {});
  await tryGet('x', () => xPosts(cfg, since));
  if (obs.x) { writeJSON(P('pipeline', 'state', 'x_since.json'), obs.x.since); writeJSON(P('pipeline', 'work', 'x_posts.json'), obs.x.posts); const recent = readJSON(P('pipeline', 'state', 'x_recent.json'), []); const cutoff = Date.now() - 14 * 86400000; const merged = [...recent.filter(x => new Date(x.at).getTime() > cutoff), ...obs.x.posts.filter(x => !recent.some(r => r.id === x.id))]; writeJSON(P('pipeline', 'state', 'x_recent.json'), merged.slice(-600)); }
  writeJSON(P('pipeline', 'work', 'observations.json'), { ...obs, errs, at: new Date().toISOString() });
  return { obs, errs };
}

export function deriveR0(state, changelog) {
  const p = state.params; if (!p.R0_epoch || !p.R0x) return;
  const v = +(p.R0_epoch.value + p.R0x.value).toFixed(1);
  if (v !== p.R0.value) { changelog.unshift({ date: today(), kind: 'collected', target: 'R0', old: p.R0.value, new: v, reason: `Derived: Epoch disclosed sum ${p.R0_epoch.value} + undisclosed allowance ${p.R0x.value}.`, source: '' }); Object.assign(p.R0, { value: v, as_of: today(), updated: today(), type: 'derived' }); }
}
// A capped move stores its target; each run continues toward it under the same limit until reached or superseded.
export function carryOver(state, changelog, limits) {
  for (const [k, p] of Object.entries(state.params)) {
    if (p.pending_target == null || (state.frozen || []).includes(k) || p.pending_since === today()) continue; // one step per run
    if (Math.abs(p.pending_target - p.value) < 1e-9) { delete p.pending_target; continue; }
    const before = p.value; const ok = setParam(state, changelog, limits, k, p.pending_target, `Carry-over toward the target ${p.pending_target} set on ${p.pending_since || '?'} (${p.pending_reason || 'earlier evidence'}).`, p.source, p.as_of, { keepType: true });
    if (ok && Math.abs(p.pending_target - p.value) < 1e-9) { delete p.pending_target; delete p.pending_since; delete p.pending_reason; }
    if (!ok && before === p.value) { delete p.pending_target; }
  }
}
function setGauge(state, changelog, id, value, sub, src, asOf) {
  const g = state.gauges.find(x => x.id === id); if (!g) return;
  if (g.value === value && g.as_of === asOf) return;
  changelog.unshift({ date: today(), kind: 'collected', target: `gauge:${id}`, old: g.value, new: value, reason: `Observed from source (${asOf}).`, source: src });
  Object.assign(g, { value, sub, src, as_of: asOf, updated: today() });
}
// Monthly drift cap for assumption-class parameters: however many runs agree, the net move over 30 days is bounded, so
// a stream of one-directional evidence cannot ratchet a sensitive input.
export function driftRoom(changelog, limits, key, cur) {
  const lim = limits[key] || {}; if (lim.drift30 == null && lim.drift30_rel == null) return null;
  const since = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10); let net = 0;
  for (const c of changelog) if (c.target === key && c.date >= since && ['accepted', 'collected'].includes(c.kind) && typeof c.old === 'number' && typeof c.new === 'number') net += c.new - c.old;
  const ref = cur - net; const room = lim.drift30 != null ? lim.drift30 : Math.abs(ref) * lim.drift30_rel;
  return { lo: +(ref - room).toFixed(4), hi: +(ref + room).toFixed(4), ref: +ref.toFixed(4), room };
}
export function setParam(state, changelog, limits, key, value, reason, src, asOf, opts = {}) {
  const p = state.params[key]; if (!p || (state.frozen || []).includes(key)) return false;
  const lim = limits[key] || {}; let v = value;
  if (lim.min != null) v = Math.max(lim.min, v); if (lim.max != null) v = Math.min(lim.max, v);
  const old = p.value; const maxMove = lim.abs != null ? lim.abs : lim.rel != null ? Math.abs(old) * lim.rel : Infinity; let capped = false;
  if (Math.abs(v - old) > maxMove) { v = old + Math.sign(v - old) * maxMove; capped = true; }
  const room = opts.manual ? null : driftRoom(changelog, limits, key, old);
  if (room) { const dir = Math.sign(v - old); let vv = Math.min(room.hi, Math.max(room.lo, v)); if (Math.sign(vv - old) !== dir) vv = old; if (Math.abs(vv - v) > 1e-9) { v = vv; capped = false; reason += ` Monthly drift cap: at most ±${+room.room.toFixed(3)} around ${room.ref} in any 30 days.`; opts = { ...opts, noCarry: true }; } }
  v = +v.toFixed(4);
  if (v === old) return false;
  const target = +(+value).toFixed(4);
  changelog.unshift({ date: today(), kind: opts.kind || 'collected', target: key, old, new: v, reason: reason + (capped ? ` Capped: target ${target}, continues next run.` : ''), source: src, ...(capped ? { capped: true, target_value: target } : {}) });
  Object.assign(p, { value: v, as_of: asOf, updated: today(), source: src, ...(opts.keepType ? {} : { type: opts.type || 'reported' }) });
  if (capped && !opts.noCarry) { p.pending_target = target; p.pending_since = today(); p.pending_reason = reason.slice(0, 120); } else { delete p.pending_target; delete p.pending_since; delete p.pending_reason; }
  return true;
}

export function apply(state, obs, limits, changelog) {
  const fmtD = d => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  if (obs.dgs10) setGauge(state, changelog, 'dgs10', `${obs.dgs10.value.toFixed(2)}%`, `${fmtD(obs.dgs10.date)} (FRED DGS10)${obs.dff ? `; Fed funds effective ${obs.dff.value.toFixed(2)}%` : ''}`, obs.dgs10.src, obs.dgs10.date);
  if (obs.dff) {
    setGauge(state, changelog, 'fedfunds', `${obs.dff.value.toFixed(2)}%`, `${fmtD(obs.dff.date)} (FRED DFF)`, obs.dff.src, obs.dff.date);
    // Neutral = the policy rate the last year's plans were made at (trailing-365-day mean + 0.4 term premium). The gap between
    // today's rate and neutral is what bites: a realised hike widens it, and it closes as the average catches up.
    if (obs.dff.mean != null) {
      setParam(state, changelog, limits, 'rate0', +round(obs.dff.mean + 0.4, 0.05).toFixed(2), `Rule: neutral rate = trailing-year mean of Fed funds ${obs.dff.mean.toFixed(2)}% + 0.4 term premium.`, obs.dff.src, obs.dff.date);
      if (state.params.rateGap) setParam(state, changelog, limits, 'rateGap', +round(obs.dff.value + 0.4 - state.params.rate0.value, 0.05).toFixed(2), `Rule: policy vs neutral = Fed funds effective ${obs.dff.value.toFixed(2)}% + 0.4 − neutral ${state.params.rate0.value}%.`, obs.dff.src, obs.dff.date);
    }
  }
  if (obs.hy) setGauge(state, changelog, 'hy_oas', `${Math.round(obs.hy.value * 100)}bp`, `${fmtD(obs.hy.date)} · ICE BofA US high-yield spread (FRED)${obs.ig ? `; investment grade ${Math.round(obs.ig.value * 100)}bp` : ''}`, obs.hy.src, obs.hy.date);
  if (obs.vix) setGauge(state, changelog, 'vix', obs.vix.value.toFixed(1), `${fmtD(obs.vix.date)} close (CBOE)`, obs.vix.src, obs.vix.date);
  if (obs.polymarket) setGauge(state, changelog, 'polymarket', `${(obs.polymarket.value * 100).toFixed(1)}%`, `${fmtD(obs.polymarket.date)} · “${obs.polymarket.question}”`, obs.polymarket.src, obs.polymarket.date);
  if (obs.aaii) setGauge(state, changelog, 'aaii', `${Math.round(obs.aaii.bull)}% / ${Math.round(obs.aaii.bear)}%`, `latest weekly survey, read ${fmtD(obs.aaii.date)}`, obs.aaii.src, obs.aaii.date);
  if (obs.metr && obs.metr.latest) {
    const measQ = qOfDate(new Date(obs.metr.latest.date)); const dq = Math.max(0, qDiff(state.quarter0, measQ)); const dRate = 3 / state.params.D0.value; const aged = +(obs.metr.latest.p80 * Math.pow(2, dRate * dq)).toFixed(2);
    state.params.H0.meas_value = +obs.metr.latest.p80.toFixed(2); state.params.H0.meas_q = measQ;
    setParam(state, changelog, limits, 'H0', aged, `Rule: latest SOTA 80% horizon in METR’s file (${obs.metr.latest.id}, released ${obs.metr.latest.date}, ${obs.metr.latest.p80.toFixed(2)} h)${dq ? `, rolled forward ${dq} quarter${dq > 1 ? 's' : ''} to ${state.quarter0} at the current doubling rate` : ''}.`, obs.metr.src, obs.metr.latest.date, { type: dq ? 'derived' : 'reported' });
    if (obs.metr.doublingDays) setParam(state, changelog, limits, 'D0', +(obs.metr.doublingDays / 30.4).toFixed(1), `Rule: METR since-2023 doubling time ${obs.metr.doublingDays.toFixed(0)} days ÷ 30.4 (latest frontier measurement ${obs.metr.latest.date}).`, obs.metr.src, obs.metr.latest.date);
    for (const h of state.history) { const pts = obs.metr.frontier.filter(x => x.date <= qEnd(h.q)); if (pts.length) h.H = +pts[pts.length - 1].p80.toFixed(2); }
  }
  if (obs.epoch && obs.epoch.total > 0) {
    const parts = Object.values(obs.epoch.now).sort((a, b) => b.value - a.value).map(p => `${p.company} $${p.value.toFixed(0)}B (${p.date})`).join(', ');
    setParam(state, changelog, limits, 'R0_epoch', +obs.epoch.total.toFixed(1), `Rule: sum of latest full-company run-rates in Epoch’s dataset: ${parts}.`, obs.epoch.src, today());
    deriveR0(state, changelog);
    for (const h of state.history) { const by = obs.epoch.latestAt(qEnd(h.q)); const tot = Object.values(by).reduce((a, p) => a + p.value, 0); if (tot > 0) { h.revenue = +tot.toFixed(1); h.provisional = false; h.note = 'Sum of each frontier lab’s latest reported run-rate at quarter end (Epoch revenue reports).'; } }
  }
  // Growth check: trailing four-quarter observed growth of the disclosed sum vs the model's quarter-zero aggregate growth.
  try {
    const hist = state.history; const back = hist[hist.length - 4]; if (back && back.revenue > 0 && state.params.R0_epoch) {
      const gObs = Math.log(state.params.R0_epoch.value / back.revenue) / 4;
      const rows = simulate(paramsOf(state), [], null, 2); const gMod = rows[0].gR;
      const pct = g => `+${Math.round((Math.exp(g) - 1) * 100)}%`;
      setGauge(state, changelog, 'growth_check', `${pct(gObs)} vs ${pct(gMod)}`, `per quarter: observed (Epoch sum, ${back.q} → now, ×${Math.exp(gObs * 4).toFixed(1)} a year) vs the model’s quarter-zero growth (×${Math.exp(gMod * 4).toFixed(1)} a year)`, 'https://epoch.ai/data/ai_companies_revenue_reports.csv', today());
      // Weekly ledger: one reading per ISO week; the calibration rule reads the counters, not the stance text.
      const week = isoWeek(new Date()); const cal = state.calibration || { readings: [], weeks_at_gap: 0, fast_lane: false };
      if (!cal.readings.some(r => r.week === week)) { cal.readings.push({ week, date: today(), gObs: +gObs.toFixed(4), gMod: +gMod.toFixed(4), gap: +(gObs - gMod).toFixed(4) }); cal.readings = cal.readings.slice(-26); }
      let run = 0, fast = 0; for (const r of [...cal.readings].reverse()) { if (Math.abs(r.gap) > 0.05) run++; else break; } for (const r of [...cal.readings].reverse()) { if (Math.abs(r.gap) > 0.15) fast++; else break; }
      cal.weeks_at_gap = run; cal.fast_lane = fast >= 2; cal.util0 = +(state.params.R0.value / (state.params.K0.value * (1 - state.params.train.value / 100) * state.params.mono.value)).toFixed(3); state.calibration = cal;
    }
  } catch (e) { log('growth check failed', String(e).slice(0, 80)); }
  // Scenario fidelity: where a proponent states numbers, the scenario's path is checked against them on every run.
  try {
    for (const sc of state.scenarios) {
      if (sc.status === 'retired' || !Array.isArray(sc.anchors) || !sc.anchors.length) { delete sc.fidelity; continue; }
      const rows = simulate(paramsOf(state, sc.p || {}), resolveEvents((sc.e || []).filter(e => !e.expired), state.quarter0), null, state.horizon_quarters); const at = q => { const t = qDiff(q, state.quarter0); return t >= 0 && t < rows.length ? rows[t].revenue : null; };
      const checks = sc.anchors.map(a => { const v = a.kind === 'growth' ? (at(a.from) && at(a.to) ? at(a.to) / at(a.from) : null) : at(a.q); return v == null ? null : { label: a.kind === 'growth' ? `growth ${a.from}→${a.to} ×${v.toFixed(1)} vs ×${a.lo}–${a.hi}` : `${a.q} $${Math.round(v)}B vs $${a.lo}–${a.hi}B`, ok: v >= a.lo && v <= a.hi }; }).filter(Boolean);
      sc.fidelity = { ok: checks.every(c => c.ok), checks: checks.map(c => `${c.ok ? 'ok' : 'OUT'}: ${c.label}`), date: today() };
    }
  } catch (e) { log('fidelity check failed', String(e).slice(0, 100)); }
  // Quarter-zero utilisation is an output: revenue ÷ monetisable capacity at current prices.
  { const pr = state.params; const u0 = pr.R0.value / (pr.K0.value * (1 - pr.train.value / 100) * pr.mono.value); setGauge(state, changelog, 'util0', `${Math.round(u0 * 100)}%`, `frontier revenue ${pr.R0.value} ÷ (${pr.K0.value} GW × ${100 - pr.train.value}% inference × $${pr.mono.value}B/GW); above 100% means rationed`, 'https://github.com/clauderitter/aidemandsimulator/blob/main/pipeline/config/rules.md', today()); }
  return state;
}
