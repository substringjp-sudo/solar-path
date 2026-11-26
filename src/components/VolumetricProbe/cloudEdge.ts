/**
 * 구름 가장자리 기본 거칠기(계획 문서 §26) — 모든 종류 공통.
 *
 * 왜: 날씨 무늬(흐름 · 세포)가 만든 구름 외곽은 수 km 크기의 매끈한 곡선이라, 낮은 품질(takram shapeDetail · turbulence 꺼짐)에서
 * 고적운 세포는 둥근 방울, 층적운은 매끈한 덩어리로 보였습니다. 실제 구름 경계는 수 km 에서 수십 m 까지 이어지는 프랙탈(난류 혼입)입니다.
 *
 * 방법: 구름이 생기는 문턱(날씨 값)을 여러 크기의 주기 fBm 으로 흔듭니다 — lw ← clamp(lw + a·(n − 0.5)), 날씨 값이 0 인 곳(맑은 하늘)은 그대로.
 * 구름 속(lw ≫ 문턱)은 바뀌지 않고 경계만 움직이므로 외곽선이 거칠어집니다. 종류별 손값 없이 한 규칙.
 *
 * 타일: 256² 한 채널, 주기 EDGE_PERIOD_M(2 km). 옥타브 주기 500 · 250 · 125 · 62 · 31 m(텍셀 8 m), 세기 ∝ 파장^0.3 —
 * km 크기 구조는 날씨 무늬가 이미 정하므로 여기서는 고운 쪽을 키움(첫 시도 4 km · 파장^0.7 은 경계를 km 단위로 옮겨 세포 틈이 메워짐).
 * 셰이더는 화소 발자국에 맞춘 mip 으로 읽어 멀리서는 고운 옥타브가 저절로 평균(0.5)이 됩니다.
 *
 * 발자국(2026-11-26 고침): 처음엔 takram 의 mipLevel(지상 카메라에선 거의 0)로 어림해 발자국을 날씨 한 칸(47 m) 정도로 잡았습니다 —
 * 실제 화소(구름 버퍼 0.5 배, 6 km 앞에서 ~40 m, 지평선 쪽 수백 m)보다 훨씬 작아 31 · 62 m 옥타브를 그대로 읽었고,
 * 표본 위치가 프레임마다 흔들리니(STBN) 시간 누적이 평균하지 못하는 알갱이 잡음이 됐습니다(기기 낮 10시 화면).
 * 이제 구름 패스는 행진 고리에서 실제 발자국 = max(거리 × 화소 각 ÷ 시선 기울기, 걸음의 가로 길이)를 넘깁니다(`edgePixelRad`).
 * 잡음은 평균이 0.5 라 흐려져도 구름 면적은 그대로입니다(날씨 자체에 밉을 걸 때 먼 구름이 사라진 §127.8 과 다름).
 * 층마다 바람 표류(genusDriftKm)를 따라 무늬가 구름과 함께 움직입니다.
 */
import { DataTexture, LinearFilter, LinearMipmapLinearFilter, RedFormat, RepeatWrapping, UnsignedByteType } from 'three';
import { mulberry32 as rng } from '../../utils/math';

export const EDGE_TILE_PX = 256;
export const EDGE_PERIOD_M = 2000;
/** 옥타브 격자 수(타일당) — 주기 2 km / n. */
export const EDGE_OCTAVES = [4, 8, 16, 32, 64];
/** 기본 세기(날씨 값 단위). 문턱 경사(edge ≈ 1.2~1.8)에서 경계가 수백 m 흔들림. */
export const EDGE_ROUGH_DEFAULT = 0.5;

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

/** 주기 값 잡음 한 옥타브(격자 n). */
function valueOctave(r: () => number, n: number) {
  const g = new Float32Array(n * n);
  for (let i = 0; i < g.length; i++) g[i] = r();
  return (u: number, v: number) => {
    const x = u * n, y = v * n;
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = fade(x - x0), fy = fade(y - y0);
    const at = (i: number, j: number) => g[(((j % n) + n) % n) * n + (((i % n) + n) % n)];
    const a = at(x0, y0), b = at(x0 + 1, y0), c = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1);
    return (a + (b - a) * fx) + ((c + (d - c) * fx) - (a + (b - a) * fx)) * fy;
  };
}

/** 가장자리 fBm 타일 바이트(R, 주기). 평균 ≈ 0.5, 순수 함수 — 판정이 같은 값을 씁니다. */
export function makeEdgeNoiseData(seed = 11, px = EDGE_TILE_PX): Uint8Array {
  const r = rng(seed * 104729 + 17);
  const oct = EDGE_OCTAVES.map(n => ({ f: valueOctave(r, n), a: Math.pow(EDGE_OCTAVES[0] / n, 0.3) }));
  const aSum = oct.reduce((s, o) => s + o.a, 0);
  const raw = new Float32Array(px * px);
  let mean = 0, sq = 0;
  for (let y = 0; y < px; y++) for (let x = 0; x < px; x++) {
    const u = (x + 0.5) / px, v = (y + 0.5) / px;
    let s = 0;
    for (const o of oct) s += o.a * (o.f(u, v) - 0.5);
    s /= aSum;
    raw[y * px + x] = s; mean += s; sq += s * s;
  }
  mean /= raw.length;
  const sd = Math.sqrt(Math.max(1e-12, sq / raw.length - mean * mean));
  const out = new Uint8Array(px * px);
  // 평균 0.5, 표준편차 0.16 으로 맞춤(±3σ ≈ 0..1).
  for (let i = 0; i < raw.length; i++) out[i] = Math.round(255 * Math.max(0, Math.min(1, 0.5 + 0.16 * (raw[i] - mean) / sd)));
  return out;
}

let tile: DataTexture | null = null;
function edgeTile(): DataTexture {
  if (tile) return tile;
  const t = new DataTexture(makeEdgeNoiseData(), EDGE_TILE_PX, EDGE_TILE_PX, RedFormat, UnsignedByteType);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.magFilter = LinearFilter;
  t.minFilter = LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  tile = t;
  return t;
}

/** CPU 판(판정용): 날씨 값 lw 에 잡음 n(0..1)을 세기 a 로 더함. 맑은 하늘(lw = 0)은 그대로. */
export function edgeModulate(lw: number, n: number, a: number): number {
  if (!(lw > 0)) return lw;
  return Math.max(0, Math.min(1, lw + a * (n - 0.5)));
}

type PatchableMaterial = { fragmentShader: string; uniforms: Record<string, { value: unknown }>; needsUpdate: boolean };
/** 흐름 패치가 만든 문장 — 세포 패치도 이 앞에 끼웁니다. 세포 다음에 걸면 세포 경계까지 거칠어집니다. */
const ANCHOR = '  vec4 gCloudMask = smoothstep(vec4(0.0), vec4(1.5 / 255.0), localWeather);';
const DECL = 'uniform vec4 coverageFilterWidths;';
/** takram 구름 행진 고리의 밉 줄 — 여기 뒤에서 실제 발자국을 잽니다(구름 패스만 있음, 그림자 패스는 예전 어림). */
const MARCH_MIP = '    float mipLevel = log2(max(1.0, rayStartTexelsPerPixel + rayDistance * 1e-5));';

export function patchEdgeShader(mat: PatchableMaterial): void {
  let src = mat.fragmentShader;
  for (const a of [ANCHOR, DECL]) if (!src.includes(a)) throw new Error('cloudEdge: shader anchor missing — ' + a.trim().slice(0, 50));
  const texelM = (EDGE_PERIOD_M / EDGE_TILE_PX).toFixed(4);
  src = src.replace(DECL, DECL + [
    '',
    'uniform sampler2D edgeNoise;',
    'uniform float edgeRough;   // §26 가장자리 거칠기 세기(0 = 끔)',
    'uniform float edgePixelRad; // 구름 버퍼 한 화소의 각(라디안)',
    'float gEdgeFootM = 0.0;     // 지금 표본의 화소 발자국(m) — 행진 고리가 채움, 0 이면 예전 어림',
  ].join('\n'));
  if (src.includes(MARCH_MIP)) {
    src = src.replace(MARCH_MIP, [
      MARCH_MIP,
      '    {',
      '      // 가장자리 잡음의 발자국: 화소 원뿔 폭 ÷ 층에 대한 시선 기울기(스치듯 볼수록 길게), 그리고 이번 걸음의 가로 길이.',
      '      float eSin = max(abs(dot(rayDirection, normalize(position))), 0.05);',
      '      float eStep = mix(stepSize, maxStepSize, min(1.0, mipLevel)) * sqrt(max(0.0, 1.0 - eSin * eSin));',
      '      gEdgeFootM = max((rayNearFar.x + rayDistance) * edgePixelRad / eSin, eStep);',
      '    }',
    ].join('\n'));
  }
  src = src.replace(ANCHOR, [
    '  if (edgeRough > 0.0 && dot(localWeather, vec4(1.0)) > 0.0) {',
    '    // §26 문턱을 fBm 으로 흔듦 — 맑은 하늘(lw = 0)은 그대로, 층마다 바람 표류를 따라감.',
    '    vec2 eP = uv * genusTileM;',
    '    float eFoot = gEdgeFootM > 0.0 ? gEdgeFootM : genusTexelM * exp2(mipLevel);',
    `    float eLod = max(0.0, log2(max(eFoot, 1.0) / ${texelM}));`,
    '    vec4 eN = vec4(0.5);',
    `    if (localWeather.x > 0.0) eN.x = textureLod(edgeNoise, (eP + 1000.0 * vec2(genusDriftKmU.x, genusDriftKmV.x)) / ${EDGE_PERIOD_M.toFixed(1)}, eLod).r;`,
    `    if (localWeather.y > 0.0) eN.y = textureLod(edgeNoise, (eP + 1000.0 * vec2(genusDriftKmU.y, genusDriftKmV.y)) / ${EDGE_PERIOD_M.toFixed(1)} + vec2(0.37, 0.61), eLod).r;`,
    `    if (localWeather.z > 0.0) eN.z = textureLod(edgeNoise, (eP + 1000.0 * vec2(genusDriftKmU.z, genusDriftKmV.z)) / ${EDGE_PERIOD_M.toFixed(1)} + vec2(0.71, 0.13), eLod).r;`,
    `    if (localWeather.w > 0.0) eN.w = textureLod(edgeNoise, (eP + 1000.0 * vec2(genusDriftKmU.w, genusDriftKmV.w)) / ${EDGE_PERIOD_M.toFixed(1)} + vec2(0.19, 0.83), eLod).r;`,
    '    localWeather = mix(localWeather, clamp(localWeather + edgeRough * (eN - vec4(0.5)), 0.0, 1.0), step(vec4(1e-6), localWeather));',
    '  }',
    ANCHOR,
  ].join('\n'));
  mat.fragmentShader = src;
  mat.uniforms.edgeNoise = { value: edgeTile() };
  mat.uniforms.edgeRough = { value: EDGE_ROUGH_DEFAULT };
  mat.uniforms.edgePixelRad = { value: 0.003 };
  mat.needsUpdate = true;
}

/** 구름 버퍼 한 화소의 각(라디안) = 세로 시야 ÷ (화면 높이 × 구름 해상도 배율). */
export function setEdgePixelRad(mat: PatchableMaterial, rad: number): void {
  if (mat.uniforms.edgePixelRad) mat.uniforms.edgePixelRad.value = rad;
}

export function setEdgeRough(mat: PatchableMaterial, a: number): void {
  if (mat.uniforms.edgeRough) mat.uniforms.edgeRough.value = a;
}
