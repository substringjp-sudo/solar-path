# S5 design — RULER-regime pre-freeze tools (implementation spec)

Status: design for plan S5 (`oro/draft3/plan.md` "S5 순서" plan L104-L110; §3.2 W1–W4 plan L268-L274; R10 plan L137) against `regime/RULER-regime.md` **draft 3 fix 1 (6f99303, unfrozen; byte-identical at HEAD 9669c36)**. Not committed. This file changes no rule. Where the ruler is silent or self-inconsistent, §Q gives the reading chosen and the ruler line that supports it; §O lists what this design cannot decide. `Lnnn` = `RULER-regime.md` line; `oro Lnnn` = `oro/RULER-oro.md` at 881a83c; `plan Lnnn` = `oro/draft3/plan.md`; `dec` = `oro/draft1/decisions-2026-11-04.md`.

**Revision 1 (2026-11-05)** applies `regime/S5-design-review.md` (B1–B4, M1–M9, m1–m12). Every finding is applied, some in a corrected or different form; §R gives the disposition of each with its ruler line (`Dnnn` there = line of the pre-revision design). Review facts that were re-measured here and differ are marked "(recount)".

**Where S5 starts** (all facts MODIS-free):
- RULER-oro is frozen at **881a83c** and closed 미결 (c1) (dec "동결 전 셈 뒤 결정"; `oro/FROZEN.json` sha256 `a507e949…`). Its frozen `oro_ref.py` (sha256 `88a600ba7f3df178ca9e46437826e19354f84dd13c9dcd7c4f5e87f9a01576f2`) supplies the terrain flag (L229-L232, oro L514). Everything under `tools/genus-ruler/oro/` is an **old** file for regime and is not edited; the only new file S5 may create there is `oro/sounding-regime-ext-manifest.json` (written by the frozen `fetch-sounding.py` itself, L167).
- The "oro 동결 커밋" precondition of L231 and L635 is met, so the final `regime-list.json` (with terrain flags) can be built directly; the provisional N_R of L633 is the same code without the terrain column.
- Decisions D4·D5·D6·D8·D14 received (L118-L127). D15 = 아니오, D16 = (가) are oro-only (dec).
- Soundings 10/10: `.harness/oro/sounding.json` (best_match, 2026-06-01..10-31, GMT, `wind_speed_unit=ms`, 70 vars, 3,672 h per site). `sounding-manifest.json` records **0 nulls** at every site for every selector variable (BLH, CAPE, precipitation, shortwave, low/high cover, T2m, Td2m, 10 m/925/850/700 wind, Z/T/RH profile) [measured, manifest `sites[*].nulls`]. So in 2026 zi always comes from BLH and no 2026 scene is NA by a null; the NA/parcel paths are exercised by synthetic tests only (and possibly by the 2025 extension).
- CMR R8 60/60 (`regime/sat-times.json.gz`), truth instrument Aqua, no VIIRS (L97-L99). R9 probe done.
- **Exposure grade: dev 만** (one dev cover value — seoul 2026-09-05 — printed by an S3b agent from `macro/jobs-macro.json`; no held value; `oro/restore-log.md` "추가 기록"). The value itself is not written in this file or any other S5 file. Per L68 this is recorded only. Note: L116 still says "없음"; the §0.4 update to "dev 만" (as RULER-oro did in a39e52e) is an S5 step-⑨ record (§O-4), not done here.

**What this design looked at**: the ruler, the plan, dec, `oro_ref.py` (whole file), `oro-geom.py`, `oro.py` sunset part (`evening`, `sunset_hours`), `fetch-sounding.py`, `fetch-sat-times.py`, `macro/fetch-sat.py` header/URL code, `sounding-manifest.json`, `oro-inputs.json` source block and one `closest` time, `oro-apply.json` A1–A3 of one row, `dem-grids.json` per-site scalars (`a1RmsM`, `zRefM`), `oro/FROZEN.json`, `probe-r4.json`, `restore-log.md`, the structure and granule metadata of `sat-times.json.gz`, the app sources `cloudSkeleton.ts` (`lclAglM`, `dewPointC`, `SK`), `cloudPhysics.ts` (`ThermoInput`), `weather.ts` (`fetchThermoProfile`, `WIND_LEVELS`, `PROFILE_LEVELS`), `cloudGenus.ts` export list and frame uniforms, `liveScene.ts` (`aspectSpacingKm`), `cloudGenusForecast.ts` (`GenusForecastInput`), 1판 `RULER-regime.md` (103aa7a) §3.1, draft-3 sims simD/simE headers. Revision 1 also read: `macro/fetch-sat.py` L12 and L55-L70 (empty/mask code), `oro/draft3/v3-sims/simD_exag_interval.py` (`wmedian_boot`, `np.percentile` line), `oro/RULER-oro.md` site lines (oro L188 A1 by site, oro L240 "산악일 법한 held 사이트"), `oro/oro-base.mjs` build note 1, `oro_ref.SOUNDING_NULL_VARS`/`sounding_source`, `fetch-sounding.py` `VARS`.
**Computed here** (scratchpad, CMR metadata only, numbers marked [CMR-meta]): pass grouping, multi-pass days, cross-track counts (430, and 300/520 for the §7 arms), UTC-day pass counts (filter-1 days, per site), first-day pass times, BOTH-flag local times. They are design sanity values, not ruler values.
**Not opened**: any MODIS value or image, bank PNG, scene JSON (`trueGrid`/`cover`/`empty`), `index.json`, gate/quartile files, `macro/jobs-macro.json`, any restore or harness log, `.harness/macro/*`, `.harness/regime/*`. No GIBS request. No network request at all.

**Split**
- **S5a (build now)**: `regime/regime_ref.py` (= §3 selector exactly, §2.1 scene/pass rules from CMR metadata, §2.4 filters 1·2, §2.5 list fields, §2.6 N_R and period rule, §2.7 terrain flag via frozen `oro_ref.py`, `regime-shift-axes.json`, m10 sunset ratios), `regime/regime-test.py` → `regime/regime-test.txt`, outputs `regime/regime-list.json` and `regime/regime-shift-axes.json`. Conditional R10 extension fetch (§0.5 step 2).
- **S5b (spec level only; built later, still pre-freeze)**: `fetch-texture.py`, `texture.py`, `texture-test.py`, `render-tile.mjs`, `regime.py` (`--power`, `--j2`, `--dev`, `--precheck`, `--judge`), and the files `power-regime.json`, `j2-fidelity.json`, `dev-choice.json`, `texture-manifest.json`, `render-index.json`, `g1-baseline-regime.json` (§3). The G1 baseline commit is the first S5b step (§3).
- Out of scope: `blRegime.ts` and the other app work (post-freeze, W1–W3; §4 lists what must match), `FROZEN.json` assembly, ruler §0.4 edits.

---

## 0. Global rules for every S5 tool

### 0.1 Contamination (absolute)
- No satellite image is requested, opened, decoded or hashed in S5a. No GIBS request in S5a. S5b image rules are in §3.1–§3.5.
- Never open: `.harness/macro/**`, `.harness/oro/sat-*/**`, `.harness/regime/sat/**`, any `index.json` of a bank, `macro/sat-quartiles.json`, `macro/jobs-macro.json`, `ring/gate-*.json`, `ring/ringtruth-results.json`, any `*.log` under `.harness/`, `scratchpad/restore/**`.
- **S5a open guard** (in `regime_ref.install_guard_s5a()`, called first by the `regime_ref.py` CLI and by `regime-test.py`; never at import): (1) `oro_ref.install_guard()` (frozen deny list, incl. `^\.harness/regime/sat`); (2) a second `sys.addaudithook` on `open` that, for every path inside the repo root (abspath and realpath), allows only this list and raises `PermissionError("regime guard: <relpath>")` otherwise:
  - read: `tools/genus-ruler/regime/{regime_ref.py,regime-test.py,regime-test.txt,fetch-sat-times.py,sat-times.json.gz,regime-list.json,regime-shift-axes.json}`, `tools/genus-ruler/oro/{oro_ref.py,oro-geom.py,FROZEN.json,dem-grids.json,oro-apply.json,oro-inputs.json,sounding-manifest.json,sounding-regime-ext-manifest.json,fetch-sounding.py}`, `tools/genus-ruler/macro/fetch-sat.py`, `.harness/oro/sounding.json`, `.harness/oro/sounding-regime-ext.json`, `.harness/regime/test-tmp/**`, `.harness/regime/lcl-bundle/**`;
  - write: `tools/genus-ruler/regime/{regime-list.json,regime-shift-axes.json,regime-test.txt}`, `.harness/regime/test-tmp/**`, `.harness/regime/lcl-bundle/**`.
  - Paths outside the repo (stdlib, site-packages, `/tmp`, the scratchpad) are allowed except `/scratchpad/restore/`. A refused `__pycache__` read is harmless (importlib treats the `PermissionError` as a cache miss and compiles the source).
  - The decision is a pure function `regime_ref.s5a_verdict(path, mode) -> 'read'|'write'|'outside'|'forbidden'` (no I/O; abspath + realpath, relative to the repo root); the hook only calls it and raises on `'forbidden'`. Tests call the function directly on the real forbidden paths and open only **non-existent** probe paths (R-GUARD), so a mis-installed hook can never read a leak file.
- `oro-apply.json`/`oro-inputs.json` are read only by test R-TERRAIN-ORO and R-SND-SAME, and only the keys `A1`, `A2`, `A3`, `site`, `group`, `times.closest.utc`, `sources.sounding.bestMatch`. They are NWP/DEM-only (frozen oro files) but the allow-list keeps the reads explicit. Their **scene list** is not MODIS-free in membership (it is what survived `fetch-sat.py`'s cover-range skip rule), so these tests print counts only, never scene names or dates.
- **Never opened by people** (tools read them only as the steps below say): `tools/genus-ruler/regime/texture-manifest.json` and `texture-manifest-refetchN.json` (S5b; their `bytes` field is a held per-scene content proxy, L185) — committed without showing diffs (`git diff`/`git show` of these files is never run on screen); `oro-apply.json`/`oro-inputs.json` scene rows.
- Stdout: counts, statuses, sha256 and sounding-derived numbers only (all MODIS-free). G9 (L560-L566) applies: `regime-list.json` and `regime-shift-axes.json` are committed together before any satellite scalar (dev included) — the commit itself is a session step, not a tool step.

### 0.2 Process and determinism
- `python3 -I` only; numpy + Pillow + stdlib; no scipy. Cross-file Python code: `oro_ref.py` is loaded by `load_frozen()` (§1.1), never by path import of the `.pyc`. Every entry script sets `sys.dont_write_bytecode = True` before loading anything, so no `__pycache__` is created under `tools/genus-ruler/{oro,macro,regime}`.
- JSON: `oro_ref.dumps_json` (sort_keys, indent 1, `allow_nan=False`, trailing newline; floats are Python repr, round-trip exact so the TS side parses identical doubles). Every iteration over sets, JSON objects, manifests or file lists is `sorted()`. No wall-clock time in any output (dates come from inputs). Running any command twice on the same inputs gives byte-identical output (R-DET).
- float64 throughout. All times are timezone-aware UTC `datetime`; output strings `%Y-%m-%dT%H:%M:%SZ`; sounding hour keys `%Y-%m-%dT%H:%M` (`oro_ref.hour_key`).
- Environment: `oro_ref.env_record()` (python, numpy, Pillow, machine, numpy SIMD baseline/dispatch) is written into each output's `sources.env`. Current: python 3.13.18, numpy 2.5.3, Pillow 12.3.0, x86_64 `X86_V2`. `SiteCache` recomputes A1 with numpy FFT and raises if it differs from `dem-grids.json` — that is the environment check for the terrain flag.
- No commits. No network in S5a tools (the R10 fetch is a separate frozen script).

### 0.3 Pinned conventions
| item | pin | ruler |
|---|---|---|
| sites | `fetch-sat-times.py SITES` (dev: seoul, kanazawa; held: osaka, busan, shanghai, sapporo, lisbon, denver, sydney, hamburg); must equal `fetch-sounding.py`, `macro/fetch-sat.py` and `oro_ref.sites_table()` (R-SITES) | L144 |
| scene key | `<site>_<YYYY-MM-DD>` with the **mean-solar date**; parse `rsplit('_', 1)` | L146, L150 |
| periods | `p2026` = 2026-06-01..10-31 (all 10 sites); `p2025` = 2025-06-01..10-31 (held only, extension). `p2026spring` in `sat-times.json.gz` is never read | L93, L98, L145, L216 |
| day index | `(date − period start).days`, 0..152 | L363 |
| ISO week (S5b) | `date.isocalendar()[:2]` of the solar date; 2025 and 2026 weeks are different blocks | L92 |
| wind | Open-Meteo from-direction d, speed S (m/s) → u = −S sin d, v = −S cos d (toward east, north) = `oro_ref.wind_to_uv`; time interpolation on components, never on angles | L161, oro L384 |
| cloud fractions | `cloud_cover_low/high` % → fraction `/100.0` | L197, L272 |
| heights | `elevation` = z_sfc (m ASL); Z(p) geopotential height m ASL; zi, LCL m **AGL** | L163, L249, L269 |
| angles | θ_CBL and every θ of this ruler: **axis angle in degrees, math convention** (counter-clockwise from east in the local east–north frame), in [0, 180). 0 = E–W axis, 90 = N–S axis. Compass = (90 − θ) mod 180 | L263, L291, L325 (Q-13) |
| Δθ | axis difference `min(d, 180 − d)` with `d = |a − b| mod 180`, in [0, 90] | L327 |
| sun altitude | `oro_ref.sun_alt_deg(t, lat, lon)` (NOAA series, copy of `ring/solar_util`) at the site coordinates | L245 |
| numbers in outputs | null = NA; floats repr; booleans true/false; regime codes `"NA" "NONE" "DISORG" "ROLL" "CELL"` | L202 |

### 0.4 Paths
| what | path | git |
|---|---|---|
| sounding (2026, shared with oro) | `.harness/oro/sounding.json` + `tools/genus-ruler/oro/sounding-manifest.json` | ignored / old |
| extension sounding (R10) | `.harness/oro/sounding-regime-ext.json` + `tools/genus-ruler/oro/sounding-regime-ext-manifest.json` | ignored / regime FROZEN `files` (L660) |
| CMR pass metadata | `tools/genus-ruler/regime/sat-times.json.gz` | FROZEN `files` (L659) |
| DEM grids | `tools/genus-ruler/oro/dem-grids.json` | old (oro FROZEN) |
| S5a outputs | `tools/genus-ruler/regime/{regime-list.json, regime-shift-axes.json, regime-test.txt}` | working tree |
| test scratch | `.harness/regime/test-tmp/`, `.harness/regime/lcl-bundle/<commit>/` | ignored |
| S5b outputs | `tools/genus-ruler/regime/{power-regime.json, texture-test.txt, anull-table.json, j2-fidelity.json, dev-choice.json, texture-manifest.json, render-index.json, g1-baseline-regime.json}`; images `.harness/regime/sat/`; render densities `.harness/regime/render/` (hashed in `render-index.json`, §3.4); judge `gate-regime-held.json`, `judge.lock` | working tree / ignored |

### 0.5 Build order (S5a)
The ruler fixes the definitions before the single N_R count: §10.1 ③ "정의를 정합니다 … 시어 정의의 원문을 확인합니다 — 셋 다 §0.4 에 적습니다" (L627-L631) comes before ④ "임시 레짐 목록 … 으로 N_R 을 셉니다" (L632-L634); "이 바꿈은 `regime-list.json` 을 만들기 전에만" (L261); "기간 셈은 동결 전 한 번뿐" (L217). So nothing that can change N_R (shear definition, filter-1 variant, code fixes from failing tests) may be settled after `count` has been run.

-1. **Session gates before any `count`** (not tool steps): (a) §10.1 ③ shear source check done and recorded at §0.4 L105 (§O-1); (b) the O-2 decision recorded (§O-2: filter 1 as written, or the UTC-day variant through the §10.1 ⑨ short re-review, allowed at grade "dev 만", L63-L68); (c) the code is final: `count` runs once (L217); a second `count` is allowed only after R10 (L634 "다시 셉니다") and must print the same p2026 number — otherwise stop and report to the session (no choice between two counts).
0. Preconditions checked by the CLI (exit 4 if any fails): (a) `oro/FROZEN.json` exists; (b) its `files` sha256 of `oro_ref.py`, `dem-grids.json`, `fetch-sounding.py`, `sounding-manifest.json`, `oro-geom.py`, `oro-apply.json` equal the files on disk; (c) `oro_ref.py` also equals the constant `ORO_REF_SHA256`; (d) every used CMR query is present (10 sites × 2 satellites × the periods in use) with `hits == nReturned` (L651 "CMR 질의 전부"; true for all 60 [CMR-meta]); (e) `--shear-def zi01|sfc` is given explicitly (no default; must equal what the session recorded at L105 — session gate −1(a)); (f) `--f1-variant solar|solar+utc` is given explicitly (no default; equals the O-2 decision, gate −1(b)); (g) (for `count` and `list` only) `regime-test.txt` exists, its header `regime_ref.py sha256` equals the file on disk, its `shearDef`/`f1Variant` equal the CLI values, its stage is `pre-count` or `full`, and its last line is `ALL PASS n/n`.
0b. `python3 -I tools/genus-ruler/regime/regime-test.py --pre-count --shear-def … --f1-variant …` → `regime-test.txt` (stage `pre-count`): every test of §2 except those that need the real list outputs (R-DATA, R-SCHEMA, the real-file half of R-DET). It never computes or prints N_R. Must be ALL PASS before step 1; a code fix after a failure is made here, before any count.
1. `python3 -I tools/genus-ruler/regime/regime_ref.py count --shear-def … --f1-variant …` — run **once** on the final code. Prints one record line: `COUNT N_R p2026 = n; rule = keep p2026` (or `rule = extension needed (R10)`)`; regime_ref.py <sha256>; shearDef <d>; f1Variant <v>; satTimesSha256 <hex>; soundingFileSha256 <hex>`. Writes nothing. The session copies this line unchanged to §0.4 L108 (m12). (L633, L213-L216)
2. Only if step 1 says "extension needed": R10 once —
   `python3 -I tools/genus-ruler/oro/fetch-sounding.py --sites held --start 2025-06-01 --end 2025-10-31 --out sounding-regime-ext.json`
   (default `--sleep 10` = requests ≥ 10 s apart; manifest name from `--out` → `oro/sounding-regime-ext-manifest.json`; L166-L167, plan L137). Exit 3 = daily 429: **stop and report**; resume after the next 00:00 UTC reset with the same command (site-level resume is built in). Exit 2 = giving up after retries: report. At most this one extension request series per day (shared IP; plan L158-L160). Expected weighted cost ≈ 600 (plan L137 says ≈ 603; 8 × 76.5 = 612 at the measured R5 per-site cost). After 8/8: `count --sounding-ext .harness/oro/sounding-regime-ext.json …` once more (L634) — it must print the same p2026 number and adds `N_R p2026+p2025 = m`; the session appends that line to L108.
3. `python3 -I tools/genus-ruler/regime/regime_ref.py list --shear-def … --f1-variant …` → `regime-list.json` and `regime-shift-axes.json` in one run (exit 3 if the period rule needs the extension and it is missing or not 8/8; L651; same preconditions as step 0). It prints the same `COUNT` line; the session checks that it equals the line at L108 (same code sha, same number) before step 5.
4. `python3 -I tools/genus-ruler/regime/regime-test.py --full --shear-def … --f1-variant …` → `regime-test.txt` (stage `full`; all tests incl. R-DATA, R-SCHEMA, R-DET; exit 0 only if all pass).
5. Session (not a tool): record §0.6 facts in §0.4, then commit the two lists together (L207, L635, G9).

### 0.6 Facts S5a produces for the §0.4 record (this design does not edit the ruler)
(i) N_R per period and the chosen period — the `COUNT` line(s) of §0.5 steps 1–2, copied unchanged (L108; m12); (ii) `regime-shift-axes.json` summary — per site ROLL∧filter-2 pool sizes and the expected self-axis share (L109); (iii) sunset vs pass-time ROLL ratios per site (L114; the sunset ratio is 0 by construction, §1.21); (iv) ROLL share with terrain flag true (L115); (v) shear definition in force and the Santellanes check (L105, §O-1) — recorded **before** `count`; (vi) the O-2 decision and the counts of scenes with a GIBS UTC-day ambiguity (`summary.gibsUtcAmbiguous`, §O-2) — decision recorded before `count`; (vii) the Hamburg dawn/dusk DAY-pass exclusions (Q-3); (viii) for the §10.1 ⑨ short re-review list: the LCL reading Q-11 (it departs from the literal "(T2m·Td2m)" of L269; m3) and the O-2 decision if it is the variant; (ix) if 2025 is added and N_R(p2026+p2025) < 60: the §6.5 사전 예측 line "P1 미결 가능성 큼" (L219; `period.note`; m4); (x) the BOTH-flag facts of Q-2 (m1).

---

## 1. S5a — `tools/genus-ruler/regime/regime_ref.py`

Pure module + CLI. Public functions below each name a ruler line and a test id (§2). No function opens a file except the loaders named in §1.1, §1.4, §1.5, §1.16.

### 1.1 Frozen oro code
- `load_frozen(name, relpath, sha256) -> module`: read the bytes of `tools/genus-ruler/oro/oro_ref.py`; require sha256 = `ORO_REF_SHA256` = `oro/FROZEN.json files["tools/genus-ruler/oro/oro_ref.py"]`; `compile(bytes, abspath, 'exec')`; exec into `types.ModuleType('oro_ref')` with `__file__ = abspath` (oro_ref derives `HERE`/`ROOT` from it). No `.pyc` is read or written, so the code that runs is exactly the frozen bytes. Test R-OLD.
- Used from `oro_ref` (unchanged): `dumps_json`, `dump_json`, `sha256_file`, `sha256_bytes`, `rel`, `install_guard`, `sites_table`, `env_record`, `hour_key`, `parse_hour`, `interp_fallback`, `Sounding`, `load_soundings`, `sounding_source`, `wind_to_uv`, `e_s`, `theta`, `theta_v`, `z_std`, `UNDERGROUND_MARGIN_M`, `RD`, `CP`, `RV`, `sun_alt_deg`, `ref_values`, `SiteCache`, `A1_RMS_M`, `A2_SPEED`, `A3_N2`, `FALLBACK_H`.
- `oro-geom.py` is **not** imported (it would load `oro_ref` a second time through importlib). Its geometry functions are copied verbatim into `regime_ref.py`: `point_in_poly`, `parse_polygons`, `_gc_dist`, `_bearing`, `_midpoint`, `_ns_dist`, `cross_track_km`, `_centroid`, constant `R_EARTH_KM = 6371.0`. Test R-GEOM0 compares each function's source text with `oro-geom.py` (frozen sha `606529d1…`).

### 1.2 Constants (module level, exact values)
```
PERIODS = {'p2026': ('2026-06-01','2026-10-31'), 'p2025': ('2025-06-01','2025-10-31')}       # L93, L145
SAT_ORDER = ('aqua','terra')                       # L147 (Aqua first)
PASS_GAP_S = 1800                                  # L152: next granule start ≤ 30 min after the previous start → same pass
CT_MAX_KM = 430.0                                  # L85, L196 (inclusive)
F2_HIGH_LT = 0.5 ; F2_PRECIP_LE = 0.5              # L197
PL = (1000, 975, 950, 925, 900, 850, 800, 750, 700, 600, 500)    # selector profile levels (Q-9)
UV_LEVELS = (925, 850, 700) ; Z10_M = 10.0          # L255, L254
SUN_MIN = 20.0 ; SW_MIN = 300.0 ; DTHV_MIN = -0.5  # L75 (all ≥)
CAPE_NONE = 1000.0 ; PRECIP_NONE = 0.5 ; LCL_ZI_NONE = 300.0     # L76, L280 (CAPE ≥, precip >, LCL > zi + 300)
LOW_MIN = 0.05 ; LCL_LOW_LT = 3000.0               # L272 (low ≥, LCL <)
ZI_DISORG = 1100.0                                 # L74, L281 (zi <)
U_ROLL = 6.0 ; SHEAR_ROLL = 2e-3                   # L73, L282 (≥)
U_AXIS = 2.0                                       # L77, L264 (|U| < 2 → shear axis)
PARCEL_DTHV = 0.5 ; ZI_CLIP = (100.0, 3000.0)      # L251-L252
MARGIN = {'U6':0.01,'shear':1e-6,'zi1100':1.0,'lclZi300':1.0,'sun20':0.01,'sw300':0.5,
          'dthv':0.001,'cape1000':1.0,'precip05':0.001,'low005':0.0005,'axis2':0.01}  # L78
NR_MIN = 60                                        # L215
SHIFT_U = tuple(range(-45,-9)) + tuple(range(10,46))   # 72 values, L88, L362
SHIFT_WIN = 7 ; SHIFT_MIN_GAP = 10                 # L363
SUNSET_ALT = (-2.0, 8.0) ; SUNSET_DESC_MIN = 30    # L209; oro Q-42 / oro.py SUNSET_*
NONE_SAMPLE = 0.2 ; NONE_SEED = '20261103'         # L180
SHEAR_DEFS = ('zi01', 'sfc')                       # L258 (2판) / L259-L261; no default: CLI --shear-def is required (§0.5 step 0(e), §O-1)
F1_VARIANTS = ('solar', 'solar+utc')               # L152-L153 as written / §O-2 candidate; no default: CLI --f1-variant (§0.5 step 0(f))
GIBS_EDGE_H = 2.0                                  # §O-2: first/last solar day, mid within ±2 h of UTC midnight → gibsAmbiguous null (unknown)
CT_SENS_KM = (300.0, 520.0)                        # §7 L537 arms (inclusive), stored as variants (§1.15)
LCL_M_PER_K = 125 ; LCL_MIN_M = 150 ; LCL_MAX_M = 3500 ; ML_DEPTH_M = 600 ; MAGNUS_A = 17.625 ; MAGNUS_B = 243.04   # cloudSkeleton SK, dewPointC
ORO_REF_SHA256 = '88a600ba7f3df178ca9e46437826e19354f84dd13c9dcd7c4f5e87f9a01576f2'
```

### 1.3 Sites and periods
- `sites() -> {site: (lat, lon, group)}` sorted; R-SITES.
- `site_class(site) -> 'mountain'|'flat'` for the §6.1 report "산악·평지 사이트 따로" (L413): mountain ⇔ A1 (rms h_sub ≥ 100 m from `SiteCache`, §1.16) — denver, osaka, sapporo (held) and kanazawa (dev) [measured, oro L188]; the rest flat. This is the split RULER-oro actually applies (A1, "실제 적용은 §2.6 이 정합니다", oro L240); it is **3 of 8 held**, not the "반반" of L144/L519 (Q-36). Stored per row as `siteClass`.
- `period_of(date) -> 'p2026'|'p2025'|None`.
- Rows exist for: every site × every p2026 date (10 × 153 = 1,530) and, only when the period rule adds 2025, every **held** site × every p2025 date (8 × 153 = 1,224). Dev has no 2025 sounding (L165).

### 1.4 CMR passes, scene time, filter 1 (L143-L154, L85, L196)
All from `sat-times.json.gz` (`queries[]` with `site`, `sat`, `period`, `hits`, `nReturned`, `granules[]` of `time_start`, `time_end`, `day_night_flag`, `polygons`, `solarDate`). Every granule there was returned by a CMR `point=` query, i.e. covers the observer. The loader asserts that every used query (site × sat × period in use) exists exactly once and has `hits == nReturned` (L651; R-CMR).

| fn | spec | test |
|---|---|---|
| `solar_date(t, lon)` | `(t + lon/15 h).date()` — the mean-solar-day window of L150 (UTC start = date 00:00 − lon/15 h) | R-SOLAR (recomputed = stored `solarDate` for all 18,647 granules) |
| `day_granules(doc, site, sat, period)` | granules with `day_night_flag == 'DAY'` only (Q-2). Duplicates by `time_start` (CMR returns two collection versions; 9,267 starts have 2–3 copies whose polygons differ by ≤ 0.001° [CMR-meta]) collapse to one record `{start, end, polygons:[all copies' rings, file order]}`; `time_end` and flag never differ between copies [CMR-meta] (assert). Output sorted by start | R-PASS |
| `group_passes(grans)` | walk by start; a granule joins the current pass iff `start − previous start ≤ 1800 s`, else opens a new pass (start-to-start, same as oro-geom R-G1; Q-4). Pass: `start = min start`, `end = max end`, `mid = start + (end − start)/2` (whole seconds; assert), `solarDate = solar_date(mid, lon)` | R-PASS |
| `passes_by_day(site, sat, period)` | `{solarDate: [pass…]}` keeping only solar dates inside the period. Day passes never straddle solar midnight [CMR-meta: 0 cases] | R-PASS |
| `site_polygon(pass, lat, lon)` | first ring, scanning granules by start and copies in file order, with `point_in_poly(lat, lon, ring)` true → `('pip', ring)`; else the ring with the nearest `_centroid` (great circle) → `('centroid', ring)` (oro-geom R-G7 rule; 110 single-pass days in p2026+p2025 need it [CMR-meta]) | R-CT |
| `cross_track_km(ring, site)` | verbatim oro-geom (track = great circle through the midpoints of the two more east–west edges). All rings are 4 corners + closing vertex [CMR-meta], so `'nonquad'` never occurs; if it did, filter 1 is false (Q-6) | R-CT, R-GEOM0 |
| `scan_axis_deg(ring, site)` | axis of the cross-track (scan) direction at the site, for the §6.1 scan-direction contrast (L410). Track = the `cross_track_km` great circle m1 → m2; P = the point of that great circle closest to the site (signed along-track angle from m1 = `atan2(sin d13·cos(θ13 − θ12), cos d13)`, then destination from m1 on bearing θ12); β = compass bearing of the track at P (`_bearing(P, m2)`, or θ12 when P = m1 to 1e-9 rad; only β mod 180 matters for an axis); scan axis compass = β + 90 → math convention θ = (90 − (β + 90)) mod 180 = (−β) mod 180, normalised like `axis_deg` to [0, 180) (§0.3). Computed on the same ring as `ctKm`; null when `ctStatus ≠ 'ok'` | R-CT-AXIS |
| `pass_info(site, sat, date)` | `{nPasses, passMidUtc, granuleStarts, ctKm, ctStatus, ctPolyHow, scanAxisDeg, filter1, f1Reason, gibsDate, utcDayPasses, gibsAmbiguous, ctSens:{"300":b,"520":b}}`; `filter1 = nPasses == 1 ∧ ctStatus == 'ok' ∧ ctKm ≤ 430.0` (L152-L153, L196), and under `--f1-variant solar+utc` also `gibsAmbiguous is False` (§O-2). `nPasses = 0` → all null, filter1 false, reason `none`. `≥ 2` → `passMidUtc` null, filter1 false, reason `multiPass`; else reason `ct` or `gibs` when false. `gibsDate` = UTC date of `mid`; `utcDayPasses` = number of **other** DAY passes of the same site and satellite (same query) whose mid has that UTC date; `gibsAmbiguous` = true if `utcDayPasses > 0`; else null (unknown) when the solar date is the first or last of the period and `mid` lies within `GIBS_EDGE_H` of a UTC midnight; else false. Under the variant, null counts as ambiguous ("모름 = 뺌") (a neighbour pass of solar 05-31/11-01 is outside the CMR window and could share the UTC day). `ctSens[k]` = `nPasses == 1 ∧ ctStatus == 'ok' ∧ ctKm ≤ k` (same variant clause), for the §7 arms | R-PASS, R-F1, R-GIBS |

Design sanity [CMR-meta, p2026]: filter 1 passes on 478 (Aqua) / 481 (Terra) held site-days, 772 for either satellite (ruler prediction "~800", L225); dev 199. At 300 / 520 km (§7 arms): held Aqua 341 / 565, Terra 342 / 560, either 587 / 870. Hamburg has 96 (Aqua) and 82 (Terra) multi-pass days; in 28 Aqua / 13 Terra of them one of the passes is a dawn (descending-node) or dusk DAY-flag granule (Q-3). GIBS UTC-day sharing (§O-2): Aqua never shares the UTC day of a filter-1 pass with another covering DAY pass (0 in every period); Terra does on 54 of the 294 held p2026 site-days where only Terra passes filter 1 (busan 11, osaka 20, sapporo 23), plus 36 held Terra filter-1 passes on days Aqua also passes (busan 5, osaka 12, sapporo 19); dev p2026 33 of 73 Terra-only (kanazawa 25, seoul 8); held p2025 19 of 304 Terra-only (osaka 5, sapporo 14) + 25.

### 1.5 Sounding access and pass-time interpolation (L161-L172)
| fn | spec | test |
|---|---|---|
| `load_soundings(path)` | `oro_ref.load_soundings` → `{site: oro_ref.Sounding}`; `{}` if absent | R-SND-SAME |
| `interp_na(snd, var, t) -> float|None` | `v, how = oro_ref.interp_fallback(snd.times, snd.series(var), t, snd.index)`; return `v` iff `how ∈ {'exact','linear','fallback2'}`, else None. Equals L170-L171: linear between the bracketing hours ⌊t⌋, ⌈t⌉; a null bracket hour is replaced by the nearest valid hour on that side with `|h − t| ≤ 3 h` (inclusive); one side missing → NA (oro's `'fallback1'` is refused, Q-7) | R-INTERP |
| `uv_na(snd, level, t) -> (u, v)|None` | hourly (u, v) = `wind_to_uv(speed, dir)` valid iff both non-null (`level='10m'` → `wind_speed_10m`/`wind_direction_10m`; p → `snd.wind(p)`), then `interp_na` on u and v separately; None if either is None | R-UV |
| `inputs_at(snd, site, t) -> dict` | the selector input vector (§1.6) at UTC t | R-INPUTS |

Edge: a pass before the file's first hour has a missing side → NA by rule (L170-L171). In the data this happens only for Sydney Terra on the first solar day of each period (mid 2026-05-31T22:52:30Z, 2025-05-31T23:02:30Z) [CMR-meta]; the kanazawa/osaka/sapporo first-day Terra mids are 00:07–00:22 UTC on 06-01 (p2026 00:12:30, 00:12:30, 00:07:30; p2025 00:22:30, 00:22:30, 00:17:30), **inside** the file and linear on 00:00/01:00. No other site, satellite or period has a first-day pass before 00:00 UTC. The symmetric case after the last hour (23:00 UTC of 10-31) does not occur in the data (no pass of the last solar day has its mid at or after 23:00 UTC of 10-31; latest Denver Aqua ≈ 22:58 UTC) and is tested synthetically (R-EDGE). SHF is never read (L173, L267).

### 1.6 Selector input vector (the G7 interface, L555)
```
{"tUtc": s, "site": s, "zSfcM": f|null, "sunAltDeg": f,
 "t2mC": f|null, "td2mC": f|null, "capeJkg": f|null, "blhM": f|null,
 "precipMm": f|null, "swWm2": f|null, "lowFrac": f|null, "highFrac": f|null,
 "wind10": [u, v]|null,
 "levels": [{"p": 1000, "zM": f|null, "tC": f|null, "rhPct": f|null, "u": f|null, "v": f|null}, … one per PL level, p descending]}
```
- Units: °C, %, m ASL, m/s, mm per hour, W/m², J/kg, fraction 0..1. `u`/`v` are present (possibly null) only for p ∈ {925, 850, 700}; null elsewhere.
- **Open-Meteo key map** (the only keys `inputs_at` reads; names as in `fetch-sounding.py VARS`): `zSfcM` ← site-level `elevation`; `t2mC` ← `temperature_2m`; `td2mC` ← `dew_point_2m`; `capeJkg` ← `cape`; `blhM` ← `boundary_layer_height`; `precipMm` ← `precipitation`; `swWm2` ← `shortwave_radiation`; `lowFrac` ← `cloud_cover_low`/100; `highFrac` ← `cloud_cover_high`/100; `wind10` ← `wind_speed_10m`, `wind_direction_10m`; level p ∈ PL: `zM` ← `geopotential_height_{p}hPa`, `tC` ← `temperature_{p}hPa`, `rhPct` ← `relative_humidity_{p}hPa`; p ∈ {925, 850, 700}: `wind_speed_{p}hPa`, `wind_direction_{p}hPa`. **Never read** although present in the file: `surface_pressure` (L239), `sensible_heat_flux` (L173, L267), `freezing_level_height`, `cloud_cover`, `cloud_cover_mid`, the 600/500/250 hPa winds (L242 node list), T/Z/RH above 500 hPa. Test R-VARS (a spy `Sounding` records every key read).
- `highFrac` is a filter-2 input only (§1.15); the selector never reads it.
- `select()` (§1.13) is a pure function of this object. `regime-list.json` stores it per scene so that `blRegime.ts` is tested on exactly these values (G7) and so the judge never re-reads the sounding.

### 1.7 Thermodynamics (L239, L253, L266, L269)
| fn | spec | test |
|---|---|---|
| `profile(inp) -> (kept, na)` | For p in PL: `deep = oro_ref.z_std(p) < zSfc − 500` (oro Q-49 margin). A deep level with any of Z/T/RH null is dropped. Any other level needs Z, T, RH all finite, else NA names `Z{p}`/`T{p}`/`RH{p}`. Kept Z must be strictly increasing with decreasing p, else NA `Zorder` (Q-9) | R-NA, R-DENVER |
| `p_sfc(kept, zSfc) -> hPa` | nodes (Z, ln p) of `kept`; if Z₀ ≤ zSfc < Z_last use the bracketing pair; below the lowest node use the two lowest; at/above the highest use the two highest; ln p linear in z, then exp. Fewer than 2 kept levels → NA `psfc`. `surface_pressure` is never read (L239) | R-PSFC |
| `theta_v_level(T, RH, p)` | `oro_ref.theta_v` (Bolton e_s; q = 0.622e/(p − 0.378e); θ = (T + 273.15)(1000/p)^(RD/CP); θ_v = θ(1 + (RV/RD − 1)q)) | R-THV |
| `theta_v_2m(T2m, Td2m, psfc)` | e = `oro_ref.e_s(Td2m)`, q = 0.622e/(psfc − 0.378e), θ_v = `oro_ref.theta(T2m, psfc)`·(1 + (RV/RD − 1)q). Pressure at 2 m = p_sfc (Q-10) | R-THV |
| `first_level(kept, zSfc)` | lowest kept level with Z > zSfc (L266); none → NA `firstLevel` | R-DENVER |
| `lcl_agl(zSfc, T2m, Td2m, kept) -> m AGL` | verbatim port of `cloudSkeleton.lclAglM` at K0 (115fbe2; file unchanged to HEAD): ThermoInput `{groundM: zSfc, t2mC, td2mC, levels: [{zM: Z, tC: T, pHPa: p}], rhLevels: [{zM: Z, rhPct: RH}]}` in PL order (kept levels). pts = [(0, max(0, T2m − Td2m))] + for each level with 10 < Z − zSfc ≤ 600 and the first rh entry with `|zM − Z| < 1`: (Z − zSfc, max(0, T − dewPointC(T, RH))); `dewPointC`: g = ln(max(1, min(100, RH))/100) + aT/(b + T), Td = bg/(a − g), a = 17.625, b = 243.04; LCL = clamp(mean z + 125·mean dep, 150, 3500), sums left to right (Q-11) | R-LCL, R-LCL-TS |

### 1.8 zi (L248-L253)
`zi_of(inp, kept, thv2m) -> (zi_m, source)`:
- BLH finite → `zi = BLH`, source `blh`, **no clip** (Q-12). BLH ≤ 0 is finite: zi ≤ 0 is carried and handled by the degenerate rules of §1.9.
- else parcel: nodes `[(zSfc + 2, thv2m)] + [(Z, theta_v_level) for kept with Z > zSfc + 2]`, thr = thv2m + 0.5. First segment j with θ_{j+1} > thr (strict): z* = z_j + (z_{j+1} − z_j)(thr − θ_j)/(θ_{j+1} − θ_j); `zi = min(max(z* − zSfc, 100), 3000)`, source `parcel` (or `parcel-clip-lo`/`parcel-clip-hi`). No crossing up to 500 hPa → `zi = 3000`, source `parcel-none`.
- Test R-ZI: BLH 3,500 stays 3,500; BLH 50 stays 50; a hand profile whose crossing height is known in closed form; crossing at 60 m AGL → 100; crossing at 3,400 m AGL → 3,000; no crossing → 3,000; θ exactly = thr at a node is not a crossing.

### 1.9 Wind profile, U_CBL, shear (L254-L262)
- `wind_nodes(inp, kept, zSfc)`: `[(zSfc + 10, V10)] + [(Z(p), V(p)) for p in (925, 850, 700) if p is kept and Z(p) > zSfc + 10]`, increasing Z. Levels with Z ≤ zSfc are underground and never nodes ("덴버는 925·850 hPa 가 땅속이라 Z 로 거릅니다", L256). A level with zSfc < Z ≤ zSfc + 10 is dropped too (Q-14).
- `V_at(nodes, z)`: piecewise linear in z between bracketing nodes; z ≤ first node → V10; z ≥ last node → the last node's V held constant (no extrapolation, no 600/500 hPa wind; Q-15).
- Required winds (NA rule, L172): V10 always; every node level with Z ≤ zSfc + zi, and the first node level above zSfc + zi if one exists. Any of their (u, v) null → NA names `wind10`/`wind{p}` (Q-9). Wind of a node level above that is not required.
- `u_cbl(nodes, zSfc, zi) -> ((u, v), speed, degenerate)`: z_bot = zSfc + 10, z_top = zSfc + zi. If z_top ≤ z_bot: U = V10, degenerate. Else points `[(z_bot, V10)] + [(Z, V) for nodes with z_bot < Z < z_top] + [(z_top, V_at(z_top))]`, trapezoid integral / (z_top − z_bot), per component. `speed = hypot(u, v)` (ROLL tests the magnitude of the mean vector, Q-16).
- `shear(nodes, zSfc, zi, defn) -> (s⁻¹, (Su, Sv), degenerate)` (`defn` required, from `--shear-def`; no default): `zi01` (L258): S = V_at(zSfc + zi) − V_at(zSfc + 0.1 zi), shear = |S|/(0.9 zi). `sfc` (L259 1판 = the reading to adopt if the Santellanes check says "surface to zi", L261): S = V_at(zSfc + zi) − V10, shear = |S|/zi. zi ≤ 0 → (0.0, (0, 0), degenerate). The definition only sets the ROLL shear value (L282); the axis fallback vector is fixed by L264 (§1.10).
- Tests: R-UCBL (constant profile → U = V exactly; profile linear in z → U = (V(z_bot) + V(z_top))/2 to 1e-12; Denver nodes = {V10, 700}; zi above Z700 → V(z_top) = V700; zi ≤ 10 → V10), R-SHEAR (hand: zSfc 0, V10 (3, 0), 925 node at 1,000 m (8, 0), zi 1,000 → zi01 = (8 − 3.4545…)/900 = 5.0505e-3 s⁻¹, sfc = 5e-3; zi 0 → 0).

### 1.10 θ_CBL (L263-L264, L80)
- `axis_deg(u, v)`: `a = degrees(atan2(v, u)) % 180.0`; if `a >= 180.0` then `a = 0.0` (−1e-17 % 180 rounds to 180.0); returns [0, 180).
- `theta_cbl(U, S01)`: |U| ≥ 2 → (`axis_deg(U)`, `wind`); else |S01| > 0 → (`axis_deg(S01)`, `shear`); else (0.0, `none`). **S01 is always the L264 vector** V_at(zSfc + zi) − V_at(zSfc + 0.1 zi), whatever `--shear-def` (L264 writes the vector out; L261 changes the shear definition of L258, not the axis rule — Q-33). zi ≤ 0 → S01 = (0, 0).
- No hemisphere offset (the app's `rollDirectionDeg` −15° is not used; L80). From/toward does not matter for an axis.
- Test R-AXIS: toward east → 0; toward north → 90; from 315° (toward SE) → 135°; from 45° (toward SW) → 45°; |U| = 1.999 → shear axis; |U| = 2.0 → wind axis; zero vectors → 0, `none`; wrap at −1e-17; a weak-wind profile run with `shear_def='sfc'` and `'zi01'` gives the same θ (the zi01 vector) while the shear values differ.

### 1.11 Convective proxy and low cloud (L75, L265-L266, L272)
- `dThv = theta_v_2m − theta_v_level(first_level)` (K). `convective = sunAltDeg ≥ 20 ∧ swWm2 ≥ 300 ∧ dThv ≥ −0.5` — all three (Q-17).
- `lowCloud = lowFrac ≥ 0.05 ∧ lcl < 3000`.

### 1.12 NA rule (L172, L270, L279)
Required (NA if any is NA, names collected in this fixed order and stored sorted): `zSfcM`, `t2mC`, `td2mC`, `precipMm`, `swWm2`, `lowFrac`, `wind10`; the profile of §1.7 (deep levels excepted); `psfc`, `firstLevel`; the winds of §1.9 (evaluated only once zi exists). Not required: `capeJkg` (null → condition skipped, `capeSkipped: true`, L270), `blhM` (null → parcel), `highFrac` (filter 2 only), any wind not listed in §1.9. `sunAltDeg` is always computed.

### 1.13 `select(inp, shear_def, variant='main') -> dict` — the tree (L276-L283; `shear_def` required)
Order: compute what §1.12 requires; if anything is NA → `regime = 'NA'` (θ null). Else:
1. `NONE` if ¬convective ∨ lcl > zi + 300 ∨ ¬lowCloud ∨ (cape is not None ∧ cape ≥ 1000) ∨ precip > 0.5;
2. `DISORG` if zi < 1100;
3. `ROLL` if speed ≥ 6 ∨ shear ≥ 2e-3;
4. `CELL`.
Output: `{regime, na:[…], thetaCblDeg, axisSource, zi, ziSource, pSfcHPa, thetaV2mK, thetaV1K, firstLevelP, dThvK, lclM, convective, lowCloud, capeSkipped, ucbl:[u,v], ucblSpeed, shear, shearVec:[u,v], degenerate:{ucbl, shear}, nodes:[[z,u,v]…], margins:{…}, nearBoundary}`. θ_CBL is computed for every non-NA scene (NONE included) so that shift axes and reports have it; only ROLL uses it. Tests R-TREE (each branch, and precedence NA > NONE > DISORG > ROLL > CELL), R-EQ (every threshold exactly at its value: U 6.0 → ROLL; zi 1100 → not DISORG; LCL − zi = 300 → not NONE; sun 20.0, SW 300, dThv −0.5 → convective; CAPE 1000 → NONE; precip 0.5 → not NONE; low 0.05 → present; LCL 3000 → no low cloud).

### 1.14 Boundary-margin flags (L78, G7 L555)
`margins(res)`: for each key k of `MARGIN` a boolean `|x − threshold| ≤ MARGIN[k]` on the reference value — U6: ucblSpeed vs 6; shear vs 2e-3; zi1100: zi vs 1100; lclZi300: (lcl − zi) vs 300; sun20; sw300; dthv: dThv vs −0.5; cape1000 (false when CAPE skipped); precip05: precip vs 0.5; low005: lowFrac vs 0.05; axis2: ucblSpeed vs 2. `nearBoundary = any(flags)`. NA scenes carry no flags. The flags are computed for every non-NA scene, whichever condition decided it (Q-18). LCL < 3 km and the filter-2 thresholds have no §0.3 margin and get none. Test R-MARGIN (inside at ±margin/2 → true; at ±2·margin → false; for every key).

### 1.15 Filter 2 and the scene's satellite (L147, L197)
- `filter2(inp) -> True|False|None`: None if `highFrac` or `precipMm` is NA; else `highFrac < 0.5 ∧ precipMm ≤ 0.5`. None counts as not passing (Q-19).
- Scene satellite: `aqua` if Aqua's `filter1 ∧ filter2 is True` at Aqua's pass time; else `terra` under the same test at Terra's pass time; else no scene (`excluded = 'filter1'` if neither satellite passed filter 1, else `'filter2'`). The regime and all scene fields use the chosen satellite's pass time.
- The **other** satellite of the same day is evaluated too (pass info, filter 2, regime, θ_CBL) and stored under `other` — report-only (L148) and the fetch list's "그날 다른 위성의 장면" (L179).
- **Cross-track arms** (§7 L537 "가로 거리 ≤ 300 / 520 km"): the same satellite rule with `ctSens["300"]`/`ctSens["520"]` in place of the 430 km clause gives `variants.ct300`/`variants.ct520` = `{sat, excluded, passUtc, regime, thetaCblDeg}` per row (regime and θ at the variant satellite's pass time; reused from `passes`/`other` when the pass is the same). The 520 km arm can pick Aqua at 430–520 km over Terra, or create a scene where the main rule has none, so it needs images outside the main list (`fetch.ct520`, §1.19; Q-37).
- Tests R-F2, R-SAT, R-VARIANT (synthetic: Aqua at 480 km + Terra at 200 km → main `terra`, ct520 `aqua`, ct300 `terra`; Aqua at 350 km → main `aqua`, ct300 `terra` or none).

### 1.16 Terrain flag (L229-L232, oro L319-L321, oro L514)
`terrain(site, t, osnd, cache, dg)` for every row with a scene pass time:
- A1 = `cache.get(site)['a1']` from `oro_ref.SiteCache(dem-grids.json)` (recomputes h_sub and raises if A1 ≠ `a1RmsM`), ok = A1 ≥ `A1_RMS_M` (100 m). True only at denver, kanazawa, osaka, sapporo [measured, oro L188].
- REF = `oro_ref.ref_values(osnd, t, dg['sites'][site]['zRefM'], lat, None, None)` (ring values are not needed for A2/A3).
- `usable = not REF['refEmpty']`; A2 ok = usable ∧ speedRef ≥ 5 (`A2_SPEED`); A3 ok = usable ∧ N2 ≥ 1e-5 (`A3_N2`) — the two predicate lines of `oro_ref.evaluate_scene`, copied.
- `flag = A1.ok ∧ A2.ok ∧ A3.ok`. Stored: `{a1RmsM, a1, speedRef, a2, N2, a3, refEmpty, missing, flag}`.
- Interpolation inside `ref_values` is oro's (one-sided fallback allowed), not §2.2's — "the same function" (Q-20). The flag is computed even when the regime is NA.
- Tests R-TERRAIN (synthetic), R-TERRAIN-ORO (for all 145 oro scenes at oro's `closest` time, A1/A2/A3 equal `oro-apply.json`; prints `n equal / n` only, never a scene name, §0.1).

### 1.17 N_R and the period rule (L212-L220)
- `n_r(rows, period)` = number of rows with group `held`, that period, a scene satellite, regime `ROLL`. No satellite value is involved.
- Rule: `N_R(p2026) ≥ 60` → periods `[p2026]`. Else periods `[p2026, p2025]`; this needs the extension sounding with all 8 held sites, else `list` exits 3 (L651). With 2025 added, report `N_R(p2026+p2025)`; if still < 60 set `period.note = "P1 미결 가능성 큼"` (L219). The rule is evaluated once per `list` run on the same code; `count` prints the same p2026 number.
- `regime-list.json.period = {chosen, NR:{p2026, p2026+p2025|null}, threshold: 60, extension:{used, manifestSha256, sites}, note}`. Test R-NR.

### 1.18 `regime-list.json` (L200-L203)
```
{"schema":"regime-list/1",
 "sources":{"satTimesSha256":hex, "fetchSatTimesSha256":hex, "demGridsSha256":hex, "oroFrozenSha256":hex,
            "code":{"regime_ref.py":hex, "oro_ref.py":hex, "oro-geom.py":hex, "fetch-sat.py":hex},
            "sounding":{"p2026": oro_ref.sounding_source(…), "p2025": …|null},
            "regimeNulls":{"p2026":{"<site>":{"<key>":n}}, "p2025":…|null},   # m5: null counts of every key of the §1.6 map,
                                                                           # counted on the hourly arrays and asserted = manifest `nulls`
            "env":{…}},
 "constants":{…§1.2…}, "shearDefinition":"zi01|sfc" (from --shear-def), "f1Variant":"solar|solar+utc" (from --f1-variant),
 "truthInstrument":"aqua",
 "period":{…§1.17…},
 "scenes":{"<site>_<date>":{
    "site":s, "date":s, "group":"dev|held", "siteClass":"mountain|flat", "period":"p2026|p2025",
    "passes":{"aqua":passInfo+{"filter2":b|null,"highFrac":f|null,"precipMm":f|null}, "terra":…},
    "sat":"aqua|terra"|null, "excluded":null|"filter1"|"filter2",
    "passUtc":s|null, "crossTrackKm":f|null, "sunAltDeg":f|null,
    "inputs":{…§1.6…}|null, "regime":s|null, "thetaCblDeg":f|null, "axisSource":s|null,
    "derived":{…select() output without inputs…}|null, "na":[s…], "margins":{…}, "nearBoundary":b,
    "terrain":{…§1.16…}|null,
    "other":{"sat":s, "filter12":b, "regime":s|null, "thetaCblDeg":f|null}|null,
    "sens":{"blhOnly":s|null, "u850":s|null, "ed1":s|null, "u850Theta":f|null, "ed1Theta":f|null}|null,
    "variants":{"ct300":{"sat","excluded","passUtc","regime","thetaCblDeg"}, "ct520":{…}},
    "fetch":{"primary":b, "other":b, "noneSample":b, "ct300":b, "ct520":b}}},
 "summary":{"counts":{"<group>/<period>":{"rows","f1Aqua","f1Terra","f1Either","scene":{"aqua","terra"},
            "excluded":{"filter1","filter2"},"regime":{"NA","NONE","DISORG","ROLL","CELL"},"naNames":{…},
            "nearBoundary","capeSkipped","parcelZi"}},
            "NR":{…}, "rollTerrain":{"held":{"n","terrainTrue","share"},"dev":{…}},
            "perSiteRoll":{…}, "f1Reasons":{"multiPass","ct","gibs","none"},
            "gibsUtcAmbiguous":{"<group>/<period>":{"aqua":{"true","null"},"terra":{"true","null"},
                                "scene":{"true","null"},"other":{"true","null"}}},   # filter-1 passes; scene = chosen sat
            "fetchImages":{"primary","other","ct300","ct520","union"},
            "sunset":{…§1.21…}}}
```
- Every count in `summary` is recomputable from `scenes` (R-SCHEMA). No field depends on any satellite value.

### 1.19 Fetch flags and the NONE sample (L178-L180)
- `fetch.primary` = scene exists ∧ (regime ∈ {DISORG, CELL, ROLL} ∨ `noneSample`).
- `fetch.other` = regime ∈ {DISORG, CELL, ROLL} ∧ the other satellite passes filters 1·2 at its own pass time.
- `fetch.ct300`/`fetch.ct520` = the variant has a scene ∧ the variant regime ∈ {DISORG, CELL, ROLL} ∧ its image `<site>_<date>_<variant sat>` is not already in the list by `primary`/`other` (Q-37). The image list is the union of the four flags, one file per (site, date, sat).
- Under `--f1-variant solar+utc` the same filter-1 clause applies to `fetch.other` and the variants (§O-2).
- `noneSample`: per group (dev, held), over scenes with regime NONE (all periods in use), order keys by `sha256("20261103:" + key)` hex, take the first k = ⌊0.2n + 0.5⌋ (Q-21). NA scenes are never fetched.
- Test R-SAMPLE (k exact; reproducible; independent of dict order).

### 1.20 `regime-shift-axes.json` and the shift-day pick (L204-L206, L359-L366)
- Scenes i = rows with group `held`, a scene satellite, regime `ROLL` (filters 1·2 hold by construction). For every day d of i's period (all 153, including i's own day), at `t_d = t_i + (d − day_i)·86400 s` (the same UTC clock time, Q-22): `inputs_at` → `select` → regime, θ_CBL, and `filter2`. Filter 1 is not applied on shift days (L362).
```
{"schema":"regime-shift-axes/1",
 "sources":{"regimeListSha256":hex, "code":{"regime_ref.py":hex}, "env":{…}},
 "constants":{"shiftU":[…72…], "window":7, "minGap":10},
 "periods":{"p2026":{"start","end","nDays":153}, …},
 "scenes":{"<site>_<date>":{"site","date","period","sat","passUtc","dayIndex",
           "days":{"regime":[s×N], "filter2":[b|null×N], "thetaCblDeg":[f|null×N]},
           "pool":[d…]   # days with regime ROLL ∧ filter2 True
          }},
 "summary":{"perSite":{"<site>":{"nScenes","poolMedian","selfAxisShareExpected"}}}}
```
- `shift_pick(scene, u) -> d|None` (pure; used by `regime.py` S5b and by `power-regime`): `find(w)` = among pool days d with |d − (day_i + w)| ≤ 7 and |d − day_i| ≥ 10, the one minimising (|d − (day_i + w)|, d) (nearest, then earlier); return `find(u)`, else `find(−u)`, else None (= keep own θ_CBL). Days outside the period never exist in the pool ("같은 기간").
- `selfAxisShareExpected` (§0.4 L109) = mean over the site's scenes of the share of the 72 u values for which `shift_pick` returns None.
- Tests R-SHIFT (hand table: exact hit; window edge 7 in, 8 out; gap 9 out, 10 in; tie → earlier; −u fallback; own-axis fallback; other-period days absent), R-SHIFT-SELF (each scene's own-day entry equals its `regime-list` regime, θ and filter 2, to the bit).

### 1.21 Sunset ratios (m10, L208-L210)
Per site and period in use, stored in `summary.sunset`:
- `evening`: every sounding hour on the hour (raw hours of the file, interpolation only where §2.2 needs it) with `−2 ≤ sun_alt ≤ 8` and descending (`sun_alt(t) < sun_alt(t − 30 min)`) — the rule of oro Q-42 / `oro.py evening()` (Q-23), **hand-coded** in `regime_ref.py` from the constants `SUNSET_ALT`, `SUNSET_DESC_MIN` with `oro_ref.sun_alt_deg`; `oro.py` is not imported or opened (it is not on the §0.1 allow-list). `{n, nNA, nROLL, frac = nROLL/(n − nNA)}`.
- `morning`: same with ascending (report).
- `pass`: scenes of that site (scene satellite chosen) `{n, nNA, nROLL, frac}`; `passAll`: every Aqua single pass time regardless of filters (report).
- The sunset ROLL ratio is **0 by construction**: convection needs sun ≥ 20° (L75), so every non-NA sunset hour is NONE. The value is still computed and shown before J4 (L471); R-SUNSET asserts it, so a non-zero value would mean a bug.

### 1.22 Sensitivity selector variants (§7 L529-L532; stored now, used by the judge)
`select(inp, shear_def, variant)` with: `blhOnly` (BLH null → `"NA*"` = out of that arm; else main), `u850` (U_CBL := V(850) as given, underground or not — "지금 앱이 가진 정보"; shear and zi as main), `ed1` (1판, 103aa7a §3.1: U_CBL = plain vector mean of V10 and the levels with zSfc < Z ≤ zSfc + zi among 925/850/700, or of V10 and the first level above ground if none; shear = |V(zSfc + zi) − V10|/zi). The SHF arms (L528) need model-specified requests that were not fetched → `'못 잼'` unless fetched before freeze (plan L153 "선택"). Test R-SENS.

### 1.23 CLI
```
python3 -I tools/genus-ruler/regime/regime_ref.py count --shear-def zi01|sfc --f1-variant solar|solar+utc
                                                       [--sounding .harness/oro/sounding.json] [--sounding-ext .harness/oro/sounding-regime-ext.json]
                                                       [--sat-times tools/genus-ruler/regime/sat-times.json.gz]
                                                       [--test-record tools/genus-ruler/regime/regime-test.txt]   # precondition 0(g); R-PRECOUNT points it at test-tmp copies
python3 -I tools/genus-ruler/regime/regime_ref.py list  --shear-def … --f1-variant … [--sounding …] [--sounding-ext …] [--test-record …]
                                                       [--out tools/genus-ruler/regime/regime-list.json] [--axes-out tools/genus-ruler/regime/regime-shift-axes.json]
python3 -I tools/genus-ruler/regime/regime_ref.py summary   # prints the summary counts of the committed files (shearDef/f1Variant read from the list)
```
`--shear-def` and `--f1-variant` have no default (missing → exit 2). Exit codes: 0 ok; 2 bad argument; 3 extension needed and missing/partial; 4 precondition (§0.5 step 0) failed. Stdout: the `COUNT …` record line (§0.5 step 1; the session copies it to L108), `NR …`, `WROTE <path> sha256 <hex>` lines only. `count` writes no file.

---

## 2. S5a — `tools/genus-ruler/regime/regime-test.py` → `regime-test.txt`
Header lines `regime_ref.py sha256 <hex>`, `regime-test.py sha256 <hex>`, `stage pre-count|full`, `shearDef`, `f1Variant`; then one line per test: `id PASS|FAIL detail`; last line `ALL PASS n/n` or `FAIL k/n`. Deterministic; synthetic data in `.harness/regime/test-tmp/`. Stages (§0.5): `--pre-count` runs every test except R-DATA, R-SCHEMA and the real-file half of R-DET (none of them computes or prints N_R); `--full` runs all. `--emit-vectors <path>` writes the synthetic G7 vectors with expected outputs (for the post-freeze `blRegime` unit test). Details print counts, statuses and hashes only — never an oro scene name (§0.1).

| id | pins | criterion |
|---|---|---|
| R-OLD | §1.1, §0.5 step 0 | `oro_ref.py`, `dem-grids.json`, `fetch-sounding.py`, `sounding-manifest.json`, `oro-geom.py`, `oro-apply.json` sha256 = `oro/FROZEN.json`; `ORO_REF_SHA256` equal; module executed from bytes |
| R-GEOM0 | §1.1, §1.4 | each copied function's source text = `oro-geom.py`'s |
| R-SITES | §0.3 | four site tables identical (names, lat, lon, group) |
| R-GUARD | §0.1 | (1) pure `s5a_verdict(path, 'r')` (no I/O) on the real forbidden paths `tools/genus-ruler/macro/jobs-macro.json`, `.harness/macro/sat/<any>.png`, `.harness/regime/sat/<any>.png`, `tools/genus-ruler/regime/S5-design.md`, `tools/genus-ruler/regime/texture-manifest.json` → `'forbidden'`; allow-list paths → `'read'`/`'write'`; (2) in a subprocess with the guard installed, `open()` only **non-existent** probe paths under forbidden prefixes (`.harness/regime/sat/__probe__.png`, `.harness/macro/sat/__probe__.png`, `tools/genus-ruler/macro/__probe__.json`) → `PermissionError` (a `FileNotFoundError` = FAIL: the hook did not run); (3) allowed paths open. No real forbidden file is ever opened by the test |
| R-PRECOUNT | §0.5 | `count`/`list` without `--shear-def` or `--f1-variant` → exit 2; with a `regime-test.txt` whose `regime_ref.py sha256` differs, or whose last line is not `ALL PASS`, → exit 4 (run on copies in test-tmp) |
| R-CMR | §1.4 | the 40 used queries (10 sites × 2 sats × p2026, p2025) present once each, `hits == nReturned`; a synthetic file with a missing query or `hits ≠ nReturned` → exit 4 |
| R-SOLAR | §1.4 | recomputed solar date = stored `solarDate` for every granule |
| R-SAT-SUM | §0.4 L99 | held DAY∪BOTH site-days by month (fetch-sat-times summary semantics) p2026: Aqua min 239 max 248, Terra 228..247 |
| R-PASS | §1.4 | synthetic granules: consecutive 5-min → 1 pass; start gap 1,800 s joins, 1,801 s splits; duplicates collapse; NIGHT/BOTH ignored; 0/1/2 passes per solar day; window edges for lon −104.99 and 151.21 (Sydney Terra 09:00 LMST = previous UTC date); mid = (start + end)/2 |
| R-CT | §1.4 | synthetic meridian quad: site 430.0 km off-track → filter1 true, 430.5 → false; `pip` and `centroid` branches; `ctSens` at 300.0/520.0 inclusive |
| R-CT-AXIS | §1.4 | meridian quad (track N–S) → `scanAxisDeg` 0 (scan E–W); a quad whose track bearing is 45° (NE) → 135; track bearing 135° → 45; result in [0, 180) |
| R-F1 | §1.4 | single pass ∧ ct ≤ 430 ↔ filter1 on synthetic cases; under `solar+utc` also ¬gibsAmbiguous |
| R-GIBS | §1.4 | synthetic: a second covering DAY pass with the same UTC date of mid → `utcDayPasses` 1, `gibsAmbiguous` true; a pass on the next UTC date → false; first/last solar day with mid within 2 h of UTC midnight → null; Aqua real data: 0 true in every period [CMR-meta] |
| R-VARS | §1.6 | a spy `Sounding` records the keys `inputs_at` reads: exactly the §1.6 map; none of the never-read keys |
| R-SND-SAME | §1.5 | `sounding_source(sounding.json)` per-site `hourlySha256` = `oro-inputs.json sources.sounding.bestMatch.sites[*].hourlySha256` (same file as oro); `regimeNulls` recomputed from the hourly arrays = manifest `nulls` for every mapped key |
| R-INTERP | §1.5 | = `interp_fallback` where both sides exist; one side → None; exact hour; null bracket hour replaced within 3 h; 3 h 00 m in, 3 h 01 m out |
| R-UV | §1.5 | 350°/10° at 5 m/s, midway → toward south (v < 0), speed 4.92…; null direction → None |
| R-INPUTS | §1.6 | schema, units (% → fraction), null placement |
| R-PSFC | §1.7 | two-level hand value; std-atmosphere nodes (Z = `z_std(p)`) → p_sfc within 0.05 hPa of the inverse of `z_std`; extrapolation below 1000 hPa; Denver bracket 850/800 |
| R-THV | §1.7 | hand values of θ_v (level and 2 m) to 1e-9 K |
| R-LCL | §1.7 | hand values: surface only; with one level at 300 m AGL; level at exactly 10 m and 600 m AGL (10 excluded, 600 included); clamps 150/3500 |
| R-LCL-TS | §1.7 | esbuild 0.28.2 bundle of `cloudSkeleton.ts` from `git show 115fbe2:` into `.harness/regime/lcl-bundle/115fbe2…/` — a closed-world folder with empty `tsconfig.json` and `package.json` (`{}`), as `oro/oro-base.mjs` build note 1, else esbuild walks up to the repo `tsconfig.json` (strict → "use strict") — run under node: `lclAglM` on 500 synthetic ThermoInputs = Python port, |Δ| ≤ 1e-9 m. Also asserts `cloudSkeleton.ts` is byte-identical between 115fbe2 and the G1 baseline commit (K0, L666) once that commit exists (until then: = HEAD); if not, the bundle is made from the G1 baseline commit. Missing node/esbuild → FAIL (not skip) |
| R-ZI | §1.8 | listed in §1.8 |
| R-UCBL, R-SHEAR | §1.9 | listed in §1.9 |
| R-AXIS | §1.10 | listed in §1.10 |
| R-TREE, R-EQ | §1.13 | listed in §1.13 |
| R-NA | §1.12 | each required input set null alone → NA with that name; CAPE null → not NA, `capeSkipped`; BLH null → parcel, not NA; deep-underground null → not NA; wind of a non-required level null → not NA; wind of a node level null → NA; one-sided interpolation → NA |
| R-MARGIN | §1.14 | listed in §1.14 |
| R-DENVER | §1.7–§1.13 | synthetic Denver sounding (z_sfc 1,597 m; Z925 760, Z900 990, Z850 1,480, Z800 1,960, Z700 3,150 …; full hourly arrays through `inputs_at`): 925/900 deep, 850 underground but required; p_sfc in (800, 850); first level 800; nodes {V10, 700} for zi 2,000; NA when Z850 is null; one ROLL and one CELL case with hand regimes |
| R-SYDNEY | §1.4–§1.13 | synthetic Sydney sounding/passes: Terra pass on solar 06-15 lands on UTC 06-14 and interpolates there; Aqua 06-21 at 15:10 LMST has sun < 20° → NONE whatever the rest (L37); winds from 315° → θ 135° = the same as for a northern site with the same winds (no offset, L80); the 06-01 Terra pass before the file start → NA |
| R-EDGE | §1.5 | synthetic time after the file's last hour → NA; real sydney first-day Terra (p2026; p2025 when the extension is present) → NA; real kanazawa/osaka/sapporo first-day Terra → **not** NA (linear on 00:00/01:00 of 06-01); no other real first-day pass lies before the file's first hour |
| R-F2, R-SAT | §1.15 | high 0.5 fails, 0.49999 passes; precip 0.5 passes, 0.5001 fails; NA → None → not passing; Aqua preferred; Terra fallback; neither → excluded with reason |
| R-TERRAIN | §1.16 | synthetic site/sounding: flag = A1 ∧ A2 ∧ A3; refEmpty → false |
| R-TERRAIN-ORO | §1.16 | 145 oro scenes: recomputed A1, A2, A3 (ok and values) = `oro-apply.json`; detail = `n equal / n` only, no scene name or date (§0.1) |
| R-NR | §1.17 | synthetic lists: 59/60/61 ROLL; dev and NONE not counted; ext missing/partial → exit 3; ≥ 60 → no 2025 rows |
| R-SAMPLE | §1.19 | k = ⌊0.2n + 0.5⌋ per group, stable order |
| R-SHIFT, R-SHIFT-SELF | §1.20 | listed in §1.20 |
| R-SUNSET | §1.21 | hand cases of the hand-coded rule (alt −2.0 and 8.0 included, −2.01 and 8.01 excluded; descending vs ascending against t − 30 min) on 3 sites × 10 days; every non-NA evening hour is NONE. `oro.py` is not imported |
| R-SENS | §1.22 | hand cases per variant (incl. ed1 "no level in layer" branch) |
| R-SCHEMA | §1.18 | required keys; summary recomputed from rows; fetch flags consistent (union of the four flags = one file per (site, date, sat)); `shearDefinition`/`f1Variant` equal the CLI values |
| R-DET | §0.2 | `list` twice into test-tmp → byte-identical; shuffled JSON key order of inputs → same output |
| R-DATA | data | runs `list` into test-tmp and compares with the working-tree files (byte-identical); prints held/dev counts (MODIS-free) |

---

## 3. S5b — specifications (built later, before freeze)

Order (L624-L625, L636-L646, plan L107-L109): **G1 baseline commit first** (S1 tail: 115fbe2 + ece32b1 + G1 measurement tools only, no app code; §10.1 ① "어떤 기준·해시보다 먼저" — K0 = that commit, L545, L666; it does not exist yet, plan L87) → `power-regime.json` → `texture.py`/`texture-test.py` phase A → `render-tile.mjs` (K0 bundle built from the G1 baseline commit; the bundle sha256 and the commit hash go into `render-index.json` `sources`) → K0/C4 render densities → `texture-test.py` phase B (r(a), ΔI_mech) → J2 (`j2-fidelity.json`) → `fetch-texture.py` (dev·held, after the list commit) → dev scalars → `dev-choice.json` → offset renders at the chosen a (§3.4) → `render-index.json` complete → `g1-baseline-regime.json` measured in a worktree of the G1 baseline commit (its two ROLL jobs need the committed list, §3.6). All S5b Python files load `regime_ref.py` from its path (importlib, `sys.dont_write_bytecode = True` first) and **never call `oro_ref.install_guard()`** (its frozen deny list contains `^\.harness/regime/sat`, which would block the judge). Instead `regime_ref.install_guard_s5b(contexts)` (to be added in S5b, same file): `.harness/regime/sat/*.png` may be opened only inside `allow('png-hash')` (raw bytes → sha256, no decode), `allow('png-dev')` (dev scenes only; the scene key must be a dev site) or `allow('png-judge')` (held; requires `tools/genus-ruler/regime/judge.lock` to exist at that moment, like oro C2). Everything of §0.1's deny list stays denied. As in S5a, the decision is a pure function `s5b_verdict(path, mode, context, lock_present, sat_dir)` (no I/O) and the hook only calls it; `sat_dir` is a parameter so tests can point it at `.harness/regime/test-tmp/sat/` holding a **synthetic** PNG (T-GUARD5B) — no test ever opens a real image under `.harness/regime/sat/`.

### 3.1 `fetch-texture.py` (L175-L193, G9 L565)
- Inputs: committed `regime-list.json` (refuses if its sha256 ≠ the one in `regime-shift-axes.json` or if git shows either file uncommitted — they must be committed first, L207); `oro/FROZEN.json` present (oro freeze, L182).
- List: every scene with `fetch.primary` (its `sat`), `fetch.other` (the other satellite) and `fetch.ct300`/`fetch.ct520` (the variant satellite, §1.19, Q-37); one file per (site, date, sat), name `<site>_<date>_<sat>.png` in `.harness/regime/sat/`. `TIME` for a variant image = that pass's `gibsDate`.
- Request: GIBS WMS 1.3.0 `https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS=MODIS_{Aqua|Terra}_CorrectedReflectance_TrueColor&CRS=EPSG:4326&BBOX={lat−dlat},{lon−dlon},{lat+dlat},{lon+dlon}&WIDTH=384&HEIGHT=384&FORMAT=image/png&TIME={gibsDate}` with dlat = 48/111.32°, dlon = dlat/cos φ (L177; same axis order and `%.5f` as `macro/fetch-sat.py wms_url`). `TIME` = UTC date of the pass mid (`passes[sat].gibsDate`, Q-24).
- Never decodes, never opens the saved file for reading. sha256 of the response bytes in memory. Sequential, ≥ 0.5 s between requests; 429/5xx → wait 60 s, 3 failures → stop, exit 2, resume next hour from cache (files present with manifest sha); after 3 runs a scene still missing is listed by name and excluded (L188-L189).
- Manifest `texture-manifest.json` = `{schema, sources:{regimeListSha256, code}, scenes:{name:{sha256, bytes, http}}, failed:[names], counts}` — name, sha256, size, HTTP status only (L185; the URL is rebuilt from `regime-list.json`; a 200 whose `Content-Type` is not `image/png` is a failed attempt, not stored). `bytes` is written but never printed, summarised or compared (size follows content; Q-25); for the same reason people never open the manifest files and they are committed without showing a diff (§0.1). Refetch never overwrites: `texture-manifest-refetchN.json` (L191).
- Stdout: `FETCH n ok k failed m` only. Test (in `texture-test.py`): URL builder hand value; manifest writer refuses to overwrite.

### 3.2 `texture.py` (L313-L344; same code for satellite and render)
| fn | spec (pins to choose at build are marked ▸) |
|---|---|
| `load_sat(path) -> float64 (384,384,3)` | Pillow RGB /255; row 0 = north, col 0 = west (WMS); only under `png-dev`/`png-judge` |
| `empty250(rgb)` | `max(R, G, B) < 0.02` — the code of `macro/fetch-sat.py` L63 (`empty = (a.max(axis=2) < 0.02)`), the `old` mask source (L665); its docstring's "전부 0" (L12) is the prose for the same mask. L198 does not define empty (Q-32) |
| `to500(rgb, empty)` | 2×2 mean → (192,192,3); a 500 m pixel is empty if ▸ any of its four 250 m pixels is empty (Q-26). VIIRS 3×3 → 750 m is not used (no VIIRS, L97) |
| `mask(rgb500, thr=0.45, kind='min')` | `min(R,G,B) > thr` (strict; RULER-macro, `fetch-sat.py WHITE_T`). Report/sensitivity paths named now (L535-L536): `thr ∈ {0.40, 0.50}`; `kind='R'` = R channel only (> thr) |
| `cf`, `emptyFrac` | cf = mask mean over non-empty pixels; filter 3 = emptyFrac < 0.05 ∧ 0.05 ≤ cf ≤ 0.8 (L198) |
| `spectrum(m)` | empty pixels filled with cf; subtract mean; ▸ periodic Hann h(i) = 0.5(1 − cos 2πi/N) both axes; P = |fft2|²; k_east = 2π·fftfreq(N, 0.5 km) on columns, **k_north = −2π·fftfreq(N, 0.5 km) on rows** (row 0 = north) so θ is in the §0.3 east–north math convention |
| `aniso(P)` | band 2 ≤ 2π/|k| ≤ 12 km (inclusive); J = Σ P k kᵀ/|k|²; `eigh`; A = λ₁/λ₂ (λ₂ = 0 → A null); θ = (axis of e₁) + 90 mod 180; Q = ((λ₁ − λ₂)/(λ₁ + λ₂))(cos 2θ, sin 2θ) (L324-L327) |
| `spacing(P)` | λ_s = 2π ΣP/Σ|k|P over 2–20 km (L335); ROLL: cross-axis 1-D peak (report) |
| `radial_peak_ratio(P)` | for the CELL label of the confusion table (L416): integer radial bins b = ⌊\|k\|/Δk + 0.5⌋ with Δk = 2π/96 km⁻¹; band = bins with 96/b ∈ [2, 12] km (b = 8..48); P̄(b) = mean of P over the pixels of bin b; ratio = max_b P̄ / median_b P̄ over the band. CELL label = A* < 1.3 ∧ ratio ≥ 2; ROLL label = A* ≥ 1.5 ∧ 2 ≤ λ_s ≤ 15 km (L415-L417) |
| `iorg(mask, instrument, lattice)` | 8-connected components (pure numpy union-find) on the 500 m raster; centroids in km; an object has ≥ 4 px (L337). **Satellite**: objects = components ≥ 4 px; ▸ minus-sampling border correction (Ĝ uses the objects whose distance to the window edge ≥ their NN distance); λ = n_obj / ▸ 9,216 km². **Render (K0 and C4)**: periodic under its own lattice Λ = M·24ℤ² (M = I for K0; L338 "렌더는 주기로", L289, L296 — a stretched tile is not 24 km-periodic). One representative per Λ-orbit: map each centroid by M⁻¹ into [0, 24)² km, copies whose images lie within 0.25 km (torus distance on [0, 24)²) form one orbit; representative = the copy not touching the window edge, first in row-major order of its top-left pixel (▸ if every copy touches the edge: the copy whose centroid is nearest the window centre, row-major first; counted as `nPercolating`); an orbit is an object iff its representative has ≥ 4 px. NN distance of i = min over j (incl. j = i) and n ∈ {−2,…,2}² (n ≠ 0 when j = i) of \|M(u_j − u_i + 24n)\| (with a ≤ 2, ‖M‖, ‖M⁻¹‖ ≤ √2 bound the optimum to \|n_k\| ≤ 2, so a 3×3 search can miss it). λ = n / 576 km² (det M = 1). **Both**: Ĝ = right-continuous empirical CDF of the n_used NN distances d_k; I_org = ∫₀^∞ Ĝ dF with F(r) = 1 − exp(−λπr²) over the **whole** range (L339), computed exactly as I_org = (1/n_used) Σ_k exp(−λπ d_k²) (no r cut-off; with few objects F(48 km) is far from 1, e.g. n = 1 in 96² km → 0.54); null when n_used = 0 (satellite: also when n_obj < 2). Test: = trapezoid of Ĝ over 200,001 uniform F points within 1e-4 |
| `iorg_null(objects, instrument, lattice, seed)` | same objects placed uniformly without overlap ▸ (bounding boxes may not overlap) — satellite in the 96 km window, render in the fundamental cell with periodic non-overlap under Λ; 50 placements, seed = int(sha256(scene key)[:8], 16) (order-independent); I_null = mean |
| `astar(A, cf, nobj, instrument)` | A_null and p95 from `anull-table.json`, bilinear in (cf, ln nobj) between bin centres, clamped outside; A* = A/A_null (L328-L333) |
| `scalars(…, resolution='500', band=(2, 12), mask_thr=0.45, mask_kind='min')` | `{cf, emptyFrac, nObj, nPercolating, A, Astar, Ap95, theta, Q, lambdaS, radialPeakRatio, Iorg, Inull, filter3}`. Report/sensitivity code paths named now: `resolution='250'` (no 2×2 matching, L321, L536), `band=(3, 15)` (L534), the mask arguments above |
The judge runs it once on held images (L183). Nobody prints held scalars (G9).

### 3.3 `texture-test.py` → `texture-test.txt`, `anull-table.json` (L641-L643, L329-L343)
- Phase A (before renders): synthetic rolls (cosine stripes at θ ∈ {0, 30, …, 150}, λ ∈ {3, 6, 10} km, thresholded at cf) → |Δθ| ≤ 3°, A* > 1.5; synthetic **cells** (hexagonal pattern, L642 "합성 롤·세포"; centre spacing giving a dominant wavelength of 4 and 8 km) → A* < 1.3, `radialPeakRatio` ≥ 2, λ_s within 5 % of the dominant wavelength (T-CELL); isotropic Gaussian fields → median A* ∈ [0.9, 1.1]; known-spacing patterns → λ_s within 5 %; regular lattice → I_org − I_null < 0, clustered → > 0; I_org integral = trapezoid cross-check (T-IORG-INT); lattice periodicity: a 24 km-periodic K0 field gives the same I_org on one tile and on the 96 km window, and an isotropic periodic field under M(2) gives the same object count per cell as under M = I to ±1 (T-IORG-LAT); Q sign/axis; resolution matching (250 → 500 m) on synthetic; image orientation (a north-up stripe gives θ = 90). A_null table: cf bins of 0.05 on [0.05, 0.80] (15) × 8 log-spaced object-count bins (▸ edges from 4 to 4,000), 200 isotropic Gaussian syntheses per cell per instrument (satellite 96 km Hann window; render = a 24 km periodic tile tiled 4×4 into the 96 km window), correlation length chosen so the object count lands in the bin; seed 20261103 per cell via sha256 of the cell id.
- Phase B (after `render-tile.mjs` r2 K0 renders exist): nobj = median r2 render object count of held·dev ROLL scenes (MODIS-free, L342); 200 isotropic render-instrument syntheses at cf 0.3 with that nobj, M(a) applied for a ∈ {1.25, 1.5, 2.0} (I_org under Λ = M(a)·24ℤ², §3.2): r(a) = median λ_s(a)/λ_s(1), ΔI_mech(a) = median[(I_org − I_null)(a) − (I_org − I_null)(1)] (L343; isotropic expectation 0.99/0.97/0.92, L426). Phase B must precede the J2 evaluation that uses r(a) (Q-27).

### 3.4 `render-tile.mjs` (L315-L319, L420, G10 L568-L580)
- esbuild 0.28.2 bundle (closed-world folder, as R-LCL-TS) of the app at the K0 commit = the **G1 baseline commit** (L545, L666), which must exist before the first K0 render (§3 order), for K0, and of the frozen render transform for C4; entry uses the exported `makeGenusWeather` path of `cloudGenus.ts` (FIELDS itself is not exported) to produce the cu/sc low-lane tile bytes (24 km, S² px, ≈ 94 m).
- C4: g(x) = f(M⁻¹x), M = R(θ)·diag(√a, 1/√a)·R(−θ), θ in the east–north math convention (L289-L291). World window 96 km at 250 m: ▸ 8×8 supersamples per pixel, bilinear with repeat wrap like the shader's tile sampling, mean → 250 m; then 2×2 → 500 m (L317-L318), north-up rows for `texture.py`.
- Thresholds are applied by `texture.py`, not stored: r1 = quantile matching the day's satellite cf (judge/dev only, from the same density); r2 = the app threshold (forecast low cover; tile byte > 127.5 ↔ value > the cover quantile).
- Inputs per scene from `regime-list.json` only (θ_CBL, a, scene seed, lane parameters) — ▸ the K0 layer genus/cover must come from the app's own planner with MODIS-free inputs; `classifyGenus` wants per-level cloud cover that `sounding.json` lacks (§3.8 S5b-1).
- **Render plan** (all MODIS-free, before freeze): every held·dev ROLL scene × {K0, a = 1.25, 1.5, 2.0 at θ_CBL} (main, J2, "a 의 다른 값" and the 2판 nearest-a arm, L527 — nearest-a is one of the three); after `dev-choice.json`, every held ROLL scene at the chosen a with the axis offset −15° for northern-hemisphere sites and +15° for Sydney (L527 "−15°(북반구) / +15°(남반구)"). The judge renders nothing; it only thresholds stored densities.
- Outputs: the **unthresholded** 250 m density `.harness/regime/render/<key>__<K0|a{a}|a{a}off{±15}>.f32` (384², float32 little-endian, row 0 = north; `texture.py` does the 2×2 → 500 m and the r1/r2 thresholds, so the 250 m report path also works) and `tools/genus-ruler/regime/render-index.json` = `{schema, sources:{regimeListSha256, g1BaselineCommit, k0BundleSha256, c4BundleSha256, renderTileSha256}, files:{name:{sha256, key, a, thetaDeg, offsetDeg}}}`. The index is the "렌더 입력" of the pre-read check (L682): it is listed for FROZEN `files` (session decision at FROZEN assembly; L657-L659 do not name it yet — §O-5) and `--precheck` compares every density file with it. Never reads satellite images.

### 3.5 `regime.py` modes
- `--power` → `power-regime.json` (L636-L640, L385, L391): frame = held scenes of `regime-list.json` with their real strata (site, sat), ISO weeks, real θ_CBL and real `regime-shift-axes.json` pools (via `shift_pick`). Filter 3 is simulated by keeping each scene independently with probability 0.75 [estimate] per replicate. P1 set per replicate = Bernoulli(π) of the kept held ROLL scenes, π ∈ {0.375, 0.5} [estimate from L227] (Q-28). P2 frame = the kept held convective scenes (DISORG·CELL·ROLL), ROLL vs non-ROLL labels from the list (L396; Q-42). RNG: one recorded seed 20261105 → `np.random.SeedSequence(20261105).spawn` one child per (scenario, q, π) in sorted order for the synthetic draws; inside each replicate the judge statistics use their own judge seeds unchanged (Q-35). θ_sat synthetic per sim3b/simB3/simE models: following share q ∈ {0, 0.15, 0.27, 0.40} with vM κ 4; null scenarios: independent, ROLL-day concentration, AR(1) 0.7 and 0.85, seasonal co-rotating 60°, 30 % scan-axis component. Statistics exactly as the judge: (a) stratum permutation seed 20261103, (b) site-common time shift seed 20261104 with u = `SHIFT_U[rng.integers(72)]` per site in sorted order; 1,000 replicates × 2,000 permutations (report MC SE). P2: label permutation in (site, sat) strata with synthetic ln A* (ROLL effect 0, 0.05, 0.10, 0.15) under persistence/seasonal scenarios; **if the (site, sat) false-pass rate > 0.035 in any persistence or seasonal scenario → `p2Stratum = "site,sat,bimonth"`** (L400), bimonth blocks {06–07, 08–09, 10} (Q-29). J3 'no exaggeration': simD model with the real dev ROLL and held ROLL scene counts (× filter-3 survival 0.75 [estimate]); τ = 1.40 fixed (L640).
- `--j2` → `j2-fidelity.json` (L419-L431): r2 renders of all held·dev ROLL scenes for K0 and a ∈ {1.25, 1.5, 2.0}: median A*_render(a) increasing in a; θ sweep 0..170° step 10 on one dev scene (the first dev ROLL scene in (date, site) order) |Δθ| ≤ 10°; |Δcf(r2)| ≤ 0.005; λ_s(C4)/λ_s(K0) ∈ [r(a) − 0.03, 1.03]; app-tile medians |ln λ ratio| and |Δ(I_org − I_null)| (for c_λ, c_I, L440-L441); other lanes and channels byte-identical.
- `--dev` → `dev-choice.json` (L298-L305, L429-L431, L645-L646): only after the list commit and oro freeze; dev scalars via `png-dev`; dev ROLL scenes passing filter 3; median A*_sat; r1 renders at the dev cf; largest a with median A*_render(a) ≤ median A*_sat, else 1.25 + "가장 작은 늘임도 dev 과녁 위"; n < 5 → 1.25; dev scene SD of ln A*_sat (§0.4 L112); mask-threshold check 0.40/0.50 (report); chosen-a J2 conditions A*_render ≥ 1.1 and m_A (held ROLL r2 renders, MODIS-free).
- `--precheck` / `--judge` → `gate-regime-held.json` (§10.3 L671-L692): checks (1)–(5) of L674-L679 (`rulerPrefix` = sha256 of `RULER-regime.md` up to the line starting `## 11.`); pre-read check of L681-L684 (all held images present with manifest sha, latest refetch manifest honoured, every input file present and equal to FROZEN, every render density equal to its `render-index.json` sha256; a missing report arm may be set to '못 잼' only as L684 says, recorded in §11.3 before reading); lock `judge.lock` right before the first held image open; held scalars once; count line (L221-L222) to the result file only; P1 (V, p_a seed 20261103, p_b seed 20261104, 10,000 each, D_V, c_i), P2 (stratum from `power-regime.json`; a new `np.random.default_rng(20261103)` instance; strata sorted, scenes sorted by key inside a stratum, one `rng.permutation` per stratum per replicate; Δ_A one-sided, p = (1 + #{Δ_perm ≥ Δ_A})/10,001; Q-35), J3 and every week-block interval (bootstrap 10,000, seed 20261103, a separate Generator instance per statistic; a replicate draws the present ISO weeks with replacement, as many as there are present weeks, and recomputes the clause's statistic over all scenes of the drawn weeks with multiplicity — `np.median` for J3's δ, D_Q, D_λ, D_I (and Δ_A's report interval: the two medians), the mean of c_i for D_V; **U95 / L95 = 97.5th / 2.5th percentile** of the replicates, `np.percentile` method 'linear' — the percentile simD used to calibrate τ = 1.40; Q-34), reports of §6.1 incl. the scan-direction contrast from `passes[sat].scanAxisDeg` (L410) and the mountain/flat split from `siteClass` (L413, Q-36), terrain tags (a)–(c) of L490-L495, failure labels of L496-L501; stdout progress only; stop rules of L689-L692 (`judge.lock.1` once).

### 3.6 `g1-baseline-regime.json` (G1 L545-L549, L625, q7)
- Measured at the **G1 baseline commit** (merged 115fbe2 + bundle fix ece32b1 + G1 tools only; not yet made, plan L87), in a worktree of that commit (L625 "그 커밋에서 잽니다"). The commit itself is made **first** in S5b (before any K0 render, §3 order; L624-L625, L666); only the measurement waits for the committed list. Tooling: reuse `oro/g1/*` read-only through a new `tools/genus-ruler/regime/g1/` wrapper (oro files are not edited; Q-30).
- (a) shader source md5, uniform list, tile bytes md5, weather key and `qKey`, rgb/alpha md5 for B0_app, P0_seoul and **two ROLL scenes** = the first two dev ROLL scenes of `regime-list.json` in (date, site) order (MODIS-free inputs; no job file with a satellite ring, cf. the `jobs-macro.json` leak); (b) job options carry cu·sc layers and `JOB_BASE_OPTIONS.regime = 0`, else void; (c) A/A twice, same chromium and SwiftShader settings as `oro/merge-aa.json` and the G1 determinism notes; (d) `liveScene` request list and rebuild count with `macroOro: 0, regime: 0` — no D6 request. Schema = oro `g1-baseline/1` plus `"roll":{"<job>":{…}}`.

### 3.7 S5b tests (added to the FROZEN test files before freeze)
| id | file | pins | criterion |
|---|---|---|---|
| T-SYN, T-CELL, T-ORIENT, T-RES, T-IORG, T-IORG-INT, T-IORG-LAT, T-Q | `texture-test.py` | §3.2 | phase A list of §3.3 |
| T-EMPTY, T-PATHS | `texture-test.py` | §3.2 | `empty250` = `max(R,G,B) < 0.02` on hand pixels (0.0199 empty, 0.02 not); the report paths (`resolution='250'`, `band=(3,15)`, `mask_thr` 0.40/0.50, `mask_kind='R'`) run and differ from the main path on a synthetic image |
| T-RIDX | `texture-test.py` | §3.4 | `render-index.json` rebuild equals stored; a changed density byte → mismatch; the K0 bundle hash equals a bundle made from the G1 baseline commit |
| T-ANULL | `texture-test.py` | A_null table | per cell 200 syntheses, isotropic median A* ∈ [0.9, 1.1] after normalisation; table reproducible byte for byte |
| T-MECH | `texture-test.py` | r(a), ΔI_mech | re-run equals stored; r(a) within 0.02 of the isotropic expectation 0.99/0.97/0.92 or the difference reported |
| T-URL, T-MANI | `texture-test.py` | §3.1 | URL hand value for one scene; manifest writer never overwrites (refetchN); size never on stdout |
| T-GUARD5B | `regime-test.py` (S5b part) | §3 guard | (1) pure `s5b_verdict` on held/dev names under the real `.harness/regime/sat/` without lock → 'forbidden', with lock in `png-judge` → 'read', held key in `png-dev` → 'forbidden' (no I/O); (2) with `sat_dir` = `.harness/regime/test-tmp/sat/` holding a **synthetic** PNG: open without lock → PermissionError, `png-hash` reads bytes without decode; (3) subprocess open of a non-existent `.harness/regime/sat/__probe__osaka_2026-06-01_aqua.png` → PermissionError (FileNotFoundError = FAIL). No real image is opened |
| J-P1 | `regime-test.py` | §3.5 judge | synthetic θ pairs: V exact; p = (1 + #{V_perm ≥ V})/10,001; strata respected; c_i of a lone-stratum scene = 0 |
| J-SHIFT | `regime-test.py` | null (b) | u drawn per site in sorted order from `SHIFT_U` with seed 20261104; replacement days = `shift_pick`; own axis when None |
| J-BOOT | `regime-test.py` | week blocks | resampling unit = ISO week of all sites (present weeks with replacement, count = number of present weeks); seed 20261103, new Generator per statistic; `np.median` (J3) / mean c_i (D_V) with multiplicity; U95/L95 = `np.percentile(…, 97.5 / 2.5)` 'linear'; hand case with 3 weeks reproduces a hand-enumerated distribution |
| J-P2, J-J3, J-TAG, J-LABEL | `regime-test.py` | §6.1–§6.5 | P2 label permutation within the stratum from `power-regime.json` (seed 20261103 new instance, sorted strata and keys, p = (1 + #{Δ_perm ≥ Δ})/10,001); J3 U95/margins with c_λ, c_I; terrain tags (a)–(c) truth table; failure labels '작음'/'못 가름' and the (a)/(b) suffixes |
| J-PRE | `regime-test.py` | §10.3 | precheck refuses on: FROZEN file changed, `rulerPrefix` changed, `gate-regime-held.json` or `judge.lock` present, a held image missing or with a wrong sha, a render density ≠ `render-index.json`; nothing under `.harness/regime/sat` is opened before the lock (synthetic sat dir, as T-GUARD5B) |
| J-OUT | `regime-test.py` | G9 | judge stdout on synthetic data contains no number other than progress counters; the count line is only in the result file |
| J-POWER | `regime-test.py` | `power-regime.json` | rebuild equals stored (same recorded seed 20261105 and spawn order); `p2Stratum` follows the 0.035 rule |
| J-J2, J-DEV | `regime-test.py` | `j2-fidelity.json`, `dev-choice.json` | criteria recomputed from stored values; a-choice truth table (largest a with median A*_render ≤ median A*_sat; none → 1.25 with the note; n < 5 → 1.25) |
| G1-R | `regime/g1/` | §3.6 | A/A equal; schema; no D6 request with both options 0 |

### 3.8 S5b open items (decide at S5b build, MODIS-free)
- **S5b-1** K0 low layer for renders: the app's `classifyGenus` needs per-level cloud cover (`cloud_cover_{p}hPa`) not in `sounding.json`. Options: (i) planner with `profile: []` from sounding low/mid/high; (ii) a one-off per-level cover fetch (Open-Meteo cost ≈ like R10). Must be fixed before any render value exists.
- **S5b-2** the exact `makeGenusWeather` call (layer list, seed, `spacingKm` via `aspectSpacingKm`) and the C4 sampling path must be the ones G10 later compares (L576-L577).

---

## 4. App (post-freeze, W1–W3) — what must match `regime_ref.py`
- **A-1 Pure selector** (`blRegime.ts`, W1): same input object (§1.6), same steps (§1.7–§1.14), same constants (§1.2), same branch order; output regime, θ_CBL, axis source. G7 (L555): run it on every `regime-list.json` scene (and the R-* vectors from `regime-test.py --emit-vectors`); regime equal (NA included); θ difference ≤ 0.1° on every non-NA scene; **verdict as L555**: any difference (regime or θ) in a scene with `nearBoundary` true (any §0.3 margin) is excused and only named. Diagnostic (reported, not a verdict): θ differences excused by a margin other than `axis2` are listed separately, since θ is continuous at every other threshold and only the |U| = 2 switch can move it legitimately (Q-38). LCL < 3 km and filter 2 have no margin.
- **A-2 θ convention**: east–north math axis angle in [0, 180) (JS: `((x % 180) + 180) % 180`, then 180 → 0). Not `rollDirectionDeg` (compass, −15°, 5 m/s). The shader's M = R(θ)diag(√a, 1/√a)R(−θ) uses the same frame (`frame.east`, `frame.north`, L291); G10 (b) compares the uniforms with `regime_ref`/`render-tile.mjs` to 1e-6.
- **A-3 Time interpolation**: at the render time t with the §2.2 rule (bracketing valid hours within ±3 h, one-sided → NA), on the UTC axis (the thermo request uses `timezone=auto`; DST days must not shift the bracket), on wind components. Port `interp_na` semantics, not `interp_fallback`'s one-sided branch.
- **A-4 Sources** (L236-L247): z_sfc = D6 response `elevation`; T2m/Td2m/CAPE/BLH and T·RH profile from `fetchThermoProfile`, Z from `fetchLayerWinds`; winds 10 m·925·700 from the D6 request and 850 from the existing request (km/h components → m/s by /3.6); low/high cover from D6, `/100`; precipitation and shortwave from D6 (D14). D6 null or not arrived → NA, byte-identical render (G2). Archive dates (> 5 days) lack the profile → NA.
- **A-5 Formulas**: p_sfc from Z (never `surface_pressure`); θ_v with Bolton e_s and RD/CP = 287.04/1004.7, RV/RD from `oro_ref`; LCL by calling the existing `lclAglM` with the ThermoInput of §1.7; BLH unclipped; parcel clip [100, 3000]; V held above the top node; U_CBL magnitude of the trapezoid mean vector; shear definition = `regime-list.shearDefinition` (frozen); the weak-wind axis vector is always V(z_sfc + zi) − V(z_sfc + 0.1 zi) (L264, Q-33).
- **A-6 Sun altitude**: computed in the app; recommended port of the NOAA series of `oro_ref.sun_alt_deg`. G7 uses the stored `sunAltDeg`, so formula differences only matter at runtime (margin 0.01°).
- **A-7 ROLL-only wiring** (W2/W3): the shader fragment and `L.opts.regime` only for ROLL; NA/NONE/DISORG/CELL byte-identical (G2); keys carry `regime` only when on (G1); D6 request only when `macroOro` or `regime` is on (G1(d)).

---

## Q. Ambiguities and the readings chosen (rules unchanged)
| # | topic | reading chosen | ruler line |
|---|---|---|---|
| Q-1 | CMR coverage | every granule in `sat-times.json.gz` covers the observer (CMR `point=` query); planar `point_in_poly` only picks the polygon for cross-track | L150, L196; `fetch-sat-times.py` docstring |
| Q-2 | "DAY granule" vs `BOTH` | `day_night_flag == 'DAY'` only (as oro-geom). `BOTH` granules are almost all night-pass terminator granules (BOTH-only passes in p2026 ∪ p2025: Aqua 02–05 h, Terra 18–23 h LMST [CMR-meta]); counting them would invent second passes. Daytime exceptions (recount, p2026 ∪ p2025; the review's 11 + 1 included the unused p2026spring): 9 Aqua BOTH-only passes at 15.0–16.6 h LMST and 1 Terra at 7.95 h, all Sydney, June–July 2026 → lost as passes (Sydney Aqua June–July sun < 20° → NONE anyway, L37). On Sydney Aqua 2026-06-26 (DAY 15.03 h, BOTH 16.62 h) and 2026-07-09 (BOTH 15.03 h, DAY 16.70 h) a DAY pass and a daytime BOTH pass share the solar day: DAY-only counts them single-pass although GIBS may composite both (impact ≈ 0: NONE; such a scene can still enter the NONE 20 % sample). Two passes mix DAY and BOTH granules (Hamburg Aqua 2026-06-21, 03.15 h; Hamburg Terra 2026-10-28, 9.32 h): their mid is computed from the DAY granules only. The VIIRS rule is unchanged under this reading: held DAY-only site-days by month Aqua 232–248, Terra 225–247 (DAY∪BOTH, as R8 counted: 239–248, 228–247) [CMR-meta]. These facts go to §0.4 (§0.6 (x)) | L85 "DAY 통과", L150, L157 |
| Q-3 | dawn/dusk DAY passes | a DAY-flag descending-node granule (Hamburg ≈ 05:30 LMST) is a pass like any other → literal "exactly one" excludes that satellite-day (28 Aqua, 13 Terra Hamburg days in 2026 [CMR-meta]); reported in §0.4 | L152-L153 |
| Q-4 | "간격 ≤ 30 분" | start-to-start gap of consecutive granules ≤ 1,800 s (oro-geom R-G1); end-to-start would give the same groups (5-min granules) | L152 |
| Q-5 | pass mid | (first start + last end)/2 of the covering DAY granules of the pass | L154 |
| Q-6 | duplicates / non-quad | collapse by `time_start`; polygon = first containing ring in file order; non-quad → filter 1 false (never occurs) | L196 |
| Q-7 | interpolation | §2.2 for every selector and filter-2 input: one valid side → NA (oro's `fallback1` refused); ±3 h measured from t, inclusive | L170-L172 |
| Q-8 | units | cloud % → fraction; precipitation and shortwave (Open-Meteo preceding-hour values) used as the interpolated value at t, no half-hour shift — the app reads the same hourly series | L197, L244, L271 |
| Q-9 | "필요한 입력" | fixed list of §1.12: profile 1000–500 hPa (Z, T, RH) except deep-underground levels (z_std(p) < z_sfc − 500 m, oro Q-49) whose nulls are dropped; winds only of node levels up to the first above z_sfc + zi | L172, L279 |
| Q-10 | θ_v(2 m) pressure | p at 2 m = p_sfc | L253 |
| Q-11 | LCL "기존 식(T2m·Td2m)" | the existing function `lclAglM` as the app calls it (mixed layer: surface + levels within 600 m AGL); the parenthesis names its required inputs. Surface-only would differ from the app's runtime value and break G7. Because this departs from the literal "(T2m·Td2m)", it is listed among the §0.6 (viii) facts for the §10.1 ⑨ short re-review | L269, L647 |
| Q-12 | clip of BLH | the [100, 3000] clip belongs to the parcel method only (nested bullet; 1판 wording "찾고, … 자릅니다") | L249-L252; 103aa7a §3.1 |
| Q-13 | angle convention | math axis angle from east, CCW, east–north frame, [0, 180): the frame of M in §4 and of `texture.py` (θ = arg e₁ + 90°) | L263, L289-L291, L325 |
| Q-14 | node at z_sfc < Z ≤ z_sfc + 10 | dropped (layer starts at z_sfc + 10 m; never happens at these sites for 925–700 hPa) | L254-L255 |
| Q-15 | V above the top node | held at the top node's value (no extrapolation, no 600/500 hPa wind — not in the input table) | L242, L255, L258 |
| Q-16 | "U_CBL ≥ 6" | magnitude of the layer-mean vector | L254, L282 |
| Q-17 | convective proxy | conjunction of the three listed conditions, each inclusive | L75, L265 |
| Q-18 | margin flags | any listed threshold within its margin → `nearBoundary`, whichever condition decided the regime; no margin for LCL < 3 km and filter 2 | L78, L555 |
| Q-19 | filter 2 with NA | not passing (null recorded); the other satellite may then be used | L147, L197 |
| Q-20 | terrain-flag interpolation | `oro_ref.ref_values` unchanged (its own fallback), i.e. "the same function"; flag computed whenever a scene time exists | L230 |
| Q-21 | NONE 20 % sample | per group over NONE scenes with a scene satellite, k = ⌊0.2n + 0.5⌋, order by sha256("20261103:" + key) — seeded, numpy-version independent | L180 |
| Q-22 | "장면 i 의 통과 UTC 시각" on day d | t_i + whole days (same UTC clock time); day distance in solar dates | L205, L362-L363 |
| Q-23 | sunset hours | evening (descending) hours on the hour, as RULER-oro's sunset ratio (oro L624 "(저녁)", oro Q-42); morning reported | L209 |
| Q-24 | GIBS `TIME` (S5b) | UTC date of the pass mid (the only date GIBS indexes); the UTC-day ambiguity is §O-2 | L177, L153 |
| Q-25 | manifest size (S5b) | stored as L185 says, never printed or compared (size follows content; oro C1) | L185 |
| Q-26 | empty 500 m pixel (S5b) | any of the 4 quarter pixels empty (250 m empty per Q-32) | L198 |
| Q-27 | r(a) object count before renders (S5b) | texture-test phase B after the r2 K0 renders, before J2 | L342, L426, L641-L644 |
| Q-28 | P1 subset in `power-regime` (S5b) | Bernoulli π ∈ {0.375, 0.5} of the held ROLL scenes kept by the filter-3 draw (Q-42) (A_sat unknown pre-freeze) | L227, L637 |
| Q-29 | "두 달 묶음" (S5b) | {Jun–Jul, Aug–Sep, Oct} | L400 |
| Q-30 | G1 tooling location (S5b) | new `regime/g1/` wrapper, oro tree untouched | L545, L625 |
| Q-31 | `old` list completeness | `regime_ref` also depends on `oro/dem-grids.json` and copies `oro-geom.py` functions; their sha256 go into `regime-list.sources`; the FROZEN assembly should list them under `old` with `oro/FROZEN.json` | L662-L665 |
| Q-32 | empty 250 m pixel (S5b) | `max(R, G, B) < 0.02` — the code of `macro/fetch-sat.py` L63, the `old` mask source; its docstring "전부 0" (L12) is prose for the same mask | L198 (silent), L665 |
| Q-33 | axis fallback under `--shear-def sfc` | the weak-wind axis vector stays V(z_sfc + zi) − V(z_sfc + 0.1 zi): L264 writes that vector out, and L261 lets the Santellanes check change the shear definition of L258 (the ROLL threshold), not the axis rule | L258, L261, L264 |
| Q-34 | "백분위 95 %", U95/L95 | the two ends of a two-sided 95 % percentile interval: U95 = 97.5th, L95 = 2.5th percentile (`np.percentile`, 'linear') of the 10,000 week-block replicates — the percentile simD used when it calibrated τ = 1.40 (`simD_exag_interval.py` L59). Replicate statistic = the clause's statistic over the drawn weeks' scenes with multiplicity (`np.median` for the J3 medians; mean c_i for D_V); simD used the lower weighted median (first scene with cumulative weight ≥ half), which differs by at most one order statistic — recorded, not copied | L92, L439-L442, L467 |
| Q-35 | P2 and `--power` randomness | P2: new `default_rng(20261103)` (the L92 seed; separate instance), sorted strata, scenes sorted by key, one `permutation` per stratum per replicate, one-sided p = (1 + #{Δ_perm ≥ Δ})/10,001. `--power` synthetic draws: recorded seed 20261105 via `SeedSequence.spawn` per (scenario, q, π) in sorted order; judge seeds unchanged inside each replicate | L92, L398, L636-L640 (no P2 seed given) |
| Q-36 | "산악·평지 사이트 따로" | mountain = A1 site (rms h_sub ≥ 100 m): held denver, osaka, sapporo; dev kanazawa [measured, oro L188] — the split RULER-oro applies (oro L240 lists six "산악일 법한" held sites as an [estimate] and says "실제 적용은 §2.6 이 정합니다"). It is 3 of 8 held, not "반반" (L144, L519); the wording is recorded, the report uses A1 | L144, L413, L519; oro L188, L240 |
| Q-37 | images for the cross-track arms | the §7 arm "가로 거리 ≤ 300 / 520 km" needs images outside the main list (Aqua at 430–520 km preferred over Terra; new scenes); they are added to the same MODIS-free fetch list (`fetch.ct300`/`fetch.ct520`), since L682 needs every sensitivity input present at the pre-read check and '못 잼' is a pre-read fallback, not a plan (L684). [CMR-meta] at 520 km held p2026 filter-1 days are 870 (either) vs 772; at most ~100 extra site-days before filters 2 and convection | L179, L537, L682-L684 |
| Q-38 | G7 excuse | verdict exactly as L555 (any difference in a scene inside any §0.3 margin is excused and named); the stricter "θ only with `axis2`" is a reported diagnostic, not a verdict | L555 |
| Q-39 | I_org integral | ∫ over the whole F range, exact closed form (1/n) Σ exp(−λπd²) for the right-continuous empirical Ĝ; no r cut-off | L339 |
| Q-40 | render "주기" for C4 | periodic under the stretched tile's own lattice Λ = M·24ℤ² (24ℤ² for K0); NN over images n ∈ {−2..2}² | L289, L296, L338 |
| Q-41 | render input frozen for the judge | the unthresholded 250 m density per (scene, K0/a/offset) with `render-index.json`; r1/r2 applied by `texture.py` | L316-L319, L682 |
| Q-42 | power frames | P1: kept held ROLL scenes; P2: kept held convective scenes (DISORG·CELL·ROLL); "kept" = independent Bernoulli 0.75 per scene per replicate for filter 3 [estimate] | L349, L396, L636-L640 |

## O. Open items for the main session (not decidable in this design)
- **O-1 Shear source check — before `count`** (§10.1 ③, L260-L262, L105 blank; order L627-L634): there is no default. The session reads Santellanes et al. 2021, records the result at L105, and passes the matching `--shear-def` (`zi01` = 2판 L258; `sfc` if the source defines shear from the surface to zi, L261) to `regime-test.py --pre-count`, `count` and `list`. The ROLL shear changes N_R, so deciding it after the count would make the period choice depend on a definition picked after N_R was seen. `regime-list.shearDefinition` records it; the axis fallback is not affected (Q-33).
- **O-2 GIBS UTC-day ambiguity — decide before `count`**. The exactly-one-pass rule works in the mean solar day (L151-L152), but a GIBS daily composite is indexed by UTC date, and L153 excludes a satellite-day exactly because "GIBS 합성이 어느 통과를 위에 두는지 미확정". Data [CMR-meta, filter-1 passes]: Aqua shares the UTC day of its pass with another covering DAY pass **0** times in every period. Terra is not a rare fallback: held p2026 has 294 site-days where only Terra passes filter 1 (Aqua 478, either 772); **54** of them have another covering DAY pass in the same UTC day (busan 11, osaka 20, sapporo 23), plus **36** Terra filter-1 passes on days Aqua also passes (the `other` images; busan 5, osaka 12, sapporo 19). Dev p2026: 33 of 73 Terra-only (kanazawa 25, seoul 8) — these feed the a-choice. Held p2025: 19 of 304 Terra-only (osaka 5, sapporo 14) + 25 other. (The pre-revision "kanazawa 106 of 133, osaka 106 of 138" counted every single-pass Terra day, filter 1 or not.) Edge: the CMR windows stop at the period's solar days, so on the first/last solar day a neighbour pass of solar 05-31/11-01 can share the UTC day without being in the file → `gibsAmbiguous` null there (§1.4). Options for the session (MODIS-free; a rule change goes through the §10.1 ⑨ short re-review, allowed at grade "dev 만", L63-L68, and must precede `count` and the list commit, L261 by analogy, L217):
  - (A) keep L152-L153 as written: `--f1-variant solar`; `gibsAmbiguous` is stored per pass and counted in `summary` (§0.6 (vi)); optionally pre-register before the list commit a §7-style split "P1/J3 with and without `gibsAmbiguous` scenes" (adding an arm is itself a ⑨ change).
  - (B) candidate rule text for ⑨: "거름 1 에 더해, 그 위성 통과의 GIBS UTC 날짜(가운데 시각의 UTC 날짜)에 관측점을 덮는 다른 DAY 통과가 없어야 합니다(같은 이유, L153). 기간 첫·끝 태양일에서 이웃 통과가 CMR 창 밖일 수 있으면(가운데 시각이 UTC 자정 ± 2 h 안) 모름 = 뺌." → `--f1-variant solar+utc`, applied also to `fetch.other` and the variants. In p2026 it removes the 54 held and 33 dev Terra-only scenes (and the 36 held `other` Terra images), so it can lower N_R.
- **O-3 Extension**: only if `count` says N_R(p2026) < 60; one R10 series, ≥ 10 s apart, stop and report on a daily 429; then `count` once more (§0.5 step 2).
- **O-4 §0.4 records**: exposure grade "dev 만" (L116 still says 없음; the value itself is never copied), the §0.6 facts (O-1/O-2 decisions before `count`; the `COUNT` line(s) unchanged at L108), and the hashes of the committed lists.
- **O-5 FROZEN assembly items this design adds** (session, L654-L669; not a ruler edit here): `render-index.json` (the "렌더 입력" of L682) in `files`; `oro/dem-grids.json`, `oro-geom.py`, `oro/FROZEN.json` under `old` (Q-31). If the session prefers not to fetch the ct520 images, it must record the 520 km arm as '못 잼' before any held image is read (L684) — the design's default is to fetch them (Q-37).

## R. Review disposition (`regime/S5-design-review.md`, revision 1)
`Dnnn` = line of the pre-revision design. "Applied" = the review's correction taken as written or nearly; "applied, changed" = the finding is accepted but the fix differs (reason given); "rejected" = not taken (ruler line). Facts re-measured here from CMR metadata are marked (recount).

| id | finding | disposition | where now | ruler line |
|---|---|---|---|---|
| B1 | `count` ran before the definitions it depends on (shear, O-2, failing tests) | applied: session gates −1, preconditions 0(e)–(g), `--pre-count` test stage 0b, single `count` with a record line, second count only after R10 | §0.5, §1.2, §1.23, §2 header, R-PRECOUNT, O-1, O-2 | L217, L261, L627-L634 |
| B2 | R-EDGE / edge note claimed kanazawa/osaka/sapporo first-day Terra are NA | applied (recount confirms: only Sydney Terra, mids 2026-05-31T22:52:30Z, 2025-05-31T23:02:30Z; the others 00:07–00:22 UTC on 06-01) | §1.5 edge note, R-EDGE | L170-L171 |
| B3 | dev cover value printed at D11; R-GUARD/T-GUARD5B open real leak files | applied: number removed (never copied elsewhere); pure verdict functions + non-existent probe paths + synthetic PNG in a parameterised sat dir | header, §0.1, §3 guard, R-GUARD, T-GUARD5B, J-PRE | L56, L566 (G9), L68 |
| B4 | O-2 understated; must be decided before `count` | applied (recount confirms every number): O-2 rewritten with the filter-1 counts, `gibsAmbiguous` (null at period edges), `--f1-variant` with no default, candidate ⑨ text and option (A) | §1.2, §1.4, §1.18, §1.19, R-GIBS, O-2, §0.6 (vi) | L151-L153, L63-L68, L217 |
| M1 | render I_org "periodic on the 24 km torus" wrong for C4 | applied, changed: lattice Λ = M·24ℤ² as proposed, but the image search is n ∈ {−2..2}² (with a ≤ 2 the optimum can need \|n_k\| = 2, so 3×3 can miss it); percolating orbits pinned; T-IORG-LAT | §3.2 `iorg`/`iorg_null`, §3.3, Q-40 | L289, L296, L338 |
| M2 | I_org integral cut at 48 km | applied, changed: whole-range integral, computed in closed form (1/n)Σexp(−λπd²) (exact for the step Ĝ) instead of a 2,001-point trapezoid; the trapezoid is the test cross-check (T-IORG-INT) | §3.2, §3.3, Q-39 | L339 |
| M3 | G1 baseline commit must exist before any K0 render | applied: commit first in S5b, K0 bundle from it, measurement in its worktree after the list commit; R-LCL-TS asserts `cloudSkeleton.ts` identity (unchanged 115fbe2 → HEAD, checked) | §3 order, §3.4, §3.6, R-LCL-TS | L545, L624-L625, L666 |
| M4 | judge-path numbers unpinned (percentile, P2 seed, `--power` RNG, tie order) | applied (simD L59 `np.percentile(bm, 97.5)` and lower weighted median checked) | §3.5, J-BOOT, J-P2, J-POWER, Q-34, Q-35 | L92, L398, L439-L442 |
| M5 | missing list fields: scan axis, ct300/520 arm, site split | applied: `scanAxisDeg` (R-CT-AXIS); `variants.ct300/ct520` + `fetch.ct300/ct520` (fetch chosen over '못 잼'; the session may still choose '못 잼' before reading, O-5); site split = A1 (3 of 8 held, recorded as not "반반") | §1.3, §1.4, §1.15, §1.18, §1.19, §3.1, Q-36, Q-37 | L144, L410, L413, L537, L682-L684 |
| M6 | `texture.py` lacks CELL statistic, cell test, report code paths, offset renders | applied: `radialPeakRatio`, T-CELL, named `resolution`/`band`/mask paths (T-PATHS), render plan incl. ±15° offsets and nearest-a | §3.2, §3.3, §3.4 | L321, L415-L416, L527, L534-L536, L642 |
| M7 | render inputs for the judge not frozen; `__r2` name | applied: unthresholded 250 m densities + `render-index.json` (FROZEN `files` as a session item, O-5), precheck compares | §0.4, §3.4, §3.5, J-PRE, T-RIDX, Q-41 | L682, L657-L659 |
| M8 | `empty250` contradicted `fetch-sat.py` | applied: `max(R,G,B) < 0.02` (L63 checked) | §3.2, T-EMPTY, Q-32 | L198, L665 |
| M9 | axis fallback followed `SHEAR_DEF` | applied with the literal reading (axis vector always zi01) and a Q row; R-AXIS case with `sfc` | §1.9, §1.10, A-5, Q-33 | L261, L264 |
| m1 | Q-2 BOTH facts | applied, changed (recount): in the periods used there are 9 Aqua (not 11 — the review counted p2026spring) + 1 Terra daytime BOTH-only passes; on 2026-07-09 the order is BOTH 15.03 h / DAY 16.70 h (the review had DAY 15.04 h for both days) | Q-2, §0.6 (x) | L85, L150 |
| m2 | G7 "θ only with axis2" stricter than L555 | applied, changed: the verdict follows L555 exactly; the stricter θ check is a reported diagnostic (a guard criterion stricter than the ruler's would be a rule change) | A-1, Q-38 | L555 |
| m3 | LCL reading vs "(T2m·Td2m)" | applied: listed for the ⑨ short re-review | Q-11, §0.6 (viii) | L269, L647 |
| m4 | §6.5 "P1 미결 가능성 큼" | applied | §0.6 (ix) | L219 |
| m5 | provenance nulls only for oro's variables | applied: `regimeNulls` per period/site/key, asserted = manifest | §1.18, R-SND-SAME | L172, L651 |
| m6 | R-SUNSET relied on `oro.py` (not allow-listed) | applied: hand-coded rule, hand-case test | §1.21, R-SUNSET | L209 |
| m7 | CMR completeness assert | applied | §0.5 step 0(d), §1.4, R-CMR | L651 |
| m8 | Open-Meteo key map | applied (names checked against `fetch-sounding.py VARS`) | §1.6, R-VARS | L162, L239, L242, L267 |
| m9 | exposure via committed metadata | applied: manifests never opened by people, no diffs shown; oro-scene tests print counts only | §0.1, §1.16, §2 header, §3.1 | L185, L56, L566 |
| m10 | closed-world esbuild folder | applied (`oro-base.mjs` build note 1 checked) | R-LCL-TS, §3.4 | L667 |
| m11 | `--power` P2 frame | applied: kept convective scenes, filter-3 survival 0.75 [estimate] | §3.5, Q-42 | L396, L636-L640 |
| m12 | `count` line is the L108 record | applied | §0.5 step 1, §0.6 (i), §1.23 | L108 |

No finding was rejected outright. The review's §V items needed no change.
