/**
 * cloudTsun.ts — §179 T_sun(해 줄 투과율 아틀라스) · 아치 빛 셰이더 주입 — **하네스 전용 도구, 기본 끔**(2026-10-28 사용자 결정).
 *
 * 설계: scratchpad `tsun2/design-v2.md` §3~§5 를 `design-v2.1.md` §4~§8 이 고친 것(v2.1 §4.3 이 v2 §5 의 I-2·I-T 를 대체).
 * 앱 길은 없습니다 — 스케줄러(WP3)·GPU 구축(WP2b)·개발 패널 칩 없음, DEFAULT_VOLUMETRIC_OPTIONS 는 모두 끔, 앱은 넘기지 않음.
 * 판정 회차도 없음 — 판정은 새 보류 사진이 있는 RULER-tsun2 에서. 여기서는 하네스(B0·B2 보정 렌더)가 쓸 글자와 균일변수만.
 *
 * 무엇을 하나(V10b, 해 고도 ≤ shadowMinSunDeg 일 때만 글자가 들어감 — v2.1 eng m2, 위에서는 C0ps 글자와 바이트 같음):
 *  - I-2  2차 행진 끝(p_end) 너머 해 줄의 광학두께 τ(아틀라스 한 번 읽기 + 층 안 경로 u_true 보간 + WP1 조건부 오프셋 τ_c)를
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
 *  (D2) tsunRef(REF_v2·REF_val, WP6)와 tsunDebug(R-A_T 등, WP8)는 이번 단계에 셰이더가 없어 0 이 아니면 throw(조용히 C0 이 되지 않게 —
 *       `TSUN_IMPLEMENTED` 를 다음 단계가 넓힘). 값 범위·의존 점검은 지금부터 함.
 *  (D3) v2.1 은 아틀라스 재사용(eng M3)과 A/B 반쪽(gTsunMix·gTsunHalfB)을 뺐고, 앱 스케줄러가 없으므로 텍스처는 반쪽 없이 한 벌:
 *       너비 n·blocks, 높이 n·(arch ? 3 : 1). 그래서 T 팔의 I-0 은 비울 것이 없어 **주입하지 않음**(아치 팔만 I-0 수 1, T 팔 0).
 *  (D4) gTsunEpochOrigin(vec2) 대신 vec4 gTsunEpoch = (중심 동 km, 중심 북 km, tsunRangeKm, 0) — u_true 가 행진 끝 거리를 알아야 해서.
 *       T 팔 균일변수 6 개(gTsunOn·gTsunTex·gTsunFrame·gTsunLaneBlock·gTsunEpoch·gTsunCond[9]) + 아치 2 개(gArchW·gArchNoT) — v2.1 §4.3 수와 같음.
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
 * 끄면(tsun 0 — 기본): 셰이더 글자(구름 조각·정점·그림자·대기·합친 효과)·균일변수·define 이 이 파일이 없던 트리와 바이트 같고 텍스처를 만들지 않음
 * (tools/shader-preview/verify-tsun-shader.js). 켜도 해 > shadowMinSunDeg 면 C0ps(accurateSunBelowDeg 12) 글자와 같음(U4g).
 */
import { Vector4, type Texture } from 'three';
import { DIFFUSE_G } from './cloudDiffuse';

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
  /** 기준 렌더(WP6): 1 = REF_v2(후보 규칙), 2 = REF_val(BSM 같은 규칙). 이번 단계에는 셰이더가 없어 0 만(D2). */
  tsunRef: 0 | 1 | 2;
  /** REF 무차별 행진 보폭(m) — REF 200 · REF100 100. */
  tsunRefStepM: number;
  /** 진단 출력(WP8): 1 행진 끝 너머 투과율(R-A_T) · 2 아치만 · 3 τ_mid · 4 방향 바꾸기만 · 5 E_arch(T = 1) · 6 해 몫만 · 7 하늘 몫만. 이번 단계 0 만(D2). */
  tsunDebug: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
  /** 하네스가 잡마다 아틀라스를 동기로 짓는지(구축기 WP2·진입점 WP8 이 읽음). 셰이더와 무관. */
  tsunSync: boolean;
}
export const TSUN_OPTIONS_OFF: TsunOptions = { tsun: 0, tsunN: 128, tsunRangeKm: 400, archLight: 0, archNoT: 0, tsunRef: 0, tsunRefStepM: 200, tsunDebug: 0, tsunSync: false };
/** 이번 단계에 셰이더가 있는 값(D2) — WP6·WP8 이 넓힙니다. */
export const TSUN_IMPLEMENTED = { tsunRef: [0] as number[], tsunDebug: [0] as number[] };

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
/** 해 블록 네 채널의 층 높이 비율 hf(v2.1 §4.4) — A 채널(hf 1.0) 이 층 꼭대기 = T_top. */
export const TSUN_SLICE_HF = [0.02, 0.35, 0.68, 1.0] as const;
/** WP1 조건부 오프셋 τ_c 표의 절점 [from doc: v2.1 §1 M4 · v21/lam_v21] — hf 0.1/0.5/0.9 × 행진 도달 0.25/0.5/1.1 km. */
export const TSUN_COND_HF = [0.1, 0.5, 0.9] as const;
export const TSUN_COND_REACH_KM = [0.25, 0.5, 1.1] as const;
/** 아치 노드(GL2 고도 비율 × dip, D9) · 방위(줄 방향 기준 °) · 노드당 방위 폭(°). Ω = [−dip, 0] × ±30°(ruler-delta A2(c)). */
export const ARCH_GL2 = [(3 - Math.sqrt(3)) / 6, (3 + Math.sqrt(3)) / 6] as const;
export const ARCH_AZ_DEG = [-20, 0, 20] as const;
export const ARCH_AZ_WIDTH_DEG = 20;
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
 *  - 높이 n·(arch ? 3 : 1): 줄 블록 0 = 해(R,G,B,A = τ_sun at hf 0.02/0.35/0.68/1.0, 그 텍셀 자리·그 높이에서 해 쪽으로 rangeKm 까지 모든 층의
 *    광학두께, 자기 층 안 경로 포함, 지구 그림자 제외), 1 = 아치 층 밑(hf 0), 2 = 아치 층 꼭대기(hf 1) — 아치 블록 채널은
 *    (τ_own,1 · τ_rest,1 · τ_own,2 · τ_rest,2), 그룹 1·2 = 고도 −0.2113·dip · −0.7887·dip. τ 는 60 에서 자름(v2 §4.3).
 *  - 텍셀 (i, j) 의 자리: along = −halfKm + (i + 0.5)·texelKm(rowAxisEN 방향 = 해 방위), across = −halfKm + (j + 0.5)·texelKm
 *    (rowAxisEN 을 반시계 90° 돌린 (−y, x) 방향), texelKm = 2·halfKm/n. 원점 = centerKm.
 *  - 틀: centerKm 은 **종류 평면 틀**(셰이더 getGlobeUv × genusTileM — genusOrigin 에서 동·북 km, §173 고도 보정 원점, 관측점은 그 틀에서
 *    weatherOffsetKm·camKm 만큼 떨어진 자리)의 좌표. 에포크 틀(v2.1 eng M8): 한 아틀라스 안에서 고정.
 * τ_c(tauCond): 길이 36, 인덱스 (hfIdx·3 + reachIdx)·4 + lane — TSUN_COND_HF × TSUN_COND_REACH_KM 절점, 운량은 구축 쪽에서 보간(v2.1 §4.3).
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
  /** τ_c 표(36). 없으면 0(오프셋 없음). */
  tauCond?: ArrayLike<number>;
  /** 이 아틀라스를 지은 장면(VolumetricScene.tsunSceneSerial()) — 다른 장면의 아틀라스를 걸면 throw(D11). */
  sceneSerial: number;
  /** 기록용(meta) — 셰이더와 무관. */
  meta?: { sha?: string; buildMs?: number; builder?: string; fixtureSha?: string; sunAzDeg?: number; sunAltDeg?: number };
}

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
  if (a.tauCond && (a.tauCond.length !== 36 || !Array.from(a.tauCond).every(Number.isFinite))) bad('tauCond must have 36 finite values');
  if (a.sceneSerial !== sceneSerial) bad(`was built for scene ${a.sceneSerial}, current scene is ${sceneSerial}`);
  const img = (a.texture as unknown as { image?: { width?: number; height?: number } }).image;
  if (img && typeof img.width === 'number' && typeof img.height === 'number') {
    const w = a.n * a.blocks, h = a.n * (a.arch ? 3 : 1);
    if (img.width !== w || img.height !== h) bad(`texture ${img.width}×${img.height} != ${w}×${h}`);
    if (Math.max(w, h) > 2048) bad('texture larger than 2048 (WebGL2 MAX_TEXTURE_SIZE minimum)');
  }
}

// ───── 균일변수 ─────
/** 셰이더 설정 — 글자를 넣을 때만(해 ≤ shadowMinSunDeg · tsun 1). */
export interface TsunShaderConfig { arch: boolean }
export const TSUN_T_UNIFORMS = ['gTsunOn', 'gTsunTex', 'gTsunFrame', 'gTsunLaneBlock', 'gTsunEpoch', 'gTsunCond'] as const;
export const TSUN_A_UNIFORMS = ['gArchW', 'gArchNoT'] as const;
export const TSUN_ALL_UNIFORMS: readonly string[] = [...TSUN_T_UNIFORMS, ...TSUN_A_UNIFORMS];
export const tsunUniformNames = (cfg: TsunShaderConfig): string[] => [...TSUN_T_UNIFORMS, ...(cfg.arch ? TSUN_A_UNIFORMS : [])];
export type TsunUniformValues = Record<string, unknown>;
/**
 * 균일변수 값. atlas 가 null 이면 '아틀라스 없음' 상태 — gTsunOn 0(= C0ps 빛 그대로, I-T 는 원래 줄), 텍스처 null(three 가 빈 텍스처를 묶음,
 * 새로 만들지 않음). archW 는 w(θ)·archLight, archNoT 는 0|1.
 */
export function tsunUniformValues(atlas: TsunAtlas | null, archW: number, archNoT: number): TsunUniformValues {
  const cond = Array.from({ length: 9 }, (_, k) => {
    const t = atlas?.tauCond;
    return t ? new Vector4(t[k * 4], t[k * 4 + 1], t[k * 4 + 2], t[k * 4 + 3]) : new Vector4(0, 0, 0, 0);
  });
  return {
    gTsunOn: atlas ? 1 : 0,
    gTsunTex: atlas ? atlas.texture : null,
    gTsunFrame: atlas ? new Vector4(atlas.rowAxisEN[0], atlas.rowAxisEN[1], atlas.halfKm, (2 * atlas.halfKm) / atlas.n) : new Vector4(1, 0, 1, 1),
    gTsunLaneBlock: atlas ? new Vector4(...atlas.laneBlock) : new Vector4(-1, -1, -1, -1),
    gTsunEpoch: atlas ? new Vector4(atlas.centerKm[0], atlas.centerKm[1], atlas.rangeKm, 0) : new Vector4(0, 0, 400, 0),
    gTsunCond: cond,
    gArchW: archW,
    gArchNoT: archNoT,
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

// ───── 셰이더 글자 ─────
/** 앵커(구름 패스 정확히 한 번 · 그림자 패스 0 번 — U4a). three-clouds 0.7.6 clouds.frag 줄 번호. */
/** 파일 범위 선언 자리(v2.1 eng m4) — clouds.frag 출력 선언, 구름 패스만. */
export const TSUN_DECL_ANCHOR = 'layout(location = 0) out vec4 outputColor;';
/** 도움 함수 자리(phaseFunction·GetSkyRadiance·getGlobeUv 뒤) — marchClouds 정의 바로 앞(얼음·확산 주입도 이 글자 앞에 넣지만 글자는 남음). */
export const TSUN_HELPER_ANCHOR = 'vec4 marchClouds(';
/** I-0 (main, clouds.frag:870) — grain 앵커와 겹치지 않음. */
export const TSUN_I0_ANCHOR = '    vec3 rayOrigin = rayNearFar.x * rayDirection + cameraPosition;';
/** I-1 (marchClouds, :536–538) — 2차 행진 호출의 방향 인자. */
export const TSUN_I1_ANCHOR = '      float opticalDepth = marchOpticalDepth(\n        position,\n        sunDirection,';
/** I-2 (:558, 얼음 무리 ICE_RAD 와 같은 줄) — 이 줄 **앞**에 넣음. */
export const TSUN_I2_ANCHOR = '      vec3 radiance = sunIrradiance * approximateMultipleScattering(opticalDepth, cosTheta);';
/** I-T — 종류 thru 줄(cloudGenus.ts THRU_BLOCK, 구름 패스만). */
export const TSUN_IT_ANCHOR = '        radiance += sunIrradiance * RECIPROCAL_PI4 * dot(gThru, media.weight);';
/** I-4 (:579) — 이 줄 **앞**에 넣음. */
export const TSUN_I4_ANCHOR = '      radiance *= media.scattering;';
/** 비용 셈 줄(WP8 entry-tsun 이 바로 뒤에 `++gCostTsun;` 을 붙임, ruler-delta B1) — 해 블록 읽기 하나. */
export const TSUN_COUNT_LINE = '          vec4 gTsunTexel = textureLod(gTsunTex, gTsunUv, 0.0);';

const M = TSUN_MARK;
const f6 = (x: number) => x.toFixed(10);
const DECL_T = [
  `// ${M} T_sun 선언(cloudTsun.ts — 하네스 전용, 기본 끔, 해 ≤ shadowMinSunDeg 에서만 주입)`,
  'uniform float gTsunOn;          // 1 = 아틀라스 유효, 0 = 없음(C0ps 빛 그대로)',
  'uniform sampler2D gTsunTex;     // 해 블록(+ 아치 블록 둘), 레인 블록은 가로로',
  'uniform vec4 gTsunFrame;        // 줄 방향(동, 북) · 반폭 km · 텍셀 km',
  'uniform vec4 gTsunLaneBlock;    // 레인 → 블록(−1 = 없음)',
  'uniform vec4 gTsunEpoch;        // 아틀라스 중심(종류 평면 동·북 km) · 적분 끝 km · 0',
  'uniform vec4 gTsunCond[9];      // τ_c [hf 0.1/0.5/0.9 × 도달 0.25/0.5/1.1 km], 성분 = 레인',
];
const DECL_A = [
  `// ${M} 아치 빛 선언`,
  'uniform float gArchW;           // archLight · smoothstep(−1°, −2°, θ_sun)',
  'uniform float gArchNoT;         // H0: τ_rest ≡ 0',
  'vec3 gArchC[16];                // [그룹·8 + 옥타브] Σ_방위 aⁱ·p(cos; cⁱ)·L·dΩ — 광선마다 채움',
  'vec3 gArchCP = vec3(0.0);',
  'float gArchCH = 0.0;',
  'float gArchCL = -1.0;',
  'bool gArchCOk = false;',
];
const S = TSUN_SLICE_HF;
const HELPERS_T = [
  `// ${M} T_sun 도움 함수(cloudTsun.ts)`,
  '// 가장 무거운 레인(첫 최댓값)의 원핫.',
  'vec4 gTsunLaneSel(const vec4 w) {',
  '  float m = max(max(w.x, w.y), max(w.z, w.w));',
  '  return w.x >= m ? vec4(1.0, 0.0, 0.0, 0.0) : w.y >= m ? vec4(0.0, 1.0, 0.0, 0.0) : w.z >= m ? vec4(0.0, 0.0, 1.0, 0.0) : vec4(0.0, 0.0, 0.0, 1.0);',
  '}',
  '// u_true: 높이 h0(km)에서 국소 해 고도 사인 sinE 로 곧게 D km 가는 선이 구면 껍질 [hb, ht] 안에 머무는 길이(km) — 닫힌 꼴, 모든 부호(v2.1 phys M2).',
  '// ρ² − r0² 를 (ρ − r0)(ρ + r0) 로 높이 차에서 셈(단정밀 상쇄를 피함).',
  'float gTsunPath(const float h0, const float sinE, const float hb, const float ht, const float D) {',
  '  float Rb = bottomRadius * 1e-3;',
  '  float b = (Rb + h0) * sinE;',
  '  float discT = b * b + (ht - h0) * (2.0 * Rb + ht + h0);',
  '  if (discT <= 0.0) return 0.0;',
  '  float qT = sqrt(discT);',
  '  float len = max(0.0, min(-b + qT, D) - max(-b - qT, 0.0));',
  '  float discB = b * b + (hb - h0) * (2.0 * Rb + hb + h0);',
  '  if (discB > 0.0) {',
  '    float qB = sqrt(discB);',
  '    len -= max(0.0, min(-b + qB, D) - max(-b - qB, 0.0));',
  '  }',
  '  return max(len, 0.0);',
  '}',
  '// 아틀라스 uv — 종류 평면 km → 줄(해 방위)·가로 좌표 → 블록 안 텍셀(반 텍셀 안쪽으로 고정, 레인끼리 새지 않게).',
  'vec2 gTsunUvOf(const vec3 p, const float blk, const float row) {',
  '  vec2 km = getGlobeUv(p) * genusTileM * 1e-3 - gTsunEpoch.xy;',
  '  vec2 ax = gTsunFrame.xy;',
  '  vec2 g = (vec2(dot(km, ax), dot(km, vec2(-ax.y, ax.x))) + gTsunFrame.z) / gTsunFrame.w;',
  '  float n = floor(2.0 * gTsunFrame.z / gTsunFrame.w + 0.5);',
  '  g = clamp(g, vec2(0.5), vec2(n - 0.5));',
  '  vec2 sz = vec2(textureSize(gTsunTex, 0));',
  '  return vec2(blk * n + g.x, row * n + g.y) / sz;',
  '}',
  `// 조각 τ 를 층 안 경로 u_true 로 보간(조각 hf ${S.join('/')}). |Δu| < 1e-3 km 이면 hf 선형. 보간 계수는 [−1, 2] 로(D8).`,
  'float gTsunSliceTau(const vec4 t, const float he, const float hb, const float ht, const float sinE, const float D) {',
  '  float H = max(ht - hb, 1e-3);',
  '  float f = clamp((he - hb) / H, 0.0, 1.0);',
  `  vec2 fk = f < ${S[1].toFixed(2)} ? vec2(${S[0].toFixed(2)}, ${S[1].toFixed(2)}) : f < ${S[2].toFixed(2)} ? vec2(${S[1].toFixed(2)}, ${S[2].toFixed(2)}) : vec2(${S[2].toFixed(2)}, ${S[3].toFixed(2)});`,
  `  vec2 tk = f < ${S[1].toFixed(2)} ? t.xy : f < ${S[2].toFixed(2)} ? t.yz : t.zw;`,
  '  float u0 = gTsunPath(hb + fk.x * H, sinE, hb, ht, D);',
  '  float u1 = gTsunPath(hb + fk.y * H, sinE, hb, ht, D);',
  '  float du = u1 - u0;',
  '  float s = abs(du) < 1e-3 ? (f - fk.x) / (fk.y - fk.x) : (gTsunPath(he, sinE, hb, ht, D) - u0) / du;',
  '  return max(0.0, mix(tk.x, tk.y, clamp(s, -1.0, 2.0)));',
  '}',
  `// τ_c(hf, 도달) — 절점 hf ${TSUN_COND_HF.join('/')} × 도달 ${TSUN_COND_REACH_KM.join('/')} km 의 쌍선형(끝에서 고정), 성분 = 레인.`,
  'vec3 gTsunTent(const float x, const vec3 k) {',
  '  float w0 = clamp((k.y - x) / (k.y - k.x), 0.0, 1.0), w2 = clamp((x - k.y) / (k.z - k.y), 0.0, 1.0);',
  '  return vec3(w0, 1.0 - w0 - w2, w2);',
  '}',
  'vec4 gTsunCondAt(const float hf, const float reachKm) {',
  `  vec3 a = gTsunTent(hf, vec3(${TSUN_COND_HF.map(x => x.toFixed(2)).join(', ')}));`,
  `  vec3 r = gTsunTent(reachKm, vec3(${TSUN_COND_REACH_KM.map(x => x.toFixed(2)).join(', ')}));`,
  '  return a.x * (r.x * gTsunCond[0] + r.y * gTsunCond[1] + r.z * gTsunCond[2])',
  '       + a.y * (r.x * gTsunCond[3] + r.y * gTsunCond[4] + r.z * gTsunCond[5])',
  '       + a.z * (r.x * gTsunCond[6] + r.y * gTsunCond[7] + r.z * gTsunCond[8]);',
  '}',
  `// Eddington 확산 투과(보존 산란, g ${DIFFUSE_G} = cloudDiffuse.ts) — 확산 몫만: max(1 − R − e^(−τ/μ), 0).`,
  'vec4 gTsunEddDiff(const vec4 tau, const float mu) {',
  '  float m = max(mu, 1e-3);',
  '  vec4 e = exp(-tau / m);',
  `  vec4 R = (${(1 - DIFFUSE_G).toFixed(4)} * tau + (2.0 / 3.0 - mu) * (vec4(1.0) - e)) / (4.0 / 3.0 + ${(1 - DIFFUSE_G).toFixed(4)} * tau);`,
  '  return max(vec4(1.0) - R - e, vec4(0.0));',
  '}',
  '// 2차 행진이 덮은 거리(m) — marchOpticalDepth 와 같은 식: 마지막 표본 거리 + 마지막 걸음. 걸음 0(퍼지 τ 0.5)이면 0(sunRayDistance 를 읽지 않음).',
  'float gTsunReach(const float mipLevel, const float jitter, const float sunRayDistance) {',
  '  int n = int(max(0.0, remap(mipLevel, 0.0, 1.0, float(maxIterationCountToSun + 1), 1.0) - jitter));',
  '  return n > 0 ? sunRayDistance + minSecondaryStepSize / float(n) * pow(secondaryStepScale, float(n - 1)) : 0.0;',
  '}',
];
const HELPERS_A = [
  `// ${M} 아치 빛 도움 함수 — GetTransmittanceToSun 의 지구 그림자 smoothstep 을 ALU 로 옮긴 것(vis).`,
  'float gArchVis(const vec3 p) {',
  '  float r = length(p) * METER_TO_LENGTH_UNIT;',
  '  float sh = ATMOSPHERE.bottom_radius / r;',
  '  float ch = -sqrt(max(1.0 - sh * sh, 0.0));',
  '  float a = sh * ATMOSPHERE.sun_angular_radius;',
  '  return smoothstep(-a, a, dot(normalize(p), sunDirection) - ch);',
  '}',
  'float gArchDip(const vec3 p) {',
  '  return acos(clamp(ATMOSPHERE.bottom_radius / (length(p) * METER_TO_LENGTH_UNIT), 0.0, 1.0));',
  '}',
  '// 아치 방위 = 아틀라스 줄 방향(구축 시 해 방위)을 그 자리 접평면에.',
  'vec3 gArchRowAxis(const vec3 n) {',
  '  vec3 a = genusEast * gTsunFrame.x + genusNorth * gTsunFrame.y;',
  '  return normalize(a - n * dot(n, a));',
  '}',
  '// 방향 바꾸기의 끝 방향 — 고도 −dip/2, 줄 방향.',
  'vec3 gArchDirMid(const vec3 p) {',
  '  vec3 n = normalize(p);',
  '  float e = -0.5 * gArchDip(p);',
  '  return cos(e) * gArchRowAxis(n) + sin(e) * n;',
  '}',
  `// 노드 6 개(고도 GL2 ${ARCH_GL2.map(f6).join('/')} × dip, 방위 ${ARCH_AZ_DEG.join('/')}°, 노드 폭 ${ARCH_AZ_WIDTH_DEG}°) — dΩ = sin(dip)/2 × 폭.`,
  '// gArchC[g·8 + i] = Σ_방위 aⁱ·phaseFunction(cos, cⁱ)·L·dΩ (a = c = 0.5, takram 옥타브와 같음).',
  'void gArchFill(const vec3 p, const vec3 rayDir) {',
  '  vec3 n = normalize(p), a = gArchRowAxis(n), b = cross(n, a);',
  '  float dip = gArchDip(p);',
  `  float dOm = sin(dip) * 0.5 * radians(${ARCH_AZ_WIDTH_DEG.toFixed(1)});`,
  '  for (int k = 0; k < 16; ++k) gArchC[k] = vec3(0.0);',
  '  for (int g = 0; g < 2; ++g) {',
  `    float e = -dip * (g == 0 ? ${f6(ARCH_GL2[0])} : ${f6(ARCH_GL2[1])});`,
  '    for (int j = 0; j < 3; ++j) {',
  `      float az = radians(${ARCH_AZ_DEG[0].toFixed(1)} + ${ARCH_AZ_WIDTH_DEG.toFixed(1)} * float(j));`,
  '      vec3 w = cos(e) * (cos(az) * a + sin(az) * b) + sin(e) * n;',
  '      vec3 tr;',
  '      vec3 Lw = GetSkyRadiance(p * METER_TO_LENGTH_UNIT, w, 0.0, sunDirection, tr) * dOm;',
  '      float cv = dot(w, rayDir);',
  '      float ai = 1.0;',
  '      for (int i = 0; i < 8; ++i) {',
  '        gArchC[g * 8 + i] += ai * phaseFunction(cv, ai) * Lw;',
  '        ai *= 0.5;',
  '      }',
  '    }',
  '  }',
  '}',
];
/** I-0 — 아치 팔만(D3). */
const I0 = [TSUN_I0_ANCHOR, `    gArchCOk = false;   // ${M} I-0 아치 노드 캐시(광선마다)`];
/** I-1 — 아치 팔만: vis·r·gMarchDir 선언, 2차 행진 방향 인자를 gMarchDir 로. */
const I1 = [
  `      // ${M} I-1 아치 빛 방향 바꾸기(연속, v2.1 eng M7) — r = w(θ)·(1 − vis); r = 0 이면 sunDirection 그대로(비트 같음). 아틀라스가 없으면 r = 0.`,
  '      float gVis = gArchVis(position);',
  '      float gArchR = gTsunOn > 0.5 ? gArchW * (1.0 - gVis) : 0.0;',
  '      vec3 gMarchDir = sunDirection;',
  '      if (gArchR > 0.0) gMarchDir = normalize(mix(sunDirection, gArchDirMid(position), gArchR));',
  '      float opticalDepth = marchOpticalDepth(\n        position,\n        gMarchDir,',
];
/** I-2 — MS 줄 앞. T 팔은 여기서 gMarchDir 을 선언(eng M1), 아치 팔은 I-1 이 선언. */
const I2 = (arch: boolean) => [
  `      // ${M} I-2 T_sun — 행진 끝 너머 해 줄 τ(아틀라스 한 번 + u_true 보간 + τ_c)를 직달 햇빛에 Beer 로(MS 옥타브·무리). opticalDepth 에는 안 더함.`,
  ...(arch ? [] : ['      vec3 gMarchDir = sunDirection;']),
  '      vec3 gTsunIrrUncut = sunIrradiance;',
  '      float gTsunTtop = 1.0;',
  '      float gTsunW = 0.0;',
  '      float gTsunMu0 = dot(surfaceNormal, sunDirection);',
  '      if (gTsunOn > 0.5 && max(sunIrradiance.r, max(sunIrradiance.g, sunIrradiance.b)) > 0.0) {',
  '        vec4 gTsunSel = gTsunLaneSel(media.weight);',
  '        float gTsunBlk = dot(gTsunLaneBlock, gTsunSel);',
  '        if (gTsunBlk >= 0.0) {',
  '          float gTsunReachM = gTsunReach(mipLevel, jitter, sunRayDistance);',
  '          vec3 gTsunEnd = position + gMarchDir * gTsunReachM;',
  '          vec2 gTsunUv = gTsunUvOf(gTsunEnd, gTsunBlk, 0.0);',
  TSUN_COUNT_LINE,
  '          float gTsunHb = dot(minLayerHeights, gTsunSel) * 1e-3;',
  '          float gTsunHt = dot(maxLayerHeights, gTsunSel) * 1e-3;',
  '          float gTsunHe = (length(gTsunEnd) - bottomRadius) * 1e-3;',
  '          float gTsunTau = gTsunSliceTau(gTsunTexel, gTsunHe, gTsunHb, gTsunHt, dot(normalize(gTsunEnd), sunDirection), gTsunEpoch.z);',
  '          float gTsunHf = (gTsunHe - gTsunHb) / max(gTsunHt - gTsunHb, 1e-3);',
  '          float gTsunOwn = step(0.0, gTsunHf) * step(gTsunHf, 1.0);',
  '          gTsunTau = max(0.0, gTsunTau + dot(gTsunCondAt(clamp(gTsunHf, 0.0, 1.0), gTsunReachM * 1e-3), gTsunSel) * gTsunOwn);',
  '          sunIrradiance *= exp(-gTsunTau);',
  '          gTsunTtop = exp(-gTsunTexel.a);',
  '          gTsunW = 1.0 - exp(-gTsunTau);',
  '        }',
  '      }',
  TSUN_I2_ANCHOR,
];
/** I-T — V10b. else 가지에 원래 줄 그대로(U4e). */
const IT = [
  `        // ${M} I-T V10b — mix(오늘 thru, Eddington 확산 투과 × T_top × |μ0|/π, 1 − e^(−τ_far)). 해 쪽 기둥: μ0 ≥ 0 이면 위, 아니면 아래(D7).`,
  '        if (gTsunOn > 0.5) {',
  '          vec4 gTsunTauBelow = media.extinction * max(weather.heightFraction, vec4(0.0)) * gLayerH;',
  '          float gTsunMuA = abs(gTsunMu0);',
  '          vec4 gTsunTd = gTsunEddDiff(gTsunMu0 >= 0.0 ? gTau : gTsunTauBelow, gTsunMuA);',
  '          radiance += mix(gTsunIrrUncut * RECIPROCAL_PI4 * dot(gThru, media.weight),',
  '                          gTsunIrrUncut * gTsunTtop * (gTsunMuA * RECIPROCAL_PI) * dot(genusThru * genusOn * gTsunTd, media.weight),',
  '                          gTsunW);',
  '        } else {',
  TSUN_IT_ANCHOR,
  '        }',
];
/** I-4 — 아치 팔만, `radiance *= media.scattering;` 앞(§168 역광 어둡게 뒤, 어둡게 하지 않음). */
const I4 = [
  `      // ${M} I-4 아치 빛 — S = Σ_g [Σ_i C_g,i·exp(−bⁱ(τ_mid + τ_own,g))]·exp(−τ_rest,g), radiance += r·S (r = w(θ)·(1 − vis)).`,
  '      if (gArchR > 0.0) {',
  '        vec4 gArchSel = gTsunLaneSel(media.weight);',
  '        float gArchBlk = dot(gTsunLaneBlock, gArchSel);',
  '        if (gArchBlk >= 0.0) {',
  '          float gArchL = dot(gArchSel, vec4(0.0, 1.0, 2.0, 3.0));',
  '          if (!gArchCOk || gArchL != gArchCL || abs(height - gArchCH) > 1000.0 || distance(position, gArchCP) > 10000.0) {',
  '            gArchFill(position, rayDirection);',
  '            gArchCOk = true;',
  '            gArchCL = gArchL;',
  '            gArchCH = height;',
  '            gArchCP = position;',
  '          }',
  '          vec3 gArchEnd = position + gMarchDir * gTsunReach(mipLevel, jitter, sunRayDistance);',
  '          float gArchHb = dot(minLayerHeights, gArchSel), gArchHt = dot(maxLayerHeights, gArchSel);',
  '          float gArchHf = clamp((length(gArchEnd) - bottomRadius - gArchHb) / max(gArchHt - gArchHb, 1.0), 0.0, 1.0);',
  '          vec4 gArchAB = mix(textureLod(gTsunTex, gTsunUvOf(gArchEnd, gArchBlk, 1.0), 0.0), textureLod(gTsunTex, gTsunUvOf(gArchEnd, gArchBlk, 2.0), 0.0), gArchHf);',
  '          if (gArchNoT > 0.5) gArchAB.yw = vec2(0.0);',
  '          vec3 gArchS = vec3(0.0);',
  '          float gArchB = 1.0;',
  '          for (int gArchI = 0; gArchI < 8; ++gArchI) {',
  '            gArchS += gArchC[gArchI] * exp(-gArchB * (opticalDepth + gArchAB.x) - gArchAB.y)',
  '                    + gArchC[8 + gArchI] * exp(-gArchB * (opticalDepth + gArchAB.z) - gArchAB.w);',
  '            gArchB *= 0.5;',
  '          }',
  '          radiance += gArchR * gArchS;',
  '        }',
  '      }',
  TSUN_I4_ANCHOR,
];

const countOf = (s: string, a: string) => s.split(a).length - 1;
function replaceOnce(src: string, anchor: string, to: string, tag: string): string {
  const n = countOf(src, anchor);
  if (n !== 1) throw new Error(`cloudTsun: ${tag} anchor count ${n} — ${anchor.trim().split('\n')[0].slice(0, 56)}`);
  return src.replace(anchor, () => to);
}

/**
 * 주입 전 글자 → T_sun(+ 아치) 글자. 구름 패스 글자에만 부릅니다(그림자 패스에는 앵커가 없어 throw — 부르는 쪽이 구름 패스만 넘김).
 * 앵커는 모두 정확히 한 번이어야 함(조용히 원문이 되지 않게). cloudGenus refreshVariant 가 얼음·확산 뒤, grain refine·sunLowpass·jitter 앞에 부름.
 */
export function injectTsun(base: string, cfg: TsunShaderConfig): string {
  let src = replaceOnce(base, TSUN_DECL_ANCHOR, [TSUN_DECL_ANCHOR, ...DECL_T, ...(cfg.arch ? DECL_A : [])].join('\n'), 'decl');
  src = replaceOnce(src, TSUN_HELPER_ANCHOR, [...HELPERS_T, ...(cfg.arch ? HELPERS_A : []), TSUN_HELPER_ANCHOR].join('\n'), 'helpers');
  if (cfg.arch) {
    src = replaceOnce(src, TSUN_I0_ANCHOR, I0.join('\n'), 'I-0');
    src = replaceOnce(src, TSUN_I1_ANCHOR, I1.join('\n'), 'I-1');
  }
  src = replaceOnce(src, TSUN_I2_ANCHOR, I2(cfg.arch).join('\n'), 'I-2');
  src = replaceOnce(src, TSUN_IT_ANCHOR, IT.join('\n'), 'I-T');
  if (cfg.arch) src = replaceOnce(src, TSUN_I4_ANCHOR, I4.join('\n'), 'I-4');
  return src;
}

/** 표지 줄 — 주입 지점마다 정확히 한 번(U4a 가 셈). */
export const TSUN_MARKS = {
  decl: `// ${M} T_sun 선언`, declArch: `// ${M} 아치 빛 선언`, helpers: `// ${M} T_sun 도움 함수`, helpersArch: `// ${M} 아치 빛 도움 함수`,
  i0: `// ${M} I-0`, i1: `// ${M} I-1`, i2: `// ${M} I-2`, it: `// ${M} I-T`, i4: `// ${M} I-4`,
} as const;
