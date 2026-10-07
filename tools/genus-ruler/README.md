# 구름 종류별 형태 기준(§124)

문서 `docs/SKY_REBUILD_PLAN.md` §124 의 기준과 시제품을 다시 돌리는 데 필요한 것만 둡니다.
사진 파일과 모델 가중치는 넣지 않습니다(목록·주소만).

## genus/ — 참고 사진과 손 지표
- `harvest.js` — Wikimedia Commons 범주에서 사진 후보를 모아 `thumbs/{Cu,AcCc,Ci,StSc}/NNN.jpg` 로 받습니다.
  `genus-photos.json` 에 제목·범주·올린 사람·주소가 있습니다.
- `selection.json` — 사람이 거른 결과(번호 → 하늘 비율). 사진 170장(Cu 51 · AcCc 59 · Ci 29 · StSc 31).
- `metrics.js` — 손 지표 6개. 사진·렌더에 같은 함수를 씁니다. 종류를 0.40 만 맞혀 참고용입니다.
- `skyratio.js` — 구름 밝은 쪽(p90)·어두운 쪽(p10) ÷ 맑은 하늘 중앙값(§124.4).
- `RULER.md` — 재기 전에 고정한 합격 조건과 대조군 결과. `final-ruler.txt` — 최종 판정 출력.

## clip/ — 판정기(CLIP ViT-L/14 제로샷)
- 모델: Hugging Face `Xenova/clip-vit-large-patch14` 의 `onnx/vision_model_quantized.onnx`,
  `onnx/text_model_quantized.onnx`, `tokenizer.json` 을 이 폴더에 받습니다.
- 파이썬: `onnxruntime tokenizers numpy pillow`.
- `prompts.json`·`judge.py` 는 고치지 않습니다(sha256 앞 16자 `224ed488a916e949`·`93fae07c6281fd20`, RULER.md 에 기록).
- `photos.py` → 사진 임베딩, `evalphotos.py` → 사진 적중률, `ruler.py "Cu=../proto/fCu-{az}.png" …` → 판정.

## proto/ — 웹 시제품(takram + 종류별 모형)
- `genus.js` 가 앱 `src/components/VolumetricProbe/cloudGenus.ts` 와 같은 계산입니다(날씨 바이트 대조 0 차이).
- `main2.js` 를 esbuild 로 `www/app2.js` 로 묶고, takram 자산(`assets/`)과 함께 `www/` 를 띄웁니다.
- `PAGE=index2.html node shoot.js "<쿼리>" out.png` — 쿼리 `gL/gM/gH`(층별 종류), `go`(손잡이 JSON), `tm`, `ev`, `w/hpx`.
- `gbatch.sh`(정식 390×584) · `xbatch.sh`(탐색 195×292) — 방향 3개(200°·110°·20°)를 한 번에.

## volsky/ — 볼륨 하늘 측정 하네스(§127)
- `entry.ts` 가 **앱의** `src/components/VolumetricProbe/volumetricScene.ts` 를 그대로 묶습니다(시제품 `proto/` 와 달리 따로 베낀 계산이 없음).
  출력은 하늘 화면과 같은 길(`renderToTexture` → sRGB 부호화 복사, 알파 = 구름 불투명도).
- 묶기: `npx esbuild tools/genus-ruler/volsky/entry.ts --bundle --format=esm --outfile=.harness/volsky/app.js --define:__DEV__=false --define:process.env.EXPO_PUBLIC_VOLUMETRIC_SKY='"1"'`
- `run.js jobs.json outDir [w h] [load|gen] [spectral=0] [efft=0]` — 한 페이지에서 장면을 이어 그립니다. `load` 는 takram 의 미리 만든 대기 표
  (3파장)를 읽어 빠르지만 앱(§128 15파장 분광 표 + 유효 투과율)과 다릅니다 — 앱과 같은 색은 `gen`. `spectral=0`·`efft=0` 은 견주기용.
  잡은 `{ name, input, frames, quality, res, options, out: rgb|alpha|both|direct, terrain?, views? }`(`entry.ts` 머리말).
- `composer-check.ts` — 합성기의 천체 가리기·지형 앞 구름 판정(손으로 만든 장면). `governor-check.js` — 해상도 자동 조절 판정.
- `repro-shot.js` — 앱 하늘 화면(web-repro)을 장면 하나씩 찍기.
- `genus/exposure-ruler.js`(노출 자) · `genus/sunset-peak.js`('가장 붉은 곳의 색', §122.2 다시 씀) · `genus/twilight-hue.py`(박명 자주·푸른
  비율, §128) · `genus/terrain-lit.py`(땅/하늘 밝기·땅 색, §129) · `genus/ridge-ratio-geo.js`(해 쪽 능선 비, DEM 참 능선) · 자:
  `genus/RULER-exposure.md`, `RULER-cover.md`, `RULER-sunset-genus.md`, `RULER-twilight-hue.md`, `RULER-sc-low.md`, `RULER-terrain-lit.md`.
- 웹 앱 하네스(`tools/web-repro`)는 §129 부터 DEM 지형을 그립니다. `#{"talb":[r,g,b]}` 로 볼륨 경로의 지형 알베도를 바꿔 볼 수 있습니다.
- CLIP 가중치는 `clip/` 에 받아 쓰고 넣지 않습니다(.gitignore).

## flow/ — 대기 흐름 구름 모형 자(§130)
- `RULER-flow.md`(렌더 전에 고정) · `fm.py`(측면 지표, 사진 사분위 `photo-flow-quartiles.json`) · `tile-gen.mjs` + `tile.py`(위에서 본 타일 자, GPU 없음)
  · `flow-core-test.mjs`(cloudFlow.ts 단위 테스트) · `make-jobs.mjs`(volsky 잡). 자세한 것은 `flow/README.md`.
