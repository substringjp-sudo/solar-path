/**
 * 먼 거리 햇빛 가림 지도(노을 3단계, docs/WAVE_FIELD_DESIGN.md §11) — 기본 켬(2026-11-13: 해 낮은 흐린 날 해 쪽 빛이 새던 것).
 *
 * 그림자 지도·해 쪽 짧은 추적은 시야 근처 구름만 봅니다. 해가 낮으면 햇빛은 구름층 아래를 수십~수백 km 지나오므로,
 * 내 지평선 너머의 구름이 그 빛을 가립니다. 여기서는 예보 고리(층별 운량)로 넓은 범위의 운량 격자를 만들고,
 * 격자의 칸마다 층 높이에서 해 쪽으로 직선 광선을 따라가며(지구 곡률 포함) 다른 층을 지나는 구간의 운량을 쌓아
 * 햇빛이 남는 비율 T 를 구합니다. 앞쪽 near km 은 그림자 지도·해 쪽 추적이 맡으므로 건너뜁니다.
 *   z(s) = h + s·tan(e) + s²/(2R),  τ = Σ κ_b·c_b(x + s·d)·Δs (광선이 층 b 의 높이 안에 있을 때),  T = e^(−τ)
 *   κ_b = f_v/ℓ_b: 층 높이 범위 중 구름이 실제로 차지하는 비율 f_v(~0.3)를 구름 크기 ℓ_b 로 나눈 1 km 당 가림. 저층 0.1, 중층 0.075, 상층(얇음) 0.01.
 *   (1차: f_v 없이 1/ℓ 로 잡았더니 해 쪽이 맑아도 중층 빛이 96 % 막힘.)
 *   광선이 지면(0.2 km) 아래로 내려가면 T = 0(지구 그림자 — 위치별 햇빛 계산과 겹치지만 안전하게 0).
 * 결과는 RGBA(저·중·상층 높이, 지면 위 0.3 km 공기) 반 정밀 텍스처. 셰이더는 표본 위치의 층 비중으로 섞어 해 조도에 곱합니다.
 */
import { DataTexture, DataUtils, HalfFloatType, LinearFilter, RGBAFormat, ClampToEdgeWrapping, Vector4 } from 'three';

export interface FarRingPoint { distance: number; azimuthOffset: number; cover: number }
export interface FarSunInput {
  ring: Partial<Record<'low' | 'mid' | 'high', FarRingPoint[]>>;
  /** 층 밑면·윗면(km, 해발) */
  bands: Record<'low' | 'mid' | 'high', [number, number]>;
  sunAzDeg: number;
  sunAltDeg: number;
  /** 관측점 운량(고리가 비었을 때) 0~1 */
  obsCover?: Partial<Record<'low' | 'mid' | 'high', number>>;
}
export interface FarCoverGrids {
  grids: Record<'low' | 'mid' | 'high', Float32Array>;
  gn: number;
  gHalf: number;
  gCell: number;
}

export interface FarSunMap { tex: DataTexture; extentKm: number; ms: number; meanT: [number, number, number, number]; /** 관측점(지도 가운데) 칸의 T */ centerT: [number, number, number, number] }

const R = 6371;
const KAPPA = { low: 0.1, mid: 0.075, high: 0.01 } as const;
const BANDS = ['low', 'mid', 'high'] as const;

/** 태양 각도와 무관한 3층 운량 격자 — 고리 예보가 같으면 재사용해 노을 중 0.1° 재계산 비용을 줄입니다. */
export function buildFarCoverGrids(
  ring: FarSunInput['ring'],
  obsCover?: FarSunInput['obsCover'],
  extentKm = 300,
  maxKm = 420,
  gn = 96,
): FarCoverGrids {
  const gHalf = extentKm / 2 + maxKm;
  const gCell = (2 * gHalf) / gn;
  const grids = {} as Record<'low' | 'mid' | 'high', Float32Array>;
  for (const b of BANDS) {
    const pts = (ring[b] ?? []).map(p => {
      const a = (p.azimuthOffset * Math.PI) / 180;
      return { x: p.distance * Math.sin(a), y: p.distance * Math.cos(a), c: Math.min(1, Math.max(0, p.cover)) };
    });
    const g = new Float32Array(gn * gn);
    const fallback = obsCover?.[b] ?? 0;
    if (pts.length === 0) {
      g.fill(fallback);
    } else {
      for (let j = 0; j < gn; j++) {
        const y = -gHalf + (j + 0.5) * gCell;
        for (let i = 0; i < gn; i++) {
          const x = -gHalf + (i + 0.5) * gCell;
          let sw = 0, sc = 0;
          for (let pi = 0; pi < pts.length; pi++) {
            const p = pts[pi];
            const ddx = p.x - x, ddy = p.y - y;
            const w = 1 / (ddx * ddx + ddy * ddy + 400);
            sw += w; sc += w * p.c;
          }
          g[j * gn + i] = sc / sw;
        }
      }
    }
    grids[b] = g;
  }
  return { grids, gn, gHalf, gCell };
}

export function buildFarSunMap(
  inp: FarSunInput,
  n = 64,
  extentKm = 300,
  nearKm = 12,
  maxKm = 420,
  stepKm = 4,
  prebakedGrids?: FarCoverGrids,
): FarSunMap {
  const t0 = Date.now();
  const half = extentKm / 2;
  const cell = extentKm / n;
  const cg = prebakedGrids ?? buildFarCoverGrids(inp.ring, inp.obsCover, extentKm, maxKm);
  const { grids, gn, gHalf, gCell } = cg;
  const invGCell = 1 / gCell;
  const maxIdx = gn - 1.001;
  const gridLow = grids.low, gridMid = grids.mid, gridHigh = grids.high;

  const sampleGrid = (g: Float32Array, x: number, y: number) => {
    let fx = (x + gHalf) * invGCell - 0.5;
    let fy = (y + gHalf) * invGCell - 0.5;
    fx = fx < 0 ? 0 : fx > maxIdx ? maxIdx : fx;
    fy = fy < 0 ? 0 : fy > maxIdx ? maxIdx : fy;
    const i = fx | 0, j = fy | 0;
    const u = fx - i, v = fy - j;
    const row0 = j * gn + i;
    const row1 = row0 + gn;
    return (g[row0] * (1 - u) + g[row0 + 1] * u) * (1 - v) + (g[row1] * (1 - u) + g[row1 + 1] * u) * v;
  };

  // z(s) 는 (i, j)와 무관하므로 4개 높이 채널의 활성 광선 스텝표를 미리 만들어 빈 높이·거리 루프를 건너뜁니다.
  const az = (inp.sunAzDeg * Math.PI) / 180, dx = Math.sin(az), dy = Math.cos(az), te = Math.tan((inp.sunAltDeg * Math.PI) / 180);
  const hs = [
    (inp.bands.low[0] + inp.bands.low[1]) / 2, (inp.bands.mid[0] + inp.bands.mid[1]) / 2, (inp.bands.high[0] + inp.bands.high[1]) / 2, 0.3,
  ];
  const [loL, hiL] = inp.bands.low;
  const [loM, hiM] = inp.bands.mid;
  const [loH, hiH] = inp.bands.high;
  const kL = KAPPA.low * stepKm, kM = KAPPA.mid * stepKm, kH = KAPPA.high * stepKm;

  type RayStep = { sx: number; sy: number; wL: number; wM: number; wH: number };
  const schedules: { steps: RayStep[]; blocked: boolean }[] = [0, 1, 2, 3].map(k => {
    const steps: RayStep[] = [];
    let blocked = false;
    for (let s = nearKm; s <= maxKm; s += stepKm) {
      const z = hs[k] + s * te + (s * s) / (2 * R);
      if (z < 0.2) { blocked = true; break; }
      if (z > 12) break;
      const wL = z >= loL && z <= hiL ? kL : 0;
      const wM = z >= loM && z <= hiM ? kM : 0;
      const wH = z >= loH && z <= hiH ? kH : 0;
      if (wL > 0 || wM > 0 || wH > 0) {
        steps.push({ sx: s * dx, sy: s * dy, wL, wM, wH });
      }
    }
    return { steps, blocked };
  });

  const data = new Uint16Array(n * n * 4);
  const sum = [0, 0, 0, 0];
  const centerT: [number, number, number, number] = [1, 1, 1, 1];
  const ci = Math.floor(n / 2);
  for (let j = 0; j < n; j++) {
    const y0 = -half + (j + 0.5) * cell;
    for (let i = 0; i < n; i++) {
      const x0 = -half + (i + 0.5) * cell;
      const baseIdx = (j * n + i) * 4;
      for (let k = 0; k < 4; k++) {
        const sch = schedules[k];
        let T: number;
        if (sch.blocked && sch.steps.length === 0) {
          T = 0;
        } else {
          let tau = 0;
          const steps = sch.steps;
          for (let si = 0; si < steps.length && tau < 12; si++) {
            const st = steps[si];
            const x = x0 + st.sx, y = y0 + st.sy;
            if (st.wL > 0) tau += st.wL * sampleGrid(gridLow, x, y);
            if (st.wM > 0) tau += st.wM * sampleGrid(gridMid, x, y);
            if (st.wH > 0) tau += st.wH * sampleGrid(gridHigh, x, y);
          }
          T = sch.blocked && tau < 12 ? 0 : Math.exp(-tau);
        }
        data[baseIdx + k] = DataUtils.toHalfFloat(T);
        sum[k] += T;
        if (i === ci && j === ci) centerT[k] = T;
      }
    }
  }
  const tex = new DataTexture(data, n, n, RGBAFormat, HalfFloatType);
  tex.minFilter = LinearFilter; tex.magFilter = LinearFilter; tex.wrapS = ClampToEdgeWrapping; tex.wrapT = ClampToEdgeWrapping;
  tex.needsUpdate = true;
  const m = n * n;
  return { tex, extentKm, ms: Date.now() - t0, meanT: [sum[0] / m, sum[1] / m, sum[2] / m, sum[3] / m], centerT };
}

type PatchableMaterial = { fragmentShader: string; uniforms: Record<string, { value: unknown }>; needsUpdate: boolean };
const SUN_ANCHOR = '      vec3 sunIrradiance = getCloudsSunSkyIrradiance(position, height, skyIrradiance);';

/** 구름 패스에만. farOn 0 이면 원래 경로. 종류 패치(genusOrigin) 뒤에 부릅니다. */
export function patchFarSunShader(mat: PatchableMaterial): void {
  let src = mat.fragmentShader;
  if (!src.includes(SUN_ANCHOR)) throw new Error('farSun: shader anchor missing');
  src = src.replace('vec4 getLayerDensity', [
    'uniform float farOn;', 'uniform sampler2D farTex;', 'uniform float farExtentM;', 'uniform vec4 farLaneCh;',
    '// 먼 거리 햇빛 가림: 표본의 레인 비중으로 채널(저 0·중 1·상 2)을 섞음',
    'float farSunT(vec3 position, vec4 weight) {',
    '  vec3 d = position - genusOrigin;',
    '  vec4 t = texture(farTex, vec2(dot(d, genusEast), dot(d, genusNorth)) / farExtentM + 0.5);',
    '  vec4 lane = vec4(t[int(farLaneCh.x)], t[int(farLaneCh.y)], t[int(farLaneCh.z)], t[int(farLaneCh.w)]);',
    '  return dot(lane, weight);',
    '}',
    '',
  ].join('\n') + 'vec4 getLayerDensity');
  src = src.replace(SUN_ANCHOR, SUN_ANCHOR + '\n      if (farOn > 0.5) sunIrradiance *= farSunT(position, media.weight);');
  mat.fragmentShader = src;
  mat.uniforms.farOn = { value: 0 };
  mat.uniforms.farTex = { value: null };
  mat.uniforms.farExtentM = { value: 300000 };
  mat.uniforms.farLaneCh = { value: new Vector4(0, 1, 2, 2) };
  mat.needsUpdate = true;
}

/** laneCh: 레인마다 채널(저 0·중 1·상 2). map null 이면 끔. */
export function setFarSunUniforms(mat: PatchableMaterial, map: FarSunMap | null, laneCh: [number, number, number, number]): void {
  const u = mat.uniforms;
  u.farOn.value = map ? 1 : 0;
  u.farTex.value = map ? map.tex : null;
  if (map) u.farExtentM.value = map.extentKm * 1000;
  (u.farLaneCh.value as Vector4).set(...laneCh);
}
