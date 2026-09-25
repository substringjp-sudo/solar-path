/**
 * 기압면 단면에서 **구름이 실제로 있는 높이**를 뽑습니다.
 *
 * ## 왜
 *
 * 앱은 운량을 세 숫자(저·중·상)로 받고, 그 높이를
 * `LAYER_ALTITUDE_KM = { low: 1.5, mid: 4.5, high: 10.0 }` 으로 **박아** 씁니다.
 *
 * 그런데 Open-Meteo 는 `cloud_cover_{1000…100}hPa` 와
 * `geopotential_height_{…}hPa` 를 **16개 기압면**에 줍니다. 실기(도곡동):
 *
 * ```
 *    400hPa  7,556m    0%
 *    300hPa  9,652m   11%   ← 구름은 여기 있는데
 *    200hPa 12,400m    0%
 * ```
 *
 * 앱은 이것을 "상층운" 이라 부르고 **10,000m 에 그립니다.** 같은 "상층운" 이
 * 400hPa(7,556m)이나 200hPa(12,400m)여도 여전히 10km 입니다 — 최대 2.4km
 * 어긋나고, 그만큼 화면상 고도각과 **언제 노을빛을 받는지**가 어긋납니다.
 *
 * ## 무엇을 하는가
 *
 * 각 층(저·중·상)의 높이를 그 층 안에서 **운량으로 가중한 평균 높이**로 냅니다.
 * 구름이 없는 층은 예전 상수로 물러납니다 — 그릴 것이 없으니 높이도 뜻이 없습니다.
 */

/** 층 구분은 **높이**로 합니다(WMO 중위도 관례에 맞춘 경계). */
export const LAYER_BAND_KM = { lowTop: 2.0, midTop: 7.0 } as const;

export interface ProfileLevel {
  /** 기압면 (hPa) */
  pressureHPa: number;
  /** 그 면의 지오퍼텐셜 고도 (m, 해발) */
  heightM: number;
  /** 그 면의 운량 (%) */
  coverPct: number;
}

export interface LayerAltitudes {
  lowKm: number;
  midKm: number;
  highKm: number;
  /** 각 층에 실제로 구름이 있었나 — 없으면 위 값은 예전 상수입니다. */
  lowFromProfile: boolean;
  midFromProfile: boolean;
  highFromProfile: boolean;
}

/** 예전에 박아 쓰던 값. 단면이 없을 때 여기로 물러납니다. */
export const FALLBACK_ALT_KM = { low: 1.5, mid: 4.5, high: 10.0 } as const;

/**
 * 시간별 배열 묶음에서 한 시각의 단면을 뽑습니다.
 * 키 이름은 `cloud_cover_850hPa` · `geopotential_height_850hPa` 꼴입니다.
 */
export function extractProfile(
  hourly: Record<string, unknown> | null | undefined,
  index: number,
): ProfileLevel[] {
  if (!hourly) return [];
  const out: ProfileLevel[] = [];
  for (const key of Object.keys(hourly)) {
    const m = /^cloud_cover_(\d+)hPa$/.exec(key);
    if (!m) continue;
    const p = Number(m[1]);
    const cover = (hourly[key] as (number | null)[] | undefined)?.[index];
    const height = (hourly[`geopotential_height_${p}hPa`] as (number | null)[] | undefined)?.[index];
    if (cover == null || height == null) continue;
    if (!Number.isFinite(cover) || !Number.isFinite(height)) continue;
    out.push({ pressureHPa: p, heightM: height, coverPct: cover });
  }
  return out.sort((a, b) => a.heightM - b.heightM);
}

/**
 * 단면에서 층별 대표 높이를 냅니다.
 *
 * ⚠ **운량으로 가중합니다.** 단순 평균이면 구름이 없는 면까지 끌어당겨
 * 늘 밴드 한가운데가 나옵니다 — 박아 둔 상수와 다를 게 없어집니다.
 */
export function layerAltitudes(levels: ProfileLevel[]): LayerAltitudes {
  const band = (lo: number, hi: number) =>
    levels.filter(l => l.heightM >= lo * 1000 && l.heightM < hi * 1000);

  const weighted = (ls: ProfileLevel[], fallbackKm: number): [number, boolean] => {
    let wsum = 0, hsum = 0;
    for (const l of ls) {
      const w = Math.max(0, l.coverPct);
      wsum += w; hsum += w * l.heightM;
    }
    if (wsum <= 0) return [fallbackKm, false];
    return [hsum / wsum / 1000, true];
  };

  const [lowKm, lowFromProfile] = weighted(band(0, LAYER_BAND_KM.lowTop), FALLBACK_ALT_KM.low);
  const [midKm, midFromProfile] = weighted(band(LAYER_BAND_KM.lowTop, LAYER_BAND_KM.midTop), FALLBACK_ALT_KM.mid);
  const [highKm, highFromProfile] = weighted(band(LAYER_BAND_KM.midTop, 25), FALLBACK_ALT_KM.high);

  return { lowKm, midKm, highKm, lowFromProfile, midFromProfile, highFromProfile };
}

/**
 * 저층 구름 **덱의 밑면과 윗면**(km, 해발) — 운해를 위에서 볼 때 보이는 면이
 * 윗면입니다(§82).
 *
 * ## 왜 가중 평균(`layerAltitudes`)으로는 안 되나
 *
 * 가중 평균은 덱의 **한가운데**입니다. 셰이더는 그 높이에 1.6km 짜리 판을
 * 올려 그리는데, 실측 단면(2026-09-23, 36.0°N 127.8°E 09시)은
 *
 * ```
 *    950hPa   598m   27%
 *    925hPa   834m   46%   ← 봉우리
 *    900hPa  1059m    6%
 * ```
 *
 * 곧 **0.6~1.0km 의 얇은 층운**입니다. 판으로 그리면 0.8~2.4km 가 되어
 * 1,600m 산 위에 서 있으면 구름 **속**에 있는 셈이 됩니다.
 *
 * ## 정의 — 반값 폭
 *
 * 저층 밴드 안에서 운량이 가장 큰 면을 찾고, 그 면에서 위아래로 운량이
 * **봉우리의 절반 이상**인 면을 이어 붙입니다. 경계는 마지막 흐린 면과 그
 * 다음 맑은 면의 **가운데**입니다(면 사이 어디서 끝나는지 모르므로).
 *
 * ⚠ "절반" 은 재서 얻은 값이 아니라 **관례**(반치폭)입니다. 기압면 간격이
 *   약 250m(975·950·925·900·850·800·750hPa)라 윗면은 ±125m 로만 압니다.
 *
 * 윗면은 저층 밴드(2km)를 넘어 이어질 수 있습니다 — 층적운 윗면이 2.2km 인
 * 날이 있습니다. 봉우리만 밴드 안에서 찾습니다.
 *
 * @returns 저층에 구름이 없거나 단면이 없으면 `null`.
 */
export function lowDeck(levels: ProfileLevel[]): { baseKm: number; topKm: number } | null {
  const ls = [...levels].sort((a, b) => a.heightM - b.heightM);
  let peak = -1;
  for (let i = 0; i < ls.length; i++) {
    if (ls[i].heightM >= LAYER_BAND_KM.lowTop * 1000) break;
    if (ls[i].coverPct > 0 && (peak < 0 || ls[i].coverPct > ls[peak].coverPct)) peak = i;
  }
  if (peak < 0) return null;
  const half = ls[peak].coverPct / 2;
  let lo = peak, hi = peak;
  while (lo > 0 && ls[lo - 1].coverPct >= half) lo--;
  while (hi < ls.length - 1 && ls[hi + 1].coverPct >= half) hi++;

  const HALF_GAP_M = 125;   // 이웃 면이 없을 때 — 기압면 간격의 절반
  const baseM = lo > 0 ? (ls[lo - 1].heightM + ls[lo].heightM) / 2 : Math.max(0, ls[lo].heightM - HALF_GAP_M);
  const topM = hi < ls.length - 1 ? (ls[hi].heightM + ls[hi + 1].heightM) / 2 : ls[hi].heightM + HALF_GAP_M;
  return { baseKm: baseM / 1000, topKm: topM / 1000 };
}

/**
 * 한 고도의 운량(0~1) — 기압면 사이는 높이로 선형 보간합니다. 단면 밖이면 0.
 */
export function coverAtAltitude(levels: ProfileLevel[], altKm: number): number {
  const ls = [...levels].sort((a, b) => a.heightM - b.heightM);
  const zM = altKm * 1000;
  for (let i = 0; i + 1 < ls.length; i++) {
    const a = ls[i], b = ls[i + 1];
    if (zM < a.heightM || zM > b.heightM) continue;
    const t = b.heightM > a.heightM ? (zM - a.heightM) / (b.heightM - a.heightM) : 0;
    return Math.max(0, Math.min(1, (a.coverPct + (b.coverPct - a.coverPct) * t) / 100));
  }
  return 0;
}

/**
 * **관측자를 감싼 구름**(§93) — 산 위가 구름 속이면 그 덩어리의 운량·밑면·윗면.
 *
 * 덩어리는 `lowDeck` 과 **같은 반값 규칙**으로 정합니다: 관측 고도를 사이에 둔 두
 * 면 중 흐린 쪽을 봉우리로 잡고, 위아래로 봉우리의 절반 이상인 면을 잇고, 끝은
 * 마지막 흐린 면과 다음 맑은 면의 가운데. 관측자가 그 [밑면, 윗면] 안일 때만
 * 구름 속입니다. 운량은 두 면 사이를 높이로 보간한 값입니다.
 *
 * ⚠ 처음에는 "보간 운량이 5% 넘으면 속" 으로 했다가 판정이 잡았습니다 — 0%(1049m)와
 *   100%(1530m) 사이 1.2km 가 31% 로 "속" 이 되는데, 같은 단면에서 반값 밑면은
 *   1.29km 입니다. 운해 윗면(§82)과 안개가 서로 다른 경계를 쓰게 됩니다.
 *
 * ⚠ 예보 격자(11~25km)는 산봉우리에 걸린 삿갓구름을 모릅니다. 이 함수가 아는
 *   것은 **그 높이를 지나는 층 구름**뿐입니다.
 *
 * @returns 구름 밖이거나 단면이 없으면 `null`.
 */
export function cloudAround(
  levels: ProfileLevel[],
  altKm: number,
): { cover: number; baseKm: number; topKm: number } | null {
  const ls = [...levels].sort((a, b) => a.heightM - b.heightM);
  if (ls.length < 2) return null;
  const zM = altKm * 1000;
  const up = ls.findIndex(l => l.heightM >= zM);
  if (up <= 0) return null;                       // 단면 밖(맨 아래 면보다 낮거나 맨 위보다 높음)
  const peak = ls[up].coverPct >= ls[up - 1].coverPct ? up : up - 1;
  if (ls[peak].coverPct < 5) return null;
  const half = ls[peak].coverPct / 2;
  let lo = peak, hi = peak;
  while (lo > 0 && ls[lo - 1].coverPct >= half) lo--;
  while (hi < ls.length - 1 && ls[hi + 1].coverPct >= half) hi++;
  const HALF_GAP_M = 125;   // lowDeck 과 같은 값 — 기압면 간격의 절반
  const baseM = lo > 0 ? (ls[lo - 1].heightM + ls[lo].heightM) / 2 : Math.max(0, ls[lo].heightM - HALF_GAP_M);
  const topM = hi < ls.length - 1 ? (ls[hi].heightM + ls[hi + 1].heightM) / 2 : ls[hi].heightM + HALF_GAP_M;
  if (zM <= baseM || zM >= topM) return null;
  return { cover: coverAtAltitude(ls, altKm), baseKm: baseM / 1000, topKm: topM / 1000 };
}

/**
 * 들어올림 응결 고도(LCL) — **적운의 밑면**입니다. 지상 기온과 이슬점만 있으면
 * 납니다: `LCL ≈ 125·(T − Td)` m (Espy 근사).
 *
 * 저층 구름의 밑이 실제로 여기입니다. 습한 날은 400m 까지 내려오고 건조한 날은
 * 3km 를 넘습니다 — 박아 둔 1.5km 하나로는 못 담습니다.
 *
 * @returns 지면 위 높이 (km). 값이 모자라면 `null`.
 */
export function lclKm(tempC: number | null | undefined, dewC: number | null | undefined): number | null {
  if (tempC == null || dewC == null) return null;
  if (!Number.isFinite(tempC) || !Number.isFinite(dewC)) return null;
  const spread = tempC - dewC;
  if (spread < 0) return 0;              // 포화 — 안개
  return (125 * spread) / 1000;
}
