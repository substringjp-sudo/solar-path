/**
 * liveScene.ts — 앱의 **지금 예보**로 볼륨 장면 입력을 만듭니다(§126 D2).
 *
 * 관측점·시각·캐시된 예보(CloudPathData)에서 그 시각의 관측점 구름(CloudData)을 뽑고, 예보 → 종류 규칙
 * (`cloudGenusForecast.ts`)으로 층별 종류를 정해 `VolumetricSceneInput` 으로 옮깁니다. 시험 화면과 (다음 단계)
 * 하늘 화면이 같은 함수를 씁니다.
 */
import SunCalc from 'suncalc';
import { getInterpolatedWeather, PROFILE_LEVELS, type CloudData, type CloudPathData } from '../../utils/weather';
import { classifyGenus, type ForecastGenus, type GenusForecast } from '../../utils/cloudGenusForecast';
import { FALLBACK_ALT_KM, type ProfileLevel } from '../../utils/cloudProfile';
import type { GenusKey } from './cloudGenus';
import { flowSeedOf } from './cloudFlow';
import { resolveLayerWinds } from '../../utils/skyColumn';
import type { VolumetricLayerInput, VolumetricSceneInput } from './volumetricScene';

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
  pathData: CloudPathData[];
  /** 이미 보간된 관측점 구름(하늘 화면은 이것을 넘김). 있으면 pathData 는 쓰지 않습니다. */
  obs?: CloudData | null;
  /** 시선 방위(°). 없으면 해 쪽. */
  az?: number;
  el?: number;
  fov?: number;
}

export interface LiveScene {
  input: VolumetricSceneInput;
  forecast: GenusForecast | null;
  obs: CloudData | null;
  /** 시험 화면 표시용 한 줄 */
  summary: string;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function buildLiveScene(a: LiveSceneArgs): LiveScene {
  const sun = SunCalc.getPosition(a.date, a.lat, a.lon);
  const sunAz = ((sun.azimuth * 180) / Math.PI + 180 + 360) % 360;
  const sunAltDeg = (sun.altitude * 180) / Math.PI;
  const obs = a.obs ?? (a.pathData.length ? getInterpolatedWeather(a.pathData, a.date)[0] ?? null : null);
  const base: VolumetricSceneInput = {
    lat: a.lat, lon: a.lon, heightM: a.heightM, date: a.date,
    az: a.az ?? sunAz, el: a.el ?? 15, fov: a.fov ?? 60, layers: [],
  };
  if (!obs) return { input: base, forecast: null, obs: null, summary: '예보 없음' };

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
    return { windU: q5(u), windV: q5(v), shearU: su, shearV: sv, flowSeed };
  };

  const layers: VolumetricLayerInput[] = [];
  let anvil: VolumetricLayerInput | null = null;
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
      layers.push({ genus: 'cb', cover: obs.low / 100, baseKm, thicknessM: (topKm - baseKm) * 1000, band: 'low', opts });
      anvil = { genus: 'cbanvil', cover: 1, baseKm: topKm - CB_ANVIL_THICK_M / 1000 * 0.8, thicknessM: CB_ANVIL_THICK_M, band: 'high', opts };
    } else if (forecast.low === 'cg') {
      layers.push({ genus: 'cg', cover: obs.low / 100, baseKm, thicknessM: Math.max(thicknessM ?? 0, 2500), band: 'low', opts: flowOpts('low') });
    } else layers.push({ genus: renderGenusFor(forecast.low), cover: obs.low / 100, baseKm, thicknessM, band: 'low', opts: flowOpts('low') });
  } else layers.push({ genus: null, cover: 0, baseKm: FALLBACK_ALT_KM.low, band: 'low' });
  if (obs.mid > 0) {
    const centerKm = obs.layerAltMidKm ?? FALLBACK_ALT_KM.mid;
    layers.push({ genus: renderGenusFor(forecast.mid), cover: obs.mid / 100, baseKm: Math.max(2.2, centerKm - 0.3), band: 'mid', opts: flowOpts('mid') });
  } else layers.push({ genus: null, cover: 0, baseKm: FALLBACK_ALT_KM.mid, band: 'mid' });
  if (obs.high > 0) {
    const centerKm = obs.layerAltHighKm ?? FALLBACK_ALT_KM.high;
    layers.push({ genus: renderGenusFor(forecast.high), cover: obs.high / 100, baseKm: Math.max(7.2, centerKm - 0.2), band: 'high', opts: flowOpts('high') });
  } else layers.push({ genus: null, cover: 0, baseKm: FALLBACK_ALT_KM.high, band: 'high' });

  if (anvil) layers.push(anvil);
  const name = (g: ForecastGenus | null, cover: number) => (g ? `${g} ${Math.round(cover)}%` : '—');
  const summary = `저 ${name(forecast.low, obs.low)} · 중 ${name(forecast.mid, obs.mid)} · 상 ${name(forecast.high, obs.high)} · 해 ${sunAltDeg.toFixed(1)}°`;
  return { input: { ...base, layers }, forecast, obs, summary };
}
