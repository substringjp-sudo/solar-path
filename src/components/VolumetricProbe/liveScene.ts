/**
 * liveScene.ts — 앱의 **지금 예보**로 볼륨 장면 입력을 만듭니다(§126 D2).
 *
 * 관측점·시각·캐시된 예보(CloudPathData)에서 그 시각의 관측점 구름(CloudData)을 뽑고, 예보 → 종류 규칙
 * (`cloudGenusForecast.ts`)으로 층별 종류를 정해 `VolumetricSceneInput` 으로 옮깁니다. 시험 화면과 (다음 단계)
 * 하늘 화면이 같은 함수를 씁니다.
 */
import SunCalc from 'suncalc';
import { getInterpolatedWeather, PROFILE_LEVELS, THERMO_RH_LEVELS, type CloudData, type CloudPathData } from '../../utils/weather';
import { classifyGenus, type ForecastGenus, type GenusForecast } from '../../utils/cloudGenusForecast';
import { FALLBACK_ALT_KM, type ProfileLevel } from '../../utils/cloudProfile';
import { GENUS, type GenusKey } from './cloudGenus';
import { flowSeedOf } from './cloudFlow';
import { resolveLayerWinds } from '../../utils/skyColumn';
import { aerosolOpticsFromObs } from '../../utils/sunVisibility';
import { cloudOpticalDepthFromDni } from '../../utils/dniOpticalDepth';
import type { HazeInput, VolumetricLayerInput, VolumetricSceneInput } from './volumetricScene';
import { lclBaseKm, type ThermoInput } from './cloudPhysics';

/**
 * 예보 종류 → 렌더 종류. 아직 렌더에 없는 종류는 가장 가까운 것으로 물러나고(§126 D3 에서 채움),
 * null 은 takram 기본 잡음입니다.
 */
export function renderGenusFor(g: ForecastGenus | null): GenusKey | null {
  return g ?? null;   // §126 D3 부터 예보 종류와 렌더 종류가 같은 이름을 씁니다.
}
/** 적란운 꼭대기 높이(km, 해발) — 중위도 가을 권계면 근처. 아직 예보에서 받지 않아 상수입니다. */
export const CB_TOP_KM = 10;
export const CB_ANVIL_THICK_M = 1500;
/** §139.4 적운(cu) 층 두께 상한(m) — 세포 폭(≈ 1.4 km) 수준. 사용자 눈 판정: 뼈대 후보보다 K0 이 자연스럽고, 남은 결함은 세로로 늘어난 기둥. */
/**
 * §141 덩어리 가로 크기를 층 두께에 맞춤. 종류별 손값(GENUS.spacingKm 또는 생성기 기본값)은 기준 두께(GENUS.height)에서 사진으로 고른
 * 것이라, 예보 덱이 더 두꺼우면 같은 폭의 덩어리를 위로 늘린 꼴이 되어 비스듬히 올려다볼 때 '기둥·버섯'으로 읽힙니다(기기 캡처 10/16
 * 13:33: sc 1.07 km). 두께는 예보값 그대로 두고 칸 간격을 두께 비례로 키웁니다(폭:높이 비 유지). §139.4 의 cu 두께 상한은 이것으로 대체.
 */
const DEFAULT_SPACING_KM: Partial<Record<GenusKey, number>> = { cu: 2.4, sc: 1.8 };
export const aspectSpacingKm = (g: GenusKey, thicknessM: number): number | undefined => {
  const base = GENUS[g].spacingKm ?? DEFAULT_SPACING_KM[g];
  const ref = GENUS[g].height;
  if (base == null || !ref || !(thicknessM > 0)) return undefined;
  return base * clamp(thicknessM / ref, 0.5, 4);
};

/** CloudData 의 기압면 단면 → ProfileLevel[] (PROFILE_LEVELS 순서) */
export function profileOf(obs: CloudData): ProfileLevel[] {
  const hs = obs.profileHeightM, cs = obs.profileCoverPct;
  if (!hs || !cs) return [];
  const out: ProfileLevel[] = [];
  for (let i = 0; i < Math.min(hs.length, cs.length, PROFILE_LEVELS.length); i++) {
    if (Number.isFinite(hs[i]) && Number.isFinite(cs[i])) out.push({ pressureHPa: PROFILE_LEVELS[i], heightM: hs[i], coverPct: cs[i] });
  }
  return out.sort((a, b) => a.heightM - b.heightM);
}

export interface LiveSceneArgs {
  lat: number; lon: number; heightM: number;
  date: Date;
  pathData?: CloudPathData[];
  /** 이미 보간된 관측점 구름(하늘 화면은 이것을 넘김). */
  obs?: CloudData | null;
  /** 이미 보간된 주변 좌표 구름 목록(SkyScene3D의 weatherRef.current). */
  interpolatedWeather?: CloudData[] | null;
  /** 시선 방위(°). 없으면 해 쪽. */
  az?: number;
  el?: number;
  fov?: number;
  altitudeM?: number;
}

export interface LiveScene {
  input: VolumetricSceneInput;
  forecast: GenusForecast | null;
  obs: CloudData | null;
  /** 시험 화면 표시용 한 줄 */
  summary: string;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** §136 관측점 예보의 열역학 입력 → cloudPhysics 형식(기압면 높이·기온이 둘 다 있는 면만). */
export function thermoOf(obs: CloudData, groundM: number): ThermoInput {
  const hs = obs.profileHeightM, ts = obs.profileTempC;
  const levels: ThermoInput['levels'] = [];
  if (hs && ts) {
    for (let i = 0; i < Math.min(hs.length, ts.length, PROFILE_LEVELS.length); i++) {
      if (Number.isFinite(hs[i]) && Number.isFinite(ts[i])) levels.push({ zM: hs[i], tC: ts[i], pHPa: PROFILE_LEVELS[i] });
    }
  }
  // §139 뼈대 입력 — 경계층 높이·CAPE·영하고도·상대습도 단면(기압면 높이는 운량 단면의 같은 기압면에서)·850/600 바람(km/h → m/s)·강수.
  const rhLevels: NonNullable<ThermoInput['rhLevels']> = [];
  if (hs && obs.profileRhPct) {
    THERMO_RH_LEVELS.forEach((p, j) => {
      const i = (PROFILE_LEVELS as readonly number[]).indexOf(p), rh = obs.profileRhPct![j];
      if (i >= 0 && Number.isFinite(hs[i]) && Number.isFinite(rh)) rhLevels.push({ zM: hs[i], rhPct: rh });
    });
  }
  const mps = (u?: number, v?: number): [number, number] | undefined => (u != null && v != null && Number.isFinite(u) && Number.isFinite(v) ? [u / 3.6, v / 3.6] : undefined);
  return {
    groundM, t2mC: obs.t2mC, td2mC: obs.td2mC, levels,
    pblM: obs.pblM, capeJkg: obs.capeJkg, freezingLevelM: obs.freezingLevelM, rhLevels: rhLevels.length ? rhLevels : undefined,
    windLowMps: mps(obs.windULow, obs.windVLow), windMidMps: mps(obs.windUMid, obs.windVMid), precipMm: obs.precipitation,
  };
}

import { buildMacroWeatherField } from '../../utils/macroWeatherField';

/**
 * §146 예보의 에어로졸 → 연무 입력. 대기 표(takram)에는 에어로졸이 거의 없으므로 모형의 기준(HAZE_BACKGROUND_AOD, 사진으로 맞춘 노출·색이
 * 이미 전제한 깨끗한 날 값)을 넘는 만큼만 더합니다. AOD(CAMS)가 없으면 PM, 그것도 없으면 시정으로 환산합니다.
 * 초미세먼지 비중(PM2.5/PM10)이 클수록 Ångström 지수가 크고(푸른빛 산란 → 해가 붉고 하늘이 누런 회색) 앞산란이 약하며,
 * 먼지·조대 입자가 많으면 지수가 작고(하얗게 흐림) 해 둘레가 넓게 번집니다.
 */
export const HAZE_BACKGROUND_AOD = 0.12;
/** §157 DNI 광학두께 문턱: 이 위면 상층 100 % 를 권운이 아닌 시트(cs)로, 더 두꺼우면 중층도 고층운(as)으로. */
export const DNI_VEIL_TAU = 1.5;
export const DNI_SHEET_TAU = 3;
export const DNI_VEIL_MAX_DENSITY = 0.07;
export function hazeFromObs(o: { aod550?: number; pm25?: number; pm10?: number; dust?: number; visibility?: number }): HazeInput | undefined {
  const op = aerosolOpticsFromObs(o);
  if (!op) return undefined;
  const extra = op.aod - HAZE_BACKGROUND_AOD;
  if (extra < 0.02) return undefined;
  return { aod: Math.min(3, extra), alpha: op.alpha, g: op.g, omega: op.omega };
}

export function buildLiveScene(a: LiveSceneArgs): LiveScene {
  const sun = SunCalc.getPosition(a.date, a.lat, a.lon);
  const sunAz = ((sun.azimuth * 180) / Math.PI + 180 + 360) % 360;
  const sunAltDeg = (sun.altitude * 180) / Math.PI;
  const obs = a.obs ?? (a.interpolatedWeather?.[0] ?? (a.pathData?.length ? getInterpolatedWeather(a.pathData, a.date)[0] ?? null : null));
  const base: VolumetricSceneInput = {
    lat: a.lat, lon: a.lon, heightM: a.heightM, date: a.date,
    az: a.az ?? sunAz, el: a.el ?? 15, fov: a.fov ?? 60,
    altitudeM: a.altitudeM,
    layers: [],
  };
  if (!obs) return { input: base, forecast: null, obs: null, summary: '예보 없음' };

  // §132 거시 상태장: 주변 10여개 좌표로부터 동서/남북 1차 운량 기울기와 해 방향 직달광 차폐율 계산
  const interpolatedList = (a.interpolatedWeather && a.interpolatedWeather.length > 1)
    ? a.interpolatedWeather
    : (a.pathData?.length ? getInterpolatedWeather(a.pathData, a.date) : [obs]);
  const macro = buildMacroWeatherField(interpolatedList, sunAz, sunAltDeg);

  const forecast = classifyGenus({
    low: obs.low, mid: obs.mid, high: obs.high,
    profile: profileOf(obs), groundM: a.heightM,
    precipitationMm: obs.precipitation, humidityPct: obs.humidity,
    isDay: sunAltDeg > 0,
  });

  // §130 층별 바람(부는 방향 성분, km/h, 동·북) — 예보 기압면 바람(850/600/250 hPa)이 있으면 그것, 없으면 대용값(skyColumn).
  // 5 km/h 눈금, 전단 방향 10° 눈금으로 묶습니다 — 10분 예보 보간마다 날씨 타일(수 초)을 다시 만들지 않게. 흐름 시드는 자리·날짜 해시.
  const { winds } = resolveLayerWinds(obs);
  const q5 = (v: number) => Math.round(v / 5) * 5;
  const windOf = (band: 'low' | 'mid' | 'high'): [number, number] => {
    const u = band === 'low' ? obs.windULow : band === 'mid' ? obs.windUMid : obs.windUHigh;
    const v = band === 'low' ? obs.windVLow : band === 'mid' ? obs.windVMid : obs.windVHigh;
    if (u != null && v != null && Number.isFinite(u) && Number.isFinite(v)) return [u, v];
    const w = winds[band], to = ((w.bearingDeg + 180) * Math.PI) / 180;   // bearing 은 불어오는 쪽
    return [w.speedKmh * Math.sin(to), w.speedKmh * Math.cos(to)];
  };
  const W = { low: windOf('low'), mid: windOf('mid'), high: windOf('high') };
  const shearOf = (band: 'low' | 'mid' | 'high'): [number, number] => {
    const [au, av] = band === 'low' ? W.mid : W.high, [bu, bv] = band === 'low' ? W.low : W.mid;
    const su = au - bu, sv = av - bv, m = Math.hypot(su, sv);
    if (m < 1e-6) return [0, 0];
    const ang = ((Math.round((Math.atan2(su, sv) * 180) / Math.PI / 10) * 10) * Math.PI) / 180, mq = q5(m);
    return [mq * Math.sin(ang), mq * Math.cos(ang)];
  };
  const flowSeed = flowSeedOf(a.lat, a.lon, a.date);
  const flowOpts = (band: 'low' | 'mid' | 'high') => {
    const [u, v] = W[band], [su, sv] = shearOf(band);
    const mGrad = macro[band];
    return {
      windU: q5(u), windV: q5(v), shearU: su, shearV: sv, flowSeed,
      macroGradX: mGrad?.gradXPer100Km ?? 0,
      macroGradY: mGrad?.gradYPer100Km ?? 0,
      beamTransmittance: macro.beamTransmittance[band] ?? 1,
      sunGap: macro.sunGap,
    };
  };

  const layers: VolumetricLayerInput[] = [];
  let anvil: VolumetricLayerInput | null = null;
  /**
   * §157 직달일사(DNI)가 말하는 구름 두께. 운량 규칙은 상층 100 % 를 얇은 권운으로, 중층을 고적운으로 그리는데 DNI 가 맑은 날의 5 % 아래면
   * (해가 가려짐) 그 층은 두꺼운 **시트**입니다 — 상층 ci → cs(소광을 τ 에 맞춤), 중층 ac → as. 10/24 서울 "상층 100 %·DNI 29 W/m²"
   * 가 맑게 그려진 일에서. 하네스로 잰 cs 소광 ↔ 아래에서 본 불투명도: τ_render ≈ 57 × densityScale(1000 m 층) → densityScale = τ/57.
   */
  const tauDni = cloudOpticalDepthFromDni(obs.directNormalIrradiance, sunAltDeg, obs.aod550);
  const thickVeil = tauDni != null && tauDni >= DNI_VEIL_TAU;
  const promoteHigh = thickVeil && forecast.high === 'ci' && obs.high >= 80;
  // 상층이 두꺼운 시트를 다 맡으면 중층은 그대로; 상층이 모자라면(80 % 미만) 중층 50 % 이상을 고층운으로.
  const promoteMid = thickVeil && tauDni! >= DNI_SHEET_TAU && forecast.mid === 'ac' && obs.mid >= 50 && !(promoteHigh && obs.high >= 95);
  // §136 적운류 밑면 = 지면 + 응결고도(물리를 켰을 때만 volumetricScene 이 씀). 지상 이슬점이 없으면 없음.
  const thermo = thermoOf(obs, a.heightM);
  const lclKm = lclBaseKm(thermo);
  // 저층: 단면 덱이 있으면 밑면·두께를 그대로, 없으면 층 높이(가운데)에서 두께의 반을 뺀 밑면.
  if (obs.low > 0) {
    const thick = forecast.lowBaseKm != null && forecast.lowTopKm != null ? (forecast.lowTopKm - forecast.lowBaseKm) * 1000 : NaN;
    const thicknessM = Number.isFinite(thick) ? clamp(thick, 300, 3000) : undefined;
    const centerKm = obs.layerAltLowKm ?? FALLBACK_ALT_KM.low;
    const baseKm = forecast.lowBaseKm ?? Math.max(a.heightM / 1000 + 0.2, centerKm - (thicknessM ?? 1200) / 2000);
    if (forecast.low === 'cb') {
      // 적란운: 탑은 밑면~권계면 한 층, 모루는 4번째 채널에 같은 씨앗으로 — 바람 방향은 중층 바람.
      const topKm = Math.max(baseKm + 4, CB_TOP_KM);
      const windDeg = obs.windUMid != null && obs.windVMid != null ? ((Math.atan2(obs.windUMid, obs.windVMid) * 180) / Math.PI + 360) % 360 : 30;
      const opts = { seed: 7, windDeg, ...flowOpts('low') };
      layers.push({ genus: 'cb', cover: obs.low / 100, baseKm, thicknessM: (topKm - baseKm) * 1000, band: 'low', opts, physBaseKm: lclKm ?? undefined });
      anvil = { genus: 'cbanvil', cover: 1, baseKm: topKm - CB_ANVIL_THICK_M / 1000 * 0.8, thicknessM: CB_ANVIL_THICK_M, band: 'high', opts };
    } else if (forecast.low === 'cg') {
      layers.push({ genus: 'cg', cover: obs.low / 100, baseKm, thicknessM: Math.max(thicknessM ?? 0, 2500), band: 'low', opts: flowOpts('low'), physBaseKm: lclKm ?? undefined });
    } else {
      const g = renderGenusFor(forecast.low);
      // §141 적운·층적운은 두께를 예보 덱 그대로 쓰고 덩어리 가로 크기를 두께에 비례시킴(§139.4 의 cu 두께 상한 1000 m 를 대체).
      const spacingKm = g === 'cu' || g === 'sc' ? aspectSpacingKm(g, thicknessM ?? GENUS[g].height) : undefined;
      // §144·§147 층운(st)·난층운(ns)은 운량 보정표가 없어 예보 84% 가 화면 21~30%(머리 위)로 그려졌음 — 덮임 80% 이상이면 구름 한 장(관측 용어 '흐림')으로 그림.
      const lowCover = (g === 'st' || g === 'ns') && obs.low >= 80 ? Math.max(obs.low / 100, 0.99) : obs.low / 100;
      layers.push({ genus: g, cover: lowCover, baseKm, thicknessM: thicknessM, band: 'low', opts: { ...flowOpts('low'), ...(spacingKm != null ? { spacingKm } : {}) }, physBaseKm: g === 'cu' ? lclKm ?? undefined : undefined });
    }
  } else layers.push({ genus: null, cover: 0, baseKm: FALLBACK_ALT_KM.low, band: 'low' });
  if (obs.mid > 0) {
    const centerKm = obs.layerAltMidKm ?? FALLBACK_ALT_KM.mid;
    const midGenus = promoteMid ? 'as' : renderGenusFor(forecast.mid);
    layers.push({ genus: midGenus, cover: midGenus === 'as' && obs.mid >= 80 ? Math.max(obs.mid / 100, 0.99) : obs.mid / 100, baseKm: Math.max(2.2, centerKm - 0.3), band: 'mid', opts: flowOpts('mid') });
  } else layers.push({ genus: null, cover: 0, baseKm: FALLBACK_ALT_KM.mid, band: 'mid' });
  if (obs.high > 0) {
    const centerKm = obs.layerAltHighKm ?? FALLBACK_ALT_KM.high;
    if (promoteHigh) {
      const densityScale = Math.min(DNI_VEIL_MAX_DENSITY, Math.max(0.0015, tauDni! / 57));
      layers.push({ genus: 'cs', cover: Math.max(obs.high / 100, 0.99), baseKm: Math.max(7.2, centerKm - 0.2), band: 'high', opts: { ...flowOpts('high'), densityScale, ao: 1.5 } });
    } else {
      layers.push({ genus: renderGenusFor(forecast.high), cover: obs.high / 100, baseKm: Math.max(7.2, centerKm - 0.2), band: 'high', opts: flowOpts('high') });
    }
  } else layers.push({ genus: null, cover: 0, baseKm: FALLBACK_ALT_KM.high, band: 'high' });

  if (anvil) layers.push(anvil);
  const name = (g: ForecastGenus | null, cover: number) => (g ? `${g} ${Math.round(cover)}%` : '—');
  const beamPct = Math.round((macro.beamTransmittance.low * 0.5 + macro.beamTransmittance.mid * 0.5) * 100);
  const summary = `저 ${name(forecast.low, obs.low)} · 중 ${name(promoteMid ? 'as' : forecast.mid, obs.mid)} · 상 ${name(promoteHigh ? 'cs' : forecast.high, obs.high)} · 해 ${sunAltDeg.toFixed(1)}° · 빔 ${beamPct}%${tauDni != null ? ` · τ ${tauDni.toFixed(1)}` : ''}`;
  const haze = hazeFromObs(obs);
  // §156 거시 운량 격자 입력 — 고리 점들의 층별 운량(관측점 포함). 고리가 없으면(관측점 하나) 넣지 않음.
  const ringPts = interpolatedList.filter(q => Number.isFinite(q.distance) && Number.isFinite(q.azimuthOffset));
  const macroRing = ringPts.length >= 20 ? {
    low: ringPts.map(q => ({ distance: q.distance ?? 0, azimuthOffset: q.azimuthOffset ?? 0, cover: Math.min(1, Math.max(0, (q.low ?? 0) / 100)) })),
    mid: ringPts.map(q => ({ distance: q.distance ?? 0, azimuthOffset: q.azimuthOffset ?? 0, cover: Math.min(1, Math.max(0, (q.mid ?? 0) / 100)) })),
    high: ringPts.map(q => ({ distance: q.distance ?? 0, azimuthOffset: q.azimuthOffset ?? 0, cover: Math.min(1, Math.max(0, (q.high ?? 0) / 100)) })),
  } : undefined;
  return { input: { ...base, layers, thermo, ...(haze ? { haze } : {}), ...(macroRing ? { macro: macroRing } : {}) }, forecast, obs, summary };
}
