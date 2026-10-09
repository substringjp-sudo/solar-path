# 흐름 구름 모형 — 계산을 깎으면서 그럴듯한 결과를 내는 수학·알고리즘 조사 (2026-10-08)

> "더 가기 전에, 계산을 줄이면서도 결과가 맞아 보이는 수학 이론과, 긴 계산을 훨씬 싼 값에 근사하는 단순화 알고리즘도 찾아 보자."
> 대상: `SKY_REBUILD_PLAN.md` §130(10785행~) 의 흐름 모형(`cloudFlow.ts`·`cloudGenus.ts`·`cloudFlowShader.ts`), 자 `tools/genus-ruler/flow/RULER-flow.md`·`fm.py`·`tile.py`.
> 방법: 7 각도(난류 축소모형·다중프랙탈·수치법·그래픽스·패턴형성·질감 통계·지각)로 후보 ~75 개를 훑고, 각 후보를 적대 검증
> (비용은 node 22 에서 실측, 효과는 실제 흐름 핵 번들 위에서 4 씨앗 측정, '이미 있음'은 코드 대조). 조사·검증 원문은 세션 스크래치(`flow/survey/sweep-*.md`·`verify-*.md`), 측정 스크립트는 `tools/genus-ruler/flow/survey/`.
> 폰 환산: Hermes ≈ node × 3~5(형 배열 루프) · × 5~10(초월함수 루프). 타일 예산 100~300 ms 중 흐름 핵 20 + 합성 60 ms 는 이미 씀.
> 검토(2026-10-08 완전성 비평, §7): 비용 수치를 재실행(`verify/bench-mf.mjs`·`verify-numerics/timing.mjs`)하니 ±25 % 안(캐스케이드 256² 11.8 → 13.5 ms, 피라미드 9.4 → 12.2, 핵 20×90 16.3 → 16.1~18.0, 10×180 11.9 → 11.6~13.8, 합성 인라인 22.4 → 18.4) — 표의 node ms 는 **±25 %** 로 읽을 것. 출처 8건을 원문·서지로 재검증해 §6 에 반영(틀린 수치 1건: Nubis 슬라이드 번호; 혼동 1건: Wood & Field 길이/면적 지수; 비주장 1건: '2°').

## §1 한 줄 결론과 지도

**결론**: 지금 실패하는 게이트(sc 병합 largestFrac 0.33~0.40 · 박명 검은 덮개 · cu areaCV · ac 밀도 logIQR 0.26 · CLIP Cu 편향)는 **동역학을 더 돌려서가 아니라
(a) 이미 있는 라벨맵의 후처리, (b) 템플릿의 위상(열린 세포)·크기 법칙, (c) 순위→d 사상표, (d) 카메라 자리·판정기 교체**로 거의 0 ms 에 움직입니다.
파이프라인의 두 불변성이 후보 절반을 잘랐습니다: ① `rankNormalize`(d = 구름 내 순위²)·`quantileHist` 는 f 의 단조 사상에 불변 → **어떤 생성기도 d 히스토그램을 못 바꾸고 기하만 바꿈**;
② 2-D 비발산 흐름이라 det(∇X) ≡ 1 → 측정된 det J 산포(0.11~2.18)는 반라그랑주 보간 오차이지 수렴이 아님.

| # | 이름 | 출처 | 무엇을 싸게 | 우리 격자 비용(실측) | 겨냥 불만/지표 | 꽂는 자리 | 이미 있음? | 순위 |
|---|---|---|---|---|---|---|---|---|
| A1 | 열린 세포 레짐(벽 = 구름, 꼭짓점 두꺼움) + 열린 세포 주머니 | Agee 1987; Feingold et al. 2010 Nature | MCC 열린/닫힌 레짐을 Voronoi d1·d2·d3 비교로 | ~1 ms(d3 비교 + 65k exp) · 셰이더 0 | 3·4·6·5 / largestFrac·quad12km·perimPerArea·shadeRange | `FIELDS.sc`(openness, spacingKm 5~8) + `GENUS_FLOW.sc` wT 1.0/wQ 0.5 | × (닫힌 F2−F1 만) | **1** |
| A2 | 카메라 칸 조건화(주기 타일 uv 오프셋으로 관측점을 중앙값 칸에) | Freeman & Simoncelli 2011(검증, 풀링 창 ∝ 이심률); §130.6 덮개 블로커 | 박명 검은 덮개를 바이트 변경 없이 | < 1 ms(64² 적분영상) · 샘플 0 | 3·5 / 지평선 띠 하늘 비율(신설)·박명 가드 | 타일 CPU(문턱 뒤) → `localWeatherOffset`/genusDrift 레인 유니폼 | × | **2** |
| A3 | 변형 게이트 지평(라벨맵 = 역방향 흐름맵, 왜곡 기준 정지) | Qu et al. 2019 BiMocq²; Zhou et al. 2024 PFM; Staniforth & Côté 1991 | 장면별 의사시간을 0.5 h 고정 대신 s90 으로 | 0.09 ms/검사 | 3·4·5 / elongIQR ≤ 3(대리석 가드)·coh20 | `flowCoreSteps` 조기 종료, `FlowCore.distortion/hoursUsed` | 맵·lag ○, 게이트 × | **3** |
| A4 | 통계 구름 스킴 PDF 를 d 사상표로(Beta 혼합 LUT) | Sommeria & Deardorff 1977; Tompkins 2002; Wood & Hartmann 2006 | 순위→d 를 4096 LUT 로 | < 1 ms/층 · 셰이더 0 | **6** / logIQR·darkFrac·bimod·shadeRange | `rankNormalize` | 부분(rank² = Beta(½,1) 분위) | **4** |
| A5 | 분수 적분 H(FIF) — 윤곽 차원 D = (3−H)/2 | Schertzer & Lovejoy 1987; Kondev & Henley 1995 PRL; Wood & Field 2011 | q0 의 H 1 → 0.3 을 두 숫자 + fft2 128² 로 | 0.9 ms node(fft2 128²) / 피라미드 256² 9.4 ms | 3·4 / areaCV·elongIQR·nPer100km²·D 1.35·T1 | `FLOW_DEFAULTS` qPow 2→1.3, kq 12→64~128, `FlowCore.qN` 128 | 부분(qPow 가 가우스 FIF) | **5** |
| A6 | 로그정규 곱셈 캐스케이드 q0(결정 항목의 매개변수·수정) | Mandelbrot 1974; Schertzer & Lovejoy 1987 | FFT 없이 옥타브 값잡음 합 + exp 1회 | 128² ~3 ms node / 10~30 ms Hermes · 256² 12 ms node | 3·4(·6 군집) / pieces·areaCV·quad12km | `flowCoreSteps` 3단계 교체 | × (가우스 H=1) | **6** |
| A7 | 해석적 매크로 기압장(세계좌표 비주기 문턱 변조) | Schneider & Vos 2015 날씨맵 관행(기억); Wood & Hartmann 2006 10~50 km 분산 봉 | 24 km 반복을 코사인 2개로 | 12~18 ALU/샘플(코사인 2개) · CPU 0 | 5·3 / quad12km·박명 덮개·largestFrac(방향 미정) | `cloudFlowShader.ts` S4 fetch 뒤 + 초당 유니폼 | × | **7** |
| A8 | 파우더/내산란 델타(기둥 d 인수·바닥 띠·시야 게이트·해고도 페이드) | Schneider & Vos 2015; Schneider 2017 slides 84–92; Wrenninge et al. 2013; Hillaire 2016 | 다중산란 대리를 pow 1개·remap 2개로 | 3~4 ALU/샘플 · fetch 0 | **6** / darkFrac·logIQR·shadeRange | takram `clouds.frag:582` POWDER 줄(두 패스) | ○ 대부분(powder 0.8/150, 8옥타브 MS, 쌍로브 HG) | **8** |
| A9 | FTLE 능선 σ̂(x) 합성 항(det J 는 기각) | Haller 2001(기억); Shadden, Lekien & Marsden 2005 Physica D(검증) | 수렴선을 D 의 중심차분 + 2×2 고유값으로 | 2~5 ms(64²) + fetch 5~15 ms node / 15~45 ms 폰 | 3·5 / largestFrac(sc25·ci)·coh20 | `flowComposeSteps` `+ wL·σ̂(x)`, `FlowLayerWeights.wL` | × (D 는 있음) | **9** |
| A10 | CLIP 이미지 k-NN(+ DISTS 특징 거리) | Zhang et al. 2018 LPIPS; Ding et al. 2020 DISTS | 캡션 편향을 임베딩 캐시 재사용으로 | 자 전용 0 ms(k-NN) · DISTS 0.1~0.2 s/장 | 4·6 / CLIP J1 가드 | `clip/ruler2.py` | 텍스트 프롬프트 0-shot | **10** |
| A11 | 둘레–면적 D 게이트 측정 규칙(결정 항목 구체화) | Lovejoy 1982 Science; Benner & Curry 1998; Kondev & Henley 1995 | H 선택을 한 숫자로 검증 | 자 전용 < 1 s/타일 | 3·4 / D ∈ [1.25,1.45], 예측 (3−H)/2 병기 | `tile.py` | 부분(areaPowExp·perimPerArea) | **11** |
| A12 | Plant–Craig 플룸 앙상블 + Neyman–Scott 군집 + 로그정규 크기(cu) | Plant & Craig 2008 JAS; Neyman & Scott 1958; Lewis 1989 희소 합성곱 | 격자 배치 → 점과정 + Exp×lognormal 크기 | 표본 < 1 ms · 래스터 ≈ 지금(256² ~100 ms node) | 4·3·1 / cu areaCV·largestFrac·elongIQR | `cells()`·`FIELDS.cu/cg/cb` | 부분(지터 격자 + s^skew) | **12** |
| A13 | 에너지 조건 템플릿 진폭(웨이블릿 난류의 '어디에' 만) | Kim, Thürey, James & Gross 2008 TOG | 변형률 장으로 템플릿 진폭 변조 | 0~15 ms node(A9 fetch 재사용 시 0) | 4 / areaCV·elongIQR(sc·ac) | `flowComposeSteps` `wT·(1+wE·ê(x))·T` | cu 만 ○(env 세포 크기) | **13** |
| A14 | Lamb–Oseen 소용돌이 덩이(속도에만) | Christiansen 1973 JCP; Selle, Rasmussen & Fedkiw 2005 | 간헐적 ζ₀ 를 exp K개로 | 0.1 ms 1회 | 3·5 / coh20·중간 크기 조각 | `flowCoreSteps` 1단계(Z0 에만, Z0n/q0 제외) | × | **14** |
| A15 | 스펙트럼 페이저 잡음 전단파(휘고 갈라지는 롤) | Tricard et al. 2019 TOG; Gilet et al. 2014 TOG | 커널 합 대신 좁은 띠 RPN + atan2 | 1.3~6 ms node(64²/128²) | 4·5 / elongIQR·undulatus 외형 | `flowComposeSteps` `cos(Φ(X))`, `FlowCore.phi` | 부분(코사인 1개를 X 로 휨) | **15** |
| A16 | 반라그랑주 10 × 180 s, Poisson 매 걸음 | Stam 1999(기억); Staniforth & Côté 1991 MWR | 걸음 수와 ψ 갱신 수를 분리 | 16.3 → 11.9 ms node(−27 %) | — (T6 시간만) | `FLOW_DEFAULTS` steps 10, psiEvery 1 | 반라그랑주 ○, 레짐 × | **16** |
| A17 | Nubis 층 내 종류장(CPU 템플릿 혼합) | Schneider & Vos 2015; Schneider 2017 | 종류 채널 → 64² τ(X) 로 wT 공간 변조 | 0.3 + 7~14 ms node | 4 / elongIQR·areaCV·perimPerArea | `flowComposeSteps` `wT·τ(X)·T` | 부분(층별 mode, sc sheet 상수) | **17** |
| A18 | Portilla–Simoncelli 교차 스케일 통계(축소 ~20개)를 자로 | Portilla & Simoncelli 2000 IJCV | 판정기 아닌 통계로 '뭉개짐 vs 구조' | 자 전용 184 ms/장 numpy | 3·4 / 교차 스케일 |B| 상관·대역 첨도 ≥ 8 px | `fm.py` | × | **18** |
| A19 | Hogan–Kew 옥타브별 전단 비등방 | Hogan & Kew 2005 QJRMS(원문 검증) | 미세 옥타브에만 전단축 늘림 | 0 패스(스펙트럼 가중) | 3·5 / hBand·orientRatio(ci·cs·sc) | A6 의 fft2 경로 가중 (|k_∥|/k_o)^((μ1−μ2)/2), l ≥ 4 | 부분(ψ₀ aniso, ci stretch) | **19** |
| A20 | KH/중력파 파장 규칙 + 유한 패킷 포락선 | Miles 1961; Howard 1961; Smyth 2004; Scorer 1949 | λ = 7·Δz, 감싼 가우스 패킷 | 5~8 ms node / 15~40 ms 폰 | 3·4 / hBand·elongIQR(전단 장면만) | `flowComposeSteps` 파 항, `waveVectorFor` | 부분(온셋·k_w·flowWaveKm·tilt) | **20** |
| A21 | 웨이블릿 난류 256² 격자 컬 업레스(변형률 게이트) | Kim et al. 2008 TOG | 3 옥타브 스칼라 ψ_f + 격자 FD 컬 | ~20~25 ms node / 100~200 ms Hermes | 4 / elongIQR·areaCV(cu·sc25)·T1 여유 | 흐름 핵 뒤·합성 전, +2 bilinear | × (D 는 k ≤ 8) | **21** |
| A22 | 오프라인 예시 퀼팅(위성 반사도 → 주기 템플릿 PNG) | Efros & Leung 1999; Efros & Freeman 2001 | 실제 세포 위상을 번들 PNG 로 | 런타임 0 · +50~100 KB/속 | 4·3 / areaCV·perimPerArea(T 지배 층만) | `FIELDS[g]` useFlow 분기 | × | **22** |

순위 = (실패 게이트에 측정·예측된 이득) / (폰 ms + 구현 위험). A1~A4 는 0~1 ms 에 블로커를 직접 침. A5·A6 은 이미 결정된 2회차(§5). A7·A8 은 셰이더 쪽 유일 생존자.
A9~A15 는 측정은 됐으나 자 지표 연결이 간접. A16~A22 는 공짜거나 조건부(전단 장면 필요·예산 상단·파이프라인 선행).

## §2 원리 묶음 — 왜 싼가, 무엇은 못 하나

**P1 순위·분위수 불변성(통계만 맞추면 된다의 반대쪽)** — A4·A11·A18. th = quantile(f, 1−cover)·d = rank² 는 단조 사상에 불변이므로 d 의 분포(T3·logIQR 의 pdf 몫·bimod)는
생성기가 아무리 바뀌어도 고정입니다. 거꾸로 d 분포를 바꾸는 유일한 자리는 `rankNormalize` 의 사상표 한 줄(A4, < 1 ms)이고, 생성기는 **마스크 기하와 높은 d 의 공간 군집**만 책임집니다.
못 하는 것: LUT 의 발끝(u→0 기울기)이 T4 상승길이를 정하므로 Beta(0.5,·) 성분 ≥ 0.55 를 지켜야 함(측정: 후보 원안 혼합은 T3·T4 모두 실패).

**P2 라그랑주 라벨 한 번 굴린 것의 부산물** — A3·A9·A13·A14·A16. D = x − X 는 역방향 흐름맵이라 ∇D 의 중심차분(64², 0.09~5 ms)으로 변형률·FTLE·왜곡 분위수가 공짜로 나옵니다.
동역학을 더 돌리지 않고 '이미 굴린 결과'를 읽는 것이라 폰에서 0 에 가깝습니다. 측정: 현재 0.5 h 에서 s90 7.4(씨앗 7)~13.7(씨앗 1007, 이미 접힘), vrms 1 → 3.1, vrms 3 → 15.3.
못 하는 것: 0.5 h 의사시간에 소용돌이 병합(같은 부호 쌍 공전 주기 5~14 h)은 어떤 속도장으로도 불가능; det J 는 보간 오차(P 불변성 ②)라 밀도 가중에 못 씀.

**P3 스펙트럼 합성과 곱셈 캐스케이드** — A5·A6·A7·A15·A19. 난류 통계(k^−β 스펙트럼, 로그정규 간헐성, D = (3−H)/2 윤곽)는 선형 솔버 없이 난수 위상 모드 합·옥타브 곱·exp 로
재현됩니다(FFT 128² 0.9 ms, 옥타브 8개 256² 12 ms node). 페이저·매크로장도 같은 족: 띠 제한 스펙트럼 하나로 위상 결함·비주기 저주파를 만듭니다.
못 하는 것: 캐스케이드의 분수 적분을 ln ε 에 걸면 첨도 2.8~3.0(= 가우스 fBm)으로 무너짐(실측) → ε 또는 ε^a 에 걸어야 함; largestFrac/quad12km 는 k = 2~4 옥타브 분산이 정하지 C1·H 가 아님(씨앗별 0.14~0.63).

**P4 패턴·점과정 템플릿(PDE 대신 기하 규칙)** — A1·A12·A17·A20·A22. Swift–Hohenberg·Turing·Gray–Scott 가 64² 에서 100~500 ms Hermes 로 벽지 격자를 내는 동안(실측),
같은 외형(공유 벽·열린/닫힌 세포·다분산 디스크)은 Voronoi 거리 세 개의 비교, 포아송 군집, 로그정규 반지름으로 1 ms 에 나옵니다. 특히 열린 세포는 실측으로 T2 largestFrac 0.19 → 1.0, quad12km 0.61 → 0.44 를 동시에 넘겼습니다.
못 하는 것: 시간 진화(수명 주기)는 정적 타일에 보이지 않음; 간격 1.8 km 에선 그물(perimPerArea 0.21 ×) — 5~8 km 필요.

**P5 셰이더 샘플당 ALU 몇 개(빛의 대리값)** — A7·A8. 조명 스택(쌍로브 HG·8옥타브 다중산란·파우더·하늘 기울기)은 이미 takram 에 다 있고 샘플당 60~100 flop ≪ 3-D fetch 하나.
남은 지렛대는 인수 교체(국소 소광 → 기둥 d), 바닥 띠, 시야 게이트, 해고도 페이드 — 각 1~4 ALU. 매크로장은 코사인 2개(12~18 ALU)가 상한.
못 하는 것: 샘플당 fetch 추가(타입 채널·육각 타일링·흐름 잡음)는 두 패스에 걸려 즉시 상한 초과; 타일이 f 가 아니라 d 를 저장하므로 셰이더는 구름을 **더할 수 없고 깎기만** 가능(A7 저장 수정).

**P6 지각 한계와 자** — A2·A10·A11·A18. 관측자는 평면도가 아니라 화면 지평선 띠를 보고, 주변시에서는 이심률에 비례해 커지는 창(≈ 0.5 × 이심률, V2 규모)으로 풀링한 통계만 지각(Freeman & Simoncelli 2011 — '2°' 는 논문 수치가 아니라 중심와 관용값). 그래서 타일 바이트를 그대로 두고
카메라 자리만 고르거나(A2), 판정기를 의미(캡션)에서 통계·이미지 유사도로 바꾸는 것(A10·A18)이 가장 쌉니다.
못 하는 것: CSF 게이트·대역 제한·디더는 폰 프리셋(low: shapeDetail off)에서 절약 0 이거나 동결 게이트 T1 을 깨뜨림(합성 256²: T1 차 1.5 → 2.7~3.0 실측).

## §3 후보별 알고리즘 스케치·실패 모드·자 지표

### A1 열린 세포 레짐 — 순위 1
`FIELDS.sc` 5×5 스캔에서 d1 ≤ d2 ≤ d3 를 받아 `closed = (d2−d1)/gap`, `open = 1 − closed + 0.5·exp(−((d3−d1)·n)²/0.1)`, `f_T = mix(closed, open, openness·pocket)`;
pocket = q0(X) < −0.5 이면 1(닫힌 판 안의 열린 주머니), openness = 예보 이슬비/높은 LWP 이면 1, 강한 역전층이면 0, 운량 > 0.6 이면 0 으로 캡.
필수 델타: `spacingKm` 1.8 → 5~8(타일당 3~5 칸; 3 칸은 주기성이 보임), `GENUS_FLOW.sc` flowT 0.4 → 1.0 · flowQ 1.0 → 0.5(openness > 0 일 때만).
실측(open-cell.mjs, 256², 운량 0.3): 닫힌/오늘 largestFrac 0.19·quad 0.61 → 열린 6 km·wT 1.0 **1.00·0.44·perim 0.070**(T2·T8 전부 통과). 1.8 km 에선 perim 0.21 ×.
⚠ 위 '오늘' 0.19/0.61 은 `open-cell.mjs` 의 축소 번들(q0 트리그 합 kq 12 + 닫힌 템플릿만, ζ·변형·파 없음, 256²·운량 0.3) 값이고, 자의 전체 파이프라인은 sc25·dev 4 씨앗 largestFrac 0.33~0.40·quad 0.42~0.55(RULER-flow 4.1) — 이득 폭은 전체 파이프라인에서 재측정. Agee 1987 의 MCC 세포는 10~40 km 라 24 km 타일은 그 하단(5~8 km, 3~5 칸)만 담음.
실패 모드: 운량 > 0.6 갈라진 페인트, 꼭짓점 부스트 과하면 '그물 위 점'. 자: T2 largestFrac ≥ 0.4·perimPerArea ≤ 0.16, T8 ≤ 0.6, shadeRange/darkFrac(꼭짓점 두께), CLIP sc(다각 그물은 Cu 에서 멀어짐).

### A2 카메라 칸 조건화 — 순위 2
합 마스크(흐름 층 d > 0) → 64², 적분영상, 4096 오프셋마다 6 km 원판(r 8 칸) 국소 운량 → **전역 운량에 가장 가까운** 오프셋(국소 중앙값은 A1 면적 가드를 −0.06 치우침). 운량 > 0.6 이면 건너뜀.
적용은 uv 오프셋 유니폼(`localWeatherOffset` 또는 C3 의 genusDrift 레인; 그림자 패스도 같은 값, T9). 바이트·캐시 키·mip 불변, 결정론(sync == async). 관측자는 이동하지 않으므로 점프 없음.
못 사는 것: 24 km 마다 같은 골 반복(→ A7). "흐름처럼 보인다"는 주장은 검증 불가라 뺌. 자: 지평선 띠 하늘 비율을 2회차 전에 사전 등록, 박명 색 가드.

### A3 변형 게이트 지평 — 순위 3
매 걸음(또는 ψ 갱신마다) J = I − ∇D(중심차분·주기), s = σ₁/σ₂, det. **분위수로 게이트**: s90 ≥ 10~13 또는 det p05 < 0.5 이면 정지, hours ∈ [0.25, 1.2], ±1 걸음 블렌드.
원안 문턱(max s > 3, min det < 0.5)은 10× 틀림 — sMax 가 몇 칸에서 16~7600. 측정: hours 0.3/0.5/0.7/1.0 h → s90 3.8/7.4/13.3/29(씨앗 7; 0.7 h = 자의 대리석점).
효과: 씨앗당 ×2, vrms 당 ×5 의 변형 산포를 정규화 → 고요한 날(vrms 1)은 더 굴리고(불만 3·5), 거친 씨앗은 접히기 전에 멈춤(T2 elongIQR ≤ 3). 단순 대안 hours ∝ 1/vrms 는 씨앗 몫을 못 잡음.
실패 모드: A14 덩이가 s90 을 국소로 올림 → 함께 보정. 자: `distortion`·`hoursUsed` 를 FlowCore·자 행에 기록.

### A4 d 사상표(Beta 혼합) — 순위 4
`rankNormalize` 의 `Math.pow(u, γ)` → `lut[floor(u·4095)]`(선형 보간), 층마다 1회, 혼합 분위의 수치 역(또는 mulberry32 정렬 표본). 오늘 rank² = Beta(½,1) 분위(p50 0.25, thin 0.449, ent10 3.02, d(0.01) 1e-4).
**원안 매개변수 전부 실패**(ac 0.6B(2,5)+0.4B(6,2): thin 0.206 T3 ×, 발끝 350× T4 ×; a = 1+2c, b = 1+4(1−c): 양끝 T3 ×). 발끝 안전 혼합 **0.55·B(0.5,1.2)+0.45·B(6,2)** 또는 0.6·B(0.5,1)+0.4·B(5,2.5):
thin 0.27, sat 0.002, ent10 3.20~3.23, p50 0.51~0.57, 발끝 2.6× rank²(γ 1.75 ≈ 4× 는 T4 근소 실패; 발끝 2.5× 는 통과 — RULER 4.1 에서 γ 2.5 가 T3 thin 52 % 로 × 인 것과는 다른 값).
효과: 셰이더 d^0.5 밀도·√d 돔으로 중앙 광학두께 2배 → sc darkFrac 0, ac logIQR 0.26→0.30 의 유일한 CPU 여지. 실패 모드: 8-bit 계단(p90 0.85~0.89 라 무난), T4 재실행 필수. 자: T3·T4 층마다, logIQR·darkFrac·bimod·shadeRange IQR.

### A5 분수 적분 H — 순위 5
가우스판은 두 숫자: `qPow` 2 → 1.3(β = 2+2H → H 0.3), `kq` 12 → 64~128, q0 해상도 64 → 128(`FlowCore.qN`, 합성 `bilinearPeriodic(Q0, qN, X, Y)`), 기존 radix-2 `fft2` 0.9 ms node.
캐스케이드판(A6 뒤)은 ε 에 |k|^−H 가중(fft2 128²) 또는 5단 라플라스 피라미드 `φ = Σ 2^(0.3 l)·L_l(ε)`(256² 9.4 ms). **ln ε 에 걸지 말 것**.
실측: H 1 → 0.3 이 둥근 분지 ~13 개 → 1200~2200 조각(256²), 멱법칙 크기, D = (3−H)/2 = 1.35(Kondev–Henley), T1 예측 −2.6 ∈ [−3.3, −2.3].
실패 모드: H < 0.2 너덜(perimPerArea 상한), H > 0.5 다시 둥근 덩이; largestFrac 은 보장 안 됨(0.14~0.63) → k ≤ 4 저주파 감쇠 별도. 자: A11 D 게이트, areaCV, nPer100km², T1 차 ≤ 2, T8.

### A6 로그정규 캐스케이드 q0 — 순위 6(결정 항목)
옥타브 l = 1..n(k = 2^l, k = 1 은 주기 타일에서 상수): `G += σ_l·n_l`, n_l = 주기 값잡음(쌍선형 블록 가우스, 단위 분산), σ = √(2 ln2·C1)(C1 0.1 → 0.37/옥타브, 0.05 → 0.26), σ₁ = 0.5σ(T8 한 사분면 몰림 억제),
`G += c·ζ̂₀(X)`(c 0.5, 로그 공간), `ε = exp(G − Σσ_l²/2)`, 그 뒤 A5 를 **ε(또는 ε^a, a 0.5~0.7)** 에. 128²(k 2..128, 188 m)면 충분 — 그 아래는 T·침식이 맡음.
실측: 8 옥타브 256² 11.8 ms node; pyr_H(ε) 첨도 6.9~8.6·왜도 1.3~1.6 vs pyr_H(ln ε) 2.8~3.0. 효과는 마스크 기하(조각 13 → 10³)와 두꺼운 핵의 군집이지 d pdf 가 아님(P1).
실패 모드: C1 > 0.2 한 칸이 눈부심(satFrac), 보간 없는 블록 아티팩트, 최종 옥타브 분산 결손(한 옥타브 더 만들고 box 필터). 자: T8 quad12km, T1, A11 D, areaCV.

### A7 해석적 매크로 기압장 — 순위 7
셰이더 S4: `m = A·(cos(k1·x_w/Λ1 + φ1 + ω1 t) + cos(k2·x_w/Λ2 + φ2 + ω2 t))`, Λ 60~250 km(≥ 3 타일), k 전단 정렬. **저장 수정**: 타일은 d 를 저장하므로 운량 cover+Δ(Δ ≈ 0.15)로 굽고 한쪽으로만 깎음
`d' = max(0, (d−a)/(1−a))`, `cover_local = cover_base·(1−√a)`(d = rank² 이므로 area(d > a) = cover·(1−√a)), 32-항 CPU 표로 평균 운량 정확히. 두 재질(구름·그림자) 모두.
비용: 코사인 3개는 20~30 ALU(모바일 cos 4~8) 로 상한 — 2개 또는 2-D 위상 cos 1개. 효과: 24 km 마다 같은 깊이의 골 반복 제거(quad12km·박명 덮개), 저기압 밑 판/고기압 밑 낱 세포(불만 5·3). largestFrac 은 한 크롭 안에서 양방향 → 측정.
실패 모드: A 크거나 Λ ≈ 타일이면 '운량 파도'; 노출 1차 평균 보존 확인. §130.6 항목 2 가 이미 가리킨 길.

### A8 파우더/내산란 델타 — 순위 8
takram `clouds.frag:582` `radiance *= 1 − powderScale·exp(−σ_e·powderExponent)`(0.8/150, 전역 유니폼) 가 이미 d 의존 가장자리 어둡힘(densityScale 0.03·d^0.5: d 0.04 에서 0.67, 1 에서 0.99) — 다만 침식 후 소광을 읽어 잡음과 함께 흔들림.
델타: `inS = mix(1, (0.05 + pow(d, remap(hf,.3,.85,.5,2))) · pow(remap(hf,.07,.14,.1,1),.8), genusFlow·sunUp)`, `sunUp = smoothstep(−2°, +4°, sunElev)`(원안의 '박명 밑면' 주장은 **역** — 바닥 띠는 덮개를 더 검게 함);
시야 게이트 `kView = smoothstep(−0.2, 0.6, −cosTheta)`(takram cosTheta = dot(rayDir, sunDir), 해 쪽 +1 → Nubis '시선이 광원에 가까울 때' = −1; 원안 부호 역) 는 **단독으론 어둡힘을 줄이기만** 하므로 powderScale 0.8 → ~1.0 과 짝.
실패 모드: S6 광학두께 AO 와 이중 어둡힘 → 평평한 검정; cu dark/sky 가드 [1.02, 2.61](지금 1.5~1.7); ac shadeRange [0.265, 0.56] 이탈. 자: darkFrac·logIQR·shadeRange, 박명 가드.

### A9 FTLE σ̂(x) 항 — 순위 9
64²: F = I − ∇D, C = FᵀF, λ_max = ((a+d)+√((a−d)²+4b²))/2, σ = ln√λ_max / T, 표준화 → `core.sig`; 합성 `val += wL·bilinearPeriodic(SIG, n, u, v)` **x 에서**(X 아님; 오일러 성질). wL sc 0.5·ac 0.4·ci 0.5·cu 0.
실측: √λ_max 중앙 1.7~2.3, q88 2.6~4.0, 능선 집합 13~27 필라멘트(최대 12~33 %). 연속 σ̂ 또는 soft ridge 권장(이진 능선 + NMS 는 375 m 경선). det J 가중·밀도 주장은 기각(P1·불변성 ②).
실패 모드: 건조 공기의 필라멘트는 문턱 못 넘음(의도), wL 과하면 스파게티 → T2 elongIQR ≤ 3. 자: '능선 근방 비율' 게이트는 순환이라 금지; T2 largestFrac·quad12km·A11 D.

### A10 CLIP 이미지 k-NN — 순위 10
`emb = clip_image(render)`; 사진 임베딩 캐시에서 코사인 k = 5, 다수결 + 표 차 ≥ 2. ac C2 가 측면 게이트를 다 넘고 J1(argmax Cu)에만 막힌 블로커(§130.6 항목 1) 겨냥.
미검증: Cu 편향이 캡션 편향인지 렌더 스타일인지 — 1회차 C2 ac 렌더로 드라이런(탐색) 뒤 사전 등록. Ci 29 장은 잡음 → 표 차 보고. DISTS(VGG16 공간 평균 + 상관, 자 기계에만)는 선택; SSIM/LPIPS 는 전참조라 제외.

### A11 둘레–면적 D 게이트 — 순위 11
`pieces = label(mask)`; A ≥ 16 px·P ≥ 20 px(외곽 둘레)만; 4 씨앗 × 운량 ≤ 0.5 풀링 ≥ 20 조각; `D = 2·slope(log P ~ log A)`; 게이트 1.25 ≤ D ≤ 1.45; 예측 (3−H)/2 를 옆에 출력(미달 시 H 인지 저주파 감쇠인지 가름).
크기 법칙 보조: N(A > 4 km²)/N(A > 0.25 km²) ≈ 16^−0.87 ≈ 0.09(τ = b′ 1.87 ± 0.03 — Wood & Field 2011 원문의 **면적** 분포 지수; 현(길이) 분포는 b 1.66 ± 0.04 라 혼동 금지). 4-연결 둘레는 작은 A 에서 D +0.05~0.1 편향(바닥값이 흡수). 분지 ~1.05 / 캐스케이드 1.3~1.4 / 소금 1.5 를 가름. 하한 1.25 주의: Benner & Curry 1998 은 작은 적운 D 1.23 / 큰 것 1.34, Lovejoy 재분석(AMS)도 작은 셀 1.25 / 큰 셀 1.54 — 작은 조각이 지배하는 장면은 1.23 이 정상이므로 게이트는 A ≥ 16 px 풀에만 걸고 예측 (3−H)/2 와 나란히 읽음.

### A12 cu 점과정 + 로그정규 크기 — 순위 12
부모 ~ Poisson(λ_p·A); 자식 k ~ Poisson(3), 부모 + N(0, σ² 1~2 km); m ~ Exp(1)·lognormal(0.5); R = R₀√m(클램프 [0.3, 3]·R_med); 진폭 a_i = 0.5 + 0.5·q0(p_i); 반구 max-union 그대로; 운량 > 0.4 이면 Matérn-II 솎음(0.8(R_i+R_j) 안의 어린 것 제거).
래스터: 25-이웃 격자 스캔 → 버킷 격자(R ≤ 2 버킷 → 텍셀당 10~20 후보), TS 256 에서 오늘과 같은 차수(~100 ms node). Lewis 1989 희소 합성곱의 크기 법칙은 `cells()` 안의 3 줄 델타로 흡수(별도 후보 아님).
효과: 격자 배치의 areaCV ≈ 1.4(= '같은 형태'의 원인)를 Exp × lognormal 로 ≥ 2. 측면 areaCV 는 잡음 큼(같은 장면 1.73/2.45) → 4 씨앗. 위험: T8(R·자식 수 캡), cu P(Cu) ≥ 0.83·dark/sky 가드, T2 조각 ≤ 15.

### A13 에너지 조건 템플릿 진폭 — 순위 13
원안(라이브 잡음 탭 2×2 옥타브 @512²) 30~40 ms node / 100~160 ms 폰 → 기각. 정제: `val += wT·(1 + wE·ê(x))·T(x − lag·D)`, ê = 표준화 blur3(ζ₀²)(0.3 ms) 또는 A9 의 σ̂(fetch 0 추가). wE_cu = 0(cu 는 env 로 이미 있음), sc/ac 가 델타.
효과: 한 층 안에서 어떤 구역은 잔 세포로 깨지고 어떤 구역은 넓은 판 → areaCV·elongIQR(sc25 1/3·cu). 새 스케일 없음(grain 안전). A6 와 같은 ζ₀ 로 몰지 말 것(여기는 변형률).

### A14 소용돌이 덩이(속도에만) — 순위 14
`Z0[i] += Γ_m/(π r_m²)·exp(−d²_periodic/r_m²)`, K 6~12, r 1~3 km(≥ 2 칸), 부호 교대·ΣΓ = 0, 덩이 엔스트로피 ≤ 40 %, 기존 vrms 정규화. **Z0(Poisson 입력)에만** — Z0n/q0 에 들어가면 wZ 0.4·qCorr 0.5 로 K 개의 똑같은 둥근 +2~3σ 점(불만 4·ac 점 CLIP 실패 재발). 쌍극자 대안.
근거(실측): 오늘 속도 에너지 83 % 가 k = 1 자이어 하나(회전 ~4 h ≫ 0.5 h) → 정적 변형률뿐; r 2 km·2.5 m/s 덩이는 0.5 h 에 0.5/1/2/4 km 에서 175/160/114/44° 회전(Lamb–Oseen v_θ = Γ/(2πr)(1−e^{−r²/r_m²}), 최대 2.5 m/s 로 재계산하면 196/179/128/50° — 프로파일 정규화 정의에 따라 ±10 %) → 반바퀴 나선 팔 4~8 km. 자 연결(coh20·중간 조각)은 미측정.

### A15 스펙트럼 페이저 전단파 — 순위 15
+k_w 주변 반평면에만 폭 bw(1~1.6 cycle/타일) 가우스 띠 + 난수 위상, 역 FFT 1회(비에르미트 → 복소), Φ = atan2(Im, Re), `W = cos(Φ(X))`(Φ 는 (cos, sin) 보간). 64² 1.3~1.9 ms·128² 4.7~6 ms node.
원안 커널 합은 75~359 ms(7~35× 초과)·블로비. 실측 PNG: 타일당 전위 2~8 개, 휘고 갈라지는 롤 — 미분동형 X 로는 전위가 생길 수 없으므로 진짜 델타. 전단 온셋(S > 2 m/s/km) 밖에선 보이지 않음; hBand/coh20 은 이미 통과라 이득은 elongIQR·외형.

### A16 10 × 180 s, Poisson 매 걸음 — 순위 16
`steps` 20 → 10, `psiEvery` 2 → 1(ψ 갱신 주기 180 s 동일). 16.3 → 11.9 ms node. D relRMS 차 3~5 %, k ≥ 9 전력 ×1.4~2.7 이나 그 대역은 D 분산의 < 0.5 % → **자 지표 변화 없음**, 순수 T6 절약. 6 × 300 s 는 RK3 없이 비권장(dt·|∇u| 0.3). RULER-flow §6 규칙 6 의 사전 등록 대안은 **N 64/12 걸음/psiEvery 4** 이지 이 구성이 아니므로 A16 은 자 행을 새로 등록해야 함(재실행: 20×90 psi2 16.1~18.0 → 10×180 psi1 11.6~13.8 ms, 씨앗 7·1007).
별도 메모: 합성 비용은 격자 크기가 아니라 `bilinearPeriodic` 호출 오버헤드 — 같은 격자 가중치 공유 인라인으로 49.9 → 22.4 ms(−55 %); 2-격자 트릭은 −15 % 뿐.

### A17 Nubis 종류장 CPU 혼합 — 순위 17
`τ(X) = smoothstep(0.35, 0.65, fbm_LF(X))`(64², k ≤ 4), `f = wQ·q0(X) + wZ·ζ̂₀(X) + wT·τ(X)·T(x − lag·D) + wW·W`. τ ≈ 0 구역은 매끈한 수분 → 판, τ ≈ 1 은 세포. 셰이더판(채널 팩킹·두 번째 텍스처)은 기각(LinearMipMapLinear 가 비트 팩킹을 깨고 fetch +1/샘플/층).
flatMed 는 못 움직임(수직 프로파일은 층별 그대로); sc85 이득 없음(판 구역 지배). 운량 정확성 유지(분위수).

### A18 Portilla–Simoncelli 축소 통계 — 순위 18
`B_s = (G_s − G_{s+1}) * logL`(마스크 내, 바깥은 평균 채움), `C_s = pearson(|B_s|, |B_{s+1}|)`, 대역 첨도(≥ 8 px: Worley 침식 대역 회피), 마스크 내 왜도 — ~20 통계. 실측: 변형 세포장 vs 위상 무작위 쌍둥이 C₁₂ 0.445 vs 0.146, 첨도 137/27/2.8 vs ≈ 0(굵은 대역은 약함).
700 통계 표준화 거리는 사진 29~59 장/부류로 잡음 지배 → 축소형만. 사전 등록 전엔 게이트 불가; 레이아웃 게이트(largestFrac·quad12km) 대체 아님.

### A19 Hogan–Kew 옥타브 비등방 — 순위 19
A6 의 fft2 경로에 스펙트럼 가중 (|k_∥|/k_outer)^((μ1−μ2)/2)(k_∥ = 전단 방향 성분, l ≥ 4 즉 < 1.5 km 에만). 원안 축이 역 — 전단 방향 줄무늬는 전단 방향 k 를 **낮춰야**(늘림). 포물선 낙하줄 기울임은 폰 규모에서 안 보여 생략, 외부 스케일 50 km 는 메모.
원문 확인(QJRMS 131:2585, §3(b)·Fig. 5): 외부 스케일 k_outer 보다 큰 k 의 **푸리에 진폭**에 (k/k_outer)^((μ1−μ2)/2) 를 곱해 1-D 기울기를 −μ1 → −μ2(−5/3 → −3)로 바꾸고(1/2 승은 진폭 = √PSD 때문), 비등방 혼합은 전단 방향 θ 의 파수 성분에만 적용 — 위 식은 원문 그대로이고 피벗은 외부 스케일.
가드: 모든 스케일 비등방 → 대리석(elongIQR ≤ 3). 효과는 hBand·orientRatio(ci·cs·sc, 전단 장면).

### A20 KH/중력파 패킷 — 순위 20
`λ = clamp(7·shearDzKm, 2, 10) km`(Δz 알 때만, 아니면 flowWaveKm), `W = env(x)·cos θ`, env = 감싼 가우스 패킷 1~2 개/타일(σ 3~5λ). 비대칭 마루(−0.25 cos 2θ)는 순위 사상이 거의 지움. **Ri < ¼ 온셋(S > 20 m/s/km) 채택 금지** — 거의 모든 예보에서 파가 꺼지고 ac 의 undulatus 외형을 잃음; FLOW_WAVE_S0/S1 유지.
등록 장면은 전단 0 이라 자가 못 봄 → T5 '바람 지정' 분기로 전단 장면을 먼저 추가.

### A21 웨이블릿 난류 256² — 순위 21
`ψ_f = Σ_j A_j·valueNoise_j`(k 16/32/64, A_j = A₈·(k_j/8)^−3/2, A₈ = ψ₀ k = 8 껍질 rms), 격자 FD 컬(이산 비발산·공짜), 변형률 g = clamp(|∇u|/s0)(64²), 합성 `X_f = x − D − g·ε·u_f(X)`, ε ≤ 0.3·셀 반지름/|u_f|rms, A_j ≤ 0.3·A(k=8).
원안 512² FD 는 94.7 ms node(주장 20~30)·0.5 s Hermes → 기각; 256² 형태 20~25 ms node / 100~200 ms Hermes(예산 상단). 겨냥 지표 hBand/coh20/granSpatial 은 이미 통과하고 coh20 은 **내려감**(ac 여유 0.02) → 이득을 variety 로 재겨냥.

### A22 오프라인 예시 퀼팅 — 순위 22
토러스 위 Efros–Freeman(블록 8 px, 겹침 2 px, 최소 절단) 으로 24 km 저대역 → 256² 큐빅 → 1 km 위는 RPN 고대역 → 표준화 PNG. 소스는 MOD06 COT 1 km(24 px/타일, 세포 2~5 px) 로는 부족 → MODIS 250 m 반사도(96 px) 또는 Sentinel-2 10 m; 순위 사상이 단조 복사→COT 왜곡을 지움.
T 가 지배하는 층(cu wT 1.2)만 이득; sc/ac 는 wQ/wT 재균형 뒤. 라이선스(NASA 공개·Copernicus 표기·JMA 비상업) 미확인. 매일 같은 매크로 질감(D·q0·시드가 일부 가림).

## §4 기각한 것과 이유

| 후보(각도) | 이유(한 줄) |
|---|---|
| 스크린드 Poisson / 등가순압 / SQG 역변환(난류·수치) | 0 ms 이나 병합 게이트에 역부호; 골 몰림은 q0 의 k=1 분산 몫 0.83(qPow 2·kq 12)이지 역변환이 아님(A14 의 '속도 에너지 83 %' 는 vrms 재정규화 뒤 속도 몫으로 별개 측정, 우연히 같은 수); vrms 재정규화로 specPow −0.2 와 동치 |
| 점 와동·와동 덩이 동역학(격자 없음) | 비용 ~50× 과소; 0.5 h 에 병합 불가(5~14 h) |
| 흐름 잡음·이류 질감·IBFV·두 키프레임·Taylor 동결 난류·정적 커버 + 애니 디테일 | 두 패스 샘플당 fetch 또는 초당 재합성·업로드; 정지 자가 못 보고 위상 혼합이 밀도 대비를 반감 |
| KH 빌로우(λ 7h, Stuart 열)·정상 중력파열·KS-1D 마루 변조·Cross-Newell 결함·거리 λ ≈ 2.8h 규칙 | 이미 있는 파 항의 매개변수; h·지면 고정 위상 입력 없음; 결함은 통과 중인 coh20/hBand 를 내림 |
| Swift–Hohenberg·Turing·Gray–Scott·세포자동자/CML·Dobashi 수명 CA | 64² 에서 75~560 ms Hermes 로 벽지 격자(실측); 공유 벽·다분산 디스크는 Voronoi·점과정이 1 ms 에 줌; 나이 채널 없음 |
| 운동학 시뮬레이션(ω_k, kmax 32)·컬 잡음(셰이더)·Richardson–Obukhov 변위·Kolmogorov 서브그리드 워프 | ψ₀ 가 이미 정상 컬 잡음(변위 k^−3); kmax 32 는 grain/대리석; 템플릿 fbm 워프 이미 있음; k > 8 은 캐스케이드 몫 |
| POD/DMD/Koopman | 저자 본인이 비권장; 스펙트럼 절단이 이미 Galerkin ROM |
| 유계 캐스케이드·p-모델·Lévy α<2(CMS)·IAAFT·Heeger–Bergen·RPN 측정표 | 순위 사상 뒤 로그정규와 구별 불가; p-모델 2-D 수치 오류(max/mean 218); CMS 초월함수 10/표본; IAAFT 왜도 4.3→2.7→1.7→0.7→0; 예시 대역 통계 없음 |
| 로그정규/측정 rank→d LUT | T4 가장자리 상승길이 파괴(발끝 기울기 1.3 vs 0.02) — A4 의 발끝 안전 혼합만 생존 |
| 복사 평활 스케일 재고정 | 이미 S7 150~600 m(델타 < 1 텍셀); 한 채널로 '마스크 ≠ 밀도' 불가 |
| Perlin–Worley·도메인 워핑·takram 컬 난류 켜기·LIC·Gabor 커널 페이저·Lagrange 소포 수명 | cells()+돔이 같은 구성; sc perimPerArea 역방향; LIC 2371 ms(30×)·페이저 커널 143 ms(20×)·소포 215 ms(14×); takram 이 폰에서 끈 비용 |
| MacCormack/BFECC·와도 집중·FFT 트위들·스펙트럼 제로패드 업샘플 64→256·2-격자 합성·흐름맵 뱅크·LBM/천수/PIC-FLIP | D 는 95~98 % k ≤ 4 라 무효과; ζ = ζ₀(X) 정확이라 집중할 것 없음; 업샘플 0.3~0.5 s Hermes 에 격자 꺾임 신호 없음(비 0.98~1.00)·T1 역행; 뱅크는 T5 방향 45° 양자화 |
| 육각 히스토그램 보존 타일링(전부/먼 층)·Wang 타일·슬라이스드 Wasserstein | 블렌드 영역 기울기 첨도 21 → 5.4(뭉개짐 실측), fetch 12/샘플, d 저장 불가; Wang 8~16× 예산; SW 128² ~1 s 폰 |
| CSF 게이트·가장자리만 디테일·1/f 대역 제한(합성 256²)·블루노이즈 디더·마스킹 침식·릿지 항 | 폰 low 프리셋에 디테일 fetch 없음(절약 0); 합성 256² 는 T1 차 1.5→2.7~3.0 로 동결 게이트 파괴; 디더는 2 km 에서 0.75 cpd(가시 대역); 릿지 항은 씨앗 잡음 크기 |
| 희소 합성곱 잡음(Lewis) — 판정 없음 | gfx 검증은 `cells()` 델타로 생존(크기 법칙) → A12 에 접목, 독립 후보에서 제외 |

## §5 라운드 제안

**2회차(결정 항목 + 이번에 배운 수정)** — A6 캐스케이드 q0 와 A11 D 게이트, 다음 수정 포함: ① 분수 적분은 ε 에(ln ε 금지), a 0.5~0.7; ② 128²(k 2..128) + `FlowCore.qN`; ③ σ₁ 반감·k ≤ 4 감쇠로 T8/largestFrac 따로 제어(H·C1 은 못 함);
④ 먼저 가우스판 A5(qPow 1.3·kq 64~128·128²) 를 단독 측정해 캐스케이드의 순증을 가름; ⑤ A11 은 A ≥ 16 px·P ≥ 20 px·4 씨앗 풀링·예측 D 병기로 사전 등록.
같은 라운드에 **공짜 셋**을 같이 넣되 자 행을 분리: A3 변형 게이트(대리석 가드이자 고요한 날 보정), A2 카메라 칸(박명 가드 전용, 바이트 불변), A16 10×180(T6).
자 쪽: A10 드라이런(1회차 C2 ac) → k-NN 사전 등록; A18 축소 통계·지평선 띠 하늘 비율은 사진 사분위부터.

**3회차** — A1 열린 세포(sc 블로커 직격; spacingKm 5~8·wT 1.0·wQ 0.5·레짐 손잡이), A4 d 사상표(불만 6 의 유일 CPU 지렛대; T3·T4 재측정), A8 파우더 델타(부호·해고도 수정판, powderScale 짝), cu 는 A12 점과정(§130.6 항목 3 의 C1 위에).
**4회차** — A7 매크로장(저장 수정 선행), A9 FTLE 항 + A13 진폭 변조(같은 fetch), A14 덩이(속도만, A3 와 공동 보정), 전단 장면을 자에 추가한 뒤 A15·A19·A20.
**보류** — A17(간접), A21(예산 상단·이득 불확실), A22(라이선스·파이프라인 선행).

**하지 말 것**: 3-D NS·LBM·천수·PIC(수백 M ops); 64²/128² PDE 패턴(벽지·예산); N 128·60 걸음(변형은 A3 가, 미세 스케일은 캐스케이드가 더 싸게); 샘플당 fetch 추가 전부; 합성 해상도 낮추기(T1); 순위 사상 앞에서 밀도를 바꾸려는 시도 전부(P1).
단일 측정 원칙 유지: 후보마다 자 행 하나, 사전 등록, 4 씨앗, flow-off 바이트 동일.

## §6 참고문헌(검증 = 이번 조사에서 원문/초록/인용 페이지 확인; 기억 = 미확인)

- Agee E. M. 1987, Mesoscale cellular convection over the oceans, Dyn. Atmos. Oceans 10(4):317–341 — 서지 검증(MCC 세포 10~40 km).
- Benner T. C. & Curry J. A. 1998, Characteristics of small tropical cumulus clouds…, JGR 103(D22):28753–28767, doi 10.1029/98JD02579 — 서지 검증(D 1.23 작은 / 1.34 큰 적운은 2차 인용 경유).
- Christiansen J. P. 1973, Numerical simulation of hydrodynamics by the method of point vortices, J. Comput. Phys. 13(3):363–379 — 서지 검증.
- Ding K., Ma K., Wang S., Simoncelli E. 2020, Image quality assessment: unifying structure and texture similarity (DISTS), https://arxiv.org/abs/2004.07728 — 검증.
- Efros A. & Freeman W. 2001, Image quilting for texture synthesis and transfer, SIGGRAPH, https://people.eecs.berkeley.edu/~efros/research/quilting.html — 검증. Efros & Leung 1999 ICCV — 검증.
- Feingold G., Koren I., Wang H., Xue H., Brewer W. 2010, Precipitation-generated oscillations in open cellular cloud fields, Nature 466:849, doi 10.1038/nature09314 — 검증(초록).
- Freeman J. & Simoncelli E. 2011, Metamers of the ventral stream, Nat. Neurosci. 14(9):1195–1201, doi 10.1038/nn.2889 — 검증(초록·PMC3164938; 풀링 창 크기는 이심률에 선형, '2°' 문턱은 논문에 없음).
- Gilet G., Sauvage B., Vanhoey K., Dischler J.-M., Ghazanfarpour D. 2014, Local random-phase noise, ACM TOG 33(6), https://publis.icube.unistra.fr/docs/7691/GSVDG14.pdf — 검증.
- Haller G. 2001, Distinguished material surfaces and coherent structures in 3-D fluid flows, Physica D 149:248 — 기억. Shadden S., Lekien F., Marsden J. 2005, Physica D 212:271, doi 10.1016/j.physd.2005.10.007 — 검증.
- Hillaire S. 2016, Physically based sky, atmosphere and cloud rendering in Frostbite, SIGGRAPH course — 존재 검증, 식은 기억.
- Hogan R. J. & Kew S. F. 2005, A 3D stochastic cloud model for investigating the radiative properties of inhomogeneous cirrus, QJRMS 131:2585–2608, doi 10.1256/qj.04.144 — 원문 검증(저자 PDF met.reading.ac.uk/~swrhgnrj/publications/hogan_kew.pdf; 진폭 가중 (k/k_outer)^((μ1−μ2)/2), 1-D 기울기 −5/3, 비등방은 전단 방향 파수에만).
- Kim T., Thürey N., James D., Gross M. 2008, Wavelet turbulence for fluid simulation, ACM TOG 27(3):50, https://www.cs.cornell.edu/~tedkim/WTURB — 검증.
- Kondev J. & Henley C. 1995, Geometrical exponents of contour loops on random Gaussian surfaces, PRL 74:4580 — PRL 초록엔 식이 없고 arXiv 0907.0881 초록에도 없음; Kondev, Henley & Salinas 2000 PRE(https://arxiv.org/abs/cond-mat/9907229 본문 'α = 3 − 2D_f', ref. [21] = Kondev & Henley 1995) 로 D = (3−H)/2 확인.
- Lewis J. P. 1989, Algorithms for solid noise synthesis, SIGGRAPH — 기억.
- Lovejoy S. 1982, Area–perimeter relation for rain and cloud areas, Science 216:185–187, doi 10.1126/science.216.4542.185 — AMS 용어집 경유 검증(https://glossary.ametsoc.org/wiki/fractal/; D 1.35 ± 0.05, 1~1000 km; 재분석은 작은 셀 1.25 / 큰 셀 1.54, https://ams.confex.com/ams/pdfpapers/54660.pdf).
- Mandelbrot B. 1974, Intermittent turbulence in self-similar cascades, J. Fluid Mech. 62:331 — 기억. Schertzer D. & Lovejoy S. 1987, JGR 92:9693 — 기억; 매개변수 https://scaleinvariance.readthedocs.io — 검증.
- Miles J. 1961 / Howard L. 1961, J. Fluid Mech. 10:496/509 — 기억. Smyth W. 2004, QJRMS, https://www.chem.pmf.hr/_download/repository/Smyth-KH_billowEvolut_QJ2004.pdf — 검증. Scorer R. 1949 — 기억.
- Neyman J. & Scott E. 1958, Statistical approach to problems of cosmology, JRSS B 20(1):1–43, doi 10.1111/j.2517-6161.1958.tb00272.x — 서지 검증.
- Plant R. S. & Craig G. C. 2008, A stochastic parameterization for deep convection based on equilibrium statistics, JAS 65:87, doi 10.1175/2007JAS2263.1 — 검증(https://elib.dlr.de/53655).
- Portilla J. & Simoncelli E. 2000, A parametric texture model based on joint statistics of complex wavelet coefficients, IJCV 40:49, https://www.cns.nyu.edu/pub/eero/portilla99-reprint.pdf — 검증.
- Qu Z., Zhang X., Gao M., Jiang C., Chen B. 2019, Efficient and conservative fluids using bidirectional mapping, ACM TOG 38(4):128 — 검증. Zhou et al. 2024, Eulerian–Lagrangian fluid simulation on particle flow maps, SIGGRAPH — 검증.
- Schneider A. & Vos N. 2015, The real-time volumetric cloudscapes of Horizon Zero Dawn, SIGGRAPH Advances — 검증(슬라이드 텍스트). Schneider A. 2017, Nubis: authoring real-time volumetric cloudscapes with the Decima engine, https://advances.realtimerendering.com/s2017/ — 검증(파우더/내산란 확률은 노트 PDF 84–92쪽; 본문의 '88–91' 을 고침).
- Selle A., Rasmussen N., Fedkiw R. 2005, A vortex particle method for smoke, water and explosions, SIGGRAPH — 검증(https://history.siggraph.org/?p=113926).
- Sommeria G. & Deardorff J. 1977, Subgrid-scale condensation in models of nonprecipitating clouds, JAS 34:344 — 인용 경유 검증. Tompkins A. 2002, JAS 59:1917 — ECMWF 리뷰 경유 검증.
- Stam J. 1999, Stable fluids, SIGGRAPH — 기억. Staniforth A. & Côté J. 1991, Semi-Lagrangian integration schemes for atmospheric models, MWR 119:2206 — 검증(doi).
- Tricard T., Efremov S., Zanni C., Neyret F., Martínez J., Lefebvre S. 2019, Procedural phasor noise, ACM TOG 38(4), doi 10.1145/3306346.3322990 — 검증.
- Wood R. & Field P. 2011, The distribution of cloud horizontal sizes, J. Climate 24:4800, https://atmos.washington.edu/~robwood/papers/my_papers/Wood_Field_JCLI_2011.pdf — 원문 검증(현 길이 b 1.66 ± 0.04, 면적 b′ 1.87 ± 0.03, 꺾임 ~1500 km).
- Wood R. & Hartmann D. 2006, Spatial variability of liquid water path in marine low cloud, J. Climate 19:1748, https://atmos.washington.edu/~robwood/papers/my_papers/Wood_Hartmann_JCLI_2006.pdf — 검증.
- Wrenninge M., Kulla C., Lundqvist V. 2013, Oz: the great and volumetric, SIGGRAPH 2013 Talks 46:1, doi 10.1145/2504459.2504518 — DOI 검증(식은 기억).
- Zhang R., Isola P., Efros A., Shechtman E., Wang O. 2018, LPIPS, CVPR, https://arxiv.org/abs/1801.03924 — 검증.
- 이번 조사 측정 스크립트(`tools/genus-ruler/flow/survey/`, README 에 번들 명령): `verify-turb/ftle-check.mjs`, `verify/bench-mf.mjs`·`fif-check.mjs`, `verify-numerics/check.mjs`·`timing.mjs`, `verify-gfx/bench-gfx.mjs`,
  `verify-patterns/{lut-check,ent10,sh-vis,open-cell}.mjs`, `verify-texture/{iaaft,phasor,hpb}.mjs`·`ps_metric.py`, `verify-perc/{bandlimit,ridged2}.mjs`, `bench-patterns.mjs`, `bench-ca.mjs`.

## §7 검토에서 보탠 것(완전성 비평, 2026-10-08)

조사 7 각도에 **빠져 있던** 싼 기법 6 개. 각 줄: 출처(검증 = 서지·원문 확인, 기억 = 미확인) · 무엇을 계산 · 왜 싼가 · 우리 격자 비용 · 겨냥 불만/지표 · 꽂는 자리 · 실패 모드. 모두 §5 의 단일 측정 원칙(자 행 사전 등록·4 씨앗) 아래서만.

| # | 이름 | 출처 | 요지 |
|---|---|---|---|
| B1 | **상관 퍼콜레이션 + 가우스 등고선 통계(설계 계산기)** | Weinrib 1984 PRB 29:387(기억); Prakash, Havlin, Schwartz & Stanley 1992 PRA 46:R1724(검증, doi 10.1103/PhysRevA.46.R1724); Adler 1981 *Geometry of Random Fields*·Longuet-Higgins 1957(기억) | 문턱 = 운량인 등고선 집합의 **연결**은 퍼콜레이션 문제: 무상관 2-D 장은 p_c ≈ 0.5 라 운량 0.25 에선 어떤 생성기도 한 조각(largestFrac ≥ 0.4)을 못 만들고, 장거리 상관(H↑, k ≤ 4 몫↑)만이 p_c 를 내림 — §1 의 "largestFrac 은 k = 2~4 옥타브 분산이 정함"의 이론 이름. Rice–Adler 식으로 조각 수/오일러 수를 스펙트럼 모멘트(m₂·m₄)에서 **돌리지 않고** 예측 → H·C1·저주파 감쇠를 시행착오 대신 표로 고름. 비용 0(설계·자 전용, 64² 스윕 1 회). 불만 3 / T2 pieces·largestFrac·T8. 실패: 캐스케이드(비가우스)엔 근사만. |
| B2 | **젤도비치 근사 + 점착 모형(Cole–Hopf Burgers)** | Zel'dovich 1970 A&A 5:84(기억); Gurbatov, Saichev & Shandarin 1989 MNRAS 236:385(기억, 서지 미확인); Hopf 1950 / Cole 1951(기억) | 지금 흐름은 비발산(det J ≡ 1, 불변성 ②)이라 구름이 **모일 수 없음**. 발산 성분 한 겹: 포텐셜 χ(Ekman 펌핑 w ∝ ζ → 경계층 수렴 ∝ −ζ, 또는 q0 저대역)에서 D_pot = −λ∇χ 를 더하고(젤도비치), 접힘은 Cole–Hopf 로 닫힌 꼴 — φ = G_ν ∗ exp(−χ/2ν), u = −2ν∇ln φ, 즉 **가우스 블러 1 회 + log + 중심차분**. 질량이 코스틱(판·필라멘트)에 쌓여 '합쳐져 띠가 되는' 모양. 비용 64² 0.2~0.5 ms(기존 fft2 블러). 불만 3·5 / largestFrac·coh20·hBand. 꽂는 자리 `flowCoreSteps` 끝에 D += D_pot; 1/det(∇X) 는 이제 보간 오차가 아니라 진짜 쌓임 신호라 f 에 곱할 수 있음(P1 은 기하만 바꾸므로 안전). 실패: λ 과하면 모든 구름이 선 — elongIQR ≤ 3·T8 가드. |
| B3 | **형태학 닫힘 + 선형 시간 유클리드 거리변환(EDT)** | Serra 1982(기억); Felzenszwalb & Huttenlocher 2012 Theory of Computing 8:415–428(검증, doi 10.4086/toc.2012.v008a019); Rong & Tan 2006 JFA(기억) | 마스크 후처리 한 줄: 반지름 r 안의 조각을 **닫힘**(팽창→침식)으로 잇고, 가장자리 d 를 EDT 의 단조 함수로 — T4 상승길이를 구성상 보장. EDT 는 O(n) 두 패스(128² 0.5~1 ms, 512² 5~10 ms node). 닫힘은 운량을 바꾸므로 f 에 바이어스 `f += b·(1 − EDT_out/r)_+` 로 넣고 분위수 문턱은 그대로(T0 유지). 불만 3·2 / largestFrac·pieces·T4·edgeWidthPx. 실패: r 크면 모든 조각이 한 덩이(largestFrac 1, sc85 꼴) → r ≤ 1.5 km·운량 ≤ 0.5 만. |
| B4 | **기상학 구름 조직 지표를 자에**(I_org·SCAI·COP·Janssens 4 차원) | Tompkins & Semie 2017 JAMES 9:1046, doi 10.1002/2016MS000802(검증); Tobin, Bony & Roca 2012 J. Climate 25:6885(기억); White et al. 2018 JAS(기억); Janssens et al. 2021 GRL 48:e2020GL091001(검증 — 5000 위성 장면·21 지표 → 4 차원: 특성 길이·빈 하늘 크기·방향 정렬·운정 높이 분산) | largestFrac·areaCV 같은 자작 지표 대신 위성 구름장에 표준화된 조직 지표(최근접 이웃 CDF 의 I_org, 조각 수·크기의 SCAI, 쌍 거리 가중 COP, 빈 하늘 크기)를 `tile.py`·`fm.py` 에 — 사진·위성 사분위와 직접 비교 가능. 비용 자 전용 < 1 s. 불만 3·4·5. 실패: 24 km 타일의 조각 수 ≤ 15 에선 I_org 잡음 → 4 씨앗 풀링. |
| B5 | **지평선 방향 하늘 LUT 로 밑면 조명(박명)** | Hillaire 2020 CGF 39(4):13–22, EGSR(검증 — sky-view LUT, 모바일까지); Hillaire 2016 Frostbite 코스(존재 검증, 식 기억) | 1 회차 블로커 "해가 지평선 아래면 밑면이 하늘빛만 받아 검은 덮개" 는 takram 이 구름 주변광을 **반구 스칼라 조도**(`vCloudsIrradiance.minSky/maxSky` 높이 보간, clouds.frag:438–443)로 읽어 박명의 밝은 지평선 띠(해 방위 쪽)가 평균에 묻히기 때문. 광선당(샘플당 아님) 해 방위·지평선 고도의 하늘 LUT 텍셀 1~2 개를 더 읽어 밑면 조도 = 반구 조도 + k·L_horizon·max(0, −n·ŝ)로. 비용 광선당 fetch 1~2, 샘플당 0. 불만 6 / 박명 가드·darkFrac·shadeRange(박명). 실패: 낮에 이중 가산 → sunUp 로 박명에만; 지형 그늘(§129.2)과 일관성. |
| B6 | **라그랑주 나이 채널(수명 주기)을 라벨맵 공짜 스칼라로** | Dobashi et al. 2000 SIGGRAPH(세포자동자 수명, 기억); 흐름맵의 물질 스칼라 보존(Qu et al. 2019, 검증) | §4 가 CA·소포 수명을 '나이 채널 없음·215 ms' 로 기각했지만, 주기 위상장 a₀(X) 는 q0 처럼 **라벨 X 에서 읽는 보존 스칼라**라 추가 비용 0; 진폭 `f ×= L((a₀(X) + t/τ) mod 1)`(L = 성장–성숙–소멸 종 모양, τ 층별 20~60 분)로 구름마다 다른 수명 단계(어떤 것은 탑, 어떤 것은 흩어진 잔해) — 불만 4·5. 초당 유니폼은 t 하나. 비용 CPU 64² 0.1 ms + 합성 1 fetch(기존 q0 fetch 와 가중치 공유 시 0). 실패: L 이 세면 운량이 시간에 요동 → 분위수 문턱이 평균을 고정하므로 시각적 '깜빡임'만 가드(초당 Δ운량 ≤ 1 %). |

겹침 정리: B1 은 A5·A6 의 매개변수를 **고르는** 도구(새 생성기 아님), B2 는 A9(FTLE)·A14(덩이)와 같은 ∇D 를 쓰되 유일하게 det J 를 신호로 돌려놓음, B3 은 A1 의 열린 세포 그물과 경쟁(둘 다 largestFrac) — 같은 라운드에 넣지 말 것, B4 는 A11·A18 옆 자 행, B5 는 A8 과 같은 조명 스택의 다른 자리(광선당 vs 샘플당), B6 는 A17 종류장과 같은 fetch 를 공유.
