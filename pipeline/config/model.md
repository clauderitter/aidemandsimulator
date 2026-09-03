# Model description (for the weekly review)

Quarterly steps from quarter zero (the current calendar quarter) over 18 quarters; eight quarters of actuals kept behind it.
Demand is four segments: AI R&D (rd), software engineering (swe), trading (trd), everything else (oth).

**Segment growth (log, per quarter):** `g_i = drive_i + k_i × ((1 − rho) × g_i(prev) + rho × g_total(prev))`
- `drive_i = ln(1 + organic_i)/4 + eps_i × epsX × d × sat_i + b_i × betaX × (M − 1)`; for `oth` also `− subst/4`.
- `d` = horizon doublings this quarter = `(3 / D0) × regulation × rdBoostFactor × ceilingSlow`, where `rdBoostFactor = clamp(1 + rdBoost × log2(rd spend / trend), 0.5, 1.5)` and `ceilingSlow = 1 / (1 + (H / H_cap)^3)`.
- `sat_oth = 1 / (1 + H / H_sat)`; unbounded segments have `sat = 1`.
- Loop gain `k_i` makes steady growth `drive / (1 − k)`; contagion `rho` blends own momentum with the aggregate's.

**Capability:** `H` (80%-success task horizon, hours) grows by `2^d` per quarter.

**Markets:** `M` (index, 1 = neutral) moves with growth surprises (`m_rev × (realised − expected)`), mean-reverts (`lambda`) toward `exp(−m_rate × (rate − rate0))`; expectations adapt at `alpha`.

**Supply:** monetisable capacity `= K × (1 − train) × mono × priceMult`. Labs commit builds when revenue extrapolated over `lead` quarters ÷ `targetUtil` exceeds online plus pipeline; commits capped at `buildMax × K` per quarter and scaled by financing `clamp(1 + fin × (M − 1) − r_sens × (rate − rate0), 0, 1.5)`. Capex = builds × `capexGW`. Demand is rationed to `capacity × (1 + overhang)`; realised revenue = min(demand, capacity).

**Shocks:** rate (pp, lasting), regulation (× slower doubling, lasting), market shock (−% on M), breakthrough (extra doublings), segment cuts (−% spend), open-source (pp/yr more migration), adoption wave (%/yr, lasting), token price collapse (−% revenue per GW, bounded spend −half), compute repricing (+% revenue per GW), pipeline cancellation (−% of not-yet-online GW).

**Not modelled:** token prices and volumes separately, margins, individual labs, equity feedback into lab valuations beyond `M`, power and chip supply chains explicitly (only through `buildMax`, `lead`, `capexGW`).

**Derived rules:** `mono = R0 ÷ (K0 × (1 − train))` keeps quarter-zero utilisation at 100% (stance: labs are compute-constrained today). `R0 = Epoch disclosed sum + R0x`. `rate0 = Fed funds + 0.4`.
