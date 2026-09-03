// Reflexive AI demand model. Shared by the site (browser ESM) and the pipeline (Node ESM).
// Quarterly steps. t = 0 is the current quarter (state.quarter0); t < 0 is history.
export const SEGS = ['rd', 'swe', 'trd', 'oth'];

// ---------- quarter arithmetic ----------
export function qParse(key) { const m = /^(\d{4})Q([1-4])$/.exec(key); if (!m) throw new Error('bad quarter ' + key); return { y: +m[1], q: +m[2] }; }
export function qKey(y, q) { return `${y}Q${q}`; }
export function qAdd(key, n) { const { y, q } = qParse(key); const idx = y * 4 + (q - 1) + n; return qKey(Math.floor(idx / 4), (idx % 4) + 1); }
export function qDiff(a, b) { const A = qParse(a), B = qParse(b); return (A.y * 4 + A.q) - (B.y * 4 + B.q); }
export function qLabel(key) { const { y, q } = qParse(key); return `Q${q} ’${String(y).slice(2)}`; }
export function qOfDate(d = new Date()) { return qKey(d.getUTCFullYear(), Math.floor(d.getUTCMonth() / 3) + 1); }

// ---------- event catalogue ----------
// mag() maps the displayed value to the model magnitude; short() renders a chip label.
export const EVENTS = {
  rate:      { name: 'Rate hike', unit: 'pp above baseline', v: 2, min: 0.5, max: 6, step: 0.5, dur: 8, lasting: true, mag: v => v, short: v => `+${v}pp rates` },
  reg:       { name: 'Regulation slows progress', unit: '× slower doubling', v: 1, min: 0.25, max: 3, step: 0.25, dur: 8, lasting: true, mag: v => v, short: v => `${(1 + v).toFixed(2)}× slower AI` },
  shock:     { name: 'Exogenous market shock', unit: '% off valuations', v: 30, min: 5, max: 70, step: 5, mag: v => v / 100, short: v => `markets −${v}%` },
  release:   { name: 'Model breakthrough', unit: 'extra horizon doublings', v: 1, min: 0.5, max: 3, step: 0.5, mag: v => v, short: v => `+${v} doubling${v == 1 ? '' : 's'}` },
  trd_cut:   { name: 'Trading pullback', unit: '% of trading spend cut', v: 50, min: 10, max: 90, step: 5, mag: v => -Math.log(1 - v / 100), short: v => `trading −${v}%` },
  swe_cut:   { name: 'Startup funding freeze', unit: '% of software spend cut', v: 30, min: 10, max: 90, step: 5, mag: v => -Math.log(1 - v / 100), short: v => `software −${v}%` },
  rd_cut:    { name: 'Labs cut R&D tokens', unit: '% of R&D spend cut', v: 30, min: 10, max: 90, step: 5, mag: v => -Math.log(1 - v / 100), short: v => `R&D −${v}%` },
  oth_boost: { name: 'Enterprise adoption wave', unit: '%/yr extra growth', v: 40, min: 10, max: 150, step: 10, dur: 8, lasting: true, mag: v => Math.log(1 + v / 100), short: v => `+${v}%/yr adoption` },
  price:     { name: 'Token price collapse', unit: '% cut in revenue per GW', v: 40, min: 10, max: 80, step: 5, mag: v => v / 100, short: v => `prices −${v}%` },
  reprice:   { name: 'Compute gets pricier', unit: '% rise in revenue per GW', v: 50, min: 10, max: 200, step: 10, mag: v => v / 100, short: v => `prices +${v}%` },
  capex_cut: { name: 'Labs cancel capacity', unit: '% of pipeline cancelled', v: 30, min: 10, max: 100, step: 10, mag: v => v / 100, short: v => `−${v}% pipeline` },
};

// Resolve an event's timing to a relative quarter index given quarter0. Events may carry t (relative) or q (calendar).
export function resolveEvents(events, quarter0) {
  return events.map(e => ({ ...e, t: e.q ? qDiff(e.q, quarter0) : e.t })).filter(e => Number.isInteger(e.t));
}

// ---------- simulation ----------
export function simulate(p, events = [], noise = null, T = 18) {
  const out = [];
  const S = { rd: p.R0 * p.sh_rd / 100, swe: p.R0 * p.sh_swe / 100, trd: p.R0 * p.sh_trd / 100 };
  S.oth = Math.max(0, p.R0 - S.rd - S.swe - S.trd);
  let H = p.H0, M = 1.0, K = p.K0; let Msm = 1.0; // Msm: the smoothed index budgets and builds respond to
  const RD0 = Math.max(0.01, S.rd);
  const pipeline = new Array(T + p.lead + 3).fill(0);
  for (let q = 1; q <= p.lead + 1; q++) pipeline[q] += p.pipe / (p.lead + 1);
  const evs = events.filter(e => EVENTS[e.type] && Number.isInteger(e.t)).map(e => ({ ...e, mag: EVENTS[e.type].mag(e.v), dur: EVENTS[e.type].lasting ? (e.dur || 1) : 1 }));
  const evAt = (type, t) => evs.filter(e => e.type === type && e.t === t);
  const active = (type, t) => evs.filter(e => e.type === type && t >= e.t && t < e.t + e.dur);
  const trainShare = p.train / 100;
  let monoMult = 1;
  const capOf = k => k * (1 - trainShare) * p.mono * monoMult;
  const drive = (s, d, Hh, Mm, subst) => {
    const sat = s === 'oth' ? 1 / (1 + Hh / p.H_sat) : 1;
    let v = Math.log(1 + p['g_' + s] / 100) / 4 * (p.orgX == null ? 1 : p.orgX) + p['eps_' + s] * p.epsX * d * sat + p['b_' + s] * p.betaX * (Mm - 1);
    if (s === 'oth') v -= subst / 100 / 4;
    return v;
  };
  const d0 = 3 / p.D0;
  const g = {}; for (const s of SEGS) g[s] = drive(s, d0, H, 1, p.subst) / (1 - Math.min(p['k_' + s], 0.95));
  const tot0 = SEGS.reduce((a, s) => a + S[s], 0) || 1;
  let gR = SEGS.reduce((a, s) => a + g[s] * S[s], 0) / tot0;
  let gExp = gR;
  let subst = p.subst;
  for (let t = 0; t < T; t++) {
    for (const e of evAt('shock', t)) M *= (1 - e.mag);
    let dExtra = 0; for (const e of evAt('release', t)) { H *= Math.pow(2, e.mag); dExtra += e.mag; }
    for (const e of evAt('price', t)) { monoMult *= (1 - e.mag); S.oth *= (1 - e.mag / 2); }
    for (const e of evAt('reprice', t)) monoMult *= (1 + e.mag);
    for (const e of evAt('capex_cut', t)) for (let q = t + 1; q < pipeline.length; q++) pipeline[q] *= (1 - e.mag);
    const rate = p.rate0 + active('rate', t).reduce((a, e) => a + e.mag, 0);
    const regF = active('reg', t).reduce((a, e) => a * (1 + e.mag), 1);
    const cap = capOf(K);
    const demand = SEGS.reduce((a, s) => a + S[s], 0);
    const util = demand / cap;
    // Scarcity pricing: when demand outruns capacity, revenue per GW rises with the excess (compute gets pricier).
    const scarce = p.scarce || 0;
    const revenue = util > 1 ? cap * (1 + scarce * Math.log(util)) : demand;
    const RDref = RD0 * Math.exp(Math.log(1 + p.gref / 100) * t);
    const ceilingSlow = p.H_cap ? 1 / (1 + Math.pow(H / p.H_cap, 3)) : 1;
    const d = (3 / (p.D0 * regF)) * Math.min(1.5, Math.max(0.5, 1 + p.rdBoost * Math.log2(Math.max(0.05, S.rd / RDref)))) * ceilingSlow;
    const Rexp = revenue * Math.exp(gExp * p.lead);
    const Kneed = Rexp / ((1 - trainShare) * p.mono * monoMult) / p.targetUtil;
    let Kcommitted = K; for (let q = t + 1; q <= t + p.lead; q++) Kcommitted += pipeline[q] || 0;
    const finF = Math.min(1.5, Math.max(0, 1 + p.fin * (Msm - 1) - p.r_sens * (rate - p.rate0)));
    const build = Math.min(p.buildMax * K, Math.max(0, Kneed - Kcommitted)) * finF;
    pipeline[t + p.lead] = (pipeline[t + p.lead] || 0) + build;
    const capex = build * p.capexGW;
    out.push({ t, S: { ...S }, demand, revenue, cap, K, capex, H, M, D: 3 / d, util, unmet: demand - revenue, g: { ...g }, gR, rate, gExp });
    const gNew = {};
    for (const s of SEGS) {
      let gs = drive(s, d + dExtra, H, Msm, subst) + p['k_' + s] * ((1 - p.rho) * g[s] + p.rho * gR);
      for (const e of evAt(s + '_cut', t)) gs -= e.mag;
      for (const e of active(s + '_boost', t)) gs += e.mag / 4;
      if (noise) gs += noise.seg[t][SEGS.indexOf(s)];
      gNew[s] = Math.max(-0.7, Math.min(0.7, gs));
    }
    const nextS = {}; for (const s of SEGS) nextS[s] = S[s] * Math.exp(gNew[s]);
    let nextDemand = SEGS.reduce((a, s) => a + nextS[s], 0);
    const nextCap = capOf(K + (pipeline[t + 1] || 0));
    const ceiling = nextCap * (1 + p.overhang);
    if (nextDemand > ceiling) { const f = ceiling / nextDemand; for (const s of SEGS) nextS[s] *= f; nextDemand = ceiling; }
    for (const s of SEGS) gNew[s] = S[s] > 0 ? Math.log(nextS[s] / S[s]) : 0;
    const nextU = nextDemand / nextCap; const nextRev = nextU > 1 ? nextCap * (1 + scarce * Math.log(nextU)) : nextDemand;
    const gRreal = revenue > 0 ? Math.log(nextRev / revenue) : 0;
    const surprise = gRreal - gExp;
    const Mstar = Math.exp(-p.m_rate * (rate - p.rate0));
    let dlogM = p.lambda * (Math.log(Mstar) - Math.log(M)) + p.m_rev * surprise;
    if (noise) dlogM += noise.M[t];
    M = Math.max(0.2, Math.min(3, M * Math.exp(dlogM)));
    Msm = Msm + (p.mSmooth == null ? 0.4 : p.mSmooth) * (M - Msm);
    gExp = gExp + p.alpha * (gRreal - gExp);
    for (const s of SEGS) { S[s] = nextS[s]; g[s] = gNew[s]; }
    gR = gRreal;
    H = H * Math.pow(2, d);
    K += pipeline[t + 1] || 0;
  }
  return out;
}

export function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function gauss(r) { let u = 0, v = 0; while (u === 0) u = r(); while (v === 0) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

export function monteCarlo(p, events, T = 18, n = 240, seed = 20260901) {
  const rnd = mulberry32(seed);
  const paths = [], revs = []; let busts = 0;
  for (let i = 0; i < n; i++) {
    const q = { ...p };
    for (const s of ['rd', 'swe', 'trd']) q['k_' + s] = Math.max(0, Math.min(0.95, q['k_' + s] + (rnd() - 0.5) * 0.6));
    q.k_oth = Math.max(0, Math.min(0.6, q.k_oth + (rnd() - 0.5) * 0.3));
    for (const s of ['rd', 'swe', 'trd']) q['sh_' + s] = Math.max(0, q['sh_' + s] + (rnd() - 0.5) * 10);
    q.epsX = p.epsX * (0.7 + 0.6 * rnd()); q.betaX = p.betaX * (0.6 + 0.8 * rnd());
    q.D0 = Math.max(1.5, p.D0 + (rnd() - 0.5) * 3); q.m_rev = p.m_rev * (0.5 + rnd());
    q.rho = Math.min(1, Math.max(0, p.rho + (rnd() - 0.5) * 0.5)); q.mono = p.mono * (0.7 + 0.6 * rnd());
    const noise = { seg: [], M: [] };
    for (let t = 0; t < T; t++) { noise.seg.push([0, 1, 2, 3].map(() => gauss(rnd) * 0.04)); noise.M.push(gauss(rnd) * 0.06); }
    const rows = simulate(q, events, noise, T);
    paths.push(rows.map(r => r.demand)); revs.push(rows.map(r => r.revenue));
    let peak = 0, dd = 0; for (const r of rows) { peak = Math.max(peak, r.revenue); dd = Math.max(dd, (peak - r.revenue) / peak); }
    if (dd >= 0.25) busts++;
  }
  const pct = (arr, t, qq) => { const a = arr.map(pp => pp[t]).sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(qq * (a.length - 1)))]; };
  const out = { p10: [], p50: [], p90: [], pBust: busts / n, revP10: [], revP90: [] };
  for (let t = 0; t < T; t++) { out.p10.push(pct(paths, t, .1)); out.p50.push(pct(paths, t, .5)); out.p90.push(pct(paths, t, .9)); out.revP10.push(pct(revs, t, .1)); out.revP90.push(pct(revs, t, .9)); }
  return out;
}

export function drawdown(rows) { let peak = 0, dd = 0, at = 0; for (const r of rows) { peak = Math.max(peak, r.revenue); const d = peak > 0 ? (peak - r.revenue) / peak : 0; if (d > dd) { dd = d; at = r.t; } } return { dd, at }; }

// Parameter values from a state file: { key: { value, ... } } -> { key: value }
export function paramsOf(state, overrides = {}) { const p = {}; for (const [k, v] of Object.entries(state.params)) p[k] = v.value; return { ...p, ...overrides }; }
