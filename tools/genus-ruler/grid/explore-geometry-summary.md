# Sampling geometry vs reconstruction fidelity (EXPLORATORY, dev scenes only)

**Scope.** These are exploratory dev measurements, not a gate decision. I used only `group=='dev'` scenes (seoul_* 11 + kanazawa_* 13 = 24, in 13 date blocks, Sept–Oct 2026, both sites in East Asia) and never opened a held scene. Intervals are a percentile bootstrap over date blocks (10 000 resamples) with no correction for multiple comparisons. The inputs are idealised (no forecast error is simulated), so treat this as an upper bound on what geometry alone can do.

Scripts (NOT committed — only `geom.py` is in this folder; the numbers below cannot be re-run from the repo alone): `gf_lib.py` (sampler and metrics, imports macro.py), `gf_consistency.py`, `gf_shiftscan.py`, `gf_barnes.cjs` (bundled `src/utils/macroField.ts`), `gf_run.py`, `gf_orient.py`, `gf_diag_ref.py`, `gf_jitter.py`, `gf_stats.py`, `gf_md.py`.

## 1. Checks

* **Sampler consistency did not meet the 0.01 bar, and this is explained.** The sampler replicates fetch-sat.py's 7 km box exactly (1 km index `r = round(384 − y)`, `c = round(384 + x)`, `box_mean k = 7`) on a 1 km piecewise-constant upsample of the stored 3 km truth. At the bank's own flat-polar ring positions it gives mean |diff| 0.0096 (median scene) but max |diff| 0.131 (median scene max 0.085). The bank's ring values came from the 1 km mask; the stored 3 km `trueGrid` no longer has that sub-3 km structure, so no sampler can reach max ≤ 0.01. Orientation and indexing are nevertheless exact: in a shift/flip scan, mean |diff| is smallest at zero shift (0.0095), against 0.016–0.018 at ±1 km and 0.22–0.28 for flipud, fliplr or transpose. `macro.py ring_values` used as-is does not reproduce `ring[]` either (max 0.89), because it averages over the spacing window rather than 7 km.
* **geom.py G0 positions are not the bank's ring positions.** geom.py places the ring by great circle and then equirectangular projection, which is the frame the WMS truth grid is in. Its points sit up to 10.3 km from the bank's flat-polar positions at 380 km. The app's `samplesFromRing` also uses flat polar coordinates, so the app places its 380 km samples up to about 10 km from where they were fetched. 4 of G0's points (the cardinal 380 km ones, at 380.26–380.43 km) fall outside the ±380 km box and were dropped as instructed. `H_G0_nodrop` keeps them, which changes corr50 S by +0.004 [+0.002, +0.012].
* **The Barnes harness reproduces the app.** `H_REF_jsonring` (bank ring values at bank positions through `M.barnesGrid`) reproduces `.harness/macro/gate-final-dev.json` corr50Base in all 24 dev scenes (max |diff| < 1e-4; median 0.820). The 0.770 in the brief is the held-scene median, not the dev one. My two-pass Barnes copy, which accepts an external spacing, is bit-identical to `M.barnesGrid` when given `sampleSpacingKm` (max |diff| 0 over 25 jobs).
* **Orientation sanity passes under a working spacing rule.** For the G3 dense surrogate, corr50 against the truth is 0.999 (min 0.994) with the nn spacing rule, against flips between -0.25 and 0.13, so it passes > 0.9. With the app's literal `barnesGrid` it is 0.882 (min 0.760), which fails > 0.9. That failure comes from sigma inflation (next section), not orientation.
* **Where the H_REF 0.820 vs G0 0.796 gap comes from.** Corr50 medians: bank values at polar positions 0.820; my sampler at polar positions 0.823; my sampler at true positions 0.796; bank values placed at true positions 0.822. So the sampler is not the cause. The gap comes from which 7 km patches the points land on (the jitter results below quantify this). The per-scene paired difference has median −0.003 and SD 0.041.

## 2. The app's `barnesGrid` only works for exact rings

`macroField.sampleSpacingKm` groups samples by `Math.round(radius)` and sets each group's spacing to `2πr / count`. It works only when every ring shares one exact radius, as it does with `samplesFromRing`. With true-frame positions, even the current ring's 380 km points (radii 380.3–383.8 km) split into 1–3-point groups, giving spacing up to ~1200 km and sigma 700–2000 km. Lattices fare worse. For G1 the literal result is 0.766 at offset 0, where the radii are exactly symmetric, and about 0.50 at every 6 km shift. **Any non-ring geometry needs a new spacing rule (and a new `lambdaRes` source) before it can be used.** To isolate geometry, scenario **B_nn** gives every geometry the same rule: median distance to the 4 nearest samples, with a 2.5 km floor. On the current ring this rule is close to the app's (corr50 S 0.785 vs 0.789). Scenario **A_dropin** shows what happens today if a lattice is swapped in without changing the rule (rings keep the app rule computed on the nominal polar ring).

## 3. Results, B_nn (same Barnes rule for every geometry): medians over 24 scenes

Correlations are against the 3 km truth unless marked "vs LP" (the low-passed truth, i.e. what the model-like input actually contains). Cell counts are given for Seoul / Kanazawa (S/K) over all requested points. "app ms" is literal `M.barnesGrid` wall time (brute-force `lambdaRes` loop, plus reach inflated by bad sigma for lattices; the true current-ring cost is `H_REF` at 28 ms). "passes ms (nn)" is the two Barnes passes alone under the nn rule; the G0 value of 32 ms is a cold-JIT first job, and the same geometry warm (`H_G0_nodrop`) takes 16 ms.

| geometry | n pts (med) | 0.125° cells S/K | 0.25° cells S/K | dropped >380 S/K | corr50 S | M100 | M200 | M100 vs LP | corr12 S | vwMAE h2 S | h8 S | h2 M100 | h8 M100 | near≤100 S | far 200–380 S | app ms | passes ms (nn) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| G0_ring91 | 87 | 77/76 | 69/69 | 4/4 | 0.785 | 0.837 | 0.850 | 0.876 | 0.654 | 0.030 | 0.067 | 0.088 | 0.114 | 0.855 | 0.747 | 82 | 32 |
| G0c_ring91_cell | 73 | 77/76 | 65/67 | 0/3 | 0.784 | 0.845 | 0.854 | 0.877 | 0.587 | 0.032 | 0.067 | 0.086 | 0.113 | 0.840 | 0.753 | 92 | 16 |
| G4_ring24az | 171 | 149/140 | 121/124 | 4/4 | 0.845 | 0.920 | 0.922 | 0.944 | 0.739 | 0.032 | 0.064 | 0.089 | 0.113 | 0.863 | 0.846 | 100 | 14 |
| G1_uniform_ctr | 97 | 97/97 | 97/97 | 0/0 | 0.834 | 0.920 | 0.913 | 0.944 | 0.541 | 0.053 | 0.087 | 0.093 | 0.119 | 0.708 | 0.892 | 107 | 15 |
| G1a_uniform_anch | 82 | 84/82 | 84/82 | 0/0 | 0.823 | 0.902 | 0.906 | 0.928 | 0.409 | 0.051 | 0.095 | 0.080 | 0.120 | 0.667 | 0.865 | 137 | 18 |
| G2_clipmap_m2 | 94 | 95/107 | 79/86 | 13/13 | 0.631 | 0.707 | 0.747 | 0.745 | 0.732 | 0.030 | 0.064 | 0.087 | 0.113 | 0.884 | 0.659 | 102 | 12 |
| G2b_clipmap_m3 | 145 | 203/185 | 163/152 | 44/40 | 0.775 | 0.867 | 0.880 | 0.896 | 0.830 | 0.029 | 0.059 | 0.087 | 0.112 | 0.936 | 0.739 | 160 | 12 |
| G3_dense0125 | 3672 | 3795/3808 | 1015/1015 | 0/136 | 0.999 | 0.991 | 0.957 | 1.000 | 0.963 | 0.026 | 0.052 | 0.087 | 0.110 | 0.996 | 0.999 | 2678 | 22 |
| H_G0_nodrop | 91 | 77/76 | 69/69 | 0/0 | 0.789 | 0.865 | 0.867 | 0.890 | 0.654 | 0.030 | 0.067 | 0.088 | 0.114 | 0.855 | 0.797 | 68 | 16 |
| H_REF_jsonring | 91 | - | - | - | 0.820 | - | - | - | 0.657 | 0.030 | 0.069 | - | - | 0.871 | 0.810 | 28 | 16 |

### Paired difference vs G0_ring91, B_nn (median of per-scene differences [95% date-block bootstrap], scenes better/24)

| geometry | corr50 S | corr50 M100 | corr50 M200 | corr50 M100 vs LP | corr12 S | vwMAE h8 S (lower=better) | near≤100 S | far 200–380 S |
|---|---|---|---|---|---|---|---|---|
| G0c_ring91_cell | -0.002 [-0.013, +0.014] (11/24) | +0.005 [+0.002, +0.008] (18/24) | +0.004 [+0.002, +0.006] (19/24) | +0.005 [+0.002, +0.009] (19/24) | +0.004 [-0.034, +0.039] (13/24) | +0.000 [-0.002, +0.012] (10/24) | -0.012 [-0.043, +0.016] (11/24) | +0.003 [-0.009, +0.026] (14/24) |
| G4_ring24az | +0.058 [+0.034, +0.100] (21/24) | +0.075 [+0.043, +0.091] (24/24) | +0.060 [+0.026, +0.076] (24/24) | +0.066 [+0.038, +0.084] (23/24) | +0.070 [+0.012, +0.082] (18/24) | -0.001 [-0.004, -0.001] (19/24) | +0.024 [+0.012, +0.052] (21/24) | +0.061 [+0.036, +0.101] (23/24) |
| G1_uniform_ctr | +0.057 [+0.017, +0.083] (20/24) | +0.073 [+0.040, +0.081] (24/24) | +0.061 [+0.032, +0.068] (24/24) | +0.062 [+0.036, +0.074] (24/24) | -0.083 [-0.170, -0.018] (7/24) | +0.031 [+0.011, +0.043] (7/24) | -0.102 [-0.188, -0.027] (4/24) | +0.109 [+0.063, +0.143] (23/24) |
| G1a_uniform_anch | +0.030 [-0.004, +0.060] (15/24) | +0.056 [+0.030, +0.075] (22/24) | +0.046 [+0.026, +0.054] (22/24) | +0.052 [+0.028, +0.075] (21/24) | -0.165 [-0.261, -0.089] (4/24) | +0.026 [+0.003, +0.035] (7/24) | -0.135 [-0.229, -0.112] (6/24) | +0.087 [+0.042, +0.141] (22/24) |
| G2_clipmap_m2 | -0.093 [-0.136, -0.050] (6/24) | -0.054 [-0.130, -0.025] (2/24) | -0.056 [-0.102, -0.021] (2/24) | -0.055 [-0.133, -0.024] (2/24) | +0.029 [-0.008, +0.089] (15/24) | -0.001 [-0.004, +0.000] (16/24) | +0.019 [-0.016, +0.048] (13/24) | -0.107 [-0.219, -0.018] (6/24) |
| G2b_clipmap_m3 | +0.006 [-0.041, +0.024] (13/24) | -0.002 [-0.025, +0.021] (11/24) | +0.012 [-0.005, +0.031] (16/24) | -0.005 [-0.028, +0.019] (11/24) | +0.134 [+0.086, +0.208] (24/24) | -0.005 [-0.008, -0.001] (21/24) | +0.068 [+0.053, +0.108] (23/24) | -0.013 [-0.044, +0.003] (10/24) |
| G3_dense0125 | +0.214 [+0.150, +0.326] (24/24) | +0.152 [+0.097, +0.191] (24/24) | +0.107 [+0.064, +0.129] (24/24) | +0.124 [+0.077, +0.165] (24/24) | +0.237 [+0.148, +0.379] (23/24) | -0.017 [-0.022, -0.011] (23/24) | +0.107 [+0.081, +0.159] (24/24) | +0.252 [+0.157, +0.329] (24/24) |
| H_G0_nodrop | +0.004 [+0.002, +0.012] (16/24) | +0.006 [+0.004, +0.009] (17/24) | +0.007 [+0.005, +0.010] (20/24) | +0.006 [+0.003, +0.008] (17/24) | +0.000 [-0.000, +0.000] (14/24) | -0.000 [-0.000, -0.000] (17/24) | -0.000 [-0.000, +0.000] (10/24) | +0.008 [+0.001, +0.039] (16/24) |

### Sampling-lottery noise floor (B_nn): 6 fixed 6 km translations of each point set, truth fixed

| geometry | per-scene SD corr50 S | SD of 24-scene median S | jitter-mean corr50 S | paired vs G0 (jitter-mean) S | per-scene SD M100 | paired vs G0 (jitter-mean) M100 |
|---|---|---|---|---|---|---|
| G0_ring91 | 0.022 | 0.019 | 0.781 | - | 0.005 | - |
| G0c_ring91_cell | 0.020 | 0.020 | 0.772 | +0.002 [-0.000, +0.006] (16/24) | 0.005 | +0.002 [-0.001, +0.004] (14/24) |
| G4_ring24az | 0.015 | 0.009 | 0.849 | +0.055 [+0.035, +0.109] (22/24) | 0.003 | +0.067 [+0.043, +0.102] (24/24) |
| G1_uniform_ctr | 0.018 | 0.006 | 0.839 | +0.052 [+0.016, +0.075] (22/24) | 0.003 | +0.069 [+0.037, +0.081] (24/24) |
| G1a_uniform_anch | 0.023 | 0.006 | 0.822 | +0.023 [+0.002, +0.064] (17/24) | 0.003 | +0.051 [+0.026, +0.066] (21/24) |
| G2_clipmap_m2 | 0.031 | 0.019 | 0.637 | -0.072 [-0.140, -0.019] (3/24) | 0.009 | -0.054 [-0.129, -0.020] (2/24) |
| G2b_clipmap_m3 | 0.023 | 0.010 | 0.782 | -0.001 [-0.023, +0.019] (12/24) | 0.007 | -0.006 [-0.023, +0.018] (11/24) |

## 4. Results, A_dropin (current `barnesGrid` spacing rule, geometry swapped in as-is)

| geometry | n pts (med) | 0.125° cells S/K | 0.25° cells S/K | dropped >380 S/K | corr50 S | M100 | M200 | M100 vs LP | corr12 S | vwMAE h2 S | h8 S | h2 M100 | h8 M100 | near≤100 S | far 200–380 S | app ms | passes ms (nn) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| G0_ring91 | 87 | 77/76 | 69/69 | 4/4 | 0.789 | 0.839 | 0.850 | 0.875 | 0.655 | 0.031 | 0.068 | 0.087 | 0.115 | 0.854 | 0.752 | 82 | 32 |
| G0c_ring91_cell | 73 | 77/76 | 65/67 | 0/3 | 0.790 | 0.843 | 0.849 | 0.875 | 0.569 | 0.040 | 0.074 | 0.090 | 0.117 | 0.847 | 0.766 | 92 | 16 |
| G4_ring24az | 171 | 149/140 | 121/124 | 4/4 | 0.843 | 0.920 | 0.923 | 0.944 | 0.734 | 0.031 | 0.067 | 0.088 | 0.114 | 0.871 | 0.845 | 100 | 14 |
| G1_uniform_ctr | 97 | 97/97 | 97/97 | 0/0 | 0.766 | 0.789 | 0.787 | 0.843 | 0.440 | 0.237 | 0.256 | 0.268 | 0.281 | 0.557 | 0.812 | 107 | 15 |
| G1a_uniform_anch | 82 | 84/82 | 84/82 | 0/0 | 0.521 | 0.528 | 0.525 | 0.564 | 0.281 | 0.338 | 0.343 | 0.327 | 0.336 | 0.319 | 0.561 | 137 | 18 |
| G2_clipmap_m2 | 94 | 95/107 | 79/86 | 13/13 | 0.533 | 0.534 | 0.540 | 0.571 | 0.525 | 0.218 | 0.223 | 0.219 | 0.234 | 0.676 | 0.556 | 102 | 12 |
| G2b_clipmap_m3 | 145 | 203/185 | 163/152 | 44/40 | 0.613 | 0.599 | 0.627 | 0.652 | 0.547 | 0.222 | 0.228 | 0.229 | 0.235 | 0.703 | 0.643 | 160 | 12 |
| G3_dense0125 | 3672 | 3795/3808 | 1015/1015 | 0/136 | 0.882 | 0.873 | 0.851 | 0.912 | 0.542 | 0.272 | 0.279 | 0.272 | 0.281 | 0.692 | 0.879 | 2678 | 22 |
| H_G0_nodrop | 91 | 77/76 | 69/69 | 0/0 | 0.796 | 0.864 | 0.863 | 0.890 | 0.655 | 0.030 | 0.068 | 0.087 | 0.115 | 0.855 | 0.804 | 68 | 16 |
| H_REF_jsonring | 91 | - | - | - | 0.820 | - | - | - | 0.657 | 0.030 | 0.069 | - | - | 0.871 | 0.810 | 28 | 16 |

| geometry | corr50 S | corr50 M100 | corr50 M200 | corr50 M100 vs LP | corr12 S | vwMAE h8 S (lower=better) | near≤100 S | far 200–380 S |
|---|---|---|---|---|---|---|---|---|
| G0c_ring91_cell | -0.001 [-0.010, +0.010] (11/24) | +0.006 [+0.003, +0.008] (18/24) | +0.004 [+0.002, +0.006] (19/24) | +0.006 [+0.003, +0.009] (20/24) | +0.007 [-0.023, +0.038] (13/24) | +0.003 [+0.001, +0.011] (5/24) | +0.005 [-0.007, +0.021] (14/24) | +0.002 [-0.012, +0.021] (15/24) |
| G4_ring24az | +0.055 [+0.031, +0.090] (21/24) | +0.074 [+0.046, +0.099] (24/24) | +0.061 [+0.028, +0.079] (24/24) | +0.069 [+0.041, +0.087] (24/24) | +0.063 [-0.006, +0.085] (16/24) | -0.002 [-0.003, -0.001] (19/24) | +0.036 [+0.013, +0.058] (21/24) | +0.050 [+0.030, +0.091] (23/24) |
| G1_uniform_ctr | +0.002 [-0.021, +0.029] (12/24) | -0.038 [-0.064, -0.020] (1/24) | -0.061 [-0.069, -0.038] (0/24) | -0.031 [-0.054, -0.019] (4/24) | -0.181 [-0.295, -0.126] (2/24) | +0.168 [+0.117, +0.228] (0/24) | -0.222 [-0.325, -0.089] (4/24) | +0.037 [+0.024, +0.081] (20/24) |
| G1a_uniform_anch | -0.204 [-0.279, -0.132] (0/24) | -0.283 [-0.314, -0.170] (0/24) | -0.263 [-0.352, -0.169] (0/24) | -0.281 [-0.320, -0.171] (0/24) | -0.257 [-0.408, -0.193] (3/24) | +0.218 [+0.179, +0.286] (0/24) | -0.250 [-0.539, -0.120] (5/24) | -0.125 [-0.244, -0.081] (1/24) |
| G2_clipmap_m2 | -0.266 [-0.309, -0.231] (1/24) | -0.295 [-0.372, -0.229] (0/24) | -0.301 [-0.368, -0.230] (0/24) | -0.299 [-0.377, -0.234] (0/24) | -0.120 [-0.213, -0.079] (5/24) | +0.135 [+0.082, +0.173] (0/24) | -0.106 [-0.170, -0.061] (5/24) | -0.196 [-0.229, -0.134] (0/24) |
| G2b_clipmap_m3 | -0.193 [-0.288, -0.092] (3/24) | -0.238 [-0.294, -0.187] (0/24) | -0.230 [-0.296, -0.194] (0/24) | -0.240 [-0.308, -0.187] (0/24) | -0.103 [-0.175, -0.068] (5/24) | +0.142 [+0.076, +0.174] (0/24) | -0.069 [-0.145, -0.053] (6/24) | -0.149 [-0.236, -0.084] (2/24) |
| G3_dense0125 | +0.095 [+0.063, +0.129] (24/24) | +0.019 [+0.009, +0.046] (21/24) | -0.002 [-0.009, +0.005] (11/24) | +0.025 [+0.013, +0.058] (21/24) | -0.122 [-0.159, -0.078] (3/24) | +0.161 [+0.120, +0.233] (0/24) | -0.082 [-0.116, -0.031] (6/24) | +0.103 [+0.069, +0.145] (24/24) |
| H_G0_nodrop | +0.005 [+0.000, +0.009] (15/24) | +0.005 [+0.004, +0.009] (19/24) | +0.006 [+0.003, +0.009] (21/24) | +0.005 [+0.004, +0.009] (19/24) | -0.000 [-0.000, +0.000] (10/24) | -0.000 [-0.000, +0.000] (16/24) | -0.000 [-0.000, +0.000] (10/24) | +0.009 [+0.002, +0.029] (16/24) |

## 5. Point placement (depends only on site)

| geometry | requested S/K | kept S/K | 10° sectors at d≥130 km: min / median / max / empty (of 36) | nn spacing q10/q50/q90 km (Seoul) |
|---|---|---|---|---|
| G0_ring91 | 91/91 | 87/87 | 0 / 0.0 / 4 / 24 | 5/66/146 |
| G0c_ring91_cell | 77/76 | 77/73 | 0 / 0.0 / 4 / 19 | 18/68/181 |
| G4_ring24az | 175/175 | 171/171 | 0 / 3.0 / 4 / 12 | 4/47/99 |
| G1_uniform_ctr | 97/97 | 97/97 | 0 / 3.0 / 4 / 4 | 71/71/86 |
| G1a_uniform_anch | 84/82 | 84/82 | 0 / 2.0 / 4 / 2 | 75/75/95 |
| G2_clipmap_m2 | 95/107 | 82/94 | 0 / 1.0 / 2 / 14 | 12/41/104 |
| G2b_clipmap_m3 | 203/185 | 159/145 | 0 / 1.5 / 3 / 4 | 12/25/100 |
| G3_dense0125 | 3795/3808 | 3795/3672 | 62 / 91.0 / 147 / 0 | 12/12/12 |
| H_G0_nodrop | 91/91 | 91/91 | 0 / 0.0 / 4 / 24 | 5/67/185 |

## 6. What this says (exploratory)

1. **Under the same Barnes rule, density matters more than whether the layout is a ring or a lattice.**
   * **More azimuths on the ring (G4, 24 azimuths, 171 points, 140–149 unique 0.125° cells).** Apart from the G3 ceiling, this was the only geometry that improved on every axis: corr50 S +0.058 [+0.034, +0.100] (21/24 scenes), M100 +0.075 (24/24), corr12 +0.07, far +0.061, near +0.024.
   * **Observer-centred square lattice at 71 km (G1, 97 points).** It matches G4 on corr50 (+0.057; M100 +0.073) and wins far out (+0.109). But it loses where the viewer looks: near corr50 −0.102, corr12 −0.083, vwMAE h8 +0.031 worse.
   * **World-anchored 0.75° lattice (G1a, 82 points).** Same pattern, slightly weaker (corr50 +0.03, CI touches 0), and worse near the observer because it has no observer point.
2. **The nested clipmap with m=3 (G2b) is the near-field geometry.**
   * corr12 +0.134 [+0.086, +0.208] (24/24), near corr50 +0.068, vwMAE h8 −0.005. Overall and far corr50 tie G0 (+0.006 and −0.013, both n.s.).
   * Cost: 185–203 points requested, of which 40–44 fall outside the ±380 km box, so about 21% of requests are wasted.
   * m=2 (G2) is too coarse beyond 200 km (far −0.107, corr50 −0.093).
3. **Snapping the current ring to the 0.125° model lattice (G0c) costs nothing.** All paired differences are within ±0.01. It needs only 76–77 unique cells instead of 91 requests: the current ring already falls into 76–77 unique 0.125° cells and 69 unique 0.25° cells, so about 15–24% of today's requests land in a model cell already requested. This is the cheapest step towards coordinate-keyed (hashable) storage.
4. **What the viewer sees is limited by input resolution, not geometry.** With model-like inputs, vwMAE (h = 2 and 8 km) is about 0.11 (M100) and 0.17 (M200) for every geometry, and geometry moves it by ≤ 0.03 even against the low-passed truth. Real archived NWP rings scored corr50 0.563 against 0.770 surrogate (held set, §164), so a +0.05–0.07 geometry gain measured with perfect inputs is small next to forecast error. Its real-NWP value is not measured here.
5. **The dense lattice (G3, about 3800 points) is the ceiling.** It reaches corr50 0.999 (S) and 0.991 (M100); against the low-passed truth, the M100 reconstruction is 1.000. That is about 50× today's requests, and the literal `barnesGrid` takes 2.7 s, dominated by the brute-force `lambdaRes` loop.
6. **The FFT does not care about sample layout.** For every geometry, the macroField FFT runs on the regular 256 × 3 km Barnes output grid, never on the samples. A lattice's advantage is cache keying and incremental fetch when the observer moves, not FFT compatibility. That incremental-fetch benefit was not measured here.

## 7. Caveats

* n = 24 scenes in 13 date blocks from two nearby sites over one season, and many metrics with no multiplicity correction. Treat any interval that comes within about 0.02 of zero as unresolved, given the lottery noise above.
* The surrogate and M inputs have no forecast error; M is an isotropic Gaussian low-pass, which is not a real model's effective resolution or error structure.
* The sampler cannot reproduce the bank's 1 km ring values to within 0.01 (max 0.13), because sub-3 km structure is lost in the stored truth. This affects the S input at individual points (mean |diff| about 0.01) equally for every geometry.
* The nn spacing rule is exploratory, not the app's code. The A_dropin numbers show what the current code does instead.
* The far window is 200–380 km; `corr50_far200all` (the ≥ 200 km box corners included) is in the JSON.
