/**
 * cloudMorph.ts — 연속 형태 손잡이(morph). three.js 없음, 순수 함수.
 *
 * 왜: 예보로 구름 **이름**(cu·sc·st…)을 고르는 일은 관측자 라벨 기준 상한이 낮고(RULER-genus2 §7: 최강 학습기도 +4.5 %p),
 * 문턱 경계(운량 54 → 55 %)에서 프리셋이 통째로 바뀌어 하늘이 튑니다. 그래서 이름 대신 예보에서 바로 나오는 연속량으로
 * 형태 생성기(cloudGenus.morphField)를 움직입니다. 이름(genus)은 라벨·층 높이에만 남습니다.
 *
 * 손잡이:
 *  - c     대류성 0~1 — 판(0) ↔ 거품(0.5) ↔ 탑(1). CAPE·덱 두께·층 안 기온 감률, 바로 위 역전이면 줄임.
 *  - ice   얼음 비율 0~1 — 층 가운데 기온의 iceFraction(ECMWF). 둥근 덩어리 ↔ 바람 결.
 *  - aniso 바람 방향 늘임(1 = 등방) — 층 바람 세기.
 *  - wave  전단파 진폭 0~0.4 — 층간 바람 차 / 고도 차(cloudFlow 의 발단식과 같은 문턱).
 *  - cellKm 덩어리 크기 — 층 두께 × lerp(4, 1.3, c)(두께 비례: 얇은 판은 넓게, 대류는 폭 ≈ 높이).
 * 값은 눈금으로 묶습니다 — 10분 예보 보간마다 날씨 타일(수 초)을 다시 만들지 않게(캐시 키에 그대로 들어감).
 *
 * ⚠ 계수는 손값(사진·눈으로 맞출 대상)입니다. 입력이 물리량이라는 것이지 식이 물리 법칙이라는 뜻이 아닙니다.
 */
import { iceFraction, thermoAt, type ThermoInput } from './cloudPhysics';

export interface MorphParams {
  c: number;
  ice: number;
  aniso: number;
  /** 바람이 부는 방향(°, 북 0 동 90) — 늘임 축 */
  windDeg: number;
  wave: number;
  /** 전단 방향(°) — 물결 마루는 이것에 수직 */
  waveDeg: number;
  cellKm: number;
}

export interface MorphLayerInput {
  baseKm: number;
  thicknessM: number;
  /** 층 바람·전단(km/h, 동·북 — liveScene.flowOpts 가 opts 에 넣는 값) */
  windU?: number; windV?: number; shearU?: number; shearV?: number;
  /** 전단을 재는 바로 위 층까지의 고도 차(km) */
  shearDzKm?: number;
}

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const smooth = (e0: number, e1: number, x: number) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const q = (v: number, step: number) => Math.round(v / step) * step;
const bearing = (u: number, v: number) => (((Math.atan2(u, v) * 180) / Math.PI) + 360) % 360;

/** 층 안 기온 감률(K/km, 양수 = 위로 갈수록 추움). 단면이 없으면 thermoAt 의 표준대기(6.5)로 물러납니다. */
function lapseKPerKm(baseM: number, topM: number, th?: ThermoInput | null): number {
  const dz = Math.max(50, topM - baseM);
  return ((thermoAt(baseM, th).tC - thermoAt(topM, th).tC) / dz) * 1000;
}

/** 대류성 c. CAPE 가 없으면 두께·감률만으로 가중을 나눕니다. */
export function convectivityOf(baseM: number, thickM: number, th?: ThermoInput | null): number {
  const topM = baseM + thickM;
  const thick = smooth(300, 2000, thickM);
  // 습윤단열(≈ 6 K/km)보다 가파르면 불안정, 4 K/km 아래면 안정 — 층 안 대류의 대리값
  const lapse = smooth(4, 8, lapseKPerKm(baseM, topM, th));
  const cape = fin(th?.capeJkg) ? smooth(50, 1000, th!.capeJkg as number) : null;
  let c = cape == null ? 0.55 * thick + 0.45 * lapse : 0.4 * cape + 0.35 * thick + 0.25 * lapse;
  // 바로 위 300 m 가 역전(기온이 오름)이면 뚜껑 — 위로 못 자라고 옆으로 퍼짐
  if (lapseKPerKm(topM, topM + 300, th) < 0) c *= 0.6;
  return clamp(c, 0, 1);
}

export function morphParamsOf(L: MorphLayerInput, th?: ThermoInput | null): MorphParams {
  const baseM = L.baseKm * 1000;
  const thickM = Math.max(100, fin(L.thicknessM) ? L.thicknessM : 750);
  const c = convectivityOf(baseM, thickM, th);
  const ice = iceFraction(thermoAt(baseM + thickM / 2, th).tC);
  const u = fin(L.windU) ? L.windU : 0, v = fin(L.windV) ? L.windV : 0;
  const speedMps = Math.hypot(u, v) / 3.6;
  const su = fin(L.shearU) ? L.shearU : 0, sv = fin(L.shearV) ? L.shearV : 0;
  const shearPerKm = Math.hypot(su, sv) / 3.6 / Math.max(0.5, L.shearDzKm ?? 2);
  return {
    c: q(c, 0.05),
    ice: q(ice, 0.05),
    aniso: q(1 + 2 * smooth(5, 20, speedMps), 0.25),
    windDeg: q(speedMps > 0.5 ? bearing(u, v) : 90, 10) % 360,
    wave: q(0.4 * clamp((shearPerKm - 2) / 4, 0, 1), 0.05),
    waveDeg: q(Math.hypot(su, sv) > 0 ? bearing(su, sv) : 0, 10) % 360,
    cellKm: q(clamp((thickM / 1000) * lerp(4, 1.3, c), 0.3, 6), 0.1),
  };
}
