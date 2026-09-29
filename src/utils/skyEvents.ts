/**
 * skyEvents.ts — 하늘 탭 아래 시트의 "추천 · 일반 이벤트" 목록.
 *
 * ⚠ 예전 목록은 **계산이 아니라 고정 문구**였습니다(점검 2026-09-29): 날씨·달과 무관하게 늘
 *   "훌륭한 일몰 · 추천 95점", "훌륭한 일출 · 90점", "은하수 관측 적기", "행성 & 야경 22:00" 이
 *   떴고, 일출·일몰 시각을 모르면 06:12 · 19:35 같은 **지어낸 시각**을 썼습니다. 보름달 밤에도
 *   은하수를 권했습니다.
 *
 * 이제 목록의 모든 줄은 계산에서 나옵니다. 모르는 것은 **안 띄웁니다**:
 *  - 일몰·일출: 그 시각의 노을 예측(`scenePrediction`)이 있으면 품질과 점수를, 없으면 "날씨를
 *    받으면 예측" 이라고만 적습니다.
 *  - 초승달·그믐달: 위상이 가늘고(조명 < 25%), 해진 뒤 40분(초승달) · 해뜨기 40분 전(그믐달)에
 *    달이 5° 넘게 떠 있을 때만.
 *  - 은하수: 천문 박명이 끝난 뒤 30분에 달이 지평선 아래이거나 조명 20% 미만일 때만.
 *  - 행성: 항해 박명이 끝난 뒤 30분에 10° 넘게 떠 있는 행성만, 이름을 적어서.
 *  - 일반: 그날 실제로 있는 출몰만(극지·달 없는 날엔 빠짐).
 */
import SunCalc from 'suncalc';
import { getCalculatedPlanets, type PlanetKey } from './celestialPlanets';
import { t, type Language } from './i18n';

export interface SkyEventItem {
  id: string;
  title: string;
  time: Date;
  category: 'featured' | 'general';
  badge?: string;
  description: string;
}

export interface SkyEventsInput {
  date: Date;
  latitude: number;
  longitude: number;
  events?: { sunrise?: Date | null; sunset?: Date | null; moonrise?: Date | null; moonset?: Date | null } | null;
  /** 그 시각의 노을 예측(없으면 null) — 부르는 쪽이 `scenePrediction` 으로 셈. */
  sunsetPrediction?: { score: number; quality: string } | null;
  sunrisePrediction?: { score: number; quality: string } | null;
  language: Language;
}

const valid = (d?: Date | null): d is Date => !!d && !isNaN(d.getTime());
const R2D = 180 / Math.PI;
const PLANET_JA: Record<PlanetKey, string> = { mercury: '水星', venus: '金星', mars: '火星', jupiter: '木星', saturn: '土星' };
const PLANET_KO: Record<PlanetKey, string> = { mercury: '수성', venus: '금성', mars: '화성', jupiter: '목성', saturn: '토성' };

const qualityKey = (q: string) =>
  (q === 'Epic' ? 'evQ_Epic' : q === 'Great' ? 'evQ_Great' : q === 'Fair' ? 'evQ_Fair'
    : q === 'Overcast' ? 'evQ_Overcast' : 'evQ_Muted') as Parameters<typeof t>[0];

export function buildSkyEvents(inp: SkyEventsInput): SkyEventItem[] {
  const { date, latitude: lat, longitude: lon, events, language: L } = inp;
  const out: SkyEventItem[] = [];
  const score = (n: number) => t('evScore', L).replace('{n}', String(Math.round(n)));
  const moonAlt = (tm: Date) => SunCalc.getMoonPosition(tm, lat, lon).altitude * R2D;

  // ── 일몰 · 일출 — 예측이 있을 때만 품질을 말합니다 ─────────────────────────
  const glow = (id: 'sunset' | 'sunrise', time: Date | null | undefined, pred?: { score: number; quality: string } | null) => {
    if (!valid(time)) return;
    const name = t(id === 'sunset' ? 'sunset' : 'sunrise', L);
    out.push(pred
      ? { id: `f_${id}`, title: `${name} · ${t(qualityKey(pred.quality), L)}`, time, category: 'featured',
          badge: score(pred.score), description: t(id === 'sunset' ? 'evSunsetDesc' : 'evSunriseDesc', L) }
      : { id: `f_${id}`, title: name, time, category: 'featured', description: t('evNoForecast', L) });
  };
  glow('sunset', events?.sunset, inp.sunsetPrediction);
  glow('sunrise', events?.sunrise, inp.sunrisePrediction);

  // ── 가는 달 — 초승달은 저녁 서쪽, 그믐달은 새벽 동쪽 ───────────────────────
  const illum = SunCalc.getMoonIllumination(date);
  if (illum.fraction < 0.25) {
    const waxing = illum.phase < 0.5;
    const anchor = waxing ? events?.sunset : events?.sunrise;
    if (valid(anchor)) {
      const tm = new Date(anchor.getTime() + (waxing ? 40 : -40) * 60000);
      if (moonAlt(tm) > 5) {
        out.push({
          id: 'f_crescent', time: tm, category: 'featured',
          title: t(waxing ? 'evCrescentEve' : 'evCrescentMorn', L),
          description: t(waxing ? 'evCrescentEveDesc' : 'evCrescentMornDesc', L),
          badge: `${Math.round(illum.fraction * 100)}%`,
        });
      }
    }
  }

  // ── 은하수 — 천문 박명 뒤, 달이 없거나 아주 가늘 때 ────────────────────────
  const times = SunCalc.getTimes(date, lat, lon);
  if (valid(times.night)) {
    const tm = new Date(times.night.getTime() + 30 * 60000);
    const mIll = SunCalc.getMoonIllumination(tm).fraction;
    if (moonAlt(tm) < 0 || mIll < 0.2) {
      out.push({ id: 'f_milkyway', time: tm, category: 'featured', title: t('evMilkyWay', L), description: t('evMilkyWayDesc', L) });
    }
  }

  // ── 행성 — 항해 박명 뒤 30분에 10° 넘게 뜬 것만 ────────────────────────────
  if (valid(times.nauticalDusk)) {
    const tm = new Date(times.nauticalDusk.getTime() + 30 * 60000);
    const up = getCalculatedPlanets(lat, lon, tm).filter(p => p.altitude > 10);
    if (up.length) {
      const names = up.map(p => (L === 'ko' ? PLANET_KO[p.key as PlanetKey] : L === 'ja' ? PLANET_JA[p.key as PlanetKey] : p.nameEn));
      out.push({ id: 'f_planets', time: tm, category: 'featured', title: t('evPlanets', L), description: names.join(' · ') });
    }
  }

  // ── 일반 — 실제 있는 출몰만 ─────────────────────────────────────────────────
  const gen: [string, Date | null | undefined, Parameters<typeof t>[0]][] = [
    ['g_sunrise', events?.sunrise, 'sunrise'], ['g_sunset', events?.sunset, 'sunset'],
    ['g_moonrise', events?.moonrise, 'moonrise'], ['g_moonset', events?.moonset, 'moonset'],
  ];
  for (const [id, tm, key] of gen) {
    if (!valid(tm)) continue;
    out.push({ id, time: tm, category: 'general', title: t(key, L), description: t('evTodayTime', L).replace('{x}', t(key, L)) });
  }

  // 추천은 시각 순으로.
  out.sort((a, b) => (a.category === b.category ? a.time.getTime() - b.time.getTime() : a.category === 'featured' ? -1 : 1));
  return out;
}
