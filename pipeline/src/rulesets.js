// What the agents may touch, and under which rule. Everything else is rejected by the judge.
export const RULES = {
  R0: ['primary_report'], sh_rd: ['usage_share'], sh_swe: ['usage_share'], sh_trd: ['usage_share'],
  H0: ['metr_latest'], D0: ['metr_doubling'], rdBoost: [], epsX: [],
  k_rd: ['feedback_evidence'], k_swe: ['feedback_evidence'], k_trd: ['feedback_evidence'], k_oth: ['feedback_evidence'], rho: ['correlation_evidence'],
  betaX: ['procyclicality_evidence'], m_rev: [], m_rate: [], lambda: [], rate0: [],
  H_sat: [], subst: ['migration_share'],
  K0: ['capacity_disclosure', 'capacity_estimate'], pipe: ['capacity_disclosure', 'capacity_estimate'], lead: ['delivery_timeline'], capexGW: ['cost_per_gw'], mono: [], train: ['compute_split'],
  targetUtil: [], buildMax: [], fin: ['financing_evidence'],
};
export const RULE_TEXT = {
  primary_report: 'A newer primary report of a frontier lab’s annualised run-rate (company disclosure, Bloomberg, The Information, FT, Reuters). R0 is the sum across labs; propose the new sum and list the components.',
  usage_share: 'Usage-share data on what frontier tokens are spent on (Anthropic Economic Index, OpenRouter categories, SemiAnalysis revenue attribution, lab disclosures).',
  metr_latest: 'A new METR time-horizon measurement of a frontier model (80%-success horizon, hours).',
  metr_doubling: 'A new METR estimate of the horizon doubling time (months).',
  feedback_evidence: 'Quantitative evidence on spend-to-revenue feedback in a segment (share of raised capital spent on compute, inference cost per revenue dollar, lab R&D compute plans).',
  correlation_evidence: 'Quantitative evidence on how correlated the demand segments are (co-movement of lab, startup and quant spend; IMF-style correlation attribution).',
  procyclicality_evidence: 'Quantitative evidence on how token budgets respond to market conditions (survey data on budget cuts after drawdowns, capex response to selloffs).',
  migration_share: 'Data on bounded workloads moving to non-frontier or open-weight models (OpenRouter share, enterprise spend mix, price cuts with volume response).',
  capacity_disclosure: 'A lab or cloud disclosure of GW online or contracted (earnings call, press release, filing).',
  capacity_estimate: 'A credible analyst estimate of frontier-lab GW online or contracted (Epoch, SemiAnalysis, sell-side).',
  delivery_timeline: 'Reported time from signing to first delivery of GW-scale capacity.',
  cost_per_gw: 'Reported all-in capex per GW of AI datacentre (chips, building, power).',
  compute_split: 'Reported split of lab compute between training/R&D and inference.',
  financing_evidence: 'Data on how much of the buildout is debt-financed or how builds respond to credit conditions.',
  rebaseline: 'Weekly re-derivation of a parameter from scratch; allowed for R0, H0, D0, K0, pipe, train, capexGW, sh_*.',
};
export const REBASELINE_KEYS = ['R0', 'H0', 'D0', 'K0', 'pipe', 'train', 'capexGW', 'sh_rd', 'sh_swe', 'sh_trd'];
export const EXPOSED = Object.keys(RULES);
export const GAUGE_RULE = 'A newer reading of the same gauge from its own source (or an equivalent official source), with the survey or observation date.';
