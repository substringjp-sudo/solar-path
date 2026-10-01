/**
 * notificationPlan.ts — 하늘 이벤트 알림 계획(순수 함수). 무엇을 언제 알릴지만 정하고, 실제 예약은
 * `notificationScheduler.ts` 가 합니다(2026-09-30).
 *
 * 사용자 요청: "하루 24시간 시뮬레이션이 가능하니 굳이 골든아워만 알림을 줄 필요는 없고 알림설정을
 * 만들어서 일출일몰외에도 다양한 이벤트를 알림하면 좋을거같아."
 *
 * 노을 예보(일몰 2시간 전)와 일출 예보(전날 밤 22시)는 날씨·예측·그림을 붙이는 따로 된 흐름
 * (`useCelestialApp`)이 그대로 맡고, 여기서는 **천체력만으로 정해지는** 이벤트를 계획합니다:
 *
 *  - 골든아워   저녁: 해가 6° 로 내려오는 시각 · 아침: 일출
 *  - 블루아워   저녁: 해가 −4° 로 내려가는 시각 · 아침: 해가 −6° 로 올라오는 시각(시민 박명 시작)
 *  - 월출       달이 뜨는 시각(조명 비율을 함께 적음)
 *  - 가는 달    초승달(해진 뒤 40분) · 그믐달(해뜨기 40분 전) — `buildSkyEvents` 와 같은 판단
 *  - 은하수     천문 박명 뒤 달빛이 없는 밤 — `buildSkyEvents` 와 같은 판단
 *  - 행성       항해 박명 뒤 10° 넘게 뜬 행성 — `buildSkyEvents` 와 같은 판단
 *
 * iOS 는 예약 알림을 앱당 64개까지만 둡니다. 노을·일출 예보가 최대 8개를 쓰므로 여기서는 기본
 * `budget` 40개까지, 가까운 것부터 남깁니다.
 */
import SunCalc from 'suncalc';
import { buildSkyEvents } from './skyEvents';
import type { Language } from './i18n';

export type SkyNotifKind = 'golden' | 'blue' | 'moonrise' | 'crescent' | 'milkyway' | 'planets';
export const SKY_NOTIF_KINDS: SkyNotifKind[] = ['golden', 'blue', 'moonrise', 'crescent', 'milkyway', 'planets'];
export const LEAD_OPTIONS = [0, 15, 30, 60] as const;

export interface NotifPrefs {
  /** 노을 예보 — 일몰 2시간 전(날씨·예측·그림) */
  sunsetForecast: boolean;
  /** 일출 예보 — 전날 밤 22시 */
  sunriseForecast: boolean;
  golden: boolean;
  blue: boolean;
  moonrise: boolean;
  crescent: boolean;
  milkyway: boolean;
  planets: boolean;
  /** 하늘 이벤트 알림을 이벤트 몇 분 전에 보낼지 */
  leadMin: number;
}

export const DEFAULT_NOTIF_PREFS: NotifPrefs = {
  sunsetForecast: true,
  sunriseForecast: true,
  golden: false,
  blue: false,
  moonrise: false,
  crescent: false,
  milkyway: false,
  planets: false,
  leadMin: 30,
};

export interface PlannedNotification {
  /** `sky-<kind>-<YYYYMMDD>-<am|pm>` — 다시 계획해도 같은 이벤트는 같은 id */
  id: string;
  kind: SkyNotifKind;
  eventAt: Date;
  fireAt: Date;
  title: string;
  body: string;
}

const L3 = (lang: Language, ko: string, en: string, ja: string) => (lang === 'ko' ? ko : lang === 'ja' ? ja : en);

// 블루아워 저녁 시작(해 −4°) — SunCalc 에 한 번만 더합니다.
const BLUE_EVE = 'blueHourEveStart';
const BLUE_MORN_END = 'blueHourMornEnd';
let blueAdded = false;
function ensureBlueTimes() {
  if (blueAdded) return;
  blueAdded = true;
  const already = (SunCalc as any).times?.some?.((t: any[]) => t[2] === BLUE_EVE);
  if (!already) SunCalc.addTime(-4, BLUE_MORN_END, BLUE_EVE);
}

const valid = (d?: Date | null): d is Date => !!d && !isNaN(d.getTime());

/** 달 중심이 고도 +0.133°(SunCalc 와 같은 기준: 굴절·시반경)를 아래에서 위로 지나는 시각 — 10분 걸음 + 선형 보간. */
export function moonriseInLocalDay(startMs: number, lat: number, lon: number): Date | null {
  const H0 = 0.133 * Math.PI / 180;
  const alt = (ms: number) => SunCalc.getMoonPosition(new Date(ms), lat, lon).altitude - H0;
  const step = 10 * 60e3;
  let prev = alt(startMs);
  for (let t = startMs + step; t <= startMs + 864e5; t += step) {
    const cur = alt(t);
    if (prev < 0 && cur >= 0) return new Date(t - step + (step * -prev) / (cur - prev));
    prev = cur;
  }
  return null;
}

export function planSkyNotifications(p: {
  latitude: number;
  longitude: number;
  now: Date;
  prefs: NotifPrefs;
  language: Language;
  /** 관측지 시간대(시) — 알림 본문의 시각 표기 */
  tzOffsetHours: number;
  days?: number;
  budget?: number;
}): PlannedNotification[] {
  const { latitude: lat, longitude: lon, now, prefs, language: L, tzOffsetHours: tz } = p;
  const days = p.days ?? 7;
  const budget = p.budget ?? 40;
  const lead = Math.max(0, prefs.leadMin) * 60e3;
  const anyOn = SKY_NOTIF_KINDS.some((k) => prefs[k]);
  if (!anyOn) return [];
  ensureBlueTimes();

  const hhmm = (d: Date) => {
    const x = new Date(d.getTime() + tz * 3600e3);
    return `${String(x.getUTCHours()).padStart(2, '0')}:${String(x.getUTCMinutes()).padStart(2, '0')}`;
  };
  const dayKey = (d: Date) => {
    const x = new Date(d.getTime() + tz * 3600e3);
    return `${x.getUTCFullYear()}${String(x.getUTCMonth() + 1).padStart(2, '0')}${String(x.getUTCDate()).padStart(2, '0')}`;
  };
  const leadText = prefs.leadMin > 0
    ? L3(L, `${prefs.leadMin}분 뒤`, `in ${prefs.leadMin} min`, `${prefs.leadMin}分後`)
    : L3(L, '지금', 'now', '今');

  const out: PlannedNotification[] = [];
  const push = (kind: SkyNotifKind, eventAt: Date | null | undefined, half: 'am' | 'pm', title: string, body: string) => {
    if (!valid(eventAt)) return;
    const fireAt = new Date(eventAt.getTime() - lead);
    if (fireAt.getTime() <= now.getTime() + 60e3) return;
    out.push({ id: `sky-${kind}-${dayKey(eventAt)}-${half}`, kind, eventAt, fireAt, title, body });
  };

  // 관측지 현지 날짜의 정오에서 하루씩 — SunCalc 는 넘긴 시각이 속한 날의 출몰을 줍니다.
  const localNow = new Date(now.getTime() + tz * 3600e3);
  const noon0 = Date.UTC(localNow.getUTCFullYear(), localNow.getUTCMonth(), localNow.getUTCDate(), 12) - tz * 3600e3;

  for (let i = 0; i < days; i++) {
    const date = new Date(noon0 + i * 864e5);
    const times: any = SunCalc.getTimes(date, lat, lon);

    if (prefs.golden) {
      push('golden', times.sunrise, 'am',
        L3(L, '아침 골든아워', 'Morning golden hour', '朝のゴールデンアワー'),
        L3(L, `${leadText} ${hhmm(times.sunrise)} 해가 떠오르며 골든아워가 시작됩니다.`, `Golden hour starts ${leadText} at sunrise, ${hhmm(times.sunrise)}.`, `${leadText}、${hhmm(times.sunrise)}の日の出からゴールデンアワーです。`));
      push('golden', times.goldenHour, 'pm',
        L3(L, '저녁 골든아워', 'Evening golden hour', '夕方のゴールデンアワー'),
        L3(L, `${leadText} ${hhmm(times.goldenHour)}부터 해가 낮게 비춥니다.`, `Low golden light from ${hhmm(times.goldenHour)} (${leadText}).`, `${leadText}、${hhmm(times.goldenHour)}から低い光になります。`));
    }
    if (prefs.blue) {
      push('blue', times.dawn, 'am',
        L3(L, '아침 블루아워', 'Morning blue hour', '朝のブルーアワー'),
        L3(L, `${leadText} ${hhmm(times.dawn)}부터 하늘이 푸르게 밝아옵니다.`, `The sky turns blue from ${hhmm(times.dawn)} (${leadText}).`, `${leadText}、${hhmm(times.dawn)}から空が青く明るみます。`));
      push('blue', times[BLUE_EVE], 'pm',
        L3(L, '저녁 블루아워', 'Evening blue hour', '夕方のブルーアワー'),
        L3(L, `${leadText} ${hhmm(times[BLUE_EVE])}부터 해진 뒤 푸른 하늘이 됩니다.`, `Blue sky after sunset from ${hhmm(times[BLUE_EVE])} (${leadText}).`, `${leadText}、${hhmm(times[BLUE_EVE])}から日没後の青い空です。`));
    }
    if (prefs.moonrise) {
      // 관측지 현지 0~24시의 월출. SunCalc.getMoonTimes 는 기기 시간대로 하루를 자르므로 직접 찾습니다.
      const rise = moonriseInLocalDay(noon0 + i * 864e5 - 12 * 3600e3, lat, lon);
      if (rise) {
        const pct = Math.round(SunCalc.getMoonIllumination(rise).fraction * 100);
        const half = new Date(rise.getTime() + tz * 3600e3).getUTCHours() < 12 ? 'am' : 'pm';
        push('moonrise', rise, half,
          L3(L, '월출', 'Moonrise', '月の出'),
          L3(L, `${leadText} ${hhmm(rise)}에 달이 뜹니다 · 밝기 ${pct}%.`, `The Moon rises at ${hhmm(rise)} (${leadText}) · ${pct}% lit.`, `${leadText}、${hhmm(rise)}に月が昇ります・輝面${pct}%。`));
      }
    }
    if (prefs.crescent || prefs.milkyway || prefs.planets) {
      const ev = buildSkyEvents({
        date, latitude: lat, longitude: lon,
        events: { sunrise: times.sunrise, sunset: times.sunset },
        language: L,
      });
      for (const e of ev) {
        const half = new Date(e.time.getTime() + tz * 3600e3).getUTCHours() < 12 ? 'am' : 'pm';
        if (prefs.crescent && e.id === 'f_crescent') push('crescent', e.time, half, e.title, `${leadText} ${hhmm(e.time)} · ${e.description}`);
        if (prefs.milkyway && e.id === 'f_milkyway') push('milkyway', e.time, half, e.title, `${leadText} ${hhmm(e.time)} · ${e.description}`);
        if (prefs.planets && e.id === 'f_planets') push('planets', e.time, half, e.title, `${leadText} ${hhmm(e.time)} · ${e.description}`);
      }
    }
  }

  // 같은 id(같은 날·같은 반나절)는 하나만, 가까운 것부터 budget 개
  const seen = new Set<string>();
  return out
    .sort((a, b) => a.fireAt.getTime() - b.fireAt.getTime())
    .filter((n) => (seen.has(n.id) ? false : (seen.add(n.id), true)))
    .slice(0, budget);
}
