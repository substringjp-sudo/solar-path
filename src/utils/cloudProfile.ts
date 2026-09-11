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
