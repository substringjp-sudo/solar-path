/**
 * 여러 예보 모델의 시간별 값을 하나로 섞습니다.
 *
 * ## 왜 (§56 에서 잰 것)
 *
 * 앱은 `models=` 를 안 붙여 Open-Meteo 의 기본값 `best_match` 를 받고 있었습니다.
 * 위성 관측 일사를 기준으로 30일 · 10지역 · 2,959시각을 재 보니 **넷 중 가장
 * 나빴습니다**(투과율 τ 오차 23.4 대 ecmwf 18.4 · icon 19.3 · gfs 23.8).
 *
 * 특히 **짙게 흐린 하늘에서 `best_match` 는 τ 를 +34 만큼 맑은 쪽으로 틀립니다.**
 * 맑음(τ 1.0)에서 완전흐림(0.25)까지 전 구간이 0.75 이니 전 구간의 45% 입니다.
 * 같은 시각 ecmwf 는 +13, icon 은 +8 이었습니다. "흐린 날은 거의 못 맞춘다" 가
 * 이것이었습니다.
 *
 * | 조합 | τ 오차 | 짙은흐림 편향 |
 * |---|---|---|
 * | best_match (예전) | 23.4 | +33.7 |
 * | icon 단독 | 19.3 | +8.1 |
 * | **ecmwf+icon** | **16.8** | **+10.3** |
 * | ecmwf+icon+gfs | 17.3 | +9.5 |
 * | best_match+ecmwf+icon | 16.8 | +18.1 |
 *
 * ⚠ **`best_match` 를 섞으면 안 됩니다.** 블렌드에 넣는 순간 짙은 흐림 편향이
 * +10.3 에서 +18.1 로 되레 나빠집니다. 아래 `FILL_MODEL` 로 요청에 들어가긴
 * 하지만 **섞이지는 않습니다** — 다른 둘이 아예 안 주는 변수를 메우는 데만 씁니다.
 *
 * ## 왜 산술평균인가
 *
 * τ 공간에서 섞는 쪽이 아주 조금 낫습니다(τ오차 16.74 대 16.73 로 사실상 같고,
 * 짙은 흐림에서만 편향 +10.52 대 +11.83). 그런데 τ = 1 − 0.75·(N/100)^3.4 는
 * **기둥 전체**의 운량에 대해 세운 관계이고, 앱이 쓰는 것은 **층별**
 * (low/mid/high) 운량입니다. 층별로도 그 변환이 맞는지는 **재지 못했습니다**
 * (위성 일사는 기둥 합이라 층을 못 가립니다). 검증 안 된 비선형 변환을 층에
 * 갖다 쓰느니, 총운량에서 똑같이 좋았던 산술평균을 씁니다.
 *
 * ## 어떻게 쓰나
 *
 * 요청에 `BLEND_MODELS_PARAM` 을 붙이면 Open-Meteo 가 변수 이름에 모델 이름을
 * 접미사로 답니다(`cloud_cover_mid_ecmwf_ifs025`). `blendHourly()` 가 그것을
 * 다시 접미사 없는 이름으로 되돌려 주므로 **호출부는 안 바뀝니다.**
 */

/** 섞을 모델. 이 둘의 값만 평균에 들어갑니다. */
export const BLEND_MODELS = ['ecmwf_ifs025', 'icon_seamless'] as const;

/**
 * 위 둘이 **아예 안 주는** 변수를 메우는 모델. 평균에는 절대 안 들어갑니다.
 *
 * 지금 이것이 필요한 변수는 `visibility` 하나입니다 — ecmwf·icon 둘 다
 * 24시간 전부 null 을 돌려줍니다. 시정은 하늘의 뿌연 정도와 구름 배치에
 * 쓰이므로(SkyScene3D · cloudPlacement · Visualizer) 잃으면 맑은 날이
 * 실제보다 뿌옇게 그려집니다.
 */
export const FILL_MODEL = 'best_match';

/** 요청 URL 에 그대로 이어 붙일 수 있는 `&models=...` 조각. */
export const BLEND_MODELS_PARAM =
  `&models=${[...BLEND_MODELS, FILL_MODEL].join(',')}`;

/** 접미사를 떼어 낼 때 쓸 모델 이름들. 긴 것부터 봐야 안전합니다. */
const ALL_MODELS: string[] = [...BLEND_MODELS, FILL_MODEL]
  .slice()
  .sort((a, b) => b.length - a.length);

type HourlyRaw = Record<string, unknown> | null | undefined;

const isNum = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);

/**
 * 접미사 붙은 이름을 `{ base, model }` 로 가릅니다.
 * 아는 모델의 접미사가 없으면 `model` 이 null 입니다(그대로 통과시킬 이름).
 */
const splitKey = (key: string): { base: string; model: string | null } => {
  for (const m of ALL_MODELS) {
    const suffix = `_${m}`;
    if (key.length > suffix.length && key.endsWith(suffix)) {
      return { base: key.slice(0, -suffix.length), model: m };
    }
  }
  return { base: key, model: null };
};

/**
 * 여러 모델이 섞여 든 `hourly` 를 접미사 없는 하나로 되돌립니다.
 *
 * 변수마다 이 차례로 정합니다:
 *   1. 접미사 없는 값이 이미 있으면 그대로 씁니다(모델을 안 붙인 응답 ·
 *      아카이브 응답 · 모델 하나만 요청한 응답이 이 꼴입니다).
 *   2. `BLEND_MODELS` 중 **실제로 값이 있는** 것들을 시각별로 평균합니다.
 *      한 모델이 그 시각에 null 이면 나머지로만 냅니다. 전부 null 인 시각은
 *      null 로 둡니다 — 0 으로 메우면 "구름 없음" 이라고 거짓말하게 됩니다.
 *   3. 둘 다 그 변수를 아예 안 주면 `FILL_MODEL` 값을 씁니다.
 *
 * 숫자가 아닌 배열(문자열 `time` 등)은 1번에서 그대로 지나갑니다.
 */
export const blendHourly = (raw: HourlyRaw): Record<string, unknown> | undefined => {
  if (!raw || typeof raw !== 'object') return undefined;

  const plain = new Map<string, unknown>();
  const byModel = new Map<string, Map<string, unknown>>();

  for (const key of Object.keys(raw)) {
    const { base, model } = splitKey(key);
    if (model === null) {
      plain.set(base, (raw as Record<string, unknown>)[key]);
    } else {
      let slot = byModel.get(base);
      if (!slot) { slot = new Map(); byModel.set(base, slot); }
      slot.set(model, (raw as Record<string, unknown>)[key]);
    }
  }

  const out: Record<string, unknown> = {};

  // 1. 접미사 없는 값은 그대로.
  for (const [base, value] of plain) out[base] = value;

  for (const [base, slot] of byModel) {
    if (base in out) continue;

    // 2. 섞을 모델 중 값이 있는 것들.
    const parts: number[][] = [];
    for (const m of BLEND_MODELS) {
      const arr = slot.get(m);
      if (Array.isArray(arr) && arr.some(isNum)) parts.push(arr as number[]);
    }

    if (parts.length > 0) {
      const len = parts.reduce((n, a) => Math.max(n, a.length), 0);
      const merged = new Array<number | null>(len);
      for (let i = 0; i < len; i++) {
        let sum = 0, n = 0;
        for (const a of parts) { const v = a[i]; if (isNum(v)) { sum += v; n++; } }
        merged[i] = n > 0 ? sum / n : null;
      }
      out[base] = merged;
      continue;
    }

    // 3. 아무도 안 주면 메움 모델.
    const fill = slot.get(FILL_MODEL);
    if (Array.isArray(fill)) out[base] = fill;
  }

  return out;
};
