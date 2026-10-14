/**
 * cloudDiffuse.ts — 구름 속 **확산광**(여러 번 산란한 햇빛 + 하늘빛)의 두-흐름 근사. three.js 없음, 순수 함수.
 *
 * §138(RULER-physics3). takram 은 표본의 빛을 "해 쪽 행진 다중 산란 근사 + 하늘빛 + 지면 반사" 로 두는데, 두꺼운 층의
 * 밑면에서 다중 산란 근사는 e^(−τ/128) 꼴로 꺼져(τ 100 에서 0.008) 밑면이 하늘빛 색(푸른 회색)이 됩니다. §126.6 의 `thru`
 * 항이 그 자리를 메웠지만 위쪽 광학두께를 표본의 **국소** 소광으로 세어 밑면 램프에서 햇빛의 1/3 을 넣었습니다(§138.0).
 *
 * 여기서는 평면평행 보존 산란 판(ω = 1)의 두-흐름 해를 씁니다. 축척 광학두께 τ' = (1 − g)τ(delta 축척).
 *   확산 투과  T(τ'_t) = 1 / (1 + 0.75 τ'_t)                      (점근 이론, King & Harshvardhan 1986)
 *   에너지 밀도 ∝ F↓ + F↑ 는 τ 에 선형: 꼭대기 (1 + R) = 2 − T, 밑면 T.
 *   확산장    D(x) = (2 − T)(1 − x) + T x − e^(−τ'_above / μ0),  x = τ'_above / τ'_t   (직접광 몫은 뺌 — takram 의 다중 산란 근사가 맡음)
 * 표본의 광원에 E_top · D / 4π 를 더합니다(E_top = 햇빛·μ0 + 하늘 반구 조도). 셰이더 GLSL 도 같은 상수에서 만듭니다.
 */

/** 물방울 구름의 비대칭 인자. 얼음은 0.75~0.8 이지만 이 단계에서는 한 값(RULER-physics3 §8). */
export const DIFFUSE_G = 0.85;
/** 확산 투과 식의 계수 3/4. */
export const DIFFUSE_K = 0.75;
/** 해가 지평선 근처일 때 μ0 바닥값 — 평면평행 세우기(τ_v = τ_sun·μ0)가 0 으로 무너지지 않게. */
export const MU0_MIN = 0.05;

const clamp01 = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x);

/** 보존 산란 판의 확산 투과율. 축척 안 한 τ 를 받습니다. */
export const diffuseTransmittance = (tauTotal: number, g = DIFFUSE_G): number => {
  const t = Math.max(0, tauTotal) * (1 - g);
  return 1 / (1 + DIFFUSE_K * t);
};

/**
 * 표본의 확산장(햇빛 꼭대기 조도 1 기준, 4π 로 나누기 전).
 * tauAbove = 표본 위 수직 광학두께, tauTotal = 기둥 전체(≥ tauAbove), mu0 = 해 고도 코사인.
 */
export const diffuseField = (tauAbove: number, tauTotal: number, mu0: number, g = DIFFUSE_G): number => {
  const ta = Math.max(0, tauAbove) * (1 - g);
  const tt = Math.max(ta, Math.max(0, tauTotal) * (1 - g));
  if (tt <= 0) return 0;
  const T = 1 / (1 + DIFFUSE_K * tt);
  const x = clamp01(ta / tt);
  const direct = Math.exp(-ta / Math.max(MU0_MIN, mu0));
  return Math.max(0, (2 - T) * (1 - x) + T * x - direct);
};

/**
 * 셰이더 조각 — `marchClouds` 안, `opticalDepth`(해 쪽 행진 + 그림자 지도)·`height`·`media`·`surfaceNormal` 이 있는 자리에
 * 넣습니다. 바깥에서 `gTauAbove`(수직, 표본 위)·`gTauTotal`(수직, 기둥)·`gMu0` 을 먼저 두고 이 함수를 부릅니다.
 * 위 TS 와 **같은 상수**를 글자로 넣습니다(테스트가 둘을 견줍니다).
 */
export const DIFFUSE_GLSL = [
  `float genusDiffuseField(const float tauAbove, const float tauTotal, const float mu0) {`,
  `  float ta = max(0.0, tauAbove) * ${(1 - DIFFUSE_G).toFixed(4)};`,
  `  float tt = max(ta, max(0.0, tauTotal) * ${(1 - DIFFUSE_G).toFixed(4)});`,
  `  if (tt <= 0.0) return 0.0;`,
  `  float T = 1.0 / (1.0 + ${DIFFUSE_K.toFixed(4)} * tt);`,
  `  float x = clamp(ta / tt, 0.0, 1.0);`,
  `  float direct = exp(-ta / max(${MU0_MIN.toFixed(4)}, mu0));`,
  `  return max(0.0, (2.0 - T) * (1.0 - x) + T * x - direct);`,
  `}`,
].join('\n');
