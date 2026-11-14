/**
 * 파동 합성 구름 장(설계: docs/WAVE_FIELD_DESIGN.md) — 하네스 시제품, 기본 꺼짐.
 *
 * 층 opts.wave 가 있는 레인(지금은 레인 0 만)의 밀도를 종류 무늬 대신 이 장에서 가져옵니다.
 *  - 큰 파동(크기 단계 0~2)과 비틀림·밑면 굴곡·층 밖 감쇠는 CPU 에서 3차원 텍스처(R16F)로 굽습니다.
 *  - 작은 파동(단계 3~5, 혹)은 셰이더에서 바로 계산합니다(파동 36 개). 텍스처 칸보다 작은 무늬라서입니다.
 *  - 운량 문턱 τ 는 구운 장의 기둥 최댓값 분포에서 운량만큼 남기는 값입니다.
 * waveOn 이 0 이면 셰이더는 원래 경로 그대로입니다(분기 하나).
 */
import { ClampToEdgeWrapping, Data3DTexture, DataUtils, HalfFloatType, LinearFilter, RedFormat, RepeatWrapping, Vector4 } from 'three';

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
  /** 높이별 채우기(흐린 날): 높이(m, 해발)별 운량 0~1. 주면 이 모드 — 판·지붕 대신 높이마다 그 운량만큼 채움 */
  profile?: { zM: number; cover: number }[];
  /** 세로 파장 배율(크면 위아래가 같이 움직임) */
  vstretch?: number;
  /** 작은 구멍 메우기 반경(m, 0 끔): max(V, 주변 평균) 뒤 높이별 운량 다시 맞춤 */
  fillM?: number;
  /**
   * 채우기 모드의 3차원 섞임 비율(0~1). 1 = 장 전체가 3차원(1판). 큰 파동 몇 개가 모양을 정하면 사인 파동의 평면 등고면이 비스듬한 판·절벽으로
   * 보였음(2026-11-12) → 큰 모양은 밑면 높이의 2차원 무늬, 3차원은 이 비율만큼만.
   */
  mix3d?: number;
  /**
   * 채우기 모드 3차원 흐림(가로 m · 세로 칸): 자르기 전에 장을 흐려 등고면을 둥글게 — 구멍 가장자리가 직각 절벽 대신 위아래로 말려 들어감.
   * 0 이면 끔. 흐린 뒤 높이별 운량을 다시 맞춤.
   */
  smoothM?: number;
  smoothZ?: number;
  /** 밑면에서도 작은 파동(혹)을 켜는 비율 0~1(거친 비구름 밑면). 0 이면 밑면 30 % 높이까지 꺼짐 */
  baseBump?: number;
  /** 관측 일사로 정한 기둥 광학두께(있으면 장면이 레인 0 의 densityScale 을 이것에 맞춤, volumetricScene) */
  tauTarget?: number;
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
  baseBump: number;
  bakeMs: number;
  stats: { coverMeasured: number; vMin: number; vMax: number };
  /** 셰이더 waveColumn 의 기둥 적분 t 의 가로 평균(레인 높이 대비 0~1) — τ_기둥 ≈ densityScale × 레인 높이 × colMean */
  colMean: number;
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
      dx -= along * sx * (1 - 1 / alpha); dy -= along * sy * (1 - 1 / alpha); dz *= beta / p.vstretch;
      // 가로 파수를 상자 길이(2·halfM)의 정수배로 맞춰 장이 상자마다 이음매 없이 되풀이되게 함. 예전엔 거울 반복이라
      // 상자 경계(관측점에서 halfM)에서 무늬가 좌우로 뒤집혀 대칭 판·절벽으로 보였음(2026-11-12 흐린 날 재현).
      const kq = (2 * Math.PI) / (2 * p.halfM);
      const kx = Math.round((kmag * dx) / kq) * kq, ky = Math.round((kmag * dy) / kq) * kq, kz = kmag * dz;
      // 비틀림 방향 ê ⟂ k
      let ex = -ky, ey = kx, ez = 0; const el = Math.hypot(ex, ey) || 1; ex /= el; ey /= el;
      row.push({ kx, ky, kz, ph: 2 * Math.PI * r(), ex, ey, ez });
    }
    out.push(row);
  }
  return out;
}

const DEF: Omit<Required<WaveParams>, 'ziM' | 'baseM' | 'thickM' | 'cover' | 'chi'> = {
  shearDeg: 90, shear: 0.002, N: 0.004, wStar: 1.5, edge: 3, sigmaB: 120, warp: 0.15, spec: 1, bump: 1, detail: 0.55, dome: false, gamma: 0.3, profile: [], vstretch: 1, fillM: 0, mix3d: 1, smoothM: 0, smoothZ: 0, baseBump: 0, tauTarget: 0, seed: 1, halfM: 15000, nxy: 192, nz: 40,
};

/** 레인 높이 범위(m): 밑면 100 m 아래 ~ 윗면 + 0.3H. 장면 층의 baseKm·thicknessM 을 이것에 맞추세요. */
export function waveLaneRange(p: WaveParams): { zMin: number; zMax: number } {
  if (p.profile && p.profile.length) {
    const on = p.profile.filter(q => q.cover > 0).map(q => q.zM);
    return { zMin: Math.min(...on) - 300, zMax: Math.max(...on) + 400 };
  }
  return { zMin: p.baseM - 150, zMax: p.baseM + 1.3 * p.thickM };
}

let cachedRawWave: { key: string; data: Float32Array } | null = null;

export function* bakeWaveFieldSteps(input: WaveParams): Generator<void, WaveField, void> {
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
  const warpScale0 = p.warp * ((2 * Math.PI) / Math.hypot(W[0][0].kx, W[0][0].ky, W[0][0].kz)) / PER * 3;
  const warpScale1 = p.warp * ((2 * Math.PI) / Math.hypot(W[1][0].kx, W[1][0].ky, W[1][0].kz)) / PER * 3;
  // 큰 파동 F_big(x,y,z) — 단계 0·1 로 비튼 좌표에서 0~2 단계 합(단위 분산)
  const fbig = (x: number, y: number, z: number) => {
    let wx = 0, wy = 0, wz = 0;
    for (const w of W[0]) {
      const s = warpScale0 * Math.sin(w.kx * x + w.ky * y + w.kz * z + w.ph * 1.7);
      wx += s * w.ex; wy += s * w.ey; wz += s * w.ez;
    }
    for (const w of W[1]) {
      const s = warpScale1 * Math.sin(w.kx * x + w.ky * y + w.kz * z + w.ph * 1.7);
      wx += s * w.ex; wy += s * w.ey; wz += s * w.ez;
    }
    const X = x + wx, Y = y + wy, Z = z + wz;
    let f = 0;
    for (let j = 0; j < 3; j++) { let fj = 0; for (const w of W[j]) fj += Math.cos(w.kx * X + w.ky * Y + w.kz * Z + w.ph); f += AMP[j] * fj * inv6; }
    return f * bigNorm;
  };
  const vox = new Float32Array(n * n * nz);
  const colMax = new Float32Array(n * n);
  const c = Math.min(0.999, Math.max(0.001, p.cover));
  if (p.profile.length) {
    // 높이별 채우기: 장 F(x,y,z) 를 높이 칸마다 그 높이 운량만큼 남기는 문턱으로 자름. 판·지붕 꼴 없음.
    const prof = [...p.profile].sort((a, b) => a.zM - b.zM);
    const coverAt = (z: number) => {
      if (z <= prof[0].zM) return prof[0].zM - z < 150 ? prof[0].cover : 0;
      for (let i = 1; i < prof.length; i++) if (z <= prof[i].zM) { const t = (z - prof[i - 1].zM) / (prof[i].zM - prof[i - 1].zM); return prof[i - 1].cover + t * (prof[i].cover - prof[i - 1].cover); }
      return z - prof[prof.length - 1].zM < 150 ? prof[prof.length - 1].cover : 0;
    };
    const slice = new Float32Array(n * n);
    const cutSlice = (iz: number, src: Float32Array) => {
      const cz = coverAt(zMin + ((iz + 0.5) / nz) * (zMax - zMin));
      const off = iz * n * n;
      if (cz <= 0.002) { for (let i = 0; i < n * n; i++) src[off + i] = -5; return; }
      for (let i = 0; i < n * n; i++) slice[i] = src[off + i];
      slice.sort();
      const t = slice[Math.min(n * n - 1, Math.floor((1 - Math.min(0.999, cz)) * n * n))];
      // 운량이 높은 높이(0.85 → 1)는 문턱을 겨우 넘은 자리도 밀도를 갖게 1/e 만큼 올림 — 안 그러면 '100 % 덮임' 이어도
      // 장 값이 낮은 곳이 거의 투명해 큰 틈처럼 보였음(2026-11-12 비 오는 날 재현). 덮이지 않은 자리(문턱 아래)는 그대로 음수로 남김.
      const lift = (1 / Math.max(0.2, p.edge)) * Math.min(1, Math.max(0, (cz - 0.85) / 0.15));
      for (let i = 0; i < n * n; i++) { const v = src[off + i] - t; src[off + i] = v > 0 ? v + lift : v; }
    };
    const rawKey = JSON.stringify([p.seed, p.ziM, zb, zMin, zMax, p.shearDeg, p.shear, p.N, p.wStar, p.vstretch, half, p.warp, p.spec, n, nz, p.chi, p.mix3d]);
    if (cachedRawWave && cachedRawWave.key === rawKey && cachedRawWave.data.length === vox.length) {
      vox.set(cachedRawWave.data);
      for (let iz = 0; iz < nz; iz++) {
        cutSlice(iz, vox);
        if ((iz & 7) === 7) yield;
      }
    } else {
      // 밑면 높이에서의 2차원 무늬(채우기 모드 큰 모양)
      const base2 = new Float32Array(n * n);
      for (let iy = 0; iy < n; iy++) {
        for (let ix = 0; ix < n; ix++) {
          const x = -half + ((ix + 0.5) / n) * 2 * half, y = -half + ((iy + 0.5) / n) * 2 * half;
          base2[iy * n + ix] = skew(fbig(x, y, zb));
        }
        if ((iy & 7) === 7) yield;
      }
      for (let iz = 0; iz < nz; iz++) {
        const z = zMin + ((iz + 0.5) / nz) * (zMax - zMin);
        for (let iy = 0; iy < n; iy++) {
          for (let ix = 0; ix < n; ix++) {
            const x = -half + ((ix + 0.5) / n) * 2 * half, y = -half + ((iy + 0.5) / n) * 2 * half;
            const g2 = base2[iy * n + ix];
            vox[(iz * n + iy) * n + ix] = p.mix3d >= 1 ? skew(fbig(x, y, z)) : g2 + p.mix3d * (skew(fbig(x, y, z)) - g2);
          }
          if ((iy & 7) === 7) yield;
        }
      }
      cachedRawWave = { key: rawKey, data: vox.slice() };
      for (let iz = 0; iz < nz; iz++) {
        cutSlice(iz, vox);
        if ((iz & 7) === 7) yield;
      }
    }
    if (p.smoothM > 0 || p.smoothZ > 0) {
      // 3차원 상자 흐림 두 번(삼각 가중): 가로 반경 rs 칸, 세로 반경 rz 칸. 원래 값(자르기 전 문턱 기준)을 흐린 뒤 높이별로 다시 자름.
      const rs = Math.max(0, Math.round(p.smoothM / ((2 * half) / n))), rz = Math.max(0, Math.round(p.smoothZ));
      const tmp = new Float32Array(vox.length);
      function* blurAxis(a: Float32Array, b: Float32Array, axis: 0 | 1 | 2, r: number): Generator<void, void, void> {
        if (r <= 0) { b.set(a); return; }
        for (let iz = 0; iz < nz; iz++) {
          for (let iy = 0; iy < n; iy++) for (let ix = 0; ix < n; ix++) {
            let sum = 0, cnt = 0;
            for (let k = -r; k <= r; k++) {
              let jx = ix, jy = iy, jz = iz;
              if (axis === 0) jx = (ix + k + n) % n; else if (axis === 1) jy = (iy + k + n) % n; else { jz = iz + k; if (jz < 0 || jz >= nz) continue; }
              sum += a[(jz * n + jy) * n + jx]; cnt++;
            }
            b[(iz * n + iy) * n + ix] = sum / cnt;
          }
          if ((iz & 3) === 3) yield;
        }
      }
      for (let rep = 0; rep < 2; rep++) {
        yield* blurAxis(vox, tmp, 0, rs);
        yield* blurAxis(tmp, vox, 1, rs);
        yield* blurAxis(vox, tmp, 2, rz);
        vox.set(tmp);
      }
      for (let iz = 0; iz < nz; iz++) { cutSlice(iz, vox); if (iz % 8 === 7) yield; }
    }
    if (p.fillM > 0) {
      // 구멍 메우기: 가로 상자 평균(반경 r 칸, 두 번 = 삼각 가중) · 세로 ±1 칸 → max(V, 평균) → 높이별 운량 다시 맞춤
      const r = Math.max(1, Math.round(p.fillM / ((2 * half) / n)));
      const blur = Float32Array.from(vox), tmp = new Float32Array(vox.length);
      function* pass(a: Float32Array, b: Float32Array, dx: number, dy: number): Generator<void, void, void> {
        for (let iz = 0; iz < nz; iz++) {
          for (let iy = 0; iy < n; iy++) for (let ix = 0; ix < n; ix++) {
            let s = 0;
            for (let k = -r; k <= r; k++) {
              const jx = Math.min(n - 1, Math.max(0, ix + k * dx)), jy = Math.min(n - 1, Math.max(0, iy + k * dy));
              s += a[(iz * n + jy) * n + jx];
            }
            b[(iz * n + iy) * n + ix] = s / (2 * r + 1);
          }
          if ((iz & 3) === 3) yield;
        }
      }
      for (let rep = 0; rep < 2; rep++) { yield* pass(blur, tmp, 1, 0); yield* pass(tmp, blur, 0, 1); }
      for (let iz = 0; iz < nz; iz++) for (let i = 0; i < n * n; i++) {
        const o = iz * n * n + i, zm = Math.max(0, iz - 1) * n * n + i, zp = Math.min(nz - 1, iz + 1) * n * n + i;
        vox[o] = Math.max(vox[o], (blur[zm] + 2 * blur[o] + blur[zp]) / 4);
      }
      for (let iz = 0; iz < nz; iz++) { cutSlice(iz, vox); if (iz % 8 === 7) yield; }
    }
    let vMin = Infinity, vMax = -Infinity, covered = 0;
    for (let i = 0; i < vox.length; i++) { const v = vox[i]; if (v < vMin) vMin = v; if (v > vMax) vMax = v; }
    for (let i = 0; i < n * n; i++) { for (let iz = 0; iz < nz; iz++) if (vox[iz * n * n + i] > 0) { covered++; break; } }
    return finish(vox, 0, covered / (n * n), vMin, vMax);
  }
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
      yield;
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
    yield;
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
  tex.wrapS = RepeatWrapping; tex.wrapT = RepeatWrapping; tex.wrapR = ClampToEdgeWrapping;
  tex.unpackAlignment = 1; tex.needsUpdate = true;
  // 셰이더 waveColumn 과 같은 식: q = (0.25 + 0.75 fb^⅔)·clamp(e·(v − τ))·(1 + 0.3(1 − χ)·tanh v), fb = (z − 밑면)/두께.
  let qSum = 0;
  for (let iz = 0; iz < nz; iz++) {
    const z = zMin + ((iz + 0.5) / nz) * (zMax - zMin);
    const fb = Math.min(1, Math.max(0, (z - p.baseM) / Math.max(p.thickM, 1)));
    const prof = 0.25 + 0.75 * Math.pow(fb, 2 / 3);
    for (let i = iz * n * n; i < (iz + 1) * n * n; i++) {
      const v = vox[i];
      qSum += prof * Math.min(1, Math.max(0, p.edge * (v - tau))) * (1 + 0.3 * (1 - p.chi) * Math.tanh(v));
    }
  }
  const colMean = qSum / vox.length;
  const smallK: Vector4[] = [];
  for (let j = 3; j < OCT; j++) for (const w of W[j]) smallK.push(new Vector4(w.kx, w.ky, w.kz, w.ph));
  return {
    tex, tau, zMin, zMax, halfM: half, chi: p.chi, edge: p.edge, detail: p.detail, baseBump: p.baseBump, smallK,
    // 단계 5(~λ0/32)는 행진 보폭보다 짧아 반짝이는 점으로 깨져 뺍니다(2차 판정).
    smallAmp: [AMP[3] * p.bump, AMP[4] * p.bump, 0], bakeMs: Date.now() - t0,
    stats: { coverMeasured, vMin, vMax }, colMean,
  };
  }
}

/** 한 번에 굽기(하네스 setScene). */
export function bakeWaveField(input: WaveParams): WaveField {
  const g = bakeWaveFieldSteps(input);
  for (;;) { const r = g.next(); if (r.done) return r.value; }
}

/** 조각내 굽기(앱 setSceneAsync) — 약 budgetMs 마다 다음 틀로 넘깁니다. 취소되면 null. */
export async function bakeWaveFieldAsync(
  input: WaveParams,
  cancelled: () => boolean,
  budgetMs = 12,
  restMs = 0,
  shouldPause?: () => boolean,
): Promise<WaveField | null> {
  const g = bakeWaveFieldSteps(input);
  let t = Date.now();
  for (;;) {
    const r = g.next();
    if (r.done) return r.value;
    if (Date.now() - t >= budgetMs) {
      await new Promise<void>(res => setTimeout(res, restMs));
      while (shouldPause?.() && !cancelled()) {
        await new Promise<void>(res => setTimeout(res, 80));
      }
      if (cancelled()) { return null; }
      t = Date.now();
    }
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
    'uniform sampler3D waveTex;', 'uniform vec4 waveBox;', 'uniform vec4 waveP;',
    `uniform vec4 waveK[${NSMALL}];`, 'uniform vec3 waveAmp;',
    // 셰이더 안 작은 파동(혹): 단계마다 |합| 을 접어 둥근 혹 사이에 날카로운 골(2|z| − 평균)
    '#define WAVE_FIELD 1',
    // 기둥 적분(두-흐름 확산광 diffuse 4 용): 표본 기둥의 파동 장 밀도(모양 잡음·혹 없음)를 12 점으로 — x = 표본 위, y = 전체(층 높이 비 단위 평균).
    // 확산광이 레인 종류(ns) 날씨 무늬로 기둥을 세면 실제 덱과 다른 판·절벽 무늬가 그려졌음(2026-11-12).
    'vec2 waveColumn(vec3 position, float hf0) {',
    '  vec3 wd = position - genusOrigin;',
    '  vec2 wxy = vec2(dot(wd, genusEast), dot(wd, genusNorth)) / (2.0 * waveBox.x) + 0.5;',
    '  float a = 0.0, t = 0.0;',
    '  for (int i = 0; i < 12; ++i) {',
    '    float hf = (float(i) + 0.5) / 12.0;',
    '    float wv = texture(waveTex, vec3(wxy, hf)).r;',
    '    float z = mix(minLayerHeights.x, maxLayerHeights.x, hf);',
    '    float fb = clamp((z - waveBox.y) / max(waveBox.z, 1.0), 0.0, 1.0);',
    '    float q = (0.25 + 0.75 * pow(fb, 0.6667)) * clamp(waveP.z * (wv - waveP.x), 0.0, 1.0) * (1.0 + 0.3 * (1.0 - waveP.y) * tanh(wv));',
    '    t += q;',
    '    a += q * step(hf0, hf);',
    '  }',
    '  return vec2(a, t) / 12.0;',
    '}',
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
  // 빈 칸 건너뛰기를 막으려고 레인 0 의 날씨 밀도를 층 안에서 1 로. ⚠ 선언(decl)을 넣기 **전에** — 선언이 이 앵커 사이에 끼면 치환이 조용히
  // 실패해, 그리는 행진이 레인 종류(ns) 무늬 바깥을 빈 칸으로 건너뛰어 그 무늬 윤곽이 거대한 도형으로 보였음(2026-11-12).
  // waveOn 은 sampleWeather 에서도 쓰므로 그보다 앞에 선언.
  src = src.replace('WeatherSample sampleWeather(', 'uniform float waveOn;\nWeatherSample sampleWeather(');
  const before = src;
  src = src.replace(WEATHER_ANCHOR, '  if (waveOn > 0.5) { float wIn = step(0.0, weather.heightFraction.x) * step(weather.heightFraction.x, 1.0); weather.density.x = wIn; }\n' + WEATHER_ANCHOR);
  if (src === before) throw new Error('cloudWave: weather anchor replace failed');
  src = src.replace('vec4 getLayerDensity', decl + 'vec4 getLayerDensity');
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
    '    if (ws > -1.2 && ws < 0.6) ws += waveP.y * mix(smoothstep(0.0, 0.3, wfb), 1.0, waveBox.w) * waveSmall(vec3(wxy, wz));',
    '    float wprof = 0.25 + 0.75 * pow(wfb, 0.6667);',
    '    float wc = clamp(waveP.z * ws, 0.0, 1.0);',
    // 표면 깎기(2026-11-12): 다른 구름과 같은 takram 모양 잡음으로, 세기는 대류성 χ 로 0.4(판)~1(뭉게). 속(wc≈1)은 그대로.
    '    float wsh = texture(shapeTexture, position * shapeRepeat + shapeOffset).r;',
    '    wc = remapClamped(wc, (1.0 - wsh) * mix(0.4, 1.0, waveP.y), 1.0);',
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
  (u.waveBox.value as Vector4).set(field.halfM, baseM, thickM, field.baseBump);
  (u.waveP.value as Vector4).set(field.tau, field.chi, field.edge, field.detail);
  const ks = u.waveK.value as Vector4[];
  field.smallK.forEach((k, i) => ks[i].copy(k));
  u.waveAmp.value = [...field.smallAmp];
}
