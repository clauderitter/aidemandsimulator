// What the agents may touch, and under which rule. Everything else is rejected by the judge.
export const RULES = {
  R0: [], R0_epoch: ['primary_report'], R0x: ['undisclosed_estimate'], orgX: ['growth_calibration'], sh_rd: ['usage_share'], sh_swe: ['usage_share'], sh_trd: ['usage_share'],
  H0: ['metr_latest'], D0: ['metr_doubling'], rdBoost: [], epsX: [],
  k_rd: ['feedback_evidence'], k_swe: ['feedback_evidence'], k_trd: ['feedback_evidence'], k_oth: ['feedback_evidence'], rho: ['correlation_evidence'],
  betaX: ['procyclicality_evidence'], m_rev: [], m_rate: [], lambda: [], rate0: [],
  H_sat: [], H_cap: [], subst: ['migration_share'],
  K0: ['capacity_disclosure', 'capacity_estimate'], pipe: ['capacity_disclosure', 'capacity_estimate', 'growth_calibration'], buildMax: ['growth_calibration'], lead: ['delivery_timeline'], capexGW: ['cost_per_gw'], mono: ['revenue_per_gw'], train: ['compute_split'],
  targetUtil: [], fin: ['financing_evidence'],
};
export const RULE_TEXT = {
  primary_report: 'A newer primary report of a frontier lab’s annualised run-rate (company disclosure, Bloomberg, The Information, FT, Reuters). R0 is the sum across labs; propose the new sum and list the components.',
  usage_share: 'Usage-share data on what frontier tokens are spent on (Anthropic Economic Index, OpenRouter categories, SemiAnalysis revenue attribution, lab disclosures).',
  metr_latest: 'A new METR time-horizon measurement of a frontier model (80%-success horizon, hours).',
  metr_doubling: 'A new METR estimate of the horizon doubling time (months).',
  feedback_evidence: 'Quantitative evidence on spend-to-revenue feedback in a segment (share of raised capital spent on compute, inference cost per revenue dollar, lab R&D compute plans).',
  correlation_evidence: 'Quantitative evidence on how correlated the demand segments are: co-movement of lab, startup and quant spend, or an attribution of returns to correlation (IMF-style). Customer concentration alone does not qualify.',
  procyclicality_evidence: 'Quantitative evidence on how token budgets respond to market conditions (survey data on budget cuts after drawdowns, capex response to selloffs).',
  migration_share: 'Data on bounded workloads moving to non-frontier or open-weight models (OpenRouter share, enterprise spend mix, price cuts with volume response).',
  capacity_disclosure: 'A lab or cloud disclosure of GW online or contracted (earnings call, press release, filing).',
  capacity_estimate: 'A credible analyst estimate of frontier-lab GW online or contracted (Epoch, SemiAnalysis, sell-side).',
  delivery_timeline: 'Reported time from signing to first delivery of GW-scale capacity.',
  cost_per_gw: 'Reported all-in capex per GW of AI datacentre (chips, building, power).',
  compute_split: 'Reported split of lab compute between training/R&D and inference.',
  revenue_per_gw: 'Reported or estimated revenue per GW of inference capacity at current prices: lab or cloud disclosures of revenue per MW, lease rates times utilisation, or analyst estimates (Patel’s $/MW, SemiAnalysis per-GW potential). State the basis: a per-total-GW figure divides by the inference share before it is compared with mono.',
  financing_evidence: 'Data on how much of the buildout is debt-financed or how builds respond to credit conditions.',
  undisclosed_estimate: 'Analyst or company evidence on frontier revenue outside Epoch’s disclosed set (Gemini API, hyperscaler-native inference, labs that stopped disclosing). R0x is an allowance added to the Epoch sum.',
  epoch_sum: 'Deterministic: the collector sums Epoch’s disclosed run-rates. Agents may not propose this key directly; a newer primary report goes through primary_report on R0_epoch.',
  growth_calibration: 'The weekly calibration ledger (state.calibration) records the gap between observed and modelled quarter-zero growth. When the ledger shows the gap above 0.05 log/quarter for three consecutive weeks, or the fast lane is open (above 0.15 for two weeks), propose one capped move toward closing half of it: pipe (then buildMax) when quarter zero is rationed, orgX when there is slack. Cite the ledger counters in the rationale. Caps per run apply.',
  rebaseline: 'Weekly re-derivation of a parameter from scratch; allowed for R0, H0, D0, K0, pipe, train, capexGW, sh_*.',
};
export const REBASELINE_KEYS = ['R0_epoch', 'H0', 'D0', 'K0', 'pipe', 'train', 'capexGW', 'sh_rd', 'sh_swe', 'sh_trd'];
export const EXPOSED = Object.keys(RULES);
export const GAUGE_RULE = 'A newer reading of the same gauge from its own source (or an equivalent official source), with the survey or observation date.';
