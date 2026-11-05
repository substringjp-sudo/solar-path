# atmos round 1: data restore plan for RULER-oro (C3+C1) and C4 inputs

Written 2026-11-03 at 23:15Z. Planning only: no repository file was edited, and no bulk job was started.
Sources: `docs/ATMOS_DYNAMICS_SURVEY.md` §3.1, §3.2, §5 and §6; `docs/SKY_REBUILD_PLAN.md` §170 and §171.3; `tools/genus-ruler/macro/{RULER-macro.md, fetch-sat.py, macro.py, downscale-run.mjs}`; `tools/genus-ruler/ring/{RULER-ringtruth.md, fetch-nwp-ring.py, fetch-modis-time.py, eval-ringtruth.py}`; `src/utils/{weather.ts, weatherSource.ts, demTiles.ts, demCpu.ts}`; and `origin/main:src/utils/demTileCache.ts`.
Probe artefacts (headers and tiny bodies only) are in `/tmp/claude-0/-home-user-solar-path/827aa702-2f52-52c8-9fe8-e45a3ff14759/scratchpad/atmos1/probe/`.

## 0. Current state
- Gone: `.harness/` (the MODIS bank `.harness/macro/sat`, the `sat-nwp-*` dirs and all syn/gate scratch) and `tools/genus-ruler/ring/nwp/` (the raw ring responses, which are gitignored at `.gitignore:52`).
- Committed and still usable, so these need **no refetch**:
  - `ring/modis-times.json` (closest rule) and `ring/modis-times-latest.json`. Each has 121 keys and comes from CMR (116 cmr, 5 solar fallback). 37 scenes are multiPass and 84 single-pass, so held has 68 single-pass scenes. **Do not run `fetch-modis-time.py`**: its default `--out` is the committed json.
  - The fingerprints listed in §6: `macro/sat-quartiles.json` (121 rows) and `ring/gate-{sat,blend,...}-held.json` (97 rows). All are stored at full float precision.
- Toolchain:
  - python3 has numpy 2.5.3 and Pillow 12.3.0. scipy is absent, and none of fetch-sat, fetch-nwp-ring or macro.py needs it. Earlier FROZEN files recorded numpy 2.4.6 and scipy 1.17.1, so record the new versions.
  - node is v22.23.4 and npm 10.9.9. There is no `node_modules`. **esbuild is not in package-lock.json**: `downscale-run.mjs` runs an unpinned `npx esbuild`, which pulls the latest esbuild from npm. Record `npx esbuild --version` at restore time.
  - `npm ci` is not needed for the numeric ruler. It is needed only for the later volsky eye renders.
- Disk: 30 GB free. The whole plan needs less than 0.5 GB.

## 1. MODIS truth bank (RULER-macro §2 = RULER-ringtruth §2)
- Sites (`fetch-sat.py` SITES):
  - dev: seoul (37.5, 127.0) and kanazawa (36.5679, 136.6774).
  - held: osaka (34.69, 135.5), busan (35.18, 129.08), shanghai (31.23, 121.47), sapporo (43.06, 141.35), lisbon (38.72, -9.14), denver (39.74, -104.99), sydney (-33.87, 151.21) and hamburg (53.55, 9.99).
- Dates: `--dates 2026-09-01:2026-10-22:4` (the default) gives 13 dates from 09-01 to 10-19. That makes 130 scenes. Scenes are dropped when more than 5 % is empty or cover is below 0.08 or above 0.92, which leaves **121**: dev 24 (seoul 11, kanazawa 13) and held 97 (osaka 13, busan 13, sapporo 13, hamburg 13, shanghai 12, denver 12, lisbon 11, sydney 10).
- Expected exclusions (from the committed keys): denver 10-07; lisbon 09-13 and 09-21; seoul 09-25 and 10-07; shanghai 09-29; sydney 09-01, 10-03 and 10-11.
- Source: NASA GIBS WMS `wms/epsg4326/best`, layer `MODIS_Terra_CorrectedReflectance_TrueColor`, 768×768 px over a 768 km box. Each scene produces:
  - a mask, min(R,G,B) > 0.45;
  - `trueGrid` at 256² × 3 km;
  - the 91-point surrogate ring (7 km box mean);
  - a 256² PNG.
- Commands (Open-Meteo weight 0):
  1. `python3 tools/genus-ruler/macro/fetch-sat.py .harness/macro/sat --sites dev > .harness/macro/fetch-sat-dev.log`. Check the pipeline on dev only.
  2. `python3 tools/genus-ruler/macro/fetch-sat.py .harness/macro/sat --sites all > .harness/macro/fetch-sat-all.log`. dev comes from cache and the run writes a full `index.json`. A `--sites held` run would overwrite `index.json` with the held scenes only.
- **Contamination guard:**
  - fetch-sat prints a JSON line per scene that includes `cover` for held scenes. Redirect stdout to a file and never read it; check only the skip set by name.
  - Never open held `*.png` files.
  - Every scene JSON (and every `sat-nwp-*` copy) carries the MODIS `cover` and `trueGrid`. The oro harness must take observer cloud from NWP `ring[0]`, never from `cover`.
- GIBS probe: one 64 px GetMap at seoul for 2026-09-05 returned **HTTP 200**, image/png, 12,543 B, 0.91 s. The body was discarded without being inspected.
- Estimates:
  - Download: about 130 × 1–1.5 MB ≈ 150–200 MB, which is not kept.
  - Disk: 121 × (≈ 90 KB JSON + ≈ 150 KB PNG) ≈ 30 MB.
  - Runtime: sequential with no sleep, at about 2–6 s per scene, so **≈ 5–15 min**.
- Reproducibility risk: GIBS "best" may have swapped NRT imagery for standard imagery since 10-24, or reprocessed it. Fingerprints F1 and F2 in §6 detect this.

## 2. Real NWP ring scenes (RULER-ringtruth §8.2, `sceneDir-nwp`)
- Command: `python3 tools/genus-ruler/ring/fetch-nwp-ring.py --tag blend`. All defaults hold:
  - `--scenes .harness/macro/sat`, `--start 2026-09-01`, `--end 2026-10-19`, `--sleep 60`;
  - endpoint historical, `models=ecmwf_ifs025,icon_seamless`, times from `modis-times.json`.
- Request: one per site (10 in total) to `https://historical-forecast-api.open-meteo.com/v1/forecast`, covering 91 points (observer plus the 5/10/30/70/130/200/280/380 km ring) with `timezone=GMT`.
- Variables: `hourly=cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high` for both models. **No wind, T, RH or Z at any level.**
- Weight: V = 4 × 2 models = 8, so max(1, 0.8) × 49/14 = 3.5 per point, 91 × 3.5 = **318.5 per site and 3,185 in total**. That stays under 600/min because of the 60 s sleep, and under 5,000/h.
- Outputs:
  - raw: `tools/genus-ruler/ring/nwp/blend/<site>.json` (gitignored), about 6–7 MB per site, ≈ 65 MB in total;
  - copies: `.harness/macro/sat-nwp-blend/` and `-blend-lm/`, about 2 × 121 × 90 KB ≈ 22 MB.
  - It stops on a daily 429 and resumes at site level.
- Runtime: about 10 × (60 s sleep + 10–40 s response) ≈ **12–17 min**.
- Free variants (raw is reused, weight 0) for the timing-sensitivity and multiPass rows of RULER-ringtruth:
  - `--tag blend-latest --raw-tag blend --times tools/genus-ruler/ring/modis-times-latest.json`
  - `--tag blend-m1h --raw-tag blend --shift-hours -1`
  - `--tag blend-p1h --raw-tag blend --shift-hours 1`
  - jma and archive are not needed for oro; they would cost about 320 per site each.
- **Wind, T and RH at 850/700 are not in the ring.** Round 1 (§6 of the survey: "the ring request is not changed") takes uniform U and N and a scalar σ_s from the observer sounding (§3), so it does not need them. If a later round (C2 σ_s field, or spatially varying U and N) needs them, there are three options:
  - Fold RH850 and RH700 into the same request: V = 12, 1.2 × 3.5 × 91 = 382 per site, **+637 in total**. This requires editing the script.
  - A separate RH-only request: +3,185.
  - Wind, T and RH at 850 and 700 folded in: V = 24, giving 764 per site, 7,644 in total.
  - Note: ecmwf_ifs025 has no 800 hPa level, and its pressure levels are 3-hourly.
- Do not run `eval-ringtruth.py`: it rewrites the committed `gate-*-held.json` and `ringtruth-results.json` and prints held metrics. Use F3 instead.

## 3. Observer soundings for apply-scene criteria, C3/C1 inputs and C4 (new fetcher, nothing is committed)
- Source, as in the app (`weatherSource.ts`: point = historical, no `models`, so best_match): `https://historical-forecast-api.open-meteo.com/v1/forecast?latitude=<lat.toFixed(5)>&longitude=<lon>&hourly=<vars>&start_date=2026-09-01&end_date=2026-10-19&timezone=GMT&wind_speed_unit=ms`.
- One request per site. The values are identical to the app's per-local-day requests at the same UTC hour. Interpolate to `modisTimeUtc` with the same rule as `fetch-nwp-ring.py interp`.
- Variables (62; this is the app's `fetchThermoProfile` and `fetchLayerWinds` minus `cloud_cover_XhPa` and visibility, plus the survey §3.2 additions):
  - `temperature_{1000,975,950,925,900,850,800,750,700,600,500,400,300,250,200}hPa` (15)
  - `relative_humidity_{1000…300}hPa` (13)
  - `geopotential_height_{same 15}hPa` (15)
  - `wind_speed_/wind_direction_{925,850,700,600,500,250}hPa` (12). The app already has 850/600/250; the survey's "+0.6" adds 925/700/500.
  - `temperature_2m, dew_point_2m, cape, freezing_level_height, boundary_layer_height, sensible_heat_flux, cloud_cover` (7)
  - Optional: `vertical_velocity_{850,700,500}hPa` (+3, for L2), or all 15 levels (+15).
- Weight (49 days, so × 3.5):
  - 62 vars: 6.2 × 3.5 = 21.7 per site, **217 in total**.
  - 65 vars: 228. 77 vars: 270.
  - The survey's per-scene estimate was 121 × ~5 ≈ 600. The app's exact per-day pair would be 121 × 8.2 ≈ 990, so one request per site per date range is cheaper.
- Runtime: under 2 min. Disk: about 0.5 MB per site, ≈ 5 MB.
- Open points to settle in the first post-reset probe (§4), before freezing:
  - (a) Under best_match the East Asian sites resolve to jma_seamless (survey §3.1). That model has **no BLH or CAPE** and its pressure levels are 3-hourly. C4's zi < 1100 m gate and its interpolation at around 00–02Z then need a pre-registered fallback, either nearest 3-hourly or a named fallback model.
  - (b) SHF sign and availability differ by model.
  - (c) U850 ≥ 5 m/s must be in m/s. The app requests km/h.

## 4. Open-Meteo reachability and quota (one tiny request per host, 2026-11-03 23:12Z, Seoul)
| host | result | headers |
|---|---|---|
| api.open-meteo.com | 200 (1 var, 1 day) | Cost 1.0, Limit 600 / 60 s, Remaining 599 |
| **historical-forecast-api.open-meteo.com** | **429** `Daily API request limit exceeded` | **Limit 10000 / 86400 s, Remaining 0, Retry-After 2898 s, reset 2026-11-04T00:00:47Z** |
| previous-runs-api.open-meteo.com | 200 (1 var, 1 day) | Cost 1.0, Limit 600 / 60 s, Remaining 599 |

- The proxy egress IP is shared, and another tenant has exhausted today's historical quota. The daily window resets at UTC midnight. Forecast and previous-runs still answer, so the daily counter appears to be per API, but this is not proven.
- previous-runs is **not needed** for RULER-oro (it is used only by lead-curve Q2).
- Because of the 429, the planned variable-availability check did not run. Do it as the first request after the reset (weight ≈ 1.6): seoul (dev) only, 2026-09-05, `hourly=boundary_layer_height,sensible_heat_flux,cape,temperature_850hPa`, `models=best_match,ecmwf_ifs025,icon_seamless,gfs_seamless`. Log `X-RateLimit-Cost` so the weight formula is confirmed.

## 5. DEM: Terrarium z6
- URL (unchanged on main): `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png`. Probe of z6/54/24 (seoul):
  - **HTTP 200**, 80,550 B, 0.42 s.
  - ETag `a06d226e173411abbc26947daabc6126`, Last-Modified 2017-11-29, so the tiles are static and hashable.
  - Sources: gmted mea075 + **etopo1 bathymetry**. In this tile, 37 % of pixels are below 0 and the minimum is −2,432 m.
  - **Pre-register h = max(0, elev)**. Otherwise the East Sea and other sea floors become huge fake terrain: the h_sub rms ≥ 100 m apply test passes at every coast, and C3 lifts air at shorelines.
- z6 tiles needed to cover ±384 km: 6 to 9 per site, 69 in total. The union of the app's 3×3 blocks and ±450 km boxes is **66 unique tiles**, about 5–6 MB and about 1 min. There is no Open-Meteo weight.
- No fetcher is committed. A new `tools/genus-ruler/oro/fetch-dem.py` should:
  - save the tiles to `.harness/oro/dem/`;
  - write a manifest with sha256, ETag and x-amz-version-id, to go into FROZEN;
  - decode as R·256 + G + B/256 − 32768;
  - resample to the site-centred east/north km grid used by `trueGrid` (row 0 = north).
- Pixel size is 1.79 km (sapporo) to 2.09 km (shanghai), and **1.45 km at hamburg**.
- **Hamburg caveat:** `demZoomForRadius(384 km, lat, block 3)` returns **z5** at hamburg, because a z6 tile there spans 372 km, less than 384. It returns z6 for the other 9 sites. The app's `loadCpuDemBlock` and the ruler must therefore pin the same zoom and coverage; otherwise ruler ≠ app at hamburg.
- Main's new commits 98affae and a8a4f61 are not on the current branch (a04b3ff):
  - `demTiles.ts` now imports `demTileCache.ts` (react-native, expo-file-system and a PNG `require`) at top level. Node/esbuild bundles that import `demTiles`/`demCpu`, including about 34 tool files under `tools/` that import them (mostly `tools/shader-preview/build-*.js`), will pull RN after merge (not verified).
  - The oro tooling must not import `demTiles` or `demCpu`. Keep `src/utils/oroLift.ts` pure: it takes an h grid, and Python supplies the DEM.
  - `demCpu.loadCpuDemBlock` does not use the cache (direct URL, online only). The GPU path's cache, on a failed fetch, returns the bundled **z0 world tile** for any z/x/y, which would be silently decoded as terrain. If app oro ever goes through `getDemTileUri`, treat a fallback as no DEM (a = 0).

## 6. Restore order, weight per day and checks
| step | when | command | OM weight | disk | time |
|---|---|---|---|---|---|
| 1 DEM | now | new `fetch-dem.py` (66 tiles + manifest) | 0 | 6 MB | 1 min |
| 2 MODIS dev → all | now | §1 commands 1 and 2, stdout to an unread log | 0 | 30 MB | 5–15 min |
| 3 F1, F2 | after 2 | below | 0 | – | 1 min |
| 4 availability probe | ≥ 2026-11-04 00:01Z | §4 single request | ≈ 2 | – | s |
| 5 soundings | after 4 | new fetcher, 10 sites | 217–270 | 5 MB | 2 min |
| 6 NWP ring | after 5 | `fetch-nwp-ring.py --tag blend`, then the 3 free variants | 3,185 | ≈ 90 MB (+ 22 MB per variant) | 12–17 min |
| 7 F3 | after 6 | below (needs esbuild via npx) | 0 | 35 MB | 2 min |
| 8 apply list | after 1 and 5 | h_sub rms, U850, N², cross-wind from DEM and soundings only, **no MODIS**; hash it into the RULER-oro freeze | 0 | – | s |

- **Day total ≈ 3,400–3,460 weight**, about 35 % of the 10,000 daily limit. Under the 5,000/h limit, step 6 fits in one hour.
- Because the IP is shared, start just after 00:01Z. The cheap steps come first. On a daily 429 both fetchers stop, and the run resumes per site the next day.
- Wall time: about 45–60 min, most of it the 60 s sleeps and GIBS.
- Fingerprints. Write the rule before running, have a script print counts only, and never print per-scene values:
  - **F1:** the kept scene names must equal the 121 keys of `modis-times.json`, with exactly the 9 exclusions in §1.
  - **F2:** `macro.py --truth .harness/macro/sat --out .harness/oro/sat-quartiles-restore.json`. **`--out` is mandatory; the default overwrites the committed file.** Then count the rows identical to `macro/sat-quartiles.json` (cover, betaTrue, partialTrue, bandRatio*) out of 121. If the count is below 121, the GIBS imagery drifted: name the bank "restored" in RULER-oro and re-measure the B baselines by script before any oro run.
  - **F3 (MODIS-free):**
    1. `node tools/genus-ruler/macro/downscale-run.mjs .harness/macro/sat-nwp-blend .harness/oro/syn-blend --variant prior`
    2. `macro.py --gate .harness/macro/sat-nwp-blend .harness/oro/syn-blend --out .harness/oro/gate-blend-restore.json --group held`. Again, `--out` is mandatory; the default writes `./gate.json` in the repo root.
    3. Compare **only** `ringRmse`, `ringRmseBase`, `betaSyn`, `betaC0` and `partialSyn`, which depend on NWP and syn only, against `ring/gate-blend-held.json`, out of 97 rows.

## 7. Items to resolve in the RULER-oro review (they affect the data)
- **Judging set:** RULER-ringtruth §2′ judges single-pass scenes only (held 68), because multiPass timing is unresolved: closest scored 0.661 and latest 0.324. The survey says held 97. At the predicted 25–40 % apply rate, 68 gives **17–27** scenes, so the n ≥ 20 rule may come out undecided. Fix the set and the extra-date rule before freezing.
- The extra-date contingency (mountain sites after 2026-10-23) needs CMR, GIBS and a new ring range. Ring cost per site is 91 × max(1, D/14), for example 318.5 for 49 days. It also assumes Terra is still delivering, which is unverified.
- C4 statistics against satellite: the bank keeps only the 3 km grid and a 256² PNG. fetch-sat discards the 1 km image, so roll and cell spacing of 2–10 km cannot be resolved. A C4 satellite reference (I_org, spacing, direction) would need a separate finer fetch, for example MODIS 250 m or VIIRS on a small box. That is not costed here.
