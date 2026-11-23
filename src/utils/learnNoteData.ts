/**
 * learnNoteData.ts — 데이터 페이지("하늘 읽는 노트") 시각화 및 요약용 순수 계산 모음.
 *
 * 목업과 같은 시각 구성을 유지하되 하드코딩 수치 없이 실제 Open-Meteo 예보 · DEM 지평선 · 천문 계산을 그대로 씁니다.
 */
import SunCalc from 'suncalc';
import { getInterpolatedWeather, type CloudData, type CloudPathData } from './weather';
import { alignRingToSun } from './sunsetPhysics';
import { sunPosition } from './solarPosition';
import { getMoonPositionPrecise, moonRiseSet } from './moonPosition';
import { scenePrediction } from './scenePrediction';
import { starLimit, NELM_DARK } from './starVisibility';
import { hourlyCovers, starWeatherOf, starTimeFor } from './starTonight';
import { sunLineProfile, sunLineGap, type SkyMap, type SkyMapCell } from './calcSteps';
import type { ForecastDay, ForecastEvent } from './sunForecast';
import { L3, type Language } from './i18n';
import { skyDirection } from './skyWords';
import { moonPhaseWord, type UpcomingTimelineEvent } from './timeBriefing';

const DEG = 180 / Math.PI;
const HOUR_MS = 3_600_000;

export const fmtLocalHHMM = (ms: number, tzHours: number): string => {
  if (!Number.isFinite(ms)) return '--:--';
  return new Date(ms + tzHours * HOUR_MS).toISOString().slice(11, 16);
};

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const cover3 = (low: number, mid: number, high: number) =>
  1 - (1 - clamp(low, 0, 100) / 100) * (1 - clamp(mid, 0, 100) / 100) * (1 - clamp(high, 0, 100) / 100);

const totalCloudOf = (o: CloudData | undefined | null): number | null => {
  if (!o) return null;
  if (typeof o.total === 'number' && Number.isFinite(o.total)) return Math.round(clamp(o.total, 0, 100));
  const vals = [o.low, o.mid, o.high].filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  return vals.length ? Math.round(clamp(Math.max(...vals), 0, 100)) : null;
};

const hourlyTimeMs = (p: CloudPathData): ArrayLike<number> | null => {
  const h = p?.hourly as { timeMs?: number[]; time?: string[] } | undefined;
  if (!h) return null;
  if (Array.isArray(h.timeMs) && h.timeMs.length > 0) return h.timeMs;
  if (Array.isArray(h.time) && h.time.length > 0) return h.time.map(s => new Date(s).getTime());
  return null;
};

// ── 1. 지금 시각 360° 구름 지도 + 해 쪽 빛 통로 ───────────────────────────

export interface LiveSkyMapSummary {
  map: SkyMap;
  sunAzDeg: number;
  gap: { fromKm: number; toKm: number } | null;
  summaryText: string;
}

export function buildLiveSkyMap(
  path: CloudPathData[] | null,
  when: Date,
  lat: number,
  lon: number,
  language: Language,
): LiveSkyMapSummary | null {
  if (!path?.length) return null;
  const tMs = when.getTime();
  const times = hourlyTimeMs(path[0]);
  if (times && !hourlyCovers(times, tMs)) return null;

  const sunAzDeg = ((sunPosition(when, lat, lon).azimuth * DEG + 180) % 360 + 360) % 360;
  const aligned = alignRingToSun(getInterpolatedWeather(path, when), sunAzDeg);
  const cells: SkyMapCell[] = aligned
    .filter(p => p.distance > 0)
    .map(p => ({
      distKm: p.distance,
      azDeg: (((sunAzDeg + p.azimuthOffset) % 360) + 360) % 360,
      cover: cover3(p.low, p.mid, p.high),
      low: p.low,
      mid: p.mid,
      high: p.high,
    }));
  if (cells.length === 0) return null;

  const ringsKm = [...new Set(cells.map(c => c.distKm))].sort((a, b) => a - b);
  const maxKm = ringsKm[ringsKm.length - 1] ?? 200;
  const sunLine = sunLineProfile(aligned);
  const gap = sunLineGap(sunLine);
  const sunDir = skyDirection(sunAzDeg, language) ?? `${Math.round(sunAzDeg)}°`;

  const obs = aligned.find(p => p.distance === 0);
  const overhead = obs ? cover3(obs.low, obs.mid, obs.high) : 0;

  let summaryText: string;
  if (gap) {
    summaryText = L3(
      language,
      `${sunDir} ${gap.fromKm}~${gap.toKm}km에 구름 틈 — 낮은 햇빛이 구름 밑면에 닿을 통로`,
      `Cloud gap ${gap.fromKm}–${gap.toKm} km toward ${sunDir} — path for low sunlight onto cloud bases`,
      `${sunDir} ${gap.fromKm}〜${gap.toKm}kmに雲の切れ間 — 低い陽光が雲底に届く通路`,
    );
  } else if (overhead < 0.25) {
    summaryText = L3(
      language,
      `머리 위와 ${sunDir} 해 쪽 하늘이 비교적 트여 있음`,
      `Sky overhead and toward ${sunDir} is relatively clear`,
      `頭上と${sunDir}の太陽側の空が比較的開けています`,
    );
  } else {
    summaryText = L3(
      language,
      `${sunDir} 해 쪽 경로에 구름이 이어져 틈이 좁음`,
      `Continuous clouds toward ${sunDir} leave few openings`,
      `${sunDir}の太陽方向に雲が連なり切れ間が少なめ`,
    );
  }

  return {
    map: { maxKm, ringsKm, cells, sunAzDeg, sunLine },
    sunAzDeg,
    gap,
    summaryText,
  };
}

// ── 2. 지난 6시간 구름 추세 스파크라인 ───────────────────────────────────

export interface CloudTrend6h {
  startPct: number;
  endPct: number;
  deltaPct: number;
  points: number[];
  trendWord: string;
}

export function buildCloudTrend6h(
  path: CloudPathData[] | null,
  whenMs: number,
  language: Language,
): CloudTrend6h | null {
  if (!path?.length) return null;
  const times = hourlyTimeMs(path[0]);
  if (!times || !hourlyCovers(times, whenMs - 6 * HOUR_MS) || !hourlyCovers(times, whenMs)) return null;

  const points: number[] = [];
  for (let h = -6; h <= 0; h++) {
    const obs = getInterpolatedWeather(path, new Date(whenMs + h * HOUR_MS))[0];
    const tot = totalCloudOf(obs);
    if (tot == null) return null;
    points.push(tot);
  }
  const startPct = points[0];
  const endPct = points[points.length - 1];
  const deltaPct = endPct - startPct;
  const trendWord =
    deltaPct >= 10
      ? L3(language, '↗ 늘어남', '↗ increasing', '↗ 増加')
      : deltaPct <= -10
        ? L3(language, '↘ 개는 중', '↘ clearing', '↘ 晴れ傾向')
        : L3(language, '→ 비슷함', '→ steady', '→ 横ばい');
  return { startPct, endPct, deltaPct, points, trendWord };
}

// ── 3. 달 · 행성 컴팩트 요약 ─────────────────────────────────────────────

export interface MoonStripInfo {
  fraction: number;
  phase: number;
  pct: number;
  name: string;
  altDeg: number;
  dir: string;
  riseLabel: string | null;
  setLabel: string | null;
}

export function buildMoonStripInfo(
  when: Date,
  lat: number,
  lon: number,
  elevM: number,
  tzHours: number,
  language: Language,
): MoonStripInfo {
  const pos = getMoonPositionPrecise(when, lat, lon, elevM);
  const altDeg = Math.round(pos.altitude * DEG);
  const azDeg = ((pos.azimuth * DEG + 180) % 360 + 360) % 360;
  const illum = SunCalc.getMoonIllumination(when);
  const pct = Math.round(illum.fraction * 100);
  const rs = moonRiseSet(when.getTime() - 2 * HOUR_MS, lat, lon, 26, elevM);

  return {
    fraction: illum.fraction,
    phase: illum.phase,
    pct,
    name: moonPhaseWord(illum.phase, illum.fraction, language),
    altDeg,
    dir: skyDirection(azDeg, language) ?? '',
    riseLabel: rs.rise ? fmtLocalHHMM(rs.rise.getTime(), tzHours) : null,
    setLabel: rs.set ? fmtLocalHHMM(rs.set.getTime(), tzHours) : null,
  };
}

// ── 4. 지금 구역: 노을 점수 & 별 한계등급 원형 게이지용 ─────────────────────

export interface StarGaugeSummary {
  limitMag: number;
  starScore: number;
  isDaylight: boolean;
  subLabel: string;
}

export function buildStarGaugeSummary(
  path: CloudPathData[] | null,
  when: Date,
  lat: number,
  lon: number,
  elevM: number,
  lightPollutionMag: number | null,
  language: Language,
): StarGaugeSummary {
  const sunAltDeg = sunPosition(when, lat, lon).altitude * DEG;
  const isDaylight = sunAltDeg > -6;
  const targetTime = isDaylight ? starTimeFor(when, lat, lon) : when;
  const obs = path?.length ? getInterpolatedWeather(path, targetTime)[0] : undefined;
  const starW = obs ? starWeatherOf(obs) : null;
  const moonPos = getMoonPositionPrecise(targetTime, lat, lon, elevM);
  const moonIllum = SunCalc.getMoonIllumination(targetTime).fraction;

  const limit = starLimit({
    cloudPct: starW?.cloudPct ?? 0,
    sunAltDeg: sunPosition(targetTime, lat, lon).altitude * DEG,
    moonAltDeg: moonPos.altitude * DEG,
    moonIllum,
    lightPollutionMag: lightPollutionMag ?? null,
    aod550: starW?.aod550,
    visibilityM: starW?.visibilityM,
    humidityPct: starW?.humidityPct,
    pm25: starW?.pm25,
  });

  const limitMag = Math.round(limit.limitMag * 10) / 10;
  const starScore = Math.round(clamp(limit.limitMag / NELM_DARK, 0, 1) * limit.cloud.clearFraction * 100);
  const subLabel = isDaylight
    ? L3(language, `오늘 밤 구름 포함 ${starScore}점`, `Tonight ${starScore} pts w/ clouds`, `今夜雲込み${starScore}点`)
    : L3(language, `구름 포함 ${starScore}점`, `${starScore} pts w/ clouds`, `雲込み${starScore}点`);

  return { limitMag, starScore, isDaylight, subLabel };
}

// ── 5. 4종 기준 띠 3색 게이지 ────────────────────────────────────────────

export interface GaugeBandSpec {
  id: 'cloud' | 'vis' | 'rh' | 'dew';
  name: string;
  sub: string;
  max: number;
  value: number | null;
  valueLabel: string;
  segs: ReadonlyArray<{ from: number; to: number; tone: 'good' | 'mid' | 'bad' }>;
  ticks: readonly string[];
  read: string;
}

export function buildComfortGauges(obs: CloudData | undefined | null, language: Language): GaugeBandSpec[] {
  const cloud = totalCloudOf(obs);
  const visKm = obs && typeof obs.visibility === 'number' && Number.isFinite(obs.visibility)
    ? obs.visibility / 1000
    : null;
  const rh = obs && typeof obs.humidity === 'number' && Number.isFinite(obs.humidity)
    ? Math.round(obs.humidity)
    : null;
  const dewSpread =
    obs &&
    typeof obs.t2mC === 'number' &&
    typeof obs.td2mC === 'number' &&
    Number.isFinite(obs.t2mC) &&
    Number.isFinite(obs.td2mC)
      ? Math.max(0, obs.t2mC - obs.td2mC)
      : null;

  const cloudRead =
    cloud == null
      ? L3(language, '구름 예보 자료가 없음.', 'No cloud data.', '雲の予報データなし。')
      : cloud <= 30
        ? L3(language, `${cloud}%로 맑은 편. 노을·별 모두 유리.`, `${cloud}% clear sky. Good for glow & stars.`, `${cloud}%で晴れ。夕焼け・星ともに良好。`)
        : cloud <= 70
          ? L3(language, `${cloud}% 구름. 틈 위치에 따라 명암이 갈림.`, `${cloud}% cloud. Contrast depends on gaps.`, `${cloud}%の雲。切れ間次第で色づきが変化。`)
          : L3(language, `${cloud}% 두터움. 노을은 30% 아래가 좋음.`, `${cloud}% overcast. Below 30% is ideal.`, `${cloud}%と厚め。30%以下が好適。`);

  const visRead =
    visKm == null
      ? L3(language, '시정 자료 없음.', 'No visibility data.', '視程データなし。')
      : visKm >= 20
        ? L3(language, `${visKm.toFixed(1)}km 매우 투명. 먼 산능선 선명.`, `${visKm.toFixed(1)} km very clear. Distant ridges sharp.`, `${visKm.toFixed(1)}km 非常に澄み遠景くっきり。`)
        : visKm >= 10
          ? L3(language, `${visKm.toFixed(1)}km 보통. 20km 넘으면 먼 능선 선명.`, `${visKm.toFixed(1)} km moderate. Clear ridges above 20 km.`, `${visKm.toFixed(1)}km 普通。20km超で遠景鮮明。`)
          : L3(language, `${visKm.toFixed(1)}km 뿌연 편. 연무·습기 주의.`, `${visKm.toFixed(1)} km hazy. Dust or moisture scattering.`, `${visKm.toFixed(1)}km やや霞み。靄に注意。`);

  const rhRead =
    rh == null
      ? L3(language, '습도 자료 없음.', 'No humidity data.', '湿度データなし。')
      : rh <= 60
        ? L3(language, `${rh}% 쾌적. 산란·탁함 적음.`, `${rh}% dry. Crisp air and low haze.`, `${rh}% 乾燥。澄んだ色が出やすい。`)
        : rh <= 85
          ? L3(language, `${rh}% 약간 높음. 85% 넘으면 뿌옇게 보임.`, `${rh}% slightly humid. Hazy above 85%.`, `${rh}% やや高め。85%超で霞みやすい。`)
          : L3(language, `${rh}% 매우 습함. 렌즈 결로·박무 주의.`, `${rh}% very humid. Watch for haze and dew.`, `${rh}% 高湿度。靄・結露に注意。`);

  const dewRead =
    dewSpread == null
      ? L3(language, '기온/이슬점 자료 없음.', 'No temp/dew point data.', '気温・露点データなし。')
      : dewSpread <= 2
        ? L3(language, `차이 ${dewSpread.toFixed(1)}°C. 안개·결로 위험. 렌즈 닦을 천 필요.`, `${dewSpread.toFixed(1)}°C spread. High fog/dew risk on lens.`, `差${dewSpread.toFixed(1)}°C。霧・レンズ結露に注意。`)
        : dewSpread <= 5
          ? L3(language, `차이 ${dewSpread.toFixed(1)}°C 보통. 새벽 야외엔 결로 주의.`, `${dewSpread.toFixed(1)}°C spread. Moderate; watch dawn dew.`, `差${dewSpread.toFixed(1)}°C 普通。早朝は結露に注意。`)
          : L3(language, `차이 ${dewSpread.toFixed(1)}°C 여유. 안개·이슬 걱정 적음.`, `${dewSpread.toFixed(1)}°C spread. Low risk of fog or dew.`, `差${dewSpread.toFixed(1)}°C 十分。霧や結露の心配少。`);

  return [
    {
      id: 'cloud',
      name: L3(language, '구름', 'Cloud', '雲量'),
      sub: L3(language, '총운량', 'Total', '全雲量'),
      max: 100,
      value: cloud,
      valueLabel: cloud != null ? `${cloud}%` : '—',
      segs: [
        { from: 0, to: 30, tone: 'good' },
        { from: 30, to: 70, tone: 'mid' },
        { from: 70, to: 100, tone: 'bad' },
      ],
      ticks: ['0', '30', '70', '100'],
      read: cloudRead,
    },
    {
      id: 'vis',
      name: L3(language, '시정', 'Visibility', '視程'),
      sub: L3(language, '투명도', 'Clarity', '透明度'),
      max: 40,
      value: visKm != null ? clamp(visKm, 0, 40) : null,
      valueLabel: visKm != null ? `${visKm.toFixed(1)}km` : '—',
      segs: [
        { from: 0, to: 10, tone: 'bad' },
        { from: 10, to: 20, tone: 'mid' },
        { from: 20, to: 40, tone: 'good' },
      ],
      ticks: ['0', '10', '20', '40km'],
      read: visRead,
    },
    {
      id: 'rh',
      name: L3(language, '습도', 'Humidity', '湿度'),
      sub: L3(language, '지면', 'Surface', '地表'),
      max: 100,
      value: rh,
      valueLabel: rh != null ? `${rh}%` : '—',
      segs: [
        { from: 0, to: 60, tone: 'good' },
        { from: 60, to: 85, tone: 'mid' },
        { from: 85, to: 100, tone: 'bad' },
      ],
      ticks: ['0', '60', '85', '100'],
      read: rhRead,
    },
    {
      id: 'dew',
      name: L3(language, '이슬점 차', 'Dew diff', '露点差'),
      sub: L3(language, '안개·결로', 'Fog/Dew', '霧・結露'),
      max: 10,
      value: dewSpread != null ? clamp(dewSpread, 0, 10) : null,
      valueLabel: dewSpread != null ? `${dewSpread.toFixed(1)}°C` : '—',
      segs: [
        { from: 0, to: 2, tone: 'bad' },
        { from: 2, to: 5, tone: 'mid' },
        { from: 5, to: 10, tone: 'good' },
      ],
      ticks: ['0', '2', '5', '10°C'],
      read: dewRead,
    },
  ];
}

// ── 6. 24시간 타임라인(-6h ~ +24h) 차트 데이터 ─────────────────────────────

export interface TimelineSample {
  tRel: number;
  timeMs: number;
  phase: 'day' | 'dusk' | 'night';
  sunsetScore: number;
  starScore: number;
  low: number;
  mid: number;
  high: number;
}

export interface TimelineMarker {
  index: number;
  tRel: number;
  event: UpcomingTimelineEvent;
}

export interface Timeline24hChartData {
  baseMs: number;
  samples: TimelineSample[];
  markers: TimelineMarker[];
  bestSummary: string | null;
  peakLabel: string | null;
  peakTRel: number | null;
  peakScore: number | null;
  axisTicks: Array<{ tRel: number; label: string }>;
}

export function buildTimeline24hData(args: {
  baseMs: number;
  tzHours: number;
  lat: number;
  lon: number;
  elevM: number;
  ringFor: (d: Date) => CloudPathData[] | null;
  forecast: CloudPathData[] | null;
  lightPollutionMag: number | null;
  events: UpcomingTimelineEvent[];
  language: Language;
}): Timeline24hChartData {
  const { baseMs, tzHours, lat, lon, elevM, ringFor, forecast, lightPollutionMag, events, language } = args;
  const samples: TimelineSample[] = [];

  for (let h = -6; h <= 24; h += 0.5) {
    const timeMs = baseMs + h * HOUR_MS;
    const d = new Date(timeMs);
    const sp = sunPosition(d, lat, lon);
    const sunAltDeg = sp.altitude * DEG;
    const sunAzDeg = ((sp.azimuth * DEG + 180) % 360 + 360) % 360;
    const phase: TimelineSample['phase'] = sunAltDeg >= 0 ? 'day' : sunAltDeg >= -18 ? 'dusk' : 'night';

    const ring = ringFor(d);
    const path = ring && ring.length > 0 && !ring[0]?.isFallback ? ring : forecast;
    const times = path?.length ? hourlyTimeMs(path[0]) : null;
    const hasCov = !!path?.length && (!times || hourlyCovers(times, timeMs));
    const obs = hasCov ? getInterpolatedWeather(path!, d)[0] : undefined;

    let sunsetScore = 0;
    if (obs && path && sunAltDeg >= -7 && sunAltDeg <= 12) {
      const pred = scenePrediction({ pathData: path, time: d, sunAltDeg, sunAzDeg, obs, latitude: lat, observerElevM: elevM });
      if (pred && Number.isFinite(pred.score)) sunsetScore = clamp(pred.score, 0, 100);
    }

    let starScore = 0;
    if (sunAltDeg < -6) {
      const moonPos = getMoonPositionPrecise(d, lat, lon, elevM);
      const moonIllum = SunCalc.getMoonIllumination(d).fraction;
      const starW = obs ? starWeatherOf(obs) : null;
      const st = starLimit({
        cloudPct: starW?.cloudPct ?? 0,
        sunAltDeg,
        moonAltDeg: moonPos.altitude * DEG,
        moonIllum,
        lightPollutionMag: lightPollutionMag ?? null,
        aod550: starW?.aod550,
        visibilityM: starW?.visibilityM,
        humidityPct: starW?.humidityPct,
        pm25: starW?.pm25,
      });
      starScore = Math.round(clamp(st.limitMag / NELM_DARK, 0, 1) * st.cloud.clearFraction * 100);
    }

    samples.push({
      tRel: h,
      timeMs,
      phase,
      sunsetScore,
      starScore,
      low: obs ? clamp(obs.low, 0, 100) : 0,
      mid: obs ? clamp(obs.mid, 0, 100) : 0,
      high: obs ? clamp(obs.high, 0, 100) : 0,
    });
  }

  // 그래프 위의 최고 노을 또는 별 순간
  let peakSample: TimelineSample | null = null;
  for (const s of samples) {
    if (s.tRel < 0) continue;
    if (!peakSample || s.sunsetScore > peakSample.sunsetScore) peakSample = s;
  }

  // 목록과 같은 이벤트를 번호 핀(최대 7개)으로 배치
  const shownList = events.slice(0, 7);
  const markers: TimelineMarker[] = shownList
    .map((ev, i) => ({
      index: i + 1,
      tRel: clamp((ev.timeMs - baseMs) / HOUR_MS, -6, 24),
      event: ev,
    }));

  // 최고 순간 배너 문구
  const scoredEvents = events.filter(e => e.score != null && Number.isFinite(e.score));
  const bestEv = scoredEvents.sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0] ?? null;
  let bestSummary: string | null = null;
  if (bestEv) {
    bestSummary = L3(
      language,
      `최고 순간 ${fmtLocalHHMM(bestEv.timeMs, tzHours)} ${bestEv.title} · 점수 ${Math.round(bestEv.score ?? 0)}`,
      `Best moment ${fmtLocalHHMM(bestEv.timeMs, tzHours)} ${bestEv.title} · Score ${Math.round(bestEv.score ?? 0)}`,
      `ベスト ${fmtLocalHHMM(bestEv.timeMs, tzHours)} ${bestEv.title}・スコア ${Math.round(bestEv.score ?? 0)}`,
    );
  } else if (peakSample && peakSample.sunsetScore > 0) {
    bestSummary = L3(
      language,
      `앞으로 24시간 최고 노을 기대치 ${Math.round(peakSample.sunsetScore)}점 (${fmtLocalHHMM(peakSample.timeMs, tzHours)})`,
      `Peak glow potential ${Math.round(peakSample.sunsetScore)} pts at ${fmtLocalHHMM(peakSample.timeMs, tzHours)}`,
      `今後24時間の最高予想スコア ${Math.round(peakSample.sunsetScore)}点 (${fmtLocalHHMM(peakSample.timeMs, tzHours)})`,
    );
  }

  const axisTicks: Array<{ tRel: number; label: string }> = [
    { tRel: -6, label: fmtLocalHHMM(baseMs - 6 * HOUR_MS, tzHours) },
    { tRel: 0, label: L3(language, '지금', 'Now', '今') },
    { tRel: 12, label: fmtLocalHHMM(baseMs + 12 * HOUR_MS, tzHours) },
    { tRel: 24, label: fmtLocalHHMM(baseMs + 24 * HOUR_MS, tzHours) },
  ];

  return {
    baseMs,
    samples,
    markers,
    bestSummary,
    peakLabel: peakSample && peakSample.sunsetScore >= 10 ? String(Math.round(peakSample.sunsetScore)) : null,
    peakTRel: peakSample?.tRel ?? null,
    peakScore: peakSample?.sunsetScore ?? null,
    axisTicks,
  };
}

// ── 7. 16일 달력 셀 (일출 · 일몰 + 밤 별 점수) ────────────────────────────

export interface CalendarDayCell {
  noonMs: number;
  label: string;
  dowLabel: string;
  weekdayIdx: number; // 0=월 .. 6=일 (달력 그리드 맞춤)
  isToday: boolean;
  sunrise: ForecastEvent | null;
  sunset: ForecastEvent | null;
  starScore: number | null;
  maxGlowScore: number | null;
  tier: 'high' | 'medium' | 'low';
  isTop: boolean;
}

const WEEKDAYS_MON_SUN: Record<'ko' | 'en' | 'ja', string[]> = {
  ko: ['일', '월', '화', '수', '목', '금', '토'],
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  ja: ['日', '月', '火', '水', '木', '金', '土'],
};

export function buildCalendarDays(args: {
  days: ForecastDay[];
  forecast: CloudPathData[] | null;
  ringFor: (d: Date) => CloudPathData[] | null;
  lat: number;
  lon: number;
  elevM: number;
  tzHours: number;
  lightPollutionMag: number | null;
  language: Language;
}): { cells: CalendarDayCell[]; leadingBlanks: number; topDates: CalendarDayCell[] } {
  const { days, forecast, ringFor, lat, lon, elevM, tzHours, lightPollutionMag, language } = args;
  const wk = WEEKDAYS_MON_SUN[language === 'ko' ? 'ko' : language === 'ja' ? 'ja' : 'en'];
  const sliced = days.slice(0, 16);

  const cells: CalendarDayCell[] = sliced.map((d, idx) => {
    const localDate = new Date(d.noonMs + tzHours * HOUR_MS);
    const label = `${localDate.getUTCMonth() + 1}/${localDate.getUTCDate()}`;
    const getDaySun = localDate.getUTCDay(); // 0=일..6=토
    const weekdayIdx = (getDaySun + 6) % 7; // 월=0..일=6

    // 밤 별 점수
    let starScore: number | null = null;
    const nightT = starTimeFor(new Date(d.noonMs), lat, lon);
    const nightRing = ringFor(nightT);
    const nightPath = nightRing && nightRing.length > 0 && !nightRing[0]?.isFallback ? nightRing : forecast;
    const times = nightPath?.length ? hourlyTimeMs(nightPath[0]) : null;
    if (nightPath?.length && (!times || hourlyCovers(times, nightT.getTime()))) {
      const obs = getInterpolatedWeather(nightPath, nightT)[0];
      const sw = starWeatherOf(obs);
      if (sw && sw.cloudPct != null) {
        const res = starLimit({
          cloudPct: sw.cloudPct,
          sunAltDeg: sunPosition(nightT, lat, lon).altitude * DEG,
          moonAltDeg: getMoonPositionPrecise(nightT, lat, lon, elevM).altitude * DEG,
          moonIllum: SunCalc.getMoonIllumination(nightT).fraction,
          lightPollutionMag: lightPollutionMag ?? null,
          aod550: sw.aod550,
          visibilityM: sw.visibilityM,
          humidityPct: sw.humidityPct,
          pm25: sw.pm25,
        });
        starScore = Math.round(clamp(res.limitMag / NELM_DARK, 0, 1) * res.cloud.clearFraction * 100);
      }
    }

    const rS = d.sunrise?.score != null ? Math.round(d.sunrise.score) : null;
    const sS = d.sunset?.score != null ? Math.round(d.sunset.score) : null;
    const scores = [rS, sS].filter((v): v is number => v != null);
    const maxGlowScore = scores.length > 0 ? Math.max(...scores) : null;
    const rawTier = d.sunset?.tier ?? d.sunrise?.tier ?? 'none';
    const tier: CalendarDayCell['tier'] =
      rawTier === 'high' || rawTier === 'past' ? 'high' : rawTier === 'medium' ? 'medium' : 'low';

    return {
      noonMs: d.noonMs,
      label,
      dowLabel: wk[getDaySun],
      weekdayIdx,
      isToday: idx === 0,
      sunrise: d.sunrise,
      sunset: d.sunset,
      starScore,
      maxGlowScore,
      tier,
      isTop: false,
    };
  });

  // 3일/7일 내 점수 높은 상위 2일 강조
  const ranked = [...cells]
    .filter(c => c.maxGlowScore != null && (c.tier === 'high' || c.tier === 'medium'))
    .sort((a, b) => (b.maxGlowScore ?? 0) - (a.maxGlowScore ?? 0));
  const topIds = new Set(ranked.slice(0, 2).map(c => c.noonMs));
  for (const c of cells) c.isTop = topIds.has(c.noonMs) && (c.maxGlowScore ?? 0) >= 40;

  return {
    cells,
    leadingBlanks: cells.length > 0 ? cells[0].weekdayIdx : 0,
    topDates: cells.filter(c => c.isTop),
  };
}
