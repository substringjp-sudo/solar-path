/**
 * cloudTsun.ts — §179 T_sun(해 줄 투과율 아틀라스) · 아치 빛 셰이더 주입 — **하네스 전용 도구, 기본 끔**(2026-10-28 사용자 결정).
 *
 * 설계: scratchpad `tsun2/design-v2.md` §3~§5 를 `design-v2.1.md` §4~§8 이 고친 것(v2.1 §4.3 이 v2 §5 의 I-2·I-T 를 대체).
 * 앱 길은 없습니다 — 스케줄러(WP3)·GPU 구축(WP2b)·개발 패널 칩 없음, DEFAULT_VOLUMETRIC_OPTIONS 는 모두 끔, 앱은 넘기지 않음.
 * 판정 회차도 없음 — 판정은 새 보류 사진이 있는 RULER-tsun2 에서. 여기서는 하네스(B0·B2 보정 렌더)가 쓸 글자와 균일변수만.
 *
 * 무엇을 하나(V10b, 해 고도 ≤ shadowMinSunDeg 일 때만 글자가 들어감 — v2.1 eng m2, 위에서는 C0ps 글자와 바이트 같음):
 *  - I-2  2차 행진 끝(p_end) 너머 해 줄의 광학두께 τ(아틀라스 한 번 읽기 + 조각 보간(아래 쌍 u_true, 위 두 쌍 λ 무게 경로 W) + WP1 조건부 오프셋 τ_c)를
 *         직달 햇빛 sunIrradiance 에 Beer 로 곱함(MS 옥타브·얼음 무리가 이 값을 씀). opticalDepth 에는 더하지 않음(역광 어둡게는 행진 τ 그대로).
 *  - I-T  종류 thru 줄을 mix(오늘 thru, Eddington 확산 투과, 1 − e^(−τ_far)) 로(V10b). gTsunOn = 0 이면 원래 줄 그대로(else 가지에 글자 그대로).
 *  - I-1·I-4·I-0 (아치 팔 archLight 만) 2차 행진 방향을 r = w(θ)·(1 − vis) 로 연속으로 돌리고(r = 0 이면 sunDirection 비트 같음),
 *         해 쪽 지평선 아래 띠 [−dip, 0] × 해 방위 ±30° 의 하늘빛(노드 6 개, 이중 HG 옥타브)을 §168 역광 어둡게 뒤에 더함. I-0 은 광선마다
 *         아치 노드 캐시를 비움.
 *  - 아틀라스는 밖에서 받습니다(setTsunAtlas — 구축기 tsunAtlas.ts 는 다음 단계 WP2). 형식은 아래 `TsunAtlas`.
 *
 * 결정(설계가 모호하거나 이번 범위 때문에 바꾼 것 — 요약에도 적음):
 *  (D1) 옵션 이름은 닫힌 팔 목록(ruler-delta A1) 그대로: tsun 0|1 · tsunN 128|256 · tsunRangeKm · archLight 0|1 · archNoT 0|1 · tsunRef 0|1|2 ·
 *       tsunRefStepM · tsunDebug 0..7 · tsunSync. T1/T2 는 tsun 이 아니라 tsunN 으로 가릅니다(tsun 은 0|1).
 *  (D2) 셰이더가 없는 값은 throw(조용히 C0 이 되지 않게 — `TSUN_IMPLEMENTED`). §179 WP6 이 tsunRef 1·2, WP8 이 tsunDebug 1 을 넓힘 — 2~7 은 아직 throw.
 *  (D12, WP6) REF 팔(tsunRef 1 REF_v2 · 2 REF_val)은 아틀라스·샘플러 없이 해 줄을 무차별 행진(H_REFMARCH 머리말 R1~R4). 글자는 T 팔과 같은 한
 *       불리언(해 ≤ shadowMinSunDeg)으로 들어감 — 팔 정의가 shadowMinSunDeg 90 이라 늘 들어가고, 90 이 아니면 해 > 그 값에서 C0 글자(하네스가
 *       tsunInfo().injected 로 확인). REF_v2 의 I-T(V10b)·Eddington·도달 글자는 T 팔과 바이트 같음(U6b), 두 REF 는 행진 함수 글자가 같음(U6d).
 *  (D13, WP8) D-1 진단(tsunDebug 1)은 화소마다 Σ wᵢ·T_beyond,i / Σ wᵢ(wᵢ = T_앞·(1 − e^(−σΔs)), 빛 받는 표본)를 구름 패스 출력에 직접 씀
 *       (R √T̄ · G Σw · B Σw·T). 하네스는 해석 전 구름 패스 RT 를 읽어(RULER-grain 비용 모드와 같은 길) 대기·안개·톤을 거치지 않음 — ruler-delta B1 의
 *       '√T in R, Σw in G' 를 지키되 그림 경로가 아니라 RT 에서. T 팔에서 레인 블록이 없는 빛 받는 표본은 T_beyond = 1(오늘 빛).
 *  (D3) v2.1 은 아틀라스 재사용(eng M3)과 A/B 반쪽(gTsunMix·gTsunHalfB)을 뺐고, 앱 스케줄러가 없으므로 텍스처는 반쪽 없이 한 벌:
 *       너비 n·blocks, 높이 n·(arch ? 3 : 1). 그래서 T 팔의 I-0 은 비울 것이 없어 **주입하지 않음**(아치 팔만 I-0 수 1, T 팔 0).
 *  (D4) gTsunEpochOrigin(vec2) 대신 vec4 gTsunEpoch = (중심 동 km, 중심 북 km, tsunRangeKm, 0) — u_true 가 행진 끝 거리를 알아야 해서.
 *       T 팔 균일변수 7 개(gTsunOn·gTsunTex·gTsunFrame·gTsunLaneBlock·gTsunEpoch·gTsunCond[21]·gTsunProf[17]) + 아치 2 개(gArchW·gArchNoT) — v2.1 §4.3 의
 *       6 개에 §179 고침(검토 물리 1)의 λ̂ 단면 gTsunProf 하나를 더함(샘플러 아님, gTsunCond·gTsunProf 합 vec4 38 개 — WebGL2 조각 균일 벡터 최소 224 안, B1 에서 링크로 확인).
 *  (D5) 아틀라스는 textureLod(…, 0.0) 로 읽음(비균일 분기 안 — 밉맵 없음이라 값은 같고 도함수 문제를 피함). 세는 줄은 `TSUN_COUNT_LINE`.
 *  (D6) 이름 충돌을 피하려고 셰이더 지역 변수는 gTsun…·gArch… 접두(설계의 gMu0·gW·gTtop·gSunIrrUncut → gTsunMu0·gTsunW·gTsunTtop·
 *       gTsunIrrUncut). 설계가 이름을 박은 gMarchDir 만 그대로(팔마다 선언 정확히 하나 — U4a).
 *  (D7) 층 아래 기둥 τ(해가 표본 지평선 아래, μ0 < 0)는 확산 L1 에서도 σ·hf·H(설계 식). L1 은 위쪽만 해석적 기둥으로 바꿈 — 기록.
 *  (D8) u_true 보간 계수 s 를 [−1, 2] 로 자름(설계: |Δu| < 1e−3 km 이면 hf 선형만 — 그보다 조금 큰 Δu 에서 s 가 터지지 않게). 균일 층에서는
 *       s 가 이 범위 안이라 정확도는 그대로 [computed: 경계 밖 표본은 p_end 가 층 밖으로 나간 경우뿐].
 *  (D9) 아치 노드 고도는 GL2 정확값 (3 ∓ √3)/6 · dip (nodes.py 의 0.2113/0.7887 과 1e−5 차) — WP5 CPU 적분기도 같은 값을 써야 함.
 *  (D10) 샘플러 한도를 모르면(가짜 렌더러·capabilities 없음) WebGL2 최소 16 으로 봄. 하네스에서 한도를 넘으면 throw(조용히 끄지 않음 — eng m6).
 *  (D11) 아틀라스가 옵션(tsunN·tsunRangeKm·archLight)과 맞지 않거나 다른 장면(sceneSerial)의 것이면 setTsunAtlas 가 throw. 아틀라스를
 *       건 뒤 옵션을 바꾸면 아틀라스를 '무효'(gTsunOn = 0 = C0ps 빛)로 두고 tsunInfo().reason 에 남김 — 하네스(WP8)가 렌더 전에 확인.
 *       applyScene 은 아틀라스를 버립니다(틀·운량장이 바뀜) — 하네스는 setScene 뒤에 짓고 겁니다.
 *
 *  (D14, §179 검토 반영 2026-10-29 — 물리 검토 1~5·7~12, 요약에도 적음) ① 위 두 조각 쌍은 λ 무게 경로 W(gTsunPathW, GL 4 점)로 보간(U2g 관문) ·
 *       ② τ_c 표 hf 7 마디(U4h) · ③ 행진 끝 = jitter 없는 Σ 걸음(H_REACH) · ④ 아치 블록 네 조각 · ⑤ REF 의 너머·T_top 행진 mip 0(R1) ·
 *       ⑦ μ0 < 0 이면 T_top 을 가장 낮은 조각에서 · ⑧ 아치 캐시 sin(dip) 다시 맞춤 · ⑨ float(max(n, 1)) · ⑪ REF 끝 = 밀도 있는 레인 꼭대기 ·
 *       ⑫ 아치 옥타브 정적 단언. ⑥ 은 WP1 시험 U1g(fixture-test.mjs), ⑩(지구 그림자 경계를 걸친 조각)은 부호화를 바꾸지 않고 U2g 에서 따로 보고 —
 *       선형 필터가 부호 표지를 섞어 버리고, 표본 자신의 지구 그림자는 takram 표본별 해 조도가 이미 셈.
 *
 * 끄면(tsun 0 — 기본): 셰이더 글자(구름 조각·정점·그림자·대기·합친 효과)·균일변수·define 이 이 파일이 없던 트리와 바이트 같고 텍스처를 만들지 않음
 * (tools/shader-preview/verify-tsun-shader.js). 켜도 해 > shadowMinSunDeg 면 C0ps(accurateSunBelowDeg 12) 글자와 같음(U4g).
 */
import { Vector4, type Texture } from 'three';

/** 표지 — 주입한 줄마다 붙습니다(verify-tsun-shader.js 가 셉니다). */
export const TSUN_MARK = '§179';

// ───── 옵션 ─────
/** 닫힌 팔 목록(ruler-delta A1)의 새 손잡이 — 모든 잡이 모두를 명시합니다. */
export interface TsunOptions {
  /** T_sun 켜기(1). 해 ≤ shadowMinSunDeg 에서만 글자가 들어가고, 그때 표본별 해·하늘빛(ACCURATE)을 강제합니다. */
  tsun: 0 | 1;
  /** 아틀라스 한 변 텍셀 수(T1 128 · T2 256). */
  tsunN: 128 | 256;
  /** 해 줄 적분 끝 거리(km, 팔 400 = REF 와 같음). */
  tsunRangeKm: number;
  /** 아치 빛 팔(T1A). tsun 이 필요. */
  archLight: 0 | 1;
  /** 음성 대조 H0 — 아치의 τ_rest ≡ 0. archLight 가 필요. */
  archNoT: 0 | 1;
  /** 기준 렌더(WP6): 1 = REF_v2(후보 규칙 — V10b 같은 글자), 2 = REF_val(BSM 같은 규칙). 해 ≤ shadowMinSunDeg 에서만 글자(팔은 shadowMinSunDeg 90). */
  tsunRef: 0 | 1 | 2;
  /** REF 무차별 행진 보폭(m) — REF 200 · REF100 100. */
  tsunRefStepM: number;
  /** 진단 출력(WP8): 1 행진 끝 너머 투과율(R-A_T — 구현됨) · 2 아치만 · 3 τ_mid · 4 방향 바꾸기만 · 5 E_arch(T = 1) · 6 해 몫만 · 7 하늘 몫만(2~7 미구현 → throw). */
  tsunDebug: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
  /** 하네스가 잡마다 아틀라스를 동기로 짓는지(구축기 WP2·진입점 WP8 이 읽음). 셰이더와 무관. */
  tsunSync: boolean;
}
export const TSUN_OPTIONS_OFF: TsunOptions = { tsun: 0, tsunN: 128, tsunRangeKm: 400, archLight: 0, archNoT: 0, tsunRef: 0, tsunRefStepM: 200, tsunDebug: 0, tsunSync: false };
/**
 * 셰이더가 있는 값(D2) — §179 WP6 이 tsunRef 1·2(REF_v2·REF_val), WP8 이 tsunDebug 1(R-A_T)을 넓힘.
 * tsunDebug 2~7(아치 진단·GH 해/하늘 몫)은 이번 범위 밖(사용자 결정 2026-10-28: 하네스 R-A_T 경로만) — 여전히 throw(조용히 C0 이 되지 않게).
 */
export const TSUN_IMPLEMENTED = { tsunRef: [0, 1, 2] as number[], tsunDebug: [0, 1] as number[] };

/**
 * 옵션 점검(setOptions·생성 시 — 바꾸기 전에 합친 값으로 부름). 정해진 값 밖·의존 위반이면 throw(설계 v2 §4.2 · ruler-delta A2(h)).
 * 다른 옵션: genus(아틀라스 틀 = 종류 평면 틀), diffuse(L2·L3·9 는 thru 줄 앵커를 지움).
 */
export function validateTsunOptions(o: TsunOptions & { genus: boolean; diffuse: number }): void {
  const one = <T>(k: keyof TsunOptions, allowed: readonly T[]) => {
    const x = o[k] as unknown;
    if (!allowed.includes(x as T)) throw new Error(`cloudTsun: ${k} must be one of ${allowed.join('/')}, got ${JSON.stringify(x)}`);
  };
  one('tsun', [0, 1]); one('tsunN', [128, 256]); one('archLight', [0, 1]); one('archNoT', [0, 1]);
  one('tsunRef', [0, 1, 2]); one('tsunDebug', [0, 1, 2, 3, 4, 5, 6, 7]); one('tsunSync', [true, false]);
  const pos = (k: 'tsunRangeKm' | 'tsunRefStepM') => {
    const x = o[k] as unknown;
    if (typeof x !== 'number' || !Number.isFinite(x) || x <= 0) throw new Error(`cloudTsun: ${k} must be a finite number > 0, got ${JSON.stringify(x)}`);
  };
  pos('tsunRangeKm'); pos('tsunRefStepM');
  if (o.archLight && !o.tsun) throw new Error('cloudTsun: archLight requires tsun 1');
  if (o.archNoT && !o.archLight) throw new Error('cloudTsun: archNoT requires archLight 1');
  // REF 팔은 아틀라스를 읽지 않음(ruler-delta C1) — 후보 손잡이와 섞이면 어느 쪽도 아님.
  if (o.tsunRef && o.tsun) throw new Error('cloudTsun: tsunRef and tsun are exclusive (REF arms keep the other new knobs off)');
  // 진단 의존: 1 은 행진 끝 너머 τ 가 있어야(T 또는 REF), 2~5 는 아치 팔, 6·7(GH 해·하늘 몫)은 C0ps 에도.
  if (o.tsunDebug === 1 && !o.tsun && !o.tsunRef) throw new Error('cloudTsun: tsunDebug 1 requires tsun 1 or tsunRef');
  if (o.tsunDebug >= 2 && o.tsunDebug <= 5 && !o.archLight) throw new Error('cloudTsun: tsunDebug ' + o.tsunDebug + ' requires archLight 1');
  if ((o.tsun || o.tsunRef) && !o.genus) throw new Error('cloudTsun: tsun/tsunRef need genus (the atlas frame is the genus planar frame)');
  if ((o.tsun || o.tsunRef) && o.diffuse >= 2) throw new Error('cloudTsun: tsun/tsunRef require diffuse <= 1 (diffuse ' + o.diffuse + ' replaces the thru line anchor)');
  if (!TSUN_IMPLEMENTED.tsunRef.includes(o.tsunRef)) throw new Error('cloudTsun: tsunRef ' + o.tsunRef + ' is not implemented in this bundle (WP6) — refusing a void arm');
  if (!TSUN_IMPLEMENTED.tsunDebug.includes(o.tsunDebug)) throw new Error('cloudTsun: tsunDebug ' + o.tsunDebug + ' is not implemented in this bundle (WP8) — refusing a void arm');
}

// ───── WP0 샘플러 한도 ─────
/**
 * 구름 패스 조각 셰이더의 정적 활성 샘플러 수 — **ACCURATE_SUN_SKY_LIGHT 를 켠 상태**(T_sun 이 해 ≤ shadowMinSunDeg 에서 강제하는 상태,
 * low·medium 은 이때 irradiance_texture 가 하나 늘어남). [computed: verify-tsun-shader.js U0a — 만든 글자를 define 으로 전처리하고 main 에서
 * 닿는 함수의 texture 계열 호출을 따라간 정적 분석(§177.6 h 의 samplers.py 를 옮김). 끈 상태(낮 low) 12 · 13 · 15 는 그 분석과 같음.]
 * 정적 분석이라 컴파일러의 죽은 코드 제거를 못 봅니다 — 실제 활성 수는 B1 에서 gl.getProgramParameter(ACTIVE_UNIFORMS)로 (eng m6).
 */
export const TSUN_CLOUD_SAMPLERS: Record<'low' | 'medium' | 'high', number> = { low: 13, medium: 14, high: 15 };
/** WebGL2 가 보장하는 MAX_TEXTURE_IMAGE_UNITS 최솟값 — 한도를 모를 때(D10). */
export const WEBGL2_MIN_TEXTURE_UNITS = 16;
/** T_sun 이 더하는 샘플러(gTsunTex 하나 — 아치 팔도 같은 텍스처의 다른 줄). */
export const TSUN_EXTRA_SAMPLERS = 1;
/** 정적 수 + 1 > 한도면 throw(하네스 — 조용히 끄면 T 팔이 C0ps 가 됨, eng m6). 돌려주는 값은 기록용. */
export function checkTsunSamplerBudget(quality: 'low' | 'medium' | 'high', maxTextures: number | null | undefined): { count: number; limit: number; limitKnown: boolean } {
  const limitKnown = typeof maxTextures === 'number' && Number.isFinite(maxTextures) && maxTextures > 0;
  const limit = limitKnown ? (maxTextures as number) : WEBGL2_MIN_TEXTURE_UNITS;
  const base = TSUN_CLOUD_SAMPLERS[quality];
  if (base == null) throw new Error('cloudTsun: unknown quality ' + quality);
  const count = base + TSUN_EXTRA_SAMPLERS;
  if (count > limit) throw new Error(`cloudTsun: T_sun needs ${count} fragment samplers in the cloud pass (${quality} ${base} + ${TSUN_EXTRA_SAMPLERS}) but MAX_TEXTURE_IMAGE_UNITS is ${limit}${limitKnown ? '' : ' (unknown, WebGL2 minimum)'} — refusing (harness)`);
  return { count, limit, limitKnown };
}

// ───── 아틀라스(밖에서 받음 — 구축기 WP2 의 출력 형식) ─────
/** 해 블록 네 채널의 층 높이 비율 hf(v2.1 §4.4) — A 채널(hf 1.0) 이 층 꼭대기 = T_top. §179 고침(검토 물리 4): 아치 블록도 같은 네 높이. */
export const TSUN_SLICE_HF = [0.02, 0.35, 0.68, 1.0] as const;
/**
 * WP1 조건부 오프셋 τ_c 표의 절점 — hf × 행진 도달 0.25/0.5/1.1 km [from doc: v2.1 §1 M4]. §179 고침(검토 물리 2): 처음 판의 hf 3 마디(0.1/0.5/0.9)는
 * WP1 표 대비 |Δτ_c| p90 0.57·최대 2.07 [computed, review-physics exp5] — 끝 마디 고정(cu hf 0.05 참 0.00 대 0.87)이 가장 나빴음. hf 7 마디(0.05~0.95,
 * 0.15 간격, 양 끝은 층 안 — ns hf 0.05 τ_c 1.74 라 층 밖 0 으로 두는 것도 틀림)로. 셰이더는 등간격을 가정(아래 TSUN_COND_HF_STEP 점검).
 */
export const TSUN_COND_HF = [0.05, 0.2, 0.35, 0.5, 0.65, 0.8, 0.95] as const;
export const TSUN_COND_HF_STEP = 0.15;
export const TSUN_COND_REACH_KM = [0.25, 0.5, 1.1] as const;
/** τ_c 표 길이(hf 마디 × 도달 마디 × 레인 4) — 인덱스 (hfIdx·3 + reachIdx)·4 + lane. */
export const TSUN_COND_LEN = TSUN_COND_HF.length * TSUN_COND_REACH_KM.length * 4;
/**
 * §179 고침(검토 물리 1): 위 두 조각 쌍(hf 0.35~0.68·0.68~1.0)의 보간 좌표 W(h) = ∫ λ̂(hf(s)) ds 가 읽는 레인 단면 λ̂(c̄, hf)의 마디 수 —
 * hf = k/16 (k = 0..16), 성분 = 레인. u_true(기하만)는 hf 선형보다 나을 것이 없었음(U2g dT p95 0.12~0.37 [computed, review-physics exp3]) — 오차가
 * 기하가 아니라 연직 λ 단면(ac c 0.96: hf 0.5 에서 0.94 /km, 0.8 에서 0.11)에서 오기 때문. 가장 낮은 쌍(0.02~0.35)은 G 가 hf_eff 에도 기대서
 * λ 무게가 오히려 나빠(P3B +1.1° 0.046 → 0.207) u_true 를 그대로 둠(검토의 'hybrid').
 */
export const TSUN_PROF_N = 17;   // [decision] 9 마디(0.125 간격)는 P3B +0.3° 에서 p95 0.113, 17 마디 0.090(수치 적분 + 정확한 λ 의 바닥 0.087) [computed, scratchpad tsunimpl/fix/u2gv]
/** W(h) 의 구간 적분 — Gauss–Legendre 4 점([0, 1] 위 마디·무게). 셰이더와 CPU 거울(tsunAtlas.ts tsunPathWKm)이 같은 값. */
export const TSUN_GL4_X = [0.0694318442, 0.3300094782, 0.6699905218, 0.9305681558] as const;
export const TSUN_GL4_W = [0.1739274226, 0.3260725774, 0.3260725774, 0.1739274226] as const;
/** 아치 노드(GL2 고도 비율 × dip, D9) · 방위(줄 방향 기준 °) · 노드당 방위 폭(°). Ω = [−dip, 0] × ±30°(ruler-delta A2(c)). */
export const ARCH_GL2 = [(3 - Math.sqrt(3)) / 6, (3 + Math.sqrt(3)) / 6] as const;
export const ARCH_AZ_DEG = [-20, 0, 20] as const;
export const ARCH_AZ_WIDTH_DEG = 20;
/**
 * 아치 옥타브 수 — takram approximateMultipleScattering 의 MULTI_SCATTERING_OCTAVES(qualityPresets.ts: 모든 단계 8)와 같아야 함. 글자에 정적
 * 단언(#if … #error)을 넣어 다르면 컴파일 실패(§179 고침, 검토 물리 12).
 */
export const ARCH_OCTAVES = 8;
/** 아치 무게 w(θ) = smoothstep(−1°, −2°, θ_sun) (계약 켜짐 곡선, ruler-delta A2(e)) — θ 는 관측점 해 고도(°). */
export function archWeight(sunAltDeg: number): number {
  const t = Math.min(1, Math.max(0, (-1 - sunAltDeg) / 1));
  return t * t * (3 - 2 * t);
}

/**
 * T_sun 아틀라스 — 구축기(WP2 tsunAtlas.ts, 다음 단계)가 만들어 `VolumetricScene.setTsunAtlas` 로 넘기는 것.
 *
 * 텍스처 배치(D3): RGBA, 선형 필터, 가장자리 고정(clamp-to-edge), 밉맵 없음.
 *  - 너비 n·blocks: 레인 블록 b 가 열 [b·n, (b+1)·n). 레인 l 의 블록은 laneBlock[l](없으면 −1 — 그 레인 표본은 T_sun 없음 = 오늘 빛).
 *  - 높이 n·(arch ? 5 : 1): 줄 블록 0 = 해(R,G,B,A = τ_sun at hf 0.02/0.35/0.68/1.0, 그 텍셀 자리·그 높이에서 해 쪽으로 rangeKm 까지 모든 층의
 *    광학두께, 자기 층 안 경로 포함, 지구 그림자 제외), 1~4 = 아치 hf 0.02/0.35/0.68/1.0(TSUN_SLICE_HF — §179 고침, 검토 물리 4: 처음 판의 층 밑·꼭대기
 *    두 줄 선형 섞음은 τ_own 의 계단·τ_rest 의 비단조를 못 따라 ac 그룹 1 hf 0.5 에서 참 τ 56.7 대 0.64 [computed]) — 아치 블록 채널은
 *    (τ_own,1 · τ_rest,1 · τ_own,2 · τ_rest,2), 그룹 1·2 = 고도 −0.2113·dip · −0.7887·dip. τ 는 60 에서 자름(v2 §4.3).
 *  - 텍셀 (i, j) 의 자리: along = −halfKm + (i + 0.5)·texelKm(rowAxisEN 방향 = 해 방위), across = −halfKm + (j + 0.5)·texelKm
 *    (rowAxisEN 을 반시계 90° 돌린 (−y, x) 방향), texelKm = 2·halfKm/n. 원점 = centerKm.
 *  - 틀: centerKm 은 **종류 평면 틀**(셰이더 getGlobeUv × genusTileM — genusOrigin 에서 동·북 km, §173 고도 보정 원점, 관측점은 그 틀에서
 *    weatherOffsetKm·camKm 만큼 떨어진 자리)의 좌표. 에포크 틀(v2.1 eng M8): 한 아틀라스 안에서 고정.
 * τ_c(tauCond): 길이 TSUN_COND_LEN(84), 인덱스 (hfIdx·3 + reachIdx)·4 + lane — TSUN_COND_HF × TSUN_COND_REACH_KM 절점, 운량은 구축 쪽에서 보간(v2.1 §4.3).
 * λ̂ 단면(prof): 길이 TSUN_PROF_N·4(68), 인덱스 k·4 + lane = λ(c̄, hf k/16) [1/km] — 위 두 조각 쌍의 보간 좌표(§179 고침, 검토 물리 1).
 * 소유: 이 장면은 texture 를 dispose 하지 않습니다(만든 쪽 몫).
 */
export interface TsunAtlas {
  texture: Texture;
  /** 한 블록의 텍셀 수(= 옵션 tsunN). */
  n: number;
  /** 레인 블록 수(1~4). */
  blocks: number;
  /** 레인 0~3 → 블록(0..blocks−1) 또는 −1. */
  laneBlock: [number, number, number, number];
  /** 아틀라스 중심(종류 평면 동·북 km). */
  centerKm: [number, number];
  /** 줄 방향(해 방위) 단위 벡터(동, 북) — 구축 시점 clouds.sunDirection 을 genusEast·genusNorth 에 투영(v2.1 eng m9). */
  rowAxisEN: [number, number];
  /** 반폭(km) — maxRayKm + 4 권장(v2 §4.3). */
  halfKm: number;
  /** 적분 끝 거리(km) = 옵션 tsunRangeKm. */
  rangeKm: number;
  /** 아치 블록(줄 블록 1·2) 있음 — archLight 팔에 필요. */
  arch: boolean;
  /** τ_c 표(TSUN_COND_LEN). 없으면 0(오프셋 없음). */
  tauCond?: ArrayLike<number>;
  /** λ̂ 단면(TSUN_PROF_N·4). 없으면 0 — 그때 위 조각 쌍은 hf 선형으로 떨어짐(W 차 < 1e-3). */
  prof?: ArrayLike<number>;
  /** 이 아틀라스를 지은 장면(VolumetricScene.tsunSceneSerial()) — 다른 장면의 아틀라스를 걸면 throw(D11). */
  sceneSerial: number;
  /** 기록용(meta) — 셰이더와 무관. */
  meta?: {
    sha?: string; buildMs?: number; builder?: string; fixtureSha?: string; sunAzDeg?: number; sunAltDeg?: number;
    /** §179 WP2 구축기(tsunAtlas.ts) 기록 — 높이 칸 수 K · 해 줄이 땅에 닿은 텍셀·조각 비율 · 경고(법칙 없는 레인 등). */
    K?: number; earthShadowFrac?: number; warnings?: string[];
  };
}

/** 아틀라스 줄 블록 수 — 해 1 + 아치 네 조각(§179 고침, 검토 물리 4). */
export const tsunAtlasRows = (arch: boolean): number => (arch ? 1 + TSUN_SLICE_HF.length : 1);
/** 아틀라스 모양 점검(D11). 옵션과 안 맞거나 깨졌으면 throw. */
export function validateTsunAtlas(a: TsunAtlas, o: Pick<TsunOptions, 'tsunN' | 'tsunRangeKm' | 'archLight'>, sceneSerial: number): void {
  const bad = (m: string) => { throw new Error('cloudTsun: atlas ' + m); };
  if (!a || !a.texture) bad('texture missing');
  if (a.n !== o.tsunN) bad(`n ${a.n} != tsunN ${o.tsunN}`);
  if (!(Number.isInteger(a.blocks) && a.blocks >= 1 && a.blocks <= 4)) bad('blocks must be 1..4, got ' + a.blocks);
  if (!Array.isArray(a.laneBlock) || a.laneBlock.length !== 4 || !a.laneBlock.every(b => b === -1 || (Number.isInteger(b) && b >= 0 && b < a.blocks))) bad('laneBlock must be 4 × (−1 or 0..blocks−1)');
  if (!(a.halfKm > 0 && Number.isFinite(a.halfKm))) bad('halfKm must be > 0');
  if (Math.abs(a.rangeKm - o.tsunRangeKm) > 1e-9) bad(`rangeKm ${a.rangeKm} != tsunRangeKm ${o.tsunRangeKm}`);
  const [ax, ay] = a.rowAxisEN ?? [NaN, NaN];
  if (!(Math.abs(Math.hypot(ax, ay) - 1) < 1e-6)) bad('rowAxisEN must be a unit vector');
  if (!a.centerKm || !a.centerKm.every(Number.isFinite)) bad('centerKm must be finite');
  if (o.archLight && !a.arch) bad('has no arch blocks but archLight is 1');
  if (a.tauCond && (a.tauCond.length !== TSUN_COND_LEN || !Array.from(a.tauCond).every(Number.isFinite))) bad(`tauCond must have ${TSUN_COND_LEN} finite values`);
  if (a.prof && (a.prof.length !== TSUN_PROF_N * 4 || !Array.from(a.prof).every(x => Number.isFinite(x) && x >= 0))) bad(`prof must have ${TSUN_PROF_N * 4} finite values >= 0`);
  if (a.sceneSerial !== sceneSerial) bad(`was built for scene ${a.sceneSerial}, current scene is ${sceneSerial}`);
  const img = (a.texture as unknown as { image?: { width?: number; height?: number } }).image;
  if (img && typeof img.width === 'number' && typeof img.height === 'number') {
    const w = a.n * a.blocks, h = a.n * tsunAtlasRows(a.arch);
    if (img.width !== w || img.height !== h) bad(`texture ${img.width}×${img.height} != ${w}×${h}`);
    if (Math.max(w, h) > 2048) bad('texture larger than 2048 (WebGL2 MAX_TEXTURE_SIZE minimum)');
  }
}

// ───── 균일변수 ─────
/** 셰이더 설정 — 글자를 넣을 때만(해 ≤ shadowMinSunDeg · tsun 1 또는 tsunRef). ref 1·2 = REF_v2·REF_val(arch 없음), debug 1 = D-1(R-A_T). 없으면 0. */
export interface TsunShaderConfig { arch: boolean; ref?: 0 | 1 | 2; debug?: 0 | 1 }
export const TSUN_T_UNIFORMS = ['gTsunOn', 'gTsunTex', 'gTsunFrame', 'gTsunLaneBlock', 'gTsunEpoch', 'gTsunCond', 'gTsunProf'] as const;
export const TSUN_A_UNIFORMS = ['gArchW', 'gArchNoT'] as const;
/** §179 WP6 REF 팔 균일변수 — gTsunOn(늘 1) · gTsunRef(보폭 m, 끝 m, T_top 보폭 m, 0). 텍스처 없음. */
export const TSUN_R_UNIFORMS = ['gTsunOn', 'gTsunRef'] as const;
export const TSUN_ALL_UNIFORMS: readonly string[] = [...TSUN_T_UNIFORMS, ...TSUN_A_UNIFORMS, 'gTsunRef'];
export const tsunUniformNames = (cfg: TsunShaderConfig): string[] => (cfg.ref ? [...TSUN_R_UNIFORMS] : [...TSUN_T_UNIFORMS, ...(cfg.arch ? TSUN_A_UNIFORMS : [])]);
export type TsunUniformValues = Record<string, unknown>;
/**
 * 균일변수 값. atlas 가 null 이면 '아틀라스 없음' 상태 — gTsunOn 0(= C0ps 빛 그대로, I-T 는 원래 줄), 텍스처 null(three 가 빈 텍스처를 묶음,
 * 새로 만들지 않음). archW 는 w(θ)·archLight, archNoT 는 0|1.
 */
export function tsunUniformValues(atlas: TsunAtlas | null, archW: number, archNoT: number, ref: { stepM: number; rangeKm: number } | null = null): TsunUniformValues {
  const vec4s = (t: ArrayLike<number> | undefined, n: number) => Array.from({ length: n }, (_, k) => (t ? new Vector4(t[k * 4], t[k * 4 + 1], t[k * 4 + 2], t[k * 4 + 3]) : new Vector4(0, 0, 0, 0)));
  const cond = vec4s(atlas?.tauCond, TSUN_COND_LEN / 4);
  return {
    gTsunOn: atlas || ref ? 1 : 0,   // §179 WP6 REF 는 아틀라스 없이 늘 유효
    gTsunTex: atlas ? atlas.texture : null,
    gTsunFrame: atlas ? new Vector4(atlas.rowAxisEN[0], atlas.rowAxisEN[1], atlas.halfKm, (2 * atlas.halfKm) / atlas.n) : new Vector4(1, 0, 1, 1),
    gTsunLaneBlock: atlas ? new Vector4(...atlas.laneBlock) : new Vector4(-1, -1, -1, -1),
    gTsunEpoch: atlas ? new Vector4(atlas.centerKm[0], atlas.centerKm[1], atlas.rangeKm, 0) : new Vector4(0, 0, 400, 0),
    gTsunCond: cond,
    gTsunProf: vec4s(atlas?.prof, TSUN_PROF_N),
    gArchW: archW,
    gArchNoT: archNoT,
    gTsunRef: ref ? new Vector4(ref.stepM, ref.rangeKm * 1000, TSUN_REF_TOP_STEP_M, 0) : new Vector4(200, 400000, TSUN_REF_TOP_STEP_M, 0),
  };
}
type PatchableMaterial = { fragmentShader: string; uniforms: Record<string, { value: unknown }>; needsUpdate: boolean };
/**
 * 재질의 T_sun 균일변수를 지금 글자에 맞춥니다(cloudGenus refreshVariant 가 부름): 글자가 들어갔으면(cfg) 그 이름만 values 로 만들고/갱신,
 * 아니면 gTsun…·gArch… 를 모두 지움 — 끈 재질의 균일변수 목록이 이 기능이 없던 트리와 같도록(U4c).
 */
export function syncTsunUniforms(mat: PatchableMaterial, cfg: TsunShaderConfig | null, values: TsunUniformValues): void {
  const want = new Set(cfg ? tsunUniformNames(cfg) : []);
  let changed = false;
  for (const k of TSUN_ALL_UNIFORMS) {
    if (want.has(k)) {
      if (!mat.uniforms[k]) { mat.uniforms[k] = { value: values[k] }; changed = true; }
      else mat.uniforms[k].value = values[k];
    } else if (mat.uniforms[k]) { delete mat.uniforms[k]; changed = true; }
  }
  if (changed) mat.needsUpdate = true;
}

/** T_top 무차별 행진 보폭(m, ≤ 400 걸음 = 400 km — ruler-delta C1). REF 균일변수 gTsunRef.z(tsunUniformValues)와 셰이더(cloudTsunShader.ts)가 같은 값. */
export const TSUN_REF_TOP_STEP_M = 1000;

// ───── 셰이더 글자 등록(§179 검토 반영 회귀 1) ─────
/**
 * T_sun 셰이더 글자(cloudTsunShader.ts — 선언·도움 함수·I-0~I-4·REF·D-1 진단)는 **하네스만** 묶습니다: entry-tsun 과 시험이
 * installTsunShader() 로 여기에 주입 함수를 겁니다. 앱 묶음에는 이 작은 모듈(옵션·점검·균일변수)만 들어가고, 처음 판처럼 셰이더 글자
 * (+33 KB 축소)·구축기(tsunAtlas.ts)를 싣지 않습니다(사용자 결정 2026-10-28 '앱 길 없음'). 걸지 않은 채 T_sun 글자를 넣으려 하면 throw —
 * 조용히 C0 이 되지 않게(앱은 tsun 을 켜지 않으므로 여기에 닿지 않음).
 */
type TsunInjector = (base: string, cfg: TsunShaderConfig) => string;
let tsunInjector: TsunInjector | null = null;
export function registerTsunShader(f: TsunInjector | null): void { tsunInjector = f; }
export function tsunShaderInstalled(): boolean { return tsunInjector !== null; }
/** 주입 전 글자 → T_sun(+ 아치·REF·진단) 글자(cloudTsunShader.ts injectTsunText). cloudGenus refreshVariant 가 부름. */
export function injectTsun(base: string, cfg: TsunShaderConfig): string {
  if (!tsunInjector) throw new Error('cloudTsun: T_sun shader text is harness-only and not installed — call installTsunShader() from cloudTsunShader.ts (entry-tsun, verify scripts)');
  return tsunInjector(base, cfg);
}
