/**
 * RULER-grain 캡처의 순수 함수(브라우저·three 없음) — capture.ts 가 쓰고, capture-test.mjs 가 node 에서 시험합니다.
 *
 * - BAYER: takram `bayer.ts` 의 bayerIndices(행 우선, i%4 = x, floor(i/4) = y) 그대로. 시험이 takram 원문과 대조합니다.
 *   프레임 f 에서 1/4 해상도 구름 패스 텍셀 (X, Y) 는 구름 버퍼 텍셀 (4X + bx, 4Y + by) 의 표본입니다(bayerIndex(bx, by) = f % 16).
 *   cloudsResolve.frag 의 갱신 판정 bayerIndices[x%4][y%4] == frame%16 과 같은 표(GLSL 은 열 우선 ivec4[x][y]).
 * - 반정밀도 해독 표(65536), 반정밀도 부호화, 무게 없는 누적기(합·제곱합 Float64), base64(덩어리).
 * - sRGB 부호화는 SceneComposer `linearToSrgb` 와 같은 식(clamp 0..1).
 */
export const BAYER: readonly number[] = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/** bayer 값 v(= frame % 16) 의 4×4 블록 안 위치 (bx, by) — GL 좌표(y 위로). */
export function bayerPos(v: number): [number, number] {
  const i = BAYER.indexOf(((v % 16) + 16) % 16);
  return [i % 4, Math.floor(i / 4)];
}

let HALF_LUT: Float32Array | null = null;
/** 반정밀도(16비트) → float32 해독 표. */
export function halfLut(): Float32Array {
  if (HALF_LUT) return HALF_LUT;
  const t = new Float32Array(65536);
  for (let h = 0; h < 65536; h++) {
    const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 0x1f, m = h & 0x3ff;
    t[h] = e === 0 ? s * m * 2 ** -24 : e === 31 ? (m ? NaN : s * Infinity) : s * (1 + m / 1024) * 2 ** (e - 15);
  }
  HALF_LUT = t;
  return t;
}

const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
/** float → 반정밀도(가장 가까운 짝수로 반올림, 넘치면 ±Inf, NaN 유지). */
export function toHalf(x: number): number {
  if (Number.isNaN(x)) return 0x7e00;
  f32[0] = x;
  const b = u32[0], s = (b >>> 16) & 0x8000, e = ((b >>> 23) & 0xff) - 127 + 15;
  let m = b & 0x7fffff;
  if (e >= 31) return s | 0x7c00;
  if (e <= 0) {
    if (e < -10) return s;
    m |= 0x800000;
    const sh = 14 - e, half = 1 << (sh - 1), rest = m & ((1 << sh) - 1);
    let v = m >>> sh;
    if (rest > half || (rest === half && (v & 1))) v++;
    return s | v;
  }
  let v = (e << 10) | (m >>> 13);
  const rest = m & 0x1fff;
  if (rest > 0x1000 || (rest === 0x1000 && (v & 1))) v++;
  return s | v;
}

export function encodeHalfArray(a: ArrayLike<number>): Uint16Array {
  const o = new Uint16Array(a.length);
  for (let i = 0; i < a.length; i++) o[i] = toHalf(a[i]);
  return o;
}

/** SceneComposer SRGB_ENCODE_GLSL linearToSrgb 와 같은 식. */
export function linearToSrgb(c: number): number {
  c = Math.min(1, Math.max(0, c));
  return c < 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

export const lum = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/**
 * 1/4 해상도 구름 패스 한 프레임(RGBA, GL 행 순서, lw×lh)을 구름 버퍼 격자(cw×ch)에 흩어 누적합니다.
 * 텍셀마다 휘도 Y(미리곱 rgb 의 Rec.709)와 알파의 합·제곱합·표본 수. 버퍼 밖(4·ceil(w/4) > w)은 버림.
 */
export function scatterQuarter(px: Float32Array, lw: number, lh: number, frame: number, cw: number, ch: number,
  sY: Float64Array, sY2: Float64Array, sA: Float64Array, sA2: Float64Array, n: Uint16Array): void {
  const [bx, by] = bayerPos(frame % 16);
  for (let Y = 0; Y < lh; Y++) {
    const y = 4 * Y + by; if (y >= ch) continue;
    for (let X = 0; X < lw; X++) {
      const x = 4 * X + bx; if (x >= cw) continue;
      const i = (Y * lw + X) * 4, j = y * cw + x;
      const v = lum(px[i], px[i + 1], px[i + 2]), a = px[i + 3];
      sY[j] += v; sY2[j] += v * v; sA[j] += a; sA2[j] += a * a; n[j]++;
    }
  }
}

/** 합·제곱합 → (평균, 표준편차 ddof 1). 표본 < 2 이면 NaN. */
export function meanStd(s: number, s2: number, n: number): [number, number] {
  if (n < 2) return [n ? s / n : NaN, NaN];
  const m = s / n, v = Math.max(0, (s2 - s * m) / (n - 1));
  return [m, Math.sqrt(v)];
}

type Typed = Float32Array | Float64Array | Uint16Array | Uint8Array;
/** GL 행 순서(아래가 0) → 위가 0(PNG 와 같은 방향). 채널 수 c, 같은 형의 새 배열. */
export function flipRows<T extends Typed>(a: T, w: number, h: number, c: number): T {
  const o = new (a.constructor as new (n: number) => T)(a.length), row = w * c;
  for (let y = 0; y < h; y++) (o as Typed).set((a as Typed).subarray(y * row, (y + 1) * row) as never, (h - 1 - y) * row);
  return o;
}

/** ArrayBuffer 조각 → base64(덩어리 32 KiB 씩 — String.fromCharCode 인자 상한). */
export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)));
  return typeof btoa === 'function' ? btoa(s) : Buffer.from(s, 'binary').toString('base64');
}

/** takram 백색 잡음 LCG(volumetricScene.ts makeWhiteNoise3D 와 같은 식) — 씨앗만 바꿔 같은 크기 배열을 채웁니다. */
export function fillWhiteNoise(data: Uint8Array, seed: number): void {
  let s = seed >>> 0;
  for (let i = 0; i < data.length; i++) { s = (s * 1664525 + 1013904223) >>> 0; data[i] = s >>> 24; }
}

/** 기준 렌더의 층화 화소 오프셋(캔버스 화소): ss×ss 칸, 구름 텍셀 ±0.5 범위 = 캔버스 ±0.5/res. k 번째 프레임. */
export function stratumOffset(k: number, ss: number, res: number): [number, number] {
  const s = ((k % (ss * ss)) + ss * ss) % (ss * ss), sx = s % ss, sy = Math.floor(s / ss);
  return [((sx + 0.5) / ss - 0.5) / res, ((sy + 0.5) / ss - 0.5) / res];
}

/** FNV-1a 32비트(state-hash.js 와 같은 식). */
export function fnv(s: string, h = 2166136261): number {
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}
