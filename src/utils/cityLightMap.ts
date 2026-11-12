/**
 * cityLightMap.ts — 밤 불빛 지도(NASA Black Marble 2016, 0.1° 칸, `assets/nightlights/lights_01deg.png`, tools/nightlights/README.md)로
 * 관측점 둘레 도시 불빛의 방향과 자리를 냅니다(2026-11-13).
 *
 * 절대 세기는 광공해 설정(volumetricScene.setCityLight)이 정하고, 이 지도는 상대 분포만 줍니다:
 *  - azGain[36]: 방위 10° 칸마다 지평선 빛의 상대 세기(평균 1). 도시가 있는 쪽 지평선만 밝게.
 *    칸의 몫 = Σ L·면적·d^(−2.5) (Walker 의 법칙: 도시 하나의 하늘빛은 거리의 −2.5 제곱), 10~300 km.
 *  - patch: 관측점 둘레 ±60 km 의 구름 밑면 빛 배율(관측점 = 1). 땅 불빛을 σ 5 km 로 흐린 값의 비 — 도심 위 구름이 더 밝게.
 * 저장 값 v → 상대 밝기 L = (v/255)².
 */
import { unzlibSync } from 'fflate';

export interface NightLights { w: number; h: number; data: Uint8Array }

/**
 * 8 비트 PNG(인터레이스 없음)를 풀어 첫 채널만 남깁니다 — RN 에 캔버스가 없어 직접. 회색·RGB·팔레트·알파 모두 받음
 * (안드로이드 빌드가 PNG 를 다시 눌러 팔레트로 바꿀 수 있음).
 */
export function decodeGrayPng(bytes: Uint8Array): NightLights {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let p = 8, w = 0, h = 0, ct = 0;
  let plte: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  while (p < bytes.length) {
    const len = dv.getUint32(p); const type = String.fromCharCode(bytes[p + 4], bytes[p + 5], bytes[p + 6], bytes[p + 7]);
    const body = bytes.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      w = dv.getUint32(p + 8); h = dv.getUint32(p + 12); ct = body[9];
      if (body[8] !== 8 || body[12] !== 0) throw new Error('cityLightMap: 8 비트·비인터레이스 PNG 만');
    } else if (type === 'PLTE') plte = body;
    else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  const bpp = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[ct];
  if (!bpp) throw new Error('cityLightMap: PNG 색 형식 ' + ct);
  const total = idat.reduce((a, b) => a + b.length, 0);
  const z = new Uint8Array(total); let o = 0; for (const b of idat) { z.set(b, o); o += b.length; }
  const raw = unzlibSync(z);
  const stride = w * bpp;
  const out = new Uint8Array(w * h);
  let prev = new Uint8Array(stride), cur = new Uint8Array(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0, b = prev[x], c = x >= bpp ? prev[x - bpp] : 0;
      let v = row[x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      cur[x] = v & 255;
    }
    for (let x = 0; x < w; x++) { const v = cur[x * bpp]; out[y * w + x] = ct === 3 && plte ? plte[v * 3] : v; }
    const t = prev; prev = cur; cur = t;
  }
  return { w, h, data: out };
}

const R_KM = 6371;
/** 위경도(°)의 상대 밝기 L(쌍선형). */
export function lightAt(m: NightLights, lat: number, lon: number): number {
  const fx = ((lon + 180) / 360) * m.w - 0.5, fy = ((90 - lat) / 180) * m.h - 0.5;
  const x0 = Math.floor(fx), y0 = Math.max(0, Math.min(m.h - 2, Math.floor(fy))), u = fx - x0, v = Math.min(1, Math.max(0, fy - y0));
  const g = (x: number, y: number) => { const q = m.data[y * m.w + (((x % m.w) + m.w) % m.w)] / 255; return q * q; };
  return (g(x0, y0) * (1 - u) + g(x0 + 1, y0) * u) * (1 - v) + (g(x0, y0 + 1) * (1 - u) + g(x0 + 1, y0 + 1) * u) * v;
}

export interface CityLightField {
  /** 방위 0°(북)부터 10° 칸 36 개, 평균 1 */
  azGain: Float32Array;
  /** ±halfKm 정사각형(n×n, 행 = 남→북, 열 = 서→동) 구름 밑면 배율, 관측점 = 1 */
  patch: Float32Array; n: number; halfKm: number;
  /** 진단: 관측점 흐린 땅 밝기, 방위 몫 합(Walker) */
  local: number; walker: number;
}

export function cityLightField(m: NightLights, lat: number, lon: number, n = 48, halfKm = 60): CityLightField {
  const kmLat = (Math.PI * R_KM) / 180, kmLon = kmLat * Math.cos((lat * Math.PI) / 180);
  // 1) 방위 몫: 300 km 안의 칸(0.1°)을 돌며
  const az = new Float64Array(36);
  const span = 3.0, step = 0.1;
  let walker = 0;
  for (let dy = -span; dy <= span + 1e-9; dy += step) for (let dx = -span / Math.max(0.2, Math.cos((lat * Math.PI) / 180)); dx <= span / Math.max(0.2, Math.cos((lat * Math.PI) / 180)) + 1e-9; dx += step) {
    const la = lat + dy, lo = lon + dx;
    const L = lightAt(m, la, lo);
    if (L <= 1e-4) continue;
    const yk = dy * kmLat, xk = dx * kmLat * Math.cos((la * Math.PI) / 180);
    const d = Math.hypot(xk, yk);
    if (d < 10 || d > 300) continue;
    const area = kmLat * step * kmLat * step * Math.cos((la * Math.PI) / 180);
    const c = L * area * Math.pow(d, -2.5);
    const b = Math.floor((((Math.atan2(xk, yk) * 180) / Math.PI + 360) % 360) / 10) % 36;
    az[b] += c; walker += c;
  }
  // 0.1° 칸이 가까운 도시에서 방위 칸을 들쭉날쭉하게 함(첫 시험: 이웃 칸 4.0 과 0.2) → 원형 [1 4 6 4 1]/16 을 두 번(σ ≈ 14°).
  for (let pass = 0; pass < 2; pass++) {
    const t = az.slice();
    for (let i = 0; i < 36; i++) az[i] = (t[(i + 34) % 36] + 4 * t[(i + 35) % 36] + 6 * t[i] + 4 * t[(i + 1) % 36] + t[(i + 2) % 36]) / 16;
  }
  const mean = walker / 36;
  const floor = Math.max(mean * 0.15, 1e-9);
  const azGain = new Float32Array(36);
  for (let i = 0; i < 36; i++) azGain[i] = Math.min(4, Math.max(0.2, (az[i] + floor) / (mean + floor)));
  // 2) 구름 밑면 배율: 땅 불빛을 σ 5 km 가우스로 흐린 값(표본 2.5 km 간격 5×5)을 관측점 값으로 나눔
  const blurred = (la: number, lo: number) => {
    let s = 0, w = 0;
    for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) {
      const wk = Math.exp(-((i * 2.5) ** 2 + (j * 2.5) ** 2) / (2 * 25));
      s += wk * lightAt(m, la + (j * 2.5) / kmLat, lo + (i * 2.5) / kmLon); w += wk;
    }
    return s / w;
  };
  const local = blurred(lat, lon);
  const eps = 0.01;
  const patch = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const yk = -halfKm + ((j + 0.5) / n) * 2 * halfKm, xk = -halfKm + ((i + 0.5) / n) * 2 * halfKm;
    patch[j * n + i] = Math.min(5, Math.max(0.05, (blurred(lat + yk / kmLat, lon + xk / kmLon) + eps) / (local + eps)));
  }
  return { azGain, patch, n, halfKm, local, walker };
}
