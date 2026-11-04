# S3 design — RULER-oro pre-freeze tools (implementation spec)

Status: design for plan S3 (`oro/draft3/plan.md` §1 "S3 목록"), against `RULER-oro.md` draft 3 fix 1 (6f99303, unfrozen). Not frozen, not committed. **Revision 2**: applies `S3-design-review.md`; §R lists every finding, where it landed, and the parts rejected with the ruler line.
This file does not change any rule. Where the ruler is silent or self-inconsistent, §Q lists the reading chosen and the ruler line that supports it. Line refs `Lnnn` are `RULER-oro.md` at 6f99303.

- **S3a (build now)**: `oro_ref.py` (model + builders, incl. `ring-manifest`/`bank-manifest` subcommands), `dem-grids.json`, `oro-inputs.json`, `oro-apply.json`, `oro-geom.py` → `cmr-geom.json`, `oro-base.mjs`, `oro-test.py` (units + G6 (a)–(e) + G8(a) + builder tests). `oro-fingerprint.py` stays byte-identical (§4).
- **S3b (spec here, built after S3a, still pre-freeze)**: `oro.py` (§4 metrics, §4.7 statistics, §5 clauses/tags, §9.3 pre-judgement checks, lock, `rulerHash`), `--fill-apply` (λ_app, G7, masked app share, m8 app rms), `--power` → `power-oro.json`, `--sunset` → `sunset-apply.json`, oro-test additions G6 (f)(g)(h), G8 (b)–(f). "Later" means after S3a, never after freeze: `oro.py` and `oro-test.py` are FROZEN files (L874), and §9.1 ⑤–⑦ and ⑨ need G6 (f)–(h), G7, λ̃*, `power-oro.json`, `sunset-apply.json` before the freeze commit (L860-L865, L876, L887).
- **G1 baseline**: `g1-baseline.json` (plan S3 list, §9.1 ⑦, L748, L862) — tooling pointer and output schema in §8; the harness code itself belongs to the volsky G1 tooling.
- Out of scope here: `oroLift.ts`/`oroDem.ts`/`oro-run.mjs` (post-freeze), FROZEN.json assembly (S4).

What this design looked at: the ruler, plan, draft-1 bench/stat code and notes, the listed tools' source, `dem-manifest.json`/`sounding-manifest.json` heads, `ring/modis-times*.json` keys/times/flags, `regime/sat-times.json.gz` structure (CMR metadata only), one `ring/nwp/blend/busan.json` header (NWP). Two DEM-only prototypes were run in the scratchpad to make sure the G6 (d)/(e) geometry chosen below is passable (numbers quoted with **[proto, DEM only]**). fastscape `orographic_precipitation.py` at the pinned commit was fetched once into the scratchpad to read it and pin its sha256. No MODIS value, scene JSON, PNG, index.json, quartile/gate file or restore log was opened.
Revision 2 additionally checked here (MODIS-free): the `oro-fingerprint.py` sha256 and its module constants, the `sounding-manifest.json` structure (`sites[site].nulls`), the CMR polygon closing vertex in `sat-times.json.gz`, the ring raw hour ranges against the `modis-times.json` times (D9), the 216-cell z_ref count, the sun-azimuth hand value, the numpy/Pillow/python versions and SIMD baseline, the `cloudFlow.ts` type-only import, and draft-1 `method.md` for the η_q term.

---

## 0. Global rules for every S3 tool

### 0.1 Contamination (absolute)
- Never print, log, plot, summarise or open for values: scene keys `trueGrid`, `cover`, `empty`; ring `cover` inside any scene JSON or scene copy (`.harness/macro/sat*`); any `*.png` under `.harness/macro/sat*`/`.harness/oro/sat-*`; `index.json` of a bank; `macro/sat-quartiles.json`; `ring/gate-*.json`, `ring/ringtruth-results.json`; `scratchpad/restore/*`, `.harness/oro/f2.log`, `.harness/oro/f3-run.log`, `.harness/oro/fetch-sat*.log`, `.harness/oro/sat-quartiles-restore.json`.
- Scene JSON is opened **only** by `oro_ref.load_scene_meta()` (allow-list: `site, lat, lon, date, grid, cellKm, ring[].dist, ring[].az`), by the bank-manifest hasher (`oro_ref.py bank-manifest`, hash only) and, after the lock, by `oro.py load_truth` (§6.2). Error messages name keys, never values.
- Do not run `macro.py --gate`, `fetch-modis-time.py`, `eval-ringtruth.py`. Importing **functions** from `fetch-nwp-ring.py`, `fetch-sat.py`, `macro.py` (all `main` guarded) is allowed; from `fetch-modis-time.py` copy, do not import (R-G2).
- **Open guard** (`oro_ref.install_guard()`): installed first by `oro_ref.py` (CLI), `oro-geom.py`, `oro-test.py` and `oro.py` — **not** by `oro-fingerprint.py`, which stays byte-identical to the code that produced F1–F3 (§4). `sys.addaudithook` on event `open`; resolve the path relative to repo root; raise `PermissionError("oro guard: <relpath>")` if it matches a forbidden pattern below, unless the matching allow-context is active (`with oro_ref.allow('scene-json')` / `allow('png-hash')` / `allow('png-judge')`, thread-local flag):
  - `^\.harness/macro/sat[^/]*/[^/]+\.png$`, `^\.harness/oro/sat-[^/]+/[^/]+\.png$` → only `png-hash` (raw bytes → sha256, never decoded) or `png-judge` (Pillow decode). Under `png-judge` the hook additionally requires `tools/genus-ruler/oro/judge.lock` to exist at the moment of the open, else it raises (C2, §6.6). Synthetic PNGs in `test-tmp` (G6(f)) match no pattern and need no context, so the tests never need a lock.
  - `^\.harness/macro/sat[^/]*/(?!index\.json)[^/]+\.json$`, `^\.harness/oro/sat-[^/]+/(?!index\.json)[^/]+\.json$` → only `scene-json`
  - always forbidden: `.../index.json` of those dirs, `^tools/genus-ruler/macro/sat-quartiles\.json$`, `^tools/genus-ruler/ring/(gate-.*|ringtruth-results)\.json$`, `^\.harness/oro/(f2\.log|f3-run\.log|fetch-sat.*\.log|sat-quartiles-restore\.json)$`, `/scratchpad/restore/`, `^\.harness/regime/sat`. (G8(b) runs `oro-fingerprint.py` functions only against synthetic files in `test-tmp`, so no test needs these paths, §6.9.)
- **No size side channel** (C1): never print, store or compare `os.path.getsize`/`stat().st_size`/`len(bytes)` of any file under `.harness/macro/sat*` or `.harness/oro/sat-*` (PNG and scene-JSON sizes follow the MODIS content). Hashes and counts of files only.
- **git** (C4): git is called only with `--quiet`, `--name-only`, `--stat` or `--porcelain`, or with pathspecs that exclude `tools/genus-ruler/macro/sat-quartiles.json`, `tools/genus-ruler/ring/gate-*.json` and `tools/genus-ruler/ring/ringtruth-results.json`. No `-p`/`--patch`, no `git show`/`git log -p`/`git diff` without `--quiet` on those files. (`oro-base.mjs` uses `git show <commit>:<path>` only for the two TS source paths of §3.)
- Stdout: counts, statuses and sha256 only. NWP/DEM numbers may be printed by tests, MODIS-derived numbers never.

### 0.2 Process
- Python: `python3 -I <script>` (no `sys.path[0]`); numpy + Pillow only; cross-file imports by `importlib.util.spec_from_file_location(name, <abs path from __file__>)`. Every entry script sets `sys.dont_write_bytecode = True` before the first importlib load (no `__pycache__` in `tools/genus-ruler/{macro,ring,oro}`).
- JS: node 22, `npx --yes esbuild@0.28.2`.
- No commits. Outputs land in the working tree.
- Determinism: float64 throughout Python; B is Float32 as produced by TS; RNG only in S3b (seeds pinned there); no wall-clock time in any committed output; all JSON written by `oro_ref.dump_json(obj, path)` = `json.dumps(obj, sort_keys=True, indent=1, ensure_ascii=False, allow_nan=False) + "\n"`; floats are Python repr (round-trip exact). Re-running any builder on the same inputs gives byte-identical output (test B-DET).
- **Ordered iteration** (D1): `-I` implies `-E`, so `PYTHONHASHSEED` is ignored and `str` set order changes per process. Every iteration over a `set`, over `dict.keys()` of external origin (JSON objects, manifests), over `os.listdir`/`glob` results, or anything that affects output order or a float accumulation order, is wrapped in `sorted()`. Every list derived from a set is sorted before it is stored (`pendingSites`, `gshufSites`, `devJudgeable`, `extTargetSites`, `m8.scenes`, `missing`, `tilesUsed`, `soundingMissing`, `nullIdx`). Scene lists (§1.15) and tile lists (§1.4) are sorted by name.
- **Versions and environment** (D2, D3): numpy `Generator` streams and SIMD-dispatched ufuncs/pocketfft are not bit-stable across numpy versions or CPUs. `apply` records `env = {python, numpy, Pillow, machine: platform.machine(), numpyCpuBaseline, numpyCpuDispatch}` (the last two from `numpy._core._multiarray_umath.__cpu_baseline__`/`__cpu_dispatch__`, `numpy.core…` on 1.x) in `oro-apply.sources.env`; `dem-grids`/`oro-inputs` carry no environment or code hash of their own (D7). Current: python 3.13.18, numpy 2.5.3, Pillow 12.3.0, x86_64, baseline `X86_V2`. FROZEN `versions` pins these at freeze (L376, L885); `oro.py --precheck/--judge` refuses before T if the running python/numpy/Pillow differ (§6.6).

### 0.3 Pinned conventions (shared by all tools)
| item | pin | ruler |
|---|---|---|
| grid | n = 128, Δ = 6000 m, extent 768 km. Cell (r, c) centre: x = (c + 0.5 − 64)·6 km east, y = (r + 0.5 − 64)·6 km north. **Row 0 = south, col 0 = west.** Observer = shared corner of cells (63..64, 63..64) | L380, L251, `macroField.ts:76-77` and `barnesPass` (cell centre `(x+0.5)·cellKm − half`) |
| array layout | numpy `A[r, c]`, row-major; FFT axis 0 ↔ l (north), axis 1 ↔ k (east) | L382 |
| FFT | `np.fft.fft2` (e^{−i(kx+ly)}), `np.fft.ifft2` (/n²); equals `cloudFlow.ts fft2` (fft1: `−2π/len` forward, `/n` per axis inverse) | L382 |
| wavenumbers | k = 2π·fftfreq(128, 6000) on axis 1, l on axis 0; K = √(k²+l²) | L382, L385 |
| window | rows/cols 49..78 inclusive (30 cells, centres ±3..±87 km, edges exactly ±90 km) | L490, L289 |
| 12 km judging boxes | box (bi, bj), bi, bj ∈ 0..14 = rows 49+2bi..50+2bi × cols 49+2bj..50+2bj; centre (12(bj−7), 12(bi−7)) km (observer-centred tiling); flat index b = 15·bi + bj (south→north, then west→east); box value = mean of its 4 cells | L490 |
| extended box tiling (S3b, c4·c5 masks, G₁₀ ⊛_M weight) | same phase over the full grid: 6 km row r → box row (r + 1)//2 ∈ 0..64 (edge boxes 0 and 64 are half boxes); 3 km row p → 6 km row p//2 → box row (p//2 + 1)//2. Window box (bi, bj) = extended box (bi + 25, bj + 25) | L495 |
| 64² × 12 km arm (§6 sensitivity) | 12 km cell (i, j) = 6 km cells 2i..2i+1 (even tiling, = `hmax12`/`hmean12`); centre ((j + 0.5 − 32)·12, (i + 0.5 − 32)·12) km; window = cells 24..39 (centres ±6..±90 km, 16×16); 24 km boxes = 2×2 of those (8×8 = 64, centres ±12..±84 km; the observer is on a box corner) | L740, Q-52 |
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
| B | `.harness/oro/base/<scene>__<timeKey>__<band>.f32` (n = 128, 65,536 bytes), `.harness/oro/base/<scene>__closest__<band>__n64.f32` (n = 64, 16,384 bytes) + `.harness/oro/base/index.json` | ignored |
| bundle | `.harness/oro/base-bundle/<commit>/` (extracted TS + `macro.cjs`) | ignored |
| fastscape ref | `.harness/oro/ref/orographic_precipitation.py` | ignored, never vendored |
| CMR extra polygons | `.harness/oro/cmr-extra.json` | ignored |
| test scratch | `.harness/oro/test-tmp/` | ignored |
| committed outputs | `tools/genus-ruler/oro/{dem-grids,oro-inputs,oro-apply,cmr-geom,ring-manifest,bank-manifest}.json`, `oro-test.txt`; S3b: `power-oro.json`, `sunset-apply.json`, `g1-baseline.json` (§8) | working tree |

### 0.5 Build order (S3a; re-runnable)
1. `python3 -I tools/genus-ruler/oro/oro_ref.py dem-grids` → `dem-grids.json`
2. `python3 -I tools/genus-ruler/oro/oro_ref.py ring-manifest` and `… bank-manifest` (§4)
3. `python3 -I tools/genus-ruler/oro/oro_ref.py inputs --banks orig` → `oro-inputs.json` (`bSha256: null`)
4. `node tools/genus-ruler/oro/oro-base.mjs --inputs tools/genus-ruler/oro/oro-inputs.json --commit 115fbe2` (n = 128 for every time and n = 64 for the closest time, one run; later: the G1 baseline commit; same `macroField.ts`, Q-45)
5. `python3 -I tools/genus-ruler/oro/oro_ref.py seal-inputs` (copies B sha256 into `oro-inputs.json`)
6. `node tools/genus-ruler/oro/oro-base.mjs --inputs … --commit … --check` (exit 0)
7. `python3 -I tools/genus-ruler/oro/oro-geom.py [--fetch-missing]` → `cmr-geom.json`
8. `python3 -I tools/genus-ruler/oro/oro_ref.py apply` → `oro-apply.json`
9. `python3 -I tools/genus-ruler/oro/oro-test.py [--fetch-ref]` → `oro-test.txt`

When the 9 soundings (11-05) and R11 arrive: re-run 3–9 unchanged (1–2 only if DEM/ring/bank changed). Every builder derives the pending lists from the data on disk, so nothing in code or tests changes when the data arrive (D4, B-BUSAN). Until 10/10 soundings exist, `oro-apply.json summary.provisional = true` and the c1 count is not the §2.7 count (L311, §2.8 ⑦ L352). Pre-freeze extension: re-run 2–9 with `--banks orig,ext` (Q-25).

**Facts this build produces for the S4 record in ruler §0.5** (this design does not edit the ruler): (i) `oro-fingerprint.py` sha256 `b03800e75e40984f9834157973a2082b7bf129c9a44ed32438c7b020d5c213f6` (4c05bed, the code that produced `restore-fingerprints.json`; test U-FP); (ii) per-site sounding null counts of the §3.5/z₀ variables, copied from `sounding-manifest.json` into `oro-inputs.sources` (§1.15); (iii) `summary.a5SoundingMissing` — how many scenes the literal Z850/Z700 rule removes (R1); (iv) the Q-2 text conflict (5 boxes within 15 km, not 4); (v) the post-prototype test pins Q-32..Q-35 (§5 header); (vi) 0 null ring point-0 values at the 121 closest times (Q-36); (vii) per-site A1 rms (§1.5).

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
SNOW_DAYS_ARMS=(7,42)  TAU_C=1000.0  SUN_SLOPE_MIN_DEG=5.0  SUN_AZ_HALF_DEG=45.0  UNDERGROUND_MARGIN_M=500.0
TEMP_LEVELS=[1000,975,950,925,900,850,800,750,700,600,500,400,300,250,200]   # fetch-sounding.py
```
Ruler: L65-L74, L389-L449, L289-L296; arms L727, L733; sun-facing split L592; UNDERGROUND_MARGIN_M is a pinned reading (Q-49).

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
`gauss_smooth(X, sigma_m, mask=None, dx_m=DX_M)` — X (n,n) f64 (n = 128; n = 64 with dx_m = 12000 for the §6 64² arm).
- 1-D taps i = −R..R with R = floor(3σ/Δ + 1e-9) (Δ 6 km: σ 20 km → 10; 10 km → 5; 15 km → 7; 30 km → 15. Δ 12 km: σ 20 km → 5), w_i = exp(−(iΔ)²/(2σ²)). Square truncation (separable, Q-4).
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
- `hmean12[i,j]` (64², §6 64² × 12 km arm, M3) = mean of h over **all pixels** whose 6 km cell lies in rows 2i..2i+1, cols 2j..2j+1 (pixel-weighted; not the mean of the four `hmean6` values, because pixels per 6 km cell vary 2–16), stored float32.
- **Slope and aspect of the 15×15 judging boxes** (sun-facing-slope split, L592, M4): mosaic the site's tiles (blockTiles ∪ boxTiles) into one array of h = max(elev, 0) in tile-pixel space (row = south-increasing Y). Per pixel with both neighbours present in the mosaic: res = 40075016.686·cos(lat_px)/2^z/256 m (Web Mercator is conformal, same scale both axes); g_east = (h[Y, X+1] − h[Y, X−1])/(2·res), g_north = (h[Y−1, X] − h[Y+1, X])/(2·res). A pixel belongs to window box (bi, bj) when its centre maps (box map above) to a cell in rows/cols 49..78. Box vector mean (ḡ_e, ḡ_n) over its pixels; `slopeDeg15` = degrees(atan(hypot(ḡ_e, ḡ_n))); `aspectDeg15` (direction the slope faces, clockwise from north) = degrees(atan2(−ḡ_e, −ḡ_n)) mod 360. Stored as float64 lists (225, flat order b = 15·bi + bj).
- `tilesUsed` = tiles contributing ≥ 1 pixel → `{ "z/x/y": sha256 }`, keys sorted; tiles are decoded in sorted key order.
- **Float32 round trip** (D5): every downstream DEM quantity — A1 (`a1RmsM`), z_ref, `sea_box`, h_sub, box maxima — is computed from the **decoded float32** `hmean6`/`hmax6`/`hmax12`/`hmean12` (`f32b64` → float32 → float64), never from the builder's in-memory float64, so that `dem-grids` builder, `apply`, `oro.py` and the app agree bit for bit.
- Tests: U-DEM1 pixel lon/lat of tile corners equals `fetch-dem.tile_float` inverse (1e-9°); U-DEM2 synthetic 2-tile mosaic with known values → expected means/max, `hmean12` ≠ mean of four `hmean6` when pixel counts differ; U-SLOPE synthetic tilted plane (rising to the east at 10 %, and to the north) → slope 5.71°, aspect 270° (and 180°) within 1e-6; G6(e) orientation (§5.3).

### 1.5 h_eff (§3.2 L388-L393)
`h_sub_field(hmean6) -> (hsub (128,128) f64, a1_rms_m)`
1. h = hmean6.astype(f64) (already ≥ 0); h −= h.mean() (mean over all 128²).
2. Tukey: w[i] = 0.5·(1 − cos(π i/16)) for i = 0..15, w[127−i] = w[i], else 1; h *= outer(w, w) (Q-3). Hand: w[0]=0, w[1]=0.009607, w[8]=0.5, w[15]=0.990393 (U-TUKEY).
3. Ĥ = fft2(h); Ĥ_sub = Ĥ·(1 − exp(−K²s²/2)), s = 10 km; hsub = Re ifft2(Ĥ_sub). Half-amplitude wavelength 2πs/√(2 ln 2) = 53.364 km (U-HP).
4. **A1 value** = sqrt(mean(hsub[49:79, 49:79]²)) (rms, not std), from the decoded float32 `hmean6` (D5). A1 is a site constant.
   - [review, DEM only, this pinned resampling] A1 rms: denver 121.3 ✓, sapporo 106.4 ✓, osaka 106.1 ✓, busan 58.1, sydney 49.3, lisbon 26.6, hamburg 10.1, shanghai 2.3; dev kanazawa 129.3 ✓, seoul 64.7. So at most denver, osaka, sapporo can be judged (= `extTargetSites`), and osaka/sapporo sit 6 m above the threshold: `oroDem.ts` must reproduce the pixel-centre rule exactly (G5(b) ±0.5 m does not cover a different resampling). No rule changes; `apply` prints these per site (§1.15).
- Generalised for the §6 64² arm: `h_sub_field(hmean12, n=64, dx_m=12000, tukey_cells=8)` (same physical lengths: Tukey 96 km, s = 10 km; Q-52).

`h_eff(hsub, speed, N) = clip(hsub, −speed/N, +speed/N)` (physical space, model N, L393; Q-16).

`z_ref(hmean6)` (L434, R2) = mean, in float64, of the decoded float32 `hmean6` (already max(0, h)) over the cells whose centre is at distance ≤ 50 km from the observer (inclusive; 216 cells on this grid). Stored per site in `dem-grids.json` as `zRefM` and copied into `oro-inputs.json` (`zRef`). U-ZREF: cell count 216; synthetic hmean6 = 1 inside r ≤ 50 km and 1000 outside → 1.0. [review, DEM only] denver 1902.2, kanazawa 278.0, sapporo 208.9, osaka 182.8, seoul 106.5, busan 75.0, sydney 44.8, lisbon 45.9, hamburg 29.4, shanghai 3.5 m.

### 1.6 Column displacement and forcing (§3.3 L395-L409)
**One branch function** (R3, L802: the sign of iσ·e^{imz} is set in one place, so G6(a)/(b) exercise the code that `eta_w` runs):
`vertical_m(k, l, U, V, N, f, branch='physical') -> (kind int8 (n,n), m float64 (n,n), mu float64 (n,n))` — the only place that computes σ, the branch, sgn(σ), m and μ:
- σ = Uk + Vl; s2 = σ², N2, f2.
- K = 0 → kind 0 (mean), m = 0, μ = 0.
- propagating f2 < s2 < N2 → kind 1: m = sgn(σ)·K·√((N2 − s2)/(s2 − f2)) real, μ = 0.
- evanescent s2 ≥ N2 → kind 2: μ = K·√((s2 − N2)/(s2 − f2)), m = 0.
- rotational s2 ≤ f2, K > 0 → kind 3: μ = K·√((N2 − s2)/(f2 − s2)); if f2 − s2 = 0 (σ = 0 with f = 0, or s2 == f2 exactly) μ = +inf.
- `branch='fastscape'` (G6(b) only) replaces only the num/den clamps: num = max(N2 − s2, 0); den = s2 − f2; den ∈ [0, EPS) → EPS, den ∈ (−EPS, 0) → −EPS (EPS = np.finfo(float).eps); sgn = +1 if σ ≥ 0 else −1; m = sgn·√|num/den·K²| (real), μ = 0, kind 1 wherever K > 0. This copies fastscape `compute_orographic_precip` exactly.

Callers (none computes σ, m or μ itself):
- `col_weight(k, l, U, V, N, f, Hw, branch='physical') -> (W complex, kind)`: W = 1/(1 − i m Hw) where kind = 1; W = 1/(1 + μHw) where kind ∈ {2, 3} (μ = inf → 0); W = 0 where kind = 0. Computed from real μ, never through complex inf.
- `vertical_decay(k, l, U, V, N, f, z, branch='physical')` = e^{imz} where kind = 1, e^{−μz} where kind ∈ {2, 3} (μ = inf → 0), 0 at K = 0; used by G6(a) and the `two`/`z1500` arms.
- Test U-M2: on a 64² k-grid (Δ 6 km) with (U, V, N, f) drawn by `default_rng(20261103)` over 32 draws chosen so that every kind and both signs of σ occur (assert counts > 0), `col_weight` equals 1/(1 − i·m·H_w) or 1/(1 + μH_w) and `vertical_decay` equals e^{imz} or e^{−μz} computed from `vertical_m`'s own output (array_equal), for both branches.
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

Edge cases: N² ≤ 0 → snd.N = N_MIN (clip of √max(N²,0)); only reachable when A3 is false.

**Sensitivity hooks** (S3b, L723-L731; R5). Keyword args of `eta_w`/`forcing`/`combine`, defaults = the main model; each arm of §6.5 is one setting:
| hook | values | formula |
|---|---|---|
| `s_m` | 10000 (8000, 15000) | high-pass s in `h_sub_field` |
| `block` | `'clip'` (`'none'`, `'sheppard'`) | none: h_eff = h_sub; sheppard: h_eff = max(h_sub − (max h_sub − speed/N), 0) (L723; max over the 30×30 window, as Nh/U, Q-17/Q-53) |
| `vertical` | `'col'` (`'two'`, `'z1500'`, `'q'`) | two: η = ½[η(1500) + η(3000)], η(z) = Re ifft2(ĥ_eff·D·`vertical_decay`(z)); z1500: η(1500); q: η̂_q = ĥ_eff·D(σ)·W·iστ_c/(1 + iστ_c), τ_c = TAU_C = 1000 s (draft-1 `method.md` §1 "Cloud water"; its τ_c → ∞ limit is η̂_w, L395). F = κ·η in every case |
| `N_scale` | 1.0 (0.6) | N_m = 0.6·N in m and in the blocking clip (L728) |
| `Hw_override` | None (2500.0) | L729 |
| `odd` | False (True) | F_odd = κ(η_w − η_w,rev)/2, η_w,rev with (−U, −V) (L730) |
| `lambda_smin` | 200000 (100000, 400000) | σ_min = 2π·\|V\|/λ (L731) |
| `f_override` | None (0.0) | L731 |
| `s_rel_override` | None (0.10, 0.20) | κ = γ_s(T̄)/s_rel_override (L731) |
| `sigma_G_m` (in `combine`) | 20000 (15000, 30000) | G of the combiner, R = floor(3σ/Δ) (L731) |

Rejected part of R5: the review's η̂_q = ĥ_eff·D(σ)/((1 − i·m·H_w)(1 + i·σ·τ_c)) is not used, because it lacks the factor iστ_c: its τ_c → ∞ limit is 0, not η_w, while L395 defines η_w as "S&B 2004 의 τ_c → ∞ 극한" of the same cloud-water term (q̂_c = τ_c·C_w·iσĥ/[(1 − imH_w)(1 + iστ_c)]; dividing out C_w gives η̂_q above, → η̂_w as τ_c → ∞).

### 1.7 Combiner (§3.4 L418-L431)
`combine(B, F, sigma_G_m=SIGMA_G_M, dx_m=DX_M) -> dict` — B (n,n) float64 (cast from the Float32 file), F float64; G = `gauss_smooth(·, sigma_G_m, dx_m=dx_m)` (σ_G arm and 64² arm only change the defaults).
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
- `pearson(a, b)` (R6): n = 0 → None (empty set; only reachable in pre-freeze report values such as `preCorr` of a non-judge scene); n = 1, or zero variance in either → 0.0 (L500: with one value the variance is 0); else float. (No judged value is affected: |S| ≥ 20 and W ⊇ S∪ ⊇ S.)
- `masks_input(hmax6, zSnow, Bhigh, margin_m=300.0, hi=0.3)` → dict of (15,15) bool: `snow = box15_max(hmax6) ≥ zSnow − margin_m` (L492; zSnow null → all True, scene fails A5 anyway), `high = box15(Bhigh) ≥ hi` (L493). `M_in = snow | high`. W_in = ~M_in. Snow and high-cloud arms (§6.5) only change zSnow/margin_m/hi.
- **Two mask sets** (R4):
  - `M_in` = snow ∪ high (MODIS-free) is used for A7 (L498 "빈 화소 가림은 A7 에 넣지 않음"), D_dc, λ_app, G7, m8 and the masked app share (L308 "M = 눈·상층운 가림", L754).
  - `M_judge` = snow ∪ high ∪ empty (S3b, after the lock, §6.2) is the M of §4.1 (L491-L494) and is used for W, S, S∪ of every judged metric, for the G₁₀ ⊛_M weight m of ρ_fine/ρ_coarse (L568) and for the 3 km masks of c4·c5 (L495). Both sets are built on the extended tiling (§0.3) whenever cells outside the window are needed.
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
- **Deep-underground levels** (R1, Q-49): a level p whose standard-atmosphere height z_std(p) = 44330.8·(1 − (p/1013.25)^0.190263) is below z_sfc − 500 m (UNDERGROUND_MARGIN_M) is not required by z₀, z_snow or the inversion level, and is skipped when its Z or T is null (it can never be a node, since Z(p) ≤ z_sfc there). With a non-null Z(p) it is handled by the normal Z(p) > z_sfc test. Example: z_sfc 1600 m skips null 1000/975/950/925/900 hPa (z_std 111…988 m < 1100 m) but not 850 hPa (1457 m).
- Needs T2m and, for every p ∈ TEMP_LEVELS with p ≥ 500 that is not skipped by the rule above, Z(p); and T(p) for those with Z(p) > z_sfc. Any missing → None.
- Nodes: (z_sfc + 2, T2m), then (Z(p), T(p)) for p ≥ 500 descending, Z(p) > z_sfc only.
- T2m < 0 → z_sfc. Else first i with T_i ≥ 0 > T_{i+1} → z_i + (z_{i+1} − z_i)·T_i/(T_i − T_{i+1}). None found → Z(500).
- Hand (U-Z0): z_sfc 100, T2m 8; 925 (800 m, 4), 850 (1500, −1), 700 (3100, −9) → 1360.0; T2m −1 → 100; a below-ground level (Z ≤ z_sfc, T < 0) must not create a crossing. U-Z0B: z_sfc 1600 with Z/T null at 1000..900 hPa → valid profile; the same nulls with z_sfc 100 → None; null Z850 with z_sfc 1600 → None.
- `z0_at(snd_site, t)`: profile from §1.9-interpolated values at t (oro-inputs `z0`).
- `z_snow_at(snd_site, t, days=21)`: hours h on the hour with t − days·24 h < h ≤ t (days·24 stamps); z0 per hour from **raw** hourly values (no interpolation); valid = non-None; count < days·12 → z_sfc; else min. Main rule days = 21 (504 h, L236-L238); the §6 arms use days = 7 and 42 with the same rule (M2, L733). If the window starts before the first hour of the sounding file of that bank → None (`zSnowN` null; that scene drops from that arm only, §6.5) — no splicing of files (L331). U-ZSNOW: window ends, the 251/252 boundary (21 d), 83/84 (7 d), 503/504 (42 d), window-before-file → None.
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
10. A4: for p ∈ (700, 600, 500) with Z(p) > z_ref (Q-13): dot_p = U_p·Û_ref + V_p·V̂_ref; ok = all dot_p > 0 (speedRef = 0 → false). A null Z(p) or wind at a level step 10 needs → `A4 = {ok: false, reason: "null"}` (not A5).
11. Inversion flag: lowest p in TEMP_LEVELS with Z(p) > z_sfc (deep-underground nulls skipped, §1.11); flag = T(p) > T2m (strict) (L305). Any needed value null → `inversion: null` (split bin "unknown", not A5).
12. **`complete`** (= A5 sounding, R1; L239 "§3.5 에 필요한 면", L293) = every value used by steps 2–9 is non-None after the §1.9 fallback: Z850 and Z700 (to choose L); U, V at every p ∈ L; T, RH, Z at p_lo and p_hi. C_lm may be null (→ 0.15, step 7; it comes from the ring, not the sounding). Values used only by step 10 make A4 false, values used only by step 11 make `inversion` null, values used only by z₀ make `z0` null; none of these touch A5. `missing` = sorted names of the step 2–9 values that are null. With refEmpty (step 2) the values of steps 3–9 are not needed, and `complete` = Z850 ∧ Z700 non-null (A2 = A3 = A4 = false anyway, Q-14). Z850 null → A5 false even where 850 hPa is under ground (literal L239; `summary.a5SoundingMissing` counts the scenes this removes, for the S4 §0.5 record).
Tests: U-REF on synthetic soundings (Denver-like Z850 < z_ref + 500 → L = [700], p_hi = 500; both levels; empty L; reversed 500 hPa wind → A4 false; null T2m → complete true, inversion null; null V600 → complete true, A4 false with reason "null"; null RH at p_hi → complete false).

### 1.13 Allow-list and B loaders
- `load_scene_meta(path)` (inside `allow('scene-json')`): `json.load`; build `{site, lat, lon, date, grid, cellKm, ring: [{dist, az}…]}`; `del` the parsed object; never log values. U-ALLOW: a fake scene with `trueGrid`, `cover`, `empty`, ring covers and extra keys returns exactly the allowed keys; builder outputs are byte-identical with and without the fake keys.
- `load_B(scene, timeKey, band, inputs)`: read `.harness/oro/base/<scene>__<timeKey>__<band>.f32`, check sha256 = `inputs…bSha256[band]` (mismatch → raise), `np.frombuffer('<f4').reshape(128,128).astype(f64)`.
- `sun_alt_deg(t, lat, lon)`: verbatim copy of `ring/solar_util.sun_alt_deg` (NOAA approximation with equation of time, the one §2.7 fix 1 cites, Q-30); U-SUN compares with the original on 200 times.
- `sun_az_deg(t, lat, lon)` (M4, L592): same series as `sun_alt_deg` (g, decl, eqt, tst, ha = radians(tst/4 − 180), la); az = (degrees(atan2(sin ha, cos ha·sin la − tan decl·cos la)) + 180) mod 360, clockwise from north. U-SUNAZ: 40°N, lon 0, 2026-10-15 at local mean solar time 9.02 h → 132 ± 1° (ruler L524 "≈ 132°"); solar noon → 180 ± 0.5°; a northern-hemisphere morning is in (90, 180).
- The PNG decoder `empty_cells(png)` lives in `oro.py` (S3b, §6.2), never in `oro_ref`; `oro_ref` itself never decodes a bank PNG.

### 1.14 Scene evaluation (§2.6 L286-L308) — `evaluate_scene(name, inputs, dem, geom) -> row`
Uses only `oro-inputs.json`, `dem-grids.json`, `cmr-geom.json`, B files (closest time).
- A1 = site A1 value ≥ 100 m (§1.5).
- A5 = dem complete ∧ snd.complete (§1.12 step 12) ∧ every band nullCount ≤ 9 at the closest time (L216, L293).
- If A5 ∧ ¬refEmpty ∧ speedRef > 0: F, F_rev, dC (combine on B_total), dC_rev, app combines on B_low and B_mid with the same F; masks with zSnow and B_high. Else those fields null and `judge = false`.
- A2 speedRef ≥ 5; A3 N² ≥ 1e-5 (pre-clip value, L291); A4 §1.12.
- A6 judge = combine(B_total, F).ok; A6 app = low.ok ∧ mid.ok (L294, L427).
- A7: |S| ≥ 20 with S = {b ∈ W_in : |box15(dC)_b| ≥ 0.02} (L498; W_in = 225 − (snow ∪ high), no empty-pixel mask, §1.8).
- A8 from `cmr-geom.json` (§2).
- `appA` = A1 ∧ A2 ∧ A3 ∧ A4 ∧ A5 ∧ A6app; `judge` = A1 ∧ … ∧ A5 ∧ A6judge ∧ A7 ∧ A8 (L298); `devJudgeable` = judge for dev scenes (G6(f) source, Q-44).
- Counts (all on W_in, MODIS-free): |W|, |S|, |S∪| (S∪ = {b ∈ W_in : |dC_b| ≥ 0.02 ∨ |dC_rev,b| ≥ 0.02}), masked boxes snow/high/both. The judge-time sets on `M_judge` are S3b (§6.2).
- D_dc = pearson over W_in of box15(F) and box15(B_total − gauss_smooth(B_total, 20 km)) (L573, Q-27).
- preCorr (L541): pearson over S of (box15 F, box15 hsub), (box15 F_rev, box15 hsub), (box15 dC, box15 B_total).
- Splits (L305, L592): crossTrackKm (cmr-geom), ≤ 430 flag; coastShareW = share of W boxes with `sea_box` (Q-26); surfaceInversion (§1.12, null → "unknown"); NhU = N·max_window|hsub|/speedRef with bins `le1`, `1to3`, `gt3` (Q-17); seam, multiPass, singlePass = ¬multiPass; **sun-facing slope** (M4): `sunAzDeg` = `sun_az_deg` at the closest time, `sunSlopeExcl` = sorted flat box indices b with `slopeDeg15[b]` ≥ 5 and angular distance(`aspectDeg15[b]`, sunAzDeg) ≤ 45° (inclusive both; distance = min(|Δ| mod 360, 360 − |Δ| mod 360)). The split "해 쪽 비탈을 뺀 판" removes those boxes from W, S, S∪ (DEM and pass time only).
- m8 (L307): `member` = held ∧ appA ∧ (¬A7 ∨ ¬A8); `rmsDC` = √mean over the 225 window boxes of box15(dC)² (judge path, post-clip, no mask, Q-18); `rmsDCapp` null (S3b).
- Placeholders filled by S3b `oro.py --fill-apply`: `lambdaApp`, `maskedAppShare`, `G7corr`, `m8.rmsDCapp` (all null in S3a).
- Extension scenes: `sunAltDeg` at closest time; `extSunOk` = sunAltDeg ≥ 20 (L315, inclusive); `extTarget` = site ∈ summary.extTargetSites. `counted` = held ∧ judge ∧ (bank = orig ∨ (extSunOk ∧ extTarget)) (L315, L318); every summary count uses `counted`.
- Scenes whose site has no sounding yet: `snd` null → A2–A4 false, A5 false (`soundingMissing: ["site"]`), F/ΔC fields null; listed in `summary.pendingSites`.
- **Time arms at the bank edges** (D9): a time arm (latest, m1h, p1h) whose ring hours are outside the raw range gets ring arrays of 91 NaN with `nullIdx` = 0..90 (`fetch-nwp-ring.interp` returns None), B null for that time (< 12 points), and that scene drops from that arm only (counted, §6.5); nothing crashes. In the original bank this is exactly `sapporo_2026-10-19 p1h` [checked here from `ring/nwp/blend` hour ranges and `modis-times.json` times]; in ext, the m1h of the ~00–01Z Asian scenes on 10-23 and the p1h/latest of the ~23Z scenes on 10-31 [review].

### 1.15 CLI subcommands
`python3 -I tools/genus-ruler/oro/oro_ref.py <cmd> [opts]` — all print counts/sha256 only; exit 0/1.

**`dem-grids`** `[--manifest tools/genus-ruler/oro/dem-manifest.json] [--dem-dir .harness/oro/dem] [--out tools/genus-ruler/oro/dem-grids.json]`
```
{ "schema":"dem-grids/1",
  "grid":{"n":128,"cellKm":6.0,"rows":"south->north","cols":"west->east","observer":"corner of cells 63/64"},
  "mapping":"equirectangular: lat=lat0+y/111.32, lon=lon0+x/(111.32 cos lat0); pixel centre in cell",
  "decode":"R*256+G+B/256-32768; h=max(0,elev) per pixel; no despike",
  "sources":{"demManifestSha256":hex},
  "sites":{ "<site>":{ "lat":f,"lon":f,"zoom":int,"complete":bool,
      "tilesUsed":{"z/x/y":hex}, "pixPerCell":[min,max],
      "hmean6":f32b64(128²) | null, "hmax6":f32b64(128²) | null,
      "hmax12":f32b64(64², even tiling) | null, "hmean12":f32b64(64², even tiling, pixel-weighted) | null,
      "slopeDeg15":[225 f] | null, "aspectDeg15":[225 f] | null,
      "a1RmsM": f | null, "zRefM": f | null } } }
```
Size ≈ 2.5 MB (Q-1 explains `hmax6`). `a1RmsM`, `zRefM` are computed from the decoded float32 grids after the round trip (D5). Data hashes only in `sources` (D7): the code hash of `oro_ref.py` lives in `oro-apply.sources.code` and FROZEN, so a code edit that does not change the grids leaves `dem-grids.json` byte-identical.

**`inputs`** `[--banks orig[,ext|,pre2]] [--out tools/genus-ruler/oro/oro-inputs.json] [--sounding .harness/oro/sounding.json] [--sounding-ecmwf .harness/oro/sounding-ecmwf.json] [--dem-grids …]`
- Bank table: orig → scenes `.harness/macro/sat`, times `ring/modis-times.json` (+ `modis-times-latest.json`), ring tag `blend`, sounding as given; ext → `.harness/oro/sat-ext`, `oro/modis-times-ext.json`, `blend-ext`; pre2 → `sat-pre2`, `modis-times-pre2.json`, `blend-pre2`, `sounding-oro-pre2.json`; extN (post-freeze, separate `--out oro-inputs-extN.json`) → `sat-extN`, `modis-times-extN.json`, `blend-extN`, `sounding-oro-extN.json`.
- Scene list = bank file **names** (`*.json` except `index.json`, no open) ∩ times keys (L208, L280). Scope = all of them (Q-19). For each scene: `load_scene_meta` and assert lat/lon/date equal SITES/name, grid/cellKm = 256/3.0, ring geometry = RING; ring raw `points` (dist, az) equal RING order.
- `latest` time: orig from `modis-times-latest.json`; ext/pre2/extN derived from the entry's `passes` exactly as `fetch-modis-time.py` (cands = passes with `center`, else all; max `mid`) (Q-21; U-LATEST asserts the derivation equals `modis-times-latest.json` for all 121).
- Ring per time and band: `fetch-nwp-ring.blend(hourly, var, raw['models'])` then `fetch-nwp-ring.interp(times, series, t_iso)`, /100.0; None → NaN (L214). Times outside the raw range → all 91 NaN (D9, §1.14).
- Sites without a sounding record: `snd: null`, scene recorded (A5 false, provisional). Same for ecmwf (`sndEcmwf: null` until R11). `pendingSites.sounding` = sorted `fetch-sat SITES` with no record in the sounding file (derived from the data, D4).
- Snow memory per time: `zSnow` (21 d), `zSnow7`, `zSnow42` with their valid-hour counts (M2, L733, L359), all from the bank's own sounding file (orig/ext: `sounding.json`, 06-01..10-31, so the 42-day window of a 09-01 scene starts 07-21 and is covered; pre2/extN: `sounding-oro-{pre2,extN}.json`, which starts at first date − 21 d by the §2.7 command, L331, L619 — so `zSnow42` is null there and those scenes drop from the 42-day arm only, §6.5).
- Sounding provenance (M7): `sounding.json` is a re-serialisation (`fetch-sounding.py`: `data[name] = {lat, lon, elevation, hourly}`), so the manifest's raw-body sha256 cannot be linked to it. `sources.sounding.*.sites[site].hourlySha256` = sha256 of `json.dumps(hourly, sort_keys=True, separators=(',', ':'))`; `nulls` = the manifest's per-variable null counts for the §3.5/z₀ variables (R1, for the S4 §0.5 record).
```
{ "schema":"oro-inputs/1",
  "grid":{…as dem-grids…}, "ring":{"n":91,"order":"fetch-sat RING, observer first","encoding":"f64b64 LE, NaN=null, nullIdx"},
  "sources":{ "demGridsSha256":hex, "times":{"<path>":hex}, "ringRaw":{"<tag>/<site>":hex},
              "sounding":{"bestMatch":{"path":s,"fileSha256":hex,"manifestSha256":hex,
                                       "sites":{"<site>":{"hourlySha256":hex,"elevation":f,"firstHour":s,"lastHour":s,"nulls":{"<var>":int}}}},
                          "ecmwf":null|{…same…}},
              "code":{"fetch-nwp-ring.py":hex,"fetch-sat.py":hex} },          # FROZEN `old` files only (D7)
  "scenes":{ "<site>_<date>":{
      "site":s,"lat":f,"lon":f,"date":s,"group":"dev|held","bank":"orig|ext|pre2",
      "multiPass":b,"seam":b,"ringGeom":{"dist":[91 int],"az":[91 int]},
      "demTiles":{"z/x/y":hex}, "zSfc":f|null, "zRef":f,
      "times":{ "closest|latest|m1h|p1h":{
          "utc":"YYYY-MM-DDTHH:MM:SSZ",
          "ring":{"total|low|mid|high":{"f64":f64b64(91),"nullIdx":[int]}},
          "snd": REF|null, "sndEcmwf": REF|null,
          "z0":f|null, "zSnow":f|null, "zSnowValidHours":int,
          "zSnow7":f|null, "zSnowValidHours7":int, "zSnow42":f|null, "zSnowValidHours42":int|null,
          "bSha256":{"total|low|mid|high":hex|null}|null,
          "bSha256n64":{"total|low|mid|high":hex|null}|null } } } } }      # n64: closest only, else absent
REF = { "model":"best_match|ecmwf_ifs025","complete":b,"missing":[s],
        "levels":{"850|700|600|500":{"T_C":f|null,"RH_pct":f|null,"Z_m":f|null,"U":f|null,"V":f|null}},
        "interpHow":{"<var>":"exact|fallback2|fallback1"}   (only non-linear entries),
        "T2m_C":f|null, "refLevels":[int], "refEmpty":b, "Vref":[U,V]|null, "speedRef":f|null,
        "pLo":int|null,"pHi":int|null,"thetaV":[lo,hi]|null,"N2":f|null,"N":f|null,
        "Tbar_K":f|null,"RHbar":f|null,"gamma_Kpm":f|null,"Hw_m":f|null,
        "Clm":f|null,"sRel":f,"sRelBranch":"inv|default|default-noClm","gammaS":f|null,"kappa":f|null,"f":f,
        "A4":{"dots":{"700|600|500":f|null},"ok":b,"reason":"ok|dot|null|refEmpty"}, "inversion":{"level":int,"flag":b}|null }
```
z0/zSnow are best_match only (the ecmwf arm uses the same masks, Q-46). Size ≈ 2–3 MB for 121 scenes × 4 times. `oro_ref.py`'s own hash is not stored here (D7); instead S4 rebuilds `oro-inputs.json` with the FROZEN `oro_ref.py` and requires byte identity.

**`seal-inputs`** `[--inputs …] [--base-index .harness/oro/base/index.json]`: require index `inputsFileSha256` = sha256 of the current `oro-inputs.json` bytes (B was built from exactly this file; oro-base ignores `bSha256`/`bSha256n64`, so building from a sealed file is equivalent); if `bSha256`/`bSha256n64` are already filled they must equal the index (idempotent re-seal); copy every n = 128 sha256 into `times[*].bSha256` and every n = 64 sha256 into `times.closest.bSha256n64`; rewrite with `dump_json`.

**`ring-manifest`** `[--tags blend[,blend-ext,blend-pre2]] [--out tools/genus-ruler/oro/ring-manifest.json]` (L374; moved here from `oro-fingerprint.py`, C3):
`{schema:"ring-manifest/1", tags:{"<tag>":{"<site>":{path, sha256, bytes, nPoints:91, models:[…], endpoint, nHours, firstHour, lastHour}}}}`. Reads raw NWP files only (allowed; `bytes` of NWP files are not MODIS-derived).

**`bank-manifest`** `[--banks orig[,ext,pre2]] [--out tools/genus-ruler/oro/bank-manifest.json]` (L375; moved here, C1, C3):
`{schema:"bank-manifest/1", banks:{"<bank>":{dir, n, scenes:{"<name>":{jsonSha256, trueGridSha256, pngSha256|null, inTimes:b}}}}}` — **no file sizes** (C1). JSON file bytes hashed; then (inside `allow('scene-json')`) `json.load`, `trueGridSha256 = sha256(sc['trueGrid'].encode('ascii'))`, `del sc` — never base64-decoded, never printed. PNG: `open(p,'rb').read()` inside `allow('png-hash')`, hashed, never passed to Pillow. Scene names from the directory listing (sorted, no stat). Prints counts only (`n`, `nPng`, `nInTimes`). Post-freeze extN writes `ring-manifest-extN.json`, `bank-manifest-extN.json` with the same frozen code (L333).

**`apply`** `[--inputs …] [--dem-grids …] [--cmr-geom …] [--base .harness/oro/base] [--out tools/genus-ruler/oro/oro-apply.json]`
```
{ "schema":"oro-apply/1",
  "sources":{"oroInputsSha256":hex,"demGridsSha256":hex,"cmrGeomSha256":hex,
             "base":{"commit":s,"bundleSha256":hex,"esbuild":"0.28.2"},
             "code":{"oro_ref.py":hex,"fetch-nwp-ring.py":hex,"fetch-sat.py":hex},
             "env":{"python":s,"numpy":s,"Pillow":s,"machine":s,"numpyCpuBaseline":[s],"numpyCpuDispatch":[s]}},
  "constants":{…§1.1 thresholds…},
  "scenes":{ "<name>":{
     "site","date","group","bank","singlePass","multiPass","seam",
     "A1":{"rmsM":f,"ok":b}, "A2":{"speed":f|null,"ok":b}, "A3":{"N2":f|null,"ok":b}, "A4":{"dots":{…},"ok":b,"reason":s},
     "A5":{"dem":b,"sounding":b,"soundingMissing":[s],"ringNull":{"total|low|mid|high":int},"ok":b},
     "A6":{"judge":{"iters":int,"converged":b,"maxGdC":f,"ok":b}|null,
           "app":{"low":{…},"mid":{…},"ok":b}|null},
     "A7":{"S":int|null,"ok":b}, "A8":{"ok":b,"status":s},
     "appA":b, "judge":b, "counted":b, "devJudgeable":b|null,
     "counts":{"W":int,"S":int,"Scup":int,"maskedSnow":int,"maskedHigh":int,"maskedBoth":int}|null,
     "Ddc":f|null, "preCorr":{"F_hsub":f|null,"Frev_hsub":f|null,"dC_B":f|null}|null,
     "split":{"crossTrackKm":f|null,"crossTrackLE430":b|null,"coastShareW":f|null,"surfaceInversion":b|null,"NhU":f|null,"NhUBin":s|null,
              "sunAzDeg":f,"sunSlopeExcl":[int]},
     "m8":{"member":b,"rmsDC":f|null,"rmsDCapp":null},
     "lambdaApp":null,"maskedAppShare":null,"G7corr":null,
     "armInputs":{"zSnow7":b,"zSnow42":b,"latest":b,"m1h":b,"p1h":b,"n64":b},   # input present for that §6 arm (MODIS-free)
     "sunAltDeg":f,"extSunOk":b|null,"extTarget":b|null } },
  "summary":{
     "provisional":b, "pendingSites":{"sounding":[s],"ring":[s]}, "ecmwfArm":"available|못 잼(미수신)",
     "n":int, "nDates":int, "nSites":int, "perSite":{"<site>":int}, "maxSiteShare":f,
     "c1":{"n>=20":b,"dates>=8":b,"sites>=3":b,"maxShare<=0.5":b,"pass":b},
     "a1BySite":{"<site>":{"rmsM":f,"ok":b}}, "a5SoundingMissing":{"<var>":int},
     "nSinglePassJudge":int, "gshufSites":[s], "gshufScenes":int, "c3bMeasurable":b,
     "devJudgeable":[name], "extTargetSites":[s],
     "m8":{"count":int,"scenes":[name]},
     "armDrops":{"<arm>":int},
     "DdcMedian":f|null, "primaryMetric":"rho_res|rho_fine",
     "lambdaAppMedian":null, "lambdaTilde":null, "maskedAppShareMedian":null, "G7median":null } }
```
- n, dates, sites, shares count **held** judge scenes (orig + counted ext). gshufSites = held sites with ≥ 3 judge scenes; gshufScenes = their judge scenes; c3bMeasurable = gshufScenes ≥ 10 (L306, L355). extTargetSites = held sites with A1 true (L314). primaryMetric = `rho_fine` iff DdcMedian ≥ 0.3 (L574; the FROZEN `decisions` copy is S4).
- **Median sets** (M6): `DdcMedian` (L574 "판정 held 장면의 중앙 D_dc"), `lambdaAppMedian`/`lambdaTilde` (L511), `G7median` (L754) and `maskedAppShareMedian` (L308) are medians over the **`counted`** scenes (held judge scenes, orig + counted ext). dev scenes never enter them.
- `a5SoundingMissing` = for each §1.12 step 2–9 variable, the number of held scenes whose A5 is false because that value is null (R1); `armDrops` = per §6 arm, the number of `counted` scenes whose arm input is missing (D9, M2).
- Stdout of `apply` (DEM/NWP-only numbers, allowed, §7 of the review): per site `A1 rms`, `A1 ok`, counted judge scenes; then the c1 components (`n`, dates, sites, max share), labelled `PROVISIONAL` while `provisional` is true (L311: the §2.7 count is the one made after 10/10 soundings and rings).
- Summary is recomputable from rows (test B-SUM).

---

## 2. S3a — `tools/genus-ruler/oro/oro-geom.py` → `cmr-geom.json` (A8, m3)

`python3 -I tools/genus-ruler/oro/oro-geom.py [--banks orig[,ext|,pre2]] [--sat-times tools/genus-ruler/regime/sat-times.json.gz] [--fetch-missing] [--cache .harness/oro/cmr-extra.json] [--out tools/genus-ruler/oro/cmr-geom.json]` (times file per bank from the §1.15 bank table; extN → `cmr-geom-extN.json`, L333)

| id | function | spec |
|---|---|---|
| R-G1 | `pass_granules(entry)` | Regroup `entry.times` (granule `time_start` strings) sorted; new group when gap > 1800 s; mid = first + (last + 5 min − first)/2; return the group whose mid formatted `%Y-%m-%dT%H:%M:%SZ` == `modisTimeUtc`. `source == 'solar'` or no match → status `no-pass`, A8 false |
| R-G2 | `point_in_poly(lat, lon, poly)` | verbatim copy of `fetch-modis-time.py:point_in_poly` (longitude wrap). Test U-GEOM0 compares the copied text with the function text read from `fetch-modis-time.py` as text (no import) |
| R-G3 | polygons | `sat-times.json.gz` (gzip JSON): queries with `sat == 'terra'`, `site`, period containing the date; granule with `time_start == start` and `day_night_flag == 'DAY'`; each string in `polygons[*]` → list of (lat, lon) pairs (same parse as fetch-modis-time). Terra only |
| R-G4 | missing granules | sat-times used CMR `point=` queries, so pass granules not containing the site are absent (Q-23). If any corner is outside the available polygons **and** the pass has granules not in sat-times: with `--fetch-missing` query `https://cmr.earthdata.nasa.gov/search/granules.json?short_name=MOD03&temporal=<start>,<start+299 s>&page_size=50` (≥ 1 s between queries, 3 failures → exit 2, cache in `.harness/oro/cmr-extra.json`); without it → status `missing-granules`, A8 null, and `apply` refuses to build |
| R-G5 | corners | (lat0 ± 90/111.32, lon0 ± 90/(111.32 cos lat0)), order SW, SE, NE, NW (window edges, L490) |
| R-G6 | A8 | all four corners inside ∪ polygons of the pass granules (L296) |
| R-G7 | cross-track | Granule of the pass containing the site (first by time; none → nearest polygon centroid). Polygon strings repeat the first pair at the end (`'45.978 149.992 … 45.978 149.992'`, checked in `sat-times.json.gz`): drop that closing vertex before naming p0..p3 (D8); a polygon with ≠ 4 distinct vertices after that → crossTrackKm null, `crossTrackStatus: "nonquad"`. Opposite-edge pairs {p0p1, p2p3}, {p1p2, p3p0}; the cross-track pair is the pair whose mean initial bearing is farther from north–south (Terra sun-synchronous, |lat| ≤ 54°, Q-24). Track = great circle through the midpoints of the two cross-track edges; crossTrackKm = |asin(sin(d₁₃/R) sin(θ₁₃ − θ₁₂))|·R, R = 6371.0 km |

```
{ "schema":"cmr-geom/1",
  "sources":{"times":{"<bank>":{"path":s,"sha256":hex}},"satTimesSha256":hex,"cmrExtraSha256":hex|null},   # one times hash per bank once ext is merged (Q-25, D8)
  "rules":{"passGapS":1800,"granuleMin":5,"corners":"±90 km equirectangular","sat":"terra/MOD03"},
  "scenes":{ "<name>":{ "site","date","modisTimeUtc","passMid",
       "granules":[{"start":s,"end":s|null,"polygons":[[[lat,lon],…]],"source":"sat-times|cmr"}],
       "corners":[[lat,lon]×4], "cornersInside":[b×4], "A8":b|null,
       "siteGranule":s|null, "crossTrackKm":f|null, "crossTrackStatus":"ok|nonquad|none",
       "bank":s, "status":"ok|no-pass|missing-granules" } } }
```
Tests: U-GEOM1 synthetic quad polygon (corner in/out, antimeridian wrap); U-GEOM2 all 121 scenes get a status, counts per status printed (no corner coordinates printed); U-GEOM3 cross-track = 0 for a site on a synthetic track and ≈ 1165 km at a swath edge (± 2 %).

---

## 3. S3a — `tools/genus-ruler/oro/oro-base.mjs` (§3.4 L412-L417)

`node tools/genus-ruler/oro/oro-base.mjs --inputs <oro-inputs.json> --commit <sha> [--out .harness/oro/base] [--scenes a,b] [--check]`
The only path arguments are `--inputs` and `--out` (plus the git `--commit`); no option can point it at a bank, ring raw or sounding file (C5).

1. Extract at `<commit>` with `git show <commit>:<path>` (child process) into `.harness/oro/base-bundle/<commit>/`: `src/utils/macroField.ts` and `src/components/VolumetricProbe/cloudFlow.ts` only. `cloudFlow.ts` has `import type { GenusKey } from './cloudGenus'`, which esbuild strips, so `cloudGenus.ts` is **not** extracted (D6; if esbuild ever resolved it, it would pull `three` and five more modules, and step 4 would refuse).
2. Write `entry.ts`: `export { buildMacroField, samplesFromRing } from './src/utils/macroField.ts';`
3. `npx --yes esbuild@0.28.2 entry.ts --bundle --format=cjs --platform=node --outfile=macro.cjs --log-level=warning` with cwd = that dir (relative paths in bundle comments are then commit-independent).
4. Refuse if the bundle matches `/require\(["'](three|react-native)["']\)|from\s*["'](three|react-native)["']/`. Print `BUNDLE <sha256> esbuild 0.28.2 node <version> commit <sha>`.
5. Read **only** `--inputs` (via `fs.readFileSync`; module must use `import fs from 'node:fs'` so G8(a) can hook it). Ignore every key except `scenes.*.ringGeom`, `scenes.*.times.*.ring` (and `bSha256` in `--check`).
6. For each scene (sorted) × time (sorted) × band ∈ [total, low, mid, high]: decode f64 into a fresh, 8-byte-aligned buffer — `new Float64Array(Uint8Array.from(Buffer.from(s, 'base64')).buffer)` (pooled `Buffer` byteOffsets are not 8-aligned, so `new Float64Array(buf.buffer, buf.byteOffset, 91)` can throw; D6); points = indices with finite values; fewer than 12 → B null (app rule `pts.length >= 12`, Q-31; this also covers the all-NaN time arms at the bank edges, D9); else
   `samples = samplesFromRing(points.map(i => ({distance: dist[i], azimuthOffset: az[i], cover: c[i]*100})))`,
   `B = buildMacroField(samples, {n: 128, cellKm: 768/128, noise: false}).base` (the `applyScene` call; state null).
   For the closest time only, also `B64 = buildMacroField(samples, {n: 64, cellKm: 768/64, noise: false}).base` (§6 64² × 12 km arm, L740, M3; same samples, same call shape).
7. Write `<out>/<scene>__<time>__<band>.f32` (and `<out>/<scene>__closest__<band>__n64.f32`) = `Buffer.from(B.buffer, B.byteOffset, B.byteLength)` (D6; assert `os.endianness() === 'LE'` and byteLength = 4n²); print `B <scene> <time> <band> <n> <sha256>`.
8. Write `<out>/index.json` (sorted keys): `{schema:"oro-base-index/1", commit, bundleSha256, esbuild:"0.28.2", node, inputsFileSha256: sha256 of the raw input file bytes read, entries:{scene:{time:{band:hex|null}}}, entriesN64:{scene:{band:hex|null}}}`. (`node` stays in this uncommitted index; `oro-apply` records only commit and bundle sha256, D7.)
9. `--check`: rebuild in memory, compare with `bSha256` and `bSha256n64` in the inputs; print `CHECK same <n> diff <m> null <k>` (n128 and n64 counted separately); exit 1 if m > 0 (§9.3 ④ 5 is S3b; it covers both n).

Test G8(a) (in oro-test.py, §5.4).

---

## 4. S3a — manifests (in `oro_ref.py`) and `oro-fingerprint.py` (unchanged)

- The manifest builders are the `oro_ref.py` subcommands `ring-manifest` and `bank-manifest` (§1.15). `oro_ref.py` is already FROZEN (L874), so the §9.2 file list does not change, and L333 ("같은 동결 코드로 … `ring-manifest-extN.json`·`bank-manifest-extN.json`") is met by the same file.
- `bank-manifest.json` carries sha256 only — `jsonSha256`, `trueGridSha256`, `pngSha256`, `inTimes` (L375 "sha256(값 없음)"); revision 1's `jsonBytes`/`pngBytes` are removed (C1: PNG compressed size follows the cloud texture and swath gaps; scene-JSON size follows the decimal length of MODIS `cover`, `empty` and ring covers).
- **`oro-fingerprint.py` stays byte-identical** (C3): sha256 `b03800e75e40984f9834157973a2082b7bf129c9a44ed32438c7b020d5c213f6` (4c05bed), the code that produced F1–F3 in `restore-fingerprints.json`. It is FROZEN as "F1~F3" (L874), so FROZEN must hash the code that made the recorded fingerprints; adding modes would break that. It installs no guard (its `--f1` reads the bank `index.json` and `--f3` reads `ring/gate-blend-held.json` by design, L264, L276). Test U-FP checks the sha256 and that importing it runs nothing (`main` guarded). G8(b) exercises it only on synthetic files with patched module constants (§6.9).

---

## 5. S3a — `tools/genus-ruler/oro/oro-test.py` → `oro-test.txt`

`python3 -I tools/genus-ruler/oro/oro-test.py [--fetch-ref] [--only <ids>] [--out tools/genus-ruler/oro/oro-test.txt]`. Installs the guard. Each test prints one line `ID PASS|FAIL|SKIP <key=value…>` (MODIS-free values only, fixed formatting `%.6g`); the file is these lines sorted by id, no timings. Exit 0 iff no FAIL; SKIP is not a pass for the §9.1 ⑨ freeze threshold.

**Header of `oro-test.txt`** (fixed text, first lines, `#`-prefixed; Q-34/Q-35 disclosure): "# Pinned additions, not ruler values: G6(a) eight-case split (Q-32), G6(b) rms definition and precip_base/precip_min (Q-33), G6(d) mountains, bands and the report-only easterly mirror (Q-34), G6(e) quadrant sea-fraction thresholds (Q-35). Q-34/Q-35 were pinned after a DEM-only prototype run (no MODIS, no B); criteria are fixed as written before the first oro-test run (L793)." The S4 §0.5 record repeats this.

### 5.1 Unit tests (formula vs hand values; all listed in §1)
U-PHI, U-G, U-TUKEY, U-HP, U-WIND (from 0/90/180/270/225 at 10 m/s → (0,−10), (−10,0), (0,+10), (+10,0), (7.0710678,7.0710678)), U-M, U-M2 (shared `vertical_m`, §1.6), U-D, U-THERMO, U-INT0, U-INT, U-Z0, U-Z0B (deep-underground nulls, §1.11), U-ZSNOW (21/7/42 d), U-REF (incl. the step-12 `complete` cases), U-ZREF, U-COMB1..4, U-BOX (box (7,7) centre (0,0); rows 49..78; flat order), U-DEM1/2, U-SLOPE, U-ALLOW, U-LATEST, U-SITES, U-SUN, U-SUNAZ, U-GEOM0..3, U-HASH (dump_json determinism, f32b64/f64b64 round trip, NaN↔nullIdx), U-PEARSON (n = 0 → None, n = 1 → 0.0, constant → 0.0), U-FP (`oro-fingerprint.py` sha256 = b03800e7…13f6, import runs nothing), U-GUARD (each forbidden pattern raises `PermissionError` from the audit hook before any file is touched — tested with non-existent names such as `.harness/macro/sat/__guard_probe__.png`, so no real bank file is opened; the same probe under `allow('png-judge')` with no `judge.lock` raises; no `__pycache__` written).

### 5.2 Builder tests
- **B-SYN**: synthetic sounding file for all 10 sites (generator in oro-test: standard atmosphere T = 15 − 6.5 z/km °C, Z(p) = 44330.8(1 − (p/1013.25)^0.190263), RH 70 %, wind from 270° 10 m/s at all levels, elevation 0, 06-01..10-31 hourly, injected nulls at fixed hours to exercise fallback1/fallback2/None) → `inputs` and `apply` into `.harness/oro/test-tmp/`; schema checks, every scene has snd, L = [850, 700], N² ≈ 1.1e-4. A second variant sets elevation 1600 m for one site with null 1000..900 hPa values (Denver-like): z₀/z_snow valid, A5 unaffected (R1).
- **B-DET**: run `inputs` twice → byte-identical; `apply` twice → byte-identical; `dem-grids` twice → byte-identical. Each run is a **separate** `python3 -I` subprocess (so `str` hash seeds differ between the two runs, D1).
- **B-BUSAN** (D4): real `sounding.json`. Expected `pendingSites.sounding` = the sorted `fetch-sat SITES` with no record in `sounding.json`, computed by the test from the file; expected `provisional` = (that list non-empty) ∨ (`pendingSites.ring` non-empty). Every site with a record has complete scenes where its data allow; sites without one have `snd: null`. A missing `sounding-ecmwf.json` (R11) only sets `ecmwfArm`, never `provisional`. With 10/10 sites the test asserts an empty list and `provisional = false` — no code or criterion changes when the 11-05 data arrive.
- **B-RING**: for 3 scenes, closest total ring f64 = `fetch-nwp-ring.interp(...)/100.0` bit-exact.
- **B-SUM**: summary recomputed from rows equals the stored summary.
- **B-BASE**: `oro-base.mjs --check` exit 0 (n = 128 and n = 64); every B in [0, 1], finite; every closest time has n = 64 files for the bands whose n = 128 B is non-null.

### 5.3 G6 (a)–(e) (L759-L763; pinned additions are Q-32..Q-35)
- **G6(a) Witch of Agnesi**: grid 512² × 2000 m, x_i = (i − 256)Δ (crest on a node), h₀ 100 m, a 10 km, U 10 m/s, N 0.01, f = 0, mean mode zeroed. η(z) = Re ifft2(ĥ·`vertical_decay`) at z = λ_z/4 = (π/2)U/N = 1570.8 m. Eight cases = 2 ridges (h(x), h(y)) × 4 winds (toward +x, −x, +y, −y):
  - 4 perpendicular cases: along-wind coordinate s = ±x or ±y; on |s| ≤ 100 km, max|η − η_a| ≤ 5 m with η_a = −h₀ a s/(s² + a²); argmax η at s = −a (upwind); η_w (col_weight, D(σ) with |V| = 10, H_w 2500, no HP/taper/clip) has η_w(s = −a) > 0 > η_w(s = +a).
  - 4 parallel cases: max|η| ≤ 1e-9 m and max|η_w| ≤ 1e-9 m.
- **G6(b) fastscape**: `--fetch-ref` downloads `https://raw.githubusercontent.com/fastscape-lem/orographic-precipitation/baf8a0c13855fdef88b4ad995fd59c6e69834e00/orographic_precipitation/orographic_precipitation.py` (urllib like `fetch-dem.py`, 3 tries) into `.harness/oro/ref/` (that file only); sha256 must be `3d924a41b4032ec019686f1ff96d5871a557bda498913837515dd929aae8e98d` (same as draft-1 method.md §0), else FAIL; never vendored. The sha256 is checked on the file bytes **before** `exec_module`; on a mismatch the file is not imported (D8). Loaded by importlib (it imports only numpy). Terrain: draft-1 `synth_terrain(128, 6000, beta=3, rms=400, seed=7)`, h −= h.min(). Params: latitude 37, wind_speed 10, wind_dir 270/180/225, nm 0.01, hw 2500, conv_time = fall_time = 1000, cw 0.004, **precip_base 1e4, precip_min 0** (keeps P > 0 so `P[P<=0]=precip_min` never fires). P_fs = (fs(h[::-1], 6000, 6000, …)[::-1] − 1e4)/3600 (fastscape raster row 0 = north). Ours: pad = `min(int(np.ceil(sum(h.shape)/2)/100*100), 200)` (fastscape's expression), zero pad, kgrid on the padded size, (U, V) = wind_to_uv(10, d) (our V = −S cos d: fastscape's v0 = +S cos d points along increasing row = south, L386), `col_weight(branch='fastscape')`, P̂ = cw·iσĥ·W/((1 + iστ_c)(1 + iστ_f)), de-pad. Criterion: rms(P − P_fs)/std(P_fs) ≤ 1e-5 for all three winds (Q-33). Also record the physical-branch value (report).
- **G6(c)**: U-COMB1 plus, if B files exist, `combine(B, 0)` array_equal for the first 3 scenes (sorted) × 4 bands; `apply_or_identity(B, F, False) is B`.
- **G6(d) known mountains**: dev DEM grids; synthetic sounding: from 270° 10 m/s, N 0.01, H_w 2500, κ = γ_s(280)/0.15. Peak cell = argmax hmean6 within 20 km of Hakusan (36.1550°N, 136.7714°E; kanazawa) and Odaesan (37.7944°N, 128.5431°E; seoul, "서울 동쪽 산지"). West band = cells with x ∈ [x_p − 24, x_p − 6] km, |y − y_p| ≤ 12 km; east band x ∈ [x_p + 6, x_p + 24]. PASS iff mean F(west) > 0 > mean F(east) for the westerly, both mountains (L762). The easterly mirror (from 90°) is **report only** (values recorded on the line, not part of PASS). [proto, DEM only] westerly: Hakusan +0.112/−0.137, Odaesan +0.071/−0.103; [review, DEM only] easterly: Hakusan −0.153/+0.132, Odaesan −0.062/+0.123.
  - Rejected part of the review's Q-34/Q-35 item ("keep the easterly mirror as a stricter pass criterion"): L762 names only "가상 서풍 10 m/s", and L793 fixes the test as written ("시험 값은 처음 돌리기 전에 이대로 고정"); a criterion the ruler does not have must not be able to fail G6 and so block the §9.1 ⑨ freeze threshold. The direction-reversal check is already a PASS criterion in G6(a) (four winds).
- **G6(e) DEM orientation + wind**: kanazawa hmean6: sea fraction (h == 0) of cells with x ∈ [−90, −30], y ∈ [30, 90] km (NW) ≥ 0.9 and of x ∈ [30, 90], y ∈ [−90, −30] (SE) ≤ 0.1. [proto] NW 1.00, SE 0.00, NE 0.73, SW 0.51 (a row or column flip fails). Wind: U-WIND hand values, plus the busan sounding at t = 2026-09-01T01:00Z (on the hour, so no interpolation): (U, V) of 700 hPa from `ref_values` has bearing atan2(U, V) ≡ d₇₀₀ + 180° (mod 360, 1e-9°) and |V| = S₇₀₀ of that hour; SKIP if busan sounding missing.

### 5.4 G8(a) — oro-base allow-list (L755)
- Copy `oro-inputs.json` to test-tmp with fake `trueGrid`, `cover`, `empty` keys injected at top, scene and time level; run `oro-base.mjs --scenes <3 scenes> --out <tmp>` on both → all B sha256 identical.
- Run with `node --require <test-tmp>/fs-audit.cjs` (wraps `fs.readFileSync/openSync/readFile/createReadStream/existsSync`, logs paths): opened paths ⊆ {inputs copy, bundle file, node internals}; none under `.harness/macro/`, `ring/nwp/`, `*.png`, `sounding*.json`.
- Python side: U-ALLOW (above).

---

## 6. S3b — `tools/genus-ruler/oro/oro.py` (spec; built after S3a and before freeze)

`oro.py` is a FROZEN file (L874) and cannot change after freeze, so the whole of §6 — including the `--judge` path — is built and tested (G6 (f)–(h), G8 (b)–(f)) before the freeze commit (M1). Imports `oro_ref.py` (all model code, never re-implemented) and from `macro.py` only `load_u8`, `box_mean`, `corr` (by importlib). Installs the guard first. CLI modes:

| mode | when | output |
|---|---|---|
| `--fill-apply` | pre-freeze, MODIS-free | rewrites `oro-apply.json`: per scene `lambdaApp`, `G7corr`, `maskedAppShare`, `m8.rmsDCapp`; summary `lambdaAppMedian`, `lambdaTilde`, `G7median`, `maskedAppShareMedian` |
| `--power` | pre-freeze | `tools/genus-ruler/oro/power-oro.json` |
| `--sunset` | pre-freeze | `tools/genus-ruler/oro/sunset-apply.json` |
| `--ruler-hash` | any | prints `rulerHash` |
| `--precheck` | post-freeze | §9.3 ④ 1–7 + T-read precheck + environment precheck (§6.6), no T read, no lock; exit code |
| `--judge` | once, post-freeze | `tools/genus-ruler/oro/gate-oro-held.json` (with a `dev` report block) |

### 6.1 App path arm (§4.4 L544-L548) — used by `--fill-apply` and the judge
- `app_arm(scene, time)`: B_lo, B_mid, B_hi (closest), C_lo = combine(B_lo, F).C, C_mid = combine(B_mid, F).C (own δ each), C_hi = B_hi. ΔC^app = [1 − (1−C_lo)(1−C_mid)(1−B_hi)] − [1 − (1−B_lo)(1−B_mid)(1−B_hi)] (cells, then box15).
- `tau_band(ring_band, first)`: port of `macroTileCover` (`volumetricScene.ts:1028-1033`): finite points < 12 → first; near = sorted clamp[0,1] covers with dist ≤ 150 km (observer included); len < 6 → first; else max(first, near[min(len−1, floor(0.75·len))]). first = that band's ring point 0 value; null → 0 (Q-36).
- C^vis_band = min(C_band, τ_band), B^vis likewise; C^vis = 1 − (1−C^vis_lo)(1−C^vis_mid)(1−B^vis_hi); ΔC^vis = C^vis − B^vis.
- λ_app = Σ_W ΔC^app_b ΔC_b / Σ_W ΔC_b² (box values, W = W_in); λ̃* = max(1, median over the `counted` scenes) (L510-L511, M6).
- G7corr = pearson_{W_in}(box15 ΔC, box15 ΔC^app); G7 pass iff the median over the `counted` scenes ≥ 0.7 (L754).
- maskedAppShare = Σ_{b∈M_in}(ΔC^app_b)² / Σ_{225}(ΔC^app_b)² (L308, L564; M_in = snow ∪ high, R4); median over the `counted` scenes; m8.rmsDCapp = √mean_225(ΔC^app_b²).
- The pre-freeze values of §6.1 (λ_app, λ̃*, G7, masked app share, m8 app rms) are MODIS-free and use `M_in`/`W_in` (§1.8), never the judge-time empty-pixel mask. ΔC^vis is a cell field; the judged ρ_res^vis/ΔMSE^vis take their box sets from `M_judge` (§6.3).

### 6.2 Truth and judge-time masks (only inside `--judge`, after the lock)
- `load_truth(scene)` (inside `allow('scene-json')`, lock present): `trueGrid` → `load_u8(…, 256)` → flip rows (fetch row 0 = north) → 2×2 mean → T (128,128) (L488). The §6 64² arm uses the 4×4 mean → T64 (64,64).
- `empty_cells(png)` (real bank PNGs opened inside `allow('png-judge')`, which the guard honours only while `judge.lock` exists, C2; the G6(f) fake PNGs in `test-tmp` need no context): Pillow RGB 256² (3 km px), flip rows; empty px = R = G = B = 0; dark px = max(RGB)/255 < 0.02 and not empty (report). Empty boxes on the **extended tiling** (§0.3): every extended box with ≥ 1 empty 3 km px (window box (bi,bj) = 3 km rows 98+4bi..101+4bi).
- **`M_judge` = snow ∪ high ∪ empty** on the extended tiling (R4, L491-L495). It defines W = 225 − M_judge, S and S∪ for every judged and reported metric; then |S| < 20 → scene dropped and counted (L345-L347). It is also the M of the G₁₀ ⊛_M weight (L568) and of the c4·c5 3 km masks (L495). A7, D_dc, λ_app, G7 and the masked app share keep `M_in` (§1.8).
- Scenes without `trueGrid` → dropped and counted (L343). c1 is evaluated on the finally judged set.

### 6.3 Per-scene metrics (§4.1–§4.6), r = T − B_tot, ΔC = C − B (post-clip), box values over the stated set
| name | definition | ruler |
|---|---|---|
| ρ_res | pearson_S(ΔC, r) | L503 |
| β_res, ΔMSE_W, ΔMSE_W(λ) | Σ_W ΔC r/Σ_W ΔC²; mean_W(ΔC² − 2ΔC r); mean_W(λ²ΔC² − 2λΔC r) | L505-L513 |
| d (G-rev) | pearson_S∪(ΔC, r) − pearson_S∪(ΔC_rev, r); either None/0-var → d = 0; G-rev combiner failed → d = 0 | L519, L354 |
| ρ_even, ρ_odd | (ρ′_res ± ρ′_rev)/2 on S∪ | L525 |
| d_shuf,j | sites = `oro-apply summary.gshufSites` (≥ 3 judge scenes, fixed before T). **j** ranges over that site's G-shuf scenes that remain in the finally judged set (scenes dropped for no `trueGrid` or for \|S\| < 20 after the empty-pixel mask have no r_j). **k** ranges over the site's `oro-apply` judge scenes other than j (F_{j\|k} uses only k's sounding, no T, so the k set is T-independent). F_{j\|k} from site DEM + k's `snd` (V_ref, N, H_w, κ, s_rel as stored; f from site lat), combine on B_j; k with failed combiner skipped; ρ̄ = mean_k pearson_{W_j}(ΔC_{j\|k}, r_j); d_shuf = pearson_{W_j}(ΔC_j, r_j) − ρ̄; all k skipped → j excluded. c3b '못 잼' is decided from `oro-apply` only (L355); the post-drop number of j is reported | L526-L535, L354, L355, Q-38, Q-55 |
| ρ_odd,swap; G-shuf 2판 꼴 | ρ_odd,swap = the d_shuf computation with ρ_odd in place of pearson_W: ρ_odd,j − mean_k ρ_odd,j\|k, ρ_odd,j\|k = (ρ′(ΔC_{j\|k}) − ρ′(ΔC_{rev,j\|k}))/2 on S∪_j, ΔC_{rev,j\|k} with k's sounding and (−U_k, −V_k); 2판 꼴 = d_shuf with S∪_j in place of W_j and the **median** as statistic. Report only (M5) | L538, L736 |
| ρ_rot | F from `np.rot90(hmean6, 2)` (180° about the observer corner, exact on this grid), same snd and B; pearson_S∪(ΔC_rot, r); combiner fail → excluded from its median | L539, Q-39 |
| ρ_res^vis, ΔMSE^vis | pearson_S(ΔC^vis, T − B^vis); mean_W((C^vis − T)² − (B^vis − T)²) | L550 |
| L⁻ | strata: sea = `sea_box` ∩ W; land = rest of W split by box-mean h at np.quantile([1/3, 2/3]) (linear), h ≤ q₁ → 1, ≤ q₂ → 2, else 3. Lee = {b ∈ S: ΔC_b ≤ −0.02}, N = {b ∈ W: \|ΔC_b\| < 0.02 ∧ \|ΔC_rev,b\| < 0.02}; L⁻ = Σ_t w_t(mean_{Lee_t} r − mean_{N_t} r), strata with \|Lee_t\| > 0 ∧ \|N_t\| > 0, w_t ∝ \|Lee_t\|; none → 0. Report: window-mean form, sea-agnostic tertile form, L⁻^vis | L551-L562 |
| ρ_fine, ρ_coarse | m = 1 on 6 km cells outside `M_judge` (snow ∪ high ∪ empty, extended tiling, R4); X_coarse = G₁₀(X·m)/G₁₀(m) (`gauss_smooth(…, 10 km, mask)`); fine = X − coarse for X ∈ {ΔC, r} (and ΔC_rev, ΔC_{j\|k} when the primary is fine); box15; pearson_S; sets S/S∪/W from total ΔC | L567-L576 |
| Δcorr12, Δcorr50, ΔmeanErr (masked) | C, B → 256² bilinear: 3 km cell c ↦ 6 km coordinate c/2 − 0.25, clamped to [0, 127] (macroField `sampleGrid` style, Q-40); `M_judge` (snow ∪ high ∪ empty) → 3 km 4×4 per box (extended tiling, R4). corr12: `box_mean(·,4)` on 3 km rows/cols 98..157, positions whose 4×4 window touches a masked cell removed; corr50: `box_mean(·,17)` masked mean Σ(Xm)/Σm, positions with Σm < half the window count removed; meanErr: disc (cell centre r ≤ 380 km) ∩ unmasked; Δ = (C vs T) − (B vs T). Unmasked versions reported | L583-L585 |
| ρ_hp | pearson_S(ΔC, r − G₂₀ r) | L586 |
| windward/lee contrast | W boxes: mean r over F ≥ q₂ minus mean r over F ≤ q₁ (box F tertiles); share of scenes > 0 | L587 |
| screen weight | ΔMSE_W split into boxes with centre ≤ 15 km and 15–90 km (Q-2: the distance rule gives 5 boxes — (7,7) at 0 km and its four edge neighbours at 12 km; the output stores `nNear` = number of near boxes in W per scene and the constant `nNearTiling = 5`, so the "4 상자" text conflict is visible) | L563 |
| splits | each §4.6 split (L592) recomputes the scene metrics on its subset: 13 original dates / ext dates; crossTrackKm ≤ 430 / > 430; coast = drop W boxes with `sea_box` ("h = 0 칸이 절반 넘는" = ≥ 3 of 4, Q-26); **sun-facing slope** = drop the boxes `split.sunSlopeExcl` from W, S, S∪ (§1.14, M4; metrics on the reduced sets, the number of dropped boxes reported; no scene is dropped); NhU bins; surfaceInversion true / false / unknown; seam. Report only | L592 |

### 6.4 Statistics (§4.7 L597-L607)
- Scene values → median over judged scenes (c3b: mean over G-shuf scenes).
- `date_block_ci(values, dates, stat, B=10000, seed=20261103)`: blocks = sorted distinct dates; fresh `np.random.default_rng(seed)` per call; each replicate `rng.choice(blocks, size=G, replace=True)`, concatenate values, stat; percentiles 2.5/97.5 (numpy linear). Port of `eval-ringtruth.date_block_ci` (code copied, original never run).
- `sign_flip_p(values, dates, stat)`: G = #dates; G ≤ 16 → all 2^G sign vectors (`itertools.product((1,−1), repeat=G)`, identity included), p = #(stat_flip ≥ stat_obs)/2^G; G > 16 → `default_rng(20261103).choice([1,−1], size=(65536, G))`, p = (1 + #≥)/65537. Ties count as ≥.
- Fisher z: z = atanh(clip(ρ*, ±0.999999)), weights |S| − 3; site table, LOSO, median of site medians; c6 single-pass subset (n, median, L95; boolean median ≥ 0 reported only).
- **8-day block variant** (§6 L742 "이웃 두 날짜 묶음 블록(8 일)", R5): block id = `(date − 2026-09-01).days // 8` on the fixed 4-day calendar — independent of which dates happen to be judged. Original dates pair as (09-01, 09-05), …, (10-11, 10-15) and 10-19 with 10-23; ext 10-27 with 10-31; pre2/extN continue the same arithmetic. Used by `date_block_ci` and `sign_flip_p` in place of the date in that arm only (Q-54).

### 6.5 Clauses, actions, tags (§5)
- c1: n ≥ 20 ∧ dates ≥ 8 ∧ sites ≥ 3 ∧ max site count ≤ 0.5n (judged held set). c2: median ρ* > 0 ∧ L95 > 0 ∧ p ≤ 0.025. c2b: median ΔMSE_W ≤ 0. c3: median d > 0 ∧ L95 > 0 ∧ p ≤ 0.025. c3b: gshufScenes ≥ 10 else `못 잼`; mean d_shuf > 0 ∧ p_mean ≤ 0.10. c4: median Δcorr12 ≥ 0 ∧ L95 ≥ −0.01. c5: median Δcorr50 ≥ −0.01 ∧ |median ΔmeanErr| ≤ 0.01. c6: report only. c7: `tools/genus-ruler/oro/guards-oro.json` (S7 record of G1–G9, Q-47) all PASS with hashes equal to §10.2. c8: median ρ_res^vis ≥ 0 ∧ median L⁻ < 0.
- Primary metric from FROZEN `decisions` (ρ_res or ρ_fine; with fine, c2/c3/c3b use fine versions; c2b stays total).
- Action lines 1–6 and fail/pass tags exactly as L646-L683 (first matching line; all failed clauses listed). Tag predicates: '작음' iff U95(median ρ*) < 0.05 ∧ U95(median d) < 0.10 (line ⑥ only); ⑤ uses U95(median d) < 0.10; ③-2 L95(median ΔMSE_W) > 0; ③-3 U95(median ρ^vis) < 0 ∨ L95(median L⁻) > 0; pass tags: c3b p > 0.025, |median ρ_rot| > 0.03, median ρ_even ≥ median ρ_odd, (primary ρ_res) L95(median ρ_fine) ≤ 0 / median ρ_fine ≤ 0, U95(median L⁻) ≥ 0, median ΔMSE_W(λ̃*) > 0, exposure tag from FROZEN `exposure`, always "아침(Terra ≈ 09:00) 판정".
- Sensitivity (§6, L716-L743): each arm = a keyword configuration of `oro_ref` functions/masks on the same applied list (`oro-apply` judge scenes, finally judged set); per arm n, median ρ*, CI, median d; scenes with |S| < 20 in that arm dropped from that arm only (L353, L717); scenes whose arm input is missing (`armInputs` false: time arms outside the raw range D9, `zSnow42` null in pre2/extN M2, a null B) are dropped from that arm only and counted (`summary.armDrops`, fixed before T). A whole arm is '못 잼' only when its input file is missing (ecmwf, L739; L356). Report table only. Arms and hooks:

| arm | setting (§1.6 hooks unless stated) | ruler |
|---|---|---|
| terrain s 8·15 km | `s_m` | L723 |
| blocking none / Sheppard | `block` | L723 |
| two-level 1.5/3.0 km; η(1.5 km); η_q(τ_c 1000 s) | `vertical` | L725-L727 |
| N_m = 0.6 N; H_w 2.5 km fixed; F_odd | `N_scale`, `Hw_override`, `odd` | L728-L730 |
| σ_min wavelength 100·400 km; f = 0; s_rel 0.10·0.20; σ_G 15·30 km | `lambda_smin`, `f_override`, `s_rel_override`, `combine(sigma_G_m=…)` | L731 |
| snow mask 7·42 days | masks with `zSnow7`/`zSnow42` (same 300 m margin) | L733, M2 |
| snow mask "그날 z_0°C 만(1판 규칙)" | masked iff box max ≥ z0(t) − 300 m (draft-1 rule, 103aa7a L38/L254) | L733 |
| snow mask z_0°C − 800 m | masked iff box max ≥ z0(t) − 800 m (draft-1 sensitivity, 103aa7a L333) | L733 |
| no snow mask; high-cloud mask B_hi 0.2·0.5; no high-cloud mask | `masks_input(hi=…)`; empty-pixel mask stays | L733-L734 |
| G-rev on S | d on S instead of S∪ | L735 |
| G-shuf 2판 꼴; L⁻ window-mean form | §6.3 report rows reused | L736 |
| c4·c5 without masks | §6.3 unmasked versions | L737 |
| app path low band only | ΔC^app with C_mid = B_mid | L738 |
| ecmwf sounding | `sndEcmwf` in place of `snd` (z₀/z_snow stay best_match, Q-46) | L739 |
| 64² × 12 km (24 km boxes) | Q-52: `hmean12` → `h_sub_field(n=64, dx_m=12000, tukey_cells=8)`; B64 from `bSha256n64` files; `combine(dx_m=12000)` (σ_G 20 km, R = 5); T64 = 4×4 mean of `trueGrid` (flipped); boxes = 8×8 24 km boxes of the 12 km window (§0.3); snow = max of `hmax12` over the box ≥ zSnow − 300; high = box mean of B_hi,64 ≥ 0.3; empty = box with ≥ 1 empty 3 km px (8×8 px); S threshold 0.02, \|S\| ≥ 20 of 64 | L740, M3 |
| latest time; t0 ± 1 h | the `latest`/`m1h`/`p1h` entries of `oro-inputs` (snd, ring, B) | L741 |
| 8-day blocks | §6.4 block id | L742 |
| splits | §6.3 splits | L743 |

### 6.6 Pre-judgement checks, lock, outputs (§9.3 L896-L920)
- `ruler_hash(path)`: bytes split on `b'\n'`; i10 = first line starting `b'## 10.'`, i11 = first later line starting `b'## 11.'` (exactly one each, else error); hash `b'\n'.join(lines[:i10+1] + lines[i11:])` (L871).
- Checks 1–7 as L897-L909 (`git merge-base --is-ancestor`, `git diff --quiet <frozen> HEAD -- <files> FROZEN.json` + `git status --porcelain`, per-extN diff from its own commit, rulerHash, implementation/bundle hashes vs guards-oro.json, `oro-base.mjs --check` with the `versions` fallback and the ≤ 1e-6 max|ΔB| rule, FROZEN-extN hashes, no gate/lock; `judge.lock.1` ⇒ rerun mode).
- T-read precheck (L910-L913): all judgement inputs present; bank vs `bank-manifest.json` (JSON/trueGrid/PNG sha256 — hashing only, `allow('scene-json')`/`allow('png-hash')`, no decode); differences recorded before T.
- **Environment precheck** (D2, D3; pre-T, no lock, part of `--precheck` and of `--judge` before the lock):
  - running python/numpy/Pillow versions must equal FROZEN `versions` (L376, L885), else refuse. This is an environment requirement, not a judgement rule: the remedy is to install the pinned versions (environment-only, like ④ 5's `versions` fallback) and rerun the precheck. It keeps the `date_block_ci` port (L600 "같은 꼴") unchanged while making its `Generator` stream reproducible.
  - **T-free recompute** of every `oro-apply` row from the frozen `oro-inputs.json`, `dem-grids.json`, `cmr-geom.json` and B files with the frozen `oro_ref.py`: expected byte-identical `oro-apply.json`. The comparison (identical, or the max |Δ| of each float and the list of flag differences) is written to the §10.3 pre-T record before T. G5(b) fixes the judge set to `oro-apply.json` in every case. If any A1–A8, `judge`, `counted` flag or any |S| differs, or a float differs by > 1e-9, the environment is not the frozen one: fix the environment and rerun; if it still differs, stop before T without a lock and handle it as ④ 5's last branch (§5.2 ①). This last step is a pinned addition (Q-56) to be put to the S4 short review (§9.1 ⑧).
- Lock: `tools/genus-ruler/oro/judge.lock` written immediately before the **first decode of MODIS-derived content** — the `trueGrid` base64 decode or the PNG pixel decode (C2, L914; the empty-pixel mask is MODIS content) — content: HEAD, FROZEN sha256. Before the lock only `allow('png-hash')` (raw bytes → sha256) is possible; a bank-PNG open under `allow('png-judge')` raises without the lock (U-GUARD). All T-dependent values computed in one pass, one final write of `gate-oro-held.json`; stdout = progress counters only. Stop after T read → never open partial outputs, record sha256 + exception type; environment-only rerun once via `judge.lock.1`.

### 6.7 `power-oro.json` (§4.7 L610-L621)
- Placement = held judge scenes of `oro-apply(-extN).json` (sites, dates, G-shuf membership); no random application.
- Model A (c2, c3, exact tests; draft1 `stat/sim2c.py`): u_s ~ N(0, 0.05²) per site; (e₁, e₂) ~ N(0, σ²[[1, −0.79], [−0.79, 1]]), σ ∈ {0.15, 0.20}; ρ_i = clip(μ + u_s + e₁, ±1), ρ_rev = clip(−0.8μ − 0.8u_s + e₂, ±1), d = ρ − ρ_rev.
- Model B (c3b; draft2 `recheck-sims/simA2_gshuf_mean.py`): same synthetic-terrain generator restricted to the real placement, wind skew κ ∈ {1, 3}, statistic mean d_shuf on W, sign flip p ≤ 0.10, '못 잼' counted as not passing. simA2 sets the effect through β in r = β·z(ΔC) + A·z(P) + noise, not through a true median ρ.
- **β(μ) calibration** (Q-48): before any power cell runs, for each μ ∈ {0.05, 0.10, 0.15} and κ ∈ {1, 3}, β(μ, κ) is found by bisection on [0, 1] (40 steps) with a fixed seed 20261103 and 2000 replicates so that the mean over replicates of model B's median-over-scenes ρ_res (pearson on S, as simA2's S) equals μ; μ = 0 → β = 0. The calibrated β table is written to `power-oro.json` (`calibration`).
- μ ∈ {0, 0.05, 0.10, 0.15}; 1000 replicates per cell, seed 20261103 + cell index; bootstrap inside power B = 1000 (Q-48).
- Report P(c2∧c3) (A), P(c3b | c2∧c3) (B), their product, and beside it **model B's own** P(c2∧c3∧c3b) (its c2/c3 on its synthetic ρ_res and d, same tests); false-pass rates (pure null; site-fixed pattern 0.05·0.10). Decision value at μ = 0.10 = minimum product over σ × κ (Q-48); < 0.2 ⇒ §4.7 user question.
```
{schema:"power-oro/1", placement:{n,dates,sites,gshufScenes}, models:{A:{…}, B:{…}}, seeds:{…},
 calibration:{"mu=0.10,kappa=1":{"beta":f,"medianRhoRes":f}, …},
 cells:{"mu=0.10,sigma=0.15,kappa=1":{"pA_c2c3":f,"pB_c3b_given":f,"product":f,"pB_joint":f}, …},
 falsePass:{…}, decision:{"mu":0.10,"value":f,"below0.2":b}}
```

### 6.8 `sunset-apply.json` (§4.6 L594)
- Per site, sounding hours 06-01..10-31 (on the hour, raw values, no interpolation) with sun_alt ∈ [−2°, +8°] and descending (sun_alt(h) < sun_alt(h − 30 min)) (Q-42).
- Count hours with A1..A5 (A5 = sounding complete + DEM; ring part only where ring exists). For 09-01..10-19 also app A6 (bands low, mid) with B from a separate uncommitted `.harness/oro/sunset-inputs.json` built by `oro.py --sunset` and run through `oro-base.mjs --inputs …` (its sha256 recorded).
- `{schema:"sunset-apply/1", sources:{…}, sites:{"<site>":{nEvening, nA1toA5, fracA1toA5, ring:{nHours, nA1toA6app, frac}}}}`.

### 6.9 oro-test additions (S3b)
- **G6(f)** end-to-end with fake truth (L764-L776): dev judge scenes by date (≤ 3; fill from G6(g) synthetic scenes, 0°/90°/180°); T_fake = clip(B + ΔC) replicated 2×2 to 256², u8, row 0 = north; fake PNG RGB(128,128,128) with one (0,0,0) 3 km px inside one window box; fake scenes carry only allow-list fields + fake `trueGrid` + fake PNG path in test-tmp; run the judge metric functions; criteria verbatim from L773-L776 (incl. the ρ^vis sd ≥ 0.01 rule and the N/S, E/W flip drop > 0.3).
- **G6(g)** (L777-L785): two dev sites × even set (0..315 by 45) and skewed set (270..345 by 15, 105, 150), U 8 m/s, N 0.01, one synthetic B per site and set, masks inactive; criteria verbatim. (iv) noise: ξ = draft-1 `sim1_lib.smooth_field(128, 50, seed)` (standardised white noise filtered by exp(−K²L²/4), L = 50 km; = `surrogate_R(·, 'gauss50', ·)` of `ready-proc/g6g_rot_fix.py`), T = clip(B + 0.25ξ, 0, 1) in the (f) form (u8, 2×2 replicate), seeds 20261103 + i (Q-37). The line records the clip fraction (share of cells where the clip acted; [review, synthetic] ≈ 15.5 % at 0.25, mean ρ_rot moved ≤ 0.0011 against unclipped noise, so the 0.01 criterion is unaffected).
- **G6(h)** (L786-L792): T = B + ΔC·1[box ΔC ≥ 0.02] (box level), outside window T = B; coastal version with s = ±0.05; |median L⁻| ≤ 0.003.
- **G8(b)–(f)** (L755): (b) (C3) never touches the real bank `index.json`, `sat-quartiles.json` or `ring/gate-*.json`: import `oro-fingerprint.py` by importlib (byte-identical file, `main` guarded) and patch its module constants `SAT`, `NWP`, `ORO`, `MACRO`, `RING` to test-tmp directories holding a **synthetic** bank (allow-list fields + fake `trueGrid`/`cover`/`empty`, fake `index.json` with `skip`/`error`/`cover`), a synthetic `sat-nwp-blend` copy and `syn-blend` outputs, a byte copy of `macro.py`, a fake `sat-quartiles.json`, a synthetic `gate-blend-held.json` (fake truth columns; the five non-T columns computed from the synthetic scenes) and a fake `modis-times.json`. `--f1`/`--f3` outputs must be identical (i) with and without `trueGrid` in the scene copies and (ii) with real-looking vs fake index `cover`; `--f3` is called with `skip_run` (no node run). `--f2` runs with a stub `subprocess.run` that writes a fake quartile file and is audited to read only its `--out` file and the (fake) committed file, printing counts only (never re-run the real F2); (c) FROZEN contains `oro-apply.json`/`oro-inputs.json` hashes; (d) `--judge` refuses in synthetic temp git repos violating each §9.3 condition; (e) at freeze no C4 satellite files, `gate-oro-*`, `judge.lock(.1)`; (f) the open guard is armed during G6(f)(g)(h) and any open of a real scene JSON `trueGrid`/`cover`/`empty` path or real PNG fails the test.

---

## 7. Draft-1 code: what may be reused

| piece | reuse? | difference to the ruler |
|---|---|---|
| `bench/oro_core.kgrid`, `highpass`, `damp_lowsigma`, `vweight('col')`, `eta_level`, `synth_terrain` | yes (semantics) | — |
| `oro_core.vertical_m` | logic yes, implementation no | 1e-30 floors give huge but finite m; use §1.6 `oro_ref.vertical_m` (kind, m, μ; no complex inf), the single function shared by `col_weight`, `vertical_decay` and the fastscape branch |
| `oro_core.conv_lag` | yes (η_q arm) | iστ_c/(1 + iστ_c), the factor of the §1.6 `vertical='q'` hook |
| `oro_core.combine` | **no** | default 3 iterations, no stop test, Φ via `math.erf` and `NormalDist.inv_cdf` (ruler: A&S 7.1.26 and Acklam), returns residual of post-clip ΔC, early-return copy on F ≡ 0 |
| `oro_core.gsmooth` | semantics yes | radius ceil(3σ) differs from floor rule at σ 15 km (sensitivity only) |
| `oro_core.Phi/Phinv` | **no** | exact functions, not the named approximations |
| `stat/sim1_lib.tukey`, `forcing` | tukey yes; forcing as a cross-check only | forcing hard-codes lat 37.5 for f, κ, H_w |
| `stat/sim1_lib.load_dem` | **no** | 3×3 pixel block of one tile, not the equirectangular cell mean |
| `bench/oro_test.py` T4 | **no** | precip_min = −1e9 replaces every P ≤ 0 (draft T4 rel rms 1.0); `oro_test2.py` base-offset form is the right one |

---

## 8. `g1-baseline.json` (plan S3 list; §9.1 ⑦, G1 L748, L862) — pointer and output schema

G1 is a c7 guard (L635) with its baseline measured **before freeze**; the comparison runs at S7. The tools are the "G1 측정 도구" of L862 (a `liveScene` request-intercept test and an md5 script) and are committed together in the **G1 baseline commit** = merged commit 115fbe2 + bundle fix (`volsky/build.sh`, ece32b1) + G1 tools only, no app code change. They live in `tools/genus-ruler/volsky/` next to `run.js`/`state-hash.js`; their code spec belongs to the volsky G1 tooling, and this section pins only what `g1-baseline.json` must contain.
- **Inputs**: rings from `oro-inputs.json` only (closest time, bands low/mid/high as the app's R/G/B; fraction·100 as `applyScene` passes it, §3), so no scene JSON is read (MODIS-free). Options `macroOro: 0`, `regime: 0`; each harness job carries `macro: 1, macroN: 128` and its ring input in `options` (L748: without them G1 is void).
- **(a) Float32 md5**: node + the esbuild 0.28.2 bundle of the baseline commit's `macroField.ts`; for each of the 121 (+ ext) scenes × 3 bands, `buildMacroField(samples, {n: 128, cellKm: 6, noise: false}, null)` → md5 of the raw bytes of the Float32 arrays `cover`, `base`, `lambdaRes` and every Float32 state array (keys sorted); numbers such as `ms` excluded. Mode 2: `noise: true` with the app's state chained for 15 AR(1) steps (state from step i fed to step i + 1, as `applyScene` does) → md5 per step.
- **(b) harness renders**: B0_app (`tools/genus-ruler/shape/jobs-overcast.json`), P0_seoul (`tools/genus-ruler/flow/jobs-phys-guards.json`) and two mountain scenes (the first two kanazawa dates, sorted; dev, A1 ✓) via `node tools/genus-ruler/volsky/run.js jobs.json out 390 584 gen` after `volsky/build.sh`; first an A/A (same code twice, md5 of rgb and alpha equal), then the baseline md5 of rgb and alpha per job. Same container, chromium path/version and SwiftShader flags as `oro/merge-aa.json` (Google Chrome for Testing 153.0.8010.12).
- **(c) keys**: the weather key string and `qKey` per job, as the app builds them.
- **(d) requests**: the `liveScene` unit test with the network intercepted: request list (URL, order), scene rebuild count and new timer count with both options 0; the D6/D14 extra requests (wind, cover, precipitation, radiation) must not appear.
- **Schema**:
```
{ "schema":"g1-baseline/1", "commit":s, "mergedCommit":"115fbe2",
  "bundles":{"macro":{"sha256":hex,"esbuild":"0.28.2"},"harness":{"sha256":hex,"build":"volsky/build.sh"}},
  "versions":{"node":s,"esbuild":"0.28.2","chromium":s,"chromiumPath":s,"chromiumFlags":[s]},
  "inputs":{"oroInputsSha256":hex},
  "a":{"<scene>":{"low|mid|high":{"cover":md5,"base":md5,"lambdaRes":md5,"state":{"<key>":md5}}}},
  "aMode2":{"<scene>":{"low|mid|high":[md5 ×15]}},
  "b":{"aa":b,"jobs":{"<name>":{"rgb":md5,"alpha":md5,"options":{…}}}},
  "c":{"<job>":{"weatherKey":s,"qKey":s}},
  "d":{"requests":[{"url":s}],"rebuilds":int,"timers":int} }
```
- `runtime` in FROZEN takes `bundles.macro.sha256`, `bundles.harness.sha256`, the merged commit and `commit` (§9.2); Q-45 requires the B bundle sha256 of `oro-base.mjs` at this commit to equal the 115fbe2 one.

---

## Q. Ambiguities and the readings chosen (rules unchanged)

| # | where | ambiguity | reading | support |
|---|---|---|---|---|
| Q-1 | §2.4/§2.9/§4.1 | The 30×30 window (cells 49..78) gives observer-centred 12 km boxes; a 64² 12 km grid of the 768 km box is even-aligned (cells 2i, 2i+1), so the judging boxes are not cells of the 64² grid | `dem-grids.json` also stores `hmax6` (128² cell max); judging-box max = max of hmax6 over its 4 cells (exact). `hmax12` kept as the even 64² tiling (shape of L365; = cell max of the §6 64² × 12 km arm) and never used for 15×15 boxes | L490 "칸 중심이 … ≤ 90 km 인 30×30 칸 … 15×15", L492 "상자 안 최고 h(dem-grids.json)", L365 "12 km 상자 최고 h(64²)", L740 |
| Q-2 | §4.4 | "관측점 15 km 안(상자 중심 기준 4 상자)": the 225 tiling has 5 box centres within 15 km (0 and four at 12 km). "4" matches an even tiling (observer on a box corner); no symmetric set of 4 boxes exists on the L490 tiling | use the distance rule (5 boxes), write `nNear`/`nNearTiling = 5` in the output, note the text conflict in the S4 §0.5 record; report-only ("화면 무게(보고)") | L490 (tiling) over L563 (descriptive count) |
| Q-3 | §3.2 ③ | Tukey formula not given | w_i = ½(1 − cos(π i/16)), i = 0..15, mirrored (draft-1 `sim1_lib.tukey`, the code behind the [computed] numbers) | L391 |
| Q-4 | §3.4 | "3σ 에서 자름" shape | square (separable), taps \|i\|Δ ≤ 3σ | L425 |
| Q-5 | §3.4 | iteration count and which ΔC A6 tests | ≤ 10 δ updates; failure on max\|G*ΔC_raw\| (pre-clip, step-3 ΔC) after the loop; metrics use post-clip C − B | L420-L424, L427, L489 |
| Q-6 | §3.4 | Acklam with or without Halley refinement | without (refinement needs an accurate erfc, not named) | L426 |
| Q-7 | §3.4 | φ in G*φ | exact Gaussian density | L423 (only Φ, Φ⁻¹ named) |
| Q-8 | §3.5 | θ_v coefficient, exponent, T unit | θ = T_K(1000/p)^{R_d/c_p}, θ_v = θ(1 + (R_v/R_d − 1)q), T_K = °C + 273.15, ruler constants | L441, L448 |
| Q-9 | §2.3 | source of z_sfc | sounding response `elevation` | L232, L369 ("응답 `elevation`") |
| Q-10 | §2.3 | wind interpolation | by components (U, V); valid iff speed and dir both non-null | L227, L384 |
| Q-11 | §2.3 | fallback details | per variable; nearest valid hour ≤ t and ≥ t, \|Δ\| ≤ 3 h inclusive; the same algorithm yields the primary rule | L228 |
| Q-12 | §2.3 | z_0 node set / null hours / scene-time z_0 | levels ≥ 500 hPa above ground; hour null if any needed value null; crossing T_i ≥ 0 > T_{i+1}; scene z_0 from interpolated profile; z_snow from raw hours in (t − 504 h, t] (7/42-day arms: (t − days·24 h, t], same half-valid rule); deep-underground null levels skipped (Q-49) | L231-L238, L733 |
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
| Q-28 | §4.1 | Pearson with < 2 values | n = 0 → None (empty set, report values only); n = 1 or zero variance → 0.0 (one value has variance 0, R6) | L500 |
| Q-29 | §2.4 | pixel-to-cell rule, tile set, despike | pixel centre in cell, unweighted mean; blockTiles ∪ boxTiles; no despike (decode as written; app demCpu has none) | L245-L248 |
| Q-30 | §2.7 | sun position function | `ring/solar_util.sun_alt_deg` copied into oro_ref | L315 ("NOAA 태양 위치 근사, 균시차 포함") |
| Q-31 | §3.4 | band with < 12 points | B null (app builds no field); cannot occur when A5 holds (≥ 82 points) | `volumetricScene.ts:1289`, L216 |
| Q-32 | G6(a) | "바람 4 방향 × 능선 2 방향" includes winds parallel to the ridge | 8 cases: 4 perpendicular (upwind max, ≤ 5 m, η_w sign), 4 parallel (η ≡ 0) | L759 |
| Q-33 | G6(b) | rms definition; fastscape's P ≤ 0 replacement | rms(P − P_fs)/std(P_fs); precip_base 1e4, precip_min 0 | L760, draft1 method §1.3 |
| Q-34 | G6(d) | mountain coordinates and slope regions | Hakusan, Odaesan; ±(6..24) km bands, ±12 km across; westerly only is PASS, the easterly mirror is report-only. **Pinned after a DEM-only prototype run** (disclosed in the `oro-test.txt` header and the S4 §0.5 record) | L762, L793 |
| Q-35 | G6(e) | quantitative orientation criterion | NW quadrant sea ≥ 0.9, SE ≤ 0.1. **Pinned after a DEM-only prototype run** (disclosed as Q-34) | L763, L793 |
| Q-36 | §4.4 (S3b) | τ_band when ring point 0 is null | first argument 0. Moot for the original bank: 0 null observer points and 0 nulls of any kind at the 121 closest times [review, from `ring/nwp/blend`]; the reading matters only for ext/pre2 | L546 |
| Q-37 | G6(g)(iv) (S3b) | noise kind and amplitude | `smooth_field(n, 50, seed)` = gauss50 of `g6g_rot_fix.py` (same kind as the [computed] basis, which used r = ξ unclipped); amplitude 0.25 (sd(r) ≈ 0.25 of L507) inside the (f) form clip; clip fraction recorded. Not 0.05: 0.25 keeps the realistic sd(r), and the clip moves the mean ρ_rot by ≤ 0.0011 [review, synthetic] against the 0.01 criterion | L784, L507 |
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
| Q-48 | §4.7 (S3b) | joint pass probability from two fixed models; how model B (effect β) maps to "참 중앙 ρ"; bootstrap size inside power | product P_A(c2∧c3)·P_B(c3b \| c2∧c3); β(μ, κ) calibrated before running so that model B's median scene ρ_res = μ (bisection, seed 20261103, 2000 replicates, §6.7); model B's own P(c2∧c3∧c3b) reported beside the product; decision = minimum product over σ × κ; B = 1000 inside power (as sim2c), 10,000 in the judgement | L612-L617 |
| Q-49 | §2.3 (z₀, inversion) | null Z/T at a level that is far under ground (Denver z_sfc ≈ 1.6 km: 1000–900 hPa) | not required, skipped when null, if z_std(p) < z_sfc − 500 m; otherwise required. Z850/Z700 for L stay literal (null → A5 false; count reported) | L232 ("땅 위의 면(Z(p) > z_sfc)만"), L239 |
| Q-50 | §3.5 | "관측점 50 km 안" boundary and cell rule | cell centre distance ≤ 50 km, inclusive (216 cells), mean of decoded float32 hmean6 | L434 |
| Q-51 | §4.6 split | "상자 평균 비탈 방위", "경사" | vector mean of per-pixel central-difference gradients of h = max(elev, 0) in Web-Mercator metres; slope = atan(\|ḡ\|), aspect = direction the slope faces; sun azimuth from the same NOAA series as `sun_alt_deg` at the closest time; ±45° and ≥ 5° inclusive | L592 |
| Q-52 | §6 grid arm | what "64² × 12 km(24 km 상자)" keeps | same physical lengths (Tukey 96 km = 8 cells, s 10 km, σ_min 200 km, σ_G 20 km), even 12 km tiling (`hmean12`, `hmax12`), window = 12 km cells with centre ≤ 90 km (16×16), 24 km boxes 2×2 (8×8), B at n = 64 from `oro-base.mjs` (closest), same applied list, \|S\| < 20 of 64 drops from the arm | L740, L717, L415 |
| Q-53 | §6 blocking arm | max in the Sheppard clip | max of h_sub over the 30×30 window (as Nh/U, Q-17) | L723 |
| Q-54 | §6 block arm | which dates pair into 8-day blocks | fixed calendar: (date − 2026-09-01).days // 8 | L742 |
| Q-55 | §4.3 under judge-time drops | G-shuf j/k sets when L343/L347 drop scenes after T | sites and '못 잼' from `oro-apply` (L355); j = G-shuf scenes still judged; k = the site's `oro-apply` judge scenes ≠ j (T-free); post-drop count reported only | L527, L354, L355 |
| Q-56 | §9.3 ④ | the judgement recomputes ΔC with frozen code on another machine | pinned addition: T-free recompute of `oro-apply` rows as an environment precheck (§6.6); judge set always `oro-apply` (G5(b)); a persisting mismatch is handled like ④ 5's last branch. To be listed in the S4 short review (§9.1 ⑧) | L752 G5(b), L904-L907 |

---

## R. Review disposition (`S3-design-review.md`, revision 2)

"applied" = the correction is in this file at the place named; "rejected because" = not applied, with the ruler line.

| id | disposition | where |
|---|---|---|
| R1 | applied: `complete` = steps 2–9 only; A4/inversion/z₀ nulls never touch A5; deep-underground null levels skipped (Q-49); Z850 literal, removals counted | §1.11, §1.12, §1.15 (`nulls`, `a5SoundingMissing`), U-Z0B, U-REF, B-SYN |
| R2 | applied: z_ref ≤ 50 km inclusive, 216 cells, `zRefM` | §1.5, §1.15, U-ZREF, Q-50 |
| R3 | applied: single `vertical_m` shared by `col_weight`, `vertical_decay`, fastscape branch; U-M2 | §1.6, §5.1 |
| R4 | applied: `M_judge` = snow ∪ high ∪ empty for W/S/S∪, G₁₀ ⊛_M, c4·c5; `M_in` for A7, D_dc, λ_app, G7, masked app share | §1.8, §6.1, §6.2, §6.3 |
| R5 | applied: `s_rel_override`, `sigma_G_m`, full hook table, 8-day block rule. **Rejected because** the review's η̂_q = ĥ_eff·D/((1 − imH_w)(1 + iστ_c)) lacks iστ_c, so its τ_c → ∞ limit is 0, not η_w (L395 "S&B 2004 의 τ_c → ∞ 극한"); used η̂_q = ĥ_eff·D·W·iστ_c/(1 + iστ_c) (draft-1 `method.md`) | §1.6, §6.4, §6.5, Q-53, Q-54 |
| R6 | applied: n = 0 → None, n = 1 / zero variance → 0.0 | §1.8, Q-28, U-PEARSON |
| M1 | applied: S3b is pre-freeze; `g1-baseline.json` pointer and schema | header, §6, §8 |
| M2 | applied: `zSnow7`/`zSnow42` + valid hours; window-before-file → null → scene drops from that arm. **Rejected because** the option "fetch `sounding-oro-pre2.json` from first date − 42 days" changes the ruler's sounding command (L331 `--start <첫 날 − 21 일>`, applied to pre2 by L619); the other offered option (42-day arm not measurable for pre2 scenes, fixed before freeze) is used | §1.11, §1.15, §6.5 |
| M3 | applied: n = 64 B (closest) from `oro-base.mjs`, `bSha256n64`, `hmean12`, 12 km window and 24 km boxes (the "mark '못 잼'" alternative not taken: L359 asks that sensitivity arms run from committed inputs) | §0.3, §1.4, §1.15, §3, §6.5, Q-52 |
| M4 | applied: `slopeDeg15`/`aspectDeg15`, `sun_az_deg`, `sunAzDeg`/`sunSlopeExcl`, split | §1.4, §1.13, §1.14, §6.3, U-SLOPE, U-SUNAZ, Q-51 |
| M5 | applied: ρ_odd,swap and 2판-form G-shuf rows | §6.3 |
| M6 | applied: medians over `counted`; G-shuf sites/k from `oro-apply`, j = still-judged G-shuf scenes, post-drop count reported. **Rejected because** "post-drop G-shuf count < 10 → c3b '못 잼'" adds a T-time measurability rule, while L355 says '못 잼' is decided in advance from `oro-apply.json` ("`oro-apply.json` 에서 미리 정해집니다") | §1.15, §6.1, §6.3, Q-55 |
| M7 | applied: `hourlySha256` per site | §1.15 |
| C1 | applied: `jsonBytes`/`pngBytes` removed; no-size rule | §0.1, §1.15, §4 |
| C2 | applied: lock before the first MODIS decode incl. PNG; `allow('png-judge')` needs the lock; U-GUARD | §0.1, §6.2, §6.6 |
| C3 | applied: manifests moved to `oro_ref.py`; `oro-fingerprint.py` byte-identical (sha256 recorded, U-FP); guard in `oro_ref`/`oro-geom`/`oro-test`/`oro.py` only; G8(b) on synthetic files with patched constants. The §0.5 entry itself is ruler text, so it is listed for S4 | §0.1, §0.5, §1.15, §4, §6.9 |
| C4 | applied: git rule | §0.1 |
| C5 | applied: `oro-base.mjs` path arguments limited to `--inputs`/`--out` | §3 |
| D1 | applied: sorted-iteration rule; B-DET in separate processes | §0.2, §5.2 |
| D2 | applied: `env` in `oro-apply.sources`; T-free recompute precheck (stop branch marked as pinned addition Q-56 for the S4 review) | §0.2, §1.15, §6.6, Q-56 |
| D3 | applied: numpy (python, Pillow) pinned in FROZEN `versions`, refusal before T as an environment requirement. The `random_raw` alternative not taken: L600 requires the `date_block_ci` port to keep "같은 꼴" | §0.2, §6.6 |
| D4 | applied: expected pending sites derived from the data | §0.5, §1.15, §5.2 |
| D5 | applied: all DEM quantities from decoded float32 | §1.4, §1.5, §1.15 |
| D6 | applied: aligned decode, `byteOffset`-safe write, `cloudGenus.ts` dropped | §3 |
| D7 | applied: no code hash in `dem-grids`/`oro-inputs` (only frozen `old` code in `oro-inputs`), no `baseIndexSha256`/node in `oro-apply`; S4 rebuild check | §1.15, §3 |
| D8 | applied: `dont_write_bytecode`, fastscape sha before `exec_module`, closing vertex dropped, times hash per bank | §0.2, §2, §5.3 |
| D9 | applied: edge time arms → NaN ring, B null, per-arm drop; sapporo_2026-10-19 p1h confirmed here | §1.14, §1.15, §3, §6.5 |
| Q-2 | applied: 5 boxes kept, count written, conflict noted for S4 | §6.3, Q-2 |
| Q-34/Q-35 | applied: disclosure in `oro-test.txt` header and S4 record. **Rejected because** keeping the easterly mirror as a stricter PASS criterion adds a test the ruler does not have (L762 "가상 서풍 10 m/s"; L793 "시험 값은 … 이대로 고정"); it is report-only | §5 header, §5.3, Q-34 |
| Q-37 | applied: amplitude 0.25 with the clip fraction recorded (the review's first option) | §6.9, Q-37 |
| Q-48 | applied: β(μ) calibration and model B's own joint probability | §6.7, Q-48 |
| Q-36 | applied: zero-null fact recorded | Q-36, §0.5 |
| review §7 | applied: per-site A1 table, margins, `apply` prints per-site A1 and provisional c1 components | §1.5, §1.15 |

---

## Build notes

Written while building S3a. Each entry names the ruler line it follows. Entries that are not ruler conflicts are marked so.

### `oro-base.mjs` and manifests (S3a 'JS + manifest' part)
1. **Bundle isolation (follows ruler L414 and §9.2 `runtime` over §3 step 3 as written).** §3 runs esbuild inside the repo (`.harness/oro/base-bundle/<commit>/`). From there esbuild walks up the parent folders and reads the repo-root `tsconfig.json` of the *working tree*. That file sets `strict`, so esbuild emits `"use strict"`, and it `extends` `node_modules/expo/tsconfig.base.json`. The bundle would then depend on working-tree config, not only on the commit's `macroField.ts` and the pinned esbuild. The ruler defines the B bundle as exactly that pair, records its sha256 in FROZEN `runtime`, and re-checks it after freeze, when app files are allowed to change (§9.3). Measured at HEAD e781b97: `47140a0a8f5a…` with the inherited tsconfig against `2650525260504e4a70a4f6213decdd195dec28e582f251b443f8e36e89493800` with none. The B bytes are the same either way: B-BASE0 compares them against a bundle built at the repo root that has `"use strict"`, 74/74 identical.
   - **What was built:** `oro-base.mjs` writes `tsconfig.json` = `{}` and `package.json` = `{}` into the bundle folder before step 3. The folder is then closed: the two TS files from `git show`, `entry.ts` and the two empty configs.
   - **Result:** bundle sha256 `2650525260504e4a70a4f6213decdd195dec28e582f251b443f8e36e89493800` at HEAD and at 115fbe2, so Q-45 holds (B-BASE0 `q45=same`).
   - **For §8 (a):** this bundle exports only `buildMacroField` and `samplesFromRing` (esbuild tree-shakes `stepMacroState` out of it), so it serves the mode-1 md5 only. The mode-2 15-step AR(1) chain calls `stepMacroState` between steps, as the app does (`volumetricScene.ts` L1392), so it needs a bundle built the same isolated way: empty `tsconfig.json`/`package.json`, the commit's two TS files via `git show`, esbuild 0.28.2 with the same flags, and entry `export { buildMacroField, samplesFromRing, stepMacroState } from './src/utils/macroField.ts';`. FROZEN `runtime` keeps the `oro-base.mjs` B-bundle sha256 (`2650525…`) as the "B 번들". A bundle built from the repo root has a different sha256.
2. *(not a ruler conflict)* `--commit` defaults to `HEAD`. It is resolved to the 40-hex sha with `git rev-parse --quiet --verify <rev>^{commit}`, which satisfies C4 through `--quiet`. The bundle folder and `index.json.commit` use the full sha. §0.5 step 4 still passes the merged or G1-baseline commit explicitly.
3. *(not a ruler conflict)* `--check` prints one line per n: `CHECK n128 same … diff … null …` and `CHECK n64 same … diff … null …`, plus a `DIFF <scene> <time> <band> <n> <why>` line for each difference. `<why>` is one of `unsealed`, `recorded-null`, `rebuilt-null` or `sha`. Missing or null `bSha256` counts as a difference. Callers should use the exit code.
   - Input checks: f64 strings must round-trip base64 and hold 91 float64, `nullIdx` must equal the NaN positions, and ±Inf is refused. Scene and time keys must match `^[A-Za-z0-9-]+_\d{4}-\d{2}-\d{2}$` and `^[a-z0-9]+$`, because they become file names.
   - When a B is null, any stale `.f32` file of that name in `--out` is removed.
4. *(not a ruler conflict; task contamination rule)* The bank-manifest hasher does not parse scene JSON itself. It calls `oro_ref.scene_hashes`, which shares `_read_scene` with `load_scene_meta`: the one function that opens scene JSON, under `allow('scene-json')`. It returns either the allow-list fields or only `{jsonSha256, trueGridSha256}`, and the parsed object never leaves it.
5. *(not a ruler conflict)* `oro-test.py` B-BASE0 is an added implementation check, not a ruler criterion; it has no value threshold, only bit identity.
   - It uses a synthetic `oro-inputs` fixture in `.harness/oro/test/` (4 scenes × 4 times × 4 bands, incl. an all-NaN time arm, an 11-point band and a 12-point band).
   - It checks that oro-base B equals `buildMacroField` called directly through a separate bundle of the working-tree `macroField.ts`, for n = 128 and n = 64.
   - It also covers `--check` in three cases: sealed → exit 0, one sha changed → exit 1 with diff 1, unsealed → exit 1.
   - B-BASE (§5.2) is the real-data counterpart, on `tools/genus-ruler/oro/oro-inputs.json` and `.harness/oro/base`: `--check` with the commit recorded in `base/index.json` (diff 0 at n = 128 and n = 64), every sealed B read through `load_B` (sha256-checked) is finite and in [0, 1], at the closest time the n = 64 hash is null exactly where the n = 128 hash is null, and the same/null counts equal the `--check` counts. An unsealed file fails; a missing file or base folder gives SKIP, which is not a pass (§9.1 ⑨).

### Model, builders, `oro-geom.py`, model tests (S3a 'Python model' part)
6. **B-SYN expectation (follows ruler L436 over §5.2 as written).** §5.2 says that with the synthetic sounding (elevation 0) "every scene has snd, L = [850, 700]". With the DEM z_ref of `dem-grids.json`, denver has z_ref 1902.2 m, so Z850 = z_std(850) = 1457 m < z_ref + 500 m and L = [700]. That is the ruler's own example ("덴버는 850 hPa 가 땅속이라 L = {700}"). B-SYN therefore expects L = [850, 700] where Z850 ≥ z_ref + 500 m and L = [700] elsewhere (denver), from the stored zRefM. Nothing in the model changed.
7. *(not a ruler conflict)* `apply` before B exists. §0.5 runs `apply` after `oro-base.mjs` and `seal-inputs`; the partial build (soundings 1/10) also runs it on unsealed inputs.
   - A row whose F would be computed but whose closest-time B is unsealed or absent gets `bMissing: true`, `A6: {judge: null, app: null}`, `A7: {S: null, ok: false}`, `counts`/`Ddc`/`preCorr`/`m8.rmsDC` null, and `judge = false`. The summary has `bMissing` (count).
   - `summary.provisional` = pending soundings ∨ pending rings ∨ `bMissing > 0` (L311: the §2.7 count is made only on complete inputs). B-BUSAN's expected `provisional` includes the third term.
8. *(not a ruler conflict)* Schema details the spec left open:
   - `oro-inputs.json` carries the data-derived `pendingSites: {sounding, ring}` at top level (§1.15 inputs bullet, D4); `apply` copies it.
   - `armInputs` come from the inputs only: a time arm is present when every band has ≥ 12 finite ring points (the oro-base B rule, Q-31) and that time's REF is complete and not refEmpty; `n64` when the closest ring has ≥ 12 points per band. They are therefore the same before and after `seal-inputs`.
   - `counts.maskedSnow` / `maskedHigh` are the numbers of window boxes with that mask; `maskedBoth` is their intersection.
   - `cmr-geom.json` granules use `source: "missing"` for pass granules absent from `sat-times.json.gz` when no CMR fetch was needed (all four corners already inside the known polygons, R-G4).
   - REF variable names in `missing` / `interpHow` / `a5SoundingMissing`: `T<p>`, `RH<p>`, `Z<p>`, `wind<p>`, `T2m`.
   - `vertical_m` with N² ≤ f² (never reached by the model, since N ≥ 0.003 > 2Ω): σ² ≥ N² is taken as evanescent first.
9. *(not a ruler conflict)* G6(b) margin. Relative rms is ≈ 1e-12 for winds 270° and 180°, and 6.07e-6 for 225° (limit 1e-5, L760). The whole 225° residual comes from the Nyquist row: `np.fft.fftfreq` has only −N/2, and the north-up row flip that fastscape needs (L386) maps it to +N/2, so that row sees σ = Uk ± Vπ/Δ with the other sign. With that row's sign matched to fastscape the residual is 1.2e-12. The pinned convention is `cloudFlow.ts` (L381-L382), so nothing was changed; recorded because the margin is only 1.6×.
10. *(not a ruler conflict)* Test ids: the U-ALLOW builder part ("outputs byte-identical with and without fake keys") is `U-ALLOWB` (the loader part is `U-ALLOW`). U-COMB1..4 are one line `U-COMB`. Added `U-HOOKS` (§1.6 hook defaults = main model; each arm changes F) and `U-SEAL` (re-seal idempotent, foreign index refused; an index that misses a scene, as from `oro-base.mjs --scenes`, or a time key is refused and leaves the inputs bytes unchanged). `U-FP` ignores the import system's own `__pycache__/*.pyc` read probe (nothing is written).
11. Facts for the S4 §0.5 record from this build (DEM, NWP and CMR metadata only):
    - A1 rms and z_ref per site equal the §1.5 [review] table (A1 ✓: denver 121.3, kanazawa 129.3, osaka 106.1, sapporo 106.4; `extTargetSites` = denver, osaka, sapporo).
    - Ring nulls at the 121 closest, latest and m1h times: 0. The only all-NaN time arm is `sapporo_2026-10-19 p1h` (Q-36, D9 confirmed).
    - `cmr-geom.json`: 116 scenes `ok` (A8 true 98, false 18) and 5 `no-pass` (modis-times `source: solar`: kanazawa 09-29, 10-19; osaka 09-09, 09-29, 10-19). 25 granule queries were fetched from CMR into `.harness/oro/cmr-extra.json`. A cross-track distance above the 1165 km half-swath means the site lies outside every pass granule (the R-G7 nearest-centroid fallback); all such scenes have A8 false.
    - `oro-inputs.json` is ≈ 4.6 MB (the §1.15 estimate was 2–3 MB).
