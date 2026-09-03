# Reflexive Demand Simulator

A self-updating scenario simulator for frontier-AI token demand, built on Giovanni Cattani’s
[“Nobody is talking seriously about AI demand”](https://x.com/giovannicatt3/article/2094815425972539565) (X, 1 Sep 2026).
Demand for frontier tokens is modelled as four segments (AI R&D, software engineering, trading, everything else)
whose spend feeds their own revenue and funding, against a compute supply that is committed years ahead.
Sixteen scenarios encode the market’s bull, bear and structural views; a daily pipeline keeps the inputs current.

## Layout

- `site/` — the static app (deployed by Vercel with `site` as the root directory). `index.html` renders `data/state.json`
  and `data/changelog.json`; `model.js` is the simulation, shared with the pipeline.
- `site/data/state.json` — everything the app shows: quarter zero, parameters with provenance, eight quarters of history,
  scenarios, gauges, actual events, frozen keys.
- `site/data/changelog.json` — every change the pipeline made or refused, newest first, with reasons and sources.
- `pipeline/` — the daily job. `src/collect.js` pulls deterministic feeds (FRED, CBOE, Polymarket, METR, Epoch, X);
  `src/research.js` and `src/judge.js` are the researcher and judge agents; `src/roll.js` moves the horizon forward;
  `src/validate.js` enforces schema, bounds, speed limits, the scenario cap and a model smoke test; `src/run.js` orchestrates.
  `config/` holds the watchlist, speed limits, event calendar and the rulebook.
- `.github/workflows/daily.yml` — runs the pipeline at 07:00 UTC and commits `site/data` as the repository owner.

## How updates work

1. **Roll.** If a new quarter has started, the closed quarter moves into history and quarter zero advances.
   Calendar-pinned shocks that are now in the past are marked for grading.
2. **Collect.** Feeds are read without any LLM: 10-year yield and Fed funds (FRED), VIX (CBOE), the AI-bubble market
   (Polymarket), the 80% task horizon and doubling time (METR), lab run-rates and revenue history (Epoch), and new posts
   from watched X accounts. Fixed rules map observations to parameters; `config/limits.json` caps how far any parameter
   can move per run.
3. **Research and judge.** The researcher sweeps the watchlist and emits proposals (parameter, old, new, rule, source, quote).
   The judge re-fetches each source, verifies the quote, allows only documented rules, enforces the speed limits, re-runs
   the model and accepts or rejects. Ties mean no change. Both run on Claude Opus 5 through the Anthropic SDK with web search and fetch; `agents_enabled` in `config/watchlist.json`
   switches them off. `AGENTS_MOCK=1` runs the same path with canned proposals and verdicts for local tests.
4. **Validate and commit.** If validation fails nothing is written and the run fails loudly; otherwise the data files are
   committed and Vercel redeploys.

## Running locally

```bash
cd pipeline && npm install && node src/run.js --only=collect && node src/validate.js
cd ../site && python3 -m http.server 8080   # then open http://localhost:8080
```

Secrets (GitHub → Settings → Secrets and variables → Actions → Repository secrets): `ANTHROPIC_API_KEY`,
`X_BEARER_TOKEN`, `ANTHROPIC_WORKSPACE_ID` (required for identity-linked API keys), optionally `FRED_API_KEY`. The site itself needs none.
