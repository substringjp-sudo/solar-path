# S3-design review — `S3-design.md` against `RULER-oro.md` (draft 3 fix 1, 6f99303)

Status: adversarial review of the uncommitted `tools/genus-ruler/oro/S3-design.md`. The ruler and the plan are unchanged. Nothing is committed.
`Lnnn` = `RULER-oro.md` line at 6f99303; `Dnnn` = `S3-design.md` line in the working tree.

**What this review looked at**: the full ruler; the whole design; `plan.md` §1 (S3 list); the code of `src/utils/macroField.ts`, `src/components/VolumetricProbe/cloudFlow.ts` (`fft1`/`fft2`), `volumetricScene.ts` (`macroTileCover`, the `applyScene` macro call), `liveScene.ts` (macro ring construction), `weather.ts:890-911`, `macro/fetch-sat.py`, `macro/macro.py`, `macro/downscale-run.mjs`, `ring/fetch-nwp-ring.py`, `ring/fetch-modis-time.py` (read as text, not run), `ring/eval-ringtruth.py` `date_block_ci` (read only), `ring/solar_util.py`, `oro/fetch-dem.py`, `oro/fetch-sounding.py`, `oro/oro-fingerprint.py`, draft-1 `oro_core.py`/`sim1_lib.py`/`sim2c.py`, draft-2 `simA2_gshuf_mean.py` (header), draft-3 `ready-proc/g6g_rot_fix.py`, and the fastscape file in the scratchpad (sha256 `3d924a41…98d`, matches).
Also: the heads and structure of `dem-manifest.json`, `sounding-manifest.json`, `restore-fingerprints.json` (counts only), `regime/sat-times.json.gz` (CMR metadata structure), and the times, keys and flags in `ring/modis-times*.json`.
**Computed here (MODIS-free)**: (a) every hand value in design §1.2, §1.6 and §1.10. (b) A DEM-only prototype: decoding, pixel-centre cell mean, Tukey, high-pass, A1, z_ref, sea fractions, and G6(d) in both wind directions. (c) The NWP ring null counts at the closest times. (d) A synthetic-only check of the noise in G6(g)(iv). Scripts are in the scratchpad `s3review/`.
**Not opened**: no scene JSON, PNG, `index.json`, `sat-quartiles*.json`, `gate-*.json`, `ringtruth-results.json`, F2/F3 or restore log. No MODIS value was printed or looked at.

## 0. Verdict

The core model, combiner, grid and orientation are faithful to the ruler, and the hand values are right (§6 of this review). There are **5 blocking items**, which must be fixed before the S3a builders are relied on or before freeze:

| id | class | one line |
|---|---|---|
| R1 | deviation | The sounding `complete` flag (and with it A5) also covers values that are not in §3.5 (inversion level, T2m, A4 levels). So a null in a report-only flag removes a scene from the judgement. |
| C1 | contamination | `bank-manifest.json` records `jsonBytes`/`pngBytes`. PNG and JSON sizes are a side channel for MODIS cloud content, and the ruler asks for sha256 only. |
| M2 | missing | The 7- and 42-day snow-memory arms (L733) need the hourly z0 history, which is not stored in `oro-inputs.json`. The judgement would then need the raw sounding, which L359 forbids. |
| M3 | missing | The 64² × 12 km sensitivity arm (L740) needs a 64² B from `oro-base.mjs`. B is built only at n = 128, and `oro.py` may not build B itself (L415). |
| C3 | contamination / procedure | Guarding "every S3 CLI" and putting new modes into the frozen `oro-fingerprint.py` breaks `--f1`/`--f3`. It also conflicts with G8(b) and changes the hash of the code that produced `restore-fingerprints.json`. |

The other findings are fixes (do before freeze) or notes. The design defers several ruler pre-freeze items to S3b. They are listed in §2, because §9.1 ⑨ cannot be met without them.

---

## 1. Formula, constant, branch, threshold, unit, sign or orientation deviations

### R1 [block] A5 counts values that are not in §3.5
- Ruler L239: "§3.5 에 필요한 면이 대체 규칙 뒤에도 null 이면 그 장면은 적용하지 않습니다". L293 A5: "§3.5 의 면이 §2.3 대체 규칙 뒤에 모두 유한".
- Design D228-229: "11. Inversion flag … 12. `complete` = every value used in 2–11 is non-None … A5 sounding = complete". D240: "A5 = dem complete ∧ snd.complete ∧ …".
- The problem: step 11 (inversion flag, a §4.6 report split, L305) and its T2m and lowest-above-ground level then decide A5. A null in a split flag would remove a scene from the judgement set, which is a rule the ruler does not have. The A4 levels (600/500 hPa winds) are §2.6 A4 inputs, not §3.5. The outcome there is the same (a = 0), but the stated reason is wrong.
- **Correction** (replace D229):
  > 12. `complete` (= A5 sounding) = every value used by steps 2–9 is non-None: Z850 and Z700 (to choose L); U, V at every p ∈ L; T, RH, Z at p_lo and p_hi. C_lm may be null (→ 0.15, step 7). Values used only by step 10 (A4) make A4 false when null (`A4.reason = "null"`), not A5. Values used only by step 11 make `inversion = null` (split bin "unknown"). Values used only by z0 make `z0 = null`. None of these touch A5.
- **Underground levels** (Denver, z_sfc ≈ 1.6 km; seven more sites arrive on 11-05): `z0_from_profile` (D209) requires Z(p) at every level ≥ 500 hPa, including levels that are below ground. If a model returns null there, every hour is invalid, z_snow = z_sfc, and the whole site is masked. Pin this before the data arrive (MODIS-free, input-only):
  > A level whose standard-atmosphere height 44330.8·(1 − (p/1013.25)^0.190263) is below z_sfc − 500 m is not required for z0, z_snow or the inversion level, and is skipped when it is null.
  - Record the per-site null counts of those variables from `sounding-manifest.json` in §0.5. For L (Z850), keep the literal rule (Z850 null → A5 false). Report how many scenes it removes.

### R2 [fix] z_ref is used but never defined
- Ruler L434: "z_ref = 관측점 50 km 안 6 km 칸의 max(0, h) 평균".
- Design: `ZREF_RADIUS_KM=50.0` (D94) and `"zRef":f` (D288), but no formula.
- **Correction** (add to §1.5):
  > `z_ref(site)` = mean, in float64, of the decoded float32 `hmean6` over the cells whose centre is at distance ≤ 50 km from the observer (inclusive; 216 cells on this grid). It is stored per site in `dem-grids.json` as `zRefM` and copied into `oro-inputs.json`.
- DEM-only values: denver 1902.2, kanazawa 278.0, sapporo 208.9, osaka 182.8, seoul 106.5, busan 75.0, sydney 44.8, lisbon 45.9, hamburg 29.4, shanghai 3.5 m.

### R3 [fix] G6(a)/(b) can pass while the production branch code is wrong
- Ruler L802: "`fft2` 의 부호가 iσ·e^{imz} 의 부호를 정합니다 … 하나만 틀려도 ρ 부호가 조용히 뒤집힙니다 → G6 (a)~(e)".
- Design: `col_weight` (D140-145), a separate `vertical_decay` "branch-wise" (D147, used only by G6(a)), and a separate `branch='fastscape'` path (D146, used only by G6(b)).
- G6(a) tests `vertical_decay`, G6(b) tests the fastscape branch, and neither test is guaranteed to run the m/μ code that `eta_w` uses.
- **Correction**: one function `vertical_m(k, l, U, V, N, f) -> (kind, m_real, mu)` computes σ, the branch, sgn(σ) and μ. `col_weight`, `vertical_decay` and the fastscape variant all call it; the fastscape variant only replaces the num/den clamps.
  - Add U-M2: on a random 64² k-grid that covers all three branches and both signs of σ, `col_weight == 1/(1 − i·m·H_w)` (propagating) or `1/(1 + μH_w)` (otherwise), using `vertical_m`.
  - G6(a)'s η_w check already uses `col_weight`. Keep that.

### R4 [fix] The c4·c5 masks and the fine/coarse split leave out the empty-pixel boxes
- Ruler §4.1 lists 빈 화소 inside 가림 M (L491-494). L495: "판정 창 밖(c4·c5)에도 같은 M 을 12 km 상자 바둑판으로 펼치고". L568: "m = 1(M 밖 6 km 칸)".
- Design D454: empty boxes are "removed from W, S, S∪" only. D468 and D469 use "M via the extended tiling" without saying that M includes the empty boxes.
- **Correction**: at judge time, M_judge = snow ∪ high ∪ empty, all on the extended tiling (a 12 km box with ≥ 1 empty 3 km pixel, for every box of the 65 × 65 extended tiling). Use M_judge for W/S/S∪, for the G₁₀ ⊛_M weight m, and for the 3 km masks of c4·c5.
  - The MODIS-free uses stay snow ∪ high: A7 (L498 "빈 화소 가림은 A7 에 넣지 않음"), D_dc, G7 and the masked app share (L308 "M = 눈·상층운 가림").

### R5 [fix] The sensitivity hooks do not cover all L731 parameters
- Ruler L731: "σ_min 파장 100·400 km. f = 0. s_rel 0.10·0.20. σ_G 15·30 km". L727: "η_q(τ_c = 1000 s)". L742: "이웃 두 날짜 묶음 블록(8 일)".
- Design D165 hooks: `s_m, lambda_smin, f_override, Hw_override, N_scale, block, vertical`. There is no s_rel override and no σ_G (the combiner's G), and `vertical='q'` has no formula. D484: "8-day blocks (pairs of adjacent dates)" has no pairing rule.
- **Correction**: add `s_rel_override` (κ = γ_s(T̄)/s_rel_override) and `combine(..., sigma_G_m=20000.0)`. Pin η̂_q = ĥ_eff·D(σ)/((1 − i·m·H_w)(1 + i·σ·τ_c)), τ_c = 1000 s (S&B 2004 cloud-water term, same F = κ·η_q).
  - Pin the 8-day block as `block = (date − 2026-09-01).days // 8` on the fixed 4-day calendar. This rule does not depend on which dates happen to be judged.

### R6 [note] Q-28: Pearson with one value
- Ruler L500: "Pearson 이 분산 0 이라 정의되지 않으면 그 값은 0".
- Design D188/D563: "n < 2 → None".
- With n = 1 the variance is 0, so the ruler gives 0. **Correction**: n = 0 → None (empty set, report only); n = 1 or zero variance → 0.0. The difference does not reach any judged scene, because |S| ≥ 20.

### Verified as faithful (no change)
- **Grid**: row 0 = south, col 0 = west, observer at the shared corner of cells 63/64. This matches `macroField.ts:76-77`, `barnesPass` (cell centre `(x+0.5)·cellKm − half`) and the DEM box map (lat0 maps to index 64.0).
- **Truth**: `fetch-sat.py` builds `trueGrid` with row 0 = north (`mask.reshape(256,3,256,3)`, image top = lat0 + dlat) and col 0 = west. `macro.py truth_grid` flips with `g[::-1, :]`. The design's flip and 2×2 mean (D453) give row 0 = south. The flip commutes with the 2×2 mean because the 2×2 blocks align.
- **PNG**: `im.resize((256,256), Image.BOX)`, north up. The design flips it, and window box (bi, bj) covers 3 km rows 98+4bi..101+4bi (D454). Correct.
- **Window and boxes**: cells 49..78 (centres ±87 km, edges ±90 km). Box (bi, bj) covers rows 49+2bi..50+2bi with centre (12(bj−7), 12(bi−7)). The extended tiling (r + 1)//2 has the same phase. Q-1 is right: L365's "64²" tiling is even-aligned and cannot give the 15×15 maxima, so `hmax6` is needed.
- **FFT**: `cloudFlow.fft1` uses e^{−2πi/len} forward and /n per axis inverse, and `fft2` does rows then columns. That equals `np.fft.fft2`/`ifft2` on A[r, c]. k is on axis 1 (east), l on axis 0 (north).
- **Wind**: U = −S sin d, V = −S cos d. This equals `weather.ts:907-909` ((from + 180)°).
- **fastscape**: u0 = −S sin d, v0 = +S cos d along the row axis (south) on a north-up raster. With h[::-1] in and [::-1] out, σ_ours = σ_fs. The branch clamps (`mf_num<0→0`, den in [0, EPS) → EPS, den in (−EPS, 0) → −EPS, sign(σ ≥ 0) = +1) match the file. `pad` matches the file's expression.
- **B**: `applyScene` calls `buildMacroField(sm, {n, cellKm: extentKm/n, noise: opt.macro === 2}, state ?? null)` with `cover: q.cover*100`. The app's covers are fractions (`liveScene.ts:271-275`). The design feeds fraction·100 (D379), so the float operations match the app exactly.
- **macroTileCover port** (D446): same as `volumetricScene.ts:1028-1033`.
- **Combiner** (D167-178): the δ update, the ≤ 10 updates, the stop test on G*[Φ(q₀+F+δ) − Φ(q₀)], the pre-clip failure statistic, the post-clip metric ΔC, and identity at F ≡ 0 all follow L418-L431.
- **Constants (§1.1)**: all equal to L65-L74 and L389-L449. RING_NULL_MAX = 9 equals the "> 10 % of 91" rule.
- **Hand values**: all reproduced to the printed digits: Φ, Φ⁻¹ (Acklam without refinement), Q_LO/Q_HI, U-M (m = 9.990674045554384e-4, W = 0.13815307042396577 + 0.34506057374959037i, the evanescent and rotational cases), U-D (0.917431192661), U-THERMO (θ_v 297.9077625, 303.0520656, N² 1.0493292871e-4), γ_s (5.5241246e-4 at 280 K), H_w 2226.56 m, s_rel 0.171573229857, κ 3.267421921052e-3, the high-pass half-amplitude wavelength 53.364 km, and the Tukey weights.
- **Statistics**: the ports of `date_block_ci`, the sign flip (both G ≤ 16 and G > 16), and the corr12 slice (98..157, k = 4), corr50 (k = 17, full grid) and disc (r ≤ 380 km) all match `eval-ringtruth.py` and `macro.py`.

---

## 2. Items the ruler requires before freeze that are missing or under-specified

### M1 [block for freeze] Items deferred to "S3b, build later" or out of scope
§9.1 ⑤–⑦ and ⑨ need all of the following before freeze, and each is a FROZEN file or value (L874-L877, L887):
- `oro.py` complete. It is a FROZEN file and cannot change after freeze, so the judgement code must be finished pre-freeze.
- `oro-test.py` with G6 (f)(g)(h) and G8 (b)–(f) passing.
- G7, λ_app → λ̃*, the masked app share, m8's app rms, `power-oro.json` and `sunset-apply.json`.
- **`g1-baseline.json`**: the design marks it "out of scope" (D8). Plan S3 lists it, and so do §9.1 ⑦ and G1 (a)–(d). Nothing in the design covers it. **Correction**: add a section that pins the harness G1 (a)–(d) as in L748, at least as a pointer to the volsky tooling spec with its output schema.
  - G1 (a): md5 of the Float32 arrays only (`cover`, `base`, `lambdaRes`, state) for 121 scenes × 3 bands, plus mode 2 with an AR(1) chain of 15 steps.
  - G1 (b): B0_app, P0_seoul and two mountain scenes with `macro: 1, macroN: 128`, after an A/A check.
  - G1 (c): the weather key and `qKey` strings.
  - G1 (d): the `liveScene` request list, the rebuild count and the timer count.
  - Pin the baseline commit and the bundle sha256 (§9.2 `runtime`).

### M2 [block] Snow-memory sensitivity arms need data that is not stored
- Ruler L733: "눈 가림: 7·42 일 기억, 그날 z_0°C 만(1판 규칙), z_0°C − 800 m, 가림 없음". L359: "판정은 원자료를 다시 받지 않아도 돕니다 … 민감도 … 팔까지".
- Design `oro-inputs` stores only `z0`, `zSnow` and `zSnowValidHours` per time (D293).
- **Correction**: add `zSnow7`, `zSnow42`, `zSnowValidHours7` and `zSnowValidHours42` per time. Use the same rule: hours in (t − N·24 h, t], fallback to z_sfc when there are fewer than N·12 valid hours.
  - For 42 days the earliest hour needed is 2026-07-21 (for the 09-01 scenes), which is inside the 06-01 sounding start. The pre-freeze extension (10-23..10-31) is also covered by the original file.
  - For `pre2` (§4.7 (나)), the sounding rule of §2.7 starts at first date − 21 days, which is too short for 42 days. Either fetch `sounding-oro-pre2.json` from first date − 42 days (state this in §1.15 `inputs`), or mark the 42-day arm '못 잼' for pre2 scenes before freeze.

### M3 [block] The 64² × 12 km arm has no B and no DEM
- Ruler L740: "격자: 64² × 12 km(24 km 상자)". L415: "`oro_ref.py`·`oro.py` 는 B 를 다시 만들지 않고 이 값을 읽습니다". L363: "장면·시각·밴드별 B 의 sha256".
- Design D378-381 builds n = 128 only. `dem-grids` has `hmax12` but no 12 km mean.
- **Correction**:
  - `oro-base.mjs --n 64` writes `<scene>__closest__<band>__n64.f32` from `buildMacroField(samples, {n: 64, cellKm: 12, noise: false}).base`.
  - `oro-inputs` gets `bSha256n64` at the closest time only, and `--check` covers it.
  - `dem-grids` gets `hmean12` (64², pixel-centre mean of h over the even 12 km cells, not the mean of four 6 km means, because pixel counts per cell vary 2–16).
  - Pin the arm's window: 12 km cells whose centre is ≤ 90 km (i = 24..39, 16×16), and 24 km boxes as 2×2 of those (8×8).
  - Alternatively, mark the arm '못 잼' in §10.3 before T is read (L356). It is a report arm, so that is allowed, but it must be decided before freeze.

### M4 [fix] Sun-facing-slope split has no inputs
- Ruler L592: "해 쪽 비탈을 뺀 판(상자 평균 비탈 방위가 통과 시각 해 방위 ±45° 안이고 경사 ≥ 5° 인 상자를 뺌; DEM·궤도 시각만)".
- Design: absent from §6.3 and from the `dem-grids`/`oro-apply` schemas, and `solar_util` has no azimuth.
- **Correction**:
  - In `dem-grids`, per site, store `slopeDeg15` and `aspectDeg15` for the 15×15 judging boxes.
    - Per DEM pixel, take central differences of h = max(elev, 0) in tile pixel space.
    - The pixel size in metres is 40075016.686·cos(lat_px)/2^z/256 in both axes (Web Mercator is conformal).
    - The gradient components are (∂h/∂x_east, ∂h/∂y_north), with y_north = −row.
    - Take the vector mean over the pixels whose centres fall in the box. Slope = atan(|mean gradient|). Aspect (the direction the slope faces, clockwise from north) = atan2(−g_east, −g_north) mod 360.
  - Add `sun_az_deg(t, lat, lon)` beside the `sun_alt_deg` copy, using the same NOAA series as the scratchpad `sun.py` used for fix 1: az = atan2(sin ha, cos ha·sin φ − tan δ·cos φ) + 180°.
  - In `oro-apply`, store `sunAzDeg` at the closest time and the per-box exclusion mask.

### M5 [fix] Report values left out of §6.3
- L538 "ρ_odd,swap … 과 2판 꼴(S∪_j, 중앙값)의 값도 보고": add both rows.
- L541: the MODIS-free correlations are already in `oro-apply`. Fine.

### M6 [fix] Sets that need to be named
- **D_dc median**: L574 says "판정 held 장면의 중앙 D_dc". Design D337 has `DdcMedian` with no set. State "over `counted` held judge scenes". The same applies to `lambdaAppMedian` and `G7median` (L511, L754).
- **G-shuf under judge-time drops** (D464): L355 fixes '못 잼' from `oro-apply`, while L343 and L347 drop scenes at judge time. Pin all three:
  - k ranges over the `oro-apply` judge scenes of the site (F_{j|k} uses no T).
  - j ranges over the finally judged scenes.
  - c3b '못 잼' is decided from `oro-apply`. The post-drop G-shuf count is also reported. If it falls below 10, c3b is '못 잼', on the same mechanical rule.

### M7 [note] Sounding provenance
`sounding-manifest.json` hashes the raw HTTP body, but `sounding.json` is a re-serialization (`fetch-sounding.py`: `data[name] = {lat, lon, elevation, hourly}`), so the two cannot be linked. Add `sounding.sites[site].hourlySha256` to the `oro-inputs` sources = sha256 of `json.dumps(hourly, sort_keys=True, separators=(',', ':'))`.

---

## 3. Contamination risks

### C1 [block] File sizes in `bank-manifest.json`
- Ruler L375: "`bank-manifest.json` 에 … 장면 JSON·`trueGrid`·`*.png` 의 sha256(값 없음)".
- Design D394: `{jsonSha256, jsonBytes, trueGridSha256, pngSha256, pngBytes, inTimes}`.
- PNG compressed size follows the image content: cloud texture against clear land or sea, and swath gaps. The JSON size varies with the decimal length of the MODIS-derived `cover`, `empty` and the 91 ring `cover` values from `fetch-sat` (for example `0.0` or `1.0` against a 17-digit float). Committing or printing these sizes puts a per-scene MODIS-dependent number into a pre-freeze file.
- **Correction**: drop `jsonBytes` and `pngBytes`. Never print or store `os.path.getsize` of any file under `.harness/macro/sat*` or `.harness/oro/sat-*`.

### C2 [fix] Lock before decoding the PNG
- Ruler L914: "`judge.lock` 은 T 를 처음 읽기 직전에 씁니다". The empty-pixel count (L345) decodes the MODIS true-colour PNG, which is MODIS content.
- Design D490: "written immediately before the first `trueGrid` read".
- **Correction**: "written immediately before the first decode of MODIS-derived content: `trueGrid` base64 decode or PNG pixel decode (`allow('png-judge')`). Before the lock only `allow('png-hash')` (raw bytes → sha256) is possible."
  - Add a test: with no lock present, `allow('png-judge')` raises.

### C3 [block] Guard scope and `oro-fingerprint.py`
- Design D20: the guard is "called first by every S3 CLI". D23 makes `index.json` and `ring/gate-*.json` always forbidden. D389 adds new modes to `oro-fingerprint.py`. D513 G8(b): "`--f1/--f3` on copies".
- `oro-fingerprint.py --f1` reads `.harness/macro/sat/index.json`, and `--f3` reads `ring/gate-blend-held.json`. Both are always forbidden, so either the guard breaks the existing modes or the guard is not installed in that file.
- G8(b) must run `--f3` with `gate-blend-held.json`, which contains truth columns, so the always-forbidden rule conflicts with the test that the ruler requires.
- `oro-fingerprint.py` is a FROZEN file (L874, "F1~F3"). Its current sha256 is `b03800e75e40…13f6` (4c05bed), the code that produced `restore-fingerprints.json`. Adding modes means FROZEN would hash code that never produced the recorded F1–F3.
- **Correction**:
  - Move `--ring-manifest` and `--bank-manifest` into `oro_ref.py` as subcommands `ring-manifest` and `bank-manifest`. `oro_ref.py` is already FROZEN, so the §9.2 list does not change.
  - Leave `oro-fingerprint.py` byte-identical and record its sha256 next to F1–F3 in §0.5.
  - The guard is installed by `oro_ref.py`, `oro-geom.py`, `oro-test.py` and `oro.py`, not by `oro-fingerprint.py`.
  - G8(b) runs `--f3` against a synthetic `gate-blend-held.json` in `test-tmp`, with fake truth columns and the five non-T columns copied from the rows of a synthetic scene. It runs `--f1` against a test-tmp bank, by patching the module constants `SAT`/`NWP`/`RING` after import. It never opens the real `gate-*.json`.

### C4 [fix] Git commands on frozen MODIS-derived files
`git diff`, `git show` or `git log -p` on `macro/sat-quartiles.json`, `ring/gate-*.json` or `ring/ringtruth-results.json` print values. **Correction**: add to §0.1: "git is called only with `--quiet`, `--name-only` or `--stat`, or with pathspecs that exclude those files. No `-p` and no `show` of them." The checks in D488 already use `--quiet`. Keep that, and make it a rule.

### C5 [note] What was checked and is safe
- The allow-list loader (D233) drops `cover`, `empty`, `trueGrid` and the ring covers. These matter: the original bank's ring covers are the 7 km-box MODIS mask means (`fetch-sat.py`).
- `oro-base` reads only `ringGeom` and `times.*.ring` (D377), with G8(a) as the audit. A8 uses CMR polygons only. `oro-apply` is NWP + DEM + CMR. `.harness/oro/syn-blend` holds NWP-derived syn/base/c0 only.
- Keep `oro-base` free of any path argument other than `--inputs`, `--out` and `--commit`.

---

## 4. Non-determinism and cross-version fragility

### D1 [fix] Hash randomization under `python3 -I`
`-I` implies `-E`, so `PYTHONHASHSEED` is ignored and string-set iteration order changes per process.
- **Correction** (§0.2): "Every iteration over a `set`, `dict.keys()` of external origin, `os.listdir` or `glob` that affects output order or a float accumulation is wrapped in `sorted()`. Lists derived from sets (`pendingSites`, `gshufSites`, `devJudgeable`, `extTargetSites`, `m8.scenes`, `missing`, `tilesUsed`) are sorted."
- B-DET runs the two builds as separate `python3 -I` subprocesses. Scene and tile lists (D275, D121) are sorted by name.

### D2 [fix] numpy, FFT and SIMD drift across machines and versions
`np.exp`, `np.cos` and reductions use CPU-dispatched SIMD paths, and numpy 2 changed the pocketfft implementation. F, ΔC, |S|, A1 and N² are bit-stable on one machine but not across machines or versions. The judgement recomputes ΔC from `oro-inputs` with `oro_ref`.
- **Correction**: record `numpy.__version__`, `platform.machine()` and `numpy` SIMD dispatch (`np.show_runtime()` keys) in `oro-apply.sources`.
- Add a T-free precheck to `oro.py --precheck`/`--judge`: rebuild every `oro-apply` row from the frozen inputs. It must be byte-identical, or else the A1–A8, `judge` and `counted` flags must be identical and the floats within 1e-9. If not, stop before T, handled like §9.3 ④ 5 / §5.2 ①. This makes G5(b) ("판정 집합은 언제나 `oro-apply.json`") enforceable.

### D3 [fix] RNG stream stability
`np.random.Generator` streams are not guaranteed across numpy feature releases (NEP 19). The bootstrap (10,000), the G > 16 sign flips, `power-oro` and the G6(g)(iv) seeds all depend on them.
- **Correction**: pin `numpy==<x.y.z>` in FROZEN `versions`. `oro.py --judge` refuses (pre-T) if the running numpy version differs from `versions`. Alternatively, generate the indices from `np.random.PCG64(seed).random_raw()` with an explicit `% G` mapping that does not change between versions.

### D4 [fix] B-BUSAN breaks when the rest of the data arrives
- D410: "pendingSites = 9 sites". On 11-05 this becomes false, and `oro-test.py` (FROZEN, with criteria pinned before the first run, L793) would FAIL.
- **Correction**: expected `pendingSites.sounding` = the sorted sites of `fetch-sat SITES` that have no record in `sounding.json`. Expected `provisional` = (that list is non-empty). A missing ecmwf file (R11) does not make the summary provisional; it only sets `ecmwfArm`. With 10/10 sites present, the test asserts an empty list and `provisional = false`.

### D5 [note] Float32 round-trip
- A1, z_ref, `sea_box`, h_sub and `hmax` comparisons must be computed from the decoded float32 grids in `dem-grids.json`, never from the builder's in-memory float64 (D125, D135).
- `a1RmsM` in `dem-grids` should be computed after the round-trip, so that the judgement and the builder agree bit for bit.
- Osaka (106.1 m) and Sapporo (106.4 m) are 6 m above A1. See §7.

### D6 [note] `oro-base.mjs` robustness
- Decode `f64b64` into a fresh `ArrayBuffer`: `new Float64Array(Uint8Array.from(Buffer.from(s, 'base64')).buffer)`. `Buffer` byteOffsets from the pool are not 8-aligned, and `new Float64Array(buf.buffer, buf.byteOffset, 91)` can throw.
- Write `Buffer.from(B.buffer, B.byteOffset, B.byteLength)`.
- D373 has the import direction reversed: it is `cloudFlow.ts` that type-imports `cloudGenus.ts`. esbuild strips `import type`, so do not extract `cloudGenus.ts` at all. If esbuild ever resolved it, it would need `three` and five more modules.

### D7 [note] Embedded hashes and versions create churn
`sources.oroRefSha256` in `dem-grids` (D265) and `node` in the base `index.json` (D382, through `baseIndexSha256` in `oro-apply`) change committed bytes when the data does not change. Prefer hashing data inputs only. Keep code and versions in `oro-apply.sources.code` and FROZEN `versions`.

### D8 [note] Small hygiene points
- Set `sys.dont_write_bytecode = True` before the importlib loads. `spec_from_file_location` otherwise writes `__pycache__` into `tools/genus-ruler/{macro,ring}`.
- G6(b): check the fastscape sha256 **before** `exec_module`, and do not import on a mismatch.
- R-G7: drop the closing vertex of the CMR polygons (`'… 45.978 149.992'` repeats the first pair) before forming p0..p3.
- `cmr-geom.sources` needs one times hash per bank once `ext` is merged (Q-25).

### D9 [note] Time arms at the bank edges
- Of the 121 closest times, none needs ring hours outside 09-01T00Z..10-19T23Z. The same holds for latest and m1h. **sapporo_2026-10-19 p1h** does (all 91 points become None).
- In the ext bank (10-23..10-31 raw), the m1h of the 00–01Z Asian scenes on 10-23 and the p1h and latest of the ~23Z scenes on 10-31 will be outside the raw range.
- Spec: arm values become `null` with `nullIdx` = all, the arm is '못 잼' for that scene, and nothing crashes. `B` is null for that time (fewer than 12 points).

---

## 5. Ambiguities resolved against the ruler text

| Q | design reading | ruler text | correction |
|---|---|---|---|
| Q-2 (D537, D472) | 5 boxes within 15 km | L563 "관측점 15 km 안(상자 중심 기준 **4 상자**, 머리 위)" | The ruler's own tiling (L490) gives 5 boxes with centres ≤ 15 km: box (7,7) at 0 km and its four edge neighbours at 12 km. The "4" matches an even tiling, whose observer sits on a box corner. No symmetric set of 4 boxes exists on the L490 tiling. Keep the distance rule (5 boxes) and write the count in the output. Note the text conflict in §0.5 as a reading. It is report-only (§4.4 "화면 무게(보고)"). |
| Q-34/Q-35 (D421-422) | G6(d) bands and G6(e) thresholds were pinned after a DEM-only prototype run | L793 "시험 값은 처음 돌리기 전에 이대로 고정" | Disclose this in the `oro-test.txt` header and §0.5. These pins are additions, not ruler values. The prototype passes both ways (computed here: Hakusan from 270° W +0.112 / E −0.137, from 90° W −0.153 / E +0.132; Odaesan +0.071 / −0.103 and −0.062 / +0.123; Kanazawa NW sea 1.00, SE 0.00). Because the extra easterly mirror is not in the ruler, keep it as a stricter pass criterion only with this disclosure. |
| Q-37 (D511, D572) | (iv) T = clip(B + 0.25ξ, 0, 1), ξ = gauss50 | L784 rests on `ready-proc/g6g_rot_fix.py`, where r = ξ is unclipped | Same noise kind (`smooth_field(n, 50, seed)` = gauss50). Clipping removes 15.5 % of cells at amplitude 0.25. A synthetic check (2 B fields × 16 winds × 200 draws) moved the mean ρ_rot by ≤ 0.0011 against unclipped noise, so the 0.01 criterion is still safe. Pin amplitude 0.25 and record the clip fraction, or use 0.05 (0.5 % clipped) to stay closer to the [computed] basis. |
| Q-48 (D583, D492-497) | joint = P_A(c2∧c3)·P_B(c3b \| c2∧c3) | L612-L616: c2·c3 from sim2c, c3b from simA2, "참 중앙 ρ 0, 0.05, 0.10, 0.15" | simA2 sets the effect through β in r = β·z(ΔC) + …, not through the true median ρ. Pin the mapping before running: for each μ, choose β by bisection (fixed seed 20261103, 2000 replicates) so that the model-B median scene ρ_res equals μ. Also report model B's own P(c2∧c3∧c3b) beside the product. The decision value at μ = 0.10 is the minimum of the product over σ × κ. |
| Q-36 (D571) | null ring point 0 → τ first argument 0 | L546 "첫 인자로 그 밴드의 고리 0 번 값" | Moot for the original bank: 0 null observer points and 0 nulls of any kind at the 121 closest times (computed here from `ring/nwp/blend`). Record that in §0.5. Keep the reading for ext/pre2. |
| Q-28 | n < 2 → None | L500 | see R6 |

The other Q readings (Q-1, Q-3 to Q-27, Q-29 to Q-35, Q-38 to Q-47) are supported by the cited ruler lines or are pinned additions that the ruler does not contradict. Q-4 (square separable truncation) and Q-3 (Tukey) match the draft-1 code behind the [computed] numbers: `sim1_lib.tukey` and `oro_core.gsmooth`, separable, with ceil(3σ) = floor(3σ) at σ 10 and 20 km.

---

## 6. Corrections to apply to `S3-design.md`

1. **D229** → the R1 text. Add the below-ground level rule to §1.11 (R1).
2. **§1.5** add `z_ref` (R2). Add `zRefM` and `hmean12` to the `dem-grids` schema (M3), plus `slopeDeg15` and `aspectDeg15` (M4).
3. **§1.6** add the `vertical_m` helper shared by `col_weight`, `vertical_decay` and the fastscape variant, and add U-M2 (R3). Add `s_rel_override`, `sigma_G_m` and the η_q formula to the hooks (R5).
4. **§1.8 and §6.2** M_judge = snow ∪ high ∪ empty on the extended tiling for W, S, S∪, G₁₀ ⊛_M and c4·c5. MODIS-free uses keep snow ∪ high (R4).
5. **§1.15 `inputs`** add `zSnow7`/`zSnow42` with valid-hour counts, `bSha256n64`, and `hourlySha256` (M2, M3, M7). State that `sounding-oro-pre2.json` starts at first date − 42 days, or mark the 42-day arm '못 잼' for pre2.
6. **§3 `oro-base.mjs`** add `--n 64`, use aligned decoding, write `byteOffset`-safe output, and drop `cloudGenus.ts` (M3, D6).
7. **§4** move the manifest builders into `oro_ref.py`, leave `oro-fingerprint.py` unchanged, and remove `jsonBytes`/`pngBytes` (C1, C3).
8. **§0.1** install the guard in `oro_ref`/`oro-geom`/`oro-test`/`oro.py` only, add the git rule (C4), and list the never-print-size rule (C1).
9. **§0.2** add the sorted-iteration rule, run B-DET as separate processes, use `dont_write_bytecode`, and pin the numpy version (D1, D3, D8).
10. **§5.2 B-BUSAN** derive the expected pending sites from the data (D4).
11. **§6.3** add the ρ_odd,swap and 2판 꼴 G-shuf rows (M5), the sun-facing-slope split (M4), and the near5/4 screen weight (Q-2).
12. **§6.4/§6.5** pin the 8-day block rule (R5) and the G-shuf j/k sets under drops (M6). Name the median sets (M6).
13. **§6.6** lock before any MODIS decode, including the PNG (C2). Add the T-free `oro-apply` recompute check (D2) and the numpy version check (D3).
14. **§6.7** pin the β(μ) calibration and also report model B's own joint probability (Q-48).
15. **§6.9 G8(b)** use a synthetic gate file and patched module constants (C3).
16. **New section**: a `g1-baseline.json` spec or pointer (M1).
17. **`oro-test.txt` header**: disclose the post-prototype pins Q-34/Q-35 (§5).

---

## 7. Informational (DEM only, MODIS-free): A1 per site with the design's pinned resampling

This uses the design's decode and resampling: pixel-centre cell mean of max(elev, 0), box-mean removal, Tukey 16, high-pass s = 10 km, rms over cells 49..78. It reproduces the design's prototype (seoul 64.7, kanazawa 129.3).

| site | A1 rms h_sub (m) | A1 | pixels/cell |
|---|---|---|---|
| denver | 121.3 | ✓ | 9–16 |
| sapporo | 106.4 | ✓ (6 m margin) | 9–16 |
| osaka | 106.1 | ✓ (6 m margin) | 4–12 |
| busan | 58.1 | ✗ | 6–16 |
| sydney | 49.3 | ✗ | 4–12 |
| lisbon | 26.6 | ✗ | 9–16 |
| hamburg | 10.1 | ✗ | 2–9 |
| shanghai | 2.3 | ✗ | 4–9 |
| kanazawa (dev) | 129.3 | ✓ | 6–16 |
| seoul (dev) | 64.7 | ✗ | 6–16 |

Consequences (rules unchanged):
- At most three held sites can ever be judged: denver, osaka and sapporo. These are also `extTargetSites`. c1 then needs all three with ≥ 1 judge scene and none above 50 % of n, and each site needs ≥ 3 judge scenes for G-shuf.
- The §2.7 user question (post-freeze extension) and the §4.7 power question are therefore likely to come up. `oro-apply` should print per-site A1 and the c1 components so that this shows up as soon as the soundings arrive.
- Osaka and Sapporo are within 6 % of the A1 threshold, so the app's `oroDem.ts` must reproduce the pixel-centre rule exactly. The G5(b) margin of ±0.5 m does not save a different resampling.
- Ruler §2.1 and §5.3 expected busan and sydney among the applied sites. That expectation is [estimate] text, and there is nothing to change.
