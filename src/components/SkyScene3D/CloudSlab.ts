/**
 * 구름 — **껍질이 아니라 슬랩**. 전체화면 패스 하나로 그립니다.
 *
 * `docs/SKY_REBUILD_PLAN.md` 가 대체하려는 것이 `CloudDeck.ts`(구면 껍질 +
 * 극좌표 격자)와 `CloudField.ts`(빌보드)입니다. 하늘돔·별·태양·지형·달은
 * 그대로 두고 **구름 표현만** 바꿉니다.
 *
 * ## 왜 이 구조인가
 *
 * 화면 픽셀 → 방향 → 지상거리 → 월드 (x, z). 그게 전부입니다.
 * 덱 기하도 정점 보간도 (방위, 고도) 격자도 없습니다. 그래서:
 *
 *  - **천정 특이점이 없습니다.** 극좌표가 없으므로 극도 없습니다.
 *    지상거리 투영은 천정에서 선형으로 0에 수렴합니다 (d/Δ = 고도).
 *  - **지평선 타일 격자가 없습니다.** 노이즈를 월드 좌표로 읽으므로
 *    반복 주기가 화면 주파수로 올라오지 않습니다.
 *  - **구름에 두께가 있습니다.** 알파가 `1 - exp(-τ)` 에서 나오므로
 *    가장자리는 저절로 얇고, 얇으면 빛이 투과해 빛납니다.
 *
 * ## 문턱을 쓰지 않는 것이 핵심입니다
 *
 * 예전 덱은 셀 값을 문턱으로 **잘라** 알파를 만들었습니다. 그러면 두께가
 * 0 아니면 1이라, 노을에서 사람들이 보는 것 — 가장자리가 핑크로 빛나는
 * 구름, 그늘져 실루엣이 된 구름 — 이 원리적으로 생기지 않습니다.
 * 재보니 주변광이 구름 밝기의 88~99%를 차지했고 출력 채도가 0.04~0.12
 * 였습니다 (계획 4절).
 *
 * 두께로 읽으면 그 셋이 한 번에 나옵니다. 프로토타입에서 같은 조건의
 * 채도가 0.12 → 0.66 이었습니다.
 *
 * ## 운량장은 지상 2D 텍스처입니다
 *
 * 예보를 (방위, 고도) 격자가 아니라 **지상 평면**에 굽습니다. 그러면
 * 운량과 노이즈가 같은 투영을 지나는 같은 종류의 함수가 됩니다.
 *
 * ⚠ 반지름 방향을 **제곱근으로** 굽습니다. 선형이면 ±360km를 128텍셀로
 * 나눠 5.6km/텍셀이 되는데, 정작 위쪽 하늘을 만드는 2~12km 근방이 두어
 * 텍셀밖에 못 받습니다. 제곱근이면 중심 근처가 1km/텍셀, 가장자리가
 * 11km/텍셀 — 예보 모델 격자(2~11km)와 그대로 맞습니다.
 */
import * as THREE from 'three';
import { ATMOSPHERE_GLSL, makeTuningUniforms, type AtmosphereParams } from '../../utils/atmosphere';
import { LAYER_ALTITUDE_KM, type LayerKey } from '../../utils/skyColumn';
import type { LayerWinds } from '../../utils/weather';
import type { RGB } from '../../utils/sunsetPhysics';

/** 운량장이 덮는 반경 (km). 상층 지평선(357km)을 담습니다. */
export const SLAB_RANGE_KM = 360;
/** 운량장 텍스처 한 변. 제곱근 사상이라 중심 근처가 촘촘합니다. */
export const SLAB_TEX = 128;

/** 층별 노이즈 셀 크기 (km) — 저층 적운은 덩어리가 크고, 고층 권운은 섬세한 필라멘트. (층간 거리감 부각을 위해 격차를 늘림) */
const CELL_KM: Record<LayerKey, number> = { low: 1.2, mid: 3.8, high: 12.0 };
/** 층별 두께 → 광학두께 배율. 두꺼운 저층일수록 큽니다. */
const TAU_K: Record<LayerKey, number> = { low: 15.0, mid: 8.0, high: 2.8 };

export const CLOUD_SLAB_GLSL = `
const float SLAB_R_EARTH = 6371.0;

/**
 * 격자 주기. 이 값보다 큰 좌표는 여기로 접어 넣습니다.
 *
 * 왜 접는가: 이 해시는 fract(곱셈)으로 되어 있어 **입력이 커지면 무너집니다.**
 * FP32에서 좌표 5,918(저층이 이류 24시간을 먹었을 때 실제로 도달하는 값)이면
 * 인접 4,096칸이 고유값 58개로 주저앉습니다 — 노이즈가 아니라 큼직한
 * 다각형 얼룩이 됩니다. 접은 뒤에는 어느 좌표에서도 2,600~3,300개를
 * 유지합니다 (좌표 1에서의 건강한 기준이 3,150).
 *
 * 289는 webgl-noise의 mod289 관례를 따릅니다. 네 모서리가 같은 규칙으로
 * 접히므로 보간은 이음매 없이 이어지고, 노이즈가 289셀 주기가 될 뿐입니다.
 * 저층은 1.2km × 289 = 347km 로 지평선 한계(138km)보다 크고, 상층도
 * 12km × 289 = 3,468km 로 357km보다 훨씬 커서 **반복은 보이지 않습니다.**
 */
const float SLAB_LATTICE = 289.0;

float slab_hash21(vec2 p){
  p = mod(p, SLAB_LATTICE);
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float slab_vnoise(vec2 p){
  // 접기가 값을 바꾸지 않습니다(해시가 이미 289주기). floor/fract 가
  // 큰 좌표에서 셀 안 해상도를 잃는 것을 막는 것이 목적입니다.
  p = mod(p, SLAB_LATTICE);
  vec2 i = floor(p), f = fract(p);
  f = f*f*(3.0-2.0*f);
  return mix(mix(slab_hash21(i), slab_hash21(i+vec2(1.0,0.0)), f.x),
             mix(slab_hash21(i+vec2(0.0,1.0)), slab_hash21(i+vec2(1.0,1.0)), f.x), f.y);
}
float slab_fbm(vec2 p, int oct){
  float s = 0.0, a = 0.5, n = 0.0;
  for (int i = 0; i < 6; i++){
    if (i >= oct) break;
    s += a * slab_vnoise(p); n += a;
    // 옥타브마다 접습니다. 안 접으면 5옥타브에서 좌표가 10만을 넘어
    // fract 해상도가 셀당 128단계까지 떨어집니다.
    p = mod(p*2.03 + 7.1, SLAB_LATTICE); a *= 0.5;
  }
  return s / max(1e-5, n);
}

/**
 * 구형 지구(Spherical Earth Shell) 기하학:
 * 관측자(0, RE, 0)에서 고도 h인 구형 대기 껍질(반지름 RE + h)까지의 3D 직선 교점 거리 s 및
 * 지상 호(Arc) 거리 비율 계산.
 *
 * 천정(sinE -> 1.0, cosE -> 0.0)에서는 s -> h, d / cosE -> h 로 완벽 수렴.
 * 지평선(sinE -> 0.0)에서는 s -> sqrt(2*RE*h + h^2) (지평선 한계 거리: 저층 138km, 고층 357km)로
 * 구름이 평면 소실점으로 발산하지 않고 둥근 지구 곡면을 따라 지평선 밑으로 휘어집니다.
 */
struct SlabGeom {
  float sDistKm;   // 3D 직선 교점 거리 (km)
  float distRatio; // 수평 정규화 거리 비율 (km / cosE)
};

SlabGeom slab_sphereIntersect(float sinE, float cosE, float h){
  float chord = 2.0*SLAB_R_EARTH*h + h*h;
  float s = chord / (SLAB_R_EARTH*sinE + sqrt(SLAB_R_EARTH*SLAB_R_EARTH*sinE*sinE + chord));
  float angle = asin(clamp(s * cosE / (SLAB_R_EARTH + h), 0.0, 1.0));
  float safeRatio = (cosE > 1e-4) ? (angle / cosE) : (s / (SLAB_R_EARTH + h));
  
  SlabGeom res;
  res.sDistKm = s;
  res.distRatio = (SLAB_R_EARTH + h) * safeRatio;
  return res;
}

/** 지상 km → 운량장 uv. 반지름을 제곱근으로 굽습니다. */
vec2 slab_coverUv(vec2 km, float rangeKm){
  float d = length(km);
  if (d < 1e-4) return vec2(0.5);
  float r = sqrt(min(d / rangeKm, 1.0));
  return 0.5 + 0.5 * (km / d) * r;
}

/**
 * 고도층별 고유 운형 물리 텍스처:
 * - 저층(L=2, 1.4km): 큼직하고 둥근 적운(Cumulus) 덩어리와 육중한 체적감
 * - 중층(L=1, 4.5km): 리듬감 있는 물결무늬 양떼구름(Altocumulus)
 * - 고층(L=0, 11km): 상층 바람 방향으로 빗겨진 섬세한 비단결 권운(Cirrus Fibers)
 */
/**
 * det 은 이 화소에서 **잔무늬를 얼마나 믿을 수 있는가** 입니다 (1 = 온전히,
 * 0 = 평균만).
 *
 * 지평선으로 갈수록 한 화소가 담당하는 지상 거리가 폭발합니다. 고도각 2°
 * 에서 저층은 화소당 2.2km — 셀(1.2km)의 1.9배이고, 0.5°에서는 7.8배입니다.
 * 거기서 4옥타브 fbm 을 그대로 평가하면 표본이 무늬보다 성글어 **앨리어싱이
 * 방사형 줄무늬**로 나옵니다. 실기기 화면의 "기괴함"의 정체가 이것입니다.
 *
 * 해상 못 하는 무늬는 평균으로 녹입니다. 안티에일리어싱이면서 동시에
 * 옳은 물리이기도 합니다 — 90km 밖 구름의 낱개 봉우리는 실제로도 안 보입니다
 * (계획 8절 - 선명도는 확신도에 비례합니다).
 */
float slab_layer_thickness(int layer, vec2 km, float cover, float cellKm, float conf, float seed, vec2 windNorm, float det){
  vec2 p = km / cellKm + seed;
  float m = 0.0;
  
  if (layer == 0) {
    // 고층 권운: 바람 방향으로 늘어난 비등방성 섬유질 스트릭
    vec2 pWind = vec2(dot(p, windNorm) * 0.28, dot(p, vec2(-windNorm.y, windNorm.x)) * 1.6);
    float fibrous = mix(0.5, slab_fbm(pWind, 5), det);
    m = cover * 1.55 * (0.35 + 0.65 * fibrous) + (fibrous - 0.5) * 0.28 * conf;
  } else if (layer == 1) {
    // 중층 고적운: 부드러운 물결 파동과 중간 규모 셀
    float wave = sin(p.x * 1.8 + p.y * 1.2) * 0.18 * det;
    float form = mix(0.5, slab_fbm(p * 0.75, 4), det);
    m = cover * 1.65 * (0.45 + 0.55 * form + wave) + (form - 0.5) * 0.30 * conf;
  } else {
    // 저층 적운: 볼록하고 묵직한 솜사탕형 빌로우
    float billow = mix(0.5, 1.0 - abs(slab_fbm(p * 0.60, 4) * 2.0 - 1.0), det);
    float detailN = mix(0.5, slab_fbm(p * 1.8, 4), det);
    m = cover * 1.85 * (0.55 * billow + 0.45 * detailN) + (detailN - 0.5) * 0.35 * conf;
  }
  
  // 구름이 완전히 덮인 흐린 날(cover -> 1.0)일 경우 노이즈 틈새(구멍)가 뚫리지 않도록 덩어리로 만들어 줍니다.
  m = mix(m, cover * 1.5, smoothstep(0.9, 1.0, cover));
  
  float baseSub = layer == 0 ? 0.38 : (layer == 1 ? 0.40 : 0.42);
  return max(0.0, m - baseSub);
}
`;

const VERT = `
void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const FRAG = `
precision highp float;
${ATMOSPHERE_GLSL}
${CLOUD_SLAB_GLSL}

uniform vec2  uRes;
uniform mat4  uInvViewProj;
uniform vec3  uCamPos;
uniform vec3  uSunDir;
uniform float uSunAltDeg, uSunAzDeg;
uniform vec3  uMoonDir;
uniform float uMoonAltDeg;
uniform float uMoonIllum;
uniform float uCityLight;
uniform vec3  uBeamLow, uBeamMid, uBeamHigh;
uniform sampler2D uCoverTex;
uniform float uRangeKm;
uniform float uBeta, uAngstrom, uElevScale, uOzoneDU;
uniform vec2  uWindLow, uWindMid, uWindHigh;
uniform float uDriftHours;
uniform float uPixelAngleRad;
uniform float uAerialScale;
uniform float uMultiScatter;
uniform float uSaturation;

void main(){
  // 화면 → 광선. 카메라 기저를 역행렬로 복원합니다.
  vec2 ndc = (gl_FragCoord.xy / uRes) * 2.0 - 1.0;
  vec4 far = uInvViewProj * vec4(ndc, 1.0, 1.0);
  vec3 dir = normalize(far.xyz / far.w - uCamPos);

  float sinE = dir.y;
  if (sinE <= 0.003) discard;          // 지평선 아래는 지형과 지면이 담당
  float cosE = max(sqrt(max(0.0, 1.0 - sinE*sinE)), 1e-4);
  float cosG = clamp(dot(dir, uSunDir), -1.0, 1.0);
  float cosMoon = clamp(dot(dir, uMoonDir), -1.0, 1.0);

  vec2 sunXZ = length(uSunDir.xz) > 1e-4 ? normalize(uSunDir.xz) : vec2(0.0, 1.0);

  // 층 주변광 — 그 층 고도에서 본 하늘
  vec3 ambUp   = atm_skyRadiance(72.0, cosG, uSunAltDeg, uBeta, uAngstrom, uElevScale, uOzoneDU);
  vec3 ambDown = atm_skyRadiance(12.0, cosG, uSunAltDeg, uBeta, uAngstrom, uElevScale, uOzoneDU);
  vec3 ambBase = mix(ambDown, ambUp, 0.35);

  // 지평선 부근 대기 색상 (먼 구름이 지평선과 융합될 때 쓸 안개 빛)
  vec3 horizonHaze = atm_skyRadiance(1.0, cosG, uSunAltDeg, uBeta, uAngstrom, uElevScale, uOzoneDU);

  // 밤 환경 계수 (달빛과 도시 불빛 반사율 상향)
  float nightFactor = clamp((-uSunAltDeg - 2.0) / 10.0, 0.0, 1.0);
  float moonAltFactor = clamp((uMoonAltDeg + 2.0) / 10.0, 0.0, 1.0);
  vec3 moonColor = vec3(0.045, 0.068, 0.098) * uMoonIllum * moonAltFactor * 2.5;
  // 도시 스카이글로. 예전 값 vec3(0.14,0.082,0.032)*2.5 는 두 가지가
  // 틀렸습니다: (1) 세기가 커서 한밤중(태양 -42°) 화면 평균 휘도가 124로
  // 대낮(145)에 육박했고, (2) R:B 가 4.4:1 이라 순금색이었습니다.
  // 실제 도시광은 대기 산란을 거치면서 **채도가 낮은 호박빛 회색**으로
  // 사진에 찍히고, 요즘 가로등은 나트륨등보다 훨씬 하얗습니다.
  vec3 cityGlowColor = vec3(0.028, 0.022, 0.016) * uCityLight * 2.5;

  // 먼 층(고층 11km)부터 가까운 층(저층 1.4km) 순으로 over 합성
  vec3 lin = vec3(0.0);
  float acc = 0.0;

  for (int L = 0; L < 3; L++){
    float hBase  = L == 0 ? ALT_HIGH : (L == 1 ? ALT_MID : ALT_LOW);
    float hThick = L == 0 ? 0.0 : (L == 1 ? 1.0 : 1.6); // 수직 체적 두께 (km)
    int nSteps   = L == 0 ? 1 : (L == 1 ? 2 : 3);       // 체적 샘플링 스텝 수

    vec3  beam   = L == 0 ? uBeamHigh : (L == 1 ? uBeamMid : uBeamLow);
    float cellKm = L == 0 ? CELL_HIGH : (L == 1 ? CELL_MID : CELL_LOW);
    float tauK   = L == 0 ? TAUK_HIGH : (L == 1 ? TAUK_MID : TAUK_LOW);
    float seed   = float(L) * 31.7;
    vec2  wind   = L == 0 ? uWindHigh : (L == 1 ? uWindMid : uWindLow);
    vec2  windNorm = length(wind) > 1e-3 ? normalize(wind) : vec2(1.0, 0.0);

    // ── 수직 체적 스텝 적분 (Volumetric Slices) ──
    for (int S = 0; S < 3; S++){
      if (S >= nSteps) break;
      float sFrac = nSteps > 1 ? float(S) / float(nSteps - 1) : 0.0;
      float h = hBase + sFrac * hThick;

      // 구형 지구 돔 곡률 투영
      SlabGeom geom = slab_sphereIntersect(sinE, cosE, h);
      vec2 km = dir.xz * geom.distRatio;
      vec4 cv = texture2D(uCoverTex, slab_coverUv(km, uRangeKm));
      float cover = L == 0 ? cv.b : (L == 1 ? cv.g : cv.r);
      float conf  = cv.a;

      vec2 kmN = km + wind * uDriftHours;

      // 이 화소가 담당하는 지상 거리(반경 방향). 지평선으로 갈수록 시선이
      // 층을 스치듯 지나 급격히 늘어납니다.
      float footKm = uPixelAngleRad * geom.sDistKm / max(sinE, 0.02);
      // 발자국이 셀 반쯤을 넘어서면 잔무늬를 믿을 수 없습니다.
      float det = 1.0 - smoothstep(0.45, 2.0, footKm / cellKm);

      // 윗면으로 갈수록 돔 형태로 둥글게 모이는 체적 프로파일
      float shape = 1.0 - sFrac * sFrac * 0.45;
      // 이 스텝의 씨앗. 아래 릴리프·자기그림자가 **반드시 같은 값**을 써야
      // 합니다 — 다르면 서로 무관한 두 노이즈를 빼는 셈이라 기울기가
      // 난수가 되고, 그걸 6배 키운 노멀이 입체감을 만들기는커녕 지웁니다.
      float sSeed = seed + float(S) * 0.15;
      float thick = slab_layer_thickness(L, kmN, cover * shape, cellKm, conf, sSeed, windNorm, det);
      if (thick <= 0.0) continue;

      // ── 3D 입체 릴리프 음영 ──
      float eps = cellKm * 0.08;
      float tX = slab_layer_thickness(L, kmN + vec2(eps, 0.0), cover * shape, cellKm, conf, sSeed, windNorm, det);
      float tY = slab_layer_thickness(L, kmN + vec2(0.0, eps), cover * shape, cellKm, conf, sSeed, windNorm, det);
      float dhdx = (tX - thick) / eps;
      float dhdy = (tY - thick) / eps;
      // 노멀 강도를 높여 구름 덩어리의 두께감(Bumpiness)을 강조합니다
      vec3 n = normalize(vec3(-dhdx * 6.0, -dhdy * 6.0, 1.0));

      // 태양광 릴리프 + 빗각 조명
      vec3 sunLightDir = normalize(vec3(sunXZ.x, sunXZ.y, max(sinE, 0.25)));
      float sunRelief = dot(n, sunLightDir);
      vec3 rake = normalize(vec3(-0.50, 0.60, 0.62));
      float ambRelief = dot(n, rake);
      float relief = mix(ambRelief, sunRelief, clamp(uSunAltDeg * 0.1 + 0.5, 0.0, 1.0));

      // 스텝별 분할 광학 두께
      float stepTau = (thick * tauK) / float(nSteps);
      float T = exp(-stepTau);
      float stepAlpha = 1.0 - T;

      // 자기그림자 (Self-shadow)
      float thickSun = slab_layer_thickness(L, kmN + sunXZ * (cellKm * 0.55), cover * shape, cellKm, conf, sSeed, windNorm, det);
      float reach = exp(-thickSun * tauK * 0.55);

      // 체적 수직 조명: 윗면(S->2)은 직달광과 림라이트가 강하고, 밑면(S->0)은 깊은 체적 음영
      float vertLit = 0.65 + 0.55 * sFrac;
      float vertShadow = 0.50 + 0.50 * sFrac;

      float ph = 0.45 + 0.55 * pow(max(cosG, 0.0), 5.0);
      vec3 lit = beam * reach * ph * (0.20 + 1.15 * T) * vertLit;
      
      // 다중 산란(Multiple Scattering) 투과광: 
      // 두꺼운 구름이라도 직달광(reach=0)이 산란을 통해 내부와 밑면을 밝힘
      float totalTau = max(thickSun, thick) * tauK; 
      float msTransmittance = 2.0 / (totalTau * 0.15 + 2.0); // 2-stream 근사
      vec3 ms = beam * msTransmittance * 0.5 * (0.3 + 0.7 * vertShadow);
      // 주의: 이 항은 reach 를 안 봅니다 — 자기그림자에 든 구름에도 같은
      // 양이 들어갑니다. 그림자를 메우고 얇은 가장자리와 두꺼운 속의 차이를
      // 줄이므로, 노을에서 무엇이 사라지는지 잴 수 있게 세기를 뺐습니다.
      lit += ms * uMultiScatter;

      vec3 amb = ambBase * (0.26 + 0.30 * T) * vertShadow;
      vec3 cc = lit + amb;

      // 밤하늘 달빛 직달광 & 산란광
      if (nightFactor > 0.01 && moonAltFactor > 0.01) {
        float moonPh = 0.40 + 0.60 * pow(max(cosMoon, 0.0), 4.0);
        vec3 moonLit = moonColor * reach * moonPh * (0.25 + 0.60 * T) * vertLit;
        cc += moonLit * nightFactor;
      }

      // 밤하늘 지상 도시 불빛 (구름 밑면 S=0에 가장 강하게 집중 투영)
      if (nightFactor > 0.01 && uCityLight > 0.01) {
        float layerHeightAtten = L == 2 ? 1.0 : (L == 1 ? 0.40 : 0.10);
        float bottomWeight = 0.85 - 0.40 * sFrac; // 밑면 집중
        float upwellingScatter = (1.0 - exp(-thick * tauK * 0.80)) * layerHeightAtten * bottomWeight;
        vec3 cityAmb = cityGlowColor * upwellingScatter * (0.45 + 0.55 * max(n.z, 0.1));
        cc += cityAmb * nightFactor * 0.6; // 너무 과하지 않게 줄임
      }

      // 입체 릴리프 음영 부여
      cc *= (0.76 + 0.50 * clamp(relief, -0.6, 1.0));

      // 층별 틴트 & 깊이감
      vec3 tint = L == 0 ? vec3(1.05, 0.98, 1.03) : (L == 1 ? vec3(1.00, 1.00, 1.01) : vec3(0.97, 0.99, 1.00));
      cc *= tint;

      // 대기 원근감 (Aerial Perspective)
      // 대기 원근감. 100km 에서 이미 42%, 357km 에서 85% 를 한 가지 안개색
      // 으로 덮으므로, 노을의 분홍·보라·파랑 **변화**를 지우는 쪽으로도
      // 작용합니다. 세기를 uniform 으로 빼 얼마나 먹는지 잽니다.
      float aerialHaze = 1.0 - exp(-geom.sDistKm * 0.0055);
      cc = mix(cc, horizonHaze, clamp(aerialHaze, 0.0, 0.85) * uAerialScale);

      float l = dot(cc, vec3(0.2126, 0.7152, 0.0722));
      cc = mix(vec3(l), cc, 1.0 + clamp(thick * 0.5, 0.0, 0.7) * 0.35);

      // 체적 누적 합성
      lin = cc * stepAlpha + lin * (1.0 - stepAlpha);
      acc = stepAlpha + acc * (1.0 - stepAlpha);
      if (acc > 0.98) break;
    }
  }

  // 지평선 곡률 융합: 지평선 끝으로 갈수록 구름이 지구 어깨 뒤로 침강하며 대기에 녹아듬
  float horizonFade = smoothstep(0.003, 0.080, sinE);
  acc *= horizonFade;

  if (acc <= 0.002) discard;

  vec3 disp = atm_display(lin / max(acc, 1e-4), uSaturation, uSunAltDeg);
  gl_FragColor = vec4(disp * acc, acc);
}
`;

export interface CloudSlabHandle {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  /** 운량장. 검증 하네스가 내용을 읽습니다. */
  coverTex: THREE.DataTexture;
  /** 운량장이 덮는 반경 (km) */
  rangeKm: number;
  dispose: () => void;
}

export function createCloudSlab(opts: {
  rangeKm?: number;
  texSize?: number;
  /** 층별 노이즈 셀 크기(km) 덮어쓰기. 하네스가 값을 훑을 때 씁니다. */
  cellKm?: Partial<Record<LayerKey, number>>;
  /** 층별 두께→광학두께 배율 덮어쓰기. */
  tauK?: Partial<Record<LayerKey, number>>;
} = {}): CloudSlabHandle {
  const rangeKm = opts.rangeKm ?? SLAB_RANGE_KM;
  const size = opts.texSize ?? SLAB_TEX;
  const cell = { ...CELL_KM, ...(opts.cellKm ?? {}) };
  const tau = { ...TAU_K, ...(opts.tauK ?? {}) };

  const data = new Uint8Array(size * size * 4);
  const coverTex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  coverTex.minFilter = THREE.LinearFilter;
  coverTex.magFilter = THREE.LinearFilter;
  coverTex.wrapS = THREE.ClampToEdgeWrapping;
  coverTex.wrapT = THREE.ClampToEdgeWrapping;
  coverTex.needsUpdate = true;

  const frag = FRAG
    .replace(/ALT_LOW/g, LAYER_ALTITUDE_KM.low.toFixed(2))
    .replace(/ALT_MID/g, LAYER_ALTITUDE_KM.mid.toFixed(2))
    .replace(/ALT_HIGH/g, LAYER_ALTITUDE_KM.high.toFixed(2))
    .replace(/CELL_LOW/g, cell.low.toFixed(2))
    .replace(/CELL_MID/g, cell.mid.toFixed(2))
    .replace(/CELL_HIGH/g, cell.high.toFixed(2))
    .replace(/TAUK_LOW/g, tau.low.toFixed(2))
    .replace(/TAUK_MID/g, tau.mid.toFixed(2))
    .replace(/TAUK_HIGH/g, tau.high.toFixed(2));

  const material = new THREE.ShaderMaterial({
    uniforms: {
      ...makeTuningUniforms(),
      uRes: { value: new THREE.Vector2(1, 1) },
      uInvViewProj: { value: new THREE.Matrix4() },
      uCamPos: { value: new THREE.Vector3() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunAltDeg: { value: 0 },
      uSunAzDeg: { value: 0 },
      uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
      uMoonAltDeg: { value: -90 },
      uMoonIllum: { value: 0 },
      uCityLight: { value: 1.0 },
      uBeamLow: { value: new THREE.Vector3(1, 1, 1) },
      uBeamMid: { value: new THREE.Vector3(1, 1, 1) },
      uBeamHigh: { value: new THREE.Vector3(1, 1, 1) },
      uCoverTex: { value: coverTex },
      uRangeKm: { value: rangeKm },
      uBeta: { value: 0.08 },
      uAngstrom: { value: 1.3 },
      uElevScale: { value: 1 },
      uOzoneDU: { value: 330 },
      uWindLow: { value: new THREE.Vector2() },
      uWindMid: { value: new THREE.Vector2() },
      uWindHigh: { value: new THREE.Vector2() },
      uDriftHours: { value: 0 },
      uPixelAngleRad: { value: 0.001 },
      uAerialScale: { value: 1 },
      uMultiScatter: { value: 1 },
      uSaturation: { value: 1 },
    },
    vertexShader: VERT,
    fragmentShader: frag,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    // 합성기의 구름 버퍼는 **미리곱** 형태를 기대합니다. 색을 이미
    // 알파로 곱해 내보내므로 src 계수가 One 입니다.
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  });

  const geometry = new THREE.PlaneGeometry(2, 2);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.name = 'cloudSlab';

  return {
    mesh,
    material,
    coverTex,
    rangeKm,
    dispose: () => {
      geometry.dispose();
      material.dispose();
      coverTex.dispose();
    },
  };
}

/** 운량장을 굽는 데 필요한 것 — 방위·거리로 층 운량과 확신도를 답하는 함수. */
export interface CoverageSource {
  (azimuthDeg: number, distanceKm: number): {
    low: number; mid: number; high: number; confidence: number;
  };
}

/**
 * 운량장을 다시 굽습니다. **매 프레임 부르면 안 됩니다** — 128×128 이면
 * 16,384 회 조회라 수십 ms 가 듭니다. 기상이나 시각이 바뀔 때만 부르세요.
 */
export function bakeCloudSlabCoverage(handle: CloudSlabHandle, src: CoverageSource): void {
  const size = handle.coverTex.image.width as number;
  const data = handle.coverTex.image.data as Uint8Array;
  const R = handle.rangeKm;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      // uv → 제곱근 사상의 역: r = |p|, d = R·r²
      const px = ((i + 0.5) / size) * 2 - 1;
      const py = ((j + 0.5) / size) * 2 - 1;
      const r = Math.hypot(px, py);
      const k = (j * size + i) * 4;
      if (r > 1) { data[k] = data[k + 1] = data[k + 2] = data[k + 3] = 0; continue; }
      const d = R * r * r;
      const az = r < 1e-6 ? 0 : (Math.atan2(px / r, -py / r) * 180) / Math.PI;
      const c = src((az + 360) % 360, d);
      data[k] = Math.max(0, Math.min(255, c.low * 255));
      data[k + 1] = Math.max(0, Math.min(255, c.mid * 255));
      data[k + 2] = Math.max(0, Math.min(255, c.high * 255));
      data[k + 3] = Math.max(0, Math.min(255, c.confidence * 255));
    }
  }
  handle.coverTex.needsUpdate = true;
}

export interface CloudSlabUpdate {
  camera: THREE.Camera;
  widthPx: number;
  heightPx: number;
  sunDir: THREE.Vector3;
  sunAltDeg: number;
  sunAzDeg: number;
  moonDir?: THREE.Vector3;
  moonAltDeg?: number;
  moonIllum?: number;
  /**
   * 지상 도시 불빛의 세기 (0~1). 구름 밑면을 주황으로 물들입니다.
   *
   * `boolean` 도 받습니다(예전 호출부 호환) — `true` 는 1.0 입니다. 다만
   * 이건 켜짐/꺼짐이 아니라 **그 장소가 얼마나 밝은가**이므로, 앱은
   * 광공해 설정(`starMagLimit`)에서 끌어와 넘깁니다.
   */
  cityLight?: boolean | number;
  /** 층 고도(km)에서 본 직달광. `beamAtAltitude` 를 그대로 넘기세요. */
  beamFor: (altKm: number) => RGB;
  atmosphere: AtmosphereParams;
  /**
   * 층별 바람. `buildSkyColumns` 에 넘긴 것과 **같은 값**이어야 합니다 —
   * 갈라지면 운량장과 잔무늬가 서로 다른 방향으로 흐릅니다.
   */
  layerWinds: LayerWinds;
  /**
   * 이류 기준 경과 시간 (시간). `cloudPlacement` 의 `driftMinutes / 60` 을
   * 그대로 주세요 — 같은 기준을 써야 두 층위가 함께 움직입니다.
   */
  driftHours: number;
  saturation?: number;
  /** 대기 원근감 세기 (기본 1). 노을 색 변화를 얼마나 덮는지 조절합니다. */
  aerialScale?: number;
  /** 다중산란 세기 (기본 1). 그림자를 얼마나 메우는지 조절합니다. */
  multiScatter?: number;
  visible: boolean;
}

/** 매 프레임 부르는 쪽. 카메라와 태양만 갱신하므로 값쌉니다. */
export function updateCloudSlab(handle: CloudSlabHandle, u: CloudSlabUpdate): void {
  handle.mesh.visible = u.visible;
  if (!u.visible) return;
  const uni = handle.material.uniforms;

  (uni.uRes.value as THREE.Vector2).set(u.widthPx, u.heightPx);
  u.camera.updateMatrixWorld();
  // 화면 → 세계. 광선 복원에 씁니다.
  (uni.uInvViewProj.value as THREE.Matrix4)
    .multiplyMatrices(u.camera.projectionMatrix, u.camera.matrixWorldInverse)
    .invert();
  (uni.uCamPos.value as THREE.Vector3).setFromMatrixPosition(u.camera.matrixWorld);

  (uni.uSunDir.value as THREE.Vector3).copy(u.sunDir).normalize();
  uni.uSunAltDeg.value = u.sunAltDeg;
  uni.uSunAzDeg.value = u.sunAzDeg;

  if (u.moonDir) {
    (uni.uMoonDir.value as THREE.Vector3).copy(u.moonDir).normalize();
  }
  if (u.moonAltDeg !== undefined) {
    uni.uMoonAltDeg.value = u.moonAltDeg;
  }
  if (u.moonIllum !== undefined) {
    uni.uMoonIllum.value = u.moonIllum;
  }
  uni.uCityLight.value =
    typeof u.cityLight === 'number' ? Math.max(0, Math.min(1, u.cityLight))
      : u.cityLight === false ? 0.0 : 1.0;

  const bl = u.beamFor(LAYER_ALTITUDE_KM.low);
  const bm = u.beamFor(LAYER_ALTITUDE_KM.mid);
  const bh = u.beamFor(LAYER_ALTITUDE_KM.high);
  (uni.uBeamLow.value as THREE.Vector3).set(bl.r, bl.g, bl.b);
  (uni.uBeamMid.value as THREE.Vector3).set(bm.r, bm.g, bm.b);
  (uni.uBeamHigh.value as THREE.Vector3).set(bh.r, bh.g, bh.b);

  uni.uBeta.value = u.atmosphere.betaMie;
  uni.uAngstrom.value = u.atmosphere.angstrom;
  uni.uElevScale.value = u.atmosphere.elevScale;
  uni.uOzoneDU.value = u.atmosphere.ozoneDU;
  // 방위 → 월드 XZ. 이 장면은 X=동, Z=−북 이므로 북 성분의 부호가 뒤집힙니다.
  // 미는 방향은 **불어오는 쪽**입니다 (skyColumn.ts `driftOf` 주석과 같은 이유).
  const setWind = (v: THREE.Vector2, w: { speedKmh: number; bearingDeg: number }) => {
    const rad = (w.bearingDeg * Math.PI) / 180;
    v.set(w.speedKmh * Math.sin(rad), -w.speedKmh * Math.cos(rad));
  };
  setWind(uni.uWindLow.value as THREE.Vector2, u.layerWinds.low);
  setWind(uni.uWindMid.value as THREE.Vector2, u.layerWinds.mid);
  setWind(uni.uWindHigh.value as THREE.Vector2, u.layerWinds.high);
  uni.uDriftHours.value = u.driftHours;
  // 화소 하나의 각크기. 잔무늬를 어디서부터 평균으로 녹일지 정하는 값입니다.
  // 원근 카메라가 아니면 보수적으로 넓게 잡아 앨리어싱 쪽으로 기울지 않게 합니다.
  const persp = u.camera as THREE.PerspectiveCamera;
  const fovDeg = typeof persp.fov === 'number' ? persp.fov : 60;
  uni.uPixelAngleRad.value = ((fovDeg * Math.PI) / 180) / Math.max(1, u.heightPx);
  uni.uSaturation.value = u.saturation ?? 1;
  uni.uAerialScale.value = u.aerialScale ?? 1;
  uni.uMultiScatter.value = u.multiScatter ?? 1;
}

/**
 * 이미 풀린 하늘 기둥(`LayerSample[]`)에서 운량장 원천을 만듭니다.
 *
 * 앱의 타임라인은 팬을 들고 있지 않고 재구성된 기둥만 넘겨줍니다. 그래서
 * (방위, 거리)로 이중선형 조회하는 원천을 여기서 만듭니다.
 *
 * ⚠ 같은 표본을 쓰는데도 **천정 바람개비가 사라집니다.** 결과를 직교
 * 좌표 텍스처에 굽기 때문입니다 — 중심 텍셀이 하나뿐이라 모든 방위가
 * 자동으로 같은 값을 갖습니다. 극좌표 격자에서는 맨 윗 고리의 방위별
 * 값이 한 점으로 빨려들며 부챗살이 됐습니다 (PR #14의 진단).
 */
export function coverageFromSamples(
  samples: { layer: LayerKey; azimuthDeg: number; distanceKm: number; cover: number; confidence: number }[]
): CoverageSource {
  type Row = { az: number[]; dist: number[]; cover: Float32Array; conf: Float32Array };
  const byLayer: Record<string, Row> = {};

  for (const key of ['low', 'mid', 'high'] as LayerKey[]) {
    const mine = samples.filter(s => s.layer === key);
    if (mine.length === 0) continue;
    const az = Array.from(new Set(mine.map(s => s.azimuthDeg))).sort((a, b) => a - b);
    const dist = Array.from(new Set(mine.map(s => s.distanceKm))).sort((a, b) => a - b);
    const cover = new Float32Array(az.length * dist.length);
    const conf = new Float32Array(az.length * dist.length);
    const ai = new Map(az.map((v, i) => [v, i]));
    const di = new Map(dist.map((v, i) => [v, i]));
    for (const s of mine) {
      const i = ai.get(s.azimuthDeg)!, j = di.get(s.distanceKm)!;
      cover[j * az.length + i] = s.cover;
      conf[j * az.length + i] = s.confidence;
    }
    byLayer[key] = { az, dist, cover, conf };
  }

  const lookup = (row: Row | undefined, azDeg: number, distKm: number) => {
    if (!row) return { c: 0, f: 0 };
    const { az, dist, cover, conf } = row;
    const nA = az.length;
    // 방위는 360°에서 되감깁니다.
    let a0 = 0;
    while (a0 < nA - 1 && az[a0 + 1] <= azDeg) a0++;
    const a1 = (a0 + 1) % nA;
    const spanA = (az[a1] - az[a0] + 360) % 360 || 360 / nA;
    const tA = Math.max(0, Math.min(1, ((azDeg - az[a0] + 360) % 360) / spanA));
    // 거리는 클램프합니다 — 표본 밖은 가장 가까운 고리의 값입니다.
    let d0 = 0;
    while (d0 < dist.length - 2 && dist[d0 + 1] < distKm) d0++;
    const d1 = Math.min(dist.length - 1, d0 + 1);
    const spanD = Math.max(1e-6, dist[d1] - dist[d0]);
    const tD = Math.max(0, Math.min(1, (distKm - dist[d0]) / spanD));
    const at = (arr: Float32Array, ia: number, id: number) => arr[id * nA + ia];
    const mix = (arr: Float32Array) =>
      (at(arr, a0, d0) * (1 - tA) + at(arr, a1, d0) * tA) * (1 - tD) +
      (at(arr, a0, d1) * (1 - tA) + at(arr, a1, d1) * tA) * tD;
    return { c: mix(cover), f: mix(conf) };
  };

  return (azimuthDeg: number, distanceKm: number) => {
    const lo = lookup(byLayer.low, azimuthDeg, distanceKm);
    const mi = lookup(byLayer.mid, azimuthDeg, distanceKm);
    const hi = lookup(byLayer.high, azimuthDeg, distanceKm);
    return {
      low: lo.c, mid: mi.c, high: hi.c,
      confidence: Math.max(lo.f, mi.f, hi.f),
    };
  };
}
