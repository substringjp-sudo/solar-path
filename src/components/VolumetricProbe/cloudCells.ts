/**
 * 고적운(ac)·층적운(sc) 세포 무늬 — 큰 구조(흐름 무늬)가 정한 구역 안에서 구름을 세포 단위로 끊습니다(계획 문서 §24.11).
 *
 * 왜 셰이더에서인가: 날씨 지도(24 km 를 256 칸, 칸 94 m)에 세포를 구우면 머리 위 구름에서 칸이 계단으로 보입니다.
 * 그래서 세포 8 × 8 개짜리 주기 타일(256², 세포 하나 32 칸)을 한 번 만들어 두고, 셰이더가 결 잡음처럼 반복해서 읽습니다.
 *
 * 타일 채널(모두 세포 파장 λ 단위):
 *   R 경계까지 거리(F2 − F1)/0.6 · G 세포 중심까지 거리 F1/0.8 · B 찢김 잡음(0.5 둘레) · A 비움.
 * 세포 자리는 주기 잡음으로 미리 비틀어 격자가 보이지 않게 했고, 셰이더는 바람 방향으로 1.5 배 늘립니다.
 *
 * 셰이더 식(레인 k, 세기 a_k):
 *   inner = clamp((경계 거리 + 찢김 − border) / soft), dome = √(1 − F1/0.9)
 *   가까이: c = min(1, lw·gain)·inner·(0.55 + 0.45·dome)
 *   멀리(화소 발자국이 λ 를 넘음): c = min(1, lw·gain)·farMean(세포 평균) — 풀리지 않는 세포는 평균으로
 *   lw ← mix(lw, c, a_k)
 * inner = 0 인 곳은 lw = 0(구름 없음)이라 세포 사이에 파란 틈이 생깁니다. a = 0 이면 lw 그대로.
 * 세기는 운량 0.7 → 0.95 에서 0 으로 줄어 흐린 날과 판 구름(ns·st·as)은 손대지 않습니다.
 */
import { DataTexture, LinearFilter, LinearMipmapLinearFilter, RGBAFormat, RepeatWrapping, UnsignedByteType, Vector4 } from 'three';
import type { GenusLayer } from './cloudGenus';
import { mulberry32 as rng } from '../../utils/math';
import { makeEdgeNoiseData } from './cloudEdge';

export const CELL_TILE_N = 8;
export const CELL_TILE_PX = 256;
/** 층 두께 → 세포 파장(km). 세포 대류의 가로세로비 ≈ 2.75. */
export const CELL_ASPECT = 2.75;
export const CELL_PARAMS = { gain: 1.8, border: 0.2, soft: 0.12, rag: 0.22, elong: 1.5, farMean: 0.42 };
const CELL_GENERA: Record<string, number> = { ac: 1, sc: 1 };

/** 운량에 따른 세기: 0.7 까지 1, 0.95 에서 0. */
export function cellAmpForCover(cover: number): number {
  return Math.max(0, Math.min(1, (0.95 - cover) / 0.25));
}

function periodicNoise(r: () => number, terms: number, fMin: number, fMax: number) {
  const ws: [number, number, number, number][] = [];
  for (let i = 0; i < terms; i++) {
    const fx = Math.round(fMin + (fMax - fMin) * r()) * (r() < 0.5 ? -1 : 1);
    const fy = Math.round(fMin + (fMax - fMin) * r()) * (r() < 0.5 ? -1 : 1);
    ws.push([fx, fy, 2 * Math.PI * r(), 1 / Math.sqrt(fx * fx + fy * fy + 1)]);
  }
  const norm = ws.reduce((s, w) => s + w[3] * w[3], 0);
  const k = 1 / Math.sqrt(norm / 2);
  return (x: number, y: number) => ws.reduce((s, [fx, fy, ph, a]) => s + a * Math.sin(2 * Math.PI * (fx * x + fy * y) + ph), 0) * k;
}

/** 세포 타일 바이트(RGBA, 주기). 순수 함수 — 판정이 같은 값을 씁니다. */
export function makeCellTileData(seed = 5, px = CELL_TILE_PX, n = CELL_TILE_N): Uint8Array {
  const r = rng(seed * 7919 + 3);
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) pts.push([(i + 0.15 + 0.7 * r()) / n, (j + 0.15 + 0.7 * r()) / n]);
  const wx = periodicNoise(r, 6, 1, 3), wy = periodicNoise(r, 6, 1, 3);
  const ragN = periodicNoise(r, 24, n * 3, n * 7);
  const out = new Uint8Array(px * px * 4);
  const warp = 0.35 / n;
  for (let y = 0; y < px; y++) for (let x = 0; x < px; x++) {
    const u0 = (x + 0.5) / px, v0 = (y + 0.5) / px;
    const u = u0 + warp * wx(u0, v0), v = v0 + warp * wy(u0, v0);
    let f1 = 1e9, f2 = 1e9;
    for (const [pxu, pyv] of pts) {
      let dx = u - pxu, dy = v - pyv;
      dx -= Math.round(dx); dy -= Math.round(dy);
      const d = Math.hypot(dx, dy) * n;
      if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
    }
    const o = (y * px + x) * 4;
    out[o] = Math.round(255 * Math.min(1, (f2 - f1) / 0.6));
    out[o + 1] = Math.round(255 * Math.min(1, f1 / 0.8));
    out[o + 2] = Math.round(255 * Math.max(0, Math.min(1, 0.5 + 0.25 * ragN(u0, v0))));
    out[o + 3] = 255;
  }
  return out;
}

/** 셰이더 식의 CPU 판(판정용). tile 은 타일의 한 칸 값(R·G·B 0..1). */
export function cellModulate(lw: number, t: [number, number, number], amp: number, far = 0): number {
  if (amp <= 0) return lw;
  const P = CELL_PARAMS;
  const gap = t[0] * 0.6, f1 = t[1] * 0.8, rag = (t[2] - 0.5) * 2 * P.rag;
  const inner = Math.max(0, Math.min(1, (gap + rag - P.border) / P.soft));
  const dome = Math.sqrt(Math.max(0, Math.min(1, 1 - f1 / 0.9)));
  const g = Math.min(1, lw * P.gain);
  const c = g * ((1 - far) * inner * (0.55 + 0.45 * dome) + far * P.farMean);
  return lw + (c - lw) * amp;
}

let tileTex: DataTexture | null = null;
/**
 * 세포 무늬(RGB)와 가장자리 거칠기 잡음(A)을 **한 장**에 — 구름 패스의 텍스처 단위(MAX_TEXTURE_IMAGE_UNITS 16)를 아끼려고(기기 18/16 초과로 그늘이 사라지고
 * M 품질이 깨진 문제, 2026-11-26). 둘 다 256² · 반복 · 밉맵이라 읽는 값은 따로 둘 때와 같습니다. 가장자리 쪽은 `cloudEdge.ts` 가 `.a` 로 읽습니다.
 */
export function noiseTile(edgeA: Uint8Array = makeEdgeNoiseData()): DataTexture {
  if (tileTex) return tileTex;
  if (edgeA.length !== CELL_TILE_PX * CELL_TILE_PX) throw new Error('cloudCells: edge noise tile size mismatch');
  const data = makeCellTileData();
  for (let i = 0; i < edgeA.length; i++) data[i * 4 + 3] = edgeA[i];
  const t = new DataTexture(data, CELL_TILE_PX, CELL_TILE_PX, RGBAFormat, UnsignedByteType);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.magFilter = LinearFilter;
  t.minFilter = LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  tileTex = t;
  return t;
}
const cellTile = () => noiseTile();

type PatchableMaterial = { fragmentShader: string; uniforms: Record<string, { value: unknown }>; needsUpdate: boolean };
/** patchFlowShader 가 만든 문장 — 흐름 층의 바닥 올리기 바로 앞(여기서 0 이 된 곳은 구름이 아님). */
const ANCHOR = '  vec4 gCloudMask = smoothstep(vec4(0.0), vec4(1.5 / 255.0), localWeather);';
const DECL = 'uniform vec4 coverageFilterWidths;';

export function patchCellShader(mat: PatchableMaterial): void {
  let src = mat.fragmentShader;
  for (const a of [ANCHOR, DECL]) if (!src.includes(a)) throw new Error('cloudCells: shader anchor missing — ' + a.trim().slice(0, 50));
  const P = CELL_PARAMS;
  const f = (x: number) => x.toFixed(4);
  src = src.replace(DECL, DECL + [
    '',
    'uniform sampler2D noiseTile;   // RGB 세포 · A 가장자리 잡음(cloudEdge)',
    'uniform vec4 cellAmp;     // 레인별 세기(0 = 끔)',
    'uniform vec4 cellLamKm;   // 레인별 세포 파장(km)',
    'uniform vec4 cellDir;     // 레인별 바람 방향(rad, 북 0 시계)',
    'float cellLane(const vec2 pKm, const float lam, const float dir, const float lw, const float footM) {',
    '  vec2 w = vec2(sin(dir), cos(dir));',
    '  vec2 n = vec2(-w.y, w.x);',
    `  vec2 q = vec2(dot(pKm, w) / ${f(P.elong)}, dot(pKm, n)) / (${CELL_TILE_N}.0 * lam);`,
    `  float texelM = ${CELL_TILE_N}.0 * lam * 1000.0 / ${CELL_TILE_PX}.0;`,
    '  float lod = max(0.0, log2(max(footM, 1.0) / texelM) - 1.0);',
    '  vec3 t = textureLod(noiseTile, q, lod).rgb;',
    `  float inner = clamp((t.r * 0.6 + (t.b - 0.5) * ${f(2 * P.rag)} - ${f(P.border)}) / ${f(P.soft)}, 0.0, 1.0);`,
    '  float dome = sqrt(clamp(1.0 - t.g * 0.8 / 0.9, 0.0, 1.0));',
    '  float far = smoothstep(0.35 * lam * 1000.0, 1.2 * lam * 1000.0, footM);',
    `  float g = min(1.0, lw * ${f(P.gain)});`,
    `  return g * mix(inner * (0.55 + 0.45 * dome), ${f(P.farMean)}, far);`,
    '}',
  ].join('\n'));
  src = src.replace(ANCHOR, [
    '  if (dot(cellAmp, vec4(1.0)) > 0.0) {',
    '    vec2 cPk = uv * (genusTileM * 0.001);',
    '    float cFoot = genusTexelM * exp2(mipLevel);',
    '    vec4 cV = localWeather;',
    '    if (cellAmp.x > 0.0) cV.x = cellLane(cPk + vec2(genusDriftKmU.x, genusDriftKmV.x), cellLamKm.x, cellDir.x, localWeather.x, cFoot);',
    '    if (cellAmp.y > 0.0) cV.y = cellLane(cPk + vec2(genusDriftKmU.y, genusDriftKmV.y), cellLamKm.y, cellDir.y, localWeather.y, cFoot);',
    '    if (cellAmp.z > 0.0) cV.z = cellLane(cPk + vec2(genusDriftKmU.z, genusDriftKmV.z), cellLamKm.z, cellDir.z, localWeather.z, cFoot);',
    '    if (cellAmp.w > 0.0) cV.w = cellLane(cPk + vec2(genusDriftKmU.w, genusDriftKmV.w), cellLamKm.w, cellDir.w, localWeather.w, cFoot);',
    '    localWeather = mix(localWeather, cV, cellAmp);',
    '  }',
    ANCHOR,
  ].join('\n'));
  mat.fragmentShader = src;
  mat.uniforms.noiseTile = { value: noiseTile() };
  mat.uniforms.cellAmp = { value: new Vector4() };
  mat.uniforms.cellLamKm = { value: new Vector4(1, 1, 1, 1) };
  mat.uniforms.cellDir = { value: new Vector4() };
  mat.needsUpdate = true;
}

/** 레인별 세포 손잡이. on = false 면 모두 끔. 운량은 예보 운량(역표 전) — 흐린 날 보호용. */
export function cellLanes(layers: (GenusLayer | null)[], covers: number[], thicknessM: number[]): { amp: number[]; lam: number[]; dir: number[] } {
  const amp: number[] = [], lam: number[] = [], dir: number[] = [];
  for (let i = 0; i < 4; i++) {
    const L = layers[i];
    const o = (L?.opts ?? {}) as { windU?: number; windV?: number; cells?: number; cellLamKm?: number };
    const on = L ? (o.cells ?? CELL_GENERA[L.genus] ?? 0) : 0;
    amp.push(on * cellAmpForCover(covers[i] ?? 1));
    lam.push(Math.max(0.3, o.cellLamKm ?? CELL_ASPECT * (thicknessM[i] ?? 500) / 1000));
    dir.push(Math.atan2(o.windU ?? 0, o.windV ?? 1));
  }
  return { amp, lam, dir };
}

export function setCellUniforms(mat: PatchableMaterial, lanes: { amp: number[]; lam: number[]; dir: number[] } | null): void {
  const a = lanes?.amp ?? [0, 0, 0, 0];
  (mat.uniforms.cellAmp.value as Vector4).set(a[0], a[1], a[2], a[3]);
  if (!lanes) return;
  (mat.uniforms.cellLamKm.value as Vector4).set(lanes.lam[0], lanes.lam[1], lanes.lam[2], lanes.lam[3]);
  (mat.uniforms.cellDir.value as Vector4).set(lanes.dir[0], lanes.dir[1], lanes.dir[2], lanes.dir[3]);
}
