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

export type GenusKey = 'cu' | 'ac' | 'ci' | 'sc' | 'st';

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
  windDeg?: number;
  /** 층적운: 칸 경계 휨(칸 지름 대비) · 칸 안 덩어리 세기 · 틈 폭 */
  lumps?: number;
  gap?: number;
  /** 권운: 띠 길이·폭, 결 길이·폭(km), 결 날카로움, 휨(km) */
  bandLenKm?: number;
  bandWidKm?: number;
  fibLenKm?: number;
  fibWidKm?: number;
  fibPow?: number;
  bendKm?: number;
}

/**
 * 종류별 값 — 웹 하네스에서 판정기(§124.1)로 고른 후보(§124.3). st 는 아직 재지 않았습니다.
 */
export const GENUS: Record<GenusKey, GenusParams> = {
  cu: { mode: 0, height: 1500, base: 0.03, top: 1.0, edge: 1, ao: 0, domePow: 1, densityScale: 0.2, shapeAmount: 1, shapeDetailAmount: 0.3, radius: 0.55, turrets: 5 },
  ac: { mode: 1, height: 400, base: 0, top: 1.0, edge: 5, ao: 0, domePow: 1, densityScale: 0.2, shapeAmount: 0.5, shapeDetailAmount: 0.7 },
  ci: { mode: 0, height: 800, base: 0.4, top: 0.5, edge: 1.5, ao: 0, domePow: 1.5, densityScale: 0.003, shapeAmount: 0.15, shapeDetailAmount: 0 },
  sc: { mode: 0, height: 600, base: 0.06, top: 0.35, edge: 2, ao: 5, domePow: 1, densityScale: 0.2, shapeAmount: 1, shapeDetailAmount: 0.6, warp: 0.8, lumps: 0.6, gap: 0.35 },
  st: { mode: 0, height: 400, base: 0.05, top: 0.15, edge: 6, ao: 0, domePow: 1, densityScale: 0.2, shapeAmount: 0.3, shapeDetailAmount: 0.5 },
};

export interface GenusLayer { genus: GenusKey; cover: number; opts?: Partial<GenusParams> }

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
type Field = (S: number, tileKm: number, seed: number, L: GenusLayer) => Float32Array;
const FIELDS: Record<GenusKey, Field> = {
  cu(S, tileKm, seed, L) {
    const n = Math.max(2, Math.round(tileKm / (param(L, 'spacingKm') ?? 2.4)));
    const C = cells(n, seed), env = fbm(2, 3, seed + 7), warp = fbm(Math.max(4, n), 3, seed + 13), warp2 = fbm(Math.max(4, n), 3, seed + 17);
    const wa = (param(L, 'warp') ?? 0.35) / n, rmax = (param(L, 'radius') ?? 0.55) / n, T = param(L, 'turrets') ?? 0, skew = param(L, 'sizeSkew') ?? 1.5;
    const f = new Float32Array(S * S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      let u = (x + 0.5) / S, v = (y + 0.5) / S;
      u += (warp(u, v) - 0.5) * wa; v += (warp2(u, v) - 0.5) * wa;
      const ci = Math.floor(u * n), cj = Math.floor(v * n);
      let best = 0;
      for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
        const p = C.at(ci + di, cj + dj), s = Math.pow(p.s, skew) * (0.4 + 1.2 * env(p.x, p.y));
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
      f[y * S + x] = best;
    }
    return f;
  },
  ac(S, tileKm, seed, L) {
    const n = Math.max(4, Math.round(tileKm / (param(L, 'spacingKm') ?? 0.35)));
    const C = cells(n, seed, 0.7), env = fbm(3, 4, seed + 5), rows = param(L, 'rows') ?? 0.35;
    const ang = ((param(L, 'windDeg') ?? 30) * Math.PI) / 180, ca = Math.cos(ang), sa = Math.sin(ang);
    const R = (param(L, 'radius') ?? 0.62) / n, k = Math.round(n / 3), f = new Float32Array(S * S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const u = (x + 0.5) / S, v = (y + 0.5) / S, ci = Math.floor(u * n), cj = Math.floor(v * n);
      let best = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const p = C.at(ci + di, cj + dj), dx = wrapD(u, p.x), dy = wrapD(v, p.y);
        const q = 1 - (dx * dx + dy * dy) / (R * R * (0.6 + 0.4 * p.s));
        if (q > 0) best = Math.max(best, (0.6 + 0.4 * p.t) * Math.sqrt(q));
      }
      const wave = 1 - rows + rows * (0.5 + 0.5 * Math.cos(2 * Math.PI * k * (u * ca + v * sa)));
      f[y * S + x] = best * wave * Math.min(1, Math.max(0, (env(u, v) - 0.35) * 4));
    }
    return f;
  },
  // 권운: 바람(텍스처 x = 동쪽) 방향으로 긴 띠 + 띠 속 가늘고 긴 평행 결 + 결을 휘는 저주파 휨.
  // (첫 판 — 덩어리 패치 속 짧은 결 — 은 판정기가 적운으로 봤습니다.)
  ci(S, tileKm, seed, L) {
    const bandL = Math.max(1, Math.round(tileKm / (param(L, 'bandLenKm') ?? 12))), bandW = Math.max(2, Math.round(tileKm / (param(L, 'bandWidKm') ?? 2.5)));
    const fibL = Math.max(2, Math.round(tileKm / (param(L, 'fibLenKm') ?? 4))), fibW = Math.max(8, Math.round(tileKm / (param(L, 'fibWidKm') ?? 0.15)));
    const band = fbm2(bandL, bandW, 3, seed), fib = fbm2(fibL, fibW, 2, seed + 7), bend = fbm(3, 3, seed + 11);
    const bendA = (param(L, 'bendKm') ?? 1.5) / tileKm, fp = param(L, 'fibPow') ?? 4, f = new Float32Array(S * S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const u = (x + 0.5) / S, v = (y + 0.5) / S, vb = v + (bend(u, v) - 0.5) * 2 * bendA;
      const r = 1 - Math.abs(2 * fib(u, vb) - 1), bandMask = Math.min(1, Math.max(0, (band(u, vb) - 0.42) / 0.25));
      f[y * S + x] = bandMask * (0.25 + 0.75 * Math.pow(r, fp));
    }
    return f;
  },
  sc(S, tileKm, seed, L) {
    const n = Math.max(2, Math.round(tileKm / (param(L, 'spacingKm') ?? 1.8)));
    const C = cells(n, seed, 0.8), warp = fbm(Math.max(4, n * 2), 3, seed + 21), warp2 = fbm(Math.max(4, n * 2), 3, seed + 23);
    const wa = (param(L, 'warp') ?? 0.3) / n, lumps = param(L, 'lumps') ?? 0, gap = param(L, 'gap') ?? 0.5;
    const lumpN = fbm(Math.max(8, n * 4), 3, seed + 29), f = new Float32Array(S * S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      let u = (x + 0.5) / S, v = (y + 0.5) / S;
      // 칸 안 잔 덩어리(칸 지름의 1/4 쯤) — 없으면 매끈한 다각형 타일이 됩니다(첫 판).
      const lump = lumps ? 1 - lumps + lumps * Math.min(1, Math.max(0, (lumpN(u, v) - 0.25) * 2)) : 1;
      u += (warp(u, v) - 0.5) * wa; v += (warp2(u, v) - 0.5) * wa;
      const ci = Math.floor(u * n), cj = Math.floor(v * n);
      let d1 = 9, d2 = 9, s1 = 0;
      for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
        const p = C.at(ci + di, cj + dj), dx = wrapD(u, p.x), dy = wrapD(v, p.y), d = Math.sqrt(dx * dx + dy * dy) * n;
        if (d < d1) { d2 = d1; d1 = d; s1 = p.s; } else if (d < d2) d2 = d;
      }
      f[y * S + x] = (0.55 + 0.45 * s1) * Math.min(1, (d2 - d1) / gap) * (1 - 0.35 * Math.min(1, d1)) * lump;
    }
    return f;
  },
  st(S, tileKm, seed) {
    const g = fbm(Math.max(4, Math.round(tileKm / 3)), 4, seed), f = new Float32Array(S * S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) f[y * S + x] = 0.7 + 0.3 * g((x + 0.5) / S, (y + 0.5) / S);
    return f;
  },
};

/**
 * 층별 종류·운량 → 날씨 텍스처(RGBA8, S×S, 채널 r,g,b,a = 층 0..3). 운량 = 아래에서 본 덮인 면적 비율 —
 * d > 0 인 면적이 운량이 되게 문턱을 잡습니다.
 */
export function makeGenusWeather(layers: (GenusLayer | null)[], S = 512, tileKm = 24, seed = 7): DataTexture {
  const data = new Uint8Array(S * S * 4);
  layers.forEach((L, k) => {
    if (!L || !(L.cover > 0) || k > 3) return;
    const f = FIELDS[L.genus](S, tileKm, seed + k * 1000, L);
    const th = L.cover >= 0.999 ? -1 : quantile(f, 1 - L.cover);
    const top = quantile(f, 0.997), pw = param(L, 'domePow');
    for (let i = 0; i < S * S; i++) {
      const d = f[i] > th ? Math.min(1, Math.max(1 / 255, (f[i] - th) / Math.max(1e-6, top - th))) : 0;
      data[i * 4 + k] = Math.round(Math.pow(d, pw) * 255);
    }
  });
  const t = new DataTexture(data, S, S, RGBAFormat, UnsignedByteType);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.minFilter = LinearMipMapLinearFilter; t.magFilter = LinearFilter; t.generateMipmaps = true;
  t.colorSpace = NoColorSpace; t.flipY = false;
  t.needsUpdate = true;
  return t;
}

type PatchableMaterial = { fragmentShader: string; uniforms: Record<string, { value: unknown }>; needsUpdate: boolean };
const VEC_UNIFORMS = ['genusOn', 'genusMode', 'genusBase', 'genusTop', 'genusEdge', 'genusAO'] as const;

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
