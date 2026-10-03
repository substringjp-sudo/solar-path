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
