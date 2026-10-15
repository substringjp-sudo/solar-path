# RULER-physics 판정 출력 전문 (2026-10-14)

`bash tools/genus-ruler/flow/eval-phys.sh <P0·P1·P2 렌더 폴더>` 의 출력 그대로. 해석은 `docs/SKY_REBUILD_PLAN.md` §136.4~136.6.

```
=== R1·R2·G4 (phys.py) ===
P0   ac     AcCc  brightRatio 4.867 ○  darkRatio 2.864 ×  pieceLogSD 0.191 ○  cf 0.855
P0   as     As      cf 0.960
P0   ci     Ci    brightRatio 2.787 ○  darkRatio 1.262 ○  pieceLogSD 0.288 ○  cf 0.179
P0   cu     Cu    brightRatio 4.586 ○  darkRatio 1.451 ○  pieceLogSD nan —  cf 0.521
P0   halo   ?       cf 0.998
P0   ns     Ns      cf 1.000
P0   sc25   StSc  brightRatio 3.235 ○  darkRatio 1.443 ×  pieceLogSD 0.144 ×  cf 0.336
P0   sc85   StSc  brightRatio 3.685 ○  darkRatio 1.050 ○  pieceLogSD nan —  cf 0.795
P0   st     St      cf 0.985
P0   합계  R1 8/10  R2 2/3  D 2.61 (n 10)
P1   ac     AcCc  brightRatio 4.851 ○  darkRatio 3.282 ×  pieceLogSD 0.175 ○  cf 0.848
P1   as     As      cf 0.945
P1   ci     Ci    brightRatio 2.904 ○  darkRatio 1.272 ○  pieceLogSD nan —  cf 0.003
P1   cu     Cu    brightRatio 4.659 ○  darkRatio 1.750 ○  pieceLogSD nan —  cf 0.516
P1   halo   ?       cf 0.990
P1   ns     Ns      cf 1.000
P1   sc25   StSc  brightRatio 3.310 ○  darkRatio 1.935 ×  pieceLogSD 0.154 ○  cf 0.327
P1   sc85   StSc  brightRatio 3.773 ○  darkRatio 2.073 ×  pieceLogSD nan —  cf 0.777
P1   st     St      cf 0.983
P1   합계  R1 7/10  R2 2/2  D 4.04 (n 10)
P2   ac     AcCc  brightRatio 4.885 ○  darkRatio 3.260 ×  pieceLogSD 0.229 ○  cf 0.848
P2   as     As      cf 0.945
P2   ci     Ci    brightRatio 2.925 ○  darkRatio 1.901 ○  pieceLogSD nan —  cf 0.003
P2   cu     Cu    brightRatio 4.698 ○  darkRatio 1.745 ○  pieceLogSD nan —  cf 0.515
P2   halo   ?       cf 0.990
P2   ns     Ns      cf 1.000
P2   sc25   StSc  brightRatio 3.310 ○  darkRatio 1.952 ×  pieceLogSD 0.154 ○  cf 0.327
P2   sc85   StSc  brightRatio 3.773 ○  darkRatio 2.073 ×  pieceLogSD nan —  cf 0.777
P2   st     St      cf 0.983
P2   합계  R1 7/10  R2 2/2  D 4.45 (n 10)

운량 면적(cloudFrac) 기준 P0 대비 상대 변화:
  P1   ac -1%  as -2%  ci -98%  cu -1%  halo -1%  ns +0%  sc25 -3%  sc85 -2%  st -0%
  P2   ac -1%  as -2%  ci -99%  cu -1%  halo -1%  ns +0%  sc25 -3%  sc85 -2%  st -0%
wrote /tmp/claude-0/-home-user-solar-path/827aa702-2f52-52c8-9fe8-e45a3ff14759/scratchpad/s1/EVAL/phys-gate.json

=== R3 (fm.py density 군: st·as·ns·sc85) ===
P0  st    density 실패 2/4  shadeRange 0.741 [0.258, 0.647] ×  logIQR 0.205 >= 0.196 ○  darkFrac 0.000128 >= 0.0259 ×  edgeWidthPx 4.42 >= 1.82 ○
P1  st    density 실패 3/4  shadeRange 0.719 [0.258, 0.647] ×  logIQR 0.14 >= 0.196 ×  darkFrac 0.00098 >= 0.0259 ×  edgeWidthPx 4.85 >= 1.82 ○
P2  st    density 실패 3/4  shadeRange 0.719 [0.258, 0.647] ×  logIQR 0.14 >= 0.196 ×  darkFrac 0.00098 >= 0.0259 ×  edgeWidthPx 4.85 >= 1.82 ○
P0  as    density 실패 1/4  shadeRange 0.354 [0.319, 0.529] ○  logIQR 0.5 >= 0.316 ○  darkFrac 0.0313 >= 0.0298 ○  edgeWidthPx 0.734 >= 43.9 ×
P1  as    density 실패 4/4  shadeRange 0.655 [0.319, 0.529] ×  logIQR 0.176 >= 0.316 ×  darkFrac 0 >= 0.0298 ×  edgeWidthPx 2.17 >= 43.9 ×
P2  as    density 실패 4/4  shadeRange 0.655 [0.319, 0.529] ×  logIQR 0.176 >= 0.316 ×  darkFrac 0 >= 0.0298 ×  edgeWidthPx 2.17 >= 43.9 ×
P0  ns    density 실패 2/3  shadeRange 0.613 [0.197, 0.567] ×  logIQR 0.249 >= 0.247 ○  darkFrac 1.68e-05 >= 0.0111 ×
P1  ns    density 실패 3/3  shadeRange 0.826 [0.197, 0.567] ×  logIQR 0.112 >= 0.247 ×  darkFrac 0 >= 0.0111 ×
P2  ns    density 실패 3/3  shadeRange 0.826 [0.197, 0.567] ×  logIQR 0.112 >= 0.247 ×  darkFrac 0 >= 0.0111 ×
P0  sc85  density 실패 1/4  shadeRange 0.285 [0.172, 0.439] ○  logIQR 0.836 >= 0.401 ○  darkFrac 0.104 >= 0.0463 ○  edgeWidthPx 1.73 >= 3.22 ×
P1  sc85  density 실패 3/4  shadeRange 0.525 [0.172, 0.439] ×  logIQR 0.394 >= 0.401 ×  darkFrac 0.0049 >= 0.0463 ×  edgeWidthPx 3.65 >= 3.22 ○
P2  sc85  density 실패 3/4  shadeRange 0.525 [0.172, 0.439] ×  logIQR 0.394 >= 0.401 ×  darkFrac 0.00492 >= 0.0463 ×  edgeWidthPx 3.65 >= 3.22 ○
P0  R3 실패 합 6/15
P1  R3 실패 합 13/15
P2  R3 실패 합 13/15

=== H 무리 (halo 장면) ===
P0_halo_0.png {"E22": 1.0153, "L22": 0.5524, "Lin": 0.5879, "Lout": 0.5002, "redInner": 1.0171}
P1_halo_0.png {"E22": 1.0189, "L22": 0.4691, "Lin": 0.5007, "Lout": 0.4202, "redInner": 1.0347}
P2_halo_0.png {"E22": 1.0696, "L22": 0.8457, "Lin": 0.8218, "Lout": 0.7595, "redInner": 1.0457}

=== G2 박명 색 ===
P0_tw1734.png                자주 0.09  푸른 0.92  L [0.0793, 0.0976, 0.1184]  밝은 [128, 118, 142] 어두운 [60, 60, 90]
P1_tw1734.png                자주 0.09  푸른 0.92  L [0.0775, 0.0962, 0.1213]  밝은 [131, 121, 144] 어두운 [61, 62, 94]
P2_tw1734.png                자주 0.09  푸른 0.92  L [0.0775, 0.0962, 0.1213]  밝은 [131, 121, 144] 어두운 [61, 62, 94]
P0_tw1746.png                자주 0.07  푸른 0.95  L [0.0114, 0.0167, 0.0211]  밝은 [60, 59, 82] 어두운 [16, 16, 39]
P1_tw1746.png                자주 0.07  푸른 0.95  L [0.0115, 0.0166, 0.0221]  밝은 [61, 60, 85] 어두운 [16, 17, 41]
P2_tw1746.png                자주 0.07  푸른 0.95  L [0.0115, 0.0166, 0.0221]  밝은 [61, 60, 85] 어두운 [16, 17, 41]

=== G1 CLIP J1 (AcCc·Ci) ===
-- P0
AcCc 판정[Cu,Cu,Cu] 자기확률 0.11(문턱 0.21, 사진적중 0.66) J1 불합격
Ci  판정[Ci,AcCc,Ci] 자기확률 0.19(문턱 0.38, 사진적중 0.86) J1 불합격
-- P1
AcCc 판정[Cu,Cu,Cu] 자기확률 0.17(문턱 0.21, 사진적중 0.66) J1 불합격
Ci  판정[St,St,St] 자기확률 0.08(문턱 0.38, 사진적중 0.86) J1 불합격
-- P2
AcCc 판정[Cu,Cu,Cu] 자기확률 0.17(문턱 0.21, 사진적중 0.66) J1 불합격
Ci  판정[Cs,AcCc,Ci] 자기확률 0.15(문턱 0.38, 사진적중 0.86) J1 불합격
```
