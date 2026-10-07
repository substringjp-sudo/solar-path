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

/**
 * 종류 기호(§126): cu 적운 · cg 웅대적운 · cb 적란운 탑 · cbanvil 적란운 모루(별도 층) · sc 층적운 · st 층운 ·
 * ns 난층운 · ac 고적운 · as 고층운 · ci 권운 · cs 권층운.
 */
export type GenusKey = 'cu' | 'cg' | 'cb' | 'cbanvil' | 'sc' | 'st' | 'ns' | 'ac' | 'as' | 'ci' | 'cs';

export interface GenusParams {
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
  cu: { mode: 0, height: 1500, base: 0.03, top: 1.0, edge: 1, ao: 0, domePow: 1, densityScale: 0.2, shapeAmount: 1, shapeDetailAmount: 0.3, radius: 0.55, turrets: 5 },
  ac: { mode: 1, height: 400, base: 0, top: 1.0, edge: 5, ao: 0, domePow: 1, densityScale: 0.2, shapeAmount: 0.5, shapeDetailAmount: 0.7 },
  ci: { mode: 0, height: 800, base: 0.4, top: 0.5, edge: 1.5, ao: 0, domePow: 1.5, densityScale: 0.003, shapeAmount: 0.15, shapeDetailAmount: 0 },
  sc: { mode: 0, height: 600, base: 0.06, top: 0.35, edge: 2, ao: 5, domePow: 1, densityScale: 0.2, shapeAmount: 1, shapeDetailAmount: 0.6, warp: 0.8, lumps: 0.6, gap: 0.35 },
  // 층운: 판 종류는 렌즈 단면(top 4 → 층 대부분에서 hs≈1)이라 d>0 인 곳이 전부 구름이고 d 는 두께만 바꿉니다.
  // (첫 판은 돔 단면 top 0.15 라 d<0.16 인 곳이 비어 판이 덩어리로 깨졌습니다.)
  st: { mode: 1, height: 400, base: 0, top: 4, edge: 2, ao: 0, domePow: 1, densityScale: 0.2, shapeAmount: 0.1, shapeDetailAmount: 0, topQuantile: 0.5 },
  // ── §126 D3: 아래는 아직 사진 자로 재지 않은 값입니다(물리 선험). ──
  // 웅대적운: 적운보다 큰 세포(4km)·봉우리 많음·덜 둥근 꼭대기·두꺼움.
  cg: { mode: 0, height: 4000, base: 0.03, top: 1.3, edge: 1, ao: 2, domePow: 1, densityScale: 0.22, shapeAmount: 1, shapeDetailAmount: 0.3, spacingKm: 4, radius: 0.6, turrets: 7, sizeSkew: 1.0, topQuantile: 1 },
  // 적란운 탑: 드문 큰 세포(15km 간격, 반지름 ≈ 5km), 층 두께는 입력(밑면~권계면)으로 줍니다.
  cb: { mode: 0, height: 8000, base: 0.02, top: 1.6, edge: 1.5, ao: 3, domePow: 1, densityScale: 0.25, shapeAmount: 1, shapeDetailAmount: 0.3, spacingKm: 15, radius: 0.35, turrets: 4, sizeSkew: 0.7, warp: 0.2, topQuantile: 1 },
  // 적란운 모루: 탑과 같은 세포 위에 3배 반지름의 렌즈, 바람 방향으로 늘임. 운량 문턱 없이 장 값 그대로.
  cbanvil: { mode: 1, height: 1500, base: 0, top: 1.0, edge: 3, ao: 0, domePow: 1, densityScale: 0.06, shapeAmount: 0.3, shapeDetailAmount: 0, spacingKm: 15, radius: 0.35, sizeSkew: 0.7, warp: 0.2, absolute: true, anvilScale: 3, stretch: 1.2 },
  // 난층운: 두꺼운(3km) 균일 층, 밑이 어둡고(ao) 아래쪽이 너덜함.
  ns: { mode: 1, height: 3000, base: 0, top: 4, edge: 3, ao: 2.5, domePow: 1, densityScale: 0.3, shapeAmount: 0.4, shapeDetailAmount: 0.15, topQuantile: 0.7 },
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
  const t = GENUS_COVER_REMAP[genus];
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
type Field = (S: number, tileKm: number, seed: number, L: GenusLayer) => FieldPx;
const FIELDS: Record<GenusKey, Field> = {
  cu(S, tileKm, seed, L) {
    const n = Math.max(2, Math.round(tileKm / (param(L, 'spacingKm') ?? 2.4)));
    const C = cells(n, seed), env = fbm(2, 3, seed + 7), warp = fbm(Math.max(4, n), 3, seed + 13), warp2 = fbm(Math.max(4, n), 3, seed + 17);
    const wa = (param(L, 'warp') ?? 0.35) / n, rmax = (param(L, 'radius') ?? 0.55) / n, T = param(L, 'turrets') ?? 0, skew = param(L, 'sizeSkew') ?? 1.5;
    // §130.0 세포 크기 s = p.s^skew·(0.4 + 1.2·env(p)) 는 세포마다 상수 — 화소마다 이웃 25개의 env 를 다시 부르던 것을 세포당 한 번으로.
    // 같은 수(바이트 동일, 9 운량 × 2 씨앗 diff 0), 적운 512² 1.4 s → 0.4 s(node).
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
        if (!T) { const q = 1 - (dx * dx + dy * dy) / (R * R); if (q > 0) best = Math.max(best, s * q); continue; }
        // 봉우리 여럿: 한 구름 = 높이가 다른 반구 몇 개의 합집합(꽃양배추 꼭대기).
        if (dx * dx + dy * dy > R * R * 1.6) continue;
        const r2 = rng(Math.floor(p.s * 1e9) ^ seed);
        for (let t = 0; t < T; t++) {
          const a = r2() * 6.2832, off = (t === 0 ? 0 : 0.25 + 0.3 * r2()) * R, Rb = R * (t === 0 ? 0.75 : 0.35 + 0.3 * r2());
          const hb = s * (t === 0 ? 0.75 : 0.55 + 0.45 * r2());
          const ex = dx - Math.cos(a) * off, ey = dy - Math.sin(a) * off, q = 1 - (ex * ex + ey * ey) / (Rb * Rb);
          if (q > 0) best = Math.max(best, hb * Math.sqrt(q));
        }
      }
      return best;
    };
  },
  ac(S, tileKm, seed, L) {
    const n = Math.max(4, Math.round(tileKm / (param(L, 'spacingKm') ?? 0.35)));
    const C = cells(n, seed, 0.7), env = fbm(3, 4, seed + 5), rows = param(L, 'rows') ?? 0.35;
    const ang = ((param(L, 'windDeg') ?? 30) * Math.PI) / 180, ca = Math.cos(ang), sa = Math.sin(ang);
    const R = (param(L, 'radius') ?? 0.62) / n, k = Math.round(n / 3);
    return (x, y) => {
      const u = (x + 0.5) / S, v = (y + 0.5) / S, ci = Math.floor(u * n), cj = Math.floor(v * n);
      let best = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const p = C.at(ci + di, cj + dj), dx = wrapD(u, p.x), dy = wrapD(v, p.y);
        const q = 1 - (dx * dx + dy * dy) / (R * R * (0.6 + 0.4 * p.s));
        if (q > 0) best = Math.max(best, (0.6 + 0.4 * p.t) * Math.sqrt(q));
      }
      const wave = 1 - rows + rows * (0.5 + 0.5 * Math.cos(2 * Math.PI * k * (u * ca + v * sa)));
      return best * wave * Math.min(1, Math.max(0, (env(u, v) - 0.35) * 4));
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
  sc(S, tileKm, seed, L) {
    const n = Math.max(2, Math.round(tileKm / (param(L, 'spacingKm') ?? 1.8)));
    const C = cells(n, seed, 0.8), warp = fbm(Math.max(4, n * 2), 3, seed + 21), warp2 = fbm(Math.max(4, n * 2), 3, seed + 23);
    const wa = (param(L, 'warp') ?? 0.3) / n, lumps = param(L, 'lumps') ?? 0, gap = param(L, 'gap') ?? 0.5;
    const lumpN = fbm(Math.max(8, n * 4), 3, seed + 29);
    const cl = param(L, 'cluster') ?? 0;
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
      const gapM = Math.min(1, (d2 - d1) / gap);
      const cellF = (0.55 + 0.45 * s1) * gapM * (1 - 0.35 * Math.min(1, d1)) * lump;
      if (!clN) return cellF;
      // 덮개가 주도: 무리 안은 칸 경계의 얇은 틈만 남기고 칸을 채웁니다(세포별 크기·가운데 강조를 빼야 칸이 가운데만 남지 않음).
      return (1 - cl) * cellF + cl * gapM * (0.85 + 0.15 * lump) * env;
    };
  },
  st(S, tileKm, seed) {
    const g = fbm(Math.max(4, Math.round(tileKm / 3)), 4, seed);
    return (x, y) => 0.7 + 0.3 * g((x + 0.5) / S, (y + 0.5) / S);
  },
  // 웅대적운·적란운 탑: 적운 세포 무늬를 종류별 기본값(간격·반지름·봉우리 수)으로 다시 씁니다.
  cg(S, tileKm, seed, L) { return FIELDS.cu(S, tileKm, seed, L); },
  cb(S, tileKm, seed, L) { return FIELDS.cu(S, tileKm, seed, L); },
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
  // 난층운: 두꺼운 판 + 아래쪽 너덜함(작은 규모 잡음) — 값이 높게 몰려 운량이 커도 빈 데가 조금 남습니다.
  ns(S, tileKm, seed) {
    const g = fbm(Math.max(3, Math.round(tileKm / 4)), 5, seed);
    return (x, y) => 0.55 + 0.45 * g((x + 0.5) / S, (y + 0.5) / S);
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
): Generator<void, void, void> {
  const ROWS = 8;
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
    const px = FIELDS[L.genus](S, tileKm, L.opts?.seed ?? seed + k * 1000, L);
    const f = new Float32Array(S * S);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) f[y * S + x] = px(x, y);
      if (y % ROWS === ROWS - 1) yield;
    }
    const pw = param(L, 'domePow');
    if (param(L, 'absolute')) {
      // 문턱 없이 장 값 그대로 — 모루처럼 "탑 둘레에만" 있어야 하는 층. cover 는 쓰지 않습니다.
      for (let i = 0; i < S * S; i++) data[i * 4 + k] = Math.round(Math.pow(Math.min(1, Math.max(0, f[i])), pw) * 255);
      continue;
    }
    if (L.cover < 0.999) { growBeyondCapacity(f, S, L.cover); yield; }
    const th = L.cover >= 0.999 ? -1 : quantile(f, 1 - L.cover);
    yield;
    const top = quantile(f, param(L, 'topQuantile') ?? 0.997);
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
  layers: (GenusLayer | null)[], S = 512, tileKm = 24, seed = 7,
  /** 종류 없는 채널에 넣을 기본 잡음 운량(0~1) — takram 기본 모양(순위 문턱 fbm)으로 채웁니다. */
  plainCover: number[] = [],
): DataTexture {
  const data = new Uint8Array(S * S * 4);
  const it = genusWeatherSteps(data, layers, S, tileKm, seed, plainCover);
  while (!it.next().done) { /* 끝까지 */ }
  return weatherTexture(data, S);
}

/**
 * 날씨 텍스처를 잘라 만듭니다(§127, 하늘 화면). sliceMs 마다 다음 틱으로 넘겨 그 사이 그리기·손가락 입력이 돕니다.
 * `cancelled()` 가 참이 되면 중간에 멈추고 null 을 돌려줍니다(더 새 장면이 들어옴).
 */
export async function makeGenusWeatherAsync(
  layers: (GenusLayer | null)[], S = 512, tileKm = 24, seed = 7, plainCover: number[] = [],
  sliceMs = 6, cancelled: () => boolean = () => false,
): Promise<DataTexture | null> {
  const data = new Uint8Array(S * S * 4);
  const it = genusWeatherSteps(data, layers, S, tileKm, seed, plainCover);
  let t0 = Date.now();
  for (;;) {
    if (it.next().done) break;
    if (Date.now() - t0 >= sliceMs) {
      await new Promise<void>(r => setTimeout(r, 0));
      if (cancelled()) return null;
      t0 = Date.now();
    }
  }
  return weatherTexture(data, S);
}

type PatchableMaterial = { fragmentShader: string; uniforms: Record<string, { value: unknown }>; needsUpdate: boolean };
const VEC_UNIFORMS = ['genusOn', 'genusMode', 'genusBase', 'genusTop', 'genusEdge', 'genusAO', 'genusThru'] as const;

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
    src = src.replace(sg, sg + '\n      skyGradient *= dot(mix(vec4(1.0), exp(-genusAO * weather.depth), genusOn), media.weight);');
  }
  // 햇빛 확산 투과(GenusParams.thru): 위쪽 광학두께 ≈ 이 표본의 소광 × 꼭대기까지 거리.
  const amb = 'radiance += skyIrradiance * RECIPROCAL_PI4 * skyGradient * skyLightScale;';
  if (src.includes(amb)) {
    src = src.replace(amb, amb + [
      '',
      '      {',
      '        vec4 gLayerH = max(maxLayerHeights - minLayerHeights, vec4(1.0));',
      '        vec4 gTau = media.extinction * max(vec4(1.0) - weather.heightFraction, vec4(0.0)) * gLayerH;',
      '        vec4 gThru = genusThru * genusOn * (vec4(1.0) - exp(-0.1 * gTau)) * 2.0 / (2.0 + 0.15 * gTau);',
      '        radiance += sunIrradiance * RECIPROCAL_PI4 * dot(gThru, media.weight);',
      '      }',
    ].join('\n'));
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
}

/** 종류별 층 기본값(두께·밀도·모양 양) — CloudLayer 생성에 씁니다. */
export function genusLayerShape(L: GenusLayer) {
  return {
    height: param(L, 'height'),
    densityScale: param(L, 'densityScale'),
    shapeAmount: param(L, 'shapeAmount'),
    shapeDetailAmount: param(L, 'shapeDetailAmount'),
  };
}
