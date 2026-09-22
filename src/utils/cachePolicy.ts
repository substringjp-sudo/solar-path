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

/* ── 카나리아: 한 점만 보고 나머지를 건너뛰기 ─────────────────────────
 *
 * 35점을 다 받기 전에 **한 점만** 받아 캐시와 견주고, 같으면 큰 요청을
 * 통째로 건너뜁니다.
 *
 * ## 왜 될 수 있나 — 원인이 하나이기 때문입니다
 *
 * 35점은 같은 요청에서 **같은 모델 런**으로 옵니다. 예보가 바뀌는 사건은
 * "새 런이 나왔다" 하나뿐이고, 런은 격자 전체가 **한꺼번에** 갈립니다.
 * 그래서 한 점이 안 바뀌었으면 나머지도 안 바뀐 것입니다 — 점들이 공간적으로
 * 닮아서가 아니라 **원인을 공유**해서입니다.
 *
 * ## ⚠ 그런데 순진하게 만들면 **조용히 틀립니다**
 *
 * 카나리아가 "안 바뀜" 이라고 **거짓말**할 수 있습니다. 세 가지를 지켜야
 * 합니다. 셋 다 안 지키면 먼 구름이 바뀌었는데 화면이 옛 하늘을 그립니다.
 *
 * **① 변수가 평평하면 안 됩니다.** `cloud_cover` 는 정수 %이고 맑은 날은
 * 24시간이 통째로 0, 흐린 날은 통째로 100 입니다. 런이 바뀌어도 관측점의
 * 0 은 그대로 0 이라 **"안 바뀜" 이 나옵니다** — 그 사이 380km 밖 구름은
 * 갈렸는데도요. 연속값(`temperature_2m`, 0.1°C)을 써야 두 런이 사실상
 * 절대 같지 않습니다.
 *
 * **② 같은 모델을 물어야 합니다.** 본 요청이 ecmwf+icon 을 섞는데 카나리아만
 * 기본 모델을 물으면, 갱신 주기가 달라 엉뚱한 답이 나옵니다(ECMWF 6시간,
 * ICON 3시간).
 *
 * **③ 캐시의 값이 아니라 `canaryPrint` 와 견주어야 합니다.** 캐시에 든 것은
 * **위성 보정이 발린 뒤**의 값입니다(`applyBiasToPath` 가 low/mid/high/total 을
 * 제자리에서 덮어씁니다). 보정 세기는 관측 시각을 따라 계속 변하므로, 캐시와
 * 직접 견주면 예보가 그대로여도 **늘 "바뀜"** 이 나와 카나리아가 아무 일도
 * 못 합니다. 그래서 **보정 전 원본**의 지문을 따로 저장해 둡니다.
 *
 * ## 남은 구멍 — 적어 둡니다
 *
 * `icon_seamless` 는 자기도 icon_d2/eu/global 을 앞선 시간과 지역으로 섞습니다.
 * 관측점과 380km 밖 점이 **다른 하위 모델**에 걸치고 그중 하나만 갱신되면
 * 카나리아가 놓칠 수 있습니다. icon_d2 권역(독일 근처)에서만 생기는 좁은
 * 구멍이고, 실측으로 확인한 적은 **없습니다.**
 */

/**
 * 카나리아로 쓸 변수.
 *
 * ⚠ **`cloud_cover` 를 쓰면 안 됩니다** — 맑거나 흐린 날 24시간이 한 값으로
 * 평평해져 런이 바뀌어도 안 바뀐 것처럼 보입니다. 판정 [8]이 이걸 음성
 * 대조로 잡고 있습니다.
 */
export const CANARY_VARIABLE = 'temperature_2m';

/** 카나리아 한 점의 지문. 견줄 것은 **보정 전 원본**입니다. */
export const canaryPrint = (series: ReadonlyArray<number | null>): string =>
  fingerprint(series);

/**
 * 카나리아가 "큰 요청을 건너뛰어도 된다" 고 말하는가.
 *
 * ⚠ 저장된 지문이 없으면 **반드시 받아야 합니다.** 모르면 건너뛰지 않습니다 —
 * 여기서 `true` 로 기울면 첫 실행부터 빈 하늘을 그립니다.
 */
export const canarySaysSkip = (
  storedPrint: string | null | undefined, freshSeries: ReadonlyArray<number | null> | null,
): boolean => {
  if (!storedPrint || !freshSeries || freshSeries.length === 0) return false;
  return canaryPrint(freshSeries) === storedPrint;
};

/**
 * 이 배열이 카나리아로 쓸 만큼 **예민한가** — 서로 다른 값이 몇 가지인가.
 *
 * 24시간이 한 값으로 평평하면(가짓수 1) 카나리아 구실을 못 합니다. 앱이
 * 실행 중에 이걸 보고, 평평하면 **건너뛰지 않습니다.**
 */
export const canaryDistinctValues = (series: ReadonlyArray<number | null>): number =>
  new Set(series.filter(v => v !== null && v !== undefined)).size;

/** 카나리아로 믿어도 되는 최소 가짓수. 1 이면 평평한 것입니다. */
export const CANARY_MIN_DISTINCT = 3;

export const canaryIsUsable = (series: ReadonlyArray<number | null> | null): boolean =>
  !!series && series.length >= 12 && canaryDistinctValues(series) >= CANARY_MIN_DISTINCT;
