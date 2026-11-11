/**
 * 파동 합성 구름 장(설계: docs/WAVE_FIELD_DESIGN.md) — 하네스 시제품, 기본 꺼짐.
 *
 * 층 opts.wave 가 있는 레인(지금은 레인 0 만)의 밀도를 종류 무늬 대신 이 장에서 가져옵니다.
 *  - 큰 파동(크기 단계 0~2)과 비틀림·밑면 굴곡·층 밖 감쇠는 CPU 에서 3차원 텍스처(R16F)로 굽습니다.
 *  - 작은 파동(단계 3~5, 혹)은 셰이더에서 바로 계산합니다(파동 36 개). 텍스처 칸보다 작은 무늬라서입니다.
 *  - 운량 문턱 τ 는 구운 장의 기둥 최댓값 분포에서 운량만큼 남기는 값입니다.
 * waveOn 이 0 이면 셰이더는 원래 경로 그대로입니다(분기 하나).
 */
import { Data3DTexture, DataUtils, HalfFloatType, LinearFilter, MirroredRepeatWrapping, RedFormat, Vector4 } from 'three';

export interface WaveParams {
  /** 경계층 높이(m) — 가장 큰 파장 λ0 = 2.5 z_i */
  ziM: number;
  /** 구름 밑면·두께(m, 레인 최저 높이 기준이 아니라 해발) */
  baseM: number;
  thickM: number;
  /** 운량 0~1 */
  cover: number;
  /** 대류성 0(판)~1(뭉게) */
  chi: number;
  /** 바람 차이 방향(° 북 0 시계) · 크기(1/s) */
  shearDeg?: number;
  shear?: number;
  /** 안정도 N(1/s) · 상승 기류 속도 w*(m/s) */
  N?: number;
  wStar?: number;
  /** 가장자리 선명도 e(포화 초과량 → 밀도 기울기) */
  edge?: number;
  /** 판 구름 밑면 굴곡 σ_b(m) — (1−χ) 를 곱해 씀 */
  sigmaB?: number;
  /** 비틀림 세기(파장 대비) */
  warp?: number;
  /** 단계별 세기 기울기 h(a_j ∝ 2^(−j·h)) */
  spec?: number;
  /** 작은 파동(혹) 세기 배율 */
  bump?: number;
  /** 가장자리 솜털(takram 잔무늬 텍스처) 세기 0~1 — 표면 근처만 깎음 */
  detail?: number;
  /** 뭉게구름 지붕 꼴: 바닥 무늬 세기 a 가 클수록 높이 솟는 둥근 지붕 + 3차원 큰 파동(γ). 기본 χ ≥ 0.5 */
  dome?: boolean;
  /** 지붕 꼴에서 3차원 큰 파동 세기 */
  gamma?: number;
  seed?: number;
  /** 구울 상자: 반 폭(m)·가로 칸·세로 칸 */
  halfM?: number;
  nxy?: number;
  nz?: number;
}

export interface WaveField {
  tex: Data3DTexture;
  tau: number;
  /** 레인 최저·최고 높이(m) — 장면의 층 밑면·두께가 이것과 같아야 합니다 */
  zMin: number;
  zMax: number;
  halfM: number;
  chi: number;
  edge: number;
  /** 작은 파동: k(1/m)·위상, 단계별 진폭 */
  smallK: Vector4[];
  smallAmp: [number, number, number];
  detail: number;
  bakeMs: number;
  stats: { coverMeasured: number; vMin: number; vMax: number };
}

const OCT = 6, PER = 12, NSMALL = 3 * PER;
/** 단계별 세기 a_j ∝ 2^(−j·h), 제곱합 1. h = 1/3 은 난류 속도 비율(첫 시제품: 조각으로 흩어짐), h = 1 은 큰 덩어리가 앞섬. */
const ampOf = (h: number) => { const a = Array.from({ length: OCT }, (_, j) => Math.pow(2, -j * h)); const s = Math.sqrt(a.reduce((p, x) => p + x * x, 0)); return a.map(x => x / s); };

const rng = (seed: number) => () => {
  seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

interface Wave { kx: number; ky: number; kz: number; ph: number; ex: number; ey: number; ez: number }

/** 단계 j 의 파동 12 개 — 방향은 구 위 고르게, 바람 차이 방향으로 늘이고 위아래로 누름. 좌표: x 동, y 북, z 위(m). */
function makeWaves(p: Required<WaveParams>, r: () => number): Wave[][] {
  const lam0 = 2.5 * p.ziM;
  const sd = (p.shearDeg * Math.PI) / 180, sx = Math.sin(sd), sy = Math.cos(sd);   // 바람 차이 단위(동·북)
  const out: Wave[][] = [];
  for (let j = 0; j < OCT; j++) {
    const lam = lam0 * Math.pow(2, -j) * (1 + 0.3 * (r() - 0.5));
    const wj = p.wStar * Math.pow(lam / lam0, 1 / 3);
    const alpha = 1 + Math.min(3, (p.shear * lam) / Math.max(wj, 0.05));
    const beta = Math.min(4, Math.max(1, (p.N * lam) / (2 * Math.PI * Math.max(wj, 0.05))));
    const kmag = (2 * Math.PI) / lam, row: Wave[] = [];
    for (let m = 0; m < PER; m++) {
      const u = 2 * r() - 1, th = 2 * Math.PI * r(), s = Math.sqrt(1 - u * u);
      let dx = s * Math.cos(th), dy = s * Math.sin(th), dz = u;
      // 바람 차이 방향 성분은 줄이고(그 방향으로 길어짐), 수직 성분은 키움(납작해짐)
      const along = dx * sx + dy * sy;
      dx -= along * sx * (1 - 1 / alpha); dy -= along * sy * (1 - 1 / alpha); dz *= beta;
      const kx = kmag * dx, ky = kmag * dy, kz = kmag * dz;
      // 비틀림 방향 ê ⟂ k
      let ex = -ky, ey = kx, ez = 0; const el = Math.hypot(ex, ey) || 1; ex /= el; ey /= el;
      row.push({ kx, ky, kz, ph: 2 * Math.PI * r(), ex, ey, ez });
    }
    out.push(row);
  }
  return out;
}

const DEF: Omit<Required<WaveParams>, 'ziM' | 'baseM' | 'thickM' | 'cover' | 'chi'> = {
  shearDeg: 90, shear: 0.002, N: 0.004, wStar: 1.5, edge: 3, sigmaB: 120, warp: 0.15, spec: 1, bump: 1, detail: 0.55, dome: false, gamma: 0.3, seed: 1, halfM: 15000, nxy: 192, nz: 40,
};

/** 레인 높이 범위(m): 밑면 100 m 아래 ~ 윗면 + 0.3H. 장면 층의 baseKm·thicknessM 을 이것에 맞추세요. */
export function waveLaneRange(p: WaveParams): { zMin: number; zMax: number } {
  return { zMin: p.baseM - 150, zMax: p.baseM + 1.3 * p.thickM };
}

export function bakeWaveField(input: WaveParams): WaveField {
  const t0 = Date.now();
  const p = { ...DEF, dome: input.chi >= 0.5, ...input } as Required<WaveParams>;
  const r = rng(p.seed * 7919 + 13);
  const W = makeWaves(p, r);
  const { zMin, zMax } = waveLaneRange(p);
  const H = p.thickM, zb = p.baseM, zt = p.baseM + H;
  const n = p.nxy, nz = p.nz, half = p.halfM;
  const inv6 = 1 / Math.sqrt(PER / 2);
  const AMP = ampOf(p.spec);
  const bigVar = AMP[0] ** 2 + AMP[1] ** 2 + AMP[2] ** 2, bigNorm = 1 / Math.sqrt(bigVar);
  const kappa = 0.6 * p.chi;
  const eK = Math.exp((kappa * kappa) / 2), sK = Math.sqrt(Math.exp(kappa * kappa) * (Math.exp(kappa * kappa) - 1));
  const skew = (f: number) => (kappa < 1e-3 ? f : (Math.exp(kappa * f) - eK) / sK);
  // 큰 파동 F_big(x,y,z) — 단계 0·1 로 비튼 좌표에서 0~2 단계 합(단위 분산)
  const fbig = (x: number, y: number, z: number) => {
    let wx = 0, wy = 0, wz = 0;
    for (let j = 0; j < 2; j++) {
      const lamj = (2 * Math.PI) / Math.hypot(W[j][0].kx, W[j][0].ky, W[j][0].kz);
      for (const w of W[j]) {
        const s = p.warp * lamj * Math.sin(w.kx * x + w.ky * y + w.kz * z + w.ph * 1.7) / PER * 3;
        wx += s * w.ex; wy += s * w.ey; wz += s * w.ez;
      }
    }
    const X = x + wx, Y = y + wy, Z = z + wz;
    let f = 0;
    for (let j = 0; j < 3; j++) { let fj = 0; for (const w of W[j]) fj += Math.cos(w.kx * X + w.ky * Y + w.kz * Z + w.ph); f += AMP[j] * fj * inv6; }
    return f * bigNorm;
  };
  const vox = new Float32Array(n * n * nz);
  const colMax = new Float32Array(n * n);
  const c = Math.min(0.999, Math.max(0.001, p.cover));
  if (p.dome) {
    // 지붕 꼴(2차 시제품 판정: 3차원 경계면만으로는 평평한 밑면·솟는 지붕이 안 나오고 기울어진 타원 덩어리가 됨).
    // a = 바닥 무늬 − 문턱. 높이 z 에서는 a > a_max·((z−z_b)/H)² 인 곳만 구름 → 위로 갈수록 안쪽 등고선, 둥근 지붕.
    const G2 = new Float32Array(n * n);
    for (let iy = 0; iy < n; iy++) for (let ix = 0; ix < n; ix++) {
      const x = -half + ((ix + 0.5) / n) * 2 * half, y = -half + ((iy + 0.5) / n) * 2 * half;
      G2[iy * n + ix] = skew(fbig(x, y, zb));
    }
    const s2 = Float32Array.from(G2).sort();
    const tau2 = s2[Math.min(s2.length - 1, Math.floor((1 - c) * s2.length))];
    const aMax = Math.max(0.2, s2[Math.floor(0.995 * (s2.length - 1))] - tau2);
    let vMin = Infinity, vMax = -Infinity, covered = 0;
    for (let iy = 0; iy < n; iy++) {
      const y = -half + ((iy + 0.5) / n) * 2 * half;
      for (let ix = 0; ix < n; ix++) {
        const x = -half + ((ix + 0.5) / n) * 2 * half;
        const g0 = G2[iy * n + ix], a = g0 - tau2;
        if (a > 0) covered++;
        for (let iz = 0; iz < nz; iz++) {
          const z = zMin + ((iz + 0.5) / nz) * (zMax - zMin);
          const hz = Math.max(0, (z - zb) / H);
          let v = Math.min(a - aMax * hz * hz, (z - zb) / 50);
          // 3차원 큰 파동: 밑면에서 0, 위로 갈수록 탑이 옆으로 휘고 갈라짐. 구름 근처에서만 계산.
          if (v > -1.5 && hz > 0) v += p.gamma * Math.min(1, hz * 2) * (skew(fbig(x, y, z)) - g0);
          vox[(iz * n + iy) * n + ix] = v;
          if (v < vMin) vMin = v; if (v > vMax) vMax = v;
        }
      }
    }
    return finish(vox, 0, covered / (n * n), vMin, vMax);
  }
  const sigB = p.sigmaB * (1 - p.chi);
  let vMin = Infinity, vMax = -Infinity;
  for (let iy = 0; iy < n; iy++) {
    const y = -half + ((iy + 0.5) / n) * 2 * half;
    for (let ix = 0; ix < n; ix++) {
      const x = -half + ((ix + 0.5) / n) * 2 * half;
      const f0 = fbig(x, y, zb), g0 = skew(f0);
      const zbLoc = zb + sigB * f0;                       // 판 구름 밑면 굴곡
      let cm = -Infinity;
      for (let iz = 0; iz < nz; iz++) {
        const z = zMin + ((iz + 0.5) / nz) * (zMax - zMin);
        // 판 구름(χ 작음)은 기둥 하나가 통째로 구름 — 높이에 따른 3차원 섞임을 χ 만큼만(첫 판정: 95 % 덱이 구멍 난 스펀지가 됨)
        const mu = p.chi * Math.min(1, Math.max(0, (z - zbLoc) / H));
        const g = (1 - mu) * g0 + mu * skew(fbig(x, y, z));
        const pen = Math.max(0, (zbLoc - z) / 50) + Math.max(0, (z - zt) / (0.3 * H));
        const v = g - pen;
        vox[(iz * n + iy) * n + ix] = v;
        if (v > cm) cm = v;
        if (v < vMin) vMin = v; if (v > vMax) vMax = v;
      }
      colMax[iy * n + ix] = cm;
    }
  }
  // 운량 문턱: 기둥 최댓값의 위쪽 cover 만큼
  const sorted = Float32Array.from(colMax).sort();
  const tau = sorted[Math.min(sorted.length - 1, Math.floor((1 - c) * sorted.length))];
  let covered = 0; for (let i = 0; i < colMax.length; i++) if (colMax[i] > tau) covered++;
  return finish(vox, tau, covered / colMax.length, vMin, vMax);

  function finish(vox: Float32Array, tau: number, coverMeasured: number, vMin: number, vMax: number): WaveField {
  const half16 = new Uint16Array(vox.length);
  for (let i = 0; i < vox.length; i++) half16[i] = DataUtils.toHalfFloat(Math.max(-60000, Math.min(60000, vox[i])));
  const tex = new Data3DTexture(half16, n, n, nz);
  tex.format = RedFormat; tex.type = HalfFloatType;
  tex.minFilter = LinearFilter; tex.magFilter = LinearFilter;
  tex.wrapS = MirroredRepeatWrapping; tex.wrapT = MirroredRepeatWrapping; tex.wrapR = MirroredRepeatWrapping;
  tex.unpackAlignment = 1; tex.needsUpdate = true;
  const smallK: Vector4[] = [];
  for (let j = 3; j < OCT; j++) for (const w of W[j]) smallK.push(new Vector4(w.kx, w.ky, w.kz, w.ph));
  return {
    tex, tau, zMin, zMax, halfM: half, chi: p.chi, edge: p.edge, detail: p.detail, smallK,
    // 단계 5(~λ0/32)는 행진 보폭보다 짧아 반짝이는 점으로 깨져 뺍니다(2차 판정).
    smallAmp: [AMP[3] * p.bump, AMP[4] * p.bump, 0], bakeMs: Date.now() - t0,
    stats: { coverMeasured, vMin, vMax },
  };
  }
}

type PatchableMaterial = { fragmentShader: string; uniforms: Record<string, { value: unknown }>; needsUpdate: boolean };

const DUMMY = (() => { const t = new Data3DTexture(new Uint16Array([0]), 1, 1, 1); t.format = RedFormat; t.type = HalfFloatType; t.needsUpdate = true; return t; })();

const WEATHER_ANCHOR = '  return weather;\n}\n\nvec4 getLayerDensity';
const MEDIA_ANCHOR = '  // Apply the density profiles.';

/** 두 패스(구름·그림자)에 늘 걸어 둡니다. waveOn 0 이면 원래 경로. 종류 패치(genusOrigin 등) 뒤에 불러야 합니다. */
export function patchWaveShader(mat: PatchableMaterial): void {
  let src = mat.fragmentShader;
  if (!src.includes(WEATHER_ANCHOR) || !src.includes(MEDIA_ANCHOR)) throw new Error('cloudWave: shader anchor missing');
  const decl = [
    'uniform float waveOn;', 'uniform sampler3D waveTex;', 'uniform vec4 waveBox;', 'uniform vec4 waveP;',
    `uniform vec4 waveK[${NSMALL}];`, 'uniform vec3 waveAmp;',
    // 셰이더 안 작은 파동(혹): 단계마다 |합| 을 접어 둥근 혹 사이에 날카로운 골(2|z| − 평균)
    'float waveSmall(vec3 q) {',
    '  float b = 0.0;',
    '  for (int j = 0; j < 3; j++) {',
    '    float f = 0.0;',
    `    for (int m = 0; m < ${PER}; m++) { vec4 k = waveK[j * ${PER} + m]; f += cos(dot(k.xyz, q) + k.w); }`,
    `    b += waveAmp[j] * (2.0 * abs(f) * ${(1 / Math.sqrt(PER / 2)).toFixed(6)} - 1.5958);`,
    '  }',
    '  return b;',
    '}',
    '',
  ].join('\n');
  src = src.replace('vec4 getLayerDensity', decl + 'vec4 getLayerDensity');
  // 빈 칸 건너뛰기를 막으려고 레인 0 의 날씨 밀도를 층 안에서 1 로
  src = src.replace(WEATHER_ANCHOR, '  if (waveOn > 0.5) { float wIn = step(0.0, weather.heightFraction.x) * step(weather.heightFraction.x, 1.0); weather.density.x = wIn; }\n' + WEATHER_ANCHOR);
  src = src.replace(MEDIA_ANCHOR, [
    '  if (waveOn > 0.5) {',
    '    vec3 wd = position - genusOrigin;',
    '    vec2 wxy = vec2(dot(wd, genusEast), dot(wd, genusNorth));',
    '    float whf = clamp(weather.heightFraction.x, 0.0, 1.0);',
    '    float wz = mix(minLayerHeights.x, maxLayerHeights.x, whf);',
    '    vec3 wuv = vec3(wxy / (2.0 * waveBox.x) + 0.5, whf);',
    '    float wv = texture(waveTex, wuv).r;',
    '    float ws = wv - waveP.x;',
    '    // 작은 파동은 표면 근처에서만(속과 먼 바깥은 계산 생략)',
    '    float wfb = clamp((wz - waveBox.y) / max(waveBox.z, 1.0), 0.0, 1.0);',
    '    // 혹은 밑면에서 꺼지고 옆·꼭대기에서 켜짐(평평한 밑면, 꽃양배추 윗면)',
    '    if (ws > -1.2 && ws < 0.6) ws += waveP.y * smoothstep(0.0, 0.3, wfb) * waveSmall(vec3(wxy, wz));',
    '    float wprof = 0.25 + 0.75 * pow(wfb, 0.6667);',
    '    float wc = clamp(waveP.z * ws, 0.0, 1.0);',
    '    // 가장자리 솜털: takram 잔무늬로 얇은 곳만 깎음(속 wc≈1 은 그대로). 위는 몽글, 아래는 가닥(takram 규칙).',
    '#ifdef SHAPE_DETAIL',
    '    if (waveP.w > 0.0 && wc > 0.0 && wc < 1.0) {',
    '      float wdet = texture(shapeDetailTexture, position * shapeDetailRepeat + shapeDetailOffset).r;',
    '      float wmod = waveP.w * mix(pow(wdet, 6.0), 1.0 - wdet, remapClamped(wfb, 0.2, 0.4));',
    '      wc = remapClamped(wc * 2.0, wmod * 0.5, 1.0);',
    '    }',
    '#endif',
    '    float wq = wprof * wc * (1.0 + 0.3 * (1.0 - waveP.y) * tanh(wv));',
    '    density.x = wq / max(getLayerDensity(weather.heightFraction).x, 1e-3);',
    '  }',
    MEDIA_ANCHOR,
  ].join('\n'));
  mat.fragmentShader = src;
  mat.uniforms.waveOn = { value: 0 };
  mat.uniforms.waveTex = { value: DUMMY };
  mat.uniforms.waveBox = { value: new Vector4(15000, 0, 1000, 0) };
  mat.uniforms.waveP = { value: new Vector4(0, 0, 3, 0) };
  mat.uniforms.waveK = { value: Array.from({ length: NSMALL }, () => new Vector4()) };
  mat.uniforms.waveAmp = { value: [0, 0, 0] };
  mat.needsUpdate = true;
}

/** 장을 켜거나(field) 끕니다(null). baseM·thickM 은 밑면 높이 기준 밀도 단면용. */
export function setWaveUniforms(mat: PatchableMaterial, field: WaveField | null, baseM = 0, thickM = 1000): void {
  const u = mat.uniforms;
  u.waveOn.value = field ? 1 : 0;
  if (!field) { u.waveTex.value = DUMMY; return; }
  u.waveTex.value = field.tex;
  (u.waveBox.value as Vector4).set(field.halfM, baseM, thickM, 0);
  (u.waveP.value as Vector4).set(field.tau, field.chi, field.edge, field.detail);
  const ks = u.waveK.value as Vector4[];
  field.smallK.forEach((k, i) => ks[i].copy(k));
  u.waveAmp.value = [...field.smallAmp];
}
