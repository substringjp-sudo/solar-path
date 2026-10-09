# 조사 측정 스크립트(`docs/FLOW_CHEAP_MATH_SURVEY.md`)

조사서의 "실측" 수치를 낸 스크립트입니다. 자(RULER)가 아니라 후보 검증용이라 사전 등록 대상이 아닙니다. node 22 · python3 + numpy.

`verify-turb/`·`verify-numerics/` 는 앱 `cloudFlow.ts` 를 CJS 로 묶은 `verify-turb/cloudFlow.cjs` 를 읽습니다(저장소에 넣지 않음). 먼저:

```
npx esbuild src/components/VolumetricProbe/cloudFlow.ts --bundle --format=cjs --platform=node \
  --outfile=tools/genus-ruler/flow/survey/verify-turb/cloudFlow.cjs --log-level=warning
```

- `verify-turb/ftle-check.mjs` · `cost-check.mjs` — ∇D 변형률·FTLE·det J 산포(A3·A9), 비용.
- `verify-numerics/check.mjs` · `timing.mjs` — 반라그랑주 걸음 수·psiEvery 변형(A16), 합성 인라인 비용.
- `verify/bench-mf.mjs` · `fif-check.mjs` — 로그정규 캐스케이드 비용·첨도, 분수 적분 H 와 조각 수(A5·A6).
- `verify-patterns/{open-cell,lut-check,ent10,sh-vis}.mjs` — 열린 세포 레짐(A1), d 사상표(A4), 엔트로피, Swift–Hohenberg 시각화.
- `verify-texture/{iaaft,phasor,hpb}.mjs` · `ps_metric.py` — IAAFT·페이저 잡음(A15)·히스토그램 보존 블렌딩·Portilla–Simoncelli 축소 통계(A18).
- `verify-perc/{bandlimit,ridged,ridged2}.mjs` — 대역 제한·릿지 항(기각 근거).
- `verify-gfx/bench-gfx.mjs` · `bench-patterns.mjs` · `bench-ca.mjs` · `bench.js` — 그래픽스·패턴 PDE·세포자동자 비용.
