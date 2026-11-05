# atmos round 1: method note for RULER-oro (C3+C1) and RULER-bl (C4)

Written 2026-11-03. This note pins the method down before any ruler draft. Nothing here has been frozen, and no repository file was changed.
Scope as decided: survey §5 (L0 to L4; C1, C3, C4) and §6 "지형 강제 R1", plus plan §170 and §171.3. C3+C1 act only on scenes that pass the mountain gate; every other scene stays byte-identical. C4 runs on all scenes. C3+C1 is judged by RULER-oro (correlation with the MODIS residual). C4 is judged by statistics plus eye.

## 0. Provenance and pre-registration status

- **Read**: `docs/ATMOS_DYNAMICS_SURVEY.md` (all of it), plan §139, §141, §170 to §173, and the rulers macro, ringtruth and grain2 (structure and FROZEN.json). Code read: `macroField.ts`, `cloudFlow.ts` `fft2`, `cloudSkeleton.ts`, `cloudMorph.ts`, `cloudGenus.ts` (cu, sc, ac), `liveScene.ts`, `volumetricScene.ts` defaults, `weather.ts` thermo vars, `demTiles.ts`, `demCpu.ts`, and `origin/main` `demTileCache.ts`.
- **Seen from MODIS: nothing.** No imagery was opened and no `gate-*-held.json` file was read; those files carry the per-scene MODIS mean `cover` and correlations, so the freeze must keep them unread. I read only metadata keys and pass flags from the committed `ring/modis-times.json`.
- **Network** (one request per host): GitHub raw, 2 GETs (fastscape `__init__.py` and `orographic_precipitation.py`, sha256 3d924a41…, master branch as of today). S3 Terrarium z6 HEAD returned 200. GIBS WMTS `MODIS_Aqua_CorrectedReflectance_TrueColor/250m` HEAD returned 200, body not read. CMR HEAD returned 200. **Open-Meteo historical returned 429 "Daily API request limit exceeded"**, so this IP's daily budget is already used up.
- **Environment**: `.harness/` is gone, and so are `node_modules` and scipy. numpy 2.5.3 is present. Rebuild needs are in §3.9.
- **Synthetic tests** (numpy only): `bench/oro_core.py`, `oro_test*.py` and `oro_test*.json` in this folder.

## 1. C3: linear orographic transfer functions (exact)

### 1.1 Conventions (fixed; sign tests in §1.4)
- **Grid**: the app grid, n = 128 and Δ = 6 km (box 768 km). **Rows increase northward** (macroField), columns increase eastward, and the observer sits at (n/2, n/2).
- **Fourier transform**: numpy convention, with the inverse using e^{+i(kx+ly)}; k = 2π·fftfreq(n, Δ).
- **Wind**: toward-vector (U, V) in east/north components. From the meteorological "from" direction d and speed S: U = −S sin d, V = −S cos d.
- **Frequencies**: σ = Uk + Vl (minus the intrinsic frequency), K = √(k² + l²), f = 2Ω sin φ.
- **fastscape mapping**: fastscape writes `u0 = −sin(d)·S` and `v0 = +cos(d)·S` on a **north-up raster (row 0 = north)**. That is the meteorological "from" convention with v taken along increasing row, which points south. Its docstring "0: south" is misleading. Porting it onto our row-north grid without negating v is a real bug: in a test, correlation with fastscape fell to −0.50 for a south wind and 0.26 for a south-west wind.
- **fastscape length bug (harmless here)**: `x_len = nx·dx` uses the row count for the column wavenumbers. This only matters for non-square grids; ours are square.

### 1.2 Smith 1980 displacement (hydrostatic or not, with optional f)
η̂(k,l,z) = ĥ_eff(k,l) · D(σ) · e^{i m z}, where m² = K²(N² − σ²)/(σ² − f²). The branch is chosen by regime:

| regime | condition | m |
|---|---|---|
| propagating | f² < σ² < N² | sgn(σ)·√((N² − σ²)/(σ² − f²))·K (upward energy, upstream phase tilt) |
| evanescent | σ² ≥ N² | +i·√((σ² − N²)/(σ² − f²))·K (decays upward) |
| rotational | σ² ≤ f², K > 0 | +i·√((N² − σ²)/(f² − σ²))·K (decays) |
| mean | k = l = 0 | m = 0 |

Low-frequency damping (survey ⑤): D = σ²/(σ² + σ_min²), with σ_min = 2π|V|/200 km. This damping changes the column forcing by 11.5 % rms, so it must be pre-registered.

### 1.3 Smith & Barstad 2004 (as fastscape implements it; the AMS paper text was not read)
- **Precipitation**: P̂ = C_w·iσĥ / [(1 − i m H_w)(1 + iστ_c)(1 + iστ_f)], then P = max(P + P∞, P_min) after the inverse transform. The m here uses the moist N_m.
- **Uplift sensitivity**: C_w = ρ_Sref·Γ_m/γ.
- **Water-vapour scale height**: H_w = R_v T²/(L·γ). At T = 280 K, γ = 6.5 K/km this gives 2.23 km. Clamp to [1.5, 4] km.
- **Cloud water** (no fallout term): q̂_c = τ_c·C_w·iσĥ / [(1 − imH_w)(1 + iστ_c)]. In **displacement units** (C_w drops out): η̂_q = ĥ/(1 − imH_w) · iστ_c/(1 + iστ_c). In the limit τ_c → ∞ this becomes the **moisture-weighted column displacement** η̂_w = ĥ/(1 − imH_w) = (1/H_w)∫₀^∞ η̂(z) e^{−z/H_w} dz.
- **Parameters**: τ_f only enters precipitation, so **cloud cover needs neither τ_f nor C_w**. Typical values [기억]: τ_c ≈ τ_f ≈ 1000 s (range 200 to 2000 s), N_m ≈ 0.005 s⁻¹, H_w ≈ 2.5 km.
- **Branch differences from fastscape**:
  - Evanescent modes: fastscape clips the numerator to 0, giving m = 0.
  - Rotational modes: fastscape takes abs(), giving a real m.
  - With fastscape's branch, my transfer code reproduces `compute_orographic_precip` to a relative rms of ≤ 6e-6 (W, S and SW winds; 6 km and 2 km grids).
  - With the physical branch, results differ by 5 to 20 % rms on raw terrain. **After the s = 10 km high-pass and σ_min damping the difference is 0.06 %**, so it is irrelevant. f also drops out in practice, since σ_min (3.1e-4 s⁻¹ at 10 m/s) is much larger than f (8.8e-5 s⁻¹).
  - Whether S&B 2004 itself includes f is [미확인]; fastscape does include it.

### 1.4 Synthetic findings (`bench/oro_test*.json`)
- **Sign and branch (T1)**: a Witch of Agnesi ridge (a = 10 km, U = 10 m/s, N = 0.01 s⁻¹) at z = λ_z/4 has its maximum η at x = −a, i.e. upstream. This matches the analytic η = h₀a(a cos ℓz − x sin ℓz)/(x² + a²); the residual is 4.6 m (h₀ = 100 m); about 3 m of it is the periodic-box mean and the rest is the non-hydrostatic correction.
- **Two-level mean (1.5 + 3.0 km) on an infinite ridge (T2)**:
  - Amplitude is |cos(ℓΔz/2)| with ℓ = N/U and Δz = 1.5 km. It **cancels completely at U = NΔz/π**: 4.8 m/s for N = 0.010 and 5.7 m/s for N = 0.012. That sits right at the survey's U850 ≥ 5 gate.
  - At N = 0.01 the amplitude is 0.07 at U = 5, 0.48 at U = 7, 0.73 at U = 10 and 0.88 at U = 15 m/s.
  - The phase relative to the terrain is ℓz̄ (z̄ = 2.25 km): 184° at U = 7 and 129° at U = 10. So linear theory puts *descent over the crest* at the cloud levels in typical winds.
- **3-D terrain (T3)**: synthetic field with β = 3 spectrum, rms(h_sub) ≈ 93 m, linear regime with Nh/U between 0.06 and 0.26. Results averaged over 3 seeds, in 12 km blocks:

| N = 0.010 | U = 5 | U = 7 | U = 10 | U = 15 m/s |
|---|---|---|---|---|
| corr(η1.5, η3.0) | −0.49 | −0.56 | −0.26 | +0.18 |
| rms(two-level)/rms(η₀) | 0.51 | 0.48 | 0.62 | 0.77 |
| corr(two-level, h_sub) | −0.11 | −0.44 | −0.56 | −0.19 |
| corr(η1.5, h_sub) | −0.43 | −0.50 | −0.24 | +0.15 |
| corr(column η_w, h_sub) | +0.14 | +0.20 | +0.27 | +0.39 |
| rms(η_w)/rms(η₀) | 0.15 | 0.21 | 0.30 | 0.44 |
| corr(two-level, η_w) | −0.09 | −0.32 | +0.21 | +0.72 |

  At N = 0.012 the picture is the same or worse. At N = 0.006, corr(η1.5, η3.0) is −0.45, −0.10, +0.28 and +0.60 for U = 5, 7, 10 and 15 m/s.
- **Robustness to forecast errors (T3b)**: the table gives the pattern correlation with the reference forcing after perturbing one input.

| forcing | U×1.25 | U×0.8 | N×1.2 | N×0.6 | direction +20° |
|---|---|---|---|---|---|
| two-level, U = 10 | 0.69 | 0.48 | 0.62 | 0.36 | 0.67 |
| two-level, U = 7 | 0.28 | −0.10 | 0.12 | 0.07 | 0.36 |
| column η_w, U = 7 or 10 | ≥ 0.996 | ≥ 0.996 | ≥ 0.997 | ≥ 0.97 | 0.93 |

  For the column forcing, H_w 2.0 against 2.5 km gives 0.997. The column forcing is close to the upslope limit iσĥ/(N K H_w) (pattern correlation 0.94): it is positive on windward flanks and negative on lee flanks. Its pattern hardly depends on U, N or H_w; its amplitude scales roughly as U/(N·H_w).
- **Conclusion**: the survey's "mean of η at 1.5 and 3.0 km" **does cancel and flip sign in typical autumn-morning winds** (U 5 to 10 m/s, N 0.010 to 0.012 s⁻¹). With ±20 % errors in forecast U or N its pattern is not reproducible, so it is invalid as a pre-registered forcing. **Recommendation (decision D1)**: use the S&B moisture-weighted column displacement η_w as the C1 forcing, both in the ruler and in the app (low and mid bands; high unchanged). Report the two-level mean, η(1.5 km) alone, and η_q (τ_c = 1000 s) as sensitivity arms only.

### 1.5 h_eff pipeline (ruler and app use the same function `oroLift.ts`)
1. Get h from Terrarium, then **h = max(h, 0)**. Terrarium includes bathymetry; without the clamp the Japan Trench (−8 km) acts as a "valley". Area-average to 6 km cells, which avoids the aliasing of point sampling. Remove the box mean.
2. Apply a Tukey taper over the outer 16 cells (96 km). The judging window (±90 km) stays at least 290 km from the taper.
3. High-pass: ĥ_sub = ĥ·(1 − e^{−K²s²/2}) with s = 10 km. The half-*amplitude* wavelength is 5.34 s = 53 km and the half-*power* wavelength is 4.0 s = 40 km. The survey's "반출력 53 km" is really the half-amplitude value.
4. Blocking clip: h_eff = clip(h_sub, ±U/N), applied in physical space.
5. η̂_w = ĥ_eff·D(σ)/(1 − i m H_w).
6. Forcing: F = κ·η_w.

Cost: one forward and one inverse 128² FFT for the clip step plus one inverse for the forcing, about 3 to 7 ms on node. This is cheaper than the survey's two levels plus S&B.

### 1.6 Vertical, wind and stability inputs (terrain-following)
- **Reference level**: z_sfc = box-mean NWP surface (from the Open-Meteo `elevation` or the DEM mean over 50 km).
- **Wind**: (U, V) is the wind at the first pressure level with geopotential height ≥ z_sfc + 500 m. For most sites that is 850 hPa. **Denver's surface is about 840 hPa, so 850 hPa is underground there and the 700 hPa wind is used.**
- **Stability**: N² = (g/θ_v)·Δθ_v/Δz between that level and the level about 1.5 km above it (850 to 700 hPa in most places). Use geopotential heights; if they are missing, use the hypsometric equation. Clamp N to [0.003, 0.02] s⁻¹. T̄ is the mean temperature of the same two levels.
- **Moist sensitivity**: N_m = 0.6·N, a proxy for Durran & Klemp 1982 (whose eq. 21 has an erratum).

## 2. C1: coverage-preserving combiner (difference form)

Given B (Barnes base cover in mode 1, per band or total), F = κ·η_w, and G = a Gaussian (σ_G = 20 km, FWHM 47 km), non-periodic and normalised by the in-domain weight:

1. q₀ = Φ⁻¹(clip(B, Φ(−2.5), Φ(2.5))).
2. Find a smooth δ by iterating from δ = 0: δ ← clip(δ − G*[Φ(q₀+F+δ) − Φ(q₀)] / max(G*φ(q₀+F+δ), 1e-6), ±1.5). Stop when **max|G*ΔC| ≤ 0.005** or after 10 iterations. If the residual is still > 0.01, record the scene as "combiner failed" (decided before MODIS).
3. ΔC = Φ(q₀+F+δ) − Φ(q₀), then C = clip(B + ΔC, 0, 1).
4. **If F ≡ 0 (gate off or `macroOro: 0`), return the same buffer B.** This makes the result byte-identical.

**Why the difference form**: the direct form Φ(Q̄ + κη) rewrites B even when F = 0, because the clip is active below 0.0062 or above 0.9938 and floating point drifts. The difference form returns the input exactly. The test (T5) gave `array_equal` = true.

**Measured behaviour**:
- Conservation residual for rms F = 0.29: 0.027, 0.020, 0.015, 0.010 and 0.006 after 1, 2, 3, 5 and 8 iterations. For rms F = 0.12, it is 0.006 after 3 iterations. The box-mean ΔC is about 1e-4.
- corr(ΔC, F) = 0.885.
- With s_rel = 0.15, rms(η_w) of 32 m gives mean |ΔC| = 0.025, and 34 % of 12 km blocks have |ΔC| ≥ 0.02.

**κ**: κ = γ_s(T̄)/s_rel [m⁻¹], with γ_s(T) = LΓ_d/(R_v T²) − g/(R_d T). This is 5.53e-4 at 280 K, 5.99e-4 at 270 K and 5.11e-4 at 290 K; it is the d ln q_s/dz of a parcel lifted dry-adiabatically, which is the right quantity for the total-water PDF.

**s_rel = σ_s/q_s**, one value per scene:
- s_rel = clamp((1 − RH)/(−Φ⁻¹(C_lm)), 0.05, 0.30), used if 0.05 ≤ C_lm ≤ 0.45 and RH < 0.97. Otherwise s_rel = 0.15.
- RH is the mean of the two levels from §1.6. C_lm = 1 − (1 − low)(1 − mid) at the station, a refinement of the survey, which used total cover.
- The lower bound on C avoids Φ⁻¹ → −∞, which would make κ blow up.

**Limitations to record**:
- Where B ≈ 0 or 1 over the whole footprint (φ ≈ 0) there is no freedom, so a cap cloud cannot appear in a forecast-clear box.
- The app shader cannot add cover above the tile cover (`macroShader.ts:99-118`, tile cover = max(station, p75 within 150 km)). The ruler therefore also reports an "app-visible" ΔC capped at that tile cover.
- Mode 2 (V noise) is out of scope; only the default mode 1 is tested.

## 3. RULER-oro: pinned specification

1. **Truth and scenes**: the MODIS bank of 121 scenes, using the committed `ring/modis-times.json` keys as the scene list. Held = 97 scenes at 8 sites. Dev = Seoul and Kanazawa (24 scenes), used for the pipeline only.
   - **Judging set (D2)**: all held applicable scenes, timed by the closest-pass rule; single-pass scenes are also reported separately. Multipass errors only dilute the signal, and single-pass alone risks n < 20.
   - Held scenes (single-pass) at mountain-likely sites: busan 13 (10), denver 12 (11), osaka 13 (8), sapporo 13 (4), sydney 10 (8), lisbon 11 (10).
2. **Inputs**:
   - Ring: the `sceneDir-nwp` blend total cover, interpolated to the MODIS time as in RULER-ringtruth.
   - Station: historical-forecast-api `best_match`, one request per site for the whole date range (about 150 weight in total, versus about 600 for per-scene requests). Variables: T, RH, Z and wind at 1000 to 500 hPa, low/mid/high cover, `elevation` and freezing level.
   - DEM: Terrarium at zoom = `demZoomForRadius(384 km)`, which is z6 except **Hamburg z5** (the z6 tile span at 53.6°N is 372 km, less than 384 km). Use a 3×3 block.
3. **Grid**: 128² × 6 km. B is rebuilt at 128² with the app options. The 3 km truth is averaged 2×2.
4. **Applicability** is computed from inputs only, and its list is hashed into FROZEN **before any MODIS pairing**. A scene applies only if all four conditions hold:
   - rms(h_sub) ≥ 100 m within ±90 km (after the sea clamp, before the blocking clip);
   - |V_ref| ≥ 5 m/s;
   - N² ≥ 1e-5 s⁻²;
   - no directional critical level: V(700)·V̂_ref > 0 and V(500)·V̂_ref > 0.

   Any missing DEM tile also turns the scene off. Non-applicable scenes must give md5(C) = md5(B), and `macroOro: 0` must give identical app textures.
5. **Primary metric**: ρ_res = Pearson(ΔC_b, T_b − B_b).
   - Blocks b are non-overlapping 12 km blocks (2×2 cells) within ±90 km, giving 225 blocks.
   - Only blocks with |ΔC_b| ≥ 0.02 are used, excluding snow-masked blocks.
   - Snow mask: block maximum elevation ≥ forecast freezing level − 300 m. This targets the MODIS snow false positives at Denver and Sapporo in October.
   - A scene needs at least 20 selected blocks, otherwise it is "not applicable"; this is decided without MODIS.
6. **Controls and secondary metrics**:
   - **G-rev** (new guard): ρ_rev uses the same scene with the wind reversed. Snow, valley-fog and terrain-height artefacts are even in the wind and cancel; the upslope and lee signal is odd and doubles. The guard is median(ρ_res − ρ_rev) > 0 with L95 > 0.
   - Secondary metrics:
     - ρ_hp, computed against the high-passed residual (T − B) − G*(T − B); it has the same numerator and more power.
     - Δcorr12, defined as in macro.py (sliding 12 km boxes, ±90 km).
     - Δcorr50 and ΔmeanErr (disc).
     - The windward/lee contrast: sign agreement of mean (T − B) between the top and bottom thirds of η_w.
     - The app-visible ρ.
7. **Statistics and pass rule**:
   - Use the median over scenes, with a date-block bootstrap (13 dates, 10 000 resamples, fixed seed, percentile intervals).
   - **Pass requires all of**:
     - n ≥ 20;
     - median ρ_res > 0 with L95 > 0;
     - median Δcorr12 ≥ 0 with L95 ≥ −0.01;
     - Δcorr50 ≥ −0.01;
     - |ΔmeanErr| ≤ 0.01;
     - G-rev passes;
     - the byte-identity checks pass.
   - Action on the result: pass → the user's 3-scene eye A/B, with the option still off by default; fail → write it up as reference only; n < 20 → "미결". In the n < 20 case, add held mountain-site dates from 2026-10-25 every 4 days until n ≥ 20 or 2026-12-31. These must be Terra only; VIIRS is not a substitute inside this ruler. Terra or GIBS availability in late 2026 is unverified.
8. **Sensitivity** (not used for judging):
   - s = 8 or 15 km; s_rel 0.10 or 0.20; fixed H_w = 2.5 km; τ_c = 1000 s (η_q).
   - The two-level mean 1.5/3.0 km (the survey's original) and η(1.5 km) alone.
   - No blocking clip, or the Sheppard clip max(h_sub − (max h_sub − U/N), 0).
   - N_m = 0.6 N; f = 0; σ_min wavelength 100 or 400 km; σ_G 15 or 30 km.
   - A 64² × 12 km grid, judged at 24 km blocks only.
   - Subgroups by Nh/U (≤ 1, 1 to 3, > 3) and by surface inversion (T925 > T2m).
9. **Rebuilding data and running**:
   - `npm ci` is needed: esbuild bundles `oroLift.ts` and `macroField.ts`, as in `downscale-run.mjs`.
   - Re-run `fetch-sat.py` without looking at the output. GIBS "best" may have reprocessed NRT imagery, so the bank may differ from the original. Check it with a script that prints only counts, comparing against committed aggregates (the `sat-quartiles` medians); it must never print per-scene values.
   - Re-run `fetch-nwp-ring.py --tag blend` (about 3,200 weight).
   - Re-fetch the station profiles (about 150 weight) and the DEM (about 90 tiles, no key).
   - Open-Meteo is currently at its daily limit on this shared IP, so schedule after the reset and resume per site.
   - Freeze with the convention of the earlier rulers: review from three perspectives, then FROZEN.json with hashes of the ruler, `oro.py`, `oro-run.mjs`, `oroLift.ts`, the bundle, the applicability JSON and the tool versions, plus `gateFilesAtFreeze: []`.
10. **Predictions**:
    - The survey's predictions stand: 25 to 40 % of held scenes applicable, median ρ_res +0.05 to +0.15, Δcorr12 +0.00 to +0.03, Δcorr50 ≈ 0 by construction, pass probability about one half.
    - Added: ρ_res − ρ_rev +0.05 to +0.2. The two-level arm, if run, gives ρ ≈ 0 or negative in weak-wind scenes.
    - Per-scene SE(ρ) is about 0.15 to 0.2, so with n ≈ 25 the SE of the median is about 0.05; power is modest.

## 4. C4: boundary-layer regime selector (all scenes; statistics + eye)

### 4.1 Inputs at the render time (or the overpass time for the ruler)
- **zi**: `boundary_layer_height` if not null. It **is null for best_match JMA and ECMWF**, which covers East Asia. Fallback: the parcel method, giving the first height where θ_v(z) > θ_v(2 m) + 0.5 K, using the 15 levels with Z heights, capped at 3 km.
- **U_CBL**: vector mean of the 10 m, 925 and 850 hPa winds that lie below zi (at least the 925 hPa wind).
- **Shear**: bulk shear |V(zi) − V(10 m)|/zi.
- **Surface heat flux**: H_up from `sensible_heat_flux`, ICON or GFS only. The signs differ (ICON negative = upward, GFS positive = upward) and must be normalised to upward-positive. Otherwise use a proxy: sun ≥ 20°, forecast GHI ≥ 300 W/m² and θ_v(2 m) − θ_v(925) ≥ −0.5 K.
- **Other inputs**: CAPE (ECMWF), the LCL from T2m and Td2m (as already in `cloudSkeleton`), and high cover. Optionally −zi/L, with u* from a log law (z₀ = 0.1 m) when H_up exists.
### 4.2 Regimes
These follow Santellanes et al. 2021 and Weckwerth et al. 1997, applied in this order:

| regime | condition | render action |
|---|---|---|
| NONE | not convective (H_up < 20 W/m² or proxy fails), or LCL > zi + 300 m, or no cu/sc low layer, or CAPE ≥ 1000, or precipitation > 0.5 mm/h | none (byte-identical) |
| DISORG | zi < 1100 m | none |
| ROLL | U_CBL ≥ 6 m/s or shear ≥ 2e-3 s⁻¹ (and −zi/L ≤ 25 if available) | stretch (below) |
| CELL | otherwise | none |

Sunset and evening scenes therefore mostly fall into NONE, and C4 acts mainly in daytime. The independent accuracy reported for this tree is 69 to 76 %, and RULER-genus2 found a learned model beat the majority class by only 4.5 points, so the selector's skill must be measured, not assumed.

**Render action (ROLL only)**, respecting §139.4 (skeletons "기둥 같다", the 3:1 roll bands "과장"):
- It is an area-preserving stretch of the existing K0 cu/sc FIELDS coordinates: √a along the axis θ and 1/√a across it.
- The axis θ is the U_CBL direction, with no fixed offset. `rollDirectionDeg`'s −15° offset would have the wrong sign in the southern hemisphere (Sydney).
- The aspect a is chosen once on dev from {1.25, 1.5, 2.0}, with **a cap of 2 (the rejected skeleton was 3:1)**.
- Spacing stays as in §141 `aspectSpacingKm`; no zi-based spacing (§139 lesson 1). The vertical profile, thickness and density shape are not touched.
- No row modulation in round 1.
### 4.3 Metrics
The same code is applied to MODIS and to the render.
- **Field**: a binary mask.
  - MODIS: 96×96 km at 250 m on a km grid (dlon/cos φ as in `fetch-sat.py`), whiteness > 0.45.
  - Render: the CPU top-down cu/sc density of one 24 km periodic tile, thresholded at the quantile that matches the MODIS cloud fraction of that scene.
- **Direction θ and anisotropy A**: take the band-limited 2-D power spectrum over 2 to 12 km (Hann window for MODIS, none for the periodic render). Form J = Σ P·kkᵀ/|k|² and its eigenvalues λ₁ ≥ λ₂. Then A = λ₁/λ₂ and the axis θ = arg(e₁) + 90°. Δθ is the axial difference in [0°, 90°]; under the null it is uniform, so P(Δθ ≤ 30°) = 1/3.
- **Spacing**: λ_s = 2π·ΣP/Σ|k|P over the band 1 to 20 km (1 to 12 km for the render tile). For ROLL scenes also report the cross-axis 1-D peak.
- **Organisation I_org** (Tompkins & Semie 2017):
  - Objects are 8-connected components of at least 4 pixels; take their centroids and the CDF Ĝ of nearest-neighbour distances (border-corrected for MODIS, periodic for the render).
  - With F(r) = 1 − exp(−λπr²), I_org = ∫Ĝ dF.
  - Finite object size biases I_org towards "regular", so also report I_org − I_org,null, where the null is 50 random non-overlapping placements of the same objects. L_org (Biagioli & Tompkins 2023 [기억]) is reported as a check.
- **Truth**: MODIS **Aqua** 250 m Corrected Reflectance (13:30, closer to the peak of the convective boundary layer; GIBS layer reachable). Terra serves as a second set. VIIRS SNPP or NOAA-20 is the fallback after Aqua's end of life (unverified).
  - Keep only scalars per scene: cf, A, θ, λ_s, I_org and object count. **Never keep or compare positions.**
  - Quality filters (pre-MODIS where possible): view zenith ≤ 35° (from granule geometry; pixel growth at swath edges imposes a *scan-direction anisotropy*), forecast high cover < 0.5, 0.05 ≤ cf ≤ 0.8, empty < 5 %.
  - Sites: the same 10, split dev/held as before (half mountain, half not).
### 4.4 Pass rule (all required)
1. **P1, direction**: in held predicted-ROLL scenes with A_MODIS ≥ 1.3 (n ≥ 15), the fraction with Δθ(θ_MODIS, θ_CBL) ≤ 30° must have a date-block L95 above 1/3.
2. **P2, timing**: median A_MODIS in predicted ROLL minus that in predicted non-ROLL convective scenes must be > 0 with L95 > 0.
3. **P3, no exaggeration**: median A_render(C4, ROLL) must lie in [1.1, median A_MODIS(ROLL)]. Spacing must be no worse than K0: |median log(λ_C4/λ_MODIS)| ≤ |median log(λ_K0/λ_MODIS)| + 0.05. I_org must be no worse than K0: |median ΔI_org| ≤ K0's + 0.03.
4. **G, guards**: non-ROLL scenes byte-identical; |Δcf| ≤ 0.005 on the tile; code-level proof that only the (u, v) coordinates change.
5. **E, eye**: the user compares K0 | C4 on ≥ 3 device-reproduced ROLL scenes plus 1 non-ROLL scene. The user decides; "K0 is more natural" means C4 is not adopted.

Also report: the regime confusion matrix against objective MODIS labels (ROLL if A ≥ 1.5 and λ_s in 2 to 15 km; CELL if A < 1.3 and the spectral peak is prominent; else NONE) and accuracy against the majority class. Prediction: P1 fraction 0.45 to 0.6, P2 weak, pass chance one third to one half.

## 5. Free parameters (proposed pre-registered values)

| parameter | value | sensitivity |
|---|---|---|
| grid | 128² × 6 km, box 768 km | 64² × 12 km |
| DEM | Terrarium, `demZoomForRadius(384 km)`, h = max(h, 0), 6 km area mean, Tukey 96 km | — |
| s (h_sub) | 10 km | 8, 15 km |
| blocking | clip ±U/N | none; Sheppard |
| σ_min | 2π\|V\|/200 km | 100, 400 km |
| f | 2Ω sin φ | 0 |
| wind / N levels | first level ≥ z_sfc + 500 m / +1.5 km, θ_v, N ∈ [0.003, 0.02] | N_m = 0.6 N |
| vertical weight | column 1/(1 − imH_w) | two-level 1.5/3.0 km; 1.5 km; τ_c 1000 s |
| H_w | R_v T̄²/(Lγ), clamped [1.5, 4] km; 2.5 km if γ ≤ 0 | fixed 2.5 km |
| κ | γ_s(T̄)/s_rel | — |
| s_rel | inversion from RH and C_lm, clamped [0.05, 0.30]; else 0.15 | 0.10, 0.20 |
| combiner | q-clip ±2.5, σ_G 20 km, δ clip ±1.5, tolerance 0.005 (max 10 iterations; > 0.01 means fail) | σ_G 15, 30 km |
| applicability | rms h_sub ≥ 100 m (±90 km), \|V\| ≥ 5 m/s, N² ≥ 1e-5, no 700/500 hPa reversal | — |
| ρ_res | 12 km blocks, ±90 km, \|ΔC\| ≥ 0.02, at least 20 blocks, snow mask at freezing level − 300 m | ρ_hp |
| bootstrap | date blocks (13), 10 000 resamples, fixed seed | — |
| C4 thresholds | U_CBL 6 m/s, shear 2e-3 s⁻¹, zi 1100 m, H_up 20 W/m², LCL ≤ zi + 300 m, CAPE < 1000 | — |
| C4 action | aspect a from {1.25, 1.5, 2.0} chosen on dev, cap 2, axis = U_CBL | — |
| C4 metrics | band 2 to 12 km (A, θ), 1 to 20 km (λ_s), A_min 1.3, Δθ 30°, box 96 km, view zenith ≤ 35° | — |

## 6. Traps

**From the survey**:
- Blocking with Nh/U > 1 (Fukui 2.4).
- Uniform U and N cannot make trapped lee waves; 5 to 10 km waves are below Nyquist.
- A N² ≤ 0 convective boundary layer is invalid; critical levels occur.
- Double counting of terrain the NWP already resolves (IFS effective 63 to 72 km; s = 10 km still passes 39 % at 63 km).
- Sea and flat scenes give zero.
- Periodic-box stripes.
- MODIS: snow false positives, the thin-cirrus blind spot, a single Terra time, and the unresolved GIBS multipass compositing rule.
- `cell_selection=land` offsets.
- μ alone conserves only the box mean, hence local renormalisation.
- The shader cannot exceed tile cover.

**New in this note**:
- The two-level cancellation (§1.4).
- fastscape's v and row convention, and its m = 0 and abs() branches.
- Terrarium bathymetry.
- 850 hPa below ground at Denver.
- Hemisphere sign of the −15° roll offset.
- BLH null for JMA and ECMWF.
- Opposite SHF signs between ICON and GFS.
- MODIS swath-edge PSF anisotropy biasing θ.
- The GIBS lat-lon grid (needs dlon/cos φ).
- The 500 m true-colour bands make cumulus below 2 km unreliable.
- I_org finite-size bias.
- The 24 km tile periodicity limits the render band to ≤ 12 km.
- Morning valley fog and cold pools can drive ρ negative; they are even in the wind, so G-rev handles them.
- Mercator and equirectangular scale drift: about 1 km in the judging window, up to about 9 to 17 km at the box edges.

**DEM on main** (98affae):
- `getDemTileUri` falls back to the **world z0 base tile for any z/x/y** when offline or after a failed download. A z6 request then silently gets a different, valid 256² PNG, which means wrong terrain with no error.
- After a non-200 download the file may stay cached; this depends on expo `downloadAsync` behaviour and is unverified.
- `demCpu.loadCpuDemBlock` still uses `demTileUrl` without the cache, so that path is safe.
- **`oroLift` must not take tiles from `getDemTileUri`** unless it gains a "no fallback" option. It must require coverage = 1 and treat any missing tile as a = 0.

**Procedure**:
- Do not open the committed `gate-*-held.json` (it contains MODIS cover per scene).
- Compute applicability and ΔC without reading `trueGrid`.
- Derive the scene list from `modis-times.json`.

## 7. Decisions for the user or reviewers (before drafting the ruler)

- **D1**: replace §6's "mean of 1.5 and 3.0 km" with the S&B column η_w, and use the same forcing in the app for the low and mid bands.
- **D2**: judge on all held applicable scenes (closest-pass rule) instead of the single-pass-only convention of ringtruth.
- **D3**: add the G-rev guard and the freezing-level snow mask to the pass rule.
- **D4**: keep C4 minimal: ROLL stretch only, cap 2, axis = U_CBL, no spacing or row changes.
- **D5**: use Aqua 250 m as the C4 truth, with VIIRS as fallback.
- **D6**: schedule the Open-Meteo rebuild (about 3,400 weight) once the shared IP's daily limit resets.

Files (scratch): `bench/oro_core.py` (reference transfer functions and combiner), `bench/oro_test.py`, `oro_test2.py`, `oro_test3.py` and their `.json` results, `dl_fastscape/orographic_precipitation.py` (the downloaded source, sha256 3d924a41…), and `reach/om.json` (the 429 response).
