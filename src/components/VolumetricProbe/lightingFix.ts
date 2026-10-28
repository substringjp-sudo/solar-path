/**
 * lightingFix.ts — §178 앱 조명 결함 두 가지의 셰이더 주입(문서 §176.2(e)(f) · §177.6, 사용자 승인 2026-10-28).
 *
 *  (e) clampInscatter — takram 대기 원근 산란(GetSkyRadianceToPoint = 눈→끝점 산란 − 투과율 × 끝점→무한 산란)은 두 표 값의 차라
 *      깊은 박명(해 ≲ −9°)에 낮은 고도의 먼 덮개에서 음수가 됩니다(P1 후쿠이 6~10°: 맑은 하늘 Y 의 −0.10~−0.17, 원래 +0.05~+0.06).
 *      자르지 않아 덮개가 검게 그려졌습니다. 더하는 자리 두 곳에서 max(·, 0):
 *        - 구름 패스 applyAerialPerspective (`color.rgb * transmittance + inscatter * color.a`)
 *        - 대기 효과 applyTransmittanceInscatter (`radiance + inscatter` — takram 지형 화소와 앱 §129 지형 빛 판이 이 함수를 부름)
 *      하늘 화소(getSkyRadiance)는 표 값 하나(빼기 없음)라 해당 없음.
 *  (f) irradianceLogMu — GetIrradiance 가 조도 표(μs 64 칸 × r 16 칸)를 하드웨어 쌍선형으로 읽어 μs 축이 선형 보간입니다. 박명 하늘빛은
 *      μs 한 칸(≈ 1.83°)에 10 배씩 줄어드는 지수 꼴이라 선형 보간이 칸 가운데에서 1.3~1.95 배 밝고, 시간을 옮기면 칸 주기로 출렁입니다
 *      (색 오차 최대 ±11 %). 이웃 두 μs 텍셀 가운데를 따로 읽어(폭은 IRRADIANCE_TEXTURE_WIDTH — uv 를 만든 그 상수) log 를 선형 보간한 뒤 exp
 *      (r 축은 그대로 하드웨어 선형).
 *      §178 검토 반영 — log 가중치: 지평선 위(−1..+5°)는 이웃 텍셀 비가 1.1~2.3 배라 E(μs) 가 거의 선형이고 log 의 기하 평균이 곡선 아래로
 *      처져(0..5° 에서 선형 대비 최대 −8.3 %, 칸 출렁임 2.8 → 5.7 %) 오히려 나빠졌습니다 [computed]. 그래서 채널마다 두 이웃의 log 비
 *      |ln B/A| 로 가중: ln 2 이하 = 선형, ln 4 이상 = log, 사이는 직선 램프. 가중치가 그 텍셀 쌍만의 함수라 절점(f = 0·1)에서 두 방식이
 *      같은 값 = μs 에 대해 연속. 앱 15 파장 표에서 비가 2 배를 넘는 쌍은 +0.9° 아래에서만 시작해, 해 ≳ +0.9° 는 예전 선형과 같은 식
 *      (CPU 이식에서 0 % 차 — 기기에서는 하드웨어 보간 가중치의 정밀도(8 비트 급) 만큼만 다를 수 있음 [estimate]).
 *      fixtures 기준 표 대비 보간만의 오차 [computed, verify-lighting-fixes.js (d)]: −10..−6° 예전 +0..+112 % → −5..+8 %, −6..−3° +0..+85 % →
 *      −9..0 %, −3..0° −1..+14 % → −5..+2 %, 0..2° −1..+3 % → −1..+1.4 %, ≥ +2° 예전 그대로.
 *      두 값 중 하나라도 LOG_MU_FLOOR 미만(0·음수 — 분광 sRGB 변환의 작은 음수, half-float 아정규가 0 으로 떨어진 값)이면 그 채널은
 *      예전 선형 그대로. 연속성: μs 방향은 늘 연속, r 방향은 ≤0 텍셀 옆(해 < −48°)에서만 1e−14 수준 계단(보이지 않음) [computed].
 *      남는 한계(기록): half-float 표에서 아정규를 0 으로 버리는(FTZ) GPU 는 해 ≤ −10° 텍셀이 0 이 되어 −10..−8° 는 예전·새 방식 모두
 *      틀립니다(Y −85..+43 %, 이 고침 전부터 — 표 정밀도 문제) [computed; 어떤 기기가 그러는지는 estimate].
 *  (e) 의 한계(기록): 자르면 음수 → 0 일 뿐 원래 값(+0.05..+0.06)을 되살리지 않습니다 — P1 덮개는 "검지 않음, Y ≥ 0" 이 기대값.
 *
 * 둘 다 끄면 글자가 주입 전 원문과 같습니다(바이트 동일 — verify-lighting-fixes.js (b)). 앵커가 정확히 한 번 나오지 않으면 throw
 * (takram 판이 바뀌어 조용히 원문이 되지 않게). 끄면 되돌아가는 것은 셰이더 글자뿐 — 같은 §178 의 g2(층 그림자 드리움 자격·꼭대기 0)는
 * 스위치 없이 늘 켜져 있습니다(volumetricScene.ts applyCastMask).
 * 기본값: DEFAULT_VOLUMETRIC_OPTIONS 는 둘 다 끔(하네스 관례 — 동결된 grain·tsun 꾸러미가 새 손잡이를 기본 0 으로 받음). 앱은
 * SkyScene3D(스토어 기본 true, `?? true`)와 VolumetricProbe 가 켜서 넘깁니다.
 */

/** 구름 패스 applyAerialPerspective 의 합성 줄(three-clouds 0.7.6 clouds.frag:713). */
export const INSCATTER_CLOUDS_ANCHOR = '  color.rgb = color.rgb * transmittance + inscatter * color.a;';
/** 대기 효과 applyTransmittanceInscatter 의 더하기 줄(three-atmosphere 0.19.1 aerialPerspectiveEffect.frag:146). 효과 접두어(e1…)가 붙기 전 글자. */
export const INSCATTER_AERIAL_ANCHOR = '  #ifdef INSCATTER\n  radiance = radiance + inscatter;\n  #endif // INSCATTER';
/** Bruneton GetIrradiance 몸통(three-atmosphere common.glsl:278-279) — 구름 패스 정점·조각 셰이더와 대기 효과에 한 번씩. */
export const IRRADIANCE_ANCHOR = '  vec2 uv = GetIrradianceTextureUvFromRMuS(atmosphere, r, mu_s);\n  return IrradianceSpectrum(texture(irradiance_texture, uv));';
/** log 보간을 쓰는 하한 — 두 이웃이 모두 이 이상이어야 log(fp32 정규 범위 안). 앱 15 파장 표(fixtures)의 가장 작은 양수 6.33e−28 [computed]. */
export const LOG_MU_FLOOR = 1e-30;
/** §178 log 가중치 램프(|ln B/A|) — 이 아래 = 선형(ln 2: 이웃 텍셀 비 2 배), */
export const LOG_MU_RAMP_LO = Math.LN2;
/** 이 위 = log(ln 4: 4 배). 사이는 직선. */
export const LOG_MU_RAMP_HI = 2 * Math.LN2;

const MARK = '§178';
const countOf = (s: string, a: string) => s.split(a).length - 1;
function replaceOnce(src: string, anchor: string, to: string, tag: string): string {
  const n = countOf(src, anchor);
  if (n !== 1) throw new Error(`lightingFix: ${tag} anchor count ${n} — ${anchor.trim().slice(0, 48)}`);
  return src.replace(anchor, () => to);
}

const F = LOG_MU_FLOOR.toExponential();
const RLO = LOG_MU_RAMP_LO.toFixed(7), RW = (LOG_MU_RAMP_HI - LOG_MU_RAMP_LO).toFixed(7);
const IRRADIANCE_LOG_MU = [
  '  vec2 uv = GetIrradianceTextureUvFromRMuS(atmosphere, r, mu_s);',
  `  // ${MARK} irradianceLogMu — μs 축은 이웃 두 텍셀 가운데를 따로 읽어 보간(r 축은 하드웨어 선형 그대로). 폭은 uv 를 만든 그 상수.`,
  '  float irrW = float(IRRADIANCE_TEXTURE_WIDTH);',
  '  float irrX = clamp(uv.x * irrW - 0.5, 0.0, irrW - 1.0);',
  '  float irrI = min(floor(irrX), irrW - 2.0);',
  '  float irrF = irrX - irrI;',
  '  vec3 irrA = texture(irradiance_texture, vec2((irrI + 0.5) / irrW, uv.y)).rgb;',
  '  vec3 irrB = texture(irradiance_texture, vec2((irrI + 1.5) / irrW, uv.y)).rgb;',
  `  vec3 irrLa = log(max(irrA, vec3(${F})));`,
  `  vec3 irrLb = log(max(irrB, vec3(${F})));`,
  '  vec3 irrLog = exp(mix(irrLa, irrLb, irrF));',
  `  // ${MARK} log 가중 — |ln B/A| ≤ ln2 선형 · ≥ ln4 log(박명 지수 꼴), 0·음수 이웃 채널은 선형`,
  `  vec3 irrUseLog = step(vec3(${F}), min(irrA, irrB)) * clamp((abs(irrLb - irrLa) - ${RLO}) / ${RW}, 0.0, 1.0);`,
  '  return IrradianceSpectrum(mix(mix(irrA, irrB, irrF), irrLog, irrUseLog));',
].join('\n');

/** (f) GetIrradiance 몸통을 μs 로그 보간으로. 정점·조각·대기 효과 글자 모두 같은 앵커. */
export function injectIrradianceLogMu(src: string, on: boolean): string {
  if (!on) return src;
  return replaceOnce(src, IRRADIANCE_ANCHOR, IRRADIANCE_LOG_MU, 'irradianceLogMu');
}

/** (e) 구름 패스 — applyAerialPerspective 의 산란 항을 0 에서 자름. */
export function injectInscatterClampClouds(src: string, on: boolean): string {
  if (!on) return src;
  return replaceOnce(src, INSCATTER_CLOUDS_ANCHOR,
    `  color.rgb = color.rgb * transmittance + max(inscatter, vec3(0.0)) * color.a;   // ${MARK} clampInscatter`, 'clampInscatter(clouds)');
}

/** (e) 대기 효과 — applyTransmittanceInscatter 의 산란 항을 0 에서 자름(takram 지형 화소 · 앱 지형 빛 판). */
export function injectInscatterClampAerial(src: string, on: boolean): string {
  if (!on) return src;
  return replaceOnce(src, INSCATTER_AERIAL_ANCHOR,
    `  #ifdef INSCATTER\n  radiance = radiance + max(inscatter, vec3(0.0));   // ${MARK} clampInscatter\n  #endif // INSCATTER`, 'clampInscatter(aerial)');
}

export interface LightingFixFlags { clampInscatter: boolean; irradianceLogMu: boolean }
export const LIGHTING_FIX_OFF: LightingFixFlags = { clampInscatter: false, irradianceLogMu: false };

/** 구름 패스 조각 셰이더(산란 자르기 + 조도 보간). */
export function applyLightingFixClouds(src: string, f: LightingFixFlags): string {
  return injectIrradianceLogMu(injectInscatterClampClouds(src, f.clampInscatter), f.irradianceLogMu);
}
/** 구름 패스 정점 셰이더(조도 보간만 — vCloudsIrradiance·vGroundIrradiance). */
export function applyLightingFixCloudsVertex(src: string, f: LightingFixFlags): string {
  return injectIrradianceLogMu(src, f.irradianceLogMu);
}
/** 대기 효과 조각 셰이더(산란 자르기 + 조도 보간 — 지형 빛 판·연무의 GetSunAndSkyIrradiance). */
export function applyLightingFixAerial(src: string, f: LightingFixFlags): string {
  return injectIrradianceLogMu(injectInscatterClampAerial(src, f.clampInscatter), f.irradianceLogMu);
}
