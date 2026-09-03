// Deterministic collectors: no LLM involved. Each returns observations; apply() writes the ones the rules allow.
import { P, readJSON, writeJSON, fetchText, parseCSV, round, today, log } from './util.js';
import { qAdd, qDiff, qOfDate } from '../../site/model.js';

const FRONTIER = ['OpenAI', 'Anthropic', 'xAI', 'Mistral', 'Z.ai (Zhipu)', 'MiniMax', 'DeepSeek', 'Moonshot'];

async function fred(series) {
  const key = process.env.FRED_API_KEY;
  if (key) {
    const j = JSON.parse(await fetchText(`https://api.stlouisfed.org/fred/series/observations?series_id=${series}&api_key=${key}&file_type=json&sort_order=desc&limit=5`));
    const o = j.observations.find(x => x.value !== '.'); return { date: o.date, value: +o.value, src: `https://fred.stlouisfed.org/series/${series}` };
  }
  const rows = parseCSV(await fetchText(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${series}`));
  const last = [...rows].reverse().find(r => r[series] && r[series] !== '.');
  return { date: last.observation_date, value: +last[series], src: `https://fred.stlouisfed.org/series/${series}` };
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

// Quarter-end date for a quarter key
const qEnd = q => { const y = +q.slice(0, 4), n = +q.slice(5); return `${y}-${String(n * 3).padStart(2, '0')}-${n === 1 ? '31' : n === 2 ? '30' : n === 3 ? '30' : '31'}`; };

export async function collect(state, cfg, limits, changelog) {
  const obs = {}; const errs = [];
  const tryGet = async (name, fn) => { try { obs[name] = await fn(); log('ok', name); } catch (e) { errs.push(`${name}: ${String(e).slice(0, 120)}`); log('fail', name, String(e).slice(0, 120)); } };
  await tryGet('dgs10', () => fred('DGS10'));
  await tryGet('dff', () => fred('DFF'));
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

function setGauge(state, changelog, id, value, sub, src, asOf) {
  const g = state.gauges.find(x => x.id === id); if (!g) return;
  if (g.value === value && g.as_of === asOf) return;
  changelog.unshift({ date: today(), kind: 'collected', target: `gauge:${id}`, old: g.value, new: value, reason: `Observed from source (${asOf}).`, source: src });
  Object.assign(g, { value, sub, src, as_of: asOf, updated: today() });
}
function setParam(state, changelog, limits, key, value, reason, src, asOf) {
  const p = state.params[key]; if (!p || state.frozen.includes(key)) return false;
  const lim = limits[key] || {}; let v = value;
  if (lim.min != null) v = Math.max(lim.min, v); if (lim.max != null) v = Math.min(lim.max, v);
  const old = p.value; const maxMove = lim.abs != null ? lim.abs : lim.rel != null ? Math.abs(old) * lim.rel : Infinity;
  if (Math.abs(v - old) > maxMove) { v = old + Math.sign(v - old) * maxMove; reason += ` Speed limit applied: target ${value}, moved ${old} → ${+v.toFixed(4)} this run.`; }
  v = +v.toFixed(4);
  if (v === old) return false;
  changelog.unshift({ date: today(), kind: 'collected', target: key, old, new: v, reason, source: src });
  Object.assign(p, { value: v, as_of: asOf, updated: today(), type: 'reported', source: src });
  return true;
}

export function apply(state, obs, limits, changelog) {
  const fmtD = d => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  if (obs.dgs10) setGauge(state, changelog, 'dgs10', `${obs.dgs10.value.toFixed(2)}%`, `${fmtD(obs.dgs10.date)} (FRED DGS10)${obs.dff ? `; Fed funds effective ${obs.dff.value.toFixed(2)}%` : ''}`, obs.dgs10.src, obs.dgs10.date);
  if (obs.dff) {
    setGauge(state, changelog, 'fedfunds', `${obs.dff.value.toFixed(2)}%`, `${fmtD(obs.dff.date)} (FRED DFF)`, obs.dff.src, obs.dff.date);
    setParam(state, changelog, limits, 'rate0', round(obs.dff.value + 0.4, 0.25), `Rule: baseline rate = Fed funds effective ${obs.dff.value.toFixed(2)}% + 0.4 term premium, rounded to 0.25.`, obs.dff.src, obs.dff.date);
  }
  if (obs.vix) setGauge(state, changelog, 'vix', obs.vix.value.toFixed(1), `${fmtD(obs.vix.date)} close (CBOE)`, obs.vix.src, obs.vix.date);
  if (obs.polymarket) setGauge(state, changelog, 'polymarket', `${(obs.polymarket.value * 100).toFixed(1)}%`, `${fmtD(obs.polymarket.date)} · “${obs.polymarket.question}”`, obs.polymarket.src, obs.polymarket.date);
  if (obs.aaii) setGauge(state, changelog, 'aaii', `${Math.round(obs.aaii.bull)}% / ${Math.round(obs.aaii.bear)}%`, `latest weekly survey, read ${fmtD(obs.aaii.date)}`, obs.aaii.src, obs.aaii.date);
  if (obs.metr && obs.metr.latest) {
    setParam(state, changelog, limits, 'H0', +obs.metr.latest.p80.toFixed(2), `Rule: latest SOTA 80% horizon in METR’s file (${obs.metr.latest.id}, released ${obs.metr.latest.date}).`, obs.metr.src, obs.metr.latest.date);
    if (obs.metr.doublingDays) setParam(state, changelog, limits, 'D0', +(obs.metr.doublingDays / 30.4).toFixed(1), `Rule: METR since-2023 doubling time ${obs.metr.doublingDays.toFixed(0)} days ÷ 30.4.`, obs.metr.src, today());
    for (const h of state.history) { const pts = obs.metr.frontier.filter(x => x.date <= qEnd(h.q)); if (pts.length) h.H = +pts[pts.length - 1].p80.toFixed(2); }
  }
  if (obs.epoch && obs.epoch.total > 0) {
    const parts = Object.values(obs.epoch.now).sort((a, b) => b.value - a.value).map(p => `${p.company} $${p.value.toFixed(0)}B (${p.date})`).join(', ');
    setParam(state, changelog, limits, 'R0', +obs.epoch.total.toFixed(1), `Rule: sum of latest full-company run-rates in Epoch’s dataset: ${parts}.`, obs.epoch.src, today());
    for (const h of state.history) { const by = obs.epoch.latestAt(qEnd(h.q)); const tot = Object.values(by).reduce((a, p) => a + p.value, 0); if (tot > 0) { h.revenue = +tot.toFixed(1); h.provisional = false; h.note = 'Sum of each frontier lab’s latest reported run-rate at quarter end (Epoch revenue reports).'; } }
  }
  // Stance rule: the revenue ceiling per inference GW is derived so that today’s revenue sits at ~100% of monetisable capacity.
  const p = state.params; const derivedMono = p.R0.value / (p.K0.value * (1 - p.train.value / 100));
  setParam(state, changelog, limits, 'mono', +derivedMono.toFixed(1), `Rule: revenue ceiling = R0 ${p.R0.value} ÷ (K0 ${p.K0.value} GW × inference share ${(100 - p.train.value)}%), keeping quarter-0 utilisation at 100%.`, 'https://github.com/clauderitter/aidemandsimulator/blob/main/pipeline/config/rules.md', today());
  return state;
}
