/**
 * cloudGenus.ts — 구름 **종류별** 형태 모형(문서 §124, 2026-10-03).
 *
 * takram 볼륨 구름은 층마다 같은 잡음(덩어리)을 운량 문턱으로 자를 뿐이라, 어떤 층이든 같은 모양 —
 * 판정기(CLIP, 사진 170장에서 종류 0.78 적중)가 대조군 렌더 4장을 **모두 적운**으로 봤습니다.
 * 사용자: "맑은 날, 흐린 날, … 권적운, 적란운 등 수많은 구름의 형태를 보면 현재와 전혀 맞지 않음".
 *
 * 바꾸는 것은 셰이더의 **날씨 단계**뿐입니다(빛·행진은 takram 그대로):
 *  1) 수평 무늬를 종류마다 따로 만듭니다(CPU, 주기 경계 텍스처):
 *     적운 = 떨어진 세포(봉우리 여럿) · 고적운 = 잔 세포 + 물결 · 권운 = 바람 방향 결 · 층적운 = 닫힌 세포.
 *  2) 날씨 채널 값 d ∈ [0,1] = **그 자리 구름 기둥의 꼭대기 높이**(층 두께 대비). 셰이더는 층 안 높이 hf 에서
 *     d 가 단면 문턱 1 − hs(hf) 를 넘는 곳에 구름을 둡니다.
 *       dome(적운·층적운): hs = 램프(밑면) · (1 − hf)^top  → 밑면이 평평하고 꼭대기 = d (p=1)
 *       lens(고적운):     hs = 1 − |2hf − 1|^top          → 가운데가 두꺼운 렌즈
 *  3) 하늘빛 가림: 꼭대기·가장자리에서 안으로 들어간 깊이만큼 하늘빛을 줄입니다(밑면·그늘 면).
 *  4) 날씨 좌표를 정육면체 구면 대신 관측점 접평면으로 — 가나자와는 정육면체 모서리 근처라 원래 좌표가
 *     남북·동서로 1.6배 다르게 늘어났습니다(세포가 타원).
 *
 * 웹 시제품(하네스)과 같은 계산입니다. GLSL 문자열 안에 백틱을 쓰지 않습니다.
 */
import { DataTexture, LinearFilter, LinearMipMapLinearFilter, NoColorSpace, RepeatWrapping, RGBAFormat, UnsignedByteType, Vector3, Vector4 } from 'three';
import { COLUMN_N, DIFFUSE_G, DIFFUSE_GLSL, INV_2PI, MU0_MIN, SKY_SECANT } from './cloudDiffuse';
import { FLOW_DEFAULTS, FLOW_D_POW, GENUS_FLOW, camCellOffset, flowComposeSteps, flowCoreSteps, flowLayerWeightsOf, newFlowCore, normalizeTemplate, quantileHist, rankNormalize, type FlowCore, type FlowLayerParams, type FlowSceneParams } from './cloudFlow';
import type { Skeleton } from './cloudSkeleton';

/**
 * 종류 기호(§126): cu 적운 · cg 웅대적운 · cb 적란운 탑 · cbanvil 적란운 모루(별도 층) · sc 층적운 · st 층운 ·
 * ns 난층운 · ac 고적운 · as 고층운 · ci 권운 · cs 권층운.
 */
export type GenusKey = 'cu' | 'cg' | 'cb' | 'cbanvil' | 'sc' | 'st' | 'ns' | 'ac' | 'as' | 'ci' | 'cs';

/**
 * §130 흐름 모형 손잡이(FlowLayerParams)도 같은 opts 로 다닙니다 — 전부 숫자라 `VolumetricLayerInput.opts` 를 거쳐 날씨 캐시 키에
 * 자동으로 들어갑니다. 종류별 기본값은 cloudFlow.ts 의 GENUS_FLOW(측정한 GENUS 표는 손대지 않음).
 */
export interface GenusParams extends Partial<FlowLayerParams> {
  /** §130 전단을 재는 바로 위 층까지의 고도 차(km) — volumetricScene.weatherPlan 이 채움 */
  shearDzKm?: number;
  /**
   * §139 뼈대(cloudSkeleton.skeletonOf) — 있으면 FIELDS cu/cg/sc 가 발생 원리 생성기로 바뀌고(cu·cg 는 절대 d, sc 는 분위수), 셰이더는 뼈대 레인
   * (봉투 거리 밀도, sc 는 뚜껑 mode 3). volumetricScene.weatherPlan 이 채우며 캐시 키에 자동 포함. 없으면 이전과 같은 바이트.
   */
  skeleton?: Skeleton;
  /** §139 K0h 대조군 — 옛 무늬 그대로, 층 밑면·두께만 뼈대 값(applyScene 이 씀). */
  skelGeom?: { baseM: number; heightM: number };
  /** 0 = dome(밑면 평평), 1 = lens */
  mode: number;
  /** 층 두께(m) */
  height: number;
  /** 밑면 램프 폭(층 두께 대비) */
  base: number;
  /** 윗면 지수 */
  top: number;
  /** 가장자리 선명도(밀도 = (d − 문턱)·edge) */
  edge: number;
  /** 하늘빛 가림 세기(깊이 1 에서 exp(−ao)) */
  ao: number;
  /**
   * 햇빛 확산 투과(§126.6). takram 은 구름 속 빛이 '해 쪽 행진 + 하늘빛'뿐이라 두꺼운 층 밑면이 하늘빛 색(푸른 회색)이
   * 됩니다. 위쪽 광학두께 τ 로 확산 투과한 햇빛 sun·(1−e^(−0.1τ))·2/(2+0.15τ)·thru 를 더합니다. 0 이면 끔.
   */
  thru?: number;
  /** 날씨 값 d 의 감마(d^domePow) */
  domePow: number;
  densityScale: number;
  shapeAmount: number;
  shapeDetailAmount: number;
  /** 무늬 손잡이(종류마다 다름) */
  spacingKm?: number;
  radius?: number;
  turrets?: number;
  sizeSkew?: number;
  warp?: number;
  rows?: number;
  /** 권운·모루: 바람 방향 늘임 배율 */
  stretch?: number;
  windDeg?: number;
  /** 층적운: 칸 경계 휨(칸 지름 대비) · 칸 안 덩어리 세기 · 틈 폭 */
  lumps?: number;
  gap?: number;
  /**
   * 층적운: 큰 규모 덮개 섞기(0~1)·크기(km) — 장을 "칸 틈 × 저주파 덮개" 쪽으로 섞어 낮은 운량에서 세포를 **무리째** 남깁니다(§128).
   * 없으면 문턱이 모든 세포를 가운데만 남겨 따로 떨어진 탑이 됩니다. ⚠ 판정기(RULER-sc-low.md)를 넘지 못해 **기본 끔** —
   * 적운 확률은 0.80 → 0.49 로 줄었지만 여전히 적운 판정이었습니다(볼록함은 모양 잡음 쪽 몫).
   */
  cluster?: number;
  clusterKm?: number;
  /** 권운: 띠 길이·폭, 결 길이·폭(km), 결 날카로움, 휨(km) */
  bandLenKm?: number;
  bandWidKm?: number;
  fibLenKm?: number;
  fibWidKm?: number;
  fibPow?: number;
  bendKm?: number;
  /** 무늬 씨앗 — 적란운 탑과 모루가 같은 세포를 쓰도록 맞출 때 */
  seed?: number;
  /** true 면 운량 문턱을 쓰지 않고 장 값을 그대로 d 로 씁니다(모루처럼 탑 둘레에만 있어야 하는 층) */
  absolute?: boolean;
  /** 모루: 탑 반지름 대비 배율 · 바람 방향 늘임 */
  anvilScale?: number;
  /** d 를 1 로 맞추는 장 분위수(기본 0.997). 큰 세포가 드문 종류(적란운)는 1.0 — 아니면 꼭대기가 평평하게 잘려 상자가 됩니다. */
  topQuantile?: number;
}

/**
 * 종류별 값 — 웹 하네스에서 판정기(§124.1)로 고른 후보(§124.3). st 는 아직 재지 않았습니다.
 */
export const GENUS: Record<GenusKey, GenusParams> = {
  cu: { mode: 0, height: 1600, base: 0.1, top: 1.1, edge: 1.4, ao: 1.5, domePow: 1, densityScale: 0.22, shapeAmount: 1.0, shapeDetailAmount: 0.55, radius: 0.6, turrets: 8 },
  ac: { mode: 1, height: 400, base: 0, top: 1.0, edge: 4, ao: 0, domePow: 1, densityScale: 0.2, shapeAmount: 0.6, shapeDetailAmount: 0.7 },
  ci: { mode: 0, height: 800, base: 0.4, top: 0.5, edge: 1.5, ao: 0, domePow: 1.5, densityScale: 0.003, shapeAmount: 0.15, shapeDetailAmount: 0 },
  sc: { mode: 0, height: 750, base: 0.08, top: 0.45, edge: 1.8, ao: 3.5, domePow: 1, densityScale: 0.22, shapeAmount: 1.0, shapeDetailAmount: 0.65, warp: 0.8, lumps: 0.75, gap: 0.3 },
  // 층운: 판 종류는 렌즈 단면(top 4 → 층 대부분에서 hs≈1)이라 d>0 인 곳이 전부 구름이고 d 는 두께만 바꿉니다.
  // (첫 판은 돔 단면 top 0.15 라 d<0.16 인 곳이 비어 판이 덩어리로 깨졌습니다.)
  st: { mode: 1, height: 400, base: 0, top: 4, edge: 2, ao: 0, domePow: 1, densityScale: 0.2, shapeAmount: 0.1, shapeDetailAmount: 0, topQuantile: 0.5 },
  // ── §126 D3: 아래는 아직 사진 자로 재지 않은 값입니다(물리 선험). ──
  // 웅대적운: 거대한 수직 대류 탑 복합체 (congestus stack).
  cg: { mode: 0, height: 4000, base: 0.08, top: 1.2, edge: 1.3, ao: 2.5, domePow: 1, densityScale: 0.22, shapeAmount: 1, shapeDetailAmount: 0.4, spacingKm: 4, radius: 0.6, turrets: 8, sizeSkew: 1.0, topQuantile: 1 },
  // 적란운 탑: 10km 이상 솟구치는 거대한 대류 기둥.
  cb: { mode: 0, height: 8000, base: 0.07, top: 1.35, edge: 1.8, ao: 3.5, domePow: 1, densityScale: 0.25, shapeAmount: 1, shapeDetailAmount: 0.4, spacingKm: 15, radius: 0.4, turrets: 6, sizeSkew: 0.7, warp: 0.2, topQuantile: 1 },
  // 적란운 모루: 탑과 같은 세포 위에 3배 반지름의 렌즈, 바람 방향으로 늘임. 운량 문턱 없이 장 값 그대로.
  cbanvil: { mode: 1, height: 1500, base: 0, top: 1.0, edge: 3, ao: 0, domePow: 1, densityScale: 0.06, shapeAmount: 0.3, shapeDetailAmount: 0, spacingKm: 15, radius: 0.35, sizeSkew: 0.7, warp: 0.2, absolute: true, anvilScale: 3, stretch: 1.2 },
  // 난층운: 두꺼운(3.2km) 비구름 층. 묵직하고 어두운 밑면(ao 4.5)과 하강 기류로 아래가 굽이치며 처져 내림.
  ns: { mode: 0, height: 3200, base: 0.12, top: 0.85, edge: 1.8, ao: 4.5, domePow: 1, densityScale: 0.28, shapeAmount: 0.8, shapeDetailAmount: 0.5, topQuantile: 0.85 },
  // 고층운: 중층의 흐릿한 판. 밝기 변화만 있고 윤곽이 없음.
  as: { mode: 1, height: 1500, base: 0, top: 4, edge: 3, ao: 2, domePow: 1, densityScale: 0.15, shapeAmount: 0.3, shapeDetailAmount: 0.2, topQuantile: 0.8 },
  // 권층운: 상층의 얇은 베일(햇무리). 아주 옅고 결이 희미함.
  cs: { mode: 1, height: 1000, base: 0, top: 4, edge: 3, ao: 0, domePow: 1, densityScale: 0.0015, shapeAmount: 0.15, shapeDetailAmount: 0, rows: 0.08, topQuantile: 0.8 },
};

export interface GenusLayer { genus: GenusKey; cover: number; opts?: Partial<GenusParams> }

/**
 * §127 운량 → 화면 면적 역표. 날씨 무늬는 "위에서 본 d > 0 면적 = 운량" 이지만 아래에서 본 하늘 평균 면적(광학두께
 * ≥ 0.16)은 종류마다 다릅니다(얇은 가장자리·모양 잡음의 깎임·적운 옆면). 예보 운량 → 무늬에 넣을 운량을 종류별로
 * 선형 보간합니다(CloudSlab COVER_REMAP 과 같은 방식). 자: tools/genus-ruler/genus/RULER-cover.md. 표가 없는 종류는 그대로.
 */
export const GENUS_COVER_REMAP: Partial<Record<GenusKey, [number, number][]>> = {
  // [예보 운량, 무늬에 넣을 운량] — 짝수 자리 4곳 × 방위 4 × 시선 고도 20·45·70° 하늘 평균 면적(광학두께 ≥ 0.16)을 뒤집음(§127.6).
  // 측정한 최대 면적보다 큰 예보는 (1, 1) 로 이어 붙입니다(넣을 운량 1 = 판 전체).
  // 홀수 자리(맞추기에 안 쓴 자리)에서 최대 어긋남이 줄어든 종류만 넣었습니다 — 층운(0.153 → 0.293)·고층운(0.062 → 0.264)은
  // 표를 넣으면 더 어긋나 뺐습니다(자리 4곳 평균이 자리마다 크게 흔들림, RULER-cover.md 추가).
  cu: [[0.1, 0.093], [0.25, 0.444], [0.5, 0.927], [0.75, 0.963], [0.9, 0.985]],
  cg: [[0.1, 0.064], [0.25, 0.189], [0.5, 0.565], [0.75, 0.941], [0.9, 0.976]],
  sc: [[0.1, 0.079], [0.25, 0.209], [0.5, 0.469], [0.75, 0.77], [0.9, 0.942]],
  ns: [[0.1, 0.03], [0.25, 0.075], [0.5, 0.281], [0.75, 0.706], [0.9, 0.922]],
  ac: [[0.1, 0.168], [0.25, 0.402], [0.5, 0.662], [0.75, 0.934], [0.9, 0.974]],
  ci: [[0.1, 0.476], [0.25, 0.907], [0.5, 0.938], [0.75, 0.969], [0.9, 0.988]],
  cs: [[0.1, 0.06], [0.25, 0.183], [0.5, 0.493], [0.75, 0.86], [0.9, 0.955]],
};

export function genusCoverIn(genus: GenusKey, cover: number): number {
  return remapCover(GENUS_COVER_REMAP[genus], cover);
}
/**
 * §130 흐름 층의 운량 역표 — 가산 원시장은 0 인 곳이 없어(용량 1) §127 의 chamfer 스커트 전제가 깨지므로 따로 둡니다.
 * 항등으로 시작하고 RULER-cover 절차(짝수 자리 적합·홀수 검증)로 채운 뒤에야 기본 on 으로 갑니다.
 */
export const FLOW_COVER_REMAP: Partial<Record<GenusKey, [number, number][]>> = {};
export function flowCoverIn(genus: GenusKey, cover: number): number {
  return remapCover(FLOW_COVER_REMAP[genus], cover);
}
/** 흐름 층의 opts = 종류별 흐름 기본값(GENUS_FLOW) 아래에 층 opts 를 덮음. flow 가 0 인 종류(모루)는 그대로 흐름 없음. */
export function mergeFlowOpts(L: GenusLayer): GenusLayer {
  const base = GENUS_FLOW[L.genus] ?? {};
  return { ...L, opts: { ...base, ...L.opts, flow: L.opts?.flow ?? base.flow ?? 1 } };
}
/**
 * §130 장면당 하나인 흐름 핵 매개변수 — 모든 층이 같은 변위 지도를 공유(같은 골에 sc·ac 가 정렬). 바람 방향·비등방·시드는
 * 첫 흐름 층의 것. 비등방 = 종류 바닥값 + 바람 가중(6 m/s 위에서 켜짐, 최대 3) — 바닥값이 있어 자리표시 바람(6.1 m/s)에서도
 * 등방이 되지 않습니다. volumetricScene.weatherPlan 과 자 도구(tile-gen)가 같은 함수를 씁니다.
 */
export interface FlowPlanOptions {
  n: 64 | 128; steps: number; hours: number; vrms: number; psiEvery: number;
  /** §131 수분장 모드·격자·H(RULER-flow2 Q1/Q2). 없으면 1회차 */
  qMode?: 0 | 1 | 2; qN?: 64 | 128; qH?: number;
  /** §131 변형 게이트 목표 s90(0 = 끔, RULER-flow2 R2) */
  s90?: number;
}
export function planFlowScene(gl: (GenusLayer | null)[], o: FlowPlanOptions): FlowSceneParams | null {
  const first = gl.find(L => L && (fp(L, 'flow') ?? 0) > 0);
  if (!first) return null;
  const op = first.opts ?? {};
  const hasWind = op.windU != null && op.windV != null;
  const speedMps = hasWind ? Math.hypot(op.windU!, op.windV!) / 3.6 : 0;
  return {
    ...FLOW_DEFAULTS, seed: op.flowSeed ?? FLOW_DEFAULTS.seed, n: o.n, steps: o.steps, hours: o.hours, vrms: o.vrms, psiEvery: o.psiEvery,
    windDeg: hasWind ? ((Math.atan2(op.windU!, op.windV!) * 180) / Math.PI + 360) % 360 : FLOW_DEFAULTS.windDeg,
    aniso: (fp(first, 'flowAniso') ?? 0) + Math.max(0, Math.min(3, (speedMps - 6) / 6)),
    rollDeg: op.rollDeg ?? FLOW_DEFAULTS.rollDeg,
    // §131: 기본값(qMode 0·s90 0)이면 1회차와 같은 바이트.
    ...(o.qMode ? { qMode: o.qMode, qN: o.qN ?? 128, qH: o.qH ?? FLOW_DEFAULTS.qH } : {}),
    ...(o.s90 && o.s90 > 0 ? { s90: o.s90 } : {}),
  };
}

/**
 * §131 카메라 칸 조건화(RULER-flow2 K): 흐름 층 합 마스크를 64² 운량으로 줄여 cloudFlow.camCellOffset 이 고른 칸으로 관측점을 옮길
 * weatherOffsetKm 을 돌려줍니다(타일 바이트·캐시 불변). 흐름 층이 없거나 운량 > 0.6 이면 null.
 */
export function flowCamCellOffsetKm(data: Uint8Array, S: number, layers: (GenusLayer | null)[], tileKm: number): [number, number] | null {
  const ch = layers.map((L, k) => (L && k < 4 && (fp(L, 'flow') ?? 0) > 0 ? k : -1)).filter(k => k >= 0);
  if (!ch.length) return null;
  const g = 64, b = S / g;
  if (b !== Math.floor(b)) return null;
  const m = new Float32Array(g * g);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const o = (y * S + x) * 4;
    let any = false;
    for (const k of ch) if (data[o + k] > 0) { any = true; break; }
    if (any) m[Math.floor(y / b) * g + Math.floor(x / b)] += 1 / (b * b);
  }
  const uv = camCellOffset(m, g);
  return uv ? [uv[0] * tileKm, uv[1] * tileKm] : null;
}
/** 흐름 손잡이 — 층 opts 가 우선, 없으면 종류별 GENUS_FLOW. */
const fp = <K extends keyof FlowLayerParams>(L: GenusLayer, k: K): number | undefined => (L.opts?.[k] ?? GENUS_FLOW[L.genus]?.[k]) as number | undefined;
function remapCover(t: [number, number][] | undefined, cover: number): number {
  if (!t || cover <= 0) return cover;
  if (cover <= t[0][0]) return Math.min(1, (t[0][1] * cover) / Math.max(1e-6, t[0][0]));
  for (let i = 1; i < t.length; i++) {
    if (cover <= t[i][0]) {
      const [x0, y0] = t[i - 1], [x1, y1] = t[i];
      return Math.min(1, y0 + ((y1 - y0) * (cover - x0)) / Math.max(1e-6, x1 - x0));
    }
  }
  const [xl, yl] = t[t.length - 1];
  return Math.min(1, yl + ((1 - yl) * (cover - xl)) / Math.max(1e-6, 1 - xl));
}

const param = <K extends keyof GenusParams>(L: GenusLayer, k: K): GenusParams[K] => (L.opts?.[k] ?? GENUS[L.genus][k]) as GenusParams[K];

// ───── 주기 경계 잡음 ─────
const rng = (seed: number) => () => {
  seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
type F2 = (u: number, v: number) => number;
function periodicNoise(n: number, seed: number): F2 {
  const r = rng(seed), g = new Float32Array(n * n).map(() => r());
  const at = (i: number, j: number) => g[(((j % n) + n) % n) * n + (((i % n) + n) % n)];
  return (u, v) => {
    const x = u * n, y = v * n, x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = at(x0, y0), b = at(x0 + 1, y0), c = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1);
    const ab = a + (b - a) * sx;
    return ab + (c + (d - c) * sx - ab) * sy;
  };
}
/** 가로·세로 격자 수가 다른 주기 잡음 — 늘인 무늬(권운)를 주기 경계를 지키며 만들려고 축에 맞춰 늘입니다. */
function periodicNoise2(nx: number, ny: number, seed: number): F2 {
  const r = rng(seed), g = new Float32Array(nx * ny).map(() => r());
  const at = (i: number, j: number) => g[(((j % ny) + ny) % ny) * nx + (((i % nx) + nx) % nx)];
  return (u, v) => {
    const x = u * nx, y = v * ny, x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = at(x0, y0), b = at(x0 + 1, y0), c = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1);
    const ab = a + (b - a) * sx;
    return ab + (c + (d - c) * sx - ab) * sy;
  };
}
function fbm2(nx: number, ny: number, oct: number, seed: number): F2 {
  const ns = Array.from({ length: oct }, (_, k) => periodicNoise2(nx << k, ny << k, seed + k * 131));
  return (u, v) => { let s = 0, a = 0.5, w = 0; for (const f of ns) { s += a * f(u, v); w += a; a *= 0.5; } return s / w; };
}
function fbm(n0: number, oct: number, seed: number): F2 {
  const ns = Array.from({ length: oct }, (_, k) => periodicNoise(n0 << k, seed + k * 101));
  return (u, v) => { let s = 0, a = 0.5, w = 0; for (const f of ns) { s += a * f(u, v); w += a; a *= 0.5; } return s / w; };
}
interface Pt { x: number; y: number; s: number; t: number }
function cells(n: number, seed: number, jitter = 0.9) {
  const r = rng(seed), pts: Pt[] = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    pts.push({ x: (i + 0.5 + (r() - 0.5) * jitter) / n, y: (j + 0.5 + (r() - 0.5) * jitter) / n, s: r(), t: r() });
  }
  return { at: (i: number, j: number) => pts[(((j % n) + n) % n) * n + (((i % n) + n) % n)] };
}
const wrapD = (a: number, b: number) => { let d = a - b; d -= Math.round(d); return d; };
function quantile(arr: Float32Array, q: number): number {
  const s = Float32Array.from(arr).sort();
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * (s.length - 1))))];
}

// ───── 종류별 수평 무늬(원시 장 f: 클수록 기둥이 높음) ─────
/** 화소 함수 — 준비(세포·잡음)를 한 번 하고 (x, y) → 장 값. 날씨를 잘라 만들 수 있게(§127, 폰에서 JS 를 오래 막지 않게) 화소 단위로 둡니다. */
type FieldPx = (x: number, y: number) => number;
type Field = (S: number, tileKm: number, seed: number, L: GenusLayer, flow?: boolean) => FieldPx;
// ───── §139 뼈대 생성기(RULER-shape §1) ─────
/**
 * 적운·웅대적운: 켜진 열기둥마다 캡 (D_i/H)·(1 − ρ²/R²)^p (p = 0.5/r_i — 깊은 탑도 꼭대기가 둥글게) + 터렛 6(반지름 0.2~0.35 R, 캡 둘레 — 맥동 열기둥의 잔재,
 * 자유 매개변수 §1.4). 문턱 없는 절대 d. 열기둥이 전부 켜져도 운량이 모자라면(sk.skirt) 열기둥 둘레 0.3 λ 안에 얇은 스커트 d = 0.08·(1 − dist/0.3λ).
 */
function skeletonThermalField(S: number, tileKm: number, seed: number, sk: Skeleton): FieldPx {
  const H = Math.max(1, sk.heightM);
  const on = sk.cells.filter(c => c.on);
  const G = 16, bins: number[][] = Array.from({ length: G * G }, () => []);
  on.forEach((c, i) => bins[(((Math.floor(c.y * G) % G) + G) % G) * G + (((Math.floor(c.x * G) % G) + G) % G)].push(i));
  const skirtR = (0.3 * sk.lambdaKm) / tileKm;
  const maxR = on.reduce((m, c) => Math.max(m, c.wKm / 2 / tileKm), 0) + (sk.skirt ? skirtR : 0);
  const reach = Math.min(G >> 1, Math.ceil(maxR * G) + 1);
  const tur = on.map((c, i) => {
    const r = rng(seed ^ (i * 7919 + 13)), out: { a: number; off: number; rb: number; hb: number }[] = [];
    for (let t = 0; t < 6; t++) out.push({ a: r() * 6.2832, off: 0.3 + 0.3 * r(), rb: 0.2 + 0.15 * r(), hb: 0.75 + 0.25 * r() });
    return out;
  });
  return (x, y) => {
    const u = (x + 0.5) / S, v = (y + 0.5) / S;
    const bi = Math.floor(u * G), bj = Math.floor(v * G);
    let best = 0, dmin = 9;
    for (let dj = -reach; dj <= reach; dj++) for (let di = -reach; di <= reach; di++) {
      for (const i of bins[(((bj + dj) % G) + G) % G * G + (((bi + di) % G) + G) % G]) {
        const c = on[i], R = c.wKm / 2 / tileKm, dx = wrapD(u, c.x), dy = wrapD(v, c.y), rho2 = dx * dx + dy * dy;
        const top = c.dM / H;
        if (rho2 < R * R) {
          const ri = c.dM / Math.max(1, c.wKm * 1000);
          best = Math.max(best, top * Math.pow(1 - rho2 / (R * R), 0.5 / Math.max(0.2, ri)));
        }
        if (rho2 < R * R * 2.0) {
          for (const t of tur[i]) {
            const ex = dx - Math.cos(t.a) * t.off * R, ey = dy - Math.sin(t.a) * t.off * R, rb = t.rb * R;
            const q = 1 - (ex * ex + ey * ey) / (rb * rb);
            if (q > 0) best = Math.max(best, top * t.hb * Math.sqrt(q));
          }
        }
        dmin = Math.min(dmin, Math.sqrt(rho2) - R);
      }
    }
    if (best <= 0 && sk.skirt && dmin < skirtR) best = 0.08 * (1 - Math.max(0, dmin) / skirtR);
    return best;
  };
}
/**
 * 타일 주기 **스펙트럼 잡음** — 정수 파수 (kx, ky) 의 코사인 합(주기가 타일과 같아 어느 각도의 비등방도 경계가 맞음). 봉우리 |k| = kPeak(타일당 파수),
 * 비등방: dir(°, 북 0 동 90) 방향의 파수를 aniso 배 줄임(그 방향으로 길게 늘어선 무늬 = 롤). 값은 [0, 1] 로 정규화(평균 0.5, ±2σ).
 */
function spectralNoise(kPeak: number, aniso: number, dirDeg: number | null, seed: number): F2 {
  const r = rng(seed), kmax = Math.max(2, Math.ceil(kPeak * 3));
  const ang = dirDeg == null ? 0 : (dirDeg * Math.PI) / 180, ex = Math.sin(ang), ey = Math.cos(ang);   // 늘어선 방향 (x 동, y 북)
  const modes: { kx: number; ky: number; a: number; ph: number }[] = [];
  let s2 = 0;
  for (let ky = -kmax; ky <= kmax; ky++) for (let kx = 0; kx <= kmax; kx++) {
    if (kx === 0 && ky <= 0) continue;
    let px = kx, py = ky;
    if (dirDeg != null) { const along = px * ex + py * ey; px -= along * ex * (1 - 1 / aniso); py -= along * ey * (1 - 1 / aniso); }
    const k = Math.hypot(px, py);
    const a = Math.exp(-0.5 * Math.pow(Math.log(Math.max(1e-6, k) / kPeak) / 0.5, 2));   // 로그 가우스 봉우리(폭 0.5 옥타브)
    if (a < 0.02) continue;
    modes.push({ kx, ky, a, ph: r() * 6.2832 }); s2 += 0.5 * a * a;
  }
  const norm = 0.25 / Math.sqrt(Math.max(1e-9, s2));
  return (u, v) => {
    let s = 0;
    for (const m of modes) s += m.a * Math.cos(6.2831853 * (m.kx * u + m.ky * v) + m.ph);
    return Math.min(1, Math.max(0, 0.5 + s * norm));
  };
}
/**
 * 층적운: 중규모 세포 덮개(봉우리 35 h — 열린 세포는 가운데 맑고 고리에 구름, 닫힌 세포는 가운데 두꺼움) × 혼합층 요소(간격 2.5 h, 롤이면 바람 −15° 방향 3:1)
 * × 작은 잡음. 그 뒤는 운량 분위수 문턱(기존 경로, domePow 0.5).
 */
function skeletonScField(S: number, tileKm: number, seed: number, sk: Skeleton): FieldPx {
  const meso = spectralNoise(Math.max(1, tileKm / Math.max(1e-3, sk.mesoKm)), 1, null, seed + 41);
  const el = spectralNoise(Math.max(1, tileKm / Math.max(1e-3, sk.elKm)), sk.rollDeg == null ? 1 : 3, sk.rollDeg, seed + 43);
  const fine = fbm(Math.max(8, Math.round(tileKm / 0.5)), 2, seed + 47);
  return (x, y) => {
    const u = (x + 0.5) / S, v = (y + 0.5) / S;
    const m = meso(u, v);
    // 열린 세포: 가운데(m 높음)가 맑고 고리(m ≈ 0.5)에 구름 — 1 − |2m − 1| 꼴의 고리에 가장자리 쪽(m 낮음)을 더함. 닫힌: m 그대로.
    const cover = sk.open ? Math.max(1 - m, 1 - Math.abs(2 * m - 1)) * 0.5 + 0.5 * (1 - m) : m;
    return cover * (0.6 + 0.4 * el(u, v)) * (1 + 0.15 * (fine(u, v) - 0.5));
  };
}

const FIELDS: Record<GenusKey, Field> = {
  // 적운: 솜사탕처럼 복합적인 거품 덩어리들이 뭉쳐진 꽃양배추형 대류 뭉게구름 (Multi-scale Cauliflower Billows)
  cu(S, tileKm, seed, L) {
    if (L.opts?.skeleton) return skeletonThermalField(S, tileKm, seed, L.opts.skeleton);
    const n = Math.max(2, Math.round(tileKm / (param(L, 'spacingKm') ?? 2.4)));
    const C = cells(n, seed), env = fbm(2, 3, seed + 7), warp = fbm(Math.max(4, n), 3, seed + 13), warp2 = fbm(Math.max(4, n), 3, seed + 17);
    const wa = (param(L, 'warp') ?? 0.35) / n, rmax = (param(L, 'radius') ?? 0.6) / n, T = param(L, 'turrets') ?? 8, skew = param(L, 'sizeSkew') ?? 1.5;
    const sCache = new Float64Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const p = C.at(i, j); sCache[j * n + i] = Math.pow(p.s, skew) * (0.4 + 1.2 * env(p.x, p.y)); }
    return (x, y) => {
      let u = (x + 0.5) / S, v = (y + 0.5) / S;
      u += (warp(u, v) - 0.5) * wa; v += (warp2(u, v) - 0.5) * wa;
      const ci = Math.floor(u * n), cj = Math.floor(v * n);
      let best = 0;
      for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
        const p = C.at(ci + di, cj + dj), s = sCache[((((cj + dj) % n) + n) % n) * n + ((((ci + di) % n) + n) % n)];
        const R = rmax * (0.45 + 0.55 * Math.min(1, s)), dx = wrapD(u, p.x), dy = wrapD(v, p.y);
        if (dx * dx + dy * dy > R * R * 2.2) continue;
        const r2 = rng(Math.floor(p.s * 1e9) ^ seed);

        // 1. 중심 코어 돔 (Core updraft dome: 크기를 0.55R로 알맞게 줄여 주변 터렛이 묻히지 않게 함)
        const ang0 = Math.atan2(dy, dx);
        const rH0 = 1 + 0.22 * Math.cos(3 * ang0 + seed) + 0.12 * Math.sin(5 * ang0);
        const q0 = 1 - (dx * dx + dy * dy) * (rH0 * rH0) / (R * R * 0.45);
        if (q0 > 0) best = Math.max(best, s * 0.9 * Math.sqrt(q0) * (1.2 - 0.2 * q0));

        // 2. 1차 주 터렛 (꽃양배추형 중형 돔들: 사방으로 뻗어 꽃봉오리 형성)
        for (let t = 1; t <= T; t++) {
          const a = r2() * 6.2832, off = (0.28 + 0.38 * r2()) * R, Rb = R * (0.35 + 0.28 * r2());
          const hb = s * (0.6 + 0.4 * r2());
          const ex = dx - Math.cos(a) * off, ey = dy - Math.sin(a) * off;
          const ang = Math.atan2(ey, ex);
          const rH = 1 + 0.3 * Math.cos(3 * ang + t * 2.1 + seed) + 0.18 * Math.sin(5 * ang + t * 1.7);
          const dSq = (ex * ex + ey * ey) * (rH * rH);
          const q = 1 - dSq / (Rb * Rb);
          if (q > 0) {
            const hProfile = Math.sqrt(q) * (1.25 - 0.25 * q);
            best = Math.max(best, hb * hProfile);
          }
        }

        // 3. 2차 미세 솜사탕 거품 퍼프 (Surface micro-billows: 몽실몽실한 표면 버블)
        for (let m = 0; m < 5; m++) {
          const aM = r2() * 6.2832, offM = (0.4 + 0.45 * r2()) * R, Rm = R * (0.18 + 0.15 * r2());
          const exM = dx - Math.cos(aM) * offM, eyM = dy - Math.sin(aM) * offM;
          const dSqM = exM * exM + eyM * eyM;
          const qM = 1 - dSqM / (Rm * Rm);
          if (qM > 0) {
            best = Math.max(best, s * (0.45 + 0.35 * r2()) * Math.pow(qM, 0.7));
          }
        }
      }
      return best;
    };
  },
  ac(S, tileKm, seed, L, flow) {
    const n = Math.max(4, Math.round(tileKm / (param(L, 'spacingKm') ?? 0.35)));
    const C = cells(n, seed, 0.7), env = fbm(3, 4, seed + 5), rows = param(L, 'rows') ?? 0.35;
    const ang = ((param(L, 'windDeg') ?? 30) * Math.PI) / 180, ca = Math.cos(ang), sa = Math.sin(ang);
    const R = (param(L, 'radius') ?? 0.62) / n, k = Math.round(n / 3);
    return (x, y) => {
      const u = (x + 0.5) / S, v = (y + 0.5) / S, ci = Math.floor(u * n), cj = Math.floor(v * n);
      let best = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const p = C.at(ci + di, cj + dj), dx = wrapD(u, p.x), dy = wrapD(v, p.y);
        const ang = Math.atan2(dy, dx);
        const rH = 1 + 0.2 * Math.cos(4 * ang + seed);
        const dSq = (dx * dx + dy * dy) * (rH * rH);
        const q = 1 - dSq / (R * R * (0.6 + 0.4 * p.s));
        if (q > 0) best = Math.max(best, (0.6 + 0.4 * p.t) * q * (1.3 - 0.3 * q));
      }
      const wave = 1 - rows + rows * (0.5 + 0.5 * Math.cos(2 * Math.PI * k * (u * ca + v * sa)));
      // §130 흐름 층은 패치 마스크를 수분장(q₀)이 맡으므로 fbm 마스크를 뺍니다(끄면 이전과 같음).
      return best * wave * (flow ? 1 : Math.min(1, Math.max(0, (env(u, v) - 0.35) * 4)));
    };
  },
  // 권운: 바람(텍스처 x = 동쪽) 방향으로 긴 띠 + 띠 속 가늘고 긴 평행 결 + 결을 휘는 저주파 휨.
  // (첫 판 — 덩어리 패치 속 짧은 결 — 은 판정기가 적운으로 봤습니다.)
  ci(S, tileKm, seed, L) {
    const bandL = Math.max(1, Math.round(tileKm / (param(L, 'bandLenKm') ?? 12))), bandW = Math.max(2, Math.round(tileKm / (param(L, 'bandWidKm') ?? 2.5)));
    const fibL = Math.max(2, Math.round(tileKm / (param(L, 'fibLenKm') ?? 4))), fibW = Math.max(8, Math.round(tileKm / (param(L, 'fibWidKm') ?? 0.15)));
    const band = fbm2(bandL, bandW, 3, seed), fib = fbm2(fibL, fibW, 2, seed + 7), bend = fbm(3, 3, seed + 11);
    const bendA = (param(L, 'bendKm') ?? 1.5) / tileKm, fp = param(L, 'fibPow') ?? 4;
    return (x, y) => {
      const u = (x + 0.5) / S, v = (y + 0.5) / S, vb = v + (bend(u, v) - 0.5) * 2 * bendA;
      const r = 1 - Math.abs(2 * fib(u, vb) - 1), bandMask = Math.min(1, Math.max(0, (band(u, vb) - 0.42) / 0.25));
      return bandMask * (0.25 + 0.75 * Math.pow(r, fp));
    };
  },
  sc(S, tileKm, seed, L, flow) {
    if (L.opts?.skeleton) return skeletonScField(S, tileKm, seed, L.opts.skeleton);
    const n = Math.max(2, Math.round(tileKm / (param(L, 'spacingKm') ?? 1.8)));
    const C = cells(n, seed, 0.8), warp = fbm(Math.max(4, n * 2), 3, seed + 21), warp2 = fbm(Math.max(4, n * 2), 3, seed + 23);
    const wa = (param(L, 'warp') ?? 0.3) / n, lumps = param(L, 'lumps') ?? 0, gap = param(L, 'gap') ?? 0.5;
    const lumpN = fbm(Math.max(8, n * 4), 3, seed + 29);
    const cl = param(L, 'cluster') ?? 0;
    // §130 흐름 층: 칸 경계 틈에 바닥값(sheet)을 둬 습한 골 안의 칸들이 얇은 틈 구름으로 이어집니다(0 이면 칸마다 따로 떨어짐).
    const sheet = flow ? (param(L, 'sheet') ?? 0.3) : 0;
    const clN = cl > 0 ? fbm(Math.max(2, Math.round(tileKm / (param(L, 'clusterKm') ?? 8))), 3, seed + 31) : null;
    return (x, y) => {
      let u = (x + 0.5) / S, v = (y + 0.5) / S;
      const env = clN ? Math.min(1, Math.max(0, (clN(u, v) - 0.3) / 0.4)) : 1;
      // 칸 안 잔 덩어리(칸 지름의 1/4 쯤) — 없으면 매끈한 다각형 타일이 됩니다(첫 판).
      const lump = lumps ? 1 - lumps + lumps * Math.min(1, Math.max(0, (lumpN(u, v) - 0.25) * 2)) : 1;
      u += (warp(u, v) - 0.5) * wa; v += (warp2(u, v) - 0.5) * wa;
      const ci = Math.floor(u * n), cj = Math.floor(v * n);
      let d1 = 9, d2 = 9, s1 = 0;
      for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
        const p = C.at(ci + di, cj + dj), dx = wrapD(u, p.x), dy = wrapD(v, p.y), d = Math.sqrt(dx * dx + dy * dy) * n;
        if (d < d1) { d2 = d1; d1 = d; s1 = p.s; } else if (d < d2) d2 = d;
      }
      const gapM0 = Math.min(1, (d2 - d1) / gap), gapM = sheet + (1 - sheet) * gapM0;
      // 부드러운 코사인 롤 곡선으로 다각형 타일감 제거하고 몽실몽실한 3D 롤/웨이브 형성
      const roll = Math.cos(Math.min(1, d1) * 3.141592 * 0.5);
      // 세포 내부 복합 거품 요철 (Sub-billows within cell: 밋밋한 빵 느낌 파괴)
      const subBillow = 0.8 + 0.2 * Math.cos(d1 * 6.283184);
      const cellF = (0.55 + 0.45 * s1) * gapM * roll * lump * subBillow;
      if (!clN) return cellF;
      // 덮개가 주도: 무리 안은 칸 경계의 얇은 틈만 남기고 칸을 채웁니다(세포별 크기·가운데 강조를 빼야 칸이 가운데만 남지 않음).
      return (1 - cl) * cellF + cl * gapM * (0.85 + 0.15 * lump * subBillow) * env;
    };
  },
  st(S, tileKm, seed) {
    const g = fbm(Math.max(4, Math.round(tileKm / 3)), 4, seed);
    return (x, y) => 0.7 + 0.3 * g((x + 0.5) / S, (y + 0.5) / S);
  },
  // 웅대적운: 수직으로 솟구치는 거대한 대류 탑 복합체 (Cumulus congestus stack)
  cg(S, tileKm, seed, L) {
    if (L.opts?.skeleton) return skeletonThermalField(S, tileKm, seed, L.opts.skeleton);
    const n = Math.max(1, Math.round(tileKm / (param(L, 'spacingKm') ?? 4)));
    const C = cells(n, seed), env = fbm(2, 3, seed + 11), warp = fbm(Math.max(4, n * 2), 3, seed + 17);
    const wa = (param(L, 'warp') ?? 0.4) / n, rmax = (param(L, 'radius') ?? 0.6) / n, T = param(L, 'turrets') ?? 8;
    return (x, y) => {
      let u = (x + 0.5) / S, v = (y + 0.5) / S;
      const wVal = (warp(u, v) - 0.5) * wa;
      u += wVal; v += (warp(v, u) - 0.5) * wa;
      const ci = Math.floor(u * n), cj = Math.floor(v * n);
      let best = 0;
      for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
        const p = C.at(ci + di, cj + dj), s = (0.5 + 1.2 * env(p.x, p.y)) * Math.pow(p.s, 0.9);
        const R = rmax * (0.6 + 0.4 * Math.min(1, s)), dx = wrapD(u, p.x), dy = wrapD(v, p.y);
        if (dx * dx + dy * dy > R * R * 2.0) continue;
        const r2 = rng(Math.floor(p.s * 1e9) ^ (seed + 99));
        // 중심 기둥 (Central core updraft)
        const ang0 = Math.atan2(dy, dx);
        const rH0 = 1 + 0.25 * Math.cos(4 * ang0 + seed);
        const q0 = 1 - (dx * dx + dy * dy) * (rH0 * rH0) / (R * R * 0.7);
        if (q0 > 0) best = Math.max(best, s * Math.pow(q0, 0.75));
        // 둘레의 수직 분출 탑들 (Surrounding convective towers)
        for (let t = 1; t <= T; t++) {
          const a = r2() * 6.2832, dist = (0.2 + 0.4 * r2()) * R, Rb = R * (0.3 + 0.3 * r2());
          const ex = dx - Math.cos(a) * dist, ey = dy - Math.sin(a) * dist;
          const ang = Math.atan2(ey, ex);
          const rH = 1 + 0.3 * Math.cos(3 * ang + t * 2.1) + 0.15 * Math.sin(5 * ang);
          const q = 1 - (ex * ex + ey * ey) * (rH * rH) / (Rb * Rb);
          if (q > 0) {
            const h = s * (0.4 + 0.6 * r2()) * Math.pow(q, 0.8);
            best = Math.max(best, h);
          }
        }
      }
      return best;
    };
  },
  // 적란운 탑: 10km 이상 솟구치는 거대한 단열 대류 핵 (Thunderstorm convective chimney)
  cb(S, tileKm, seed, L) {
    const n = Math.max(1, Math.round(tileKm / (param(L, 'spacingKm') ?? 15)));
    const C = cells(n, seed), env = fbm(2, 3, seed + 19), warp = fbm(Math.max(4, n * 2), 4, seed + 29), warp2 = fbm(Math.max(4, n * 2), 4, seed + 33);
    const wa = (param(L, 'warp') ?? 0.3) / n, rmax = (param(L, 'radius') ?? 0.4) / n, T = param(L, 'turrets') ?? 6;
    return (x, y) => {
      let u = (x + 0.5) / S, v = (y + 0.5) / S;
      u += (warp(u, v) - 0.5) * wa; v += (warp2(u, v) - 0.5) * wa;
      const ci = Math.floor(u * n), cj = Math.floor(v * n);
      let best = 0;
      for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
        const p = C.at(ci + di, cj + dj), s = (0.7 + 0.8 * env(p.x, p.y)) * Math.pow(p.s, 0.7);
        const R = rmax * (0.8 + 0.4 * Math.min(1, s)), dx = wrapD(u, p.x), dy = wrapD(v, p.y);
        const distSq = dx * dx + dy * dy;
        if (distSq > R * R * 2.5) continue;
        // 1. 넓은 빗구름 받침 (Convective shelf base)
        const qBase = 1 - distSq / (R * R * 2.2);
        if (qBase > 0) best = Math.max(best, s * 0.35 * Math.pow(qBase, 0.5));
        // 2. 중심 초거대 대류 기둥 (Central chimney updraft)
        const ang = Math.atan2(dy, dx);
        const rH = 1 + 0.2 * Math.cos(3 * ang + seed) + 0.15 * Math.sin(6 * ang);
        const qCore = 1 - distSq * (rH * rH) / (R * R);
        if (qCore > 0) best = Math.max(best, s * Math.pow(qCore, 0.85));
        // 3. 외곽 격렬한 난류 돔들
        const r2 = rng(Math.floor(p.s * 1e9) ^ (seed + 177));
        for (let t = 0; t < T; t++) {
          const a = r2() * 6.2832, off = (0.3 + 0.4 * r2()) * R, Rb = R * (0.35 + 0.3 * r2());
          const ex = dx - Math.cos(a) * off, ey = dy - Math.sin(a) * off;
          const aT = Math.atan2(ey, ex);
          const rHT = 1 + 0.25 * Math.cos(3 * aT + t * 1.8);
          const qT = 1 - (ex * ex + ey * ey) * (rHT * rHT) / (Rb * Rb);
          if (qT > 0) best = Math.max(best, s * (0.5 + 0.5 * r2()) * Math.pow(qT, 0.9));
        }
      }
      return best;
    };
  },
  // 적란운 모루: 탑과 같은 세포·휨 위에 큰 반지름의 둥근 판 — 바람 방향으로 늘이고 조금 밀어 둡니다.
  cbanvil(S, tileKm, seed, L) {
    const n = Math.max(1, Math.round(tileKm / (param(L, 'spacingKm') ?? 15)));
    const C = cells(n, seed), env = fbm(2, 3, seed + 7), warp = fbm(Math.max(4, n), 3, seed + 13), warp2 = fbm(Math.max(4, n), 3, seed + 17);
    const wa = (param(L, 'warp') ?? 0.35) / n, rmax = (param(L, 'radius') ?? 0.35) / n, skew = param(L, 'sizeSkew') ?? 1.5;
    const scale = param(L, 'anvilScale') ?? 3, stretch = param(L, 'stretch') ?? 1.2;
    const ang = ((param(L, 'windDeg') ?? 30) * Math.PI) / 180, ca = Math.cos(ang), sa = Math.sin(ang);
    return (x, y) => {
      let u = (x + 0.5) / S, v = (y + 0.5) / S;
      u += (warp(u, v) - 0.5) * wa; v += (warp2(u, v) - 0.5) * wa;
      const ci = Math.floor(u * n), cj = Math.floor(v * n);
      let best = 0;
      for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
        const p = C.at(ci + di, cj + dj), s = Math.pow(p.s, skew) * (0.4 + 1.2 * env(p.x, p.y));
        const R = rmax * (0.45 + 0.55 * Math.min(1, s)) * scale;
        // 바람 아래쪽으로 0.3R 밀고, 바람 방향으로 (1+stretch)배 늘입니다.
        const dx = wrapD(u, p.x) - ca * 0.3 * R, dy = wrapD(v, p.y) - sa * 0.3 * R;
        const along = (dx * ca + dy * sa) / (1 + stretch), across = -dx * sa + dy * ca;
        const q = 1 - Math.sqrt(along * along + across * across) / R;
        if (q > 0) best = Math.max(best, Math.min(1, s) * Math.pow(q, 0.5));
      }
      return best;
    };
  },
  // 난층운(비구름): 3중 복합 구조 (거시 먹구름 층 + 빗줄기 버가 샤프트 + 밑면에 찢겨 나부끼는 조각구름 Pannus)
  ns(S, tileKm, seed, L) {
    const baseScale = Math.max(2, Math.round(tileKm / 8));
    const baseOvercast = fbm(baseScale, 4, seed);
    const rainShaftL = Math.max(3, Math.round(tileKm / 3));
    const rainShaftW = Math.max(8, Math.round(tileKm / 0.8));
    const rainShafts = fbm2(rainShaftL, rainShaftW, 3, seed + 13);
    const scudScale = Math.max(6, Math.round(tileKm / 1.5));
    const scudClouds = fbm(scudScale, 4, seed + 37);
    const warp = fbm(Math.max(4, baseScale * 2), 3, seed + 19);
    const windDeg = param(L, 'windDeg') ?? 45;
    const ang = (windDeg * Math.PI) / 180;
    const ca = Math.cos(ang), sa = Math.sin(ang);

    return (x, y) => {
      let u = (x + 0.5) / S, v = (y + 0.5) / S;
      const wVal = (warp(u, v) - 0.5) * 0.08;
      u += wVal; v += wVal;
      const uRot = u * ca + v * sa, vRot = -u * sa + v * ca;

      // 1. 주 먹구름 기반 (0.6 ~ 1.0)
      const baseD = 0.65 + 0.35 * baseOvercast(u, v);
      // 2. 빗줄기 기둥/버가 샤프트 (강수 밴드)
      const shaft = Math.pow(Math.max(0, rainShafts(uRot, vRot) - 0.25) / 0.75, 1.2);
      // 3. 밑면 아래로 찢겨 나부끼는 하층 조각구름 (Pannus / Fractostratus)
      const scud = Math.pow(Math.max(0, scudClouds(u * 1.5, v * 1.5) - 0.35) / 0.65, 1.4);

      return Math.min(1.0, baseD * (0.8 + 0.35 * shaft) + 0.25 * scud);
    };
  },
  // 고층운·권층운: 큰 규모의 부드러운 판. 권층운은 약한 결(바람 방향)이 조금 섞입니다.
  as(S, tileKm, seed) {
    const g = fbm(Math.max(2, Math.round(tileKm / 6)), 4, seed);
    return (x, y) => 0.6 + 0.4 * g((x + 0.5) / S, (y + 0.5) / S);
  },
  cs(S, tileKm, seed, L) {
    const g = fbm(Math.max(2, Math.round(tileKm / 8)), 3, seed);
    const fibL = Math.max(2, Math.round(tileKm / 6)), fibW = Math.max(8, Math.round(tileKm / 0.4));
    const fib = fbm2(fibL, fibW, 2, seed + 7);
    const amt = param(L, 'rows') ?? 0.25;
    return (x, y) => {
      const u = (x + 0.5) / S, v = (y + 0.5) / S;
      return (0.65 + 0.35 * g(u, v)) * (1 - amt + amt * fib(u, v));
    };
  },
};

/**
 * 층별 종류·운량 → 날씨 바이트(RGBA8, S×S, 채널 r,g,b,a = 층 0..3). 운량 = 위에서 본 d > 0 면적 비율 —
 * d > 0 인 면적이 운량이 되게 문턱을 잡습니다(아래에서 본 화면 면적과의 차이는 `coverRemap`, §127).
 *
 * 생성기입니다 — 몇 줄마다 yield 해서 `makeGenusWeatherAsync` 가 JS 스레드를 오래 막지 않게 잘라 돕니다(§127:
 * 적운 512² 은 크롬에서 1.3초, 폰 JS 는 그 몇 배 — 그동안 화면이 멈췄습니다). 동기판은 끝까지 한 번에 돕니다.
 * 두 판의 바이트는 같습니다(계산 순서가 같음).
 */
function* genusWeatherSteps(
  data: Uint8Array, layers: (GenusLayer | null)[], S: number, tileKm: number, seed: number, plainCover: number[],
  flow: FlowSceneParams | null = null,
  stats: { s90?: number; hoursUsed?: number; umax?: number } = {},
): Generator<void, void, void> {
  const ROWS = 8;
  // §130 흐름 핵은 장면당 하나 — 첫 흐름 층에서 늦게 만들어 모든 층이 같은 변위 지도를 씁니다.
  let core: FlowCore | null = null;
  for (let k = 0; k < plainCover.length; k++) {
    const c = plainCover[k];
    if (!(c > 0) || k > 3 || layers[k]) continue;
    const f = fbm(Math.max(2, Math.round(tileKm / 1.5)), 4, seed + 77 + k);
    const v = new Float32Array(S * S);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) v[y * S + x] = f((x + 0.5) / S, (y + 0.5) / S);
      if (y % ROWS === ROWS - 1) yield;
    }
    const th = quantile(v, 1 - c);
    yield;
    for (let i = 0; i < S * S; i++) data[i * 4 + k] = Math.round(Math.min(1, Math.max(0, 0.5 + (v[i] - th) * 2)) * 255);
  }
  for (let k = 0; k < layers.length; k++) {
    const L = layers[k];
    if (!L || !(L.cover > 0) || k > 3) continue;
    const useFlow = !!flow && (fp(L, 'flow') ?? 0) > 0;
    const f = new Float32Array(S * S);
    if (useFlow && flow) {
      // §130 흐름 층: 원시장 f = wQ·q₀(X) + wZ·ζ̂₀(X) + wT·T(x − lag·D) + wW·cos(k_w·X) — 템플릿 T 는 기존 종류 무늬를 작은
      // 격자(TS²)에서 한 번 평가한 것, X = x − D(x) 는 흐름이 밀어낸 자리(라벨). 그 뒤 문턱·바이트는 아래 그대로(면적 = 운량).
      if (!core) {
        core = newFlowCore(flow.n);
        yield* flowCoreSteps(flow, tileKm, core);
        stats.s90 = core.s90; stats.hoursUsed = core.hoursUsed; stats.umax = core.umax;
      }
      const TS = Math.max(64, Math.round(fp(L, 'flowTemplateRes') ?? 256));
      const px = FIELDS[L.genus](TS, tileKm, L.opts?.seed ?? seed + k * 1000, L, true);
      const T = new Float32Array(TS * TS);
      for (let y = 0; y < TS; y++) {
        for (let x = 0; x < TS; x++) T[y * TS + x] = px(x, y);
        if (y % ROWS === ROWS - 1) yield;
      }
      normalizeTemplate(T);
      yield;
      const w = flowLayerWeightsOf(L.opts ?? {}, L.genus, tileKm, 0, L.opts?.shearDzKm ?? 2);
      yield* flowComposeSteps(core, T, TS, S, w, f);
    } else {
      const px = FIELDS[L.genus](S, tileKm, L.opts?.seed ?? seed + k * 1000, L);
      for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) f[y * S + x] = px(x, y);
        if (y % ROWS === ROWS - 1) yield;
      }
    }
    // 흐름 층은 히스토그램 분위수(정렬과 같은 값, 3배 빠름 — cloudFlow 테스트가 같음을 확인).
    const qf = useFlow ? quantileHist : quantile;
    const pw = param(L, 'domePow');
    if (L.opts?.skeleton && (L.genus === 'cu' || L.genus === 'cg')) {
      // §139 뼈대 열기둥: 운량은 생성기(켠 열기둥 Σ면적 + 스커트)가 맞췄으므로 문턱·감마 없이 절대 d. 0 < f < 1/510 도 1 로(스커트 끝).
      for (let i = 0; i < S * S; i++) data[i * 4 + k] = f[i] > 0 ? Math.max(1, Math.round(Math.min(1, f[i]) * 255)) : 0;
      continue;
    }
    if (param(L, 'absolute')) {
      // 문턱 없이 장 값 그대로 — 모루처럼 "탑 둘레에만" 있어야 하는 층. cover 는 쓰지 않습니다.
      for (let i = 0; i < S * S; i++) data[i * 4 + k] = Math.round(Math.pow(Math.min(1, Math.max(0, f[i])), pw) * 255);
      continue;
    }
    const isHighCloud = L.genus === 'ci' || L.genus === 'cs';
    if (!isHighCloud && L.cover < 0.999) { growBeyondCapacity(f, S, L.cover); yield; }
    const th = L.cover >= 0.999 ? -1 : qf(f, 1 - L.cover);
    yield;
    if (useFlow) {
      // §130 흐름 층: d = 구름 화소 순위^flowDPow(cloudFlow.rankNormalize) — 운량·속과 무관하게 같은 히스토그램. 면적 = 운량 그대로.
      const dd = new Float32Array(S * S);
      rankNormalize(f, th, fp(L, 'flowDPow') ?? FLOW_D_POW, dd);
      yield;
      // domePow(권운 1.5)는 선형 d 의 히스토그램 손질이었으므로 순위 d 에는 겹쳐 쓰지 않습니다(겹치면 권운 엔트로피 2.6 bit).
      for (let i = 0; i < S * S; i++) data[i * 4 + k] = dd[i] > 0 ? Math.max(1, Math.round(dd[i] * 255)) : 0;
      continue;
    }
    const top = qf(f, param(L, 'topQuantile') ?? 0.997);
    yield;
    for (let i = 0; i < S * S; i++) {
      const d = f[i] > th ? Math.min(1, Math.max(1 / 255, (f[i] - th) / Math.max(1e-6, top - th))) : 0;
      data[i * 4 + k] = Math.round(Math.pow(d, pw) * 255);
    }
  }
}

/**
 * §127 운량이 무늬의 최대 덮임을 넘을 때. 세포·띠 무늬(적운 0.305 · 웅대적운 0.428 · 고적운 0.667 · 권운 0.610 — 위에서 본 장 > 0 의
 * 넓이)는 그 밖이 모두 0 이라, 분위수 문턱이 0 에 걸려 운량 50·75·90% 가 같은 그림이었습니다(아래에서 본 적운 면적 0.237 에서 멈춤).
 * 운량이 그 넓이를 넘으면 0 인 곳을 **가장 가까운 구름까지 거리**의 음수로 줄 세워(주기 경계 체임퍼 거리), 문턱이 0 아래로 내려가
 * 세포 둘레부터 얇게 번지게 합니다. 넓이 안의 운량은 장을 바꾸지 않아 이전과 같은 바이트입니다.
 */
function growBeyondCapacity(f: Float32Array, S: number, cover: number): void {
  let nz = 0;
  for (let i = 0; i < f.length; i++) if (f[i] > 0) nz++;
  if (nz === 0 || cover <= (nz / f.length) * 0.98) return;
  const INF = 1e9, d = new Float32Array(f.length);
  for (let i = 0; i < f.length; i++) d[i] = f[i] > 0 ? 0 : INF;
  const at = (x: number, y: number) => ((y + S) % S) * S + ((x + S) % S);
  // 체임퍼(3·4) 앞뒤 두 번씩 — 주기 경계를 넘는 거리도 잡히게 두 바퀴.
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const i = y * S + x; let v = d[i];
      v = Math.min(v, d[at(x - 1, y)] + 3, d[at(x, y - 1)] + 3, d[at(x - 1, y - 1)] + 4, d[at(x + 1, y - 1)] + 4);
      d[i] = v;
    }
    for (let y = S - 1; y >= 0; y--) for (let x = S - 1; x >= 0; x--) {
      const i = y * S + x; let v = d[i];
      v = Math.min(v, d[at(x + 1, y)] + 3, d[at(x, y + 1)] + 3, d[at(x + 1, y + 1)] + 4, d[at(x - 1, y + 1)] + 4);
      d[i] = v;
    }
  }
  // 거리 단위: 타일의 1/5(24km 타일이면 4.8km)를 1 로 — 번진 테두리의 기둥 높이 d 가 0.1~0.3 쯤이 되게(장의 최댓값 ≈ 1).
  // 체임퍼 거리는 정수 계단이라 같은 값이 많아(고적운은 0 인 곳 대부분이 구름 바로 옆) 분위수 문턱이 그 값에 걸리면 한 칸도
  // 안 늘었습니다 — 부드러운 잡음(한 칸 미만)을 더해 줄을 풀고 테두리를 고르지 않게 합니다.
  const unit = 3 * S * 0.2, jit = fbm(16, 2, 911);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x;
    if (!(f[i] > 0)) f[i] = -(d[i] + 2.9 * jit((x + 0.5) / S, (y + 0.5) / S)) / unit;
  }
}

function weatherTexture(data: Uint8Array, S: number): DataTexture {
  const t = new DataTexture(data, S, S, RGBAFormat, UnsignedByteType);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.minFilter = LinearMipMapLinearFilter; t.magFilter = LinearFilter; t.generateMipmaps = true;
  t.colorSpace = NoColorSpace; t.flipY = false;
  t.needsUpdate = true;
  return t;
}

/** 날씨 텍스처를 한 번에 만듭니다(시험 화면·하네스). */
export function makeGenusWeather(
  layers: (GenusLayer | null)[], S = 256, tileKm = 24, seed = 7,
  /** 종류 없는 채널에 넣을 기본 잡음 운량(0~1) — takram 기본 모양(순위 문턱 fbm)으로 채웁니다. */
  plainCover: number[] = [],
  /** §130 흐름 핵 매개변수 — null 이면 흐름 없이(이전과 바이트 동일). */
  flow: FlowSceneParams | null = null,
): DataTexture {
  const data = new Uint8Array(S * S * 4);
  const stats = {};
  const it = genusWeatherSteps(data, layers, S, tileKm, seed, plainCover, flow, stats);
  while (!it.next().done) { /* 끝까지 */ }
  const tex = weatherTexture(data, S);
  tex.userData = { ...(tex.userData ?? {}), flow: stats };
  return tex;
}

/**
 * 날씨 텍스처를 잘라 만듭니다(§127, 하늘 화면). sliceMs 마다 다음 틱으로 넘겨 그 사이 그리기·손가락 입력이 돕니다.
 * `cancelled()` 가 참이 되면 중간에 멈추고 null 을 돌려줍니다(더 새 장면이 들어옴).
 */
export async function makeGenusWeatherAsync(
  layers: (GenusLayer | null)[], S = 256, tileKm = 24, seed = 7, plainCover: number[] = [],
  sliceMs = 16, cancelled: () => boolean = () => false, flow: FlowSceneParams | null = null,
): Promise<DataTexture | null> {
  const data = new Uint8Array(S * S * 4);
  const stats = {};
  const it = genusWeatherSteps(data, layers, S, tileKm, seed, plainCover, flow, stats);
  let t0 = Date.now();
  for (;;) {
    if (it.next().done) break;
    if (Date.now() - t0 >= sliceMs) {
      await new Promise<void>(r => setTimeout(r, 0));
      if (cancelled()) return null;
      t0 = Date.now();
    }
  }
  const tex = weatherTexture(data, S);
  tex.userData = { ...(tex.userData ?? {}), flow: stats };
  return tex;
}

type PatchableMaterial = { fragmentShader: string; uniforms: Record<string, { value: unknown }>; needsUpdate: boolean };
/** §126.6 햇빛 확산 투과(thru) 블록 — patchGenusShader 가 넣고 §138 injectGenusDiffuse 가 같은 글자를 찾아 바꿉니다(한 상수). */
const THRU_BLOCK = [
  '',
  '      {',
  '        vec4 gLayerH = max(maxLayerHeights - minLayerHeights, vec4(1.0));',
  '        vec4 gTau = media.extinction * max(vec4(1.0) - weather.heightFraction, vec4(0.0)) * gLayerH;',
  '        // 다중 산란 최저광: 두꺼운 구름도 햇빛을 등질 때 웅장한 은빛/금빛 확산광 보장',
  '        vec4 gMultiScat = max(vec4(0.28), exp(-0.035 * gTau)) * max(genusBeamTransmittance, vec4(0.25));',
  '        vec4 gThru = genusThru * genusOn * (vec4(1.0) - exp(-0.15 * gTau)) * (2.0 / (2.0 + 0.1 * gTau)) * gMultiScat;',
  '        radiance += sunIrradiance * RECIPROCAL_PI4 * dot(gThru, media.weight);',
  '      }',
].join('\n');
const VEC_UNIFORMS = ['genusOn', 'genusMode', 'genusBase', 'genusTop', 'genusEdge', 'genusAO', 'genusThru', 'genusBeamTransmittance'] as const;

/**
 * 셰이더 패치 — 구름 패스와 그림자 패스 둘 다(같은 clouds.glsl). genusOn = 0 인 층은 takram 그대로입니다.
 * 기준 문자열이 없으면(takram 판이 바뀜) throw — 조용히 틀리지 않게.
 */
export function patchGenusShader(mat: PatchableMaterial): void {
  let src = mat.fragmentShader;
  const decl = 'uniform vec4 coverageFilterWidths;';
  const a = '  vec4 heightScale = shapeAlteringFunction(weather.heightFraction, shapeAlteringBiases);';
  const b = '    factor + coverageFilterWidths\n  );';
  const st = 'struct WeatherSample {\n  vec4 heightFraction; // Normalized height of each layer\n  vec4 density;\n};';
  const g = 'vec2 getGlobeUv(const vec3 position) {\n  return getCubeSphereUv(position);\n}';
  for (const anchor of [decl, a, b, st, g]) {
    if (!src.includes(anchor)) throw new Error('cloudGenus: shader anchor missing — ' + anchor.slice(0, 40));
  }
  src = src.replace(decl, decl + '\n' + VEC_UNIFORMS.map(u => 'uniform vec4 ' + u + ';').join('\n'));
  src = src.replace(a, a + [
    '',
    '  // 종류별 단면: d(날씨) 가 문턱 1 - hs 를 넘는 곳이 구름.',
    '  vec4 gHf = weather.heightFraction;',
    '  // §135 0단계: 세로 단면을 병합 전(§130) 것으로 되돌림 — 밑면은 평평하게(smoothstep 한 번) 시작해 위로 갈수록 좁아집니다.',
    '  // §134 의 가운데 팽창(sin)·밑면 굴곡은 마디마다 둥근 알을 만들어 소시지 모양을 낳았습니다.',
    '  vec4 gRamp = smoothstep(vec4(0.0), max(genusBase, vec4(1e-4)), gHf);',
    '  vec4 gDome = gRamp * pow(max(vec4(1.0) - gHf, vec4(1e-6)), genusTop);',
    '  vec4 gLens = vec4(1.0) - pow(max(abs(gHf * 2.0 - 1.0), vec4(1e-6)), max(genusTop, vec4(1e-3)));',
    '  vec4 gHs = mix(gDome, gLens, step(vec4(0.5), genusMode));',
    '  vec4 gDensity = clamp((localWeather - (vec4(1.0) - gHs)) * genusEdge, 0.0, 1.0);',
    '  gDensity *= step(vec4(1.0 / 512.0), localWeather);',
  ].join('\n'));
  src = src.replace(b, b + '\n  weather.density = mix(weather.density, gDensity, genusOn);\n  weather.depth = max(localWeather - (vec4(1.0) - gHs), vec4(0.0));');
  src = src.replace(st, 'struct WeatherSample {\n  vec4 heightFraction;\n  vec4 density;\n  vec4 depth;\n};');
  const sg = 'float skyGradient = dot(weather.heightFraction * 0.5 + 0.5, media.weight);';
  if (src.includes(sg)) {
    src = src.replace(sg, sg + '\n      skyGradient *= dot(mix(vec4(1.0), max(vec4(0.35), exp(-genusAO * weather.depth)), genusOn), media.weight);');
  }
  // 햇빛 확산 투과(GenusParams.thru): 위쪽 광학두께 ≈ 이 표본의 소광 × 꼭대기까지 거리.
  const amb = 'radiance += skyIrradiance * RECIPROCAL_PI4 * skyGradient * skyLightScale;';
  if (src.includes(amb)) {
    src = src.replace(amb, amb + THRU_BLOCK);
  }
  src = src.replace(g, [
    'uniform vec3 genusOrigin;', 'uniform vec3 genusEast;', 'uniform vec3 genusNorth;', 'uniform float genusTileM;',
    'uniform float genusPlanar;',
    'vec2 getGlobeUv(const vec3 position) {',
    '  vec3 d = position - genusOrigin;',
    '  return genusPlanar > 0.5 ? vec2(dot(d, genusEast), dot(d, genusNorth)) / genusTileM : getCubeSphereUv(position);',
    '}',
  ].join('\n'));
  mat.fragmentShader = src;
  for (const u of VEC_UNIFORMS) mat.uniforms[u] = { value: new Vector4() };
  mat.uniforms.genusOrigin = { value: new Vector3() };
  mat.uniforms.genusEast = { value: new Vector3(1, 0, 0) };
  mat.uniforms.genusNorth = { value: new Vector3(0, 1, 0) };
  mat.uniforms.genusTileM = { value: 24000 };
  mat.uniforms.genusPlanar = { value: 0 };
  mat.needsUpdate = true;
}

/** 접평면 날씨 좌표 켜기(관측점 ECEF, 동·북 단위벡터, 텍스처 한 장의 길이 m). null 이면 takram 원래 좌표. */
export function setGenusFrame(mat: PatchableMaterial, frame: { origin: Vector3; east: Vector3; north: Vector3; tileM: number } | null): void {
  mat.uniforms.genusPlanar.value = frame ? 1 : 0;
  if (!frame) return;
  (mat.uniforms.genusOrigin.value as Vector3).copy(frame.origin);
  (mat.uniforms.genusEast.value as Vector3).copy(frame.east).normalize();
  (mat.uniforms.genusNorth.value as Vector3).copy(frame.north).normalize();
  mat.uniforms.genusTileM.value = frame.tileM;
}

/** 층별 종류 손잡이를 셰이더에 넣습니다. 종류가 없는 층은 genusOn = 0(takram 그대로). */
export function setGenusUniforms(mat: PatchableMaterial, layers: (GenusLayer | null)[]): void {
  const lane = (fn: (L: GenusLayer) => number) => [0, 1, 2, 3].map(i => (layers[i] ? fn(layers[i] as GenusLayer) : 0));
  const set = (u: (typeof VEC_UNIFORMS)[number], v: number[]) => (mat.uniforms[u].value as Vector4).set(v[0], v[1], v[2], v[3]);
  set('genusOn', lane(() => 1));
  set('genusMode', lane(L => param(L, 'mode')));
  set('genusBase', lane(L => param(L, 'base')));
  set('genusTop', lane(L => param(L, 'top')));
  set('genusEdge', lane(L => param(L, 'edge')));
  set('genusAO', lane(L => param(L, 'ao')));
  set('genusThru', lane(L => param(L, 'thru') ?? 1));
  set('genusBeamTransmittance', lane(L => (L?.opts as any)?.beamTransmittance ?? 1));
}

/**
 * §136 P2 셰이더 — 22°·46° 무리(구름 패스 첫 산란 차수)와 얇은 층 가루 효과 끔. **켤 때만** 구름 패스 셰이더에 삽입하고, 끄면 삽입 전 원문으로
 * 되돌립니다 — 끈 상태의 셰이더 글자가 §136 이전과 같아야 "끄면 그대로"가 컴파일 결과의 부동소수점 반올림까지 지켜집니다
 * (삽입 코드가 죽은 가지로 남아 있어도 cu_200·tw1734 의 화소가 몇백 개 달라졌음 — RULER-physics G3). 삽입 전 원문은 재질별로 처음 부를 때 기억합니다.
 */
const ICE_RAD = 'vec3 radiance = sunIrradiance * approximateMultipleScattering(opticalDepth, cosTheta);';
const ICE_POW = 'radiance *= 1.0 - powderScale * exp(-media.extinction * powderExponent);';
const ICE_MARCH = 'vec4 marchClouds(';
const ICE_DECL = 'uniform vec4 coverageFilterWidths;';
/** 삽입 전 원문 → 무리·가루 코드를 넣은 원문. 구름 패스가 아니면(앵커 없음) 그대로. */
export function injectGenusIce(base: string): string {
  if (!base.includes(ICE_RAD) || !base.includes(ICE_MARCH) || !base.includes(ICE_DECL)) return base;
  let src = base.replace(ICE_DECL, ICE_DECL + '\nuniform vec4 genusHalo;\nuniform vec4 genusPowderW;\nuniform float genusPhysOn;');
  src = src.replace(ICE_MARCH, [
    '// §136 22°·46° 무리(무작위 방향 육각 기둥): 최소 편향각에서 날카롭게 오르고 바깥으로 지수 감쇠. 파장마다 중심이 달라 안쪽이 붉음.',
    'vec3 genusHaloRing(const float th, const vec3 c, const float rise, const float w) {',
    '  return smoothstep(c - rise, c, vec3(th)) * exp(-max(vec3(th) - c, vec3(0.0)) / w);',
    '}',
    'vec3 genusHaloPhase(const float cosTheta) {',
    '  float th = degrees(acos(clamp(cosTheta, -1.0, 1.0)));',
    '  return 0.25 * (genusHaloRing(th, vec3(21.6, 21.9, 22.3), 0.4, 1.2) + 0.15 * genusHaloRing(th, vec3(45.6, 46.0, 46.6), 0.6, 2.0));',
    '}',
    ICE_MARCH,
  ].join('\n'));
  src = src.replace(ICE_RAD, [
    ICE_RAD,
    '      if (genusPhysOn > 0.5) {',
    '        // 첫 산란 차수(해에서 곧장 온 빛, e^(−τ))에만 얼음 무리 위상을 더합니다 — 여러 번 산란한 빛은 무리를 지웁니다.',
    '        float gHaloW = dot(genusHalo, media.weight);',
    '        if (gHaloW > 0.0) radiance += sunIrradiance * (gHaloW * exp(-opticalDepth)) * genusHaloPhase(cosTheta);',
    '      }',
  ].join('\n'));
  if (src.includes(ICE_POW)) {
    src = src.replace(ICE_POW, 'radiance *= 1.0 - powderScale * (genusPhysOn > 0.5 ? dot(genusPowderW, media.weight) : 1.0) * exp(-media.extinction * powderExponent);');
  }
  return src;
}
/** 조명 바닥값(§134 의 다중 산란 최저광) 두 곳의 글자 — 구름 패스에만 있음(그림자 패스엔 skyGradient 줄이 없음). 진단(§137 D1)에서만 치환합니다. */
const FLOOR_SKY = 'max(vec4(0.35), exp(-genusAO * weather.depth))';
const FLOOR_MS = 'max(vec4(0.28), exp(-0.035 * gTau))';
/** 바닥값 [하늘빛 가림, 다중 산란]을 치환한 원문. floors 가 null 이거나 앵커가 없으면(그림자 패스) 그대로. */
export function applyGenusFloors(base: string, floors: [number, number] | null): string {
  if (!floors || !base.includes(FLOOR_SKY) || !base.includes(FLOOR_MS)) return base;
  const lit = (v: number) => (Number.isInteger(v) ? v.toFixed(1) : String(v));
  return base
    .replace(FLOOR_SKY, `max(vec4(${lit(floors[0])}), exp(-genusAO * weather.depth))`)
    .replace(FLOOR_MS, `max(vec4(${lit(floors[1])}), exp(-0.035 * gTau))`);
}

/**
 * 셰이더 변형 상태 — 재질마다 삽입 전 원문(base)과 지금 켠 변형(얼음 무리·가루, 바닥값 치환)을 기억합니다. 변형을 모두 끄면 글자가 base 와 같고
 * 변형이 쓰던 균일변수도 지웁니다(끈 장면의 상태 해시가 처음 만든 장면과 같도록 — 같은 페이지에서 얼음 장면 뒤 물 장면이 균일변수를 물려받던 결함).
 */
interface ShaderVariant { base: string; ice: boolean; floors: [number, number] | null; diffuse: 0 | 1 | 2 | 3 | 9; skeleton: boolean }
const VARIANT = new WeakMap<object, ShaderVariant>();
function variantOf(mat: PatchableMaterial): ShaderVariant {
  let v = VARIANT.get(mat);
  if (!v) { v = { base: mat.fragmentShader, ice: false, floors: null, diffuse: 0, skeleton: false }; VARIANT.set(mat, v); }
  return v;
}
function refreshVariant(mat: PatchableMaterial): void {
  const v = variantOf(mat);
  // §138 확산광은 thru 블록·하늘빛 줄을 통째로 바꾸므로 **먼저** 넣고, 바닥값 치환은 그 뒤(L2·L3 에서는 앵커가 사라져 바닥값 치환이 조용히 비활성 — 둘은 함께 쓰지 않음).
  if (v.diffuse >= 2 && v.floors && v.base.includes(IS_CLOUDS)) throw new Error('cloudGenus: debugLightFloors 는 diffuse 2·3 과 함께 쓸 수 없습니다(바닥값 앵커가 교체됨)');
  // §139 뼈대 레인은 날씨 단계(sampleWeather)만 바꾸므로 확산·바닥값·얼음 앵커와 겹치지 않음 — 가장 먼저.
  let want = v.skeleton ? injectGenusSkeleton(v.base) : v.base;
  want = injectGenusDiffuse(want, v.diffuse);
  want = applyGenusFloors(want, v.floors);
  if (v.ice) want = injectGenusIce(want);
  if (mat.fragmentShader !== want) { mat.fragmentShader = want; mat.needsUpdate = true; }
  const injected = v.ice && want.includes('genusPhysOn');
  if (injected && !mat.uniforms.genusPhysOn) {
    mat.uniforms.genusHalo = { value: new Vector4() };
    mat.uniforms.genusPowderW = { value: new Vector4(1, 1, 1, 1) };
    mat.uniforms.genusPhysOn = { value: 0 };
  }
  if (!injected && mat.uniforms.genusPhysOn) {
    delete mat.uniforms.genusHalo; delete mat.uniforms.genusPowderW; delete mat.uniforms.genusPhysOn;
    mat.needsUpdate = true;
  }
  const skOn = v.skeleton && want.includes('uniform vec4 genusSkel;');
  if (skOn && !mat.uniforms.genusSkel) mat.uniforms.genusSkel = { value: new Vector4() };
  if (!skOn && mat.uniforms.genusSkel) { delete mat.uniforms.genusSkel; mat.needsUpdate = true; }
}

/**
 * §139 뼈대 레인 셰이더(RULER-shape 검토 구현 1·2·3·6) — 구름·그림자 패스 모두(sampleWeather 안). genusSkel = 1 인 층만:
 *  - 뚜껑 단면 genusMode 3: hs = hf (꼭대기 평평·밑면 = 1 − d), hf = 1(층 위 표본) 에서 0 가드 — 위층 띠로 새지 않게.
 *  - 밀도 = **봉투까지의 hf 거리**(d·edge 가 아님): 돔 (d − hf)·8, 뚜껑 (hf − (1 − d))·8, 밑면 램프 0.03 — d 가 작은 기둥도 속이 꽉 참.
 *  - weather.depth(하늘빛 가림·thru 의 깊이) = 꼭대기에서 내려온 거리: 돔 d − hf, 뚜껑 1 − hf.
 * 앵커는 patchFlowShader 가 만든 문장(흐름 패치 직후의 글자). 끄면(refreshVariant) 삽입 전 원문이라 글자·균일변수가 K0 과 같음(G3).
 */
const SK_DECL = 'uniform vec4 coverageFilterWidths;';
const SK_HS = '  vec4 gHs = mix(mix(gDome, gLens, step(vec4(0.5), genusMode)), gDomeL, step(vec4(1.5), genusMode));';
const SK_STEP = '  gDensity *= mix(step(vec4(1.0 / 512.0), localWeather), smoothstep(vec4(0.0), vec4(2.0 / 255.0), localWeather), genusFlow);';
const SK_DEPTH = '  weather.depth = mix(max(localWeather - (vec4(1.0) - gHs), vec4(0.0)), gDepthTau, genusFlow);';
export function injectGenusSkeleton(base: string): string {
  for (const a of [SK_DECL, SK_HS, SK_STEP, SK_DEPTH]) if (!base.includes(a)) throw new Error('cloudGenus: skeleton anchor missing — ' + a.trim().slice(0, 40));
  let src = base.replace(SK_DECL, SK_DECL + '\nuniform vec4 genusSkel;');
  src = src.replace(SK_HS, [
    SK_HS,
    '  // §139 뚜껑 단면(mode 3): 꼭대기 평평, 밑면 = 1 − d. 층 위(hf = 1) 에서 0.',
    '  vec4 gCapGuard = step(gHf, vec4(1.0 - 1e-4));',
    '  vec4 gIsCap = step(vec4(2.5), genusMode);',
    '  gHs = mix(gHs, gHf * gCapGuard, gIsCap);',
  ].join('\n'));
  src = src.replace(SK_STEP, [
    SK_STEP,
    '  // §139 뼈대 레인: 밀도 = 봉투까지의 높이 거리(돔 d − hf, 뚜껑 hf − (1 − d)) × 밑면 램프 0.03.',
    '  vec4 gSkDome = clamp((localWeather - gHf) * 8.0, 0.0, 1.0);',
    '  vec4 gSkCap = clamp((gHf - (vec4(1.0) - localWeather)) * 8.0, 0.0, 1.0) * gCapGuard;',
    '  vec4 gSkDens = mix(gSkDome, gSkCap, gIsCap) * smoothstep(vec4(0.0), vec4(0.03), gHf) * step(vec4(1.0 / 512.0), localWeather);',
    '  gDensity = mix(gDensity, gSkDens, genusSkel);',
  ].join('\n'));
  src = src.replace(SK_DEPTH, [
    SK_DEPTH,
    '  weather.depth = mix(weather.depth, mix(max(localWeather - gHf, vec4(0.0)), (vec4(1.0) - gHf) * gCapGuard, gIsCap), genusSkel);',
  ].join('\n'));
  return src;
}
/** 뼈대 레인 켜기 — on 이면 삽입하고 층별 genusSkel(opts.skeleton 이 있는 층 1). 꺼지면 원문·균일변수 복귀. */
export function setGenusSkeleton(mat: PatchableMaterial, layers: (GenusLayer | null)[], on: boolean): void {
  const v = variantOf(mat);
  v.skeleton = on && layers.some(L => !!L?.opts?.skeleton);
  refreshVariant(mat);
  if (mat.uniforms.genusSkel) {
    const lane = [0, 1, 2, 3].map(i => (layers[i]?.opts?.skeleton ? 1 : 0));
    (mat.uniforms.genusSkel.value as Vector4).set(lane[0], lane[1], lane[2], lane[3]);
  }
}

/**
 * §136·§137 얼음 레인(층별 무리 세기·가루 효과 무게). 얼음 코드는 **레인이 실제로 쓰일 때만**(어느 층이든 halo > 0 또는 powder < 1) 구름 패스 셰이더에 삽입하고,
 * 아니면 삽입 전 원문으로 되돌립니다. 물 구름만 있는 장면은 켜 두어도 셰이더·균일변수가 끈 장면과 같습니다. 그림자 패스처럼 앵커가 없는 재질은 아무것도 하지 않습니다.
 * 물리 값이 없는 층은 무리 0 · 가루 1.
 */
export function setGenusPhysics(mat: PatchableMaterial, lanes: ({ halo: number; powder: number } | null)[], on: boolean): void {
  const active = on && lanes.some(l => !!l && (l.halo > 0 || l.powder < 1));
  variantOf(mat).ice = active;
  refreshVariant(mat);
  if (!active || !mat.uniforms.genusPhysOn) return;
  const v = (fn: (l: { halo: number; powder: number }) => number, dflt: number) => [0, 1, 2, 3].map(i => (lanes[i] ? fn(lanes[i] as { halo: number; powder: number }) : dflt));
  const h = v(l => l.halo, 0), w = v(l => l.powder, 1);
  (mat.uniforms.genusHalo.value as Vector4).set(h[0], h[1], h[2], h[3]);
  (mat.uniforms.genusPowderW.value as Vector4).set(w[0], w[1], w[2], w[3]);
  mat.uniforms.genusPhysOn.value = 1;
}

/** §137 D1 진단 — 조명 바닥값 치환(null 이면 끔 = 원문). 기본값을 바꾸는 것이 아니라 켜 보기만 합니다. */
export function setGenusLightFloors(mat: PatchableMaterial, floors: [number, number] | null): void {
  variantOf(mat).floors = floors;
  refreshVariant(mat);
}

/**
 * §138 구름 속 확산광(RULER-physics3). 구름 패스의 하늘빛 줄 + thru 블록(patchGenusShader 가 넣은 글자)을 후보별로 바꿉니다 — **켤 때만**, 끄면 원문.
 * 기둥 광학두께는 그림자 지도가 아니라(행진 minTransmittance 에서 τ ≈ 72 로 포화) 층 단면의 **해석적 적분**: τ(hf 구간) = densityScale(층 공칭) × H × ∫ gDensity(hf)·profile(hf) dhf — 모양 잡음은 넣지 않음(상한, §8)
 * — gDensity 는 patchGenusShader 와 같은 식(날씨 d 는 weather.depth 에서 되찾음: d = depth + 1 − hs(hf_표본)), 중점 8 개. 표본의 모양 잡음 배율이 기둥 전체에 걸리는 것은 한계(§8).
 *   1 (L1): thru 식·바닥값은 그대로, τ_up 만 해석적 기둥(표본 위)으로.
 *   2 (L2): 하늘빛 항 = 충돌 전 하늘빛만(E_h = skyIrradiance/2π, 반구 평균 ½, e^(−2τ'_above); ao·0.35 바닥값 은퇴), thru 블록 = 두-흐름 확산장
 *           J = [E_sun·μ0·K(μ0)·D_sun + E_h·D_sky] / 2π (0.28·0.25 바닥값·genusThru 없음).
 *   3 (L3): L2 의 확산장만 넣고 takram 하늘빛 항·ao 바닥값은 **그대로**(하늘빛 이중 계산 대조 — 검토 4 의 예측 "RC 통과 불가" 를 재는 후보).
 * 그림자 패스(구름 패스 판별 줄 없음)는 그대로; 구름 패스인데 앵커가 없으면 throw(조용히 L0 이 되지 않게). debugLightFloors 는 L2·L3 와 함께 못 씀(throw).
 * 균일변수는 새로 두지 않습니다(상수를 글자로).
 */
const DIFF_TAU_LINE = '        vec4 gTau = media.extinction * max(vec4(1.0) - weather.heightFraction, vec4(0.0)) * gLayerH;';
const DIFF_SKY_FLOOR = '      skyGradient *= dot(mix(vec4(1.0), max(vec4(0.35), exp(-genusAO * weather.depth)), genusOn), media.weight);';
/** 구름 패스 판별자(= takram 하늘빛 항) — 이 줄이 있으면 구름 패스. */
const IS_CLOUDS = 'radiance += skyIrradiance * RECIPROCAL_PI4 * skyGradient * skyLightScale;';
const DIFF_MU0 = `max(${MU0_MIN.toFixed(4)}, dot(surfaceNormal, sunDirection))`;
/** 해석적 기둥 τ(표본 위·전체, vec4 층별) — L1·L2·L3 공통. gTauA(위), gTauT(전체) 를 둡니다. */
const COLUMN_GLSL = [
  '        vec4 gLayerH = max(maxLayerHeights - minLayerHeights, vec4(1.0));',
  '        vec4 gHf0 = weather.heightFraction;',
  '        vec4 gLW = weather.depth + vec4(1.0) - genusHsD(gHf0);   // 날씨 d 되찾기(구름 안 표본: depth > 0)',
  '        vec4 gIntA = vec4(0.0), gIntT = vec4(0.0);',
  `        for (int gi = 0; gi < ${COLUMN_N}; ++gi) {`,
  `          float gHfi = (float(gi) + 0.5) / ${COLUMN_N}.0;`,
  '          // 층 공칭 밀도(모양 잡음 없음) × takram 층 단면 — 표본의 소광/밀도 비를 쓰면 모양 잡음에 깎인 표면 표본이 기둥 전체를 과소평가함(진단 렌더: sc τ 19).',
  '          vec4 gDi = clamp((gLW - (vec4(1.0) - genusHsD(vec4(gHfi)))) * genusEdge, 0.0, 1.0) * getLayerDensity(vec4(gHfi));',
  '          gIntT += gDi;',
  '          gIntA += gDi * step(gHf0, vec4(gHfi));',
  '        }',
  `        vec4 gTauA = densityScales * gLayerH * gIntA / ${COLUMN_N}.0;`,
  `        vec4 gTauT = max(gTauA, densityScales * gLayerH * gIntT / ${COLUMN_N}.0);`,
].join('\n');
const HS_GLSL = [
  '// §138 종류 단면 hs(hf) — patchGenusShader 의 식과 같음(기둥 적분용).',
  'vec4 genusHsD(const vec4 hf) {',
  '  vec4 ramp = smoothstep(vec4(0.0), max(genusBase, vec4(1e-4)), hf);',
  '  vec4 dome = ramp * pow(max(vec4(1.0) - hf, vec4(1e-6)), genusTop);',
  '  vec4 lens = vec4(1.0) - pow(max(abs(hf * 2.0 - 1.0), vec4(1e-6)), max(genusTop, vec4(1e-3)));',
  '  return mix(dome, lens, step(vec4(0.5), genusMode));',
  '}',
].join('\n');
const DIFFUSE_FIELD_GLSL = [
  '      {',
  '        // §138 두-흐름 확산장(해석적 기둥 τ, 수직). J = [E_sun·μ0·K(μ0)·D_sun + E_h·D_sky] / 2π.',
  COLUMN_GLSL,
  `        float gMu0 = ${DIFF_MU0};`,
  '        float gTa = dot(gTauA, media.weight), gTt = dot(gTauT, media.weight);',
  '        float gDsun = genusDiffuseField(gTa, gTt, 1.0 / gMu0);',
  `        float gDsky = genusDiffuseField(gTa, gTt, ${SKY_SECANT.toFixed(1)});`,
  `        vec3 gJ = (sunIrradiance * gMu0 * genusSunWeight(gMu0) * gDsun + skyIrradiance * ${INV_2PI.toFixed(6)} * gDsky) * ${INV_2PI.toFixed(6)};`,
  '        radiance += gJ * dot(genusOn, media.weight);',
  '      }',
].join('\n');
export function injectGenusDiffuse(base: string, mode: 0 | 1 | 2 | 3 | 9): string {
  if (!mode) return base;
  if (!base.includes(IS_CLOUDS)) return base;   // 그림자 패스
  if (!base.includes(THRU_BLOCK) || !base.includes(DIFF_TAU_LINE) || !base.includes(ICE_MARCH) || !base.includes(DIFF_SKY_FLOOR)) throw new Error('cloudGenus: diffuse anchor missing');
  let src = base.replace(ICE_MARCH, HS_GLSL + '\n' + DIFFUSE_GLSL + '\n' + ICE_MARCH);
  if (mode === 1) {
    // L1: 기둥 τ(표본 위)만 바꿈 — thru 식·바닥값 그대로.
    return src.replace(DIFF_TAU_LINE, [
      '        // §138 L1: 위쪽 광학두께를 표본 국소 소광 × 거리 대신 해석적 기둥(표본 위)으로.',
      COLUMN_GLSL.split('\n').slice(1).join('\n'),   // gLayerH 는 이미 위 줄에 있음
      '        vec4 gTau = gTauA;',
    ].join('\n'));
  }
  if ((mode as number) === 9) {
    // 진단 전용(후보 아님): 표본의 해석적 기둥 τ 를 색으로 — R = τ_total/200, G = τ_above/200, B = D_sun. 산란 광원 대신 그대로 씁니다.
    return src.replace(THRU_BLOCK, '\n' + DIFFUSE_FIELD_GLSL.replace('        radiance += gJ * dot(genusOn, media.weight);', '        radiance = vec3(gTt / 200.0, gTa / 200.0, gDsun);'));
  }
  src = src.replace(THRU_BLOCK, '\n' + DIFFUSE_FIELD_GLSL);
  if (mode === 2) {
    // L2: 하늘빛 항 = 충돌 전 하늘빛만(E_h·½·e^(−2τ'_above)·skyGradient), ao·0.35 바닥값 은퇴.
    src = src.replace(DIFF_SKY_FLOOR, [
      '      // §138 L2: ao·0.35 바닥값 은퇴 — 산란된 하늘빛은 아래 확산장(D_sky)이, 여기는 충돌 전 하늘빛만.',
      '      float gSkyUncol = 1.0;',
      '      {',
      COLUMN_GLSL,
      `        gSkyUncol = exp(-${SKY_SECANT.toFixed(1)} * ${(1 - DIFFUSE_G).toFixed(4)} * dot(gTauA, media.weight));`,
      '      }',
    ].join('\n'));
    src = src.replace(IS_CLOUDS, `radiance += skyIrradiance * mix(RECIPROCAL_PI4, ${(0.5 * INV_2PI).toFixed(6)} * gSkyUncol, dot(genusOn, media.weight)) * skyGradient * skyLightScale;   // §138 L2`);
  }
  return src;
}
export function setGenusDiffuse(mat: PatchableMaterial, mode: 0 | 1 | 2 | 3 | 9): void {
  variantOf(mat).diffuse = mode;
  refreshVariant(mat);
}

/** §136 층의 렌더 봉투 손잡이(patchGenusShader 단면) — cloudPhysics.layerPhysics 가 렌더 기둥 광학두께(tauRendered)를 셀 때 씁니다. */
export function genusEnvelope(L: GenusLayer): { mode: number; base: number; top: number; edge: number } {
  return { mode: param(L, 'mode'), base: param(L, 'base'), top: param(L, 'top'), edge: param(L, 'edge') };
}

/** 종류별 층 기본값(두께·밀도·모양 양) — CloudLayer 생성에 씁니다. */
export function genusLayerShape(L: GenusLayer, flowDensity = false) {
  // §130 C2 흐름 밀도가 켜진 층은 소광·모양 잡음 양을 흐름값(GENUS_FLOW 의 flowDensityScale 등)으로 — 꺼진 층은 GENUS 그대로.
  const fd = flowDensity && (fp(L, 'flow') ?? 0) > 0;
  return {
    height: param(L, 'height'),
    densityScale: (fd ? fp(L, 'flowDensityScale') : undefined) ?? param(L, 'densityScale'),
    shapeAmount: (fd ? fp(L, 'flowShapeAmount') : undefined) ?? param(L, 'shapeAmount'),
    shapeDetailAmount: (fd ? fp(L, 'flowShapeDetailAmount') : undefined) ?? param(L, 'shapeDetailAmount'),
  };
}
