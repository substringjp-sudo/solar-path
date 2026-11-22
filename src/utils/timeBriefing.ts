/**
 * timeBriefing.ts — 데이터 페이지 상단의 **현재 선택 시각 종합 해설(기상·대기·천체)** 과
 * **이 시각 이후 발생할 기상·천체 이벤트 타임라인**을 계산하는 순수 모듈.
 *
 * 노을 하나만 보던 옛 요약 카드 대신, 사용자가 선택한 시각(`selectedTime`)의
 * 1) 기상·대기 상태(층별 구름·기온/노점·습도·강수·시정·에어로졸·바람) 해설과
 * 2) 실시간 천체 상태(태양 고도·박명 단계·노을 예측, 달 위치·위상·달빛 영향, 별 관측 한계등급·광공해, 지평선 위 행성)를
 * 먼저 풀어 설명하고,
 * 3) 그 시각 직후부터 시간순으로 이어지는 기상 변화(강수·구름 걷힘/유입)와 천체 이벤트(골든아워·일출/일몰·블루아워·천문박명·월출/월몰·은하수 관측 적기·행성 관측)를
 * 예보와 결합해 해설합니다.
 */
import SunCalc from 'suncalc';
import { L3, translateSunsetDesc, type Language } from './i18n';
import { getInterpolatedWeather, layerWindsFrom, type CloudData, type CloudPathData } from './weather';
import { sunPosition, sunTimes } from './solarPosition';
import { getMoonPositionPrecise, moonRiseSet } from './moonPosition';
import { getCalculatedPlanets } from './celestialPlanets';
import { cloudSummary, skyDirection } from './skyWords';
import { starLimit, seeLevel } from './starVisibility';
import { hourlyCovers, starWeatherOf } from './starTonight';
import { scenePrediction } from './scenePrediction';
import { nextLunarEclipse } from './lunarEclipse';
import { planEclipse } from './eclipsePlan';
import type { ForecastDay, ForecastEvent } from './sunForecast';
import type { LearnTopic } from './learnSections';

export type SkyPhaseKind = 'day' | 'golden' | 'civil' | 'nautical' | 'astronomical' | 'night';

export interface BriefingMetric {
  id: string;
  label: string;
  value: string;
  sub?: string;
}

export interface VisiblePlanetItem {
  id: string;
  name: string;
  direction: string;
  altitudeDeg: number;
  azimuthDeg: number;
  magnitude: number;
}

export interface TimeBriefing {
  timeMs: number;
  phaseKind: SkyPhaseKind;
  phaseBadge: string;
  headline: string;
  // 1. 기상 · 대기 해설
  hasWeather: boolean;
  weatherSummaryTitle: string;
  weatherNarrative: string;
  weatherMetrics: BriefingMetric[];
  // 2. 천체 · 빛 · 관측 해설
  sunTitle: string;
  sunNarrative: string;
  glowVerdict?: {
    quality: ForecastEvent['quality'];
    score: number | null;
    side: 'sunrise' | 'sunset';
    reason: string;
  } | null;
  moonTitle: string;
  moonNarrative: string;
  starTitle: string;
  starNarrative: string;
  limitMag: number;
  planetsTitle: string;
  planetsNarrative: string;
  visiblePlanets: VisiblePlanetItem[];
}

export type UpcomingCategory = 'weather' | 'sun' | 'twilight' | 'moon' | 'star' | 'planet' | 'eclipse';

export interface UpcomingTimelineEvent {
  id: string;
  timeMs: number;
  relativeLabel: string;
  category: UpcomingCategory;
  categoryLabel: string;
  title: string;
  badge?: string;
  quality?: ForecastEvent['quality'] | null;
  score?: number | null;
  description: string;
  topic: LearnTopic;
}

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

/** 바람이 불어오는 방위(0~360°)를 8방위 풍향 이름으로 바꿉니다. */
const windDirectionWord = (bearingDeg: number, lang: Language): string => {
  const b = ((bearingDeg % 360) + 360) % 360;
  const idx = Math.round(b / 45) % 8;
  const ko = ['북풍', '북동풍', '동풍', '남동풍', '남풍', '남서풍', '서풍', '북서풍'];
  const en = ['N wind', 'NE wind', 'E wind', 'SE wind', 'S wind', 'SW wind', 'W wind', 'NW wind'];
  const ja = ['北風', '北東風', '東風', '南東風', '南風', '南西風', '西風', '北西風'];
  return L3(lang, ko[idx], en[idx], ja[idx]);
};

/** 달 위상(0~1)을 자연스러운 이름으로 바꿉니다. */
export const moonPhaseWord = (phase: number, fraction: number, lang: Language): string => {
  if (fraction < 0.03) return L3(lang, '삭(신월)', 'New Moon', '新月');
  if (fraction > 0.97) return L3(lang, '보름달(망)', 'Full Moon', '満月');
  if (phase < 0.22) return L3(lang, '초승달', 'Waxing Crescent', '三日月');
  if (phase < 0.28) return L3(lang, '상현달', 'First Quarter', '上弦の月');
  if (phase < 0.5) return L3(lang, '차오르는 달(상현~망)', 'Waxing Gibbous', '十三夜月');
  if (phase < 0.72) return L3(lang, '이지러지는 달(망~하현)', 'Waning Gibbous', '寝待月');
  if (phase < 0.78) return L3(lang, '하현달', 'Last Quarter', '下弦の月');
  return L3(lang, '그믐달', 'Waning Crescent', '有明月');
};

/** 태양 고도에 따른 하늘 단계 분류 */
export const classifySkyPhase = (sunAltDeg: number, lang: Language): { kind: SkyPhaseKind; badge: string } => {
  if (sunAltDeg >= 6) {
    return { kind: 'day', badge: L3(lang, '낮 (주간)', 'Daytime', '昼') };
  }
  if (sunAltDeg >= 0) {
    return { kind: 'golden', badge: L3(lang, '골든아워', 'Golden Hour', 'ゴールデンアワー') };
  }
  if (sunAltDeg >= -6) {
    return { kind: 'civil', badge: L3(lang, '시민 박명 · 블루아워', 'Civil Twilight · Blue Hour', '市民薄明・ブルーアワー') };
  }
  if (sunAltDeg >= -12) {
    return { kind: 'nautical', badge: L3(lang, '항해 박명', 'Nautical Twilight', '航海薄明') };
  }
  if (sunAltDeg >= -18) {
    return { kind: 'astronomical', badge: L3(lang, '천문 박명', 'Astronomical Twilight', '天文薄明') };
  }
  return { kind: 'night', badge: L3(lang, '완전한 밤', 'Astronomical Night', '完全な夜') };
};

/** 행성 이름을 언어로 변환 */
const planetDisplayName = (id: string, fallback: string, lang: Language): string => {
  switch (id) {
    case 'mercury': return L3(lang, '수성', 'Mercury', '水星');
    case 'venus': return L3(lang, '금성', 'Venus', '金星');
    case 'mars': return L3(lang, '화성', 'Mars', '火星');
    case 'jupiter': return L3(lang, '목성', 'Jupiter', '木星');
    case 'saturn': return L3(lang, '토성', 'Saturn', '土星');
    default: return fallback;
  }
};

/** 예보 경로가 해당 시각을 포함하는지 확인하고 관측점 기상 데이터를 꺼냅니다. */
export const weatherAtTime = (
  time: Date,
  ringFor: (d: Date) => CloudPathData[] | null,
  forecast: CloudPathData[] | null,
): { obs: CloudData | null; path: CloudPathData[] | null } => {
  const ring = ringFor(time);
  const candidate = (ring && ring.length > 0 && !ring[0]?.isFallback) ? ring : forecast;
  if (!candidate || candidate.length === 0 || candidate[0]?.isFallback) return { obs: null, path: null };
  const h = candidate[0]?.hourly;
  const times = h?.timeMs ?? h?.time?.map((x: string) => new Date(x).getTime());
  if (!hourlyCovers(times, time.getTime())) return { obs: null, path: null };
  const obs = getInterpolatedWeather(candidate, time)[0] ?? null;
  return { obs, path: candidate };
};

/** 상대 시간 표시 (예: "25분 뒤", "3시간 10분 뒤") */
export const formatRelativeAfter = (fromMs: number, toMs: number, lang: Language): string => {
  const diffMin = Math.max(1, Math.round((toMs - fromMs) / 60_000));
  if (diffMin < 60) {
    return L3(lang, `${diffMin}분 뒤`, `in ${diffMin}m`, `${diffMin}分後`);
  }
  const h = Math.floor(diffMin / 60);
  const m = diffMin % 60;
  if (m === 0) {
    return L3(lang, `${h}시간 뒤`, `in ${h}h`, `${h}時間後`);
  }
  return L3(lang, `${h}시간 ${m}분 뒤`, `in ${h}h ${m}m`, `${h}時間${m}分後`);
};

/**
 * 현재 선택된 시각(`selectedTime`)의 기상 · 대기 · 천체 종합 브리핑을 생성합니다.
 */
export const buildTimeBriefing = (args: {
  selectedTime: Date;
  lat: number;
  lon: number;
  elevM: number;
  language: Language;
  ringFor: (d: Date) => CloudPathData[] | null;
  forecast: CloudPathData[] | null;
  days: ForecastDay[];
  lightPollutionMag: number | null;
}): TimeBriefing => {
  const { selectedTime, lat, lon, elevM, language, ringFor, forecast, days, lightPollutionMag } = args;
  const timeMs = selectedTime.getTime();

  // 1) 태양 위치 및 하늘 단계
  const sunPos = sunPosition(selectedTime, lat, lon);
  const sunAltDeg = sunPos.altitude * DEG;
  const sunAzDeg = ((sunPos.azimuth * DEG + 180) % 360 + 360) % 360;
  const sunDir = skyDirection(sunAzDeg, language);
  const phase = classifySkyPhase(sunAltDeg, language);

  // 2) 달 위치 및 위상
  const moonPos = getMoonPositionPrecise(selectedTime, lat, lon, elevM);
  const moonAltDeg = moonPos.altitude * DEG;
  const moonAzDeg = ((moonPos.azimuth * DEG + 180) % 360 + 360) % 360;
  const moonDir = skyDirection(moonAzDeg, language);
  const moonIllum = SunCalc.getMoonIllumination(selectedTime);
  const moonPct = Math.round(moonIllum.fraction * 100);
  const moonName = moonPhaseWord(moonIllum.phase, moonIllum.fraction, language);

  // 3) 선택 시각의 기상 데이터
  const { obs, path } = weatherAtTime(selectedTime, ringFor, forecast);
  const hasWeather = obs != null;

  const low = obs ? Math.round(obs.low) : 0;
  const mid = obs ? Math.round(obs.mid) : 0;
  const high = obs ? Math.round(obs.high) : 0;
  const total = obs
    ? Math.round(typeof obs.total === 'number' && Number.isFinite(obs.total) ? obs.total : Math.max(low, mid, high))
    : 0;

  const t2m = obs && typeof obs.t2mC === 'number' && Number.isFinite(obs.t2mC) ? obs.t2mC : null;
  const td2m = obs && typeof obs.td2mC === 'number' && Number.isFinite(obs.td2mC) ? obs.td2mC : null;
  const rh = obs && typeof obs.humidity === 'number' && Number.isFinite(obs.humidity) ? Math.round(obs.humidity) : null;
  const visKm = obs && typeof obs.visibility === 'number' && Number.isFinite(obs.visibility) ? obs.visibility / 1000 : null;
  const precip = obs && typeof obs.precipitation === 'number' && Number.isFinite(obs.precipitation) ? obs.precipitation : 0;
  const aod = obs && typeof obs.aod550 === 'number' && Number.isFinite(obs.aod550) ? obs.aod550 : null;
  const pm25 = obs && typeof obs.pm25 === 'number' && Number.isFinite(obs.pm25) ? Math.round(obs.pm25) : null;
  const winds = layerWindsFrom(obs);

  // 기상 해설 문장 조립
  let weatherSummaryTitle = '';
  let weatherNarrative = '';
  const weatherMetrics: BriefingMetric[] = [];

  if (obs) {
    const cSum = cloudSummary({ low, mid, high }, language);
    weatherSummaryTitle = precip >= 0.2
      ? L3(language, `${cSum} · 시간당 ${precip.toFixed(1)}mm 강수`, `${cSum} · ${precip.toFixed(1)}mm/h rain`, `${cSum} · 時間${precip.toFixed(1)}mmの降水`)
      : `${cSum} (${L3(language, `총운량 ${total}%`, `Total ${total}%`, `全雲量 ${total}%`)})`;

    const sentences: string[] = [];
    // 구름 층별 구조 해설
    if (total < 15) {
      sentences.push(L3(language,
        `하층(${low}%)·중층(${mid}%)·상층(${high}%) 모두 구름이 거의 없어 하늘이 탁 트여 있습니다.`,
        `Low (${low}%), mid (${mid}%), and high (${high}%) cloud layers are almost clear, leaving an open sky.`,
        `下層(${low}%)・中層(${mid}%)・上層(${high}%)ともに雲がほとんどなく、澄み渡っています。`));
    } else {
      const layerParts: string[] = [];
      if (low >= 25) {
        layerParts.push(L3(language,
          `지표면 가까운 하층운(${low}%)이 시야와 낮은 지평선을 가리고`,
          `low clouds (${low}%) near the surface obscure the lower horizon`,
          `地表近くの下層雲(${low}%)が低い地平線を遮り`));
      }
      if (mid >= 25) {
        layerParts.push(L3(language,
          `중층운(${mid}%)이 하늘 허리에 퍼져 있으며`,
          `mid-level clouds (${mid}%) spread across the mid-sky`,
          `中層雲(${mid}%)が空の中ほどに広がり`));
      }
      if (high >= 25) {
        layerParts.push(L3(language,
          `높은 상층운(${high}%)이 얇게 깔려 있습니다`,
          `high-altitude clouds (${high}%) form an upper veil`,
          `高い上層雲(${high}%)が薄く広がっています`));
      }
      if (layerParts.length > 0) {
        sentences.push(L3(language,
          `현재 총운량은 ${total}%(하층 ${low}% · 중층 ${mid}% · 상층 ${high}%)입니다.`,
          `Total cloud cover is ${total}% (low ${low}% · mid ${mid}% · high ${high}%).`,
          `現在の全雲量は${total}%(下層${low}%・中層${mid}%・上層${high}%)です。`));
      }
      if (low >= 50) {
        sentences.push(L3(language,
          '두꺼운 하층운이 많아 햇빛이나 별빛이 구름 아래로 통과하기 어렵습니다.',
          'Thick low clouds block direct sunlight and starlight from reaching the ground.',
          '厚い下層雲が多く、日差しや星明かりが雲の下へ届きにくい状態です。'));
      } else if (mid >= 30 || high >= 30) {
        sentences.push(L3(language,
          '하층은 비교적 열려 있고 중·상층 구름이 떠 있어, 박명 시간대에는 노을빛을 반사하는 스크린 역할을 하고 밤에는 어두운 별을 일부 가릴 수 있습니다.',
          'With few low clouds and mid/high clouds overhead, they catch twilight colors at dusk/dawn while dimming fainter stars at night.',
          '下層は比較的開けており中・上層雲が浮かんでいるため、薄明時は夕焼けを映すスクリーンになり、夜は暗い星を少し遮ります。'));
      }
    }

    // 강수 해설
    if (precip >= 0.2) {
      sentences.push(L3(language,
        `시간당 약 ${precip.toFixed(1)}mm의 강수가 예보되어 있어 야외 촬영이나 관측 시 방수 대비가 필요합니다.`,
        `About ${precip.toFixed(1)} mm/h of precipitation is expected, so weather protection is needed outdoors.`,
        `時間あたり約${precip.toFixed(1)}mmの降水が予想されるため、屋外での撮影・観測には雨対策が必要です。`));
    }

    // 기온 · 이슬점 · 습도 해설
    if (t2m != null) {
      const spread = td2m != null ? t2m - td2m : null;
      const dewNote = spread != null && spread <= 2.5
        ? L3(language,
          ` 이슬점(${td2m!.toFixed(1)}°C)과 기온 차가 ${spread.toFixed(1)}°C로 매우 좁아 안개가 끼거나 카메라 렌즈에 결로(서리·이슬)가 맺히기 쉽습니다.`,
          ` The dew point (${td2m!.toFixed(1)}°C) is within ${spread.toFixed(1)}°C of air temperature, so mist or lens condensation can form easily.`,
          ` 露点(${td2m!.toFixed(1)}°C)と気温の差が${spread.toFixed(1)}°Cと小さく、霧やカメラレンズの結露が発生しやすい状態です。`)
        : (td2m != null
          ? L3(language, ` (이슬점 ${td2m.toFixed(1)}°C)`, ` (dew point ${td2m.toFixed(1)}°C)`, ` (露点 ${td2m.toFixed(1)}°C)`)
          : '');
      sentences.push(L3(language,
        `기온은 ${t2m.toFixed(1)}°C${dewNote}${rh != null ? `, 상대습도는 ${rh}%입니다.` : '입니다.'}`,
        `Air temperature is ${t2m.toFixed(1)}°C${dewNote}${rh != null ? ` with ${rh}% relative humidity.` : '.'}`,
        `気温は${t2m.toFixed(1)}°C${dewNote}${rh != null ? `、相対湿度は${rh}%です。` : 'です。'}`));
    }

    // 시정 · 에어로졸 · 바람 해설
    const airParts: string[] = [];
    if (visKm != null) {
      const visWord = visKm >= 20
        ? L3(language, '시정이 매우 깨끗하고', 'visibility is crystal clear', '視程が非常に澄んでおり')
        : visKm >= 10
          ? L3(language, '시정이 양호하고', 'visibility is good', '視程は良好で')
          : L3(language, '연무·습기로 시정이 다소 뿌옇고', 'haze reduces visibility', '靄や湿気で視程がやや霞んでおり');
      airParts.push(L3(language, `가시거리 ${visKm.toFixed(1)}km로 ${visWord}`, `visibility is ${visKm.toFixed(1)} km (${visWord})`, `視程${visKm.toFixed(1)}kmで${visWord}`));
    }
    if (winds) {
      const wDir = windDirectionWord(winds.low.bearingDeg, language);
      const wSpd = Math.round(winds.low.speedKmh);
      const hiSpd = Math.round(winds.high.speedKmh);
      airParts.push(L3(language,
        `하층에는 ${wDir} ${wSpd}km/h(상층풍 ${hiSpd}km/h)가 불고 있습니다.`,
        `low-level ${wDir} blows at ${wSpd} km/h (upper wind ${hiSpd} km/h).`,
        `下層では${wDir}${wSpd}km/h(上層風${hiSpd}km/h)が吹いています。`));
    }
    if (airParts.length > 0) {
      sentences.push(airParts.join(' '));
    }

    weatherNarrative = sentences.join(' ');

    // 지표 카드 구성
    weatherMetrics.push({
      id: 'cloud',
      label: L3(language, '구름 (총운량)', 'Cloud cover', '雲量 (全雲量)'),
      value: `${total}%`,
      sub: L3(language, `하 ${low} · 중 ${mid} · 상 ${high}%`, `L ${low} · M ${mid} · H ${high}%`, `下 ${low} · 中 ${mid} · 上 ${high}%`),
    });
    weatherMetrics.push({
      id: 'temp',
      label: L3(language, '기온 · 이슬점', 'Temp · Dew point', '気温・露点'),
      value: t2m != null ? `${t2m.toFixed(1)}°C` : '—',
      sub: td2m != null ? L3(language, `이슬점 ${td2m.toFixed(1)}°C`, `Dew ${td2m.toFixed(1)}°C`, `露点 ${td2m.toFixed(1)}°C`) : L3(language, '자료 없음', 'N/A', 'なし'),
    });
    weatherMetrics.push({
      id: 'humidity',
      label: L3(language, '습도 · 강수량', 'Humidity · Rain', '湿度・降水量'),
      value: rh != null ? `${rh}%` : '—',
      sub: precip > 0 ? `${precip.toFixed(1)} mm/h` : L3(language, '강수 없음 (0mm)', 'Dry (0mm)', '降水なし (0mm)'),
    });
    weatherMetrics.push({
      id: 'vis',
      label: L3(language, '시정 · 투명도', 'Visibility · AOD', '視程・透明度'),
      value: visKm != null ? `${visKm.toFixed(1)} km` : '—',
      sub: aod != null
        ? `AOD ${aod.toFixed(2)}${pm25 != null ? ` · PM2.5 ${pm25}` : ''}`
        : (pm25 != null ? `PM2.5 ${pm25} µg/m³` : L3(language, '표준 대기', 'Standard air', '標準大気')),
    });
    if (winds) {
      weatherMetrics.push({
        id: 'wind_low',
        label: L3(language, '하층 바람 (850hPa)', 'Low-level wind', '下層風 (850hPa)'),
        value: `${Math.round(winds.low.speedKmh)} km/h`,
        sub: windDirectionWord(winds.low.bearingDeg, language),
      });
      weatherMetrics.push({
        id: 'wind_high',
        label: L3(language, '상층 바람 (250hPa)', 'Upper-level wind', '上層風 (250hPa)'),
        value: `${Math.round(winds.high.speedKmh)} km/h`,
        sub: windDirectionWord(winds.high.bearingDeg, language),
      });
    }
  } else {
    weatherSummaryTitle = L3(language, '시간별 기상 예보 범위 밖의 시각', 'Outside hourly weather forecast range', '時間別気象予報の範囲外の時刻');
    weatherNarrative = L3(language,
      '현재 선택한 시각은 받아 둔 시간별 기상 예보 범위를 벗어나 있어, 기온·구름 대신 태양·달·별·행성의 정밀 천문 위치와 궤도를 기준으로 해설합니다.',
      'The selected time is outside the downloaded hourly weather window, so commentary is based on precise astronomical positions of the Sun, Moon, stars, and planets.',
      '選択された時刻は時間別気象予報の範囲外のため、太陽・月・星・惑星の精密な天文位置に基づいて解説します。');
  }

  // 4) 태양 · 박명 · 노을 해설
  const sunTitle = L3(language,
    `태양 · ${sunDir} 방위 ${sunAzDeg.toFixed(0)}° / 고도 ${sunAltDeg >= 0 ? `+${sunAltDeg.toFixed(1)}` : sunAltDeg.toFixed(1)}°`,
    `Sun · ${sunDir} AZ ${sunAzDeg.toFixed(0)}° / Alt ${sunAltDeg >= 0 ? `+${sunAltDeg.toFixed(1)}` : sunAltDeg.toFixed(1)}°`,
    `太陽 · ${sunDir} 方位 ${sunAzDeg.toFixed(0)}° / 高度 ${sunAltDeg >= 0 ? `+${sunAltDeg.toFixed(1)}` : sunAltDeg.toFixed(1)}°`);

  let glowVerdict: TimeBriefing['glowVerdict'] = null;
  if (path && obs && sunAltDeg >= -8 && sunAltDeg <= 12) {
    const livePred = scenePrediction({
      pathData: path,
      time: selectedTime,
      sunAltDeg,
      sunAzDeg,
      obs,
      latitude: lat,
      observerElevM: elevM,
    });
    if (livePred) {
      const st = sunTimes(selectedTime, lat, lon);
      const isMorning = Math.abs(timeMs - st.sunrise.getTime()) < Math.abs(timeMs - st.sunset.getTime());
      glowVerdict = {
        quality: livePred.quality,
        score: Math.round(livePred.score),
        side: isMorning ? 'sunrise' : 'sunset',
        reason: translateSunsetDesc(livePred.description, language),
      };
    }
  }

  let sunNarrative = '';
  if (phase.kind === 'day') {
    const dni = obs?.directNormalIrradiance != null && Number.isFinite(obs.directNormalIrradiance)
      ? Math.round(obs.directNormalIrradiance)
      : null;
    const shadowRatio = sunAltDeg > 2 ? (1 / Math.tan(sunPos.altitude)).toFixed(1) : null;
    sunNarrative = L3(language,
      `태양이 지평선 위 ${sunAltDeg.toFixed(1)}°(${sunDir})에 떠 있는 낮 시간대입니다.${dni != null ? ` 직달일사량은 약 ${dni} W/m²이며,` : ''}${shadowRatio != null ? ` 물체 키의 약 ${shadowRatio}배 길이로 그림자가 맺힙니다.` : ''}`,
      `The Sun is ${sunAltDeg.toFixed(1)}° above the horizon (${sunDir}).${dni != null ? ` Direct normal irradiance is ~${dni} W/m²,` : ''}${shadowRatio != null ? ` casting shadows ~${shadowRatio}× object height.` : ''}`,
      `太陽が地平線上${sunAltDeg.toFixed(1)}°(${sunDir})にある昼の時間帯です。${dni != null ? `直達日射量は約${dni} W/m²で、` : ''}${shadowRatio != null ? `物体の約${shadowRatio}倍の長さの影が伸びます。` : ''}`);
  } else if (phase.kind === 'golden') {
    sunNarrative = L3(language,
      `태양 고도가 ${sunAltDeg.toFixed(1)}°로 낮아져 대기 통과 거리가 길어지는 골든아워입니다. 푸른 파장은 산란되고 따뜻한 주황·황금빛 직사광이 풍경을 비춥니다.${glowVerdict ? ` 현재 노을 점수는 ${glowVerdict.score}점(${glowVerdict.reason})입니다.` : ''}`,
      `Golden Hour with the Sun low at ${sunAltDeg.toFixed(1)}°. Sunlight travels through a long atmospheric path, bathing the scene in warm golden tones.${glowVerdict ? ` Current glow score is ${glowVerdict.score} (${glowVerdict.reason}).` : ''}`,
      `太陽高度が${sunAltDeg.toFixed(1)}°まで下がり、暖かい黄金色の光が差すゴールデンアワーです。${glowVerdict ? `現在の焼けスコアは${glowVerdict.score}点(${glowVerdict.reason})です。` : ''}`);
  } else if (phase.kind === 'civil') {
    sunNarrative = L3(language,
      `태양이 지평선 바로 아래(${sunAltDeg.toFixed(1)}°)에 있는 시민 박명(블루아워)입니다. 지표면은 그늘에 들어섰지만 상공의 중·상층 구름은 아직 직사광을 받아 가장 붉게 물들고, 하늘 전체에는 깊은 코발트빛이 감돕니다.${glowVerdict ? ` (${glowVerdict.reason})` : ''}`,
      `Civil Twilight (Blue Hour) with the Sun just below the horizon (${sunAltDeg.toFixed(1)}°). The ground is in shadow while mid/high clouds still catch direct red afterglow against a deep blue sky.${glowVerdict ? ` (${glowVerdict.reason})` : ''}`,
      `太陽が地平線直下(${sunAltDeg.toFixed(1)}°)にある市民薄明(ブルーアワー)です。地上は影に入りますが、中・上層雲はまだ赤い残照を受け、空全体が深い青色に染まります。${glowVerdict ? ` (${glowVerdict.reason})` : ''}`);
  } else if (phase.kind === 'nautical') {
    sunNarrative = L3(language,
      `태양 고도 ${sunAltDeg.toFixed(1)}°의 항해 박명입니다. 수평선 윤곽과 밝은 1~2등성, 주요 행성이 뚜렷해지며 야경과 별을 함께 담기 좋은 시간입니다.`,
      `Nautical Twilight (Sun at ${sunAltDeg.toFixed(1)}°). The horizon outline remains visible while bright stars and planets emerge, ideal for blending cityscapes and twilight sky.`,
      `太陽高度${sunAltDeg.toFixed(1)}°の航海薄明です。水平線の輪郭と明るい一等星や惑星が見え始め、夜景と星空を一緒に収めやすい時間帯です。`);
  } else if (phase.kind === 'astronomical') {
    sunNarrative = L3(language,
      `태양 고도 ${sunAltDeg.toFixed(1)}°의 천문 박명입니다. 육안으로는 거의 밤처럼 어둡지만, 태양 쪽 지평선 상공에 미세한 대기 산란광이 남아 있어 장노출 천체 사진에서는 약간의 박명기가 찍힐 수 있습니다.`,
      `Astronomical Twilight (Sun at ${sunAltDeg.toFixed(1)}°). The sky looks dark to the eye, though faint twilight glow can still register near the horizon in long-exposure astrophotography.`,
      `太陽高度${sunAltDeg.toFixed(1)}°の天文薄明です。肉眼ではほぼ夜ですが、長時間露光の天体写真では地平線付近にわずかな薄明かりが写ることがあります。`);
  } else {
    sunNarrative = L3(language,
      `태양이 지평선 아래 ${sunAltDeg.toFixed(1)}°까지 내려간 완전한 천문학적 밤입니다. 태양 산란광의 영향이 완전히 사라져 달빛과 구름만 없다면 은하수와 딥스카이 천체를 관측하기 가장 어두운 상태입니다.`,
      `Complete Astronomical Night with the Sun at ${sunAltDeg.toFixed(1)}°. Solar twilight is completely gone, offering maximum sky darkness for Milky Way and deep-sky observation.`,
      `太陽が地平線下${sunAltDeg.toFixed(1)}°にある完全な天文夜です。太陽の散乱光が完全に消え、月明かりと雲がなければ天の川や星雲の観測に最も暗い状態です。`);
  }

  // 5) 달 해설
  const moonAbove = moonAltDeg > 0;
  const moonTitle = L3(language,
    `달 · ${moonName}(밝기 ${moonPct}%) · ${moonAbove ? `${moonDir} 고도 +${moonAltDeg.toFixed(1)}°` : `지평선 아래(${moonAltDeg.toFixed(1)}°)`}`,
    `Moon · ${moonName} (${moonPct}%) · ${moonAbove ? `${moonDir} Alt +${moonAltDeg.toFixed(1)}°` : `Below horizon (${moonAltDeg.toFixed(1)}°)`}`,
    `月 · ${moonName}(輝面 ${moonPct}%) · ${moonAbove ? `${moonDir} 高度 +${moonAltDeg.toFixed(1)}°` : `地平線下(${moonAltDeg.toFixed(1)}°)`}`);

  let moonNarrative = '';
  if (!moonAbove) {
    moonNarrative = L3(language,
      `현재 달(${moonName}, 밝기 ${moonPct}%)은 지평선 아래(${moonAltDeg.toFixed(1)}°)에 내려가 있어 하늘에 달빛 방해가 전혀 없습니다.`,
      `The Moon (${moonName}, ${moonPct}% illuminated) is currently below the horizon (${moonAltDeg.toFixed(1)}°), leaving the sky free of moonlight interference.`,
      `現在、月(${moonName}、輝面${moonPct}%)は地平線下(${moonAltDeg.toFixed(1)}°)にあり、月明かりの影響は全くありません。`);
  } else if (sunAltDeg > 0) {
    moonNarrative = L3(language,
      `${moonDir} 하늘 고도 ${moonAltDeg.toFixed(1)}°(방위 ${moonAzDeg.toFixed(0)}°)에 밝기 ${moonPct}%의 ${moonName}이 떠 있습니다. 낮 시간대라 하늘 배경이 밝지만${moonPct >= 40 ? ' 육안으로도 낮달을 찾을 수 있습니다.' : ' 얇은 달이라 육안 식별은 어렵습니다.'}`,
      `A ${moonPct}% illuminated ${moonName} is up in the ${moonDir} at +${moonAltDeg.toFixed(1)}° (AZ ${moonAzDeg.toFixed(0)}°) during daylight.`,
      `${moonDir}の高度${moonAltDeg.toFixed(1)}°(方位${moonAzDeg.toFixed(0)}°)に輝面${moonPct}%の${moonName}が昇っています。`);
  } else if (moonPct >= 50) {
    moonNarrative = L3(language,
      `${moonDir} 고도 ${moonAltDeg.toFixed(1)}°에 밝기 ${moonPct}%의 밝은 달(${moonName})이 떠 있어 밤하늘 배경을 환하게 비추고 있습니다. 달 표면 촬영이나 달빛 풍경 사진에는 좋지만, 은하수처럼 어두운 별빛은 달빛에 묻힙니다.`,
      `A bright ${moonName} (${moonPct}%) is at +${moonAltDeg.toFixed(1)}° in the ${moonDir}, illuminating the landscape and washing out faint Milky Way stars.`,
      `${moonDir}の高度${moonAltDeg.toFixed(1)}°に明るい${moonName}(${moonPct}%)が昇っており、夜空を照らしています。月景写真には適していますが、天の川など淡い星は月明かりに埋もれます。`);
  } else {
    moonNarrative = L3(language,
      `${moonDir} 고도 ${moonAltDeg.toFixed(1)}°에 은은한 ${moonName}(밝기 ${moonPct}%)이 떠 있습니다. 달빛이 강하지 않아 지형에 은은한 윤곽을 더하면서도 밝은 별자리와 조화롭게 어우러집니다.`,
      `A gentle ${moonName} (${moonPct}%) sits at +${moonAltDeg.toFixed(1)}° in the ${moonDir}, adding subtle foreground light without overpowering bright constellations.`,
      `${moonDir}の高度${moonAltDeg.toFixed(1)}°に穏やかな${moonName}(輝面${moonPct}%)が浮かんでおり、星座と調和しています。`);
  }

  // 6) 별 · 은하수 관측 한계등급 해설
  const starW = obs ? starWeatherOf(obs) : null;
  const limit = starLimit({
    cloudPct: starW?.cloudPct ?? 0,
    sunAltDeg,
    moonAltDeg,
    moonIllum: moonIllum.fraction,
    lightPollutionMag: lightPollutionMag ?? null,
    aod550: starW?.aod550,
    visibilityM: starW?.visibilityM,
    humidityPct: starW?.humidityPct,
    pm25: starW?.pm25,
  });
  const limitMag = Math.round(limit.limitMag * 10) / 10;
  const sLevel = seeLevel(limit.limitMag);

  const levelWord = sLevel === 'milkyway'
    ? L3(language, '은하수 · 성운 관측 가능', 'Milky Way visible', '天の川・星雲の観測可能')
    : sLevel === 'constellations'
      ? L3(language, '주요 별자리 관측 가능', 'Constellations visible', '主な星座の観測可能')
      : sLevel === 'bright'
        ? L3(language, '밝은 별(1~3등성) 위주 관측', 'Bright stars only', '明るい星(1〜3等星)中心')
        : L3(language, '별 관측 어려움', 'Stars not visible', '星の観測困難');

  const starTitle = sunAltDeg > -6
    ? L3(language, `별 · 은하수 — 낮/박명으로 별 관측 불가`, `Stars · Too bright for stargazing`, `星・天の川 — 昼・薄明のため観測不可`)
    : L3(language, `별 · 은하수 — 한계등급 ${limitMag.toFixed(1)}등급 (${levelWord})`, `Stars · Limiting mag ${limitMag.toFixed(1)} (${levelWord})`, `星・天の川 — 限界等級 ${limitMag.toFixed(1)}等 (${levelWord})`);

  let starNarrative = '';
  if (sunAltDeg > -6) {
    starNarrative = L3(language,
      `태양 고도가 ${sunAltDeg.toFixed(1)}°로 하늘 배경이 밝아 별은 보이지 않습니다. 해가 지평선 아래 -12°(항해 박명) 이하로 내려가야 별자리가 본격적으로 드러납니다.`,
      `With the Sun at ${sunAltDeg.toFixed(1)}°, the sky is too bright for stars. Constellations emerge once the Sun drops below -12° (Nautical Twilight).`,
      `太陽高度が${sunAltDeg.toFixed(1)}°で空が明るいため星は見えません。太陽が-12°(航海薄明)以下になると星座が現れます。`);
  } else {
    const reasons: string[] = [];
    const twilightLoss = limit.twilight ? Math.max(0, -limit.twilight.deltaMag) : 0;
    const moonLoss = Math.max(0, -limit.moon.deltaMag);
    const lightLoss = Math.max(0, -limit.light.deltaMag);
    const hazeLoss = Math.max(0, -limit.haze.deltaMag);
    const cloudPctVal = limit.cloud.pct;
    if (twilightLoss > 0.4) reasons.push(L3(language, `박명 잔광(-${twilightLoss.toFixed(1)}등급)`, `twilight (-${twilightLoss.toFixed(1)} mag)`, `薄明かり(-${twilightLoss.toFixed(1)}等)`));
    if (moonLoss > 0.3) reasons.push(L3(language, `달빛(-${moonLoss.toFixed(1)}등급)`, `moonlight (-${moonLoss.toFixed(1)} mag)`, `月明かり(-${moonLoss.toFixed(1)}等)`));
    if (lightLoss > 0.4) reasons.push(L3(language, `도심 광공해(-${lightLoss.toFixed(1)}등급)`, `light pollution (-${lightLoss.toFixed(1)} mag)`, `光害(-${lightLoss.toFixed(1)}等)`));
    if (hazeLoss > 0.25) reasons.push(L3(language, `대기 연무·습기(-${hazeLoss.toFixed(1)}등급)`, `haze/humidity (-${hazeLoss.toFixed(1)} mag)`, `靄・湿気(-${hazeLoss.toFixed(1)}等)`));
    if (cloudPctVal >= 30) reasons.push(L3(language, `구름 가림(${Math.round(cloudPctVal)}%)`, `cloud cover (${Math.round(cloudPctVal)}%)`, `雲(${Math.round(cloudPctVal)}%)`));

    const factorText = reasons.length > 0
      ? L3(language, `주요 감점 요인은 ${reasons.join(', ')}입니다.`, `Main limiting factors: ${reasons.join(', ')}.`, `主な減点要因は${reasons.join('、')}です。`)
      : L3(language, '박명·달빛·구름 방해가 모두 적어 매우 이상적인 밤하늘입니다.', 'Minimal twilight, moonlight, or cloud interference — ideal dark sky.', '薄明・月明かり・雲の妨げがすべて少なく理想的な夜空です。');

    starNarrative = L3(language,
      `현재 밤하늘에서 맨눈으로 볼 수 있는 가장 어두운 별은 약 ${limitMag.toFixed(1)}등급(${levelWord})입니다. ${factorText}`,
      `The faintest stars visible to the naked eye right now are around magnitude ${limitMag.toFixed(1)} (${levelWord}). ${factorText}`,
      `現在肉眼で見える最も暗い星は約${limitMag.toFixed(1)}等級(${levelWord})です。${factorText}`);
  }

  // 7) 지평선 위 행성 해설
  const rawPlanets = getCalculatedPlanets(lat, lon, selectedTime);
  const visiblePlanets: VisiblePlanetItem[] = rawPlanets
    .filter(p => p.altitude > 0)
    .sort((a, b) => b.altitude - a.altitude)
    .map(p => ({
      id: p.key,
      name: planetDisplayName(p.key, language === 'en' ? p.nameEn : p.nameKo, language),
      direction: skyDirection(p.azimuth, language) ?? '',
      altitudeDeg: Math.round(p.altitude),
      azimuthDeg: Math.round(p.azimuth),
      magnitude: p.magnitude,
    }));

  const planetsTitle = visiblePlanets.length > 0
    ? L3(language,
      `행성 — 현재 지평선 위 ${visiblePlanets.map(p => `${p.name}(${p.altitudeDeg}°)`).join(' · ')}`,
      `Planets — Above horizon: ${visiblePlanets.map(p => `${p.name} (${p.altitudeDeg}°)`).join(' · ')}`,
      `惑星 — 地平線上: ${visiblePlanets.map(p => `${p.name}(${p.altitudeDeg}°)`).join('・')}`)
    : L3(language, '행성 — 현재 지평선 위에 떠 있는 주요 행성 없음', 'Planets — No major planets above horizon right now', '惑星 — 現在地平線上にある主な惑星なし');

  let planetsNarrative = '';
  if (visiblePlanets.length === 0) {
    planetsNarrative = L3(language,
      '이 시각에는 수성·금성·화성·목성·토성 모두 지평선 아래에 있습니다. 아래 예정 이벤트에서 다음 행성 관측 시간대를 확인해 보세요.',
      'Mercury, Venus, Mars, Jupiter, and Saturn are all below the horizon at this moment. Check the upcoming events below for the next planetary window.',
      'この時刻は水星・金星・火星・木星・土星のすべてが地平線下にあります。下の予定イベントで次の惑星観測時間帯を確認してください。');
  } else if (sunAltDeg > 0) {
    planetsNarrative = L3(language,
      `하늘 위에 ${visiblePlanets.map(p => `${p.name}(${p.direction} 고도 ${p.altitudeDeg}°)`).join(', ')}이 위치해 있지만 낮 시간대라 맨눈으로는 보이지 않습니다.`,
      `${visiblePlanets.map(p => `${p.name} (${p.direction} ${p.altitudeDeg}°)`).join(', ')} ${visiblePlanets.length === 1 ? 'is' : 'are'} above the horizon but hidden by daylight.`,
      `${visiblePlanets.map(p => `${p.name}(${p.direction} 高度${p.altitudeDeg}°)`).join('、')}が地平線上にありますが、昼間のため肉眼では見えません。`);
  } else {
    const highEnough = visiblePlanets.filter(p => p.altitudeDeg >= 10);
    planetsNarrative = L3(language,
      `지금 밤하늘에서 ${visiblePlanets.map(p => `${p.name}(${p.direction} 고도 ${p.altitudeDeg}°, 밝기 ${p.magnitude.toFixed(1)}등급)`).join(', ')}을 찾을 수 있습니다.${highEnough.length > 0 ? ' 고도가 10° 이상으로 올라와 있어 대기 흔들림이 적고 관측하기 좋습니다.' : ' 지평선 근처라 시야가 트인 곳이 유리합니다.'}`,
      `In the sky right now: ${visiblePlanets.map(p => `${p.name} (${p.direction} Alt ${p.altitudeDeg}°, mag ${p.magnitude.toFixed(1)})`).join(', ')}.`,
      `現在の空では${visiblePlanets.map(p => `${p.name}(${p.direction} 高度${p.altitudeDeg}°、${p.magnitude.toFixed(1)}等)`).join('、')}が見えています。`);
  }

  // 종합 한 줄 요약 헤드라인
  const headline = hasWeather
    ? `${phase.badge} · ${weatherSummaryTitle}`
    : `${phase.badge} · ${L3(language, `태양 고도 ${sunAltDeg.toFixed(1)}°`, `Sun Alt ${sunAltDeg.toFixed(1)}°`, `太陽高度 ${sunAltDeg.toFixed(1)}°`)}`;

  const matchedDay = days.find(d => Math.abs(d.noonMs - timeMs) < 14 * 3600_000) ?? null;
  if (!glowVerdict && matchedDay) {
    const nearSunrise = matchedDay.sunrise && Math.abs(matchedDay.sunrise.at.getTime() - timeMs) <= 90 * 60_000 ? matchedDay.sunrise : null;
    const nearSunset = matchedDay.sunset && Math.abs(matchedDay.sunset.at.getTime() - timeMs) <= 90 * 60_000 ? matchedDay.sunset : null;
    const ev = nearSunset ?? nearSunrise;
    if (ev && ev.quality) {
      glowVerdict = {
        quality: ev.quality,
        score: ev.score != null ? Math.round(ev.score) : null,
        side: ev.side,
        reason: ev.description ? translateSunsetDesc(ev.description, language) : '',
      };
    }
  }

  return {
    timeMs,
    phaseKind: phase.kind,
    phaseBadge: phase.badge,
    headline,
    hasWeather,
    weatherSummaryTitle,
    weatherNarrative,
    weatherMetrics,
    sunTitle,
    sunNarrative,
    glowVerdict,
    moonTitle,
    moonNarrative,
    starTitle,
    starNarrative,
    limitMag,
    planetsTitle,
    planetsNarrative,
    visiblePlanets,
  };
};

/**
 * 선택한 시각(`selectedTime`) 직후부터 앞으로 24시간 동안 발생할
 * 모든 기상 변화 + 태양/박명/노을 + 달 + 별/은하수 + 행성 이벤트를 시간순으로 생성합니다.
 */
export const buildUpcomingTimeline = (args: {
  selectedTime: Date;
  lat: number;
  lon: number;
  elevM: number;
  language: Language;
  ringFor: (d: Date) => CloudPathData[] | null;
  forecast: CloudPathData[] | null;
  days: ForecastDay[];
  lightPollutionMag: number | null;
  fmtTime: (ms: number) => string;
}): UpcomingTimelineEvent[] => {
  const { selectedTime, lat, lon, elevM, language, ringFor, forecast, days, lightPollutionMag, fmtTime } = args;
  const startMs = selectedTime.getTime();
  const horizonMs = startMs + 24 * 3600_000;
  const events: UpcomingTimelineEvent[] = [];

  const inWindow = (d: Date | null | undefined): d is Date => {
    if (!d) return false;
    const ms = d.getTime();
    return Number.isFinite(ms) && ms > startMs + 60_000 && ms <= horizonMs;
  };

  // 해당 시각의 기상 요약 한 줄 도우미
  const weatherBriefAt = (ms: number): { obs: CloudData | null; note: string } => {
    const { obs } = weatherAtTime(new Date(ms), ringFor, forecast);
    if (!obs) return { obs: null, note: '' };
    const low = Math.round(obs.low);
    const mid = Math.round(obs.mid);
    const high = Math.round(obs.high);
    const total = Math.round(typeof obs.total === 'number' && Number.isFinite(obs.total) ? obs.total : Math.max(low, mid, high));
    const cSum = cloudSummary({ low, mid, high }, language);
    const t = typeof obs.t2mC === 'number' && Number.isFinite(obs.t2mC) ? `${obs.t2mC.toFixed(1)}°C` : null;
    const rain = typeof obs.precipitation === 'number' && obs.precipitation >= 0.2
      ? L3(language, `, 강수 ${obs.precipitation.toFixed(1)}mm/h`, `, rain ${obs.precipitation.toFixed(1)}mm/h`, `、降水${obs.precipitation.toFixed(1)}mm/h`)
      : '';
    return {
      obs,
      note: L3(language,
        `예보 기상: ${cSum}(총운량 ${total}%${t ? `, ${t}` : ''}${rain})`,
        `Forecast: ${cSum} (cloud ${total}%${t ? `, ${t}` : ''}${rain})`,
        `予想気象: ${cSum}(全雲量${total}%${t ? `、${t}` : ''}${rain})`),
    };
  };

  // 날짜별로(선택 시각 당일과 다음날) 천체 시각들을 스캔합니다.
  const scanDates = [
    new Date(startMs),
    new Date(startMs + 24 * 3600_000),
  ];

  // 가장 가까운 ForecastDay의 일출/일몰 예측 찾기
  const findForecastEvent = (side: 'sunrise' | 'sunset', atMs: number): ForecastEvent | null => {
    for (const d of days) {
      const ev = side === 'sunrise' ? d.sunrise : d.sunset;
      if (ev && Math.abs(ev.at.getTime() - atMs) < 3 * 3600_000) return ev;
    }
    return null;
  };

  const addedKeys = new Set<string>();
  const pushUnique = (ev: UpcomingTimelineEvent) => {
    // 같은 종류 이벤트가 15분 이내 중복 등록되지 않도록 방지
    const bucket = `${ev.id.split('_')[0]}_${Math.round(ev.timeMs / (15 * 60_000))}`;
    if (addedKeys.has(bucket)) return;
    addedKeys.add(bucket);
    events.push(ev);
  };

  for (const baseDate of scanDates) {
    const st = sunTimes(baseDate, lat, lon);

    // 1) 새벽 천문 박명 시작 (밤 끝)
    if (inWindow(st.nightEnd)) {
      const ms = st.nightEnd.getTime();
      const wb = weatherBriefAt(ms);
      pushUnique({
        id: `nightEnd_${ms}`,
        timeMs: ms,
        relativeLabel: formatRelativeAfter(startMs, ms, language),
        category: 'twilight',
        categoryLabel: L3(language, '박명 · 밤 경계', 'Twilight', '薄明'),
        title: L3(language, '새벽 천문 박명 시작 (완전한 밤 종료)', 'Astronomical Dawn (Dark Night Ends)', '天文薄明の始まり (完全な夜の終了)'),
        badge: L3(language, '태양 -18°', 'Sun -18°', '太陽 -18°'),
        description: L3(language,
          `태양이 고도 -18°로 올라오며 동쪽 하늘 가장자리부터 미세한 대기 산란광이 시작됩니다. 은하수·딥스카이 촬영은 이 시각 전에 마무리하는 것이 좋습니다.${wb.note ? ` · ${wb.note}` : ''}`,
          `The Sun reaches -18°, beginning faint upper-atmosphere scattering in the east. Wrap up deep-sky astrophotography before this time.${wb.note ? ` · ${wb.note}` : ''}`,
          `太陽が高度-18°に達し、東の空からわずかな散乱光が始まります。天の川撮影はこの時刻前までに終えるのが理想です。${wb.note ? ` · ${wb.note}` : ''}`),
        topic: 'sunrise',
      });
    }

    // 2) 새벽 시민 박명 시작 (아침 블루아워)
    if (inWindow(st.dawn)) {
      const ms = st.dawn.getTime();
      const wb = weatherBriefAt(ms);
      pushUnique({
        id: `dawn_${ms}`,
        timeMs: ms,
        relativeLabel: formatRelativeAfter(startMs, ms, language),
        category: 'twilight',
        categoryLabel: L3(language, '블루아워 · 여명', 'Blue Hour', 'ブルーアワー'),
        title: L3(language, '아침 블루아워 · 시민 박명 시작', 'Morning Blue Hour · Civil Dawn', '朝のブルーアワー・市民薄明'),
        badge: L3(language, '태양 -6°', 'Sun -6°', '太陽 -6°'),
        description: L3(language,
          `태양이 지평선 아래 -6°까지 올라와 하늘이 푸른 여명빛으로 물들고 상층·중층 구름에 첫 붉은 일출 전조가 비치기 시작합니다.${wb.note ? ` · ${wb.note}` : ''}`,
          `The Sun reaches -6° below the horizon. The sky turns deep blue and upper clouds begin catching early pre-sunrise red light.${wb.note ? ` · ${wb.note}` : ''}`,
          `太陽が地平線下-6°まで上がり、空が青い黎明に染まり、上・中層雲に日の出前の赤い光が差し始めます。${wb.note ? ` · ${wb.note}` : ''}`),
        topic: 'score',
      });
    }

    // 3) 일출 (Sunrise)
    if (inWindow(st.sunrise)) {
      const ms = st.sunrise.getTime();
      const fe = findForecastEvent('sunrise', ms);
      const wb = weatherBriefAt(ms);
      const sunAz = ((sunPosition(st.sunrise, lat, lon).azimuth * DEG + 180) % 360 + 360) % 360;
      const dir = skyDirection(sunAz, language);
      const peakStr = fe?.peakAt ? fmtTime(fe.peakAt.getTime()) : null;
      const reason = fe?.description ? translateSunsetDesc(fe.description, language) : '';
      const scoreVal = fe?.score != null ? Math.round(fe.score) : null;

      pushUnique({
        id: `sunrise_${ms}`,
        timeMs: ms,
        relativeLabel: formatRelativeAfter(startMs, ms, language),
        category: 'sun',
        categoryLabel: L3(language, '태양 · 일출 노을', 'Sunrise & Glow', '日の出・朝焼け'),
        title: L3(language, `일출 (${dir} ${sunAz.toFixed(0)}°)`, `Sunrise (${dir} ${sunAz.toFixed(0)}°)`, `日の出 (${dir} ${sunAz.toFixed(0)}°)`),
        badge: scoreVal != null ? L3(language, `노을 ${scoreVal}점`, `Glow ${scoreVal}`, `朝焼け ${scoreVal}点`) : (dir ?? undefined),
        quality: fe?.quality ?? null,
        score: scoreVal,
        description: L3(language,
          `${dir} 지평선에서 해가 떠오릅니다.${peakStr ? ` 가장 붉은 시각은 ${peakStr} 무렵이며,` : ''}${reason ? ` ${reason}.` : ''}${wb.note ? ` (${wb.note})` : ''}`,
          `The Sun rises on the ${dir} horizon.${peakStr ? ` Peak glow around ${peakStr}.` : ''}${reason ? ` ${reason}.` : ''}${wb.note ? ` (${wb.note})` : ''}`,
          `${dir}の地平線から太陽が昇ります。${peakStr ? `最も赤く染まるのは${peakStr}頃です。` : ''}${reason ? ` ${reason}。` : ''}${wb.note ? ` (${wb.note})` : ''}`),
        topic: 'score',
      });
    }

    // 4) 저녁 골든아워 시작
    if (inWindow(st.goldenHour)) {
      const ms = st.goldenHour.getTime();
      const wb = weatherBriefAt(ms);
      pushUnique({
        id: `goldenHour_${ms}`,
        timeMs: ms,
        relativeLabel: formatRelativeAfter(startMs, ms, language),
        category: 'twilight',
        categoryLabel: L3(language, '골든아워', 'Golden Hour', 'ゴールデンアワー'),
        title: L3(language, '저녁 골든아워 시작', 'Evening Golden Hour Begins', '夕方のゴールデンアワー開始'),
        badge: L3(language, '태양 +6°', 'Sun +6°', '太陽 +6°'),
        description: L3(language,
          `태양 고도가 6° 아래로 내려가며 부드럽고 긴 황금빛 그림자와 노을 전조가 시작됩니다. 인물·풍경 촬영에 가장 입체적인 빛이 들어오는 시간입니다.${wb.note ? ` · ${wb.note}` : ''}`,
          `The Sun drops below +6°, casting warm golden light and long shadows ahead of sunset.${wb.note ? ` · ${wb.note}` : ''}`,
          `太陽高度が6°を下回り、柔らかい黄金色の光と長い影が始まります。${wb.note ? ` · ${wb.note}` : ''}`),
        topic: 'score',
      });
    }

    // 5) 일몰 (Sunset)
    if (inWindow(st.sunset)) {
      const ms = st.sunset.getTime();
      const fe = findForecastEvent('sunset', ms);
      const wb = weatherBriefAt(ms);
      const sunAz = ((sunPosition(st.sunset, lat, lon).azimuth * DEG + 180) % 360 + 360) % 360;
      const dir = skyDirection(sunAz, language);
      const peakStr = fe?.peakAt ? fmtTime(fe.peakAt.getTime()) : null;
      const reason = fe?.description ? translateSunsetDesc(fe.description, language) : '';
      const scoreVal = fe?.score != null ? Math.round(fe.score) : null;

      pushUnique({
        id: `sunset_${ms}`,
        timeMs: ms,
        relativeLabel: formatRelativeAfter(startMs, ms, language),
        category: 'sun',
        categoryLabel: L3(language, '태양 · 일몰 노을', 'Sunset & Glow', '日の入り・夕焼け'),
        title: L3(language, `일몰 (${dir} ${sunAz.toFixed(0)}°)`, `Sunset (${dir} ${sunAz.toFixed(0)}°)`, `日の入り (${dir} ${sunAz.toFixed(0)}°)`),
        badge: scoreVal != null ? L3(language, `노을 ${scoreVal}점`, `Glow ${scoreVal}`, `夕焼け ${scoreVal}点`) : (dir ?? undefined),
        quality: fe?.quality ?? null,
        score: scoreVal,
        description: L3(language,
          `${dir} 지평선 아래로 해가 넘어갑니다.${peakStr ? ` 가장 붉게 타오르는 시각은 ${peakStr} 무렵이며,` : ''}${reason ? ` ${reason}.` : ''}${wb.note ? ` (${wb.note})` : ''}`,
          `The Sun sets on the ${dir} horizon.${peakStr ? ` Peak glow around ${peakStr}.` : ''}${reason ? ` ${reason}.` : ''}${wb.note ? ` (${wb.note})` : ''}`,
          `${dir}の地平線へ太陽が沈みます。${peakStr ? `最も赤く焼けるのは${peakStr}頃です。` : ''}${reason ? ` ${reason}。` : ''}${wb.note ? ` (${wb.note})` : ''}`),
        topic: 'score',
      });
    }

    // 6) 저녁 시민 박명 종료 (블루아워 마감 & 별 출현 시작)
    if (inWindow(st.dusk)) {
      const ms = st.dusk.getTime();
      const wb = weatherBriefAt(ms);
      pushUnique({
        id: `dusk_${ms}`,
        timeMs: ms,
        relativeLabel: formatRelativeAfter(startMs, ms, language),
        category: 'twilight',
        categoryLabel: L3(language, '블루아워 · 박명', 'Blue Hour', 'ブルーアワー'),
        title: L3(language, '시민 박명 종료 · 항해 박명 진입', 'Civil Dusk · Blue Hour Transitions to Night', '市民薄明終了・航海薄明へ'),
        badge: L3(language, '태양 -6°', 'Sun -6°', '太陽 -6°'),
        description: L3(language,
          `태양이 -6° 아래로 내려가며 붉은 잔광이 마무리되고, 금성·목성 같은 밝은 행성과 1등성이 하늘에 모습을 드러내기 시작합니다.${wb.note ? ` · ${wb.note}` : ''}`,
          `The Sun drops below -6°, concluding the red afterglow as bright planets and first-magnitude stars emerge.${wb.note ? ` · ${wb.note}` : ''}`,
          `太陽が-6°を下回り赤い残照が終わり、金星や木星などの明るい惑星と一等星が見え始めます。${wb.note ? ` · ${wb.note}` : ''}`),
        topic: 'sunrise',
      });
    }

    // 7) 저녁 천문 박명 종료 (완전한 밤 시작 & 별/은하수 관측 개시)
    if (inWindow(st.night)) {
      const ms = st.night.getTime();
      const wb = weatherBriefAt(ms);
      const mPos = getMoonPositionPrecise(st.night, lat, lon, elevM);
      const mAlt = mPos.altitude * DEG;
      const mIllum = SunCalc.getMoonIllumination(st.night);
      const sW = wb.obs ? starWeatherOf(wb.obs) : null;
      const lim = starLimit({
        cloudPct: sW?.cloudPct ?? 0,
        sunAltDeg: -19,
        moonAltDeg: mAlt,
        moonIllum: mIllum.fraction,
        lightPollutionMag: lightPollutionMag ?? null,
        aod550: sW?.aod550,
        visibilityM: sW?.visibilityM,
        humidityPct: sW?.humidityPct,
        pm25: sW?.pm25,
      });
      const magStr = (Math.round(lim.limitMag * 10) / 10).toFixed(1);

      pushUnique({
        id: `night_${ms}`,
        timeMs: ms,
        relativeLabel: formatRelativeAfter(startMs, ms, language),
        category: 'star',
        categoryLabel: L3(language, '별 · 은하수 관측', 'Stargazing', '星・天の川観測'),
        title: L3(language, '완전한 밤 시작 · 별/은하수 관측 개시', 'Astronomical Night Begins · Stargazing Window', '完全な夜の始まり・星空観測開始'),
        badge: L3(language, `한계 ${magStr}등급`, `Mag ${magStr}`, `限界 ${magStr}等`),
        description: L3(language,
          `태양이 -18° 아래로 내려가 대기 중 태양 산란광이 완전히 사라집니다. 이 시각 예상 한계등급은 약 ${magStr}등급이며, ${mAlt > 0 ? `달이 고도 +${mAlt.toFixed(0)}°(밝기 ${Math.round(mIllum.fraction * 100)}%)에 떠 있습니다.` : '달도 지평선 아래에 있어 밤하늘이 매우 어둡습니다.'}${wb.note ? ` (${wb.note})` : ''}`,
          `The Sun drops below -18° for complete astronomical darkness. Expected limiting magnitude is ~${magStr}, and ${mAlt > 0 ? `the Moon is at +${mAlt.toFixed(0)}° (${Math.round(mIllum.fraction * 100)}%).` : 'the Moon is below the horizon for maximum darkness.'}${wb.note ? ` (${wb.note})` : ''}`,
          `太陽が-18°を下回り完全な夜になります。予想限界等級は約${magStr}等で、${mAlt > 0 ? `月が高度+${mAlt.toFixed(0)}°(${Math.round(mIllum.fraction * 100)}%)にあります。` : '月も地平線下にあり非常に暗い夜空になります。'}${wb.note ? ` (${wb.note})` : ''}`),
        topic: 'stars',
      });
    }

    // 8) 저녁 행성 관측 적기 (항해 박명 직후 지평선 위 10° 이상 행성들)
    const planetCheckTime = st.dusk && Number.isFinite(st.dusk.getTime())
      ? new Date(st.dusk.getTime() + 30 * 60_000)
      : null;
    if (inWindow(planetCheckTime)) {
      const ms = planetCheckTime.getTime();
      const pls = getCalculatedPlanets(lat, lon, planetCheckTime)
        .filter(p => p.altitude >= 10)
        .sort((a, b) => b.altitude - a.altitude);
      if (pls.length > 0) {
        const wb = weatherBriefAt(ms);
        const names = pls.map(p => `${planetDisplayName(p.key, language === 'en' ? p.nameEn : p.nameKo, language)}(${skyDirection(p.azimuth, language)} ${Math.round(p.altitude)}°)`).join(' · ');
        pushUnique({
          id: `planets_${ms}`,
          timeMs: ms,
          relativeLabel: formatRelativeAfter(startMs, ms, language),
          category: 'planet',
          categoryLabel: L3(language, '행성 관측', 'Planets', '惑星観測'),
          title: L3(language, `초저녁 행성 관측 적기 (${pls.map(p => planetDisplayName(p.key, language === 'en' ? p.nameEn : p.nameKo, language)).join('·')})`, `Evening Planets Visible (${pls.map(p => planetDisplayName(p.key, language === 'en' ? p.nameEn : p.nameKo, language)).join(' · ')})`, `宵の惑星観測好機 (${pls.map(p => planetDisplayName(p.key, language === 'en' ? p.nameEn : p.nameKo, language)).join('・')})`),
          badge: L3(language, `${pls.length}개 행성`, `${pls.length} planets`, `${pls.length}惑星`),
          description: L3(language,
            `어둠이 내린 하늘에서 ${names}이 고도 10° 이상 높이 떠 있어 맨눈이나 망원경으로 관측하기 좋습니다.${wb.note ? ` · ${wb.note}` : ''}`,
            `Above 10° altitude in the evening sky: ${names}.${wb.note ? ` · ${wb.note}` : ''}`,
            `夕闇の空に${names}が高度10°以上に昇り、肉眼や望遠鏡での観測に最適です。${wb.note ? ` · ${wb.note}` : ''}`),
          topic: 'stars',
        });
      }
    }
  }

  // 9) 앞으로 24시간 내 월출(Moonrise) 및 월몰(Moonset)
  const moonEvents = moonRiseSet(startMs, lat, lon, 24);
  if (inWindow(moonEvents.rise)) {
    const ms = moonEvents.rise.getTime();
    const mPos = getMoonPositionPrecise(moonEvents.rise, lat, lon, elevM);
    const mAz = ((mPos.azimuth * DEG + 180) % 360 + 360) % 360;
    const mDir = skyDirection(mAz, language);
    const mIllum = SunCalc.getMoonIllumination(moonEvents.rise);
    const mPct = Math.round(mIllum.fraction * 100);
    const mName = moonPhaseWord(mIllum.phase, mIllum.fraction, language);
    const wb = weatherBriefAt(ms);

    pushUnique({
      id: `moonrise_${ms}`,
      timeMs: ms,
      relativeLabel: formatRelativeAfter(startMs, ms, language),
      category: 'moon',
      categoryLabel: L3(language, '달 · 월출', 'Moonrise', '月の出'),
      title: L3(language, `월출 — ${mName}(밝기 ${mPct}%)`, `Moonrise — ${mName} (${mPct}%)`, `月の出 — ${mName}(輝面 ${mPct}%)`),
      badge: `${mDir} ${mAz.toFixed(0)}°`,
      description: L3(language,
        `${mDir} 지평선(방위 ${mAz.toFixed(0)}°)에서 ${mName}(밝기 ${mPct}%)이 떠오릅니다. 지평선 바로 위에서는 대기 굴절과 지상 지형물 대비로 달이 평소보다 크고 붉게 보입니다.${wb.note ? ` · ${wb.note}` : ''}`,
        `A ${mPct}% illuminated ${mName} rises on the ${mDir} horizon (AZ ${mAz.toFixed(0)}°), appearing warm and large near foreground landmarks.${wb.note ? ` · ${wb.note}` : ''}`,
        `${mDir}の地平線(方位${mAz.toFixed(0)}°)から${mName}(輝面${mPct}%)が昇ります。地平線付近では月が大きく赤みを帯びて見えます。${wb.note ? ` · ${wb.note}` : ''}`),
      topic: 'stars',
    });
  }

  if (inWindow(moonEvents.set)) {
    const ms = moonEvents.set.getTime();
    const mPos = getMoonPositionPrecise(moonEvents.set, lat, lon, elevM);
    const mAz = ((mPos.azimuth * DEG + 180) % 360 + 360) % 360;
    const mDir = skyDirection(mAz, language);
    const mIllum = SunCalc.getMoonIllumination(moonEvents.set);
    const mPct = Math.round(mIllum.fraction * 100);
    const mName = moonPhaseWord(mIllum.phase, mIllum.fraction, language);
    const sAlt = sunPosition(moonEvents.set, lat, lon).altitude * DEG;
    const wb = weatherBriefAt(ms);

    pushUnique({
      id: `moonset_${ms}`,
      timeMs: ms,
      relativeLabel: formatRelativeAfter(startMs, ms, language),
      category: 'moon',
      categoryLabel: L3(language, '달 · 월몰', 'Moonset', '月の入り'),
      title: L3(language, `월몰 — ${mName}(밝기 ${mPct}%)`, `Moonset — ${mName} (${mPct}%)`, `月の入り — ${mName}(輝面 ${mPct}%)`),
      badge: `${mDir} ${mAz.toFixed(0)}°`,
      description: L3(language,
        `${mDir} 지평선(방위 ${mAz.toFixed(0)}°) 아래로 달이 집니다.${sAlt < -12 && mPct >= 20 ? ' 달이 진 직후부터 하늘 배경이 한층 어두워져 은하수와 어두운 별 관측 여건이 크게 좋아집니다.' : ''}${wb.note ? ` · ${wb.note}` : ''}`,
        `The Moon sets on the ${mDir} horizon (AZ ${mAz.toFixed(0)}°).${sAlt < -12 && mPct >= 20 ? ' Once the Moon sets, the night sky darkens significantly for stargazing.' : ''}${wb.note ? ` · ${wb.note}` : ''}`,
        `${mDir}の地平線(方位${mAz.toFixed(0)}°)へ月が沈みます。${sAlt < -12 && mPct >= 20 ? '月の入り直後から夜空が一段と暗くなり、天の川観測の好機となります。' : ''}${wb.note ? ` · ${wb.note}` : ''}`),
      topic: 'stars',
    });
  }

  // 10) 시간별 기상 변화 이벤트 (강수 시작/종료, 구름 크게 걷힘/두꺼워짐)
  const { obs: curObs, path: activePath } = weatherAtTime(selectedTime, ringFor, forecast);
  if (curObs && activePath) {
    let prevRain = (curObs.precipitation ?? 0) >= 0.25;
    let prevCloud = typeof curObs.total === 'number' && Number.isFinite(curObs.total)
      ? curObs.total
      : Math.max(curObs.low, curObs.mid, curObs.high);
    let rainEventAdded = false;
    let cloudEventAdded = false;

    for (let h = 1; h <= 24; h++) {
      const probeMs = Math.ceil(startMs / 3600_000) * 3600_000 + (h - 1) * 3600_000;
      if (probeMs <= startMs || probeMs > horizonMs) continue;
      const { obs: pObs } = weatherAtTime(new Date(probeMs), ringFor, forecast);
      if (!pObs) continue;

      const rainAmt = pObs.precipitation ?? 0;
      const isRain = rainAmt >= 0.25;
      const cloudPct = Math.round(typeof pObs.total === 'number' && Number.isFinite(pObs.total)
        ? pObs.total
        : Math.max(pObs.low, pObs.mid, pObs.high));

      if (!rainEventAdded && isRain !== prevRain) {
        rainEventAdded = true;
        if (isRain) {
          pushUnique({
            id: `weather_rain_start_${probeMs}`,
            timeMs: probeMs,
            relativeLabel: formatRelativeAfter(startMs, probeMs, language),
            category: 'weather',
            categoryLabel: L3(language, '기상 변화', 'Weather Shift', '気象変化'),
            title: L3(language, `강수 시작 예보 (시간당 ${rainAmt.toFixed(1)}mm)`, `Precipitation Expected (${rainAmt.toFixed(1)}mm/h)`, `降水開始の予報 (${rainAmt.toFixed(1)}mm/h)`),
            badge: L3(language, `운량 ${cloudPct}%`, `Cloud ${cloudPct}%`, `雲量 ${cloudPct}%`),
            description: L3(language,
              `이 시각 무렵부터 시간당 약 ${rainAmt.toFixed(1)}mm의 강수가 시작될 것으로 예보되어 있습니다. 촬영 및 관측 일정을 앞당기거나 방수 장비를 준비하세요.`,
              `Precipitation (~${rainAmt.toFixed(1)} mm/h) is forecast to begin around this hour.`,
              `この時刻頃から時間約${rainAmt.toFixed(1)}mmの降水が始まる予報です。`),
            topic: 'cloud',
          });
        } else {
          pushUnique({
            id: `weather_rain_stop_${probeMs}`,
            timeMs: probeMs,
            relativeLabel: formatRelativeAfter(startMs, probeMs, language),
            category: 'weather',
            categoryLabel: L3(language, '기상 변화', 'Weather Shift', '気象変化'),
            title: L3(language, '강수 그침 예보', 'Precipitation Ends', '降水終了の予報'),
            badge: L3(language, `운량 ${cloudPct}%`, `Cloud ${cloudPct}%`, `雲量 ${cloudPct}%`),
            description: L3(language,
              `강수가 그치고 대기가 차츰 안정됩니다. 비가 그친 직후에는 대기 중 먼지가 씻겨 내려가 시정이 맑아지고 지면에 물웅덩이 반영 촬영을 노리기 좋습니다.`,
              `Precipitation is forecast to taper off, often leaving washed, high-clarity air and wet ground reflections.`,
              `降水が止み、大気中の塵が洗い流されて視程が澄みやすくなります。`),
            topic: 'cloud',
          });
        }
      }
      prevRain = isRain;

      if (!cloudEventAdded) {
        if (prevCloud >= 60 && cloudPct <= 25) {
          cloudEventAdded = true;
          pushUnique({
            id: `weather_clear_${probeMs}`,
            timeMs: probeMs,
            relativeLabel: formatRelativeAfter(startMs, probeMs, language),
            category: 'weather',
            categoryLabel: L3(language, '기상 변화', 'Weather Shift', '気象変化'),
            title: L3(language, `구름 걷히고 하늘 맑아짐 (총운량 ${cloudPct}%)`, `Clouds Clearing (${cloudPct}% cover)`, `雲が晴れて快晴へ (全雲量 ${cloudPct}%)`),
            badge: L3(language, `${Math.round(prevCloud)}% → ${cloudPct}%`, `${Math.round(prevCloud)}% → ${cloudPct}%`, `${Math.round(prevCloud)}% → ${cloudPct}%`),
            description: L3(language,
              `두껍게 끼어 있던 구름이 걷히며 총운량이 ${cloudPct}%(하 ${Math.round(pObs.low)} · 중 ${Math.round(pObs.mid)} · 상 ${Math.round(pObs.high)}%)까지 줄어듭니다. 천체 관측이나 깔끔한 하늘 촬영에 좋은 창이 열립니다.`,
              `Cloud cover drops sharply to ${cloudPct}%, opening a clear window for observation and photography.`,
              `厚い雲が抜けて全雲量が${cloudPct}%まで減少し、観測や撮影に好条件の窓が開きます。`),
            topic: 'cloud',
          });
        } else if (prevCloud <= 30 && cloudPct >= 75) {
          cloudEventAdded = true;
          pushUnique({
            id: `weather_overcast_${probeMs}`,
            timeMs: probeMs,
            relativeLabel: formatRelativeAfter(startMs, probeMs, language),
            category: 'weather',
            categoryLabel: L3(language, '기상 변화', 'Weather Shift', '気象変化'),
            title: L3(language, `구름 유입으로 하늘 흐려짐 (총운량 ${cloudPct}%)`, `Clouds Thickening (${cloudPct}% cover)`, `雲の流入で曇天へ (全雲量 ${cloudPct}%)`),
            badge: L3(language, `${Math.round(prevCloud)}% → ${cloudPct}%`, `${Math.round(prevCloud)}% → ${cloudPct}%`, `${Math.round(prevCloud)}% → ${cloudPct}%`),
            description: L3(language,
              `구름대가 유입되면서 총운량이 ${cloudPct}%(하 ${Math.round(pObs.low)} · 중 ${Math.round(pObs.mid)} · 상 ${Math.round(pObs.high)}%)로 늘어납니다. 별 관측은 이 시각 이전에 진행하는 것이 유리합니다.`,
              `Cloud cover thickens to ${cloudPct}% (low ${Math.round(pObs.low)} · mid ${Math.round(pObs.mid)} · high ${Math.round(pObs.high)}%).`,
              `雲が流入し全雲量が${cloudPct}%まで増加します。星空観測はこの時刻より前に行うのが有利です。`),
            topic: 'cloud',
          });
        }
      }
      prevCloud = cloudPct;
    }
  }

  // 11) 향후 16일 내 개기/부분 월식 안내
  const eclipse = nextLunarEclipse(startMs);
  const eclipsePlan = eclipse && eclipse.greatestMs - startMs <= 16 * 86400_000
    ? planEclipse(eclipse, lat, lon)
    : null;
  if (eclipse && eclipsePlan && eclipsePlan.visible && eclipse.greatestMs > startMs) {
    const ms = eclipse.greatestMs;
    const peakDate = new Date(ms);
    const moonAltAtPeak = getMoonPositionPrecise(peakDate, lat, lon, elevM).altitude * DEG;
    const kindWord = eclipse.kind === 'total'
      ? L3(language, '개기월식 (블러드문)', 'Total Lunar Eclipse (Blood Moon)', '皆既月食 (ブラッドムーン)')
      : L3(language, '부분월식', 'Partial Lunar Eclipse', '部分月食');
    pushUnique({
      id: `eclipse_${ms}`,
      timeMs: ms,
      relativeLabel: formatRelativeAfter(startMs, ms, language),
      category: 'eclipse',
      categoryLabel: L3(language, '특이 천문 현상', 'Lunar Eclipse', '月食'),
      title: `${kindWord} · ${peakDate.getMonth() + 1}/${peakDate.getDate()}`,
      badge: `${moonAltAtPeak.toFixed(0)}°`,
      description: L3(language,
        `달이 지구 본그림자에 들어가 붉게 물드는 ${kindWord}이 예정되어 있습니다 (최대 식 시각 고도 ${moonAltAtPeak.toFixed(0)}°).`,
        `An upcoming ${kindWord} with peak altitude ${moonAltAtPeak.toFixed(0)}°.`,
        `月が地球の本影に入る${kindWord}が予定されています(最大食時の高度${moonAltAtPeak.toFixed(0)}°)。`),
      topic: 'stars',
    });
  }

  return events.sort((a, b) => a.timeMs - b.timeMs);
};
