/**
 * cloudDiffuse.ts — 구름 속 **확산광**(여러 번 산란한 햇빛 + 하늘빛)의 두-흐름 근사. three.js 없음, 순수 함수.
 *
 * §138(RULER-physics3). takram 은 표본의 빛을 "해 쪽 행진 다중 산란 근사 + 하늘빛 + 지면 반사" 로 두는데, 두꺼운 층의
 * 밑면에서 다중 산란 근사는 e^(−τ/128) 꼴로 꺼져(τ 100 에서 0.008) 밑면이 하늘빛 색(푸른 회색)이 됩니다. §126.6 의 `thru`
 * 항이 그 자리를 메웠지만 위쪽 광학두께를 표본의 **국소** 소광으로 세어 밑면 램프에서 햇빛의 1/3 을 넣었습니다(§138.0).
 *
 * 평면평행 보존 산란 판(ω = 1)의 두-흐름 해. 축척 광학두께 τ' = (1 − g)τ(delta 축척).
 *   확산 투과  T(τ'_t) = 1 / (1 + 0.75 τ'_t)       (점근 이론 4/(3τ' + 4q'), q' 를 4/3 로 — τ' → 0 에서 1 이 되게; τ' 1.5 에서 점근값과 15 % 차)
 *   직접광 투과의 각 가중 K(μ0) = (3/7)(1 + 2μ0)   (van de Hulst; ∫ 2μ K dμ = 1 — 햇빛 몫에만)
 *   에너지 밀도 ∝ F↓ + F↑ 는 τ 에 선형: 꼭대기 (1 + R) = 2 − T, 밑면 T.
 *   확산장    D(x) = (2 − T)(1 − x) + T x − (충돌 전 몫),  x = τ'_above / τ'_t
 *            햇빛: 충돌 전 = e^(−τ'_above / μ0)(축척 직접광 — 전방 봉우리는 takram 다중 산란 옥타브가 맡음)
 *            하늘: 충돌 전 = e^(−2 τ'_above)(반구 평균 시컨트 2)
 *   광원     J = [E_sun·μ0·K(μ0)·D_sun + E_h·D_sky] / 2π     (등방 반구 둘의 평균 복사휘도 = (F↓ + F↑)/2π; 산란 광원은 위상 적분 1 이라 J 그대로)
 *   E_h = takram skyIrradiance / 2π (runtime.glsl GetSunAndSkyScalarIrradiance 는 수평면 하늘 조도 × 2π 를 줌), E_sun = takram sunIrradiance(코사인 없음).
 * 기둥 광학두께는 그림자 지도가 아니라(행진 minTransmittance 에서 τ ≈ 72 로 포화 — 검토 1) 층 단면의 **해석적 적분**으로 셉니다(§138.1).
 */

/** 물방울 구름의 비대칭 인자. 얼음은 0.75~0.8 이지만 이 단계에서는 한 값(RULER-physics3 §8). */
export const DIFFUSE_G = 0.85;
/** 확산 투과 식의 계수 3/4. */
export const DIFFUSE_K = 0.75;
/** 해가 지평선 근처일 때 μ0 바닥값 — 평면평행 세우기가 0 으로 무너지지 않게. */
export const MU0_MIN = 0.05;
/** 1 / 2π — E_h = skyIrradiance / 2π, J = (F↓ + F↑) / 2π. */
export const INV_2PI = 1 / (2 * Math.PI);
/** 하늘빛의 충돌 전 감쇠 지수(반구 평균 시컨트). */
export const SKY_SECANT = 2;
/** 기둥 적분의 중점 수. */
export const COLUMN_N = 8;

const clamp01 = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x);

/** 보존 산란 판의 확산 투과율. 축척 안 한 τ 를 받습니다. */
export const diffuseTransmittance = (tauTotal: number, g = DIFFUSE_G): number => {
  const t = Math.max(0, tauTotal) * (1 - g);
  return 1 / (1 + DIFFUSE_K * t);
};

/** 직접광의 각 가중 K(μ0) = (3/7)(1 + 2μ0). */
export const sunAngularWeight = (mu0: number): number => (3 / 7) * (1 + 2 * Math.max(MU0_MIN, mu0));

/**
 * 표본의 확산장(꼭대기 조도 1 기준, (F↓ + F↑)/E; 2π 로 나누기 전). source = 'sun' 이면 충돌 전 몫 e^(−τ'/μ0), 'sky' 면 e^(−2τ').
 * tauAbove = 표본 위 수직 광학두께, tauTotal = 기둥 전체(≥ tauAbove), mu0 = 해 고도 코사인.
 */
export const diffuseField = (tauAbove: number, tauTotal: number, mu0: number, source: 'sun' | 'sky' = 'sun', g = DIFFUSE_G): number => {
  const ta = Math.max(0, tauAbove) * (1 - g);
  const tt = Math.max(ta, Math.max(0, tauTotal) * (1 - g));
  if (tt <= 0) return 0;
  const T = 1 / (1 + DIFFUSE_K * tt);
  const x = clamp01(ta / tt);
  const direct = Math.exp(-ta * (source === 'sun' ? 1 / Math.max(MU0_MIN, mu0) : SKY_SECANT));
  return Math.max(0, (2 - T) * (1 - x) + T * x - direct);
};

/**
 * 셰이더 조각 — `marchClouds` 앞에 넣습니다. 위 TS 와 **같은 상수**를 글자로(테스트가 둘을 견줍니다).
 * genusDiffuseField(tauAbove, tauTotal, k): k = 충돌 전 몫의 지수 계수(햇빛 1/μ0, 하늘 2).
 */
export const DIFFUSE_GLSL = [
  `float genusDiffuseField(const float tauAbove, const float tauTotal, const float k) {`,
  `  float ta = max(0.0, tauAbove) * ${(1 - DIFFUSE_G).toFixed(4)};`,
  `  float tt = max(ta, max(0.0, tauTotal) * ${(1 - DIFFUSE_G).toFixed(4)});`,
  `  if (tt <= 0.0) return 0.0;`,
  `  float T = 1.0 / (1.0 + ${DIFFUSE_K.toFixed(4)} * tt);`,
  `  float x = clamp(ta / tt, 0.0, 1.0);`,
  `  float direct = exp(-ta * k);`,
  `  return max(0.0, (2.0 - T) * (1.0 - x) + T * x - direct);`,
  `}`,
  `float genusSunWeight(const float mu0) { return 0.428571 * (1.0 + 2.0 * max(${MU0_MIN.toFixed(4)}, mu0)); }`,
].join('\n');
