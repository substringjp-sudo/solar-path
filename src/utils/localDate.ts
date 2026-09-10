/**
 * 요청에 쓸 **현지 달력 날짜**를 만듭니다.
 *
 * ## 고치는 결함
 *
 * 여러 곳이 `date.toISOString().split('T')[0]` 로 날짜를 만들었습니다. 그것은
 * **UTC 날짜**입니다. 그런데 Open-Meteo 요청에는 `timezone=auto` 가 붙어 있어
 * `start_date`/`end_date` 도, 돌아오는 `hourly.time` 도 **현지시**입니다.
 *
 * 한국(UTC+9)에서 현지 00:00~08:59 는 UTC 로 전날입니다. 곧 **일출 무렵을
 * 겨냥하면 전날 자료를 받아옵니다.** 받은 배열에는 겨냥한 시각이 아예 없으니
 * `getInterpolatedWeather` 가 마지막 시각으로 잘라 붙입니다.
 *
 * 실제로 잰 값 — 도곡동, 2026-09-10 07:00 KST 를 겨냥했을 때:
 *
 * | 받아온 시각 | 저층/중층/상층 |
 * |---|---|
 * | 09-09 23:00 (전날 마지막, 결함) | 0 / 11 / 16 |
 * | 09-10 07:00 (겨냥한 시각) | 0 / 34 / 68 |
 *
 * `weather.ts` 는 같은 함수 안에서 캐시 키는 **현지 날짜**로, 요청은 **UTC
 * 날짜**로 만들고 있었습니다. 둘이 어긋나 있었습니다.
 *
 * ## 왜 기기 현지시인가 (관측지 현지시가 아니라)
 *
 * ⚠ 엄밀히는 관측지의 시간대를 써야 하지만, **지금 시간축 자체가 기기 현지시로
 * 읽히고 있습니다.** 돌아오는 `"2026-09-10T07:00"` 에는 시간대 표시가 없어서
 * `new Date(t)` 가 **기기 현지시**로 해석합니다(`weather.ts` 의 `timeMs`).
 * 그러니 날짜만 관측지 기준으로 바꾸면 시간축과 어긋나 오히려 더 틀립니다.
 *
 * 기기와 관측지의 시간대가 다르면(지도에서 먼 곳을 골랐을 때) 그 차이만큼
 * 어긋나는 것은 **이 함수가 고치는 결함이 아니라 남아 있는 결함**입니다.
 * 고치려면 시간축까지 같이 옮겨야 합니다.
 */

/** `Date` 를 **기기 현지** 달력 기준 `YYYY-MM-DD` 로 만듭니다. */
export const localDateString = (d: Date): string => {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

/**
 * 겨냥한 시각이 그 날짜의 시간별 배열 안에 들어 있는지 봅니다.
 * 판정에서 "잘라 붙이게 되는가" 를 재는 데 씁니다.
 */
export const localDateContains = (dateStr: string, target: Date): boolean =>
  localDateString(target) === dateStr;
