/**
 * skyTuning.ts
 *
 * 하늘 렌더링의 **눈으로 맞춰야 하는 값들**을 한곳에 모아 런타임에 바꿉니다.
 *
 * Why: 노출·대비·감광 같은 값은 물리로 정해지지 않습니다. 톤매핑과 눈 순응이
 * 끼어 있어서, 선형 복사휘도를 절반으로 줄여도 화면은 거의 안 바뀔 수 있고
 * 반대도 됩니다. 결국 **실제 하늘과 나란히 놓고 보면서** 맞추는 수밖에 없는데,
 * 그때마다 상수를 고치고 다시 빌드하면 감을 잡을 수가 없습니다.
 *
 * 그래서 이 값들을 상수에서 빼내 여기로 옮기고, 개발자 패널에서 슬라이더로
 * 움직일 수 있게 했습니다.
 *
 * ## 두 종류가 있습니다
 *
 * 1. **셰이더 uniform으로 나가는 값** (노출·대비·감광·박명)
 *    → `ATMOSPHERE_GLSL` 안에서 `uniform float`로 선언되고, 매 프레임
 *      `applyTuningUniforms`가 값을 밀어 넣습니다. 슬라이더가 즉시 반영됩니다.
 *    → **TS 쪽도 같은 값을 읽어야 합니다.** `skyRadiance`/`applyCloudDimming`이
 *      구름 조명 색을 만들 때 쓰는 값이라, 한쪽만 바뀌면 하늘과 구름이 갈라집니다.
 *
 * 2. **순수 TS 값** (운형 판정 문턱)
 *    → 셰이더와 무관. 바뀌면 구름을 다시 배치하기만 하면 됩니다.
 *
 * 저장은 하지 않습니다(세션 한정). 맞춘 값은 패널의 "코드로 복사"로 뽑아
 * 소스 기본값에 반영하는 흐름을 의도했습니다 — 튜닝 결과가 코드에 남아야
 * 다음 사람도 같은 하늘을 봅니다.
 */

export interface SkyTuning {
  // ── 표시 변환 ────────────────────────────────────────────────────────────
  /** 물리 복사휘도 → 화면 밝기 노출 */
  displayExposure: number;
  /** 어두울수록 올라가는 눈 순응 노출의 최댓값 */
  adaptMax: number;
  /** 순응이 시작되는 태양 고도 (이보다 높으면 순응 없음) */
  adaptStartAlt: number;
  /** 순응이 최대가 되는 태양 고도 */
  adaptEndAlt: number;
  /** 톤매핑 후 채도 복원 */
  displaySaturation: number;
  /** 하단 대비 S커브 */
  displayContrast: number;
  /** 산란 → 화면 밝기 이득 */
  skyExposure: number;

  // ── 구름 아래 감광 ───────────────────────────────────────────────────────
  /** 구름이 완전히 덮었을 때 남는 하늘빛 밝기 (낮을수록 흐린 날이 어두움) */
  cloudDimFloor: number;
  /** 구름 아래에서 하늘빛이 잃는 채도 */
  cloudDimDesat: number;

  // ── 박명 ────────────────────────────────────────────────────────────────
  /** 단일산란 유효 척도고도 (작을수록 해 진 뒤 빨리 어두워짐) */
  twilightScaleKm: number;
  /** 다중산란 유효 척도고도 (클수록 잔광이 오래 남음) */
  twilightMsScaleKm: number;
  /** 박명 오존 경로 배율의 기울기 (올릴수록 박명 하늘이 짙은 파랑, 어두워짐) */
  ozoneTwilightGain: number;
  /** 그늘진 구름이 황혼 환경광에 물드는 정도 (0이면 물들지 않음) */
  twilightTint: number;

  // ── 운형 판정 문턱 (순수 TS) ─────────────────────────────────────────────
  /** 적란운: 이 강수량(mm/h) 초과 + 상층 발달 */
  cbPrecipMm: number;
  /** 적란운: 상층운 비율(%) 초과 */
  cbHighPct: number;
  /** 난층운: 이 강수량(mm/h) 초과 + 저층 운량 */
  nsPrecipMm: number;
  /** 난층운: 저층 운량 비율 초과 */
  nsCover: number;
  /** 층운/층적운 갈림: 저층 운량 이 값 초과 */
  stratusCover: number;
  /** 층운: 습도(%) 이 값 초과면 층운, 아니면 층적운 */
  stratusHumidityPct: number;
  /** 적운이 나오기 시작하는 저층 운량 */
  cumulusCover: number;

  // ── 덱 / 빌보드 ─────────────────────────────────────────────────────────
  /** 덱이 이 운량에서 완전히 막힌 것으로 보고 빌보드를 버림 */
  deckSealCover: number;
  /** 빌보드 최대 개수 */
  maxClouds: number;
}

export const DEFAULT_TUNING: SkyTuning = {
  displayExposure: 0.62,
  adaptMax: 16.0,
  adaptStartAlt: 6.0,
  adaptEndAlt: -14.0,
  displaySaturation: 1.22,
  displayContrast: 1.06,
  skyExposure: 22.0,

  cloudDimFloor: 0.30,
  cloudDimDesat: 0.85,

  twilightScaleKm: 13.0,
  twilightMsScaleKm: 42.0,
  ozoneTwilightGain: 0.30,
  twilightTint: 0.75,

  cbPrecipMm: 0.9,
  cbHighPct: 35,
  nsPrecipMm: 0.3,
  nsCover: 0.6,
  stratusCover: 0.6,
  stratusHumidityPct: 90,
  cumulusCover: 0.35,

  deckSealCover: 0.93,
  maxClouds: 160,
};

/** 슬라이더 UI가 쓰는 메타데이터 */
export interface TuningField {
  key: keyof SkyTuning;
  label: string;
  min: number;
  max: number;
  step: number;
  /** 이 값을 올리면 화면이 어떻게 되는지 — 패널에 한 줄로 보여줍니다 */
  hint: string;
  /** true면 셰이더 uniform (즉시 반영), false면 구름 재배치가 필요 */
  live: boolean;
}

export interface TuningGroup {
  title: string;
  fields: TuningField[];
}

export const TUNING_GROUPS: TuningGroup[] = [
  {
    title: '노출 · 밝기',
    fields: [
      { key: 'displayExposure', label: '노출', min: 0.1, max: 2.0, step: 0.01, hint: '올리면 전체가 밝아짐', live: true },
      { key: 'skyExposure', label: '산란 이득', min: 5, max: 60, step: 0.5, hint: '하늘빛 자체의 세기', live: true },
      { key: 'adaptMax', label: '눈 순응 최대', min: 1, max: 40, step: 0.5, hint: '밤이 얼마나 밝게 보이나', live: true },
      { key: 'adaptStartAlt', label: '순응 시작 고도', min: -10, max: 30, step: 0.5, hint: '이 태양고도 아래부터 순응 시작', live: true },
      { key: 'adaptEndAlt', label: '순응 완료 고도', min: -30, max: 0, step: 0.5, hint: '이 고도에서 순응 최대', live: true },
    ],
  },
  {
    title: '색 · 대비',
    fields: [
      { key: 'displaySaturation', label: '채도', min: 0.3, max: 2.5, step: 0.01, hint: '올리면 색이 진해짐', live: true },
      { key: 'displayContrast', label: '대비', min: 0.7, max: 1.8, step: 0.01, hint: '올리면 어두운 쪽이 더 눌림', live: true },
    ],
  },
  {
    title: '흐린 날 감광',
    fields: [
      { key: 'cloudDimFloor', label: '완전 차폐 시 하늘빛', min: 0.02, max: 1.0, step: 0.01, hint: '낮출수록 흐린 날이 어두워짐', live: true },
      { key: 'cloudDimDesat', label: '구름 아래 탈색', min: 0, max: 1, step: 0.01, hint: '올리면 흐린 날 색이 빠짐', live: true },
      { key: 'deckSealCover', label: '덱 밀폐 운량', min: 0.7, max: 1.0, step: 0.01, hint: '이 운량 넘으면 빌보드를 버리고 덱만', live: false },
      { key: 'maxClouds', label: '빌보드 최대 수', min: 40, max: 400, step: 10, hint: '내리면 가벼워지고 성겨짐', live: false },
    ],
  },
  {
    title: '박명 (해 진 뒤)',
    fields: [
      { key: 'twilightScaleKm', label: '직달 척도고도', min: 4, max: 30, step: 0.5, hint: '낮출수록 해 지고 빨리 어두워짐', live: true },
      { key: 'twilightMsScaleKm', label: '다중산란 척도고도', min: 10, max: 90, step: 1, hint: '올릴수록 잔광이 오래 남음', live: true },
      { key: 'ozoneTwilightGain', label: '박명 오존 경로', min: 0, max: 0.8, step: 0.01, hint: '올리면 박명 하늘이 짙은 파랑·어두워짐', live: true },
      { key: 'twilightTint', label: '구름 황혼 물듦', min: 0, max: 1.5, step: 0.01, hint: '올리면 그늘진 구름이 노을색으로 물듦', live: true },
    ],
  },
  {
    title: '운형 판정 (기상 → 구름)',
    fields: [
      { key: 'cbPrecipMm', label: '적란운 강수 문턱', min: 0.1, max: 5, step: 0.1, hint: '낮출수록 적란운이 자주 나옴', live: false },
      { key: 'cbHighPct', label: '적란운 상층 문턱 %', min: 0, max: 90, step: 5, hint: '낮출수록 적란운이 자주 나옴', live: false },
      { key: 'nsPrecipMm', label: '난층운 강수 문턱', min: 0.05, max: 3, step: 0.05, hint: '낮출수록 비구름이 자주 나옴', live: false },
      { key: 'nsCover', label: '난층운 운량 문턱', min: 0.2, max: 1.0, step: 0.02, hint: '낮출수록 비구름이 자주 나옴', live: false },
      { key: 'stratusCover', label: '층운계 운량 문턱', min: 0.2, max: 1.0, step: 0.02, hint: '넘으면 층운/층적운', live: false },
      { key: 'stratusHumidityPct', label: '층운 습도 문턱 %', min: 50, max: 100, step: 1, hint: '넘으면 층운, 아니면 층적운', live: false },
      { key: 'cumulusCover', label: '적운 운량 문턱', min: 0.05, max: 0.8, step: 0.02, hint: '넘으면 뭉게구름이 섞임', live: false },
    ],
  },
];

// ── 저장소 ─────────────────────────────────────────────────────────────────
// 의도적으로 zustand를 쓰지 않습니다. 이 값들은 **매 프레임 셰이더가 읽는**
// 것이라, 스토어 구독으로 React 리렌더를 유발하면 안 됩니다.
// 렌더 루프는 `getTuning()`을 직접 읽고, 패널만 `subscribeTuning`으로 갱신합니다.

let current: SkyTuning = { ...DEFAULT_TUNING };
const listeners = new Set<(t: SkyTuning) => void>();

export function getTuning(): SkyTuning {
  return current;
}

export function setTuning(patch: Partial<SkyTuning>): void {
  current = { ...current, ...patch };
  listeners.forEach(fn => fn(current));
}

export function resetTuning(): void {
  current = { ...DEFAULT_TUNING };
  listeners.forEach(fn => fn(current));
}

export function subscribeTuning(fn: (t: SkyTuning) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** 기본값에서 달라진 것만 — 패널의 "코드로 복사"에 씁니다. */
export function tuningDiff(): Partial<SkyTuning> {
  const out: Record<string, number> = {};
  (Object.keys(DEFAULT_TUNING) as (keyof SkyTuning)[]).forEach(k => {
    if (Math.abs(current[k] - DEFAULT_TUNING[k]) > 1e-9) out[k] = current[k];
  });
  return out as Partial<SkyTuning>;
}

/**
 * 지금 값을 소스에 붙여 넣을 수 있는 형태로 뽑습니다.
 * 튜닝 결과가 코드로 돌아가야 다음 실행에서도 같은 하늘이 나옵니다.
 */
export function tuningAsCode(): string {
  const diff = tuningDiff();
  const keys = Object.keys(diff) as (keyof SkyTuning)[];
  if (keys.length === 0) return '// 기본값과 동일';
  return (
    '// src/utils/skyTuning.ts 의 DEFAULT_TUNING 에 반영하세요\n' +
    keys.map(k => `  ${k}: ${(diff[k] as number).toFixed(4).replace(/0+$/, '').replace(/\.$/, '')},`).join('\n')
  );
}
