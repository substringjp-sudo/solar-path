# atmos round 1 — code map (C3+C1 `macroOro`, C4 regime, RULER-oro)

Snapshot: branch `claude/eloquent-clarke-73zhgy` @ a04b3ff. `main`/`origin/main` @ a8a4f61 is 2 commits ahead (98affae, a8a4f61) and those commits are NOT in this branch. Read-only survey. No MODIS cloud values were opened: for `sat-quartiles.json` and `modis-times.json` only the key names and entry counts were read.
Line refs are for HEAD. The survey's refs into `volumetricScene.ts` are stale, because the file grew about 250 lines after a4dd1bb. `macroField.ts`, `weather.ts`, `macroShader.ts` and `cloudMorph.ts` have not changed since the survey, so its refs into those files still hold.

## 1. Macro cloud field pipeline (ring → grid → shader)

**Ring fetch.** `src/utils/weather.ts`:
- `RING` is at :413-422. It has 5 km × 6 azimuths, plus 10/30/70/130/200/280/380 km × 12 azimuths. That is 90 points plus the observer, so 91 in total.
- `fetchDayWeatherRing` (:1033) builds the virtual points (:1078-1084) and de-duplicates the coordinates (:1090-1102).
- Ring URL (:1110-1117): `weatherSourceFor(…,'ring')` with the blend `&models=ecmwf_ifs025,icon_seamless` (`modelBlend.ts:44,76`).
- A seam copy at -180° is added for every 180° point (:1196-1198).
- `getInterpolatedWeather` (:1222) interpolates linearly in time, point by point.

**App input.** `src/components/VolumetricProbe/liveScene.ts`:
- `buildLiveScene` (:135) → `interpolatedList` (:153-155) → `dropSeamCopies`.
- `macroRing` (:270-275) holds low/mid/high cover per point (0..1), and is used only when there are at least 20 points.
- Its output is `VolumetricSceneInput.macro` (`volumetricScene.ts:131-136`).
- The old two-number gradient path, `buildMacroWeatherField` (:156, :187-193), still feeds `beamTransmittance` and `sunGap`. The gradient itself is zeroed unless `macroGrad` is set.

**Grid math.** `src/utils/macroField.ts` is a pure module with no three.js. It is shared by the app and the harness. Pipeline steps:
- `samplesFromRing` (:451): az clockwise from north, giving x=d·sin, y=d·cos in km.
- `sampleSpacingKm` (:119).
- `barnesGrid` (:172): 2-pass Barnes with γ 0.35 and σ_i = max(6 km, 0.6·spacing). Its outputs are `base` and the `lambdaRes` map.
- `fitBeta` (:215): β prior 1.25, clamped to [0.8, 2.0].
- `newState` (:293): white-noise FFT coefficients from a seeded RNG.
- `synthesizeLatent` (:363): six octave bands, added only where λ < λ_res(x), then unit variance.
- Coverage-preserving anamorphosis, `expectedSoftCover`/`muForCover` (:265/:276). This is a LUT for g⁻¹(C̄). It is a soft clamp ½+Y/w with w = `edgeWidth` 1.0; it is not a plain Φ⁻¹.
- `stepMacroState` (:311): AR(1), τ = 30 min · (λ/10 km)^(2/3).
- `buildMacroField` (:408-435):
  - Barnes runs at :412 and β at :415.
  - The state is created or reused at :418.
  - **`synthesizeLatent` always runs (:421), even in mode 1.**
  - Mode 1 is `noise === false` → `cover.set(base)` (:428).
  - Mode 2 is the loop at :429-431, which clips at 0.002 and 0.998.
  - The grid convention is row 0 = south, rows increasing northward, observer at (n/2, n/2) (:76-77).
- The FFT is `fft2` (radix-2 power-of-two, in place, inverse /n²) at `cloudFlow.ts:272`.

**Scene wiring.** `src/components/VolumetricProbe/volumetricScene.ts`:
- Options:
  - `macro: 0|1|2` (:394-395).
  - `macroN` (:397).
  - `macroGrad` (:402).
  - `DEFAULT_VOLUMETRIC_OPTIONS` (:442) has `macro:0, macroN:128, macroGrad:false`, and `morph:false, skeleton:0, flow:false`.
  - The app sets `macro: volumetricMacro ?? 1` (`SkyScene3D.tsx:2012`, default `:248`), so **the app default is mode 1 (Barnes only) on a 128² × 6 km grid**. The harness and rulers use 256² × 3 km.
- Macro state (:1007-1033):
  - `macroBuildFields` (:1019-1026) runs `buildMacroField` per band, then `makeMacroTexture`.
  - `macroTileCover` (:1028-1033) raises each layer's tile cover to max(obs, p75 of ring points within 150 km).
- `weatherPlan` (:1110-1152):
  - Applies `macroTileCover` (:1114).
  - The weather cache key is `JSON.stringify([useGenus, gl, plain, …, S])` (:1150).
- `applyScene` (:1169): macro build at :1283-1303. It needs at least 12 points per band, uses `extentKm = 768` hard-coded (:1292), sets `noise = (macro === 2)`, and builds the LUT from the weather-tile byte histogram (:1298).
- `setDate` (:1364):
  - `setMacroDrift` (:1385) advects the macro texture by −U·(t − scene time).
  - In mode 2 only, AR(1) steps every 60 s with dt capped at 3600 s (:1387-1399), and A/B textures are mixed.
- `setOptions` (:1486-1504) merges into `opt` and re-applies the scene.
- T_sun reads the macro bytes on the CPU (:1416-1440). This only matters when T_sun is on.

**Shader.** `macroShader.ts`, patched after `patchFlowShader` on both passes (`volumetricScene.ts:911-917`):
- `patchMacroShader` (:24-80) anchors on the macroGrad block (`cloudFlowShader.ts:101-104`).
- For each lane: C(x) = texture(A,B,mix) → threshold s = LUT_lane(C) → d' = (d−s)/(1−s).
- **It can only remove cloud.** Where C ≥ the tile cover, s = 0 and the tile is drawn unchanged.
- `makeMacroTexture` (:83-98): R = low, G = mid, B = high. **The A channel is a constant 255 (:89) and is the free lane.**
- `macroThresholdTable` (:102), LUT texture (:124), `setMacroUniforms` (:144), `setMacroDrift` (:162).
- The old gradient is zeroed unless `macroGrad` is set (`cloudFlowShader.ts:162-174`).

## 2. Where macroOro (C3+C1) and C4 plug in, with zero bytes changed when off

**C3 (new pure file `src/utils/oroLift.ts`, as the survey proposes).**
- Inputs: an elevation grid h (n², m, already resampled to the macro grid), U/V at about 850 hPa, N² for 850-700 hPa, and f.
- Output: η at 1.5 km and 3.0 km.
- It must import nothing that pulls in three or react-native. Reuse `fft2` from `cloudFlow.ts`. `downscale-run.mjs:30` and `macro-core-test.mjs:21` throw if three appears in the bundle.

**C1 (combiner).**
- Hook into `buildMacroField` after `base` (:412) and before the cover assignment (:428-431). Make it a new optional field such as `opts.oro?: {eta: Float32Array; kappa: number}`.
- In mode 1, replace `cover.set(base)` with Φ(Q̄ + κη̄) plus a local renormalisation.
- In mode 2, add aη to μ.
- The survey's §L3 refs (:428-431) are still valid.

**App wiring for C3+C1.**
- `applyScene` and `macroBuildFields` are synchronous. The asynchronous DEM must therefore be fetched by the caller (`liveScene`/`SkyScene3D`) and passed as a new optional `VolumetricSceneInput` field, for example `oro?: { h, n, extentKm }` or precomputed η per band. Thread it through `macroBuildFields` (:1022). It is also re-run in mode 2 at :1393, so η must be cached on the `macro` object and not recomputed every minute.
- `thermo` already carries the inputs C3 needs:
  - `windLowMps` (850 hPa, m/s, "toward" components) and `windMidMps` (600 hPa).
  - `levels` (zM, tC, pHPa at 15 levels).
  - `rhLevels` (850 and 700 present).
  - The wiring is `liveScene.ts:89-111`, using `cloudPhysics.ts:138-157`.
- Per §6, low uses η(1.5 km), mid uses η(3.0 km), and high is untouched.
- Option: `macroOro: 0` in `VolumetricOptions` (:284ff) and in `DEFAULT_VOLUMETRIC_OPTIONS` (:442). Also add it to the harness `JOB_BASE_OPTIONS` (`tools/genus-ruler/volsky/entry.ts:133-137`), as `macroGrad` was added in §171, so a job value cannot leak into later jobs. Add a dev setting in `SkyScene3D.tsx:221/248/2008/2012` that is also included in `qKey`.
- No shader change is needed. C3+C1 only changes the CPU cover texture.

**C4 regime selector.**
- The app's default low-cloud path is the genus presets. `morph`, `skeleton` and `flow` are all off by default.
- `cu`/`sc` FIELDS (`cloudGenus.ts:401`, `:488`) ignore wind direction. Only `ac` (:457), `cbanvil` (:606) and `ns` (:634) read `windDeg`.
- The survey's hooks are `cloudMorph.ts:67-85` (aniso :79, cellKm :83) and `cloudSkeleton.ts:74` (`ROLL_MIN_MPS`) plus :184-188. Those paths are off by default. Editing those constants directly would change the bytes of skeleton-on runs.
- Zero-byte pattern to follow, as with `GenusParams.morph`/`skeleton` (`cloudGenus.ts:44-53`, "없으면 이전과 같은 바이트", i.e. "absent = same bytes as before"):
  - Add a new option such as `regime: 0`.
  - `weatherPlan` (:1115-1131) attaches `opts.regime = {...}` only when the option is on, so the key and tile bytes are unchanged when off.
  - FIELDS branch on `L.opts?.regime`.
- Inputs at the observer:
  - Available: `pblM`, `capeJkg`, winds at 850/600/250, T/RH profiles.
  - Missing: 925 hPa wind, SHF, w, CIN.
- The spare macro A channel (`macroShader.ts:89`) is a possible spatial regime lane. It must stay 255 when off.

## 3. Data already fetched (`weather.ts`, `weatherSource.ts`)

**Ring points (91).** cloud_cover, plus low/mid/high, RH2m, DNI, TCWV and precipitation (:1113-1116). Archive requests add visibility and have no TCWV.
- The ring has **no wind, temperature, pressure-level or geopotential data.**
- RH2m, winds, thermo, air quality and satellite irradiance are attached only to the observer (i === 0, :1185-1191).
- The per-point `elevation` in the response is discarded.

**Observer requests.** `weatherSourceFor(…,'point')` means best_match, with no `&models`:
- `fetchThermoProfile` (:760-816) requests:
  - T2m, Td2m, CAPE, freezing level, BLH.
  - T at 15 levels, 1000-200 hPa (`THERMO_TEMP_LEVELS` :742).
  - RH at 13 levels, 1000-300 hPa (:744).
  - The null cache is used only for "no values/empty" (:814).
- `fetchLayerWinds` (:854-959) requests:
  - Wind speed/direction at 850/600/250 hPa (`WIND_LEVELS` :441). It converts "from" to "toward" (u,v) in km/h (:896-911).
  - Visibility.
  - cloud_cover and geopotential_height at 15 `PROFILE_LEVELS` (:451).
  - If any one level is missing, the whole result is null ("missing level" :915/:956).
- These are called together with the ring request (:1149-1154) and attached by `attachLayerWinds`/`attachThermo` (:970, :824).
- `CloudData` has observer-only fields `windU/V{Low,Mid,High}` (km/h), `profileHeightM`, `profileTempC`, `profileRhPct`, `pblM`, `capeJkg` and `total` (:55-115).

**Source routing.** `weatherSource.ts:57-71` uses calendar lead days:
- lead ≥ −5 → forecast.
- ≥ 2024-02-03 → historical-forecast-api (blend for ring, best_match for point).
- 2022-11-24..2024-02-02 → historical-icon (ring = icon_seamless).
- Earlier → archive. On a 403, the session falls back to archive-fallback.

**Gaps for round 1.**
- Ring-level wind/RH is not needed (§6 leaves the ring unchanged).
- C4 per the survey wants 925 hPa wind and SHF. Fetch these in a separate request with its own null cache. Do not append them to `fetchLayerWinds`, where one unsupported variable nulls the whole request (see risk R9).

## 4. Harness and tools that reproduce macro grids

- `tools/genus-ruler/macro/fetch-sat.py` builds the MODIS bank:
  - Source: GIBS WMS, EPSG:4326 bbox, 768² at about 1 km/px.
  - Mask: min(RGB) > 0.45. Grid: 256² × 3 km. Ring: 7 km box means.
  - Per-scene JSON: `{site, lat, lon, date, ring, grid, cellKm, trueGrid}`. **`trueGrid` has row 0 = north.**
  - SITES: dev = seoul, kanazawa; held = 8 sites. Default dates are 09-01..10-22 every 4 days (13 dates). Of 130 scenes, 121 are kept.
- `tools/genus-ruler/macro/downscale-run.mjs`:
  - Builds a bundle of macroField + macroWeatherField with `npx esbuild` → `buildMacroField` per scene.
  - Writes `syn`, `base` (Barnes) and `c0` as base64 u8.
  - `--opts` is a JSON passthrough. It is static per run, so per-scene η needs a new `oro-run.mjs`.
- `tools/genus-ruler/macro/macro.py` (numpy only, no scipy) computes corr50/corr12 (12 km boxes, centre ±90 km)/meanErr/bands. `truth_grid` flips rows (:116-120).
- `tools/genus-ruler/macro/macro-core-test.mjs`: unit tests with a three-guard.
- `tools/genus-ruler/ring/fetch-nwp-ring.py`:
  - Sends 1 historical request per site (91 points, 09-01..10-19, blend). The raw data goes to `ring/nwp/<tag>/` (gitignored, gone).
  - Writes `<scenes>-nwp-<tag>/` scene copies. These **keep `trueGrid`**, with `ring[].cover` interpolated to `modisTimeUtc`.
- `tools/genus-ruler/ring/modis-times.json` (committed, 121 entries; fields include `multiPass`, `seam`, `source`).
- `fetch-modis-time.py` reads CMR and does not need re-running.
- `eval-ringtruth.py` has `date_block_ci` at :34, which is reusable for the RULER-oro bootstrap.
- `tools/genus-ruler/source/measure-source.py` uses the same routing as `weatherSource.ts`.
- Not present yet:
  - No tool fetches observer winds, T or Z per scene. RULER-oro needs a new one: historical best_match at `modisTimeUtc`, about 121 × 5 weight.
  - No tool computes I_org, spacing or direction for C4. `FLOW_CHEAP_MATH_SURVEY.md:259` (B4) lists them.
- Ruler structure to follow: `RULER-*.md` with §0 pre-registration, question, truth, metrics, pre-registered rule, predictions, files, draft→freeze, record. Freezing uses `FROZEN.json` (`grain2/FROZEN.json` hashes `files`, `old`, `runtime` and `versions`; `versions` pins scipy 1.17.1 and numpy 2.4.6).

## 5. DEM utilities

- `src/utils/demTiles.ts` covers the following. It **imports three (:50)**.
  - Terrarium URL `s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png` (:58).
  - `lonLatToTileFloat` (:66), `tileSpanMetres` (:87), `DEM_BLOCK_TILES = 3` (:99).
  - `demZoomForRadius` (:112), `pickBlockOrigin` (:151).
  - A GPU-only despike (:345ff) for low-zoom R-channel defects of ±256 m.
  - `loadDemPatch` (:499), which loads GPU textures that cannot be read back on the CPU.
- `src/utils/demCpu.ts` provides `makeTerrariumSampler` (:30) and `loadCpuDemBlock(lat, lon, radiusM, decode)` (:53).
  - The decode function is injected. The native one is `arVisionNative.ts:43` (Skia).
  - The sampler has **no despike** and uses Web-Mercator geometry with (east, south) metres.
  - At 384 km radius it picks z6 (about 1.8-2.1 km/px) for 9 sites, and **z5 (2.9 km/px) for hamburg**.
- Parity reference: `tools/shader-preview/dem-cpu.js` (pngjs is in the lockfile). `src/utils/png.ts` is an encoder only; fflate is available for a pure decoder.
- On main only:
  - `src/utils/demTileCache.ts` imports react-native, expo-file-system and a bundled z0 asset. `demTiles.ts` now imports it (circular import).
  - On any download failure it **returns the z0 world tile URI for any z/x/y**, which is silently wrong terrain.
  - `loadDemPatch` now loads tiles in parallel.
  - `cloudGenus.ts` changes only in whitespace (`for (; ;)`).
- The Open-Meteo elevation API (`weather.ts:1395`) gives points only and returns 0.0 over sea.

## 6. Risks for byte-identical when off (and beyond: all scenes with a = 0)

- **R1. Clipping Q̄ to ±2.5 changes cover even when η = 0.** For example C = 1 becomes 0.9938, which is a byte change. Φ(Φ⁻¹(C)) also does not round-trip exactly in float32, and a NaN in h makes 0·NaN = NaN. → Short-circuit to `cover.set(base)` (or the mode-2 loop as it is now) when the option is off, h is absent, or the scene is not applicable. Do not compute with a = 0.
- **R2. RNG and state.** C1/C3 must not consume `mulberry32` draws or change `newState`/`st.beta`. In mode 2 the AR(1) chain would then diverge for every later minute.
- **R3. Tile headroom.** The shader cannot add cloud above the tile cover (`macroShader.ts` s = 0). Windward increases are clipped, so on screen C1 is not coverage-preserving. If `macroTileCover` (:1028) is raised for oro, the weather key and tile bytes change. Gate this by applicability as well as by the option, so non-mountain scenes stay identical even with the option on. The ruler grades CPU grids without this clip; add a clipped secondary metric.
- **R4. Option plumbing.** Keep new `GenusParams` fields out of `L.opts` when off: JSON.stringify drops `undefined` but not `0` or `null` (key at :1150). Add `macroOro` and `regime` to `JOB_BASE_OPTIONS`, otherwise harness jobs inherit the previous job's value. Any `volumetricScene.ts` edit changes the frozen runtime bundle hash (grain/tsun `FROZEN.json` "app.js"). The precedent is that new knobs default to 0.
- **R5. Do not touch C4 constants directly.** `cloudSkeleton` `ROLL_MIN_MPS` 5 → 6 changes skeleton-on bytes. Gate every C4 change behind its option. The macro A channel must stay 255.
- **R6. Async DEM.** If the DEM arrives after the first `applyScene`, the scene must be re-keyed, or the sky pops mid-scene. Offline, missing tiles, or the demTileCache z0 fallback must give exactly the off path. Detect the z0 fallback, or call `demTileUrl` directly.
- **R7. Imports.** `oroLift.ts` must not import `demTiles`/`demCpu`: they pull in three, and on main also react-native/expo. The three-guard in `downscale-run`/`macro-core-test` would throw. Keep the DEM as an injected grid.
- **R8. Terrain-locked η is advected.** `setMacroDrift` (:1385) shifts the whole cover texture by −U·Δt from scene time, so η drifts off the mountains until the next rebuild. This is not a byte issue but a correctness check. The survey says η is stationary.
- **R9. Changes to the observer fetch can change scenes with every option off.** Adding variables to `fetchLayerWinds`/`fetchThermoProfile` alters the URL and cache. On archive or unsupported endpoints the entire request fails, and the result falls back to null winds or constants. Use a separate request and null cache, as the survey says (`weather.ts:814/:956` pattern).
- **R10. Mode-1 "free work" skip.** Skipping `synthesizeLatent` when `noise === false` is identical for cover. Keep the returned `state` and `beta` unchanged, because mode switches 1→2 reuse `m.states`.

## 7. RULER-oro validity risks to pre-register (they can silently flip the sign of ρ_res)

- **Orientation.**
  - macroField has row 0 = south. MODIS `trueGrid` has row 0 = north (macro.py flips it). Terrarium y increases southward. demCpu uses +south.
  - Wind is stored as "toward" (u,v), while Open-Meteo gives "from".
  - `fft2` forward is e^{−ikx}. This sets the sign of iσ and e^{imz}.
  - → Require a synthetic ridge test (windward = upwind) and a known-mountain test on a dev site before the freeze.
- **Geometry.** The MODIS box is an equirectangular 4326 bbox with flat ring placement. NWP ring points use great-circle `dest()`. Resample the DEM with fetch-sat's own mapping in the ruler. Fix one zoom for all sites, e.g. z6 with a 5×5 block for hamburg. Port the despike to the CPU. Clamp bathymetry to h ≥ 0, since coastal sites include sea.
- **850 hPa underground.** At denver 850 hPa is below ground, so the U850 and N²(850-700) gates read extrapolated values. Pre-register "the first level above ground + Δ".
- **Model mismatch.** Observer soundings are best_match (JMA around Korea and Japan). Ring cover is the ECMWF+ICON blend. ĥ_sub with s = 10 km assumes one effective model resolution.
- **Time and sample size.** Use `modisTimeUtc` (Terra is about 09:40 local in 2026, not 10:30). Ringtruth judged on single-pass scenes only (68 of 97). If RULER-oro follows that, applicable held n is about 68 × 25-40% ≈ 17-27, which is near the n ≥ 20 cutoff ("미결", undecided). Decide single-pass versus all-pass before the freeze.
- **Contamination.**
  - The NWP scene copies carry `trueGrid`. `oro-run` should strip or ignore it, and the applicability list should be hashed before any MODIS read.
  - Committed `ring/gate-*-held.json` and `macro/sat-quartiles.json` rows contain per-scene held MODIS-derived metrics. Do not consult them when choosing gates or parameters.
  - Rebuild check: compare the new bank with `modis-times.json` keys (121), and blind-hash compare per-scene cover against sat-quartiles. The script should print counts only. GIBS reprocessing could change the bank.
- **Resolution.** The app runs at macroN = 128 (6 km) while the ruler runs at 256² (3 km). State which grid the verdict applies to.

## 8. Environment now

- `.harness/` (MODIS bank, `sat-nwp-*` scenes, syn outputs) and `ring/nwp/` are gone.
- node v22.23.4, no `node_modules`. esbuild is **not in package-lock** (`npx esbuild` downloads it); pin a version.
- Python has numpy 2.5.3 and PIL 12.3.0, but no scipy. The frozen grain2 environment pinned numpy 2.4.6 and scipy 1.17.1.
- Reachability (one request per host): historical-forecast-api 200, s3 terrarium z6 tile HEAD 200, GIBS wms.cgi HEAD 200 (no imagery fetched).
- Rebuild cost:
  - fetch-sat: 130 GIBS images.
  - fetch-nwp-ring blend: about 3,200 Open-Meteo weight.
  - Observer soundings: about 600 weight.
  - DEM: about 90 tiles.
  - The daily Open-Meteo limit is 10,000.
