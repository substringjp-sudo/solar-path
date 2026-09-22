/**
 * cachePolicy.ts
 *
 * **디스크에 둔 캐시를 언제 믿고, 무엇을 다시 받을지 정하는 규칙.**
 *
 * ## 먼저 — "바뀐 것만 받기" 는 그대로는 불가능합니다
 *
 * 재 봤습니다(2026-09-22, api.open-meteo.com):
 *
 * ```
 *   ETag / Last-Modified 응답 헤더   ← 없음  (조건부 요청 304 불가)
 *   모델 실행 시각(run/init) 필드    ← 없음  (generationtime_ms 는 서버 CPU 시간)
 * ```
 *
 * 서버에 "바뀌었니" 를 **물어볼 방법이 없습니다.** 무엇이 달라졌는지 알려면
 * 받아 보는 수밖에 없고, 받아 본 순간 이미 요청을 쓴 것입니다.
 *
 * ## 대신 **바뀔 수 없는 것**은 압니다 — 그건 안 받아도 됩니다
 *
 * 둘로 갈립니다.
 *
 * **지형은 아예 안 변합니다.** 같은 자리에 서 있는 한 고도는 영원히 같습니다.
 * 한 번 받아 두면 다시 받을 이유가 **영영 없습니다.**
 *
 * **날씨는 이미 지나간 시각이 안 변합니다.** 예보는 앞날만 고쳐 쓰이므로,
 * 지금이 17시면 0~16시는 다시 받을 까닭이 없습니다. Open-Meteo 는
 * `start_hour`/`end_hour` 를 받으므로(재서 확인함) **남은 시각만** 받고
 * 캐시의 지난 시각에 이어 붙일 수 있습니다.
 *
 * ⚠ 엄밀히 말하면 새 모델 실행이 **지난 시각도 고쳐 씁니다**(분석값이 섞임).
 * 그래도 다시 안 받습니다 — 이 앱이 답하는 질문은 "오늘 노을이 어떨까" 이고,
 * 이미 지나간 시각의 소수점 보정은 그 답을 바꾸지 않습니다. 대신 이건
 * **판단이지 사실이 아니므로** 여기 적어 둡니다.
 *
 * ## 그리고 **바뀌지 않았으면 다시 그리지 않습니다**
 *
 * 요청은 줄여도 0이 될 수 없으니, 받아 온 뒤 지문을 견줘 **같으면 상태를
 * 안 건드립니다.** 재시뮬레이션도 다시 그리기도 안 일어납니다.
 */

import { gridBucket, sameBucket, GRID_BUCKET_DEG } from './weatherCacheKey';

export { gridBucket, sameBucket, GRID_BUCKET_DEG };

/**
 * 저장 형식이 바뀌면 올립니다. 낡은 형식은 읽지 않고 버립니다 —
 * 모양이 달라진 캐시를 그대로 먹이면 화면이 조용히 망가집니다.
 */
export const CACHE_SCHEMA_VERSION = 1;

/** 캐시 목록 한 종류가 가질 수 있는 최대 칸 수. */
export const MAX_CACHE_ENTRIES = 10;

export interface CacheEntry<T> {
  key: string;
  data: T;
  timestamp: number;
  latitude: number;
  longitude: number;
}

/* ── 자리 맞추기 ──────────────────────────────────────────────────────
 *
 * ⚠ 스토어의 캐시 키는 `lat.toFixed(4)` — **11m** 였습니다. 날씨 격자는
 * 한국 5.6km 이므로, 11m 를 움직이면 **같은 값인데 키가 달라** 칸을 하나 더
 * 먹습니다. 10칸이 거의 같은 자료로 차는 것입니다. 읽을 때는 0.05° 어림으로
 * 찾으므로 틀린 값이 나오지는 않았지만, 칸이 헛되이 낭비됐습니다.
 * `weatherCacheKey.gridBucket`(0.02° ≈ 2.2km)으로 맞춥니다.
 */

/** 날씨 캐시 키 — 자리는 격자 칸, 날짜는 현지 날짜. */
export const weatherCacheKey = (lat: number, lon: number, dateStr: string): string =>
  `w_${gridBucket(lat, lon)}_${dateStr}`;

/** 지형 캐시 키 — 날짜가 없습니다. **지형은 날짜를 타지 않습니다.** */
export const terrainCacheKey = (lat: number, lon: number): string =>
  `t_${gridBucket(lat, lon)}`;

/**
 * 캐시 목록에서 이 자리에 맞는 항목 찾기.
 *
 * 화면 쪽이 쓰던 0.05°(≈5.5km) 어림을 그대로 씁니다 — 날씨 격자 한 칸
 * 크기라, 그 안에서는 어차피 같은 값이 옵니다.
 */
export const LOOKUP_TOLERANCE_DEG = 0.05;

export const findEntry = <T>(
  list: CacheEntry<T>[], lat: number, lon: number, keyPart?: string,
): CacheEntry<T> | undefined =>
  list.find(c =>
    Math.abs(c.latitude - lat) < LOOKUP_TOLERANCE_DEG &&
    Math.abs(c.longitude - lon) < LOOKUP_TOLERANCE_DEG &&
    (keyPart === undefined || c.key.includes(keyPart)));

/** 새 항목을 앞에 넣고, 같은 키를 밀어내고, 칸 수를 지킵니다. */
export const upsertEntry = <T>(
  list: CacheEntry<T>[], entry: CacheEntry<T>, max = MAX_CACHE_ENTRIES,
): CacheEntry<T>[] =>
  [entry, ...list.filter(e => e.key !== entry.key)].slice(0, max);

/* ── 지형: 다시 받을 필요가 있는가 ───────────────────────────────────── */

/**
 * 이 자리의 지형을 **다시 받아야 하는가.**
 *
 * ⚠ 나이를 안 봅니다. 산은 안 움직입니다. 자리가 맞으면 아무리 오래됐어도
 * 그대로 씁니다 — 여기에 만료를 넣으면 아무 근거 없이 요청만 늘어납니다.
 */
export const needTerrainFetch = <T>(
  list: CacheEntry<T>[], lat: number, lon: number,
): boolean => findEntry(list, lat, lon) === undefined;

/* ── 날씨: 어느 시각을 다시 받아야 하는가 ───────────────────────────── */

export interface RefetchWindow {
  /** `start_hour` 로 보낼 현지 시각 (`YYYY-MM-DDTHH:00`). */
  startHour: string;
  /** `end_hour` 로 보낼 현지 시각. */
  endHour: string;
  /** 이 창이 덮는 시각 수. */
  hours: number;
  /** 하루 24시간 중 안 받아도 되는 비율(0~1). 보고용입니다. */
  saved: number;
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * 지금 이후로 **아직 바뀔 수 있는 시각**의 창.
 *
 * `nowLocalHour` 는 대상 날짜 기준 현지 시(0~23)입니다. 대상이 오늘이 아니면
 * (과거든 미래든) 자를 근거가 없으므로 하루 전체를 돌려줍니다.
 *
 * ⚠ 지금 시각 **자체를 포함**시킵니다. 그 시간은 아직 안 끝났습니다.
 */
export const refetchWindow = (
  dateStr: string, nowLocalHour: number | null,
): RefetchWindow => {
  const from = nowLocalHour === null ? 0
    : Math.max(0, Math.min(23, Math.floor(nowLocalHour)));
  const hours = 24 - from;
  return {
    startHour: `${dateStr}T${pad(from)}:00`,
    endHour: `${dateStr}T23:00`,
    hours,
    saved: from / 24,
  };
};

/** 대상 날짜가 오늘이면 현지 시, 아니면 null(자를 근거 없음). */
export const localHourIfToday = (
  dateStr: string, nowMs: number, tzOffsetHours: number,
): number | null => {
  const shifted = new Date(nowMs + tzOffsetHours * 3600_000);
  const today = `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
  return today === dateStr ? shifted.getUTCHours() : null;
};

/* ── 이어 붙이기 ─────────────────────────────────────────────────────── */

/**
 * 캐시의 지난 시각 위에 새로 받은 시각을 덮어씁니다.
 *
 * 같은 `time` 문자열이면 새 값이 이깁니다. 캐시에만 있는 시각은 남습니다.
 * 길이가 다른 배열은 **건드리지 않습니다** — 짝이 안 맞는 배열을 억지로
 * 섞으면 시각과 값이 어긋나는 게 가장 나쁩니다.
 */
export const spliceHourly = <T extends { time: string[] }>(
  cached: T, fresh: Partial<T> & { time: string[] },
): T => {
  const out: any = { ...cached };
  const index = new Map<string, number>();
  cached.time.forEach((t, i) => index.set(t, i));

  const n = cached.time.length;
  for (const field of Object.keys(fresh)) {
    const fv = (fresh as any)[field];
    const cv = (cached as any)[field];
    if (!Array.isArray(fv) || !Array.isArray(cv)) continue;
    if (cv.length !== n || fv.length !== fresh.time.length) continue; // 짝이 안 맞으면 손대지 않음
    const merged = cv.slice();
    fresh.time.forEach((t, j) => {
      const i = index.get(t);
      if (i !== undefined) merged[i] = fv[j];
    });
    out[field] = merged;
  }
  return out as T;
};

/* ── 바뀌었는가 ─────────────────────────────────────────────────────── */

/**
 * 값이 달라졌는지만 가리는 **싼 지문.**
 *
 * 암호용이 아닙니다 — 같은 내용이면 반드시 같은 값이 나오고, 다른 내용이면
 * 거의 확실히 다른 값이 나오면 됩니다. 64비트를 32비트 둘로 굴립니다.
 *
 * ⚠ `JSON.stringify` 의 키 순서에 기대지 않으려고 **배열만** 훑습니다.
 */
export const fingerprint = (value: unknown): string => {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  const feed = (s: string) => {
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
      h2 = Math.imul(h2 + c, 0x85ebca6b) >>> 0;
    }
  };
  const walk = (v: any) => {
    if (v === null || v === undefined) { feed('~'); return; }
    if (Array.isArray(v)) { feed('['); v.forEach(walk); feed(']'); return; }
    if (typeof v === 'object') {
      feed('{');
      for (const k of Object.keys(v).sort()) { feed(k); feed(':'); walk(v[k]); }
      feed('}');
      return;
    }
    feed(String(v));
  };
  walk(value);
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
};

/** 받아 온 것이 캐시와 같은가 — 같으면 상태를 안 건드립니다. */
export const unchanged = (a: unknown, b: unknown): boolean =>
  fingerprint(a) === fingerprint(b);
