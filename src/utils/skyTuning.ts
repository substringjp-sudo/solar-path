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
  /**
   * 톤매핑 커브 (계획 42절 0단계).
   *
   * 'aces' 는 밝고 채도 높은 색의 색상을 밉니다(빨강→주황, 파랑→보라).
   * 노을이 정확히 그 경우라 Blender 4.0 도 같은 이유로 ACES 를 버렸습니다.
   * 'agx' 는 로그 공간을 길게 펴 밝은 쪽에도 계조와 색상이 남습니다.
   */
  tonemap: 'aces' | 'agx';
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
  /**
   * **푸른 하늘에만 거는 채도 배율** (1이면 없음).
   *
   * 사진 3장을 재 보니 태양에서 먼 하늘의 **선형** B/R 이 3.2~4.2 인데
   * 우리는 2.1 이었습니다. 그런데 이건 에어로졸을 아무리 걷어내도
   * 닿지 않습니다 — 에어로졸 0 인 순수 Rayleigh 의 색도가 [1, 1.92, 3.55]
   * 인데 사진이 요구하는 것은 [1, 1.65, 4.07] 로, **물리 한계 바깥**입니다.
   * 사진은 휴대폰이 이미 채도를 올려 저장한 JPEG 이라 그렇습니다.
   *
   * 그래서 이것은 물리가 아니라 **카메라 응답**으로 따로 둡니다. 전역
   * 채도(displaySaturation)를 올리면 노을까지 같이 뜨는데, 노을이 원색으로
   * 뜨는 것은 이미 한 번 고친 결함입니다(20절). 그래서 파랑이 우세한
   * 화소에만 겁니다 — 노을·구름·태양은 B<R 이라 가중치가 0 입니다.
   */
  skyBlueBoost: number;
  /**
   * 그 파랑 보정의 **채도 천장** (HSV 채도).
   *
   * 천장이 없으면 이미 짙푸른 천정과 박명이 가장 세게 밀려 사진에 없는
   * 형광 파랑이 됩니다 — 재 보니 천정의 채도 0.60 초과 화소가 사진 0.2% 대
   * 우리 17.3% 였습니다. 판정(verify-photo-match)이 0.60 을 보므로 그 아래
   * 0.52 로 묶습니다.
   */
  skyBlueCap: number;
  /** 산란 → 화면 밝기 이득 */
  skyExposure: number;
  /**
   * 두꺼운 시선 경로에서 색이 씻기는 세기 (0이면 안 씻김).
   *
   * 단일산란 근사는 광로가 길어져도 색을 짙게 유지합니다. 실제로는 여러 번
   * 산란되며 파장이 섞여 중성으로 끌립니다. 휘도는 보존하고 색만 끕니다.
   */
  airWash: number;
  /**
   * 구름 무늬의 옥타브당 진폭 감쇠.
   *
   * fbm 의 파워 스펙트럼 기울기는 β = 2·log2(1/a) 입니다. a=0.5 면 β=2.0 —
   * 실제로 흐린 하늘 렌더를 재니 **2.03** 이 나왔습니다. 실제 하늘 사진의
   * 중앙값은 2.6~3.5 라, 우리 구름은 잔무늬가 과하게 많습니다.
   * β=3.0 을 겨누면 a = 2^(-1.5) = 0.354.
   */
  fbmGain: number;
  /**
   * 릴리프 노멀을 구할 때 쓰는 유한차분 간격 (셀 크기의 배수).
   *
   * 0.08 이면 **가장 잔 무늬의 미분**을 보게 됩니다. 미분은 고주파를 키우므로
   * (β=2 인 장의 미분은 β=0, 즉 백색잡음에 가깝습니다) 그 음영이 화면 전체에
   * 잔무늬를 찍습니다. 흐린 하늘에서 β 가 2.06(사진 3.49), 국소대비가 사진의
   * 4.5배로 나온 것이 이것입니다 — 두께가 포화해 보이는 것이 두께가 아니라
   * 그 기울기이기 때문입니다.
   *
   * 값을 키우면 **알갱이가 아니라 구름 덩어리의 모양**에 음영이 붙습니다.
   */
  reliefEps: number;
  /**
   * 천정을 볼 때 산란점의 높이 (척도고도 배수).
   *
   * 시선이 가파를수록 산란이 높은 곳에서 일어나고, 그만큼 햇빛이 통과한
   * 공기가 얇아 **덜 붉습니다.** 이 값이 그 세기입니다 —
   * mSun = airMass(태양고도) * exp(-hFrac).
   *
   * 사용자 사진(QR 로 조건을 앎)의 따뜻함 프로파일은 위 60%가 음수(파랑)
   * 인데 1.6 에서는 렌더가 꼭대기까지 양수(따뜻)였습니다. 태양고도 2.26°
   * 에서 airmass 20 이 exp(-1.6)=0.20 을 곱해도 4 라, 아직 붉습니다.
   */
  scatterHeightZenith: number;
  /**
   * 다중산란이 통과했다고 치는 태양 광로의 비율 (단일산란 대비).
   *
   * 다중산란은 등방적이라 **하늘 전 방향**을 채웁니다. 그래서 이 값이 크면
   * 태양의 붉은 색이 반대편 지평선까지 칠해집니다. 실제로 사용자 사진에서
   * 태양쪽 지평선 따뜻함 +0.23, 반대편 -0.017 로 0.25 차이인데, 렌더는
   * +0.227 대 +0.197 로 **거의 같았습니다** (계획 22절).
   */
  msAirmassFrac: number;
  /** 다중산란 태양 광로의 하한. 이 값이 비율보다 크면 비율은 무의미해집니다. */
  msAirmassCap: number;
  /**
   * 다중산란 색의 **방위각 감쇠** — 태양에서 멀어질수록 중성으로.
   *
   * 다중산란은 등방적이라 하늘 전 방향을 채우는데, 우리 식은 그 색을
   * 태양의 붉은 투과색 그대로 실어 나릅니다. 그래서 노을이 반대편
   * 지평선까지 번집니다. 실제로는 산란을 거듭할수록 태양 방향의 기억을
   * 잃고 파장이 섞여 중성으로 돌아갑니다.
   *
   * 사용자 사진(QR): 태양쪽 지평선 따뜻함 +0.23, 반대편 -0.017 — 차이 0.25.
   * 감쇠가 없던 렌더: +0.227 대 +0.197 — 차이 0.03 (계획 22절).
   *
   * 휘도는 보존하므로 애써 맞춘 박명 밝기 곡선은 안 건드립니다.
   */
  msAzimWash: number;
  /** 다중산란 이득. 0 이면 다중산란 성분이 사라집니다 — 성분 분리 진단용. */
  msGain: number;
  /**
   * 산란점 높이가 최대에 이르는 시선 고도 (도).
   *
   * hFrac = mix(SH_HORIZON, SH_ZENITH, smoothstep(0, KNEE, 시선고도)) 의 KNEE.
   * **끝점(SH_ZENITH)이 아니라 곡선의 모양**을 정합니다. 끝점만 올리면
   * 낮은 고도까지 같이 식어 지평선 노을이 죽습니다 — 태양이 낮을 때는
   * 광로가 조금만 얇아져도 파랑 투과율이 크게 오르기 때문입니다.
   * KNEE 를 당기면 위쪽만 빨리 식고 아래쪽은 덜 움직입니다.
   */
  scatterHeightKneeDeg: number;

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
  // ⚠ 42절에서 AgX 를 기본으로 바꿨다가 **되돌렸습니다.** 이력을 남깁니다.
  //
  // 처음 측정에서 AgX 가 겨자 노을·올리브 새벽을 확실히 고치는 것으로
  // 나왔습니다(무채색비율 0.303 → 0.000, 채도 0.181 → 0.411). 그런데 그건
  // **제가 적은 행렬이 틀려서** 생긴 결과였습니다 — 행 합이 1.106 / 0.845 라
  // 중성색이 보존되지 않아 흰색이 0.68 에서 천장을 쳤고, 화면이 통째로
  // 어두워진 것이 "차분해 보인" 정체였습니다.
  //
  // 표준 행렬(Wrensch, 두 행렬 모두 행 합 1.0000)로 고치자 AgX 는 ACES 와
  // 거의 같아지고 겨자 노을도 그대로입니다. 채도만 30% 낮아집니다
  // (0.371 → 0.248 · 0.297 → 0.195). 전체 회귀도 실패 단언 20 → 25.
  //
  // 배운 것: **겨자색의 원인은 톤 커브가 아니라 복사 모형**입니다. 태양 0°
  // 에서 하늘 전체(감마 3°~120°)의 복사휘도 폭이 1.7배뿐이라, 어떤 커브를
  // 씌워도 한 색이 됩니다. 42절 1단계(Hillaire LUT)가 그걸 고칠 자리입니다.
  // AgX 구현은 남겨 둡니다 — 복사 폭이 넓어지면 그때 다시 잽니다.
  displayExposure: 0.62,
  tonemap: 'aces',
  adaptMax: 16.0,
  adaptStartAlt: 6.0,
  adaptEndAlt: -14.0,
  // ⚠ 이 둘을 **내리지 마세요.** 한 번 해 보고 되돌렸습니다.
  //
  // 실제 하늘 사진과 견주니 노을 채도가 5배였고(계획 20절), 둘을 1.00 으로
  // 내리면 그게 2.66배까지 떨어집니다. 그런데 같이 깨진 것들이 있었습니다:
  //
  //   깊은 황혼에 저층이 안 꺼짐   6/255 문턱에 37.7
  //   노을 명암폭                  90 → 80.3
  //   밤하늘이 덜 파래짐           R/B 0.55 문턱에 0.573
  //
  // 앞의 둘은 사용자가 처음에 꼽은 "지평선쪽만 빛나면서"와 "아래부터
  // 꺼진다" 바로 그것입니다. 전역 채도·대비는 **밤하늘의 파랑과 박명의
  // 보라에서 빼앗아 노을 구름의 과채도를 고치는** 잘못된 연장이었습니다.
  //
  // 진짜 결함은 따로 있었고 atm_display 에서 고쳤습니다 — 대비를 채널마다
  // 걸어 톤 커브가 채도까지 올리고 있었습니다. 그걸 휘도 전용으로 바꾸니
  // 이 값들을 그대로 두고도 노을 채도가 4.96 → 3.15배로 내려갑니다.
  displaySaturation: 1.22,
  displayContrast: 1.06,
  // 1.55 — 계측으로 고른 값입니다. β 보정(0.076→0.050)과 합쳐 태양에서 먼
  // 하늘이 사진의 [114,151,207] · 선형 B/R 3.7 · 채도 0.45 에 옵니다 —
  // 실측 [109,161,198] · 3.70 · 0.450. 더 올리면 형광 파랑으로 넘어갑니다.
  skyBlueBoost: 1.55,
  skyBlueCap: 0.52,
  skyExposure: 22.0,
  // 0.35 — 훑어서 고른 값입니다. 더 올리면 노을 채도기울기가 조금 더
  // 내려가지만(0.8 에서 1.115), 낮 하늘이 이미 사진보다 채도가 낮아
  // (0.69~0.83배) 낮을 더 씻는 대가가 큽니다.
  //
  // 이 손잡이만으로는 노을이 안 잡힙니다. 노을·박명 화면은 대부분이 구름
  // 화소이고, 구름 색은 하늘돔이 아니라 CloudSlab 의 조명 경로에서 옵니다 —
  // AIR_WASH 를 0에서 0.8까지 올려도 국소대비가 0.044 에서 **한 자리도**
  // 안 움직인 것이 그 증거입니다. 남은 격차는 계획 20절에 적었습니다.
  airWash: 0.35,
  fbmGain: 0.5,
  // 0.12 — 훑어서 고른 값입니다. 0.08 은 잔무늬의 미분에 음영을 붙여
  // 노을·박명 국소대비를 사진의 2~3배로 만들었고("구름 대비가 너무 심하다"),
  // 0.16 이상은 천정의 구조를 통째로 지웠습니다(구름각크기 → 화면 크기).
  reliefEps: 0.12,
  scatterHeightZenith: 1.6,
  msAirmassFrac: 0.35,
  msAirmassCap: 4.0,
  // 0.6 — 훑어서 고른 값입니다. 반대편 지평선 따뜻함이 +0.204 → +0.111 로
  // 내려가면서(사진 -0.017) **태양쪽 노을은 0.224 → 0.222 로 그대로**입니다.
  // 0.85 는 반대편 지평선을 +0.076 까지 더 내리지만 반대편 위쪽 하늘이
  // -0.224 → -0.278 로 과냉각됩니다(사진 -0.215).
  //
  // 이 손잡이는 **방위각 축만** 고칩니다. 태양쪽 위쪽 하늘이 아직 따뜻한 것
  // (+0.10, 사진 -0.112)은 고도 축 문제라 여기서 안 잡힙니다.
  // 0.6 — 훑어서 고른 값입니다. 반대편 지평선 따뜻함이 +0.204 → +0.111 로
  // 내려가면서(사진 -0.017) **태양쪽 노을은 0.224 → 0.222 로 그대로**입니다.
  //
  // ⚠ 대가가 있습니다. verify-photo-match 에서 노을 원색 화소가 0.622 → 0.353
  // 으로 크게 좋아지는 대신(사진 0.009), 채도기울기가 나빠집니다 —
  // 노을 1.281 → 1.368, 흐림은 0.992 → 1.029 로 문턱(1.0)을 새로 넘습니다.
  // 감쇠가 태양에서 먼 **위쪽** 하늘을 더 많이 탈색시켜 아래/위 채도비가
  // 커지기 때문입니다.
  //
  // 0.35 로 낮춰도 흐림은 1.016 로 여전히 문턱을 넘고 원색 이득만 잃습니다
  // (0.353 → 0.443). 비용은 어느 값에서나 비슷하고 이득만 줄어, 0.6 을
  // 유지합니다.
  //
  // 이 손잡이는 **방위각 축만** 고칩니다. 태양쪽 위쪽 하늘이 아직 따뜻한 것
  // (+0.10, 사진 -0.112)은 고도 축 문제라 여기서 안 잡힙니다.
  msAzimWash: 0.6,
  msGain: 0.42,
  scatterHeightKneeDeg: 70,

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
      { key: 'skyBlueBoost', label: '하늘 파랑', min: 1.0, max: 4.0, step: 0.01, hint: '푸른 하늘만 진해짐 (노을은 안 건드림)', live: true },
      { key: 'skyBlueCap', label: '파랑 천장', min: 0.3, max: 0.9, step: 0.01, hint: '이 채도 위로는 안 밀림', live: true },
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
  const out: Record<string, unknown> = {};
  // ⚠ 예전에는 전 필드를 숫자로 가정하고 뺄셈을 했습니다. 42절에서 톤매핑
  // 커브('aces' | 'agx')가 들어오면서 문자열 필드가 생겼으므로, 숫자만
  // 오차로 비교하고 나머지는 값이 다른지로 봅니다.
  (Object.keys(DEFAULT_TUNING) as (keyof SkyTuning)[]).forEach(k => {
    const cur = current[k], def = DEFAULT_TUNING[k];
    const differs = typeof cur === 'number' && typeof def === 'number'
      ? Math.abs(cur - def) > 1e-9
      : cur !== def;
    if (differs) out[k] = cur;
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
    keys.map(k => {
      const v = diff[k];
      if (typeof v !== 'number') return `  ${k}: '${String(v)}',`;
      return `  ${k}: ${v.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')},`;
    }).join('\n')
  );
}
