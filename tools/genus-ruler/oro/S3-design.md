# S3 design — RULER-oro pre-freeze tools (implementation spec)

Status: design for plan S3 (`oro/draft3/plan.md` §1 "S3 목록"), against `RULER-oro.md` draft 3 fix 1 (6f99303, unfrozen). Not frozen, not committed.
This file does not change any rule. Where the ruler is silent or self-inconsistent, §Q lists the reading chosen and the ruler line that supports it. Line refs `Lnnn` are `RULER-oro.md` at 6f99303.

- **S3a (build now)**: `oro_ref.py` (model + builders), `dem-grids.json`, `oro-inputs.json`, `oro-apply.json`, `oro-geom.py` → `cmr-geom.json`, `oro-base.mjs`, `oro-fingerprint.py --bank-manifest/--ring-manifest`, `oro-test.py` (units + G6 (a)–(e) + G8(a) + builder tests).
- **S3b (spec only, build later)**: `oro.py` (§4 metrics, §4.7 statistics, §5 clauses/tags, §9.3 pre-judgement checks, lock, `rulerHash`), `--fill-apply` (λ_app, G7, masked app share, m8 app rms), `--power` → `power-oro.json`, `--sunset` → `sunset-apply.json`, oro-test additions G6 (f)(g)(h), G8 (b)–(f).
- Out of scope here: `g1-baseline.json` (volsky G1 tooling), `oroLift.ts`/`oroDem.ts`/`oro-run.mjs` (post-freeze), FROZEN.json assembly (S4).

What this design looked at: the ruler, plan, draft-1 bench/stat code and notes, the listed tools' source, `dem-manifest.json`/`sounding-manifest.json` heads, `ring/modis-times*.json` keys/times/flags, `regime/sat-times.json.gz` structure (CMR metadata only), one `ring/nwp/blend/busan.json` header (NWP). Two DEM-only prototypes were run in the scratchpad to make sure the G6 (d)/(e) geometry chosen below is passable (numbers quoted with **[proto, DEM only]**). fastscape `orographic_precipitation.py` at the pinned commit was fetched once into the scratchpad to read it and pin its sha256. No MODIS value, scene JSON, PNG, index.json, quartile/gate file or restore log was opened.

---

## 0. Global rules for every S3 tool

### 0.1 Contamination (absolute)
- Never print, log, plot, summarise or open for values: scene keys `trueGrid`, `cover`, `empty`; ring `cover` inside any scene JSON or scene copy (`.harness/macro/sat*`); any `*.png` under `.harness/macro/sat*`/`.harness/oro/sat-*`; `index.json` of a bank; `macro/sat-quartiles.json`; `ring/gate-*.json`, `ring/ringtruth-results.json`; `scratchpad/restore/*`, `.harness/oro/f2.log`, `.harness/oro/f3-run.log`, `.harness/oro/fetch-sat*.log`, `.harness/oro/sat-quartiles-restore.json`.
- Scene JSON is opened **only** by `oro_ref.load_scene_meta()` (allow-list: `site, lat, lon, date, grid, cellKm, ring[].dist, ring[].az`) and by the bank-manifest hasher (hash only). Error messages name keys, never values.
- Do not run `macro.py --gate`, `fetch-modis-time.py`, `eval-ringtruth.py`. Importing **functions** from `fetch-nwp-ring.py`, `fetch-sat.py`, `macro.py` (all `main` guarded) is allowed; from `fetch-modis-time.py` copy, do not import (R-G2).
- **Open guard** (`oro_ref.install_guard()`, called first by every S3 CLI and by `oro-test.py`): `sys.addaudithook` on event `open`; resolve the path relative to repo root; raise `PermissionError("oro guard: <relpath>")` if it matches a forbidden pattern below, unless the matching allow-context is active (`with oro_ref.allow('scene-json')` / `allow('png-hash')`, thread-local flag):
  - `^\.harness/macro/sat[^/]*/[^/]+\.png$`, `^\.harness/oro/sat-[^/]+/[^/]+\.png$` → only `png-hash`
  - `^\.harness/macro/sat[^/]*/(?!index\.json)[^/]+\.json$`, `^\.harness/oro/sat-[^/]+/(?!index\.json)[^/]+\.json$` → only `scene-json`
  - always forbidden: `.../index.json` of those dirs, `^tools/genus-ruler/macro/sat-quartiles\.json$`, `^tools/genus-ruler/ring/(gate-.*|ringtruth-results)\.json$`, `^\.harness/oro/(f2\.log|f3-run\.log|fetch-sat.*\.log|sat-quartiles-restore\.json)$`, `/scratchpad/restore/`, `^\.harness/regime/sat`.
- Stdout: counts, statuses and sha256 only. NWP/DEM numbers may be printed by tests, MODIS-derived numbers never.

### 0.2 Process
- Python: `python3 -I <script>` (no `sys.path[0]`); numpy + Pillow only; cross-file imports by `importlib.util.spec_from_file_location(name, <abs path from __file__>)`.
- JS: node 22, `npx --yes esbuild@0.28.2`.
- No commits. Outputs land in the working tree.
- Determinism: float64 throughout Python; B is Float32 as produced by TS; RNG only in S3b (seeds pinned there); no wall-clock time in any committed output; all JSON written by `oro_ref.dump_json(obj, path)` = `json.dumps(obj, sort_keys=True, indent=1, ensure_ascii=False, allow_nan=False) + "\n"`; floats are Python repr (round-trip exact). Re-running any builder on the same inputs gives byte-identical output (test B-DET).

### 0.3 Pinned conventions (shared by all tools)
| item | pin | ruler |
|---|---|---|
| grid | n = 128, Δ = 6000 m, extent 768 km. Cell (r, c) centre: x = (c + 0.5 − 64)·6 km east, y = (r + 0.5 − 64)·6 km north. **Row 0 = south, col 0 = west.** Observer = shared corner of cells (63..64, 63..64) | L380, L251, `macroField.ts:76-77` and `barnesPass` (cell centre `(x+0.5)·cellKm − half`) |
| array layout | numpy `A[r, c]`, row-major; FFT axis 0 ↔ l (north), axis 1 ↔ k (east) | L382 |
| FFT | `np.fft.fft2` (e^{−i(kx+ly)}), `np.fft.ifft2` (/n²); equals `cloudFlow.ts fft2` (fft1: `−2π/len` forward, `/n` per axis inverse) | L382 |
| wavenumbers | k = 2π·fftfreq(128, 6000) on axis 1, l on axis 0; K = √(k²+l²) | L382, L385 |
| window | rows/cols 49..78 inclusive (30 cells, centres ±3..±87 km, edges exactly ±90 km) | L490, L289 |
| 12 km judging boxes | box (bi, bj), bi, bj ∈ 0..14 = rows 49+2bi..50+2bi × cols 49+2bj..50+2bj; centre (12(bj−7), 12(bi−7)) km (observer-centred tiling); flat index b = 15·bi + bj (south→north, then west→east); box value = mean of its 4 cells | L490 |
| extended box tiling (S3b, c4·c5 masks) | same phase over the full grid: 6 km row r → box row (r + 1)//2 ∈ 0..64 (edge boxes 0 and 64 are half boxes) | L495 |
| wind | Open-Meteo from-direction d, speed S → U = −S sin d, V = −S cos d (toward; east, north) | L384, `weather.ts:896-911` |
| scene key | `<site>_<YYYY-MM-DD>`; parse `rsplit('_', 1)` | — |
| time keys | `closest` = `modisTimeUtc`; `latest` (rule latest); `m1h`/`p1h` = closest ∓/± 3600 s, formatted `%Y-%m-%dT%H:%M:%SZ` | L360, Q-22 |
| bands | `total` (`cloud_cover`), `low`, `mid`, `high`; fractions 0..1 = Open-Meteo % / 100.0 | L214 |
| ring order | fetch-sat `RING`: index 0 = observer (dist 0, az 0), then 5 km × 6 az, then 10/30/70/130/200/280/380 km × 12 az (91) | L361 |
| encodings | `f32b64`: base64 of little-endian float32, row-major, row 0 = south; `f64b64`: base64 LE float64; ring arrays use NaN for null **and** carry `nullIdx` (sorted int list of NaN positions) | L361, L365, Q-20 |
| hashes | sha256 lowercase hex of raw bytes (files) or of the LE byte buffer (arrays) | L363 |
| sites | `fetch-sat.py SITES` (dev: seoul, kanazawa; held: 8). `fetch-dem.py`/`fetch-sounding.py` tables must be identical (U-SITES) | L208 |

### 0.4 Paths
| what | path | git |
|---|---|---|
| DEM tiles | `.harness/oro/dem/{z}_{x}_{y}.png` | ignored |
| soundings | `.harness/oro/sounding.json` (best_match), `.harness/oro/sounding-ecmwf.json` (R11), `.harness/oro/sounding-oro-{pre2,extN}.json` | ignored |
| ring raw | `tools/genus-ruler/ring/nwp/<tag>/<site>.json` (`blend`, `blend-ext`, `blend-pre2`, `blend-extN`) | ignored |
| banks | `orig` = `.harness/macro/sat`, `ext` = `.harness/oro/sat-ext`, `pre2` = `.harness/oro/sat-pre2`, `extN` = `.harness/oro/sat-extN` | ignored |
| times | `ring/modis-times.json`, `ring/modis-times-latest.json` (orig); `oro/modis-times-{ext,pre2,extN}.json` | committed/old |
| B | `.harness/oro/base/<scene>__<timeKey>__<band>.f32` (65,536 bytes) + `.harness/oro/base/index.json` | ignored |
| bundle | `.harness/oro/base-bundle/<commit>/` (extracted TS + `macro.cjs`) | ignored |
| fastscape ref | `.harness/oro/ref/orographic_precipitation.py` | ignored, never vendored |
| CMR extra polygons | `.harness/oro/cmr-extra.json` | ignored |
| test scratch | `.harness/oro/test-tmp/` | ignored |
| committed outputs | `tools/genus-ruler/oro/{dem-grids,oro-inputs,oro-apply,cmr-geom,ring-manifest,bank-manifest}.json`, `oro-test.txt` | working tree |

### 0.5 Build order (S3a; re-runnable)
1. `python3 -I tools/genus-ruler/oro/oro_ref.py dem-grids` → `dem-grids.json`
2. `python3 -I tools/genus-ruler/oro/oro-fingerprint.py --ring-manifest` and `--bank-manifest`
3. `python3 -I tools/genus-ruler/oro/oro_ref.py inputs --banks orig` → `oro-inputs.json` (`bSha256: null`)
4. `node tools/genus-ruler/oro/oro-base.mjs --inputs tools/genus-ruler/oro/oro-inputs.json --commit 115fbe2` (later: the G1 baseline commit; same `macroField.ts`, Q-45)
5. `python3 -I tools/genus-ruler/oro/oro_ref.py seal-inputs` (copies B sha256 into `oro-inputs.json`)
6. `node tools/genus-ruler/oro/oro-base.mjs --inputs … --commit … --check` (exit 0)
7. `python3 -I tools/genus-ruler/oro/oro-geom.py [--fetch-missing]` → `cmr-geom.json`
8. `python3 -I tools/genus-ruler/oro/oro_ref.py apply` → `oro-apply.json`
9. `python3 -I tools/genus-ruler/oro/oro-test.py [--fetch-ref]` → `oro-test.txt`

When the 9 soundings (11-05) and R11 arrive: re-run 3–9 unchanged (1–2 only if DEM/ring/bank changed). Until 10/10 soundings exist, `oro-apply.json summary.provisional = true` and the c1 count is not the §2.7 count (L311, §2.8 ⑦ L352). Pre-freeze extension: re-run 2–9 with `--banks orig,ext` (Q-25).

---

## 1. S3a — `tools/genus-ruler/oro/oro_ref.py`

Pure module + CLI. Imports: numpy, Pillow (DEM only), stdlib; `fetch-nwp-ring.py` (`interp`, `blend`), `fetch-sat.py` (`SITES`, `RING`) via importlib. Every public function below has a test id (§5).

### 1.1 Constants (module level, exact values)
```
N_GRID=128  DX_M=6000.0  HALF_KM=384.0  KM_PER_DEG=111.32
WIN=(49,79)  NBOX=15  TUKEY_CELLS=16  S_HP_M=10000.0  LAMBDA_SMIN_M=200000.0
SIGMA_G_M=20000.0  QCLIP=2.5  DCLIP=1.5  TOL_STOP=0.005  TOL_FAIL=0.01  MAX_IT=10  DEN_FLOOR=1e-6
OMEGA=7.2921e-5  LV=2.5e6  RV=461.5  RD=287.04  G0=9.80665  CP=1004.7  GAMMA_D=G0/CP
N_MIN=0.003  N_MAX=0.02  HW_MIN=1500.0  HW_MAX=4000.0  HW_DEF=2500.0
SREL_MIN=0.05  SREL_MAX=0.30  SREL_DEF=0.15  CLM_LO=0.05  CLM_HI=0.45  RH_MAX=0.97
A1_RMS_M=100.0  A2_SPEED=5.0  A3_N2=1e-5  A7_MIN_S=20  DC_SEL=0.02  SNOW_MARGIN_M=300.0  HI_MASK=0.3
ZREF_RADIUS_KM=50.0  REF_MARGIN_M=500.0  FALLBACK_H=3  SNOW_HOURS=504  RING_NULL_MAX=9  RING_MIN_POINTS=12
TEMP_LEVELS=[1000,975,950,925,900,850,800,750,700,600,500,400,300,250,200]   # fetch-sounding.py
```
Ruler: L65-L74, L389-L449, L289-L296.

### 1.2 Normal distribution (§3.4, L426)
| fn | spec |
|---|---|
| `erf_as(x)` | Abramowitz–Stegun 7.1.26: for x ≥ 0, t = 1/(1 + 0.3275911x), erf = 1 − (a₁t + a₂t² + a₃t³ + a₄t⁴ + a₅t⁵)e^{−x²}, a = (0.254829592, −0.284496736, 1.421413741, −1.453152027, 1.061405429); odd extension. numpy vectorised, float64 |
| `Phi(x)` | 0.5·(1 + erf_as(x/√2)). Note Φ(0) = 0.5000000005 (not exact) |
| `phi(x)` | exact density e^{−x²/2}/√(2π) (Q-7) |
| `Phinv(p)` | Acklam rational approximation, p_low = 0.02425, coefficient sets a(6), b(5), c(6), d(4) as published; **no Halley refinement** (Q-6). Domain (0,1); p outside → ValueError |
| `Q_LO, Q_HI` | `Phi(-2.5)`, `Phi(2.5)` computed at import (= 0.006209680111438021, 0.993790319888562) |

Hand values (U-PHI, abs tol 1e-12 against the approximation, and |Φ_AS − Φ_exact| ≤ 1.5e-7 on a 1001-point grid in [−5, 5] using `statistics.NormalDist`):
Φ(1) = 0.841344736168, Φ(−2.5) = 0.006209680111, Φinv(0.975) = 1.959963986120, Φinv(0.02) = −2.053748909003, Φinv(0.01) = −2.326347874388, Φinv(0.3) = −0.524400513279, Φinv(0.5) = 0 exactly, Φinv(Q_LO) = −2.499999159036.

### 1.3 Smoothing kernels (§3.4 L425, §4.5 L568)
`gauss_smooth(X, sigma_m, mask=None)` — X (128,128) f64.
- 1-D taps i = −R..R with R = floor(3σ/Δ + 1e-9) (σ 20 km → 10; 10 km → 5; 15 km → 7; 30 km → 15), w_i = exp(−(iΔ)²/(2σ²)). Square truncation (separable, Q-4).
- Non-periodic: zero-pad by R; conv along axis 0 then axis 1 (tap order −R..R).
- Normalised: `conv(X·m)/conv(m)` with m = 1 (or the given mask as 0/1). Equals "상자 안 가중합으로 정규화" (separable product of per-axis weight sums).
- Where conv(m) = 0 (only possible with a mask) → NaN (S3b callers handle).
- Test U-G: G*1 ≡ 1 (|·−1| ≤ 1e-12); impulse at (64, 0) has value exactly 0 at cols ≥ 11 (no wrap); symmetric under transpose; tap counts per σ.

### 1.4 DEM decode and resampling (§2.4 L243-L253, §3.2 ①)
`site_dem_grid(site) -> dict` (used by `dem-grids` CLI).
- Tiles: `dem-manifest.json sites[site].blockTiles ∪ boxTiles` (one zoom per site). A tile file missing or whose file sha256 ≠ manifest `tiles[].sha256` → site `complete: false`, all grids null.
- Decode per tile: `np.asarray(Image.open(p).convert('RGB'), float64)`; elev = R·256 + G + B/256 − 32768; **h = max(elev, 0) per pixel** (L246). No despike (Q-29).
- Pixel centre geo: X = 256·tx + px + 0.5, Y = 256·ty + py + 0.5 (px = column, py = row of the tile image, tile row 0 = north), W = 256·2^z; lon = 360·X/W − 180; lat = degrees(atan(sinh(π(1 − 2Y/W)))).
- Box map (fetch-sat equirectangular, L247): dlon = ((lon − lon0 + 540) mod 360) − 180; r = floor((lat − lat0)·111.32/6 + 64); c = floor(dlon·111.32·cos(lat0)/6 + 64); keep 0 ≤ r, c < 128. Each pixel lands in exactly one cell ("pixel centre in cell", Q-29).
- `hmean6[r,c]` = mean of h over its pixels (float64), stored float32. A cell with 0 pixels → error, site incomplete. [proto, DEM only] pixels per cell: min 2 (hamburg z5) … 9, max 16.
- `hmax6[r,c]` = max of h over its pixels. `hmax12[i,j]` (64²) = max of hmax6 over rows 2i..2i+1, cols 2j..2j+1 (even tiling, Q-1).
- `tilesUsed` = tiles contributing ≥ 1 pixel → `{ "z/x/y": sha256 }`.
- Tests: U-DEM1 pixel lon/lat of tile corners equals `fetch-dem.tile_float` inverse (1e-9°); U-DEM2 synthetic 2-tile mosaic with known values → expected means/max; G6(e) orientation (§5.3).

### 1.5 h_eff (§3.2 L388-L393)
`h_sub_field(hmean6) -> (hsub (128,128) f64, a1_rms_m)`
1. h = hmean6.astype(f64) (already ≥ 0); h −= h.mean() (mean over all 128²).
2. Tukey: w[i] = 0.5·(1 − cos(π i/16)) for i = 0..15, w[127−i] = w[i], else 1; h *= outer(w, w) (Q-3). Hand: w[0]=0, w[1]=0.009607, w[8]=0.5, w[15]=0.990393 (U-TUKEY).
3. Ĥ = fft2(h); Ĥ_sub = Ĥ·(1 − exp(−K²s²/2)), s = 10 km; hsub = Re ifft2(Ĥ_sub). Half-amplitude wavelength 2πs/√(2 ln 2) = 53.364 km (U-HP).
4. **A1 value** = sqrt(mean(hsub[49:79, 49:79]²)) (rms, not std). A1 is a site constant. [proto, DEM only] seoul 64.7 m, kanazawa 129.3 m.

`h_eff(hsub, speed, N) = clip(hsub, −speed/N, +speed/N)` (physical space, model N, L393; Q-16).

### 1.6 Column displacement and forcing (§3.3 L395-L409)
`col_weight(k, l, U, V, N, f, Hw, branch='physical') -> (W complex (n,n), kind int8 (n,n))`, W = 1/(1 − i m H_w) computed per branch from real μ to avoid complex inf:
- σ = Uk + Vl; s2 = σ², N2, f2.
- K = 0 → kind 0 (mean), W = 0.
- propagating f2 < s2 < N2: m = sgn(σ)·K·√((N2 − s2)/(s2 − f2)) real, W = 1/(1 − i m Hw).
- evanescent s2 ≥ N2: μ = K·√((s2 − N2)/(s2 − f2)), W = 1/(1 + μHw).
- rotational s2 ≤ f2, K > 0: μ = K·√((N2 − s2)/(f2 − s2)); if f2 − s2 = 0 (σ = 0 with f = 0, or s2 == f2 exactly) μ = ∞ → W = 0.
- `branch='fastscape'` (G6(b) only): num = max(N2 − s2, 0); den = s2 − f2; den ∈ [0, EPS) → EPS, den ∈ (−EPS, 0) → −EPS (EPS = np.finfo(float).eps); sgn = +1 if σ ≥ 0 else −1; m = sgn·√|num/den·K²| (real); W = 1/(1 − i m Hw). This copies fastscape `compute_orographic_precip` exactly.
- `vertical_decay(k, l, U, V, N, f, z)` = e^{imz} branch-wise (propagating e^{imz}, others e^{−μz}, μ = ∞ → 0); used by G6(a).
- Hand values (U-M, rel tol 1e-12), H_w = 2500 m, f = 1e-4:
  - k = 2π/60 km, l = 0, U = 10, N = 0.01: propagating, m = 9.990674045554384e-4, W = 0.13815307042396577 + 0.34506057374959037i; with U = −10: m = −9.9906740e-4, W conjugate.
  - k = 2π/24 km, U = 25, N = 0.003: evanescent, μ = 2.3270487921261152e-4, W = 0.6322062831217485.
  - k = 0, l = 2π/60 km, U = 10, N = 0.01: rotational, μ = 1.0471975511965976e-2, W = 0.03679184151580821; same with f = 0 → W = 0.

`low_sigma_damp(k, l, U, V) = σ²/(σ² + σ_min²)`, σ_min = 2π·|V|/200 km; |V| = 0 → 0 everywhere. Hand: U = 10 → σ_min = 3.1415926536e-4; D = 0.917431192661 at λ = 60 km (along wind), 0.5 exactly at λ = 200 km (U-D).

`eta_w(hsub, snd, lat) -> eta (n,n) f64` (L396-L407):
```
U,V = snd.Vref; speed = hypot(U,V); N = snd.N; f = 2·OMEGA·sin(lat); Hw = snd.Hw
if speed == 0: return zeros
he = h_eff(hsub, speed, N)
E = fft2(he) · low_sigma_damp · col_weight(…)   ;  E[0,0] = 0
return Re ifft2(E)
```
`forcing(hsub, snd, lat) = snd.kappa · eta_w(...)` (σ units of the total-water PDF). G-rev: same with (−U, −V), everything else unchanged (L518).

Edge cases: N² ≤ 0 → snd.N = N_MIN (clip of √max(N²,0)); only reachable when A3 is false. Sensitivity hooks (S3b) are keyword args: `s_m`, `lambda_smin`, `f_override`, `Hw_override`, `N_scale`, `block=('clip'|'none'|'sheppard')`, `vertical=('col'|'two'|'z1500'|'q')`.

### 1.7 Combiner (§3.4 L418-L431)
`combine(B, F) -> dict` — B (128,128) float64 (cast from the Float32 file), F float64.
```
q0 = Phinv(clip(B, Q_LO, Q_HI)); P0 = Phi(q0); delta = 0; it = 0; conv = False
for it in range(1, MAX_IT+1):                      # at most 10 R evaluations inside the loop
    R = G(Phi(q0+F+delta) − P0)                    # G = gauss_smooth(·, 20 km)
    if max|R| ≤ TOL_STOP: conv = True; it −= 1; break   # it = number of δ updates done
    delta = clip(delta − R / max(G(phi(q0+F+delta)), DEN_FLOOR), −DCLIP, DCLIP)
dC_raw = Phi(q0+F+delta) − P0
maxGdC = max|G(dC_raw)|                            # A6 statistic (pre-clip ΔC, Q-5)
C = clip(B + dC_raw, 0, 1); dC = C − B             # metric ΔC (post-clip, L489)
return {C, dC, dC_raw, delta, iters: it (0..10), converged: conv, maxGdC, ok: maxGdC ≤ TOL_FAIL}
```
- F ≡ 0 → R ≡ 0 at the first evaluation → `iters 0`, dC_raw ≡ 0, **C array_equal B** (G6(c)).
- `apply_or_identity(B, F, a)`: a false → return the **same object** B, no computation (L428).
- No RNG; `mulberry32`/state untouched (L430). Same function for G-rev, G-shuf, ρ_rot, app bands, sensitivity (L431).
- Tests: U-COMB1 F ≡ 0 on synthetic B containing exact 0, 1, Q_LO, Q_HI and float32-cast values → array_equal; U-COMB2 iteration semantics on a case that stops after exactly one update; U-COMB3 impossible case (B ≡ 0, F ≡ +3 inside a 20×20 patch) → iters 10, ok False; U-COMB4 box mean of dC over the 768 km box |·| ≤ 1e-3 for a draft-1-like T5 case (s_rel 0.15, rms F ≈ 0.12) and maxGdC ≤ 0.01.

### 1.8 Boxes, masks, Pearson (§4.1, MODIS-free part)
- `box15(X)` → (15,15) means over the window (§0.3).
- `box15_max(hmax6)` → (15,15) max over the 4 cells (Q-1).
- `pearson(a, b)`: n < 2 → None; zero variance in either → 0.0 (L500); else float.
- `masks_input(hmax6, zSnow, Bhigh)` → dict of (15,15) bool: `snow = box15_max(hmax6) ≥ zSnow − 300` (L492; zSnow null → all True, scene fails A5 anyway), `high = box15(Bhigh) ≥ 0.3` (L493). `M = snow | high`. W = ~M. (Empty-pixel mask is judge-time only, S3b, and not part of A7, L498.)
- `sea_box(hmean6)` → (15,15) bool: ≥ 3 of the box's 4 cells have hmean6 == 0.0 (L554).

### 1.9 Sounding interpolation (§2.3 L227-L229)
`interp_fallback(times, values, t) -> (value|None, how)`; `times` = Open-Meteo `'YYYY-MM-DDTHH:MM'` GMT list, t = aware UTC datetime.
- before = nearest hour h ≤ t with values[h] non-null and t − h ≤ 3 h; after = nearest hour h ≥ t, non-null, h − t ≤ 3 h (inclusive bounds, Q-11).
- both and before == after → that value (`exact`); both → linear in time (`linear` if they are the bracket hours ⌊t⌋, ⌊t⌋+1, else `fallback2`); one → that value (`fallback1`); none → None.
- Per variable independently (Q-11). Wind: per hour (U, V) from (speed, dir) valid iff both non-null, then the rule on the vector (Q-10).
- Equivalence: with no nulls and t not on the hour, equals `fetch-nwp-ring.interp` (U-INT0).
- Hand cases (U-INT): series 00:10, 01:null, 02:14 at t = 01:07:30 → 12.25 (`fallback2`); t on the hour; only one side within 3 h; nearest valid at exactly 3 h (included) and 3 h + 1 (excluded) → None.

### 1.10 Thermodynamics (§3.5 L438-L449)
- `e_s(Tc) = 6.112·exp(17.67·Tc/(Tc + 243.5))` hPa (Bolton); e = RH/100·e_s; q = 0.622e/(p − 0.378e); θ = (Tc + 273.15)·(1000/p)^(RD/CP); θ_v = θ·(1 + (RV/RD − 1)·q) (Q-8).
- Hand (U-THERMO, rel 1e-9): (10 °C, 80 %, 850 hPa) → e_s 12.27169599, q 0.007215496886, θ 296.6069909, θ_v 297.9077625; (0 °C, 60 %, 700) → θ_v 303.0520656. With Z 1500/3100 m: N² = 1.0493292871e-4, N = 0.0102436775.
- γ_s(T) = LV·GAMMA_D/(RV T²) − G0/(RD T): γ_s(280) = 5.5241246474e-4, (270) 5.9877619672e-4, (290) 5.1090950928e-4 /m.
- H_w = RV T̄²/(LV γ): (280 K, 6.5e-3 K/m) → 2226.56 m; clip [1500, 4000]; γ ≤ 0 → 2500.
- s_rel: C_lm = 0.28, RH̄ = 0.9 → 0.171573229857; κ(T̄ = 278.15) = 5.606021323011e-4/0.171573229857 = 3.267421921052e-3 /m. RH̄ = 0.7 same C_lm → clipped 0.30.

### 1.11 Freezing level and snow memory (§2.3 L231-L238)
`z0_from_profile(z_sfc, T2m, T{p}, Z{p})` (one profile):
- Needs T2m and, for every p ∈ TEMP_LEVELS with p ≥ 500, Z(p); and T(p) for those with Z(p) > z_sfc. Any missing → None.
- Nodes: (z_sfc + 2, T2m), then (Z(p), T(p)) for p ≥ 500 descending, Z(p) > z_sfc only.
- T2m < 0 → z_sfc. Else first i with T_i ≥ 0 > T_{i+1} → z_i + (z_{i+1} − z_i)·T_i/(T_i − T_{i+1}). None found → Z(500).
- Hand (U-Z0): z_sfc 100, T2m 8; 925 (800 m, 4), 850 (1500, −1), 700 (3100, −9) → 1360.0; T2m −1 → 100; a below-ground level (Z ≤ z_sfc, T < 0) must not create a crossing.
- `z0_at(snd_site, t)`: profile from §1.9-interpolated values at t (oro-inputs `z0`).
- `z_snow_at(snd_site, t)`: hours h on the hour with t − 504 h < h ≤ t (504 stamps); z0 per hour from **raw** hourly values (no interpolation); valid = non-None; count < 252 → z_sfc; else min (U-ZSNOW: window ends, the 251/252 boundary).
- z_sfc = sounding response `elevation` (Q-9).

### 1.12 §3.5 values at time t — `ref_values(snd_site, t, z_ref, lat, ring0_low, ring0_mid) -> dict|None`
1. Interpolate (§1.9): Z, T, RH at 850/700/500; Z and wind at 850/700/600/500; T2m; T, Z at all levels needed by z0 and the inversion flag.
2. `refLevels` L = [p for p in (850, 700) if Z(p) ≥ z_ref + 500] (needs Z850, Z700). Empty → `refEmpty: true`, V_ref/N² null, A2 = A3 = A4 = false (Q-14).
3. V_ref = component mean over L; speedRef = |V_ref|.
4. p_lo = max(L); p_hi = 700 if p_lo == 850 else 500.
5. θ_v lo/hi, θ̄_v mean, N² = (G0/θ̄_v)(θ_v,hi − θ_v,lo)/(Z_hi − Z_lo); N = clip(√max(N²,0), 0.003, 0.02).
6. T̄ (K) = mean(T_lo, T_hi) + 273.15; RH̄ = mean(RH_lo, RH_hi)/100; γ = −(T_hi − T_lo)/(Z_hi − Z_lo).
7. H_w; C_lm = 1 − (1 − ring0_low)(1 − ring0_mid) (blend ring point 0 at t, L445); null → s_rel 0.15 (`sRelBranch: "default-noClm"`, Q-15).
8. s_rel: 0.05 ≤ C_lm ≤ 0.45 and RH̄ < 0.97 → clip((1 − RH̄)/(−Phinv(C_lm)), 0.05, 0.30) (`"inv"`), else 0.15 (`"default"`).
9. κ = γ_s(T̄)/s_rel; f = 2Ω sin(lat).
10. A4: for p ∈ (700, 600, 500) with Z(p) > z_ref (Q-13): dot_p = U_p·Û_ref + V_p·V̂_ref; ok = all dot_p > 0 (speedRef = 0 → false).
11. Inversion flag: lowest p in TEMP_LEVELS with Z(p) > z_sfc; flag = T(p) > T2m (strict) (L305).
12. `complete` = every value used in 2–11 is non-None; `missing` = sorted var names. A5 sounding = complete (L293).
Tests: U-REF on synthetic soundings (Denver-like Z850 < z_ref + 500 → L = [700], p_hi = 500; both levels; empty L; reversed 500 hPa wind → A4 false).

### 1.13 Allow-list and B loaders
- `load_scene_meta(path)` (inside `allow('scene-json')`): `json.load`; build `{site, lat, lon, date, grid, cellKm, ring: [{dist, az}…]}`; `del` the parsed object; never log values. U-ALLOW: a fake scene with `trueGrid`, `cover`, `empty`, ring covers and extra keys returns exactly the allowed keys; builder outputs are byte-identical with and without the fake keys.
- `load_B(scene, timeKey, band, inputs)`: read `.harness/oro/base/<scene>__<timeKey>__<band>.f32`, check sha256 = `inputs…bSha256[band]` (mismatch → raise), `np.frombuffer('<f4').reshape(128,128).astype(f64)`.
- `sun_alt_deg(t, lat, lon)`: verbatim copy of `ring/solar_util.sun_alt_deg` (NOAA approximation with equation of time, the one §2.7 fix 1 cites, Q-30); U-SUN compares with the original on 200 times.

### 1.14 Scene evaluation (§2.6 L286-L308) — `evaluate_scene(name, inputs, dem, geom) -> row`
Uses only `oro-inputs.json`, `dem-grids.json`, `cmr-geom.json`, B files (closest time).
- A1 = site A1 value ≥ 100 m (§1.5).
- A5 = dem complete ∧ snd.complete ∧ every band nullCount ≤ 9 (L216, L293).
- If A5 ∧ ¬refEmpty ∧ speedRef > 0: F, F_rev, dC (combine on B_total), dC_rev, app combines on B_low and B_mid with the same F; masks with zSnow and B_high. Else those fields null and `judge = false`.
- A2 speedRef ≥ 5; A3 N² ≥ 1e-5 (pre-clip value, L291); A4 §1.12.
- A6 judge = combine(B_total, F).ok; A6 app = low.ok ∧ mid.ok (L294, L427).
- A7: |S| ≥ 20 with S = {b ∈ W : |box15(dC)_b| ≥ 0.02} (L498).
- A8 from `cmr-geom.json` (§2).
- `appA` = A1 ∧ A2 ∧ A3 ∧ A4 ∧ A5 ∧ A6app; `judge` = A1 ∧ … ∧ A5 ∧ A6judge ∧ A7 ∧ A8 (L298); `devJudgeable` = judge for dev scenes (G6(f) source, Q-44).
- Counts: |W|, |S|, |S∪| (S∪ = {b ∈ W : |dC_b| ≥ 0.02 ∨ |dC_rev,b| ≥ 0.02}), masked boxes snow/high/both.
- D_dc = pearson over W of box15(F) and box15(B_total − gauss_smooth(B_total, 20 km)) (L573, Q-27).
- preCorr (L541): pearson over S of (box15 F, box15 hsub), (box15 F_rev, box15 hsub), (box15 dC, box15 B_total).
- Splits (L305): crossTrackKm (cmr-geom), ≤ 430 flag; coastShareW = share of W boxes with `sea_box` (Q-26); surfaceInversion (§1.12); NhU = N·max_window|hsub|/speedRef with bins `le1`, `1to3`, `gt3` (Q-17); seam, multiPass, singlePass = ¬multiPass.
- m8 (L307): `member` = held ∧ appA ∧ (¬A7 ∨ ¬A8); `rmsDC` = √mean over the 225 window boxes of box15(dC)² (judge path, post-clip, no mask, Q-18); `rmsDCapp` null (S3b).
- Placeholders filled by S3b `oro.py --fill-apply`: `lambdaApp`, `maskedAppShare`, `G7corr`, `m8.rmsDCapp` (all null in S3a).
- Extension scenes: `sunAltDeg` at closest time; `extSunOk` = sunAltDeg ≥ 20 (L315, inclusive); `extTarget` = site ∈ summary.extTargetSites. `counted` = held ∧ judge ∧ (bank = orig ∨ (extSunOk ∧ extTarget)) (L315, L318); every summary count uses `counted`.
- Scenes whose site has no sounding yet: `snd` null → A2–A4 false, A5 false (`soundingMissing: ["site"]`), F/ΔC fields null; listed in `summary.pendingSites`.

### 1.15 CLI subcommands
`python3 -I tools/genus-ruler/oro/oro_ref.py <cmd> [opts]` — all print counts/sha256 only; exit 0/1.

**`dem-grids`** `[--manifest tools/genus-ruler/oro/dem-manifest.json] [--dem-dir .harness/oro/dem] [--out tools/genus-ruler/oro/dem-grids.json]`
```
{ "schema":"dem-grids/1",
  "grid":{"n":128,"cellKm":6.0,"rows":"south->north","cols":"west->east","observer":"corner of cells 63/64"},
  "mapping":"equirectangular: lat=lat0+y/111.32, lon=lon0+x/(111.32 cos lat0); pixel centre in cell",
  "decode":"R*256+G+B/256-32768; h=max(0,elev) per pixel; no despike",
  "sources":{"demManifestSha256":hex,"oroRefSha256":hex},
  "sites":{ "<site>":{ "lat":f,"lon":f,"zoom":int,"complete":bool,
      "tilesUsed":{"z/x/y":hex}, "pixPerCell":[min,max],
      "hmean6":f32b64(128²) | null, "hmax6":f32b64(128²) | null, "hmax12":f32b64(64², even tiling) | null,
      "a1RmsM": f | null } } }
```
Size ≈ 2 MB (Q-1 explains `hmax6`).

**`inputs`** `[--banks orig[,ext|,pre2]] [--out tools/genus-ruler/oro/oro-inputs.json] [--sounding .harness/oro/sounding.json] [--sounding-ecmwf .harness/oro/sounding-ecmwf.json] [--dem-grids …]`
- Bank table: orig → scenes `.harness/macro/sat`, times `ring/modis-times.json` (+ `modis-times-latest.json`), ring tag `blend`, sounding as given; ext → `.harness/oro/sat-ext`, `oro/modis-times-ext.json`, `blend-ext`; pre2 → `sat-pre2`, `modis-times-pre2.json`, `blend-pre2`, `sounding-oro-pre2.json`; extN (post-freeze, separate `--out oro-inputs-extN.json`) → `sat-extN`, `modis-times-extN.json`, `blend-extN`, `sounding-oro-extN.json`.
- Scene list = bank file **names** (`*.json` except `index.json`, no open) ∩ times keys (L208, L280). Scope = all of them (Q-19). For each scene: `load_scene_meta` and assert lat/lon/date equal SITES/name, grid/cellKm = 256/3.0, ring geometry = RING; ring raw `points` (dist, az) equal RING order.
- `latest` time: orig from `modis-times-latest.json`; ext/pre2/extN derived from the entry's `passes` exactly as `fetch-modis-time.py` (cands = passes with `center`, else all; max `mid`) (Q-21; U-LATEST asserts the derivation equals `modis-times-latest.json` for all 121).
- Ring per time and band: `fetch-nwp-ring.blend(hourly, var, raw['models'])` then `fetch-nwp-ring.interp(times, series, t_iso)`, /100.0; None → NaN (L214).
- Sites without a sounding record: `snd: null`, scene recorded (A5 false, provisional). Same for ecmwf (`sndEcmwf: null` until R11).
```
{ "schema":"oro-inputs/1",
  "grid":{…as dem-grids…}, "ring":{"n":91,"order":"fetch-sat RING, observer first","encoding":"f64b64 LE, NaN=null, nullIdx"},
  "sources":{ "demGridsSha256":hex, "times":{"<path>":hex}, "ringRaw":{"<tag>/<site>":hex},
              "sounding":{"bestMatch":{"path":s,"fileSha256":hex,"manifestSha256":hex,"sites":[…]},"ecmwf":null|{…}},
              "code":{"oro_ref.py":hex,"fetch-nwp-ring.py":hex,"fetch-sat.py":hex} },
  "scenes":{ "<site>_<date>":{
      "site":s,"lat":f,"lon":f,"date":s,"group":"dev|held","bank":"orig|ext|pre2",
      "multiPass":b,"seam":b,"ringGeom":{"dist":[91 int],"az":[91 int]},
      "demTiles":{"z/x/y":hex}, "zSfc":f|null, "zRef":f,
      "times":{ "closest|latest|m1h|p1h":{
          "utc":"YYYY-MM-DDTHH:MM:SSZ",
          "ring":{"total|low|mid|high":{"f64":f64b64(91),"nullIdx":[int]}},
          "snd": REF|null, "sndEcmwf": REF|null,
          "z0":f|null, "zSnow":f|null, "zSnowValidHours":int,
          "bSha256":{"total|low|mid|high":hex|null}|null } } } } }
REF = { "model":"best_match|ecmwf_ifs025","complete":b,"missing":[s],
        "levels":{"850|700|600|500":{"T_C":f|null,"RH_pct":f|null,"Z_m":f|null,"U":f|null,"V":f|null}},
        "interpHow":{"<var>":"exact|fallback2|fallback1"}   (only non-linear entries),
        "T2m_C":f, "refLevels":[int], "refEmpty":b, "Vref":[U,V]|null, "speedRef":f|null,
        "pLo":int|null,"pHi":int|null,"thetaV":[lo,hi]|null,"N2":f|null,"N":f|null,
        "Tbar_K":f|null,"RHbar":f|null,"gamma_Kpm":f|null,"Hw_m":f|null,
        "Clm":f|null,"sRel":f,"sRelBranch":"inv|default|default-noClm","gammaS":f|null,"kappa":f|null,"f":f,
        "A4":{"dots":{"700|600|500":f},"ok":b}, "inversion":{"level":int,"flag":b}|null }
```
z0/zSnow are best_match only (the ecmwf arm uses the same masks, Q-46). Size ≈ 2–3 MB for 121 scenes × 4 times.

**`seal-inputs`** `[--inputs …] [--base-index .harness/oro/base/index.json]`: require index `inputsFileSha256` = sha256 of the current `oro-inputs.json` bytes (B was built from exactly this file; oro-base ignores `bSha256`, so building from a sealed file is equivalent); if `bSha256` is already filled it must equal the index (idempotent re-seal); copy every sha256 into `times[*].bSha256`; rewrite with `dump_json`.

**`apply`** `[--inputs …] [--dem-grids …] [--cmr-geom …] [--base .harness/oro/base] [--out tools/genus-ruler/oro/oro-apply.json]`
```
{ "schema":"oro-apply/1",
  "sources":{"oroInputsSha256":hex,"demGridsSha256":hex,"cmrGeomSha256":hex,"baseIndexSha256":hex,"oroRefSha256":hex},
  "constants":{…§1.1 thresholds…},
  "scenes":{ "<name>":{
     "site","date","group","bank","singlePass","multiPass","seam",
     "A1":{"rmsM":f,"ok":b}, "A2":{"speed":f|null,"ok":b}, "A3":{"N2":f|null,"ok":b}, "A4":{"dots":{…},"ok":b},
     "A5":{"dem":b,"sounding":b,"soundingMissing":[s],"ringNull":{"total|low|mid|high":int},"ok":b},
     "A6":{"judge":{"iters":int,"converged":b,"maxGdC":f,"ok":b}|null,
           "app":{"low":{…},"mid":{…},"ok":b}|null},
     "A7":{"S":int|null,"ok":b}, "A8":{"ok":b,"status":s},
     "appA":b, "judge":b, "counted":b, "devJudgeable":b|null,
     "counts":{"W":int,"S":int,"Scup":int,"maskedSnow":int,"maskedHigh":int,"maskedBoth":int}|null,
     "Ddc":f|null, "preCorr":{"F_hsub":f|null,"Frev_hsub":f|null,"dC_B":f|null}|null,
     "split":{"crossTrackKm":f|null,"crossTrackLE430":b|null,"coastShareW":f|null,"surfaceInversion":b|null,"NhU":f|null,"NhUBin":s|null},
     "m8":{"member":b,"rmsDC":f|null,"rmsDCapp":null},
     "lambdaApp":null,"maskedAppShare":null,"G7corr":null,
     "sunAltDeg":f,"extSunOk":b|null,"extTarget":b|null } },
  "summary":{
     "provisional":b, "pendingSites":{"sounding":[s],"ring":[s]}, "ecmwfArm":"available|못 잼(미수신)",
     "n":int, "nDates":int, "nSites":int, "perSite":{"<site>":int}, "maxSiteShare":f,
     "c1":{"n>=20":b,"dates>=8":b,"sites>=3":b,"maxShare<=0.5":b,"pass":b},
     "nSinglePassJudge":int, "gshufSites":[s], "gshufScenes":int, "c3bMeasurable":b,
     "devJudgeable":[name], "extTargetSites":[s],
     "m8":{"count":int,"scenes":[name]},
     "DdcMedian":f|null, "primaryMetric":"rho_res|rho_fine",
     "lambdaAppMedian":null, "lambdaTilde":null, "maskedAppShareMedian":null, "G7median":null } }
```
- n, dates, sites, shares count **held** judge scenes (orig + counted ext). gshufSites = held sites with ≥ 3 judge scenes; gshufScenes = their judge scenes; c3bMeasurable = gshufScenes ≥ 10 (L306, L355). extTargetSites = held sites with A1 true (L314). primaryMetric = `rho_fine` iff DdcMedian ≥ 0.3 (L574; the FROZEN `decisions` copy is S4).
- Summary is recomputable from rows (test B-SUM).

---

## 2. S3a — `tools/genus-ruler/oro/oro-geom.py` → `cmr-geom.json` (A8, m3)

`python3 -I tools/genus-ruler/oro/oro-geom.py [--times tools/genus-ruler/ring/modis-times.json] [--bank orig|ext|pre2] [--sat-times tools/genus-ruler/regime/sat-times.json.gz] [--fetch-missing] [--cache .harness/oro/cmr-extra.json] [--out tools/genus-ruler/oro/cmr-geom.json]`

| id | function | spec |
|---|---|---|
| R-G1 | `pass_granules(entry)` | Regroup `entry.times` (granule `time_start` strings) sorted; new group when gap > 1800 s; mid = first + (last + 5 min − first)/2; return the group whose mid formatted `%Y-%m-%dT%H:%M:%SZ` == `modisTimeUtc`. `source == 'solar'` or no match → status `no-pass`, A8 false |
| R-G2 | `point_in_poly(lat, lon, poly)` | verbatim copy of `fetch-modis-time.py:point_in_poly` (longitude wrap). Test U-GEOM0 compares the copied text with the function text read from `fetch-modis-time.py` as text (no import) |
| R-G3 | polygons | `sat-times.json.gz` (gzip JSON): queries with `sat == 'terra'`, `site`, period containing the date; granule with `time_start == start` and `day_night_flag == 'DAY'`; each string in `polygons[*]` → list of (lat, lon) pairs (same parse as fetch-modis-time). Terra only |
| R-G4 | missing granules | sat-times used CMR `point=` queries, so pass granules not containing the site are absent (Q-23). If any corner is outside the available polygons **and** the pass has granules not in sat-times: with `--fetch-missing` query `https://cmr.earthdata.nasa.gov/search/granules.json?short_name=MOD03&temporal=<start>,<start+299 s>&page_size=50` (≥ 1 s between queries, 3 failures → exit 2, cache in `.harness/oro/cmr-extra.json`); without it → status `missing-granules`, A8 null, and `apply` refuses to build |
| R-G5 | corners | (lat0 ± 90/111.32, lon0 ± 90/(111.32 cos lat0)), order SW, SE, NE, NW (window edges, L490) |
| R-G6 | A8 | all four corners inside ∪ polygons of the pass granules (L296) |
| R-G7 | cross-track | Granule of the pass containing the site (first by time; none → nearest polygon centroid). Opposite-edge pairs {p0p1, p2p3}, {p1p2, p3p0}; the cross-track pair is the pair whose mean initial bearing is farther from north–south (Terra sun-synchronous, |lat| ≤ 54°, Q-24). Track = great circle through the midpoints of the two cross-track edges; crossTrackKm = |asin(sin(d₁₃/R) sin(θ₁₃ − θ₁₂))|·R, R = 6371.0 km |

```
{ "schema":"cmr-geom/1",
  "sources":{"timesSha256":hex,"satTimesSha256":hex,"cmrExtraSha256":hex|null},
  "rules":{"passGapS":1800,"granuleMin":5,"corners":"±90 km equirectangular","sat":"terra/MOD03"},
  "scenes":{ "<name>":{ "site","date","modisTimeUtc","passMid",
       "granules":[{"start":s,"end":s|null,"polygons":[[[lat,lon],…]],"source":"sat-times|cmr"}],
       "corners":[[lat,lon]×4], "cornersInside":[b×4], "A8":b|null,
       "siteGranule":s|null, "crossTrackKm":f|null, "status":"ok|no-pass|missing-granules" } } }
```
Tests: U-GEOM1 synthetic quad polygon (corner in/out, antimeridian wrap); U-GEOM2 all 121 scenes get a status, counts per status printed (no corner coordinates printed); U-GEOM3 cross-track = 0 for a site on a synthetic track and ≈ 1165 km at a swath edge (± 2 %).

---

## 3. S3a — `tools/genus-ruler/oro/oro-base.mjs` (§3.4 L412-L417)

`node tools/genus-ruler/oro/oro-base.mjs --inputs <oro-inputs.json> --commit <sha> [--out .harness/oro/base] [--scenes a,b] [--check]`

1. Extract at `<commit>` with `git show <commit>:<path>` (child process) into `.harness/oro/base-bundle/<commit>/`: `src/utils/macroField.ts`, `src/components/VolumetricProbe/cloudFlow.ts`, `src/components/VolumetricProbe/cloudGenus.ts` (type-only import of cloudFlow).
2. Write `entry.ts`: `export { buildMacroField, samplesFromRing } from './src/utils/macroField.ts';`
3. `npx --yes esbuild@0.28.2 entry.ts --bundle --format=cjs --platform=node --outfile=macro.cjs --log-level=warning` with cwd = that dir (relative paths in bundle comments are then commit-independent).
4. Refuse if the bundle matches `/require\(["'](three|react-native)["']\)|from\s*["'](three|react-native)["']/`. Print `BUNDLE <sha256> esbuild 0.28.2 node <version> commit <sha>`.
5. Read **only** `--inputs` (via `fs.readFileSync`; module must use `import fs from 'node:fs'` so G8(a) can hook it). Ignore every key except `scenes.*.ringGeom`, `scenes.*.times.*.ring` (and `bSha256` in `--check`).
6. For each scene (sorted) × time (sorted) × band ∈ [total, low, mid, high]: decode f64; points = indices with finite values; fewer than 12 → B null (app rule `pts.length >= 12`, Q-31); else
   `samples = samplesFromRing(points.map(i => ({distance: dist[i], azimuthOffset: az[i], cover: c[i]*100})))`,
   `B = buildMacroField(samples, {n: 128, cellKm: 768/128, noise: false}).base` (the `applyScene` call; state null).
7. Write `<out>/<scene>__<time>__<band>.f32` = `Buffer.from(B.buffer)` (assert `os.endianness() === 'LE'`); print `B <scene> <time> <band> <sha256>`.
8. Write `<out>/index.json` (sorted keys): `{schema:"oro-base-index/1", commit, bundleSha256, esbuild:"0.28.2", node, inputsFileSha256: sha256 of the raw input file bytes read, entries:{scene:{time:{band:hex|null}}}}`.
9. `--check`: rebuild in memory, compare with `bSha256` in the inputs; print `CHECK same <n> diff <m> null <k>`; exit 1 if m > 0 (§9.3 ④ 5 is S3b).

Test G8(a) (in oro-test.py, §5.4).

---

## 4. S3a — manifests in `tools/genus-ruler/oro/oro-fingerprint.py` (new modes; existing `--f1/--f2/--f3` untouched)

- `--ring-manifest [--tags blend[,blend-ext,blend-pre2]] [--manifest-out tools/genus-ruler/oro/ring-manifest.json]` (L374):
  `{schema:"ring-manifest/1", tags:{"<tag>":{"<site>":{path, sha256, bytes, nPoints:91, models:[…], endpoint, nHours, firstHour, lastHour}}}}`. Reads raw NWP files (allowed).
- `--bank-manifest [--banks orig[,ext,pre2]] [--manifest-out tools/genus-ruler/oro/bank-manifest.json]` (L375):
  `{schema:"bank-manifest/1", banks:{"<bank>":{dir, n, scenes:{"<name>":{jsonSha256, jsonBytes, trueGridSha256, pngSha256|null, pngBytes|null, inTimes:b}}}}}`.
  JSON file bytes hashed; then (inside `allow('scene-json')`) `json.load`, `trueGridSha256 = sha256(sc['trueGrid'].encode('ascii'))`, `del sc` — never base64-decoded, never printed. PNG: `open(p,'rb').read()` inside `allow('png-hash')`, hashed, never passed to Pillow. Prints counts only.
- Post-freeze extN writes `ring-manifest-extN.json`, `bank-manifest-extN.json` (L333).

---

## 5. S3a — `tools/genus-ruler/oro/oro-test.py` → `oro-test.txt`

`python3 -I tools/genus-ruler/oro/oro-test.py [--fetch-ref] [--only <ids>] [--out tools/genus-ruler/oro/oro-test.txt]`. Installs the guard. Each test prints one line `ID PASS|FAIL|SKIP <key=value…>` (MODIS-free values only, fixed formatting `%.6g`); the file is these lines sorted by id, no timings. Exit 0 iff no FAIL; SKIP is not a pass for the §9.1 ⑨ freeze threshold.

### 5.1 Unit tests (formula vs hand values; all listed in §1)
U-PHI, U-G, U-TUKEY, U-HP, U-WIND (from 0/90/180/270/225 at 10 m/s → (0,−10), (−10,0), (0,+10), (+10,0), (7.0710678,7.0710678)), U-M, U-D, U-THERMO, U-INT0, U-INT, U-Z0, U-ZSNOW, U-REF, U-COMB1..4, U-BOX (box (7,7) centre (0,0); rows 49..78; flat order), U-DEM1/2, U-ALLOW, U-LATEST, U-SITES, U-SUN, U-GEOM0..3, U-HASH (dump_json determinism, f32b64/f64b64 round trip, NaN↔nullIdx).

### 5.2 Builder tests
- **B-SYN**: synthetic sounding file for all 10 sites (generator in oro-test: standard atmosphere T = 15 − 6.5 z/km °C, Z(p) = 44330.8(1 − (p/1013.25)^0.190263), RH 70 %, wind from 270° 10 m/s at all levels, elevation 0, 06-01..10-31 hourly, injected nulls at fixed hours to exercise fallback1/fallback2/None) → `inputs` and `apply` into `.harness/oro/test-tmp/`; schema checks, every scene has snd, L = [850, 700], N² ≈ 1.1e-4.
- **B-DET**: run `inputs` twice → byte-identical; `apply` twice → byte-identical.
- **B-BUSAN**: real `sounding.json` (busan only): busan scenes complete, other sites `snd: null`, `summary.provisional = true`, pendingSites = 9 sites.
- **B-RING**: for 3 scenes, closest total ring f64 = `fetch-nwp-ring.interp(...)/100.0` bit-exact.
- **B-SUM**: summary recomputed from rows equals the stored summary.
- **B-BASE**: `oro-base.mjs --check` exit 0; every B in [0, 1], finite.

### 5.3 G6 (a)–(e) (L759-L763; pinned additions are Q-32..Q-35)
- **G6(a) Witch of Agnesi**: grid 512² × 2000 m, x_i = (i − 256)Δ (crest on a node), h₀ 100 m, a 10 km, U 10 m/s, N 0.01, f = 0, mean mode zeroed. η(z) = Re ifft2(ĥ·`vertical_decay`) at z = λ_z/4 = (π/2)U/N = 1570.8 m. Eight cases = 2 ridges (h(x), h(y)) × 4 winds (toward +x, −x, +y, −y):
  - 4 perpendicular cases: along-wind coordinate s = ±x or ±y; on |s| ≤ 100 km, max|η − η_a| ≤ 5 m with η_a = −h₀ a s/(s² + a²); argmax η at s = −a (upwind); η_w (col_weight, D(σ) with |V| = 10, H_w 2500, no HP/taper/clip) has η_w(s = −a) > 0 > η_w(s = +a).
  - 4 parallel cases: max|η| ≤ 1e-9 m and max|η_w| ≤ 1e-9 m.
- **G6(b) fastscape**: `--fetch-ref` downloads `https://raw.githubusercontent.com/fastscape-lem/orographic-precipitation/baf8a0c13855fdef88b4ad995fd59c6e69834e00/orographic_precipitation/orographic_precipitation.py` (urllib like `fetch-dem.py`, 3 tries) into `.harness/oro/ref/` (that file only); sha256 must be `3d924a41b4032ec019686f1ff96d5871a557bda498913837515dd929aae8e98d` (same as draft-1 method.md §0), else FAIL; never vendored. Loaded by importlib (it imports only numpy). Terrain: draft-1 `synth_terrain(128, 6000, beta=3, rms=400, seed=7)`, h −= h.min(). Params: latitude 37, wind_speed 10, wind_dir 270/180/225, nm 0.01, hw 2500, conv_time = fall_time = 1000, cw 0.004, **precip_base 1e4, precip_min 0** (keeps P > 0 so `P[P<=0]=precip_min` never fires). P_fs = (fs(h[::-1], 6000, 6000, …)[::-1] − 1e4)/3600 (fastscape raster row 0 = north). Ours: pad = `min(int(np.ceil(sum(h.shape)/2)/100*100), 200)` (fastscape's expression), zero pad, kgrid on the padded size, (U, V) = wind_to_uv(10, d) (our V = −S cos d: fastscape's v0 = +S cos d points along increasing row = south, L386), `col_weight(branch='fastscape')`, P̂ = cw·iσĥ·W/((1 + iστ_c)(1 + iστ_f)), de-pad. Criterion: rms(P − P_fs)/std(P_fs) ≤ 1e-5 for all three winds (Q-33). Also record the physical-branch value (report).
- **G6(c)**: U-COMB1 plus, if B files exist, `combine(B, 0)` array_equal for the first 3 scenes (sorted) × 4 bands; `apply_or_identity(B, F, False) is B`.
- **G6(d) known mountains**: dev DEM grids; synthetic sounding: from 270° 10 m/s (and from 90° as the mirror), N 0.01, H_w 2500, κ = γ_s(280)/0.15. Peak cell = argmax hmean6 within 20 km of Hakusan (36.1550°N, 136.7714°E; kanazawa) and Odaesan (37.7944°N, 128.5431°E; seoul, "서울 동쪽 산지"). West band = cells with x ∈ [x_p − 24, x_p − 6] km, |y − y_p| ≤ 12 km; east band x ∈ [x_p + 6, x_p + 24]. PASS iff mean F(west) > 0 > mean F(east) for the westerly and the reverse signs for the easterly, both mountains. [proto, DEM only] westerly: Hakusan +0.112/−0.137, Odaesan +0.071/−0.103.
- **G6(e) DEM orientation + wind**: kanazawa hmean6: sea fraction (h == 0) of cells with x ∈ [−90, −30], y ∈ [30, 90] km (NW) ≥ 0.9 and of x ∈ [30, 90], y ∈ [−90, −30] (SE) ≤ 0.1. [proto] NW 1.00, SE 0.00, NE 0.73, SW 0.51 (a row or column flip fails). Wind: U-WIND hand values, plus the busan sounding at t = 2026-09-01T01:00Z (on the hour, so no interpolation): (U, V) of 700 hPa from `ref_values` has bearing atan2(U, V) ≡ d₇₀₀ + 180° (mod 360, 1e-9°) and |V| = S₇₀₀ of that hour; SKIP if busan sounding missing.

### 5.4 G8(a) — oro-base allow-list (L755)
- Copy `oro-inputs.json` to test-tmp with fake `trueGrid`, `cover`, `empty` keys injected at top, scene and time level; run `oro-base.mjs --scenes <3 scenes> --out <tmp>` on both → all B sha256 identical.
- Run with `node --require <test-tmp>/fs-audit.cjs` (wraps `fs.readFileSync/openSync/readFile/createReadStream/existsSync`, logs paths): opened paths ⊆ {inputs copy, bundle file, node internals}; none under `.harness/macro/`, `ring/nwp/`, `*.png`, `sounding*.json`.
- Python side: U-ALLOW (above).

---

## 6. S3b — `tools/genus-ruler/oro/oro.py` (spec only)

Imports `oro_ref.py` (all model code, never re-implemented) and from `macro.py` only `load_u8`, `box_mean`, `corr` (by importlib). CLI modes:

| mode | when | output |
|---|---|---|
| `--fill-apply` | pre-freeze, MODIS-free | rewrites `oro-apply.json`: per scene `lambdaApp`, `G7corr`, `maskedAppShare`, `m8.rmsDCapp`; summary `lambdaAppMedian`, `lambdaTilde`, `G7median`, `maskedAppShareMedian` |
| `--power` | pre-freeze | `tools/genus-ruler/oro/power-oro.json` |
| `--sunset` | pre-freeze | `tools/genus-ruler/oro/sunset-apply.json` |
| `--ruler-hash` | any | prints `rulerHash` |
| `--precheck` | post-freeze | §9.3 ④ 1–7 + T-read precheck, no T read, no lock; exit code |
| `--judge` | once, post-freeze | `tools/genus-ruler/oro/gate-oro-held.json` (with a `dev` report block) |

### 6.1 App path arm (§4.4 L544-L548) — used by `--fill-apply` and the judge
- `app_arm(scene, time)`: B_lo, B_mid, B_hi (closest), C_lo = combine(B_lo, F).C, C_mid = combine(B_mid, F).C (own δ each), C_hi = B_hi. ΔC^app = [1 − (1−C_lo)(1−C_mid)(1−B_hi)] − [1 − (1−B_lo)(1−B_mid)(1−B_hi)] (cells, then box15).
- `tau_band(ring_band, first)`: port of `macroTileCover` (`volumetricScene.ts:1028-1033`): finite points < 12 → first; near = sorted clamp[0,1] covers with dist ≤ 150 km (observer included); len < 6 → first; else max(first, near[min(len−1, floor(0.75·len))]). first = that band's ring point 0 value; null → 0 (Q-36).
- C^vis_band = min(C_band, τ_band), B^vis likewise; C^vis = 1 − (1−C^vis_lo)(1−C^vis_mid)(1−B^vis_hi); ΔC^vis = C^vis − B^vis.
- λ_app = Σ_W ΔC^app_b ΔC_b / Σ_W ΔC_b² (box values); λ̃* = max(1, median over held judge scenes) (L510-L511).
- G7corr = pearson_W(box15 ΔC, box15 ΔC^app); G7 pass iff median ≥ 0.7 (L754).
- maskedAppShare = Σ_{b∈M}(ΔC^app_b)² / Σ_{225}(ΔC^app_b)² (L308, L564); m8.rmsDCapp = √mean_225(ΔC^app_b²).

### 6.2 Truth and judge-time masks (only inside `--judge`, after the lock)
- `load_truth(scene)` (inside `allow('scene-json')`): `trueGrid` → `load_u8(…, 256)` → flip rows (fetch row 0 = north) → 2×2 mean → T (128,128) (L488).
- `empty_cells(png)` (inside `allow('png-hash')` + a new `allow('png-judge')`): Pillow RGB 256² (3 km px), flip rows; empty px = R = G = B = 0; dark px = max(RGB)/255 < 0.02 and not empty (report). A 12 km box (4×4 px; window box (bi,bj) = 3 km rows 98+4bi..101+4bi) with ≥ 1 empty px is removed from W, S, S∪; then |S| < 20 → scene dropped and counted (L345-L347).
- Scenes without `trueGrid` → dropped and counted (L343). c1 is evaluated on the finally judged set.

### 6.3 Per-scene metrics (§4.1–§4.6), r = T − B_tot, ΔC = C − B (post-clip), box values over the stated set
| name | definition | ruler |
|---|---|---|
| ρ_res | pearson_S(ΔC, r) | L503 |
| β_res, ΔMSE_W, ΔMSE_W(λ) | Σ_W ΔC r/Σ_W ΔC²; mean_W(ΔC² − 2ΔC r); mean_W(λ²ΔC² − 2λΔC r) | L505-L513 |
| d (G-rev) | pearson_S∪(ΔC, r) − pearson_S∪(ΔC_rev, r); either None/0-var → d = 0; G-rev combiner failed → d = 0 | L519, L354 |
| ρ_even, ρ_odd | (ρ′_res ± ρ′_rev)/2 on S∪ | L525 |
| d_shuf,j | for sites with ≥ 3 judge scenes: F_{j\|k} from site DEM + k's `snd` (V_ref, N, H_w, κ, s_rel as stored; f from site lat), combine on B_j; k with failed combiner skipped; ρ̄ = mean_k pearson_W(ΔC_{j\|k}, r_j); d_shuf = pearson_W(ΔC_j, r_j) − ρ̄; all k skipped → j excluded | L526-L535, L354, Q-38 |
| ρ_rot | F from `np.rot90(hmean6, 2)` (180° about the observer corner, exact on this grid), same snd and B; pearson_S∪(ΔC_rot, r); combiner fail → excluded from its median | L539, Q-39 |
| ρ_res^vis, ΔMSE^vis | pearson_S(ΔC^vis, T − B^vis); mean_W((C^vis − T)² − (B^vis − T)²) | L550 |
| L⁻ | strata: sea = `sea_box` ∩ W; land = rest of W split by box-mean h at np.quantile([1/3, 2/3]) (linear), h ≤ q₁ → 1, ≤ q₂ → 2, else 3. Lee = {b ∈ S: ΔC_b ≤ −0.02}, N = {b ∈ W: \|ΔC_b\| < 0.02 ∧ \|ΔC_rev,b\| < 0.02}; L⁻ = Σ_t w_t(mean_{Lee_t} r − mean_{N_t} r), strata with \|Lee_t\| > 0 ∧ \|N_t\| > 0, w_t ∝ \|Lee_t\|; none → 0. Report: window-mean form, sea-agnostic tertile form, L⁻^vis | L551-L562 |
| ρ_fine, ρ_coarse | m = 1 on unmasked 6 km cells (M via the extended tiling); X_coarse = G₁₀(X·m)/G₁₀(m) (`gauss_smooth(…, 10 km, mask)`); fine = X − coarse for X ∈ {ΔC, r} (and ΔC_rev, ΔC_{j\|k} when the primary is fine); box15; pearson_S; sets S/S∪/W from total ΔC | L567-L576 |
| Δcorr12, Δcorr50, ΔmeanErr (masked) | C, B → 256² bilinear: 3 km cell c ↦ 6 km coordinate c/2 − 0.25, clamped to [0, 127] (macroField `sampleGrid` style, Q-40); M → 3 km 4×4 per box (extended tiling). corr12: `box_mean(·,4)` on 3 km rows/cols 98..157, positions whose 4×4 window touches a masked cell removed; corr50: `box_mean(·,17)` masked mean Σ(Xm)/Σm, positions with Σm < half the window count removed; meanErr: disc (cell centre r ≤ 380 km) ∩ unmasked; Δ = (C vs T) − (B vs T). Unmasked versions reported | L583-L585 |
| ρ_hp | pearson_S(ΔC, r − G₂₀ r) | L586 |
| windward/lee contrast | W boxes: mean r over F ≥ q₂ minus mean r over F ≤ q₁ (box F tertiles); share of scenes > 0 | L587 |
| screen weight | ΔMSE_W split into boxes with centre ≤ 15 km and 15–90 km (Q-2) | L563 |

### 6.4 Statistics (§4.7 L597-L607)
- Scene values → median over judged scenes (c3b: mean over G-shuf scenes).
- `date_block_ci(values, dates, stat, B=10000, seed=20261103)`: blocks = sorted distinct dates; fresh `np.random.default_rng(seed)` per call; each replicate `rng.choice(blocks, size=G, replace=True)`, concatenate values, stat; percentiles 2.5/97.5 (numpy linear). Port of `eval-ringtruth.date_block_ci` (code copied, original never run).
- `sign_flip_p(values, dates, stat)`: G = #dates; G ≤ 16 → all 2^G sign vectors (`itertools.product((1,−1), repeat=G)`, identity included), p = #(stat_flip ≥ stat_obs)/2^G; G > 16 → `default_rng(20261103).choice([1,−1], size=(65536, G))`, p = (1 + #≥)/65537. Ties count as ≥.
- Fisher z: z = atanh(clip(ρ*, ±0.999999)), weights |S| − 3; site table, LOSO, median of site medians; c6 single-pass subset (n, median, L95; boolean median ≥ 0 reported only).

### 6.5 Clauses, actions, tags (§5)
- c1: n ≥ 20 ∧ dates ≥ 8 ∧ sites ≥ 3 ∧ max site count ≤ 0.5n (judged held set). c2: median ρ* > 0 ∧ L95 > 0 ∧ p ≤ 0.025. c2b: median ΔMSE_W ≤ 0. c3: median d > 0 ∧ L95 > 0 ∧ p ≤ 0.025. c3b: gshufScenes ≥ 10 else `못 잼`; mean d_shuf > 0 ∧ p_mean ≤ 0.10. c4: median Δcorr12 ≥ 0 ∧ L95 ≥ −0.01. c5: median Δcorr50 ≥ −0.01 ∧ |median ΔmeanErr| ≤ 0.01. c6: report only. c7: `tools/genus-ruler/oro/guards-oro.json` (S7 record of G1–G9, Q-47) all PASS with hashes equal to §10.2. c8: median ρ_res^vis ≥ 0 ∧ median L⁻ < 0.
- Primary metric from FROZEN `decisions` (ρ_res or ρ_fine; with fine, c2/c3/c3b use fine versions; c2b stays total).
- Action lines 1–6 and fail/pass tags exactly as L646-L683 (first matching line; all failed clauses listed). Tag predicates: '작음' iff U95(median ρ*) < 0.05 ∧ U95(median d) < 0.10 (line ⑥ only); ⑤ uses U95(median d) < 0.10; ③-2 L95(median ΔMSE_W) > 0; ③-3 U95(median ρ^vis) < 0 ∨ L95(median L⁻) > 0; pass tags: c3b p > 0.025, |median ρ_rot| > 0.03, median ρ_even ≥ median ρ_odd, (primary ρ_res) L95(median ρ_fine) ≤ 0 / median ρ_fine ≤ 0, U95(median L⁻) ≥ 0, median ΔMSE_W(λ̃*) > 0, exposure tag from FROZEN `exposure`, always "아침(Terra ≈ 09:00) 판정".
- Sensitivity (§6): each arm = a keyword configuration of `oro_ref` functions/masks; per arm n, median ρ*, CI, median d; scenes with |S| < 20 in that arm dropped from that arm only; block variant = 8-day blocks (pairs of adjacent dates). Report table only.

### 6.6 Pre-judgement checks, lock, outputs (§9.3 L896-L920)
- `ruler_hash(path)`: bytes split on `b'\n'`; i10 = first line starting `b'## 10.'`, i11 = first later line starting `b'## 11.'` (exactly one each, else error); hash `b'\n'.join(lines[:i10+1] + lines[i11:])` (L871).
- Checks 1–7 as L897-L909 (`git merge-base --is-ancestor`, `git diff --quiet <frozen> HEAD -- <files> FROZEN.json` + `git status --porcelain`, per-extN diff from its own commit, rulerHash, implementation/bundle hashes vs guards-oro.json, `oro-base.mjs --check` with the `versions` fallback and the ≤ 1e-6 max|ΔB| rule, FROZEN-extN hashes, no gate/lock; `judge.lock.1` ⇒ rerun mode).
- T-read precheck (L910-L913): all judgement inputs present; bank vs `bank-manifest.json` (JSON/trueGrid/PNG sha256 — hashing only); differences recorded before T.
- Lock: `tools/genus-ruler/oro/judge.lock` written immediately before the first `trueGrid` read (content: HEAD, FROZEN sha256). All T-dependent values computed in one pass, one final write of `gate-oro-held.json`; stdout = progress counters only. Stop after T read → never open partial outputs, record sha256 + exception type; environment-only rerun once via `judge.lock.1`.

### 6.7 `power-oro.json` (§4.7 L610-L621)
- Placement = held judge scenes of `oro-apply(-extN).json` (sites, dates, G-shuf membership); no random application.
- Model A (c2, c3, exact tests; draft1 `stat/sim2c.py`): u_s ~ N(0, 0.05²) per site; (e₁, e₂) ~ N(0, σ²[[1, −0.79], [−0.79, 1]]), σ ∈ {0.15, 0.20}; ρ_i = clip(μ + u_s + e₁, ±1), ρ_rev = clip(−0.8μ − 0.8u_s + e₂, ±1), d = ρ − ρ_rev.
- Model B (c3b; draft2 `recheck-sims/simA2_gshuf_mean.py`): same synthetic-terrain generator restricted to the real placement, wind skew κ ∈ {1, 3}, statistic mean d_shuf on W, sign flip p ≤ 0.10, '못 잼' counted as not passing.
- μ ∈ {0, 0.05, 0.10, 0.15}; 1000 replicates per cell, seed 20261103 + cell index; bootstrap inside power B = 1000 (Q-48).
- Report P(c2∧c3) (A), P(c3b | c2∧c3) (B), their product, false-pass rates (pure null; site-fixed pattern 0.05·0.10). Decision value at μ = 0.10 = minimum product over σ × κ (Q-48); < 0.2 ⇒ §4.7 user question.
```
{schema:"power-oro/1", placement:{n,dates,sites,gshufScenes}, models:{A:{…}, B:{…}}, seeds:{…},
 cells:{"mu=0.10,sigma=0.15,kappa=1":{"pA_c2c3":f,"pB_c3b_given":f,"product":f}, …},
 falsePass:{…}, decision:{"mu":0.10,"value":f,"below0.2":b}}
```

### 6.8 `sunset-apply.json` (§4.6 L594)
- Per site, sounding hours 06-01..10-31 (on the hour, raw values, no interpolation) with sun_alt ∈ [−2°, +8°] and descending (sun_alt(h) < sun_alt(h − 30 min)) (Q-42).
- Count hours with A1..A5 (A5 = sounding complete + DEM; ring part only where ring exists). For 09-01..10-19 also app A6 (bands low, mid) with B from a separate uncommitted `.harness/oro/sunset-inputs.json` built by `oro.py --sunset` and run through `oro-base.mjs --inputs …` (its sha256 recorded).
- `{schema:"sunset-apply/1", sources:{…}, sites:{"<site>":{nEvening, nA1toA5, fracA1toA5, ring:{nHours, nA1toA6app, frac}}}}`.

### 6.9 oro-test additions (S3b)
- **G6(f)** end-to-end with fake truth (L764-L776): dev judge scenes by date (≤ 3; fill from G6(g) synthetic scenes, 0°/90°/180°); T_fake = clip(B + ΔC) replicated 2×2 to 256², u8, row 0 = north; fake PNG RGB(128,128,128) with one (0,0,0) 3 km px inside one window box; fake scenes carry only allow-list fields + fake `trueGrid` + fake PNG path in test-tmp; run the judge metric functions; criteria verbatim from L773-L776 (incl. the ρ^vis sd ≥ 0.01 rule and the N/S, E/W flip drop > 0.3).
- **G6(g)** (L777-L785): two dev sites × even set (0..315 by 45) and skewed set (270..345 by 15, 105, 150), U 8 m/s, N 0.01, one synthetic B per site and set, masks inactive; criteria verbatim. (iv) noise: standardised white noise filtered by exp(−K²L²/4), L = 50 km, T = clip(B + 0.25ξ, 0, 1) in the (f) form, seeds 20261103 + i (Q-37).
- **G6(h)** (L786-L792): T = B + ΔC·1[box ΔC ≥ 0.02] (box level), outside window T = B; coastal version with s = ±0.05; |median L⁻| ≤ 0.003.
- **G8(b)–(f)** (L755): (b) `--f1/--f3` on copies with `trueGrid` removed and fake index `cover` → identical outputs; `--f2` audited with a stub `subprocess.run` and a temp fake quartile file (never re-run the real F2); (c) FROZEN contains `oro-apply.json`/`oro-inputs.json` hashes; (d) `--judge` refuses in synthetic temp git repos violating each §9.3 condition; (e) at freeze no C4 satellite files, `gate-oro-*`, `judge.lock(.1)`; (f) the open guard is armed during G6(f)(g)(h) and any open of a real scene JSON `trueGrid`/`cover`/`empty` path or real PNG fails the test.

---

## 7. Draft-1 code: what may be reused

| piece | reuse? | difference to the ruler |
|---|---|---|
| `bench/oro_core.kgrid`, `highpass`, `damp_lowsigma`, `vweight('col')`, `eta_level`, `synth_terrain` | yes (semantics) | — |
| `oro_core.vertical_m` | logic yes, implementation no | 1e-30 floors give huge but finite m; use §1.6 W-from-μ (no complex inf) |
| `oro_core.combine` | **no** | default 3 iterations, no stop test, Φ via `math.erf` and `NormalDist.inv_cdf` (ruler: A&S 7.1.26 and Acklam), returns residual of post-clip ΔC, early-return copy on F ≡ 0 |
| `oro_core.gsmooth` | semantics yes | radius ceil(3σ) differs from floor rule at σ 15 km (sensitivity only) |
| `oro_core.Phi/Phinv` | **no** | exact functions, not the named approximations |
| `stat/sim1_lib.tukey`, `forcing` | tukey yes; forcing as a cross-check only | forcing hard-codes lat 37.5 for f, κ, H_w |
| `stat/sim1_lib.load_dem` | **no** | 3×3 pixel block of one tile, not the equirectangular cell mean |
| `bench/oro_test.py` T4 | **no** | precip_min = −1e9 replaces every P ≤ 0 (draft T4 rel rms 1.0); `oro_test2.py` base-offset form is the right one |

---

## Q. Ambiguities and the readings chosen (rules unchanged)

| # | where | ambiguity | reading | support |
|---|---|---|---|---|
| Q-1 | §2.4/§2.9/§4.1 | The 30×30 window (cells 49..78) gives observer-centred 12 km boxes; a 64² 12 km grid of the 768 km box is even-aligned (cells 2i, 2i+1), so the judging boxes are not cells of the 64² grid | `dem-grids.json` also stores `hmax6` (128² cell max); judging-box max = max of hmax6 over its 4 cells (exact). `hmax12` kept as the even 64² tiling (shape of L365; = cell max of the §6 64² × 12 km arm) and never used for 15×15 boxes | L490 "칸 중심이 … ≤ 90 km 인 30×30 칸 … 15×15", L492 "상자 안 최고 h(dem-grids.json)", L365 "12 km 상자 최고 h(64²)", L740 |
| Q-2 | §4.4 | "관측점 15 km 안(상자 중심 기준 4 상자)": the 225 tiling has 5 box centres within 15 km (0 and four at 12 km) | use the distance rule (5 boxes), report the count | L490 (tiling) over L563 (descriptive count) |
| Q-3 | §3.2 ③ | Tukey formula not given | w_i = ½(1 − cos(π i/16)), i = 0..15, mirrored (draft-1 `sim1_lib.tukey`, the code behind the [computed] numbers) | L391 |
| Q-4 | §3.4 | "3σ 에서 자름" shape | square (separable), taps \|i\|Δ ≤ 3σ | L425 |
| Q-5 | §3.4 | iteration count and which ΔC A6 tests | ≤ 10 δ updates; failure on max\|G*ΔC_raw\| (pre-clip, step-3 ΔC) after the loop; metrics use post-clip C − B | L420-L424, L427, L489 |
| Q-6 | §3.4 | Acklam with or without Halley refinement | without (refinement needs an accurate erfc, not named) | L426 |
| Q-7 | §3.4 | φ in G*φ | exact Gaussian density | L423 (only Φ, Φ⁻¹ named) |
| Q-8 | §3.5 | θ_v coefficient, exponent, T unit | θ = T_K(1000/p)^{R_d/c_p}, θ_v = θ(1 + (R_v/R_d − 1)q), T_K = °C + 273.15, ruler constants | L441, L448 |
| Q-9 | §2.3 | source of z_sfc | sounding response `elevation` | L232, L369 ("응답 `elevation`") |
| Q-10 | §2.3 | wind interpolation | by components (U, V); valid iff speed and dir both non-null | L227, L384 |
| Q-11 | §2.3 | fallback details | per variable; nearest valid hour ≤ t and ≥ t, \|Δ\| ≤ 3 h inclusive; the same algorithm yields the primary rule | L228 |
| Q-12 | §2.3 | z_0 node set / null hours / scene-time z_0 | levels ≥ 500 hPa above ground; hour null if any needed value null; crossing T_i ≥ 0 > T_{i+1}; scene z_0 from interpolated profile; z_snow from raw hours in (t − 504 h, t] | L231-L238 |
| Q-13 | §2.6 A4 | "기준 고도 위의 모든 면" | levels p ∈ {700, 600, 500} with Z(p) > z_ref | L292, L434 ("기준 고도" = z_ref) |
| Q-14 | §3.5 | which A fails when L is empty | A2 = A3 = A4 = false, `refEmpty` recorded (a = 0) | L435 |
| Q-15 | §3.5 | C_lm when ring point 0 low/mid is null | s_rel = 0.15 (the "아니면" branch) | L446 |
| Q-16 | §3.2 ⑤ | N used for blocking; N² ≤ 0 | model N (clipped); N² ≤ 0 → 0.003 (A3 false anyway) | L442 |
| Q-17 | §2.6/§4.6 | h in Nh/U | max\|h_sub\| over the window (clip active ⇔ Nh/U > 1) | L393, L592 |
| Q-18 | §2.6 m8 | "판정 창 rms ΔC" | judge-path ΔC (post-clip) over the 225 window box means; ΔC^app rms added by S3b | L307, L489 |
| Q-19 | §2.9 | oro-inputs scope "판정·확장 대상 + dev 적용" is defined by A6/A7, which need B, which is built from oro-inputs | store every bank scene (superset); judge flags live in oro-apply | L360, L416 |
| Q-20 | §2.9 | "float64 base64 … null 은 null" | NaN inside the base64 plus an explicit `nullIdx` list | L361 |
| Q-21 | §2.9 | latest-rule time for ext scenes (no latest file in §2.7 commands) | derive from `passes` with fetch-modis-time's latest rule; verified on the 121 | L319, L360 |
| Q-22 | §2.9/§6 | t0 in "t0 ± 1 h" | t0 = closest time | L360, L741 |
| Q-23 | §2.6 A8 | which granule polygons | all granules of the chosen pass (regrouped `times`, mid == modisTimeUtc); sat-times holds only point-containing granules, others fetched from CMR (`--fetch-missing`) | L296, L163 |
| Q-24 | §4.6 m3 | cross-track distance from a 4-corner polygon | distance to the line through the cross-track edge midpoints; cross-track pair = the more east–west edges | L305, L592 |
| Q-25 | §2.7/§9.2 | pre-freeze ext: separate files or merged | merged into the same oro-inputs/oro-apply/cmr-geom/manifests with `bank`; only post-freeze extN get `-extN` files | L333, L374, L877 |
| Q-26 | §2.6 | "해안 몫" denominator | share of W boxes with ≥ 3 sea cells | L305, L554, L592 |
| Q-27 | §4.5 | B and G in D_dc | B_tot (judge path), unmasked G₂₀ (combiner G) | L573 |
| Q-28 | §4.1 | Pearson with < 2 values | None (not 0); zero variance → 0 | L500 |
| Q-29 | §2.4 | pixel-to-cell rule, tile set, despike | pixel centre in cell, unweighted mean; blockTiles ∪ boxTiles; no despike (decode as written; app demCpu has none) | L245-L248 |
| Q-30 | §2.7 | sun position function | `ring/solar_util.sun_alt_deg` copied into oro_ref | L315 ("NOAA 태양 위치 근사, 균시차 포함") |
| Q-31 | §3.4 | band with < 12 points | B null (app builds no field); cannot occur when A5 holds (≥ 82 points) | `volumetricScene.ts:1289`, L216 |
| Q-32 | G6(a) | "바람 4 방향 × 능선 2 방향" includes winds parallel to the ridge | 8 cases: 4 perpendicular (upwind max, ≤ 5 m, η_w sign), 4 parallel (η ≡ 0) | L759 |
| Q-33 | G6(b) | rms definition; fastscape's P ≤ 0 replacement | rms(P − P_fs)/std(P_fs); precip_base 1e4, precip_min 0 | L760, draft1 method §1.3 |
| Q-34 | G6(d) | mountain coordinates and slope regions | Hakusan, Odaesan; ±(6..24) km bands, ±12 km across | L762 |
| Q-35 | G6(e) | quantitative orientation criterion | NW quadrant sea ≥ 0.9, SE ≤ 0.1 | L763 |
| Q-36 | §4.4 (S3b) | τ_band when ring point 0 is null | first argument 0 | L546 |
| Q-37 | G6(g)(iv) (S3b) | noise kind and amplitude | Gaussian-filtered (L = 50 km), amplitude 0.25 (sd(r) ≈ 0.25 of L507) | L784, L507 |
| Q-38 | §4.3 (S3b) | k's κ/s_rel in G-shuf | k's stored values (its own C_lm and RH̄) | L527 |
| Q-39 | §4.3 (S3b) | 180° rotation implementation | `np.rot90(hmean6, 2)` (exact about the observer corner; clamp commutes) | L539 |
| Q-40 | §4.6 (S3b) | bilinear 128² → 256² alignment | cell-centre aligned, edge clamp | L583 |
| Q-41 | §2.6 | inversion comparison | strict T(first level above ground) > T2m | L305 |
| Q-42 | §4.6 (S3b) | "저녁" hours for sunset-apply | sun altitude in [−2°, 8°] and descending | L594 |
| Q-43 | §2.7 | "해 고도 ≥ 20°" boundary | inclusive, at the closest time | L315 |
| Q-44 | G6(f)/§2.9 | "dev 적용 장면" | dev scenes with judge-definition A1–A8 true. [proto, DEM only] seoul A1 rms 64.7 m < 100, so only kanazawa can supply them; fewer than 3 → synthetic fill as G6(f) says | L765 |
| Q-45 | §3.4 | B bundle commit before the G1 baseline commit exists | 115fbe2 (merged commit); `src/` is unchanged since, and the G1 baseline adds no app code, so `macroField.ts` and the bundle are identical; rebuild with the baseline commit before freeze and require equal sha256 | L414, L862 |
| Q-46 | §2.9/§6 | z_0/z_snow for the ecmwf arm | best_match only (same masks; arms change F only) | L362, L717 |
| Q-47 | §5.1 c7 (S3b) | machine-readable guard record | `guards-oro.json` written at S7, hashes equal to §10.2 | L635, L894 |
| Q-48 | §4.7 (S3b) | joint pass probability from two fixed models; bootstrap size inside power | product P_A(c2∧c3)·P_B(c3b \| c2∧c3); decision = minimum over σ × κ; B = 1000 inside power (as sim2c), 10,000 in the judgement | L612-L617 |
