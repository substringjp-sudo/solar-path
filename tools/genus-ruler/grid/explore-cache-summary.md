# Cache reuse and request cost under observer movement

**Status: EXPLORATORY, dev-only.** This is a pure geometry simulation. It made no API calls, used no truth data and opened no
MODIS scenes (held or dev). It is **not** a gate decision. It measures only how much of each sample layout can be reused
from a cache after the observer moves, and how many locations must then be requested. It says nothing about forecast skill
or about Barnes/FFT accuracy; other agents are measuring those.

Scripts: `cache_sim.py` (simulation, uses `geom.py` GEOMS unchanged), `cache_agg.py` (aggregation), `cache_md.py` (this file).
Raw per-start output: `cache_raw.json`. Aggregates: `cache-results.json`. All files are in
`/tmp/claude-0/-home-user-solar-path/827aa702-2f52-52c8-9fe8-e45a3ff14759/scratchpad/grid/`.

## Setup

- **Sites:** Seoul (37.5, 127.0), Kanazawa (36.5679, 136.6774), Hamburg (53.55, 9.99), Sydney (-33.87, 151.21).
  Each site has 24 random start points, offset uniformly by +-1 deg in lat and lon (96 starts in total). A +-1 deg box is one full
  period of the 0.02, 0.125, 0.25, 0.5, 1 and 2 deg lattices, so the phases of gridBucket, the model cells and the clipmap
  re-centring are all sampled evenly. A box of one 0.125 deg cell would have pinned the coarse clipmap levels to a single phase.
- **Policies.**
  - `P0_bucket002`: today's behaviour. The whole set is cached under `gridBucket(observer, 0.02)`+date
    (`ringCacheKey`; the `ringFallbackFinder` also uses `sameBucket`). Reuse is 0% or 100%. A miss fetches every location left
    after the app's `toFixed(4)` dedupe.
  - `P1_cell0125` / `P1_cell025`: each sample point is keyed by the nearest lattice point of a regular 0.125 or 0.25 deg grid,
    and the request goes to that lattice point. After a move, only uncached cells are fetched.
  - `P1x_exact4dp` (extra, not asked for): a per-point cache keyed by the exact `toFixed(4)` coordinate, with no snapping.
  - `P0_cap10` / `P0_cap3` (scenarios only): P0 with a FIFO list of the 10 or 3 most recently inserted entries. These match the
    store `weatherCacheList` cap (MAX_CACHE_ENTRIES=10) and the disk ring cap (MAX_RING_ENTRIES=3). They model the state after
    the 30-minute in-memory TTL (`CACHE_TTL_MS`) has expired. Unless capped, every cache is unbounded and has no expiry
    within one date. No TTL is simulated.
- **Moves:** 0.5, 1, 2, 5, 10, 20, 50, 100 km x 36 bearings (every 10 deg) from each start, giving 3,456 moves per distance.
  "Fraction cached" = |new keys that are already cached| / |new keys|; for P0 it is 1 on a bucket hit and 0 otherwise.
- **Scenarios:**
  - (a) A straight 100 km drive with a check every 1 km (101 checks, including the first fresh fetch), on 16 bearings, so 1,536 drives.
  - (b) A random walk of 200 steps x 0.3 km with a random bearing at each step, checked after every step. There are 2 walks per start (192 walks).
  - (c) After (a), drive back along the same line with checks every 1 km at a random phase, then check the exact start.
    A separate "teleport back to the start" check is also run on the cache state right after (a).

## 1. Fresh request size (step 6)

Mean over the 96 starts.

| geometry | raw points | after app toFixed(4) dedupe | 0.125 deg cells | 0.25 deg cells | toFixed(4) range | weight placeholder (=toFixed(4) / =0.125 cells) | alt x1.6 if 2 models count as 16 vars |
|---|---|---|---|---|---|---|---|
| G0_ring91 | 91 | 91 | 78.1 | 69.9 | 91-91 | 91.0 / 78.1 | 145.6 / 125.0 |
| G0c_ring91_cell | 78.1 | 78.1 | 78.1 | 69.9 | 76-81 | 78.1 / 78.1 | 125.0 / 125.0 |
| G1_uniform_ctr | 97 | 97 | 97 | 97 | 97-97 | 97.0 / 97.0 | 155.2 / 155.2 |
| G1a_uniform_anch | 89.7 | 89.7 | 89.7 | 89.7 | 78-115 | 89.7 / 89.7 | 143.5 / 143.5 |
| G2_clipmap_m2 | 100.6 | 100.6 | 100.6 | 81.4 | 92-109 | 100.6 / 100.6 | 161.0 / 161.0 |
| G2b_clipmap_m3 | 195.2 | 195.2 | 195.2 | 159.1 | 181-206 | 195.2 / 195.2 | 312.3 / 312.3 |
| G4_ring24az | 175 | 175 | 143.3 | 125.4 | 175-175 | 175.0 / 143.3 | 280.0 / 229.3 |
| G3_dense0125 (counts only) | 4105.9 | 4105.9 | 4105.9 | 1059.9 | 3630-5225 | 4105.9 / 4105.9 | 6569.4 / 6569.4 |

Mean `toFixed(4)` count by site for G1a: seoul 83.8, kanazawa 83.2, hamburg 111.8, sydney 80.1. The 0.75 deg lattice is denser in km at 53.5N.

- The app's `toFixed(4)` dedupe removes **nothing** from the ring: 91 stays 91. Cell-level dedupe would cut it to about 78 at
  0.125 deg (-14%) or 70 at 0.25 deg (-23%), because the 5 km and 10 km rings fall into shared cells.
- **Weight rule (placeholder):** weight = nLocations x max(1, nVariables/10) x max(1, nDays/14). With 8 variables and 1 day this
  gives weight = nLocations. This is a placeholder: another agent is confirming the real rule, including how
  `models=ecmwf_ifs025,icon_seamless` counts. The "alt" column assumes 2 models x 8 variables = 16 effective variables (x1.6);
  that is the convention in the sibling `facts/facts_calc.json`. Under either rule, cost is proportional to the location counts
  below, so every comparison in this file is just a ratio of locations.

## 2. Single move from a warm cache (step 4)

### 2a. Mean fraction of the new sample set already in cache

| geometry | policy | 0.5 km | 1 km | 2 km | 5 km | 10 km | 20 km | 50 km | 100 km |
|---|---|---|---|---|---|---|---|---|---|
| G0_ring91 | P0_bucket002 | 0.68 | 0.41 | 0.05 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 |
| G0_ring91 | P1_cell0125 | 0.95 | 0.90 | 0.81 | 0.55 | 0.23 | 0.10 | 0.05 | 0.05 |
| G0_ring91 | P1_cell025 | 0.97 | 0.95 | 0.90 | 0.76 | 0.56 | 0.26 | 0.15 | 0.13 |
| G0_ring91 | P1x_exact4dp | 0.00 | 0.00 | 0.00 | 0.01 | 0.01 | 0.00 | 0.00 | 0.00 |
| G0c_ring91_cell | P0_bucket002 | 0.68 | 0.41 | 0.05 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 |
| G0c_ring91_cell | P1_cell0125 | 0.95 | 0.90 | 0.81 | 0.55 | 0.23 | 0.10 | 0.05 | 0.05 |
| G0c_ring91_cell | P1_cell025 | 0.97 | 0.95 | 0.90 | 0.76 | 0.56 | 0.26 | 0.15 | 0.13 |
| G0c_ring91_cell | P1x_exact4dp | 0.95 | 0.90 | 0.81 | 0.55 | 0.23 | 0.10 | 0.05 | 0.05 |
| G1_uniform_ctr | P0_bucket002 | 0.68 | 0.41 | 0.05 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 |
| G1_uniform_ctr | P1_cell0125 | 0.94 | 0.89 | 0.80 | 0.52 | 0.16 | 0.00 | 0.00 | 0.04 |
| G1_uniform_ctr | P1_cell025 | 0.98 | 0.95 | 0.90 | 0.74 | 0.52 | 0.16 | 0.03 | 0.11 |
| G1_uniform_ctr | P1x_exact4dp | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 |
| G1a_uniform_anch | P0_bucket002 | 0.68 | 0.41 | 0.05 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 |
| G1a_uniform_anch | P1_cell0125 | 1.00 | 1.00 | 1.00 | 0.99 | 0.98 | 0.97 | 0.92 | 0.83 |
| G1a_uniform_anch | P1_cell025 | 1.00 | 1.00 | 1.00 | 0.99 | 0.98 | 0.97 | 0.92 | 0.83 |
| G1a_uniform_anch | P1x_exact4dp | 1.00 | 1.00 | 1.00 | 0.99 | 0.98 | 0.97 | 0.92 | 0.83 |
| G2_clipmap_m2 | P0_bucket002 | 0.68 | 0.41 | 0.05 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 |
| G2_clipmap_m2 | P1_cell0125 | 1.00 | 0.99 | 0.99 | 0.96 | 0.93 | 0.85 | 0.66 | 0.49 |
| G2_clipmap_m2 | P1_cell025 | 1.00 | 0.99 | 0.99 | 0.98 | 0.95 | 0.91 | 0.78 | 0.60 |
| G2_clipmap_m2 | P1x_exact4dp | 1.00 | 0.99 | 0.99 | 0.96 | 0.93 | 0.85 | 0.66 | 0.49 |
| G2b_clipmap_m3 | P0_bucket002 | 0.68 | 0.41 | 0.05 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 |
| G2b_clipmap_m3 | P1_cell0125 | 1.00 | 0.99 | 0.99 | 0.97 | 0.94 | 0.89 | 0.74 | 0.57 |
| G2b_clipmap_m3 | P1_cell025 | 1.00 | 1.00 | 0.99 | 0.98 | 0.97 | 0.93 | 0.84 | 0.69 |
| G2b_clipmap_m3 | P1x_exact4dp | 1.00 | 0.99 | 0.99 | 0.97 | 0.94 | 0.89 | 0.74 | 0.57 |
| G4_ring24az | P0_bucket002 | 0.68 | 0.41 | 0.05 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 |
| G4_ring24az | P1_cell0125 | 0.95 | 0.91 | 0.81 | 0.56 | 0.24 | 0.11 | 0.08 | 0.09 |
| G4_ring24az | P1_cell025 | 0.97 | 0.95 | 0.90 | 0.77 | 0.58 | 0.29 | 0.19 | 0.22 |
| G4_ring24az | P1x_exact4dp | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 |

### 2b. Mean number of locations that must be fetched

| geometry | policy | 0.5 km | 1 km | 2 km | 5 km | 10 km | 20 km | 50 km | 100 km |
|---|---|---|---|---|---|---|---|---|---|
| G0_ring91 | P0_bucket002 | 29.0 | 53.3 | 86.7 | 91.0 | 91.0 | 91.0 | 91.0 | 91.0 |
| G0_ring91 | P1_cell0125 | 3.9 | 7.7 | 15.0 | 35.1 | 60.2 | 70.4 | 74.2 | 74.1 |
| G0_ring91 | P1_cell025 | 1.8 | 3.6 | 6.9 | 16.7 | 30.7 | 51.7 | 59.3 | 60.6 |
| G0_ring91 | P1x_exact4dp | 91.0 | 91.0 | 91.0 | 90.2 | 90.3 | 90.8 | 91.0 | 90.7 |
| G0c_ring91_cell | P0_bucket002 | 24.9 | 45.8 | 74.4 | 78.1 | 78.1 | 78.1 | 78.1 | 78.1 |
| G0c_ring91_cell | P1_cell0125 | 3.9 | 7.7 | 15.0 | 35.1 | 60.2 | 70.4 | 74.2 | 74.1 |
| G0c_ring91_cell | P1_cell025 | 1.9 | 3.6 | 6.9 | 16.6 | 30.6 | 51.9 | 59.3 | 60.6 |
| G0c_ring91_cell | P1x_exact4dp | 3.9 | 7.7 | 15.0 | 35.1 | 60.2 | 70.4 | 74.2 | 74.1 |
| G1_uniform_ctr | P0_bucket002 | 30.9 | 56.8 | 92.4 | 97.0 | 97.0 | 97.0 | 97.0 | 97.0 |
| G1_uniform_ctr | P1_cell0125 | 5.4 | 10.3 | 19.8 | 46.9 | 81.7 | 97.0 | 97.0 | 92.8 |
| G1_uniform_ctr | P1_cell025 | 2.1 | 4.5 | 9.7 | 24.8 | 46.9 | 81.6 | 94.2 | 86.3 |
| G1_uniform_ctr | P1x_exact4dp | 97.0 | 97.0 | 97.0 | 97.0 | 97.0 | 97.0 | 97.0 | 97.0 |
| G1a_uniform_anch | P0_bucket002 | 28.9 | 53.3 | 85.5 | 89.7 | 89.7 | 89.6 | 89.6 | 89.6 |
| G1a_uniform_anch | P1_cell0125 | 0.1 | 0.1 | 0.3 | 0.7 | 1.5 | 2.9 | 7.4 | 14.8 |
| G1a_uniform_anch | P1_cell025 | 0.1 | 0.1 | 0.3 | 0.7 | 1.5 | 2.9 | 7.4 | 14.8 |
| G1a_uniform_anch | P1x_exact4dp | 0.1 | 0.1 | 0.3 | 0.7 | 1.5 | 2.9 | 7.4 | 14.8 |
| G2_clipmap_m2 | P0_bucket002 | 32.1 | 58.9 | 95.7 | 100.5 | 100.3 | 100.1 | 100.0 | 100.1 |
| G2_clipmap_m2 | P1_cell0125 | 0.4 | 0.7 | 1.4 | 3.8 | 7.5 | 14.8 | 33.6 | 51.5 |
| G2_clipmap_m2 | P1_cell025 | 0.3 | 0.4 | 0.7 | 2.0 | 3.8 | 7.6 | 17.9 | 32.8 |
| G2_clipmap_m2 | P1x_exact4dp | 0.4 | 0.7 | 1.4 | 3.8 | 7.5 | 14.8 | 33.6 | 51.5 |
| G2b_clipmap_m3 | P0_bucket002 | 62.0 | 114.3 | 186.1 | 195.5 | 195.7 | 195.9 | 196.0 | 195.9 |
| G2b_clipmap_m3 | P1_cell0125 | 0.6 | 1.0 | 2.1 | 5.6 | 11.0 | 21.7 | 50.1 | 85.0 |
| G2b_clipmap_m3 | P1_cell025 | 0.3 | 0.5 | 1.0 | 2.6 | 5.3 | 10.7 | 25.9 | 48.5 |
| G2b_clipmap_m3 | P1x_exact4dp | 0.6 | 1.0 | 2.1 | 5.6 | 11.0 | 21.7 | 50.1 | 85.0 |
| G4_ring24az | P0_bucket002 | 55.7 | 102.4 | 166.6 | 175.0 | 175.0 | 175.0 | 175.0 | 175.0 |
| G4_ring24az | P1_cell0125 | 6.8 | 13.5 | 26.6 | 62.9 | 108.5 | 127.5 | 131.3 | 130.2 |
| G4_ring24az | P1_cell025 | 3.2 | 6.2 | 12.1 | 28.8 | 52.9 | 89.3 | 101.3 | 97.5 |
| G4_ring24az | P1x_exact4dp | 175.0 | 175.0 | 175.0 | 174.2 | 174.3 | 174.8 | 175.0 | 174.7 |

### 2c. Probability that a move needs any request at all

| geometry | policy | 0.5 km | 1 km | 2 km | 5 km | 10 km | 20 km | 50 km | 100 km |
|---|---|---|---|---|---|---|---|---|---|
| G0_ring91 | P0_bucket002 | 0.32 | 0.58 | 0.95 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| G0_ring91 | P1_cell0125 | 0.93 | 0.99 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| G0_ring91 | P1_cell025 | 0.76 | 0.93 | 0.99 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| G0_ring91 | P1x_exact4dp | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| G0c_ring91_cell | P0_bucket002 | 0.32 | 0.58 | 0.95 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| G0c_ring91_cell | P1_cell0125 | 0.93 | 0.99 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| G0c_ring91_cell | P1_cell025 | 0.77 | 0.93 | 0.99 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| G0c_ring91_cell | P1x_exact4dp | 0.93 | 0.99 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| G1_uniform_ctr | P0_bucket002 | 0.32 | 0.58 | 0.95 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| G1_uniform_ctr | P1_cell0125 | 0.48 | 0.74 | 0.98 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| G1_uniform_ctr | P1_cell025 | 0.23 | 0.45 | 0.84 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| G1_uniform_ctr | P1x_exact4dp | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| G1a_uniform_anch | P0_bucket002 | 0.32 | 0.58 | 0.95 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| G1a_uniform_anch | P1_cell0125 | 0.05 | 0.13 | 0.25 | 0.52 | 0.77 | 0.97 | 1.00 | 1.00 |
| G1a_uniform_anch | P1_cell025 | 0.05 | 0.13 | 0.25 | 0.52 | 0.77 | 0.97 | 1.00 | 1.00 |
| G1a_uniform_anch | P1x_exact4dp | 0.05 | 0.13 | 0.25 | 0.52 | 0.77 | 0.97 | 1.00 | 1.00 |
| G2_clipmap_m2 | P0_bucket002 | 0.32 | 0.58 | 0.95 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| G2_clipmap_m2 | P1_cell0125 | 0.10 | 0.18 | 0.35 | 0.84 | 0.99 | 1.00 | 1.00 | 1.00 |
| G2_clipmap_m2 | P1_cell025 | 0.07 | 0.10 | 0.19 | 0.47 | 0.80 | 0.99 | 1.00 | 1.00 |
| G2_clipmap_m2 | P1x_exact4dp | 0.10 | 0.18 | 0.35 | 0.84 | 0.99 | 1.00 | 1.00 | 1.00 |
| G2b_clipmap_m3 | P0_bucket002 | 0.32 | 0.58 | 0.95 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| G2b_clipmap_m3 | P1_cell0125 | 0.10 | 0.18 | 0.35 | 0.84 | 0.99 | 1.00 | 1.00 | 1.00 |
| G2b_clipmap_m3 | P1_cell025 | 0.07 | 0.10 | 0.19 | 0.47 | 0.80 | 0.99 | 1.00 | 1.00 |
| G2b_clipmap_m3 | P1x_exact4dp | 0.10 | 0.18 | 0.35 | 0.84 | 0.99 | 1.00 | 1.00 | 1.00 |
| G4_ring24az | P0_bucket002 | 0.32 | 0.58 | 0.95 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| G4_ring24az | P1_cell0125 | 0.99 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| G4_ring24az | P1_cell025 | 0.88 | 0.98 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| G4_ring24az | P1x_exact4dp | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |

Per-site values are in `cache-results.json` under `move_table.*.by_site`. P0's hit rate is lowest at Hamburg, because the
0.02 deg buckets are narrower in longitude there: after a 1 km move the hit rate is 0.32 at Hamburg against 0.43-0.48 at the other sites.

## 3. Scenarios (step 5)

Cells show **total locations fetched, including the first fresh fetch (number of HTTP requests)**. Each value is the mean per run.

### (a) Straight 100 km drive, checked every 1 km

| geometry | P0_bucket002 | P0_cap10 | P0_cap3 | P1_cell0125 | P1_cell025 | P1x_exact4dp |
|---|---|---|---|---|---|---|
| G0_ring91 | 5388 (59.2) | 5388 (59.2) | 5388 (59.2) | 700 (99.3) | 334 (85.7) | 9012 (101.0) |
| G0c_ring91_cell | 4626 (59.2) | 4626 (59.2) | 4626 (59.2) | 700 (99.3) | 334 (85.7) | 700 (99.3) |
| G1_uniform_ctr | 5743 (59.2) | 5743 (59.2) | 5743 (59.2) | 1024 (73.1) | 528 (47.7) | 9797 (101.0) |
| G1a_uniform_anch | 5364 (59.2) | 5364 (59.2) | 5364 (59.2) | 105 (14.8) | 105 (14.8) | 105 (14.8) |
| G2_clipmap_m2 | 5926 (59.2) | 5926 (59.2) | 5926 (59.2) | 178 (20.8) | 120 (10.8) | 178 (20.8) |
| G2b_clipmap_m3 | 11597 (59.2) | 11597 (59.2) | 11597 (59.2) | 305 (20.8) | 213 (10.8) | 305 (20.8) |
| G4_ring24az | 10361 (59.2) | 10361 (59.2) | 10361 (59.2) | 1206 (100.8) | 540 (95.0) | 17490 (101.0) |

### (b) City walk, 200 steps x 0.3 km

| geometry | P0_bucket002 | P0_cap10 | P0_cap3 | P1_cell0125 | P1_cell025 | P1x_exact4dp |
|---|---|---|---|---|---|---|
| G0_ring91 | 737 (8.1) | 738 (8.1) | 1125 (12.4) | 138 (30.0) | 96 (17.0) | 18185 (201.0) |
| G0c_ring91_cell | 633 (8.1) | 633 (8.1) | 966 (12.4) | 138 (30.0) | 96 (16.9) | 138 (30.0) |
| G1_uniform_ctr | 786 (8.1) | 786 (8.1) | 1199 (12.4) | 178 (12.8) | 136 (6.7) | 19384 (200.8) |
| G1a_uniform_anch | 739 (8.1) | 739 (8.1) | 1124 (12.4) | 91 (2.1) | 91 (2.1) | 91 (2.1) |
| G2_clipmap_m2 | 814 (8.1) | 814 (8.1) | 1243 (12.4) | 106 (2.6) | 84 (1.7) | 106 (2.6) |
| G2b_clipmap_m3 | 1582 (8.1) | 1583 (8.1) | 2414 (12.4) | 203 (2.5) | 163 (1.7) | 203 (2.5) |
| G4_ring24az | 1417 (8.1) | 1418 (8.1) | 2164 (12.4) | 250 (40.0) | 170 (24.5) | 34970 (201.0) |

### (c) Return to the start after (a)

Cells show **locations fetched on the return leg (requests) / locations fetched on a teleport straight back to the start**.

| geometry | P0_bucket002 | P0_cap10 | P0_cap3 | P1_cell0125 | P1_cell025 | P1x_exact4dp |
|---|---|---|---|---|---|---|
| G0_ring91 | 239 (2.6) / 0 | 4548 (50.0) / 91 | 5133 (56.4) / 91 | 4 (3.5) / 0 | 1 (0.7) / 0 | 8820 (100.0) / 0 |
| G0c_ring91_cell | 205 (2.6) / 0 | 3905 (50.0) / 78 | 4407 (56.4) / 78 | 4 (3.5) / 0 | 1 (0.7) / 0 | 4 (3.5) / 0 |
| G1_uniform_ctr | 255 (2.6) / 0 | 4848 (50.0) / 97 | 5471 (56.4) / 97 | 7 (5.5) / 0 | 1 (1.2) / 0 | 9588 (99.8) / 0 |
| G1a_uniform_anch | 240 (2.6) / 0 | 4536 (50.0) / 90 | 5112 (56.4) / 90 | 0 (0.0) / 0 | 0 (0.0) / 0 | 0 (0.0) / 0 |
| G2_clipmap_m2 | 263 (2.6) / 0 | 5002 (50.0) / 101 | 5646 (56.4) / 101 | 0 (0.1) / 0 | 0 (0.0) / 0 | 0 (0.1) / 0 |
| G2b_clipmap_m3 | 514 (2.6) / 0 | 9790 (50.0) / 195 | 11048 (56.4) / 195 | 0 (0.1) / 0 | 0 (0.0) / 0 | 0 (0.1) / 0 |
| G4_ring24az | 459 (2.6) / 0 | 8746 (50.0) / 175 | 9870 (56.4) / 175 | 6 (5.5) / 0 | 1 (1.0) / 0 | 17115 (100.0) / 0 |

## What the numbers say (exploratory)

1. **Today's P0 is all-or-nothing on a 0.02 deg bucket** (about 2.2 km N-S by 1.8 km E-W at 37.5N, and 1.3 km E-W at Hamburg).
   - After a move of 0.5 / 1 / 2 km the set is reused in a fraction 0.682 / 0.415 / 0.048 of moves, and never beyond 5 km.
   - Every miss re-downloads all 91 ring locations.
   - On the 100 km drive it costs 5388 locations in 59 requests.
2. **Per-cell keys (P1) on the current ring cut the location count but not the number of round trips.**
   - On the drive: 700 locations at 0.125 deg (7.7x fewer than P0) and 334 at 0.25 deg.
   - But it needs 99 requests against P0's 59.
   - Even a 0.5 km move needs a small request 93% of the time. The ring moves with the observer, so with 91 points some point is always crossing a cell edge.
   - Reuse falls quickly with distance: 0.55 at 5 km, 0.23 at 10 km and 0.05 at 100 km.
3. **A world-anchored lattice combined with per-cell keys is where the user's hashing idea pays off.**
   - G1a (fixed 0.75 deg lattice):
     - fetches 0.1 / 1.5 / 14.8 locations after 1 / 10 / 100 km;
     - needs a request only 13% of the time after a 1 km move;
     - still has a fraction 0.835 of its set cached after 100 km, close to the overlap area of two 384 km disks 100 km apart (0.835 by the circle-overlap formula).
   - On the drive, G1a costs 105 locations in 15 requests, against 5364 / 59 under P0.
   - The anchored clipmap G2 (m=2) costs 178 locations in 21 requests, and G2b (m=3, about twice the points) costs 305 / 21.
   - On the walk: G1a 91 locations (1 after the first fetch), G2 106, against 737 for today's ring under P0.
4. **What matters is anchoring plus cell keys. A grid alone does not help.**
   - An observer-centred square lattice (G1_uniform_ctr) behaves like the ring or worse. Under P1 at 0.125 deg its reuse is 0.00 at 20 km and 0.00 at 50 km, and the drive costs 1024 locations.
     The small rise at 100 km (0.04) comes from diagonal moves of one 71 km lattice step.
   - Exact-coordinate hashing with no snapping (P1x) reuses nothing for observer-centred sets (G0, G1, G4).
     That makes it worse than P0 on the walk: 18185 locations for the ring.
     It is identical to P1 for sets that are already on the lattice (G0c, G1a, G2).
5. **Return trips.**
   - With an unbounded cache, P0 refetches only where the return checks land in buckets the outbound checks skipped:
     239 locations for the ring.
   - With the app's real caps, which apply once the 30-minute memory TTL has passed, P0 re-downloads nearly the whole drive:
     4548 locations with 10 entries and 5133 with 3.
     A teleport back to the start costs a full fresh set.
   - P1 needs 0-7 locations on the return leg. The cell cache after the drive holds about 700 cells for the ring and 105 for G1a.
     At about 1.5 KB per point (from the measured 139 KB per 91-point ring entry), that is at most about 1 MB.
6. **Dense 0.125 deg box (G3), for scale:** about 4106 cells (3,630-5,225 depending on latitude), or about 1060 at 0.25 deg.
   That is roughly 45x the ring's weight under the placeholder rule for one fresh fetch.
7. **Not simulated:**
   - The separate sun-direction fan request (`sunset_${gridBucket}_..._${bucketedAzimuth}`) has the same all-or-nothing bucket behaviour, and its key also depends on the sun-azimuth bucket.
   - In a per-cell design, the fan could be served from the same cell cache if it were snapped to the same lattice.

## Open-Meteo cell_selection, and why a real cache should key on what the API answers (step 7)

The app sends no `cell_selection`, so Open-Meteo applies its default, `land`. That default picks a nearby land cell whose
elevation matches the request's 90 m DEM elevation, so at coasts and in mountains it can return a neighbouring cell rather
than the nearest one. Open-Meteo returns grid-cell values and does no horizontal interpolation.

The sibling probes in `om_probe/` suggest three things. I did not check which coordinates those probes requested.

- Default and `nearest` returned different 0.25 deg cells at 2 of 6 test points (`cs_land.json` against `cs_nearest.json`).
- In a blended request, the response's latitude/longitude are those of the **first listed model** only:
  - `icon_seamless,ecmwf_ifs025` reported 37.625 (an ICON 0.125 cell);
  - the ECMWF-first request reported 37.5 (an IFS 0.25 cell).

How this changes the numbers above, qualitatively:

- **If the request is sent at the snapped lattice point and keyed on that requested point (P1 as simulated), the numbers stand
  and the cache is exact.** The API is deterministic in (coordinates, models, cell_selection), so a cached entry is exactly
  what a re-request would return, whatever cell `land` chose. The only loss is that two lattice keys can resolve to the same
  model cell at a coast. Those are duplicate fetches, so the P1 counts are a slight **upper bound** on the locations needed.
- **Keying on the returned grid-cell coordinates** can only merge more keys, so hits go up a little. The catch is that the
  returned cell is only known after the first fetch. To skip a fetch you need a learned map from requested key to returned
  cell. That map is static per model grid and per `cell_selection`, so it could be kept across dates.
  - With the 2-model blend, the response names only the first model's cell. A returned-coordinate key therefore identifies
    only one of the two models' cells. Keying on the returned cell would need per-model requests or per-model keys; the
    requested-lattice-point key avoids that.
- **Requesting at the exact ring point and predicting the cell by nearest snapping** gives the same hit counts as P1. Under
  `land` it can **wrongly** reuse data: at coasts the API would have returned a different cell. Those hits are approximate,
  not exact. Setting `cell_selection=nearest` makes the prediction exact for regular lat/lon grids, apart from tie-breaks,
  but it changes coastal values compared with today's default. That is a data choice, not a cache choice.
- Hamburg: `icon_seamless` there includes ICON-D2 (about 2 km) and ICON-EU (about 7 km). A 0.125 deg lattice key throws away
  that near-field resolution. Its cache numbers are still valid, but it samples the model more coarsely than the model offers.

## Caveats

- These are exploratory, dev-only geometry results, not a gate decision. The values are means over 96 starts x bearings, with
  no confidence intervals. Spread between sites is small apart from Hamburg's narrower buckets and denser G1a; see the
  per-site values in `cache-results.json`.
- Caches are unbounded and have no expiry, apart from the P0 cap variants. Forecasts change with every model run (IFS and
  ICON roughly every 6 h), so a per-cell cache for today and future dates needs a model-run or fetch-time stamp per cell;
  otherwise cells from different runs get mixed. Past dates (historical API) do not change, which is the best case for P1.
- P1 changes where the samples are: requests go to lattice points, up to about half a cell (about 7 km at 0.125 deg) away
  from the ring point. `P1_cell025` also merges the 0.125 deg-spaced points (clipmap L0, the near ring), so its geometry
  carries less information and is not a like-for-like comparison with the 0.125 deg policy. The accuracy effect belongs to
  the Barnes/FFT measurements, not to this file.
- The request count matters as well as the location count. The app measured 514-640 ms per round trip
  (`weatherCacheKey.ts`). On the ring, P1 trades fewer locations for more, smaller requests. A refresh threshold, such as
  fetching only when an inner cell is missing and reusing the nearest cached cell for far misses, would reduce the round trips,
  but it was not simulated.
- Weight values are the placeholder rule (x1, or x1.6 in the alt column) and are only proportional to the location counts.
