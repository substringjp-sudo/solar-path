/**
 * celestialEvents.ts
 * 
 * 추천(Recommended) 및 일반(General) 천문 이벤트를 추출하는 유틸리티.
 * - 추천: 노을/일출 퀄리티 우수 시각, 해진 후 초승달(눈썹달) 관측 시각, 은하수 관측 적기 등
 * - 일반: 일출, 일몰, 남중, 월출, 월몰, 골든아워
 */
import SunCalc from 'suncalc';
import { addHours, startOfDay, format } from 'date-fns';
import { SunsetPrediction } from './sunsetPhysics';
import { getMoonPosition, getSunPosition } from './celestial';
import { getPlanetEquatorialCoord, PLANETS_METADATA } from './celestialPlanets';
import { equatorialToHorizontal } from './celestialCoords';

export interface CelestialEventItem {
  id: string;
  time: Date;
  title: string;
  subtitle: string;
  category: 'recommended' | 'general';
  type: 'sunset' | 'sunrise' | 'crescent_moon' | 'milky_way' | 'solar_noon' | 'moonrise' | 'moonset' | 'planet';
  badge?: string;
  iconName?: string;
}

export function getDailyCelestialEvents(
  date: Date,
  lat: number,
  lng: number,
  prediction?: SunsetPrediction | null
): CelestialEventItem[] {
  const events: CelestialEventItem[] = [];
  const dayStart = startOfDay(date);
  
  // 1. 기본 일출, 일몰, 월출, 월몰 시각 계산
  const sunTimes = SunCalc.getTimes(date, lat, lng);
  const moonTimes = SunCalc.getMoonTimes(date, lat, lng);
  const moonIllum = SunCalc.getMoonIllumination(date);

  // --- 일반 이벤트: 일출 ---
  if (sunTimes.sunrise) {
    events.push({
      id: 'evt_sunrise',
      time: sunTimes.sunrise,
      title: '일출',
      subtitle: format(sunTimes.sunrise, 'HH:mm'),
      category: 'general',
      type: 'sunrise',
      iconName: 'Sunrise',
    });
  }

  // --- 일반 이벤트: 태양 남중 (Solar Noon) ---
  if (sunTimes.solarNoon) {
    events.push({
      id: 'evt_solar_noon',
      time: sunTimes.solarNoon,
      title: '태양 남중',
      subtitle: format(sunTimes.solarNoon, 'HH:mm'),
      category: 'general',
      type: 'solar_noon',
      iconName: 'Sun',
    });
  }

  // --- 일반/추천 이벤트: 일몰 및 노을 ---
  if (sunTimes.sunset) {
    const isQualityGood = prediction && (prediction.quality === 'Great' || prediction.quality === 'Epic' || prediction.score >= 70);
    events.push({
      id: 'evt_sunset',
      time: sunTimes.sunset,
      title: isQualityGood ? '🔥 환상적인 노을' : '일몰',
      subtitle: `${format(sunTimes.sunset, 'HH:mm')}${prediction ? ` · ${prediction.score}점` : ''}`,
      category: isQualityGood ? 'recommended' : 'general',
      type: 'sunset',
      badge: isQualityGood ? (prediction.quality === 'Epic' ? '최상급 노을' : '추천 노을') : undefined,
      iconName: 'Sunset',
    });
  }

  // --- 일반 이벤트: 월출/월몰 ---
  if (moonTimes.rise) {
    events.push({
      id: 'evt_moonrise',
      time: moonTimes.rise,
      title: '월출',
      subtitle: format(moonTimes.rise, 'HH:mm'),
      category: 'general',
      type: 'moonrise',
      iconName: 'Moon',
    });
  }
  if (moonTimes.set) {
    events.push({
      id: 'evt_moonset',
      time: moonTimes.set,
      title: '월몰',
      subtitle: format(moonTimes.set, 'HH:mm'),
      category: 'general',
      type: 'moonset',
      iconName: 'Moon',
    });
  }

  // --- 추천 이벤트: 해진 직후 초승달(눈썹달) 관측 골든타임 ---
  // 조건: 달의 위상(fraction)이 0.05 ~ 0.25 (초승달) 사이이고, 일몰 후 20~60분 사이 달이 지평선 위에 있을 때
  if (sunTimes.sunset && moonIllum.fraction >= 0.03 && moonIllum.fraction <= 0.28 && moonIllum.phase < 0.5) {
    const crescentCheckTime = new Date(sunTimes.sunset.getTime() + 35 * 60 * 1000); // 일몰 35분 뒤
    const moonPos = getMoonPosition(crescentCheckTime, lat, lng);
    if (moonPos.altitude > 2) {
      events.push({
        id: 'evt_crescent_moon',
        time: crescentCheckTime,
        title: '🌙 초승달(눈썹달) 관측',
        subtitle: `${format(crescentCheckTime, 'HH:mm')} · 일몰 직후 서쪽 하늘`,
        category: 'recommended',
        type: 'crescent_moon',
        badge: '낭만적인 야경',
        iconName: 'Moon',
      });
    }
  }

  // --- 추천 이벤트: 은하수 & 밤하늘 관측 타임 ---
  // 조건: 심야 시간(22:00 ~ 03:00) 중 달 고도가 -5도 이하이거나 달빛 위상이 매우 적을 때
  const midnightTime = new Date(dayStart.getTime() + 23 * 3600 * 1000); // 23:00
  const midnightMoonPos = getMoonPosition(midnightTime, lat, lng);
  if (midnightMoonPos.altitude < 0 || moonIllum.fraction < 0.3) {
    events.push({
      id: 'evt_milky_way',
      time: midnightTime,
      title: '🌌 은하수 & 밤하늘 관측',
      subtitle: `${format(midnightTime, 'HH:mm')} · 맑은 딥스카이`,
      category: 'recommended',
      type: 'milky_way',
      badge: '달빛 적음',
      iconName: 'Sparkles',
    });
  }

  // --- 추천/일반 이벤트: 주요 밝은 행성(금성/목성) 관측 ---
  // 금성(Venus)이 일몰 직후 고도 10도 이상일 때 "샛별 관측" 추천
  if (sunTimes.sunset) {
    const duskTime = new Date(sunTimes.sunset.getTime() + 45 * 60 * 1000);
    const venusEq = getPlanetEquatorialCoord('venus', duskTime);
    const venusHor = equatorialToHorizontal(venusEq, lat, lng, duskTime);
    if (venusHor.altitudeDeg > 8) {
      events.push({
        id: 'evt_venus_dusk',
        time: duskTime,
        title: '♀ 밝은 금성(샛별) 관측',
        subtitle: `${format(duskTime, 'HH:mm')} · 서쪽 고도 ${Math.round(venusHor.altitudeDeg)}°`,
        category: 'recommended',
        type: 'planet',
        badge: '가장 밝은 행성',
        iconName: 'Star',
      });
    }
  }

  // 시간순 정렬
  return events.sort((a, b) => a.time.getTime() - b.time.getTime());
}
