/**
 * refractionK.ts — **날씨에 따른 대기 굴절 계수 k** (2026-11-21, docs/SANDBOX_MODE_PLAN.md 6.1 "날씨에 따른 정밀 굴절"). 순수 함수.
 *
 * 땅 위 시선은 공기 밀도가 아래로 갈수록 커서 땅 쪽으로 휩니다. 휘는 정도가 지구 곡률의 k 배이고, 기온 감률이 작을수록(역전층) 많이 휩니다.
 * 측지학의 식(Gaylord · Bomford): k = 503 · (P / T²) · (0.0343 + dT/dh) — P 기압(hPa), T 기온(K), dT/dh 기온 감률(K/m).
 * 표준 대기(1013.25 hPa, 15 °C, −6.5 K/km)에서 0.1706. 앱의 기본은 7/6 R 에 해당하는 1/7(=0.1429, `earth.ts`)이고, **이 식은 아직 앱에 연결돼 있지 않습니다**(날씨 자료의 기온 단면을 받는 일과 설정 스위치가 남음).
 * 판정: `tools/shader-preview/verify-refraction-k.js`
 */
import { REFRACTION_K } from './earth';

/** 식이 극단 입력에서 덕트 · 하강 영역으로 가는 것을 막는 안전 범위. */
export const K_MIN = -0.2;
export const K_MAX = 0.6;

export interface RefractionInput { tC: number; pHpa: number; lapseKPerM: number }

export function refractionKFromWeather(i: RefractionInput): number {
  const { tC, pHpa, lapseKPerM } = i;
  if (![tC, pHpa, lapseKPerM].every(Number.isFinite)) return REFRACTION_K;
  const tK = tC + 273.15;
  if (tK <= 0 || pHpa <= 0) return REFRACTION_K;
  const k = 503 * (pHpa / (tK * tK)) * (0.0343 + lapseKPerM);
  return Math.max(K_MIN, Math.min(K_MAX, k));
}

/** 두 높이의 기온(°C)에서 감률(K/m). 높이차가 0 이하이거나 유한하지 않으면 null. */
export function lapseRate(tLowC: number, tHighC: number, dzM: number): number | null {
  if (![tLowC, tHighC, dzM].every(Number.isFinite) || dzM <= 0) return null;
  return (tHighC - tLowC) / dzM;
}
