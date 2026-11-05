# S5-design review (adversarial) — `regime/S5-design.md` against `RULER-regime.md` draft 3 fix 1 (6f99303)

Status: review only. Not committed. No rule is changed here; where a fix needs a rule change it is routed to §10.1 ⑨ (allowed at exposure grade "dev 만", L68) and must be decided **before the first N_R count** (B1). `Lnnn` = `RULER-regime.md` line (byte-identical at HEAD 9669c36; last change 6f99303), `D§x`/`Dnnn` = `S5-design.md` section/line.

**Opened**: RULER-regime.md (whole), S5-design.md (whole), plan.md (S5 order, §2.1 R-table, §3.2 W1–W4), decisions-2026-11-04.md, `sat-times.json.gz` (metadata only: structure, times, flags, polygons), `.harness/oro/sounding.json` (**keys, time range only**), `sounding-manifest.json` (null counts, elevation, cost), `oro/FROZEN.json` (file hashes), `oro_ref.py` (guard, `interp_fallback`, `Sounding`, `ref_values`, `SiteCache`, `evaluate_scene`, `sounding_source`, `wind_to_uv`), `oro-geom.py`, `fetch-sounding.py`, `fetch-sat-times.py`, `macro/fetch-sat.py` (header, `wms_url`, mask/empty code), `cloudSkeleton.ts` (`lclAglM`), `weather.ts` (level constants by grep), simD/simE code (bootstrap percentile, shift draw).
**Not opened**: any MODIS value or image, bank PNG/scene JSON, `index.json`, gate/quartile files, logs, `restore-log.md`, `oro-inputs.json`, `oro-apply.json`, `macro/jobs-macro.json`. No network, no GIBS.
**Reviewer exposure**: `S5-design.md` D11 prints one dev cover value. It is the value already behind the recorded grade "dev 만"; the grade is unchanged (L68: record only). This review does not repeat it.
**Computed** (scratchpad `s5rev/cmrcheck*.py`, `python3 -I`, CMR metadata only; marked [CMR-meta]).

---

## Verdict
Not ready to run as written. 4 blockers for S5a (B1–B4), 9 major items that must be fixed before the list commit or before any S5b value exists (M1–M9), 12 minor (m1–m12). The selector core (§1.5–§1.14), the pass grouping, filter 1, the shift-day pick and the R10 command match the ruler and the data; §V lists what was verified.

---

## B. Blockers (fix before `regime_ref.py count` is run)

### B1. The single N_R count runs before the definitions it depends on are fixed (order deviation)
- Ruler, §10.1 order: L627-L631 "3. 정의를 정합니다. … 시어 정의의 원문을 확인합니다. - 셋 다 §0.4 에 적습니다." **before** L632-L634 "4. `regime_ref.py` … 임시 레짐 목록 … 으로 N_R 을 셉니다. - 모자라면 확장 탐측 … 받고 다시 셉니다. 그것으로 기간을 정합니다." L261 "이 바꿈은 `regime-list.json` 을 만들기 전에만 할 수 있고". L217 "기간 셈은 동결 전 한 번뿐".
- Design: D71 "The shear definition in force is printed (`SHEAR_DEF`, §1.9; §O-1)"; D72 step 1 `count`; D470 O-1 "switch to `sfc` **before** the final `regime-list.json`"; D471 O-2 "must happen before the list commit if wanted"; D77 tests run only at step 4, after `count`.
- Problem: the shear definition decides ROLL (L282) and O-2 would change filter 1; both change N_R and therefore the R10 decision (once, shared-IP budget). Counting first and resolving O-1/O-2 later makes the period choice depend on which definition was chosen after N_R was seen (MODIS-free, but a forking path the ruler's order forbids). Running the code fixes of a failing test after `count` has the same effect.
- Correction (replace D71-D77):
  - "0. Preconditions (exit 4): … (as now), **and** (e) `--shear-def zi01|sfc` is given explicitly (no default) and equals the value recorded at L105 (§10.1 ③ done; session gate); (f) the O-2 decision (§B4) is recorded and `--f1-variant solar|solar+utc` equals it; (g) `regime-test.py --synthetic` (every test except R-DATA/R-SCHEMA on real files) is ALL PASS for the same `regime_ref.py` sha256."
  - "1. `count` — run once on the final code. Prints `N_R p2026 = n`, `regime_ref.py sha256`, `shearDef`, `f1Variant`, `satTimesSha256`, `soundingFileSha256`; the session copies the line to L108. A second `count` is allowed only after R10 (L634 '다시 셉니다') and must reproduce the same p2026 number."
  - Move step 4 (`regime-test.py`) to 0(g); keep R-DATA/R-SCHEMA as step 4 after `list`.

### B2. R-EDGE and the §1.5 edge note state a false data fact
- Design D150: "kanazawa/osaka/sapporo Terra (≈ 23:5x UTC) on the first day of each period fall on the previous UTC date [CMR-meta]"; D334 R-EDGE: "real first-day Terra passes of sydney/kanazawa/osaka/sapporo → NA".
- Data [CMR-meta, single-pass first days]: p2026 Terra mids kanazawa 2026-06-01T00:12:30Z, osaka 00:12:30Z, sapporo 00:07:30Z; p2025 kanazawa 2025-06-01T00:22:30Z, osaka 00:22:30Z, sapporo 00:17:30Z — all **inside** the file (bracket 00:00/01:00 exist, not NA). Only Sydney is before the file: 2026-05-31T22:52:30Z, 2025-05-31T23:02:30Z.
- Ruler: L170-L171 (linear between the bracket hours; one side missing → NA). The rule is right; the test expectation is wrong, and "fixing" code to satisfy it would NA valid scenes.
- Correction: D150 → "Edge: a pass before the file's first hour has a missing side → NA by rule. In the data this happens only for Sydney Terra on the first solar day of each period (mid 2026-05-31T22:52:30Z, 2025-05-31T23:02:30Z) [CMR-meta]; kanazawa/osaka/sapporo first-day Terra mids are 00:07–00:22 UTC on 06-01, inside the file." D334 → "R-EDGE: synthetic time after the last hour → NA; real sydney first-day Terra (p2026, p2025) → NA; real kanazawa/osaka/sapporo first-day Terra → not NA (linear on 00:00/01:00)."

### B3. Contamination: a MODIS value in the design text, and a guard test that opens a real leak file
- Task rule / ruler L56, G9 L566: no MODIS values opened or shown. Design D11 writes the numeric dev cover value into a design document that every later reader (review agents, main session) will open.
- Correction D11: "**Exposure grade: dev 만** (one dev cover value — seoul 2026-09-05 — printed by an S3b agent from `macro/jobs-macro.json`; no held value; `oro/restore-log.md` '추가 기록')." (drop the number). Do not copy the value into any other file.
- Design D312 R-GUARD "opening … `tools/genus-ruler/macro/jobs-macro.json` … raises `PermissionError`": if the hook is mis-installed the test reads the known leak file. Correction: "R-GUARD: (1) call the pure `regime_ref.s5a_verdict(path)` (no I/O) on the real forbidden paths (`macro/jobs-macro.json`, `.harness/macro/sat/…`, `.harness/regime/sat/…`, `regime/S5-design.md`) → 'forbidden'; (2) in a subprocess, `open()` only **non-existent** probe paths under forbidden prefixes (`.harness/regime/sat/__probe__.png`, `tools/genus-ruler/macro/__probe__.json`) → `PermissionError` (FileNotFoundError = FAIL); (3) allowed paths open." Same for T-GUARD5B (D407): use a synthetic PNG in test-tmp mapped through the verdict function, never a real held PNG.

### B4. O-2 (GIBS UTC-day ambiguity) is understated and must be decided before `count`
- Ruler L153: "둘 이상이면 그 위성의 그날 장면은 뺍니다. GIBS 합성이 어느 통과를 위에 두는지 미확정이기 때문입니다"; L151: "평균 태양일 창이 그날 아침 통과 하나를 고릅니다" (CMR selection only). Design D471: "Terra is only the fallback satellite, so the effect is limited to Aqua-filtered days"; Q-24 TIME = UTC date of the mid.
- Data [CMR-meta]: Terra is not a rare fallback — held p2026 has 294 days where only Terra passes filter 1 (Aqua 478, either 772). Of these, **54** have another covering DAY pass in the same GIBS UTC day (busan 11, osaka 20, sapporo 23); plus 36 "other-satellite" Terra images on Aqua days (busan 5, osaka 12, sapporo 19). Dev p2026: 33 of 73 Terra-only (kanazawa 25, seoul 8) — these feed the a-choice. Held p2025: osaka 5, sapporo 14 (+25 other). Aqua: 0 in every period. For those images the GIBS composite may show the next/previous solar day's pass — the very ambiguity L153 excludes.
- Edge defect if a rule uses `utcDayPasses`: the CMR windows stop at the period's solar days, so for East-Asia Terra the UTC days of solar 06-01 and 10-31 can hold a pass of solar 05-31/11-01 that is not in the file → undercount.
- Correction: rewrite O-2 with the numbers above and make it a pre-`count` decision (B1 (f)). Proposed rule for the §10.1 ⑨ short re-review (MODIS-free, L63-L68): "거름 1 에 더해, 그 위성 통과의 GIBS UTC 날짜(가운데 시각의 UTC 날짜)에 관측점을 덮는 다른 DAY 통과가 없어야 합니다(같은 이유, L153). 기간 첫·끝 태양일에서 이웃 통과가 CMR 창 밖일 수 있으면(가운데 시각이 UTC 자정 ± 2 h 안) 모름 = 뺌." Apply the same test to `fetch.other`. If the session keeps the rule unchanged, store `gibsAmbiguous` per pass and pre-register a §7-style split (P1/J3 with and without) before the list commit.

---

## M. Major (fix before the list commit, or before any S5b value exists)

### M1. Render I_org on "the 24 km torus" is wrong for every C4 render
- Ruler L296: "임의 각도의 늘임은 24 km 토러스 주기를 깨서"; L289 M = R(θ)diag(√a, 1/√a)R(−θ); L338 "렌더는 주기로 둡니다". Design D372: "render periodic on the 24 km torus".
- g(x) = f(M⁻¹x) has period lattice Λ = M·(24 km)ℤ², not 24ℤ² (a ≠ 1). Minimum-image distances on the square torus are wrong for C4, which biases J2's I_org, ΔI_mech(a) (L342-L343) and J3's D_I and c_I (L441).
- Correction (D372-D373): "`iorg(mask, lattice)`: satellite → minus-sampling as now. Render (K0 and C4) → periodic under its own lattice Λ = M·24ℤ² (M = I for K0). Objects = 8-connected components on the 500 m world raster; one representative per Λ-orbit (centroid mapped by M⁻¹ into [0, 24)² km, de-duplicated within 0.25 km; representative = the copy not touching the window edge, first in row-major order); NN distance = min over the 3×3 neighbouring images of |Δ − M·24n|; λ = n/576 km² (det M = 1). `iorg_null`: same objects placed uniformly in the fundamental cell with periodic non-overlap." Add T-IORG-LAT: a 24 km-periodic K0 field gives the same I_org on one tile and on the 96 km window; an isotropic field under M(2) gives the same n per cell as M = I.

### M2. I_org integral truncated at 48 km
- Ruler L339 "I_org = ∫Ĝ dF, F(r) = 1 − exp(−λπr²)" (whole range). Design D372 "trapezoid on r = 0..48 km". With few objects F(48 km) is far from 1 (n = 1 in 96² km: F ≈ 0.54; n = 5: ≈ 0.98), so I_org is biased low exactly where cf is small.
- Correction: "I_org = ∫₀¹ Ĝ(r(F)) dF, r(F) = √(−ln(1 − F)/(λπ)), F on 2,001 uniform points (trapezoid; the last point uses Ĝ = 1), Ĝ right-continuous empirical CDF."

### M3. G1 baseline commit must exist before any K0 render
- Ruler L624-L625 (§10.1 ① "어떤 기준·해시보다 먼저 … G1 기준 커밋을 만들고, 그 커밋에서 `g1-baseline-regime.json` 을 잽니다"), L545, L666 "앱 번들(K0 = G1 기준 커밋)". Design D351 puts G1 last; D383 bundles K0 "at the K0 commit (G1 baseline commit, L545)" which does not exist yet (D396 "not yet made").
- Correction (D351): "Order: **G1 baseline commit** (S1 tail: 115fbe2 + ece32b1 + G1 tools only) → `power-regime.json` → texture A → `render-tile.mjs` (K0 bundle from that commit; its hash in every render index) → texture B → J2 → fetch → dev → `dev-choice.json` → `g1-baseline-regime.json` measured from a worktree of the G1 baseline commit (the two ROLL jobs need the committed list)." R-LCL-TS: assert `cloudSkeleton.ts` is byte-identical between 115fbe2 and the G1 baseline commit, else bundle from the latter.

### M4. Judge-path numbers left unpinned (determinism; ruler does not give them)
- L92 "백분위 95 %" and §6.3 U95/L95: the design (D409 "percentile 95 %") does not say which percentile. simD, which calibrated τ = 1.40, uses `np.percentile(bm, 97.5)` (`oro/draft3/v3-sims/simD_exag_interval.py` L59). Correction: "U95/L95 = 97.5th/2.5th percentile (`np.percentile`, method 'linear') of 10,000 week-block replicates; a replicate draws the present ISO weeks with replacement (count = number of present weeks) and takes `np.median` of all scenes of the drawn weeks with multiplicity (simD used the lower weighted median — recorded as a Q reading)."
- L398 P2: "10,000 번" and no seed; D393 "P2 (stratum from `power-regime.json`)". Correction: "P2: `np.random.default_rng(20261103)` new instance (L92 seed, separate Generator), strata sorted, scenes sorted by key within a stratum, one `rng.permutation` per stratum per replicate, p = (1 + #{Δ_perm ≥ Δ})/10,001."
- D390 `--power`: synthetic-scenario RNG unpinned. Correction: "one recorded seed (e.g. 20261105) via `SeedSequence(seed).spawn` per scenario × q; judge seeds unchanged inside each replicate."
- D391/D397 "the first dev ROLL scene by date", "first two … by date": two dev sites can tie. Correction: "order (date, site)".

### M5. Fields the ruler's reports need are missing from `regime-list.json` (must exist before the list is frozen/committed)
- Scan-direction contrast, L410: "θ_sat 이 **궤도 가로(주사) 방향** ±30° 안인 비율". No per-pass scan axis is stored. Correction: add to `pass_info` `scanAxisDeg` = axis of the cross-track direction at the site (track bearing at the closest point + 90°, converted to the D§0.3 east–north math convention, [0, 180)), computed from the same ring as `ctKm`; test R-CT-AXIS (meridian quad → 0°).
- Sensitivity L537 "가로 거리 ≤ 300 / 520 km". The 520 km arm changes the scene satellite (Aqua at 430–520 km is preferred over Terra) and needs images not in the fetch list. Correction: store `variants.ct300` and `variants.ct520` = `{sat, regime, fetch}` per row and add `fetch.ct520`; or record now (before any read, L684) that the 520 km arm is '못 잼'.
- Site split L413 "산악·평지 사이트 따로" (L144 "산과 평지 반반 — RULER-oro 와 같은 나눔"): no list is pinned. Correction: pin the held mountain/flat lists from their documented source and cite it (if none exists, Q-reading: mountain = A1 true (denver, osaka, sapporo), and say that this is 3 of 8 held, not "반반").

### M6. `texture.py` lacks the statistics the CELL label and the §7 arms need
- L416 "CELL = A* < 1.3 ∧ 2~12 km 반지름 스펙트럼 최대가 그 띠 중앙값의 2 배 이상". `scalars` (D375) has no radial spectrum. Correction: add `radialPeakRatio` = max/median of the azimuthally averaged P over |k|-bins of width Δk = 2π/96 km⁻¹ inside 2–12 km, and the ROLL label inputs (A* ≥ 1.5 ∧ 2 ≤ λ_s ≤ 15 km).
- L642 "합성 롤·세포": Phase A (D379) has rolls, isotropic, lattice/clustered I_org but no cell pattern. Add T-CELL (hexagonal cells: A* < 1.3, radialPeakRatio ≥ 2, λ_s within 5 %).
- L321 "250 m 그대로의 값은 보고만" and L535-L536 (mask 0.40/0.50, R only, no resolution matching): name these code paths (`resolution='250'`, `mask='min'|'R'`, threshold arg).
- L527 axis offset ±15° and the 2판 nearest-a arm need renders: list them in the render plan or declare them rendered at judge by the frozen `render-tile.mjs`.

### M7. Render inputs for the judge are not frozen anywhere
- L682 pre-read check: "… A_null 표·렌더 입력 … FROZEN 해시와 맞는지". Design D387 "Outputs `.harness/regime/render/<key>__<a|K0>__r2.f32` + index"; the index is not in D§0.4 outputs or in the FROZEN list, and the `r2` name suggests a thresholded field although r1 must be re-thresholded at judge from the same density.
- Correction: store the unthresholded density `<key>__<K0|a>.f32`; write `regime/render-index.json` (sha256 per file, bundle hash, G1 baseline commit) and list it for FROZEN `files` (session decision, L657); precheck compares it.

### M8. `empty250` contradicts the cited source
- Design D365: "R = G = B = 0 (fetch-sat '전부 0')". `macro/fetch-sat.py` code (L63): `empty = (a.max(axis=2) < 0.02)`; "전부 0" is only its docstring. Ruler L198 does not define empty.
- Correction: "`empty250` = max(R, G, B) < 0.02 (fetch-sat.py L63, the `old` mask source, L665); Q-26 unchanged (any of four)". Add a Q row citing L198.

### M9. Axis fallback follows `SHEAR_DEF`, but L264 fixes the vector
- L264: "\|U_CBL\| < 2 m/s 이면 경계층 시어 벡터 V(z_sfc + zi) − V(z_sfc + 0.1 zi) 의 방향을 씁니다". Design D190 `theta_cbl(U, S)` with S from `shear(…, defn=SHEAR_DEF)` (D185): under `sfc` the axis vector becomes V(z_sfc + zi) − V10.
- Correction: "`theta_cbl` always uses S_zi01 = V_at(zSfc + zi) − V_at(zSfc + 0.1 zi) (L264), whatever `SHEAR_DEF`"; or, if the session reads L261 as moving the axis too, add a Q row saying so. R-AXIS gets a case with `SHEAR_DEF='sfc'`.

---

## m. Minor

- **m1 Q-2 facts** (D438 "Cost: a few Sydney winter Aqua passes flagged `BOTH` are lost"). [CMR-meta] 11 Aqua BOTH-only passes lie at 15–16 h LMST and 1 Terra at 07 h; on sydney 2026-06-26 and 2026-07-09 a daytime BOTH pass (≈ 16.6–16.7 h) coexists with the DAY pass (15.04 h), so DAY-only counts them single-pass while GIBS may composite both; 1 Aqua and 1 Terra p2026 pass mix DAY+BOTH granules (mid computed from the DAY granule only). Impact ≈ 0 (Sydney Aqua June–July sun < 20° → NONE), but write these facts into Q-2.
- **m2 G7 excuse** (D424 "θ only when `axis2` is set"): L555 excuses any scene within any §0.3 margin. Stricter is acceptable; add a Q row (L555) saying it is stricter.
- **m3 LCL** (Q-11): the reading conflicts with the literal "(T2m·Td2m)" (L269). It is acceptable for G7, but list it among the §0.6 facts for the ⑨ short re-review.
- **m4 §6.5 note** (D229 `period.note`): L219 also wants "P1 미결 가능성 큼" in the §6.5 사전 예측. Add to §0.6 facts.
- **m5 Provenance**: `oro_ref.sounding_source` records nulls only for oro's variables (SOUNDING_NULL_VARS). Add `regimeNulls` (from the manifest) for the selector variables per site and period. This matters for 2025, where BLH/CAPE nulls are likely.
- **m6 R-SUNSET** (D341 "= `oro.py evening()` rule"): `oro.py` is not on the S5a allow-list (D30). Hand-code the rule (−2 ≤ alt ≤ 8, alt(t) < alt(t − 30 min)); do not import `oro.py`.
- **m7 CMR completeness**: add assert `hits == nReturned` for every used query (true for all 60 [CMR-meta]; L651 "CMR 질의 전부").
- **m8 Variable-name map**: D§1.6 never names the Open-Meteo keys. Pin `temperature_2m`, `dew_point_2m`, `cape`, `boundary_layer_height`, `precipitation`, `shortwave_radiation`, `cloud_cover_low`, `cloud_cover_high`, `wind_speed_10m`/`wind_direction_10m`, `wind_{speed,direction}_{925,850,700}hPa`, `temperature_/relative_humidity_/geopotential_height_{p}hPa` for p in PL, and site-level `elevation`. Never read `surface_pressure`, `sensible_heat_flux`, `freezing_level_height`, `cloud_cover`, `cloud_cover_mid`, or the 600/500/250 hPa winds (present in the file; L242 node list excludes them).
- **m9 Human exposure through committed metadata**: `texture-manifest.json` `bytes` (L185) is a held per-scene content proxy. Add it to the never-open list for people and commit it without showing diffs. R-TERRAIN-ORO/R-SND-SAME read the oro scene list, whose membership comes from fetch-sat's cover-range skip rule. They print counts only, never names.
- **m10 R-LCL-TS bundle**: closed-world folder (empty `tsconfig.json`/`package.json`) as `oro-base.mjs` build notes 1, else esbuild walks up to the repo tsconfig ("use strict").
- **m11 Shift / power frames**: D390 P2 power frame unspecified. Pin the frame as "held convective scenes (DISORG·CELL·ROLL) × filter-3 survival 0.75".
- **m12 Exit/record**: D§1.23 `count` writes nothing. That is fine, but its printed line (B1) is the §0.4 L108 record, and the session must copy it unchanged.

---

## V. Verified (no change needed)
- `sat-times.json.gz` [CMR-meta]: top keys `queries, source, products, periods, fields, scriptSha256`; 60 queries (`site, sat, period, url, hits, pages, nReturned, nDay, fetchedUtc, granules`), hits = nReturned in all 60; granule keys `time_start, time_end, day_night_flag, polygons, solarDate`; flags DAY 16,633 / BOTH 2,014 (NIGHT dropped by the fetcher; `nDay` counts DAY∪BOTH); 18,647 granules, all 300 s, one 5-vertex ring each (4 corners + closing); 9,267 duplicated starts, end and flag never differ; stored `solarDate` = solar date of `time_start` for all; consecutive DAY granule starts are 300 s or > 3,600 s apart (start-to-start = end-to-start grouping); 0 passes straddle solar midnight; 110 single-pass days need the centroid fallback.
- Filter 1 p2026: held Aqua 478 / Terra 481 / either 772, dev 199. Multi-pass Hamburg 96/82, of which 28/13 contain a pass outside 06–18 h LMST. Single-pass LMST quartiles Aqua 2026 14.82/15.21/15.62, Terra 8.67/9.07/9.47, consistent with §0.4. Held DAY∪BOTH by month: Aqua 239–248, Terra 228–247 (= L99); DAY only: 232–248 / 225–247 (VIIRS rule unchanged).
- `sounding.json` keys: 10 sites × {lat, lon, elevation, hourly}; 70 vars + time, 3,672 h, 2026-06-01T00:00..10-31T23:00 GMT; T and Z at 15 levels, RH at 13 (to 300 hPa), wind at 10 m/925/850/700/600/500/250 only. Every D§1.2 PL level has T/RH/Z; every selector wind level exists; no per-level cloud cover (S5b-1 is real). Manifest: 0 nulls for every variable at every site; Denver elevation 1,597 m.
- R10: `fetch-sounding.py --sites held --start 2025-06-01 --end 2025-10-31 --out sounding-regime-ext.json` writes `.harness/oro/sounding-regime-ext.json` and `tools/genus-ruler/oro/sounding-regime-ext-manifest.json`. It sleeps 10 s between requests by default, exits 3 on a daily 429 and 2 after 6 tries, and resumes per site. This matches L166-L167 and the plan's R10 line. Cost ≈ 8 × 76.5.
- `oro/FROZEN.json` `files` holds all six hashes checked in D71 and they match on disk; `oro_ref.py` sha `88a600ba…` ✓. `load_frozen` with `__name__ = 'oro_ref'` does not run oro_ref's `__main__`.
- Selector details against L239-L283 (p_sfc, θ_v, zi with unclipped BLH, U_CBL trapezoid, shear zi01, tree order, inclusive/exclusive thresholds, margins, NA list, CAPE/BLH exceptions), filter 2, satellite choice (L147), shift pick (L359-L366, 72 u values), NONE sample, and the wind/axis conventions (R-AXIS, R-UV, R-SHEAR hand values recomputed) all agree.
