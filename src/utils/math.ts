/**
 * 공용 수학 · 각도 · 보간 · 결정론적 난수 유틸리티.
 * 여러 모듈에 흩어져 있던 clamp / smoothstep / lerp / mulberry32 등을 단일 소스로 통합합니다.
 */

export const D2R = Math.PI / 180;
export const R2D = 180 / Math.PI;

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function clamp01(x: number): number {
  return x <= 0 ? 0 : x >= 1 ? 1 : x;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** GLSL 표준 3인자 Hermite 보간 (e0..e1 -> 0..1). */
export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

/** 0..1 입력용 Hermite 보간. */
export function smoothstep01(x: number): number {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
}

/** (-180, 180] 범위 각도 정규화 (경계 -180 은 +180 으로 통일). */
export function wrap180(deg: number): number {
  const d = ((((deg + 180) % 360) + 360) % 360) - 180;
  return d === -180 ? 180 : d;
}

/** 결정론적 32비트 Mulberry32 PRNG (구름·거시 상태장 공용). */
export function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
