# 대기 흐름 구름 모형 자(§130)

`RULER-flow.md` 가 자(렌더 전에 고정)이고, 나머지는 그것을 재는 도구입니다. python3 + numpy + PIL, node 22 만 씁니다.

- `flow-core-test.mjs` — `cloudFlow.ts` 단위 테스트(FFT 왕복·Poisson 잔차·라벨맵 면적 보존·quantileHist == 정렬·결정론·주기 이음새·시간·연기 장면).
  `node tools/genus-ruler/flow/flow-core-test.mjs`
- `tile-gen.mjs` — 앱 `cloudGenus.ts`(+`cloudFlow.ts`)를 묶어 날씨 타일의 층별 d 채널 PNG 를 냅니다(GPU 없음). `jobs-tile.json` 참고.
  `node tools/genus-ruler/flow/tile-gen.mjs tools/genus-ruler/flow/jobs-tile.json out/ [--seeds 7,1007,2007,3007]`
- `tile.py` — 위에서 본 타일 자(T0~T5·T8). `python3 tools/genus-ruler/flow/tile.py --tile-km 24 --out out/tile.json out/*.png`
- `fm.py` — 측면(사진·렌더) 지표. `--photos` 로 사진 사분위(`photo-flow-quartiles.json`, fm.py 해시를 품음), `--renders DIR` 로 volsky 출력,
  `--gate quartiles.json renders.json` 로 ○/× 표와 불만 군별 실패 수.
- `make-jobs.mjs` → `jobs-flow.json`(C0–C3 × 5 장면 × 3 방위)·`jobs-flow-guards.json`(박명 가드). 돌리기:
  `node tools/genus-ruler/volsky/run.js tools/genus-ruler/flow/jobs-flow.json out/ 390 584 gen` (번들은 먼저 다시 묶을 것 — volsky/run.js 머리말).
- 가드: CLIP `clip/ruler2.py`, cu 밝기비 `genus/skyratio.js`, 박명 색 `genus/twilight-hue.py`.
