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
import { EARTH_RADIUS_KM_GLSL } from '../../utils/earth';
import { beamGrazing } from '../../utils/grazingRay';
import {
  ATMOSPHERE_GLSL, makeTuningUniforms, moonLight, beamAtAltitude, NIGHT_SKY, SOLAR_BEAM_SCALE, type AtmosphereParams,
} from '../../utils/atmosphere';
import { LAYER_ALTITUDE_KM, type LayerKey } from '../../utils/skyColumn';
import type { LayerWinds } from '../../utils/weather';
import type { RGB } from '../../utils/sunsetPhysics';
import { lowLayerGenus } from '../../utils/cloudPresets';
import { LAYER_BAND_KM } from '../../utils/cloudProfile';
// ⚠ 지평선은 **지면과 같은 함수**로 구합니다. 식을 복사해 두면 한쪽만
// 바뀌었을 때 그 차이가 그대로 하늘이 비치는 띠가 됩니다.
import { seaHorizonDipDeg } from './TerrainRing';
import { FIELD_RINGS, FIELD_SPOKES, FAR_FIELD_RINGS, FAR_FIELD_FAR_M } from './TerrainField';
import { FIELD_FOOT_M, FIELD_HINGE_M, FIELD_INNER_RINGS } from './groundProjection';
import { DEM_GLSL, demGlsl, makeDemUniforms, type DemPatch } from '../../utils/demTiles';

/** 운량장이 덮는 반경 (km). 상층 지평선(357km)을 담습니다. */
export const SLAB_RANGE_KM = 360;
/** §105 직달 표: 해 고도 ±BEAM_LUT_SPAN° 를 BEAM_LUT_N 칸에. 360km 끝에서 ±3.2° 이므로 넉넉히 4°. */
const BEAM_LUT_N = 64;
/**
 * 직달 투과율 → 이 셰이더의 직달 항(§104·§106). 하늘빛이 **복사휘도**(조도/π)로 들어오므로
 * 직달도 조도/π 로 맞춥니다: SOLAR_BEAM_SCALE(투과율 → 하늘 눈금의 조도) ÷ π.
 * ⚠ 처음(§104)엔 π 를 빠뜨려 직달이 π 배 셌습니다 — 노을에 해 받은 구름이 레몬색으로 포화했습니다
 *   (사진 대조 원색 화소 13% 대 사진 0.9%). 지면(TerrainRing)은 처음부터 sin/π 로 맞춰 왔습니다.
 */
const BEAM_TO_SLAB = SOLAR_BEAM_SCALE / Math.PI;
const BEAM_LUT_SPAN = 4;
/** 운량장 텍스처 한 변. 제곱근 사상이라 중심 근처가 촘촘합니다. */
export const SLAB_TEX = 128;

/** 층별 노이즈 셀 크기 (km) — 저층 적운은 덩어리가 크고, 고층 권운은 섬세한 필라멘트. (층간 거리감 부각을 위해 격차를 늘림) */
const CELL_KM: Record<LayerKey, number> = { low: 2.0, mid: 4.2, high: 9.0 };
/** 층별 두께 → 광학두께 배율. 두꺼운 저층일수록 큽니다. */
const TAU_K: Record<LayerKey, number> = { low: 15.0, mid: 8.0, high: 2.8 };

/**
 * 모양장의 **실제** 중심과 폭 — 층마다 다릅니다.
 *
 * 41절의 백분위 문턱은 모양장이 `N(0.5, uShapeSigma)` 라고 **가정**하고
 * `P(q > 1-cover) = cover` 를 항등식으로 만듭니다. 그런데 그 가정이 세
 * 층에 다 맞지는 않습니다. `build-layer-elev.js` 로 예보 운량 → 화면 면적
 * 사상을 재고(광학두께 자료 출구를 써서 조명과 무관하게) 로지스틱-정규
 * 모형으로 역산하면:
 *
 *   층    유효 중심   유효 폭    가정
 *   저층    0.597     0.105     0.5 · 0.16
 *   중층    0.377     0.104     0.5 · 0.16
 *   상층    0.515     0.158     0.5 · 0.16
 *
 * ⚠ 두 번 돌려 수렴시킨 값입니다. 한 번 넣고 다시 재면 사상이 달라지므로
 * (문턱이 바뀌면 표본도 바뀝니다) 그 새 곡선으로 다시 역산했습니다.
 *
 * 그래서 사상이 이렇게 어긋났습니다 (고도 45°, 왼쪽이 예보):
 *
 *   예보    10%    25%    50%    75%    90%
 *   저층   0.140  0.500  0.818  0.942  0.991   ← 과하게 덮음
 *   중층   0.001  0.010  0.125  0.340  0.561   ← 턱없이 모자람
 *   상층   0.095  0.336  0.600  0.759  0.907   ← 대체로 맞음
 *
 * 실기 보고 "하늘이 구름으로 가득 찼는데 너무 텅빈 구름만 있어" 의 정체가
 * 중층 줄입니다 — 그날 아침은 양떼구름(중층) 하늘이었고 예보는 33% 였는데,
 * 위 사상이면 화면에는 3~5% 밖에 안 나옵니다. 같은 보고에서 "고층부 구름은
 * 괜찮아 보인다" 고 한 것도 상층 줄과 맞습니다.
 *
 * ⚠ 이 값들은 모양장의 **참 모멘트가 아니라 유효값**입니다 — 군집(cluster)
 * 처럼 운량을 흔드는 항과 문턱 뒤의 두께 곡선까지 다 이 두 수에 묻혀
 * 들어갑니다. 그래도 고치려는 것이 바로 "예보가 화면 면적이 되는가" 이므로
 * 유효값이 맞는 눈금입니다. 값을 바꾸면 `verify-layer-elev.js` 가 웁니다.
 */
const SHAPE_MEAN: Record<LayerKey, number> = { low: 0.597, mid: 0.377, high: 0.515 };
/** 위 폭 ÷ uShapeSigma 기본값(0.16). uShapeSigma 를 바꿔도 비율은 유지됩니다. */
const SHAPE_SIG_RATIO: Record<LayerKey, number> = { low: 0.654, mid: 0.652, high: 0.986 };

export const CLOUD_SLAB_GLSL = `
const float SLAB_R_EARTH = ${EARTH_RADIUS_KM_GLSL};

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
uniform float SLAB_FBM_GAIN;
uniform float SLAB_RELIEF_EPS;
uniform float uShapeMode, uShapeDepth, uShapeEdge, uShapeSigma;
/**
 * 층 높이(km). x=저 y=중 z=상.
 *
 * ⚠ 예전에는 ALT_LOW/MID/HIGH 를 **셰이더 소스에 박아** 컴파일했습니다. 그러면
 *   예보가 갱신될 때마다 셰이더를 다시 만들어야 해서, 높이를 예보에 맞추는
 *   길 자체가 막혀 있었습니다. uniform 으로 빼 두면 매 갱신에 그냥 넣습니다.
 */
uniform vec3 uLayerAltKm;
uniform float uFbmRot;
float slab_fbm(vec2 p, int oct){
  float s = 0.0, a = 0.5, n = 0.0;
  for (int i = 0; i < 6; i++){
    if (i >= oct) break;
    s += a * slab_vnoise(p); n += a;
    // 옥타브마다 접습니다. 안 접으면 5옥타브에서 좌표가 10만을 넘어
    // fract 해상도가 셀당 128단계까지 떨어집니다.
    p = p * 2.03 + 7.1;
    // ── 옥타브마다 **돌립니다** (계획 41절) ──────────────────────────
    //
    // slab_vnoise 는 정수 격자 위의 값잡음이라 등고선이 원래 마름모·사각
    // 으로 눕습니다. 그런데 옥타브 전이가 확대·평행이동뿐이라 다섯 겹이
    // 전부 **같은 축**을 씁니다 — 축 정렬이 상쇄되기는커녕 겹쳐 쌓입니다.
    // 두께장은 문턱으로 잘리므로 그 각진 등고선이 곧 구름 실루엣입니다.
    // (측정: 구름 경계 기울기 방향 축정렬도가 지평선 시선에서 6.1)
    //
    // 0.5 rad(28.6도)는 2파이의 무리수 배에 가까워 옥타브가 겹쳐도 주기가
    // 생기지 않습니다. 회전을 접기 **앞**에 두어야 이음매가 유지됩니다 —
    // 해시가 289 주기라 vnoise(mod(Rp)) == vnoise(Rp) 이기 때문입니다.
    if (uFbmRot > 0.5) p = vec2(p.x * 0.87758 - p.y * 0.47943,
                                p.x * 0.47943 + p.y * 0.87758);
    p = mod(p, SLAB_LATTICE); a *= SLAB_FBM_GAIN;
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
  bool  hit;       // 시선이 껍질에 닿는가 — 관측자가 층 위면 못 닿는 각이 있음
};

/**
 * 관측자 해발 고도(km). ⚠ 예전 교차 식은 관측자를 **해발 0** 에 박아 두어
 * (chord = 2Rh + h²), 1,600m 에 서서 1,200m 구름 위에 있어도 그 구름을 머리
 * 위에 그렸습니다. src/utils/cloudDeck.ts 가 같은 식의 TS 판이고 판정이
 * 붙어 있습니다(verify-cloud-deck.js).
 */
uniform float uObserverAltKm;

/**
 * 저층 덱의 (밑면, 윗면) km, 해발 — 단면의 반값 폭(cloudProfile.lowDeck, §82).
 * 모르면 (-1, -1) 이고 그때는 §81 그대로입니다(위에서 볼 면 = hBase).
 *
 * ⚠ **위에서 볼 때만** 씁니다. 아래에서 보는 하늘(두께 1.6km 판)은 이 값과
 *   무관하게 예전 그대로입니다 — 온 하늘 대비 조정이 그 판에 맞춰져 있습니다.
 */
uniform vec2 uLowDeckKm;

/** 저층이 **위에서 보이는 면**. 덱을 모르면 hBase. 윗면이 hBase 아래로 나오면 hBase. */
float slab_lowSurfKm(){
  return uLowDeckKm.y > 0.0 ? max(uLowDeckKm.y, uLayerAltKm.x) : uLayerAltKm.x;
}

SlabGeom slab_sphereIntersect(float sinE, float cosE, float h){
  float A = SLAB_R_EARTH + h;
  float B = SLAB_R_EARTH + uObserverAltKm;
  // A² − B² 를 뺄셈 없이 — 관측자가 해발 0 이면 예전 2Rh + h² 와 **같은 값**
  float chord = (h - uObserverAltKm) * (A + B);
  float disc = B*B*sinE*sinE + chord;          // = A² − B²cos²E
  float root = sqrt(max(disc, 0.0));

  SlabGeom res;
  res.hit = true;
  float s;
  if (chord >= 0.0) {
    // 관측자가 층 아래 — 예전 식 그대로(양근 하나). 관측자 0 이면 같은 결과.
    s = chord / (B*sinE + root);
  } else {
    // 관측자가 층 위 — 두 근이 다 양수이고 **가까운 쪽**이 보이는 윗면.
    // 먼 근을 먼저 구하고 근과 곱으로 냅니다(단정밀도에서 더 견고합니다).
    float tFar = -B*sinE + root;
    res.hit = disc >= 0.0 && tFar > 0.0;       // 먼 가장자리 위로는 안 닿음
    s = -chord / max(tFar, 1e-6);
  }
  float angle = asin(clamp(s * cosE / A, 0.0, 1.0));
  float safeRatio = (cosE > 1e-4) ? (angle / cosE) : (s / A);

  res.sDistKm = s;
  res.distRatio = A * safeRatio;
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
 *
 * ⚠ **그런데 상수로 녹이면 안 됩니다.** det 이 0 이 되는 곳은 고도 2° 아래고,
 * 거기서 모양장이 통째로 0.5 가 되면 백분위 문턱이 균일한 운량을 뱉어
 * **매끈한 띠 한 장**이 됩니다. 사용자가 "구름이 2.8° 위에서 끊기고 그
 * 아래는 밝고 매끈한 띠"라고 한 것이 이것입니다.
 *
 * 낱개 봉우리가 안 보이는 것이지 **구름이 균일해지는 것이 아닙니다.** 90km
 * 밖에도 구름 거리·큰 틈 같은 10~50km 규모 조직은 그대로 보입니다. 발자국이
 * 죽이는 것은 잔 옥타브뿐이므로, 상수가 아니라 **아직 해상되는 굵은 옥타브**로
 * 물러납니다. detCoarse 가 그 두 번째 단계입니다 — 발자국이 셀의 3배를 넘으면
 * 굵은 장도 놓기 시작해 9배에서 비로소 상수가 됩니다(고도 0.4° 아래).
 */
float slab_layer_thickness(int layer, vec2 km, float cover, float cellKm, float conf, float seed, vec2 windNorm, float det, float detCoarse, float billowAmt, float cluster){
  vec2 p = km / cellKm + seed;
  float m = 0.0;
  // 모양장 f: 0~1, **운량과 무관한** 구름의 생김새 (41절의 문턱형에서 씀).
  float f = 0.5;
  // 느린 항(군집·물결)은 국소 **운량**을 밀지, 모양장을 밀지 않습니다.
  float cvSlow = 1.0;
  // 두께 배수 — 실루엣이 아니라 단면을 만드는 항이 여기로 옵니다.
  float depthMul = 1.0;
  
  if (layer == 0) {
    // 고층 권운: 바람 방향으로 늘어난 비등방성 섬유질 스트릭
    //
    // ⚠ **종횡비 4:1.** 예전에는 0.28 · 1.6, 곧 5.71:1 이었습니다. 그 값은
    //   한 번도 훑어본 적이 없었고(옛 CloudDeck 은 같은 성질을 훑어 4 를
    //   골랐습니다 — cloudPresets.ts 의 cellAspect), 실기에서 "낮은 층과
    //   높은 층 구름 방향 차가 현실보다 과하다"고 한 것의 대부분이 여기서
    //   왔습니다: 재 보면 층 사이 격차는 방향이 아니라 **결집도**이고
    //   (상층 0.745 대 저층 0.287, 2.60배), 상층만 뚜렷한 줄무늬라 두 층이
    //   서로 무관한 그림으로 읽힙니다.
    //
    //   두 배율을 아무렇게나 만지면 종횡비와 **특징 크기가 같이** 움직여
    //   무엇이 그림을 바꿨는지 못 가립니다. 기하평균 √(0.28·1.6) = 0.6693 을
    //   고정하고 비만 바꿨습니다 — 0.3347 · 1.3387 이 정확히 4:1 이고
    //   기하평균은 그대로입니다.
    vec2 pWind = vec2(dot(p, windNorm) * 0.3347, dot(p, vec2(-windNorm.y, windNorm.x)) * 1.3387);
    // 굵은 폴백: 잔 옥타브가 죽어도 상층 흐름 규모의 띠는 남습니다.
    float fibCoarse = mix(0.5, slab_fbm(pWind * 0.16, 2), detCoarse);
    float fibrous = mix(fibCoarse, slab_fbm(pWind, 5), det);
    m = cover * 1.55 * (0.35 + 0.65 * fibrous) + (fibrous - 0.5) * 0.28 * conf;
    f = fibrous;
  } else if (layer == 1) {
    // 중층 고적운: 부드러운 물결 파동과 중간 규모 셀
    //
    // ⚠ **물결은 바람 축에서 셉니다.** 예전에는 sin(p.x*1.8 + p.y*1.2) 로
    //   월드 XZ 에서 바로 셌습니다. 그러면 물결이 바람이 어디로 불든 **늘
    //   같은 나침반 방향**(약 33.7°)으로 눕습니다. 상층 권운은 바람 축으로
    //   회전하는데 중층만 고정이니, 바람이 돌 때마다 두 층이 어긋나는 각이
    //   제멋대로가 됩니다 — 실기에서 "저층과 상층 방향 차가 현실보다 과하다"
    //   고 한 것이 이것입니다.
    //
    //   측정(build-layer-grain, 바람 0/45/90°): 상층 주방향 48.7°→130.8°
    //   →172.5° 로 도는 동안 중층은 23.6° 에 붙박여 있었습니다.
    //
    //   파수 벡터가 바람 쪽으로 기울어 있으므로(1.8 대 1.2) 마루는 바람을
    //   가로지릅니다 — 고적운 두루마리가 실제로 그렇습니다. 파장과 생김새는
    //   그대로 두고 **기준 축만** 바람으로 옮깁니다.
    vec2 pw = vec2(dot(p, windNorm), dot(p, vec2(-windNorm.y, windNorm.x)));
    float wave = sin(pw.x * 1.8 + pw.y * 1.2) * 0.18 * det;
    float formCoarse = mix(0.5, slab_fbm(p * 0.13, 2), detCoarse);
    float form = mix(formCoarse, slab_fbm(p * 0.75, 4), det);
    m = cover * 1.65 * (0.45 + 0.55 * form + wave) + (form - 0.5) * 0.30 * conf;
    f = form;
    // 물결은 **느린** 항이라 백분위 입력에 넣으면 안 됩니다 — 한 화면 안에서
    // 거의 상수라 국소 평균을 통째로 밀어 버립니다. 양떼구름의 줄무늬는
    // 원래 "여기 더 많고 저기 덜 많다"는 이야기이므로 운량 쪽으로 보냅니다.
    cvSlow *= 1.0 + wave * 1.6;
  } else {
    // 저층 적운: 볼록하고 묵직한 솜사탕형 빌로우
    float billow = mix(0.5, 1.0 - abs(slab_fbm(p * 0.60, 4) * 2.0 - 1.0), det);
    // 굵은 폴백은 **실루엣을 정하는 detailN 에만** 겁니다. billow 는 두께
    // 단면(depthMul)으로 가는 항이라 멀리서 안 보여도 됩니다.
    float nCoarse = mix(0.5, slab_fbm(p * 0.15, 2), detCoarse);
    float detailN = mix(nCoarse, slab_fbm(p * 1.8, 4), det);
    m = cover * 1.85 * (0.55 * billow + 0.45 * detailN) + (detailN - 0.5) * 0.35 * conf;
    // billow 는 fbm 을 접은 것(1-|2f-1|)이라 **치우친** 분포입니다 —
    // 평균이 0.5 가 아니라 0.8 쯤입니다. 백분위 입력에 섞었더니 모양장
    // 평균이 0.39 로 내려가 저층이 통째로 사라졌습니다(운량 25% → 면적
    // 0.03). 실루엣은 대칭 잡음에 맡기고, 뭉게구름의 볼록한 덩어리감은
    // **두께 단면**으로 옮깁니다 — 원래 거기가 제자리입니다.
    f = detailN;
    depthMul = 0.70 + 0.60 * billow;
  }
  
  // 구름이 완전히 덮인 흐린 날(cover -> 1.0)일 경우 노이즈 틈새(구멍)가 뚫리지 않도록 덩어리로 만들어 줍니다.
  m = mix(m, cover * 1.5, smoothstep(0.9, 1.0, cover));

  // ── 군집 (계획 37절) ────────────────────────────────────────────────
  //
  // ⚠ **문턱(baseSub)을 넘기 전에** 곱해야 합니다. 두께에 곱했더니 아무
  // 일도 안 일어났습니다 — 이 광학두께에서는 알파가 이미 포화라 두께를
  // ±45% 흔들어도 불투명한 채 그대로입니다. 실루엣을 정하는 것은
  // m 이 baseSub 를 넘느냐이므로, 거기를 흔들어야 군집과 틈이 생깁니다.
  //
  // 흐린 날에는 끕니다 — 운량 90% 하늘은 군집이 아니라 한 장의 판이고,
  // 여기서 구멍을 뚫으면 위의 밀폐 처리를 되돌리는 셈입니다.
  m *= mix(1.0, cluster, 1.0 - smoothstep(0.75, 0.95, cover));
  
  // 구름 자체의 잔결(빌로우). 셀의 12분의 1 규모라, 천정처럼 지상 좌표가
  // 한 점으로 모이는 곳에서도 구조가 남습니다. 평균이 1인 곱셈이라
  // 예보 운량을 밀지 않습니다. 발자국이 감당 못 하면(지평선) 꺼집니다.
  float billowFine = mix(0.5, slab_fbm(p * 12.0 + 13.7, 3), billowAmt);
  m *= 0.82 + 0.36 * billowFine;

  float baseSub = layer == 0 ? 0.38 : (layer == 1 ? 0.40 : 0.42);
  if (uShapeMode <= 0.5) return max(0.0, m - baseSub);

  // ── 41절 · 백분위 문턱 — 면적은 운량이, 두께는 물리가 정한다 ────────
  //
  // 예전 식은 m 이 통째로 cover 에 비례합니다. 그래서 운량이 낮으면
  // **면적과 두께가 같이** 줄어듭니다. 측정하면 이렇게 나옵니다:
  //
  //   예보 10% → 화면 면적 0.00 · 25% → 0.06 · 50% → 0.83 · 75% → 0.99
  //
  // 계단입니다. 예보 25% 인 맑은 날이 화면에서 6% 로 사라지고, 50% 는
  // 83% 를 덮습니다. 게다가 넘어선 화소도 두께가 0.2 를 못 넘어(광학두께 3)
  // 구름 화소의 **1.6~8.4% 만 불투명**했습니다 — 온 하늘이 옅은 베일.
  //
  // 원인은 잡음의 폭이 좁다는 것입니다. 저층 모양장은 평균 0.72 · 표준편차
  // 0.10 근처에 몰려 있어, 문턱을 선형으로 움직이면 좁은 구간에서 화면이
  // 통째로 뒤집힙니다. 그래서 **백분위**로 바꿉니다 — 정규 CDF 를 로지스틱
  // 으로 근사하면 q 가 0~1 로 고르므로 P(q > 1-cover) = cover 가 항등식이
  // 됩니다. 문턱이 곧 면적입니다.
  //
  // 두께는 그 다음에 **따로** 정합니다. 구름의 깊이는 운량이 아니라 대류가
  // 정하니까요. 가장자리 0 에서 중심 1 로 가는 t 를 돔 단면으로 폅니다.
  // 모양장은 이제 **빠른 잡음만**이라 평균 0.5 근처에 대칭입니다.
  // 폭은 옥타브 수에 따라 층마다 조금 다릅니다 — 그 '조금' 이 실제로는 큽니다.
  // ⚠ 예전에는 fSig = uShapeSigma 하나에 중심 0.5 를 세 층에 똑같이
  //   썼습니다. 재 보면 층마다 다릅니다(위 SHAPE_MEAN 주석의 표) — 그래서
  //   예보 50% 가 저층에서는 화면 82%, 중층에서는 12.5% 가 됐습니다.
  //   측정한 층별 값을 넣어 "문턱이 곧 면적" 을 되돌립니다.
  float fMid = layer == 0 ? SHAPE_MEAN_HIGH : (layer == 1 ? SHAPE_MEAN_MID : SHAPE_MEAN_LOW);
  float fSig = uShapeSigma * (layer == 0 ? SHAPE_SIGR_HIGH
                            : (layer == 1 ? SHAPE_SIGR_MID : SHAPE_SIGR_LOW));
  // 잔결은 빠른 항이라 그대로 모양장에 섞습니다(평균 0 이 되게 뺍니다).
  float fm = f + (billowFine - 0.5) * 0.22 * billowAmt;
  float q = 1.0 / (1.0 + exp(-1.702 * (fm - fMid) / max(0.02, fSig)));
  // 군집은 **면적**을 흔듭니다 — 여기 더 많고 저기 덜 많다는 이야기이므로.
  float cvEff = clamp(cover * cvSlow * cluster, 0.0, 1.0);
  float t = clamp((q - (1.0 - cvEff)) / max(0.05, cvEff), 0.0, 1.0);
  // 가장자리 단면.
  //
  // pow(t, 0.85) 만 쓰면 문턱 바로 위 얇은 띠까지 광학두께 2 를 넘어 통째로
  // 불투명해집니다 — 실루엣이 칼같이 서고, verify-photo-match 가 국소대비를
  // 사진의 **2.0~2.4배**로 잡았습니다. smoothstep 은 t=0 에서 기울기가 0 이라
  // 바깥쪽 몇 화소가 실제로 반투명하게 남습니다.
  float prof = smoothstep(0.0, 1.0, t);
  float d = uShapeDepth * depthMul * pow(prof, uShapeEdge);
  // 흐린 날은 한 장의 판입니다 — 빈틈이 남지 않게 밀폐합니다.
  d = mix(d, uShapeDepth * depthMul, smoothstep(0.90, 1.0, cover));
  return clamp(d, 0.0, 1.8);
}

// ── 근거리 볼륨 (계획 27·33절) ────────────────────────────────────────────
//
// 저층만 담당합니다. 위 슬랩은 껍질 하나를 얇게 갈라 체적을 흉내 내는데,
// 저층 뭉게구름은 고도각 6°만 넘으면 깊이비가 1.2를 넘어 껍질로는 원근이
// 안 생깁니다(계획 27절). 그래서 근거리(수평 uNfCapKm 안)만은 3D 값잡음
// 밀도장을 시선따라 직접 적분하고, 표본마다 한 번 더 걸어 자기그림자를
// 만듭니다. 그 밖은 위 슬랩이 그대로 맡습니다 — 하나가 이깁니다, 섞지
// 않습니다 (33.6절: 이음매는 아직 없어 22km 경계에서 구름 밑면 높이가
// 뚝 바뀝니다).
//
// 노이즈를 따로 두는 이유: 위 slab_* 는 **2D**(지상 좌표 하나)이고 이건
// **3D**(높이까지)라 격자 접기 상수만 같고 나머지 수식이 다릅니다. 같은
// 이름을 쓰면 오버로드가 아니라 재정의라 GLSL이 컴파일을 거부합니다.
float nf_hash31(vec3 p){
  p = mod(p, SLAB_LATTICE);
  return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
}
float nf_vnoise3(vec3 p){
  vec3 i = floor(p), f = fract(p);
  f = f*f*(3.0-2.0*f);
  float n000=nf_hash31(i), n100=nf_hash31(i+vec3(1.0,0.0,0.0));
  float n010=nf_hash31(i+vec3(0.0,1.0,0.0)), n110=nf_hash31(i+vec3(1.0,1.0,0.0));
  float n001=nf_hash31(i+vec3(0.0,0.0,1.0)), n101=nf_hash31(i+vec3(1.0,0.0,1.0));
  float n011=nf_hash31(i+vec3(0.0,1.0,1.0)), n111=nf_hash31(i+vec3(1.0,1.0,1.0));
  float x00=mix(n000,n100,f.x), x10=mix(n010,n110,f.x);
  float x01=mix(n001,n101,f.x), x11=mix(n011,n111,f.x);
  return mix(mix(x00,x10,f.y), mix(x01,x11,f.y), f.z);
}
float nf_fbm3(vec3 p){
  float s=0.0, a=0.5, n=0.0;
  for (int i=0;i<5;i++){ s += a*nf_vnoise3(p); n += a; p = mod(p*2.03+7.1, SLAB_LATTICE); a *= 0.5; }
  return s/max(1e-5,n);
}

/**
 * genus 는 텍스처에서 이중선형으로 흘러나오는 **연속값**(0..1)입니다.
 * 그래서 아래 상수들도 하드 분기(genus<0.5?:) 대신 전부 mix로
 * 섞습니다 — 안 그러면 두 운형의 fbm 좌표(scale)가 경계에서 뚝 끊겨
 * 뭉게/먹구름 사이에 눈에 띄는 선이 생깁니다.
 *
 * 상수는 tools/shader-preview/build-nearfield-volume.js 에서 재서 고른
 * 값과 같습니다(계획 33절) — genus=0/1 양끝에서 거기서 잰 결과가
 * 그대로 나오게 하려는 것입니다.
 */
float nf_baseKm(float genus){ return uLayerAltKm.x - mix(0.4, 0.8, genus); }
float nf_thickKm(float genus){ return mix(2.6, 1.6, genus); }

float nf_density(vec3 p, float genus, float cover){
  float b = nf_baseKm(genus), t = nf_thickKm(genus);
  float h = (p.y - b) / t;
  if (h < 0.0 || h > 1.0) return 0.0;

  float prof = smoothstep(0.0, mix(0.08, 0.03, genus), h)
             * (1.0 - smoothstep(mix(0.40, 0.80, genus), 1.0, h));

  float scale = mix(0.55, 0.30, genus);
  float n = nf_fbm3(p * scale);

  float thrAuto = mix(0.574 - 0.281 * cover, 0.433 - 0.211 * cover, genus);
  float d = max(0.0, (n - thrAuto) / max(0.08, 1.0 - thrAuto));

  float fine = nf_fbm3(p * (scale * 5.0) + 31.7);
  d -= mix(0.55, 0.25, genus) * (1.0 - smoothstep(0.0, 0.45, d)) * (1.0 - fine);
  d = max(0.0, d);
  d = pow(d, mix(0.75, 1.0, genus));

  return d * prof;
}
`;

// ⚠ 깊이는 **먼 쪽**(≈1)에 둡니다(§96). 한 번에 그리는 경로(배율 1)에서 지형은 불투명 큐라
//   renderOrder 와 상관없이 구름보다 먼저 그려집니다. 하늘 구름 판이 깊이 검사를 켜고 가장
//   먼 깊이에 서 있으면, 지형이 그려진 화소에서 저절로 빠집니다(산이 구름 앞). 운해 판
//   (meshBelow)은 깊이 검사를 끄고 지형 위에 얹습니다.
const VERT = `
void main(){ gl_Position = vec4(position.xy, 0.99999, 1.0); }
`;

/**
 * 지형 높이 — 구름 셰이더와 **지평선 굽기**(§84)가 같이 씁니다. 둘이 다른
 * 높이를 보면 굽힌 지평선이 구름 셰이더의 걸음질보다 낮게 나와, 건너뛰면 안
 * 되는 화소를 건너뜁니다.
 */
const SLAB_TERRAIN_GLSL = `
${DEM_GLSL}
${demGlsl('demFar')}
uniform float uEyeHeightM;       // 발밑에서 눈까지 (m) — TerrainField 와 같은 값

/** (동, 남) m 지점의 지형 고도 (m). 모르면 -1e4. */
float slab_terrainM(vec2 g){
  bool fine = uDemValid > 0.5 && dem_inside(g) > 0.5;
  bool far  = uDemFarValid > 0.5 && demFar_inside(g) > 0.5;
  if (fine) {
    // TerrainField.fieldElev 와 같은 넘기기(촘촘 → 성김). 반지름 비율 0.30 도 같습니다.
    if (!far) return dem_elevationAt(g);
    float rp = dem_probeRadiusM();
    float w = 1.0 - smoothstep(rp * 0.30, rp * 0.98, length(g));
    return mix(demFar_elevationDespiked(g), dem_elevationAt(g), w);
  }
  if (far) return demFar_elevationDespiked(g);
  return -1e4;
}

`;

/**
 * **지형 지평선 굽기** (§84) — 방위마다 땅이 올라오는 가장 높은 고도각.
 *
 * 올려다보는 하늘의 가림(tBlockSky)은 화소마다 DEM 을 80걸음 걷습니다. 하늘
 * 전부를 걸으면 슬랩 한 장이 32% 무거워졌습니다(측정). 그런데 걸어서 막힐 수
 * 있는 화소는 **땅의 지평선 아래**뿐입니다. 그래서 패치를 받을 때 한 번,
 * 방위 512칸마다 지평선을 굽고, 그 위의 화소는 걷지 않습니다.
 *
 * 한 줄짜리 렌더 타깃에 굽습니다(RGBA8 — 모바일에 부동소수 타깃이 없을 수
 * 있음). 고도각 −20°~70° 를 16비트로 R·G 에 싣습니다.
 */
export const HORIZON_BINS = 512;
// ⚠ GLSL 에 **문자열로** 넣습니다. 숫자로 넣으면 JS 가 -20.0 을 "-20" 으로 찍어
//   float − int 가 되고 셰이더가 통째로 컴파일되지 않습니다(한 번 그랬습니다).
const HORIZON_LO_DEG = '-20.0', HORIZON_SPAN_DEG = '90.0';
const HORIZON_BAKE_FRAG = `
precision highp float;
const float SLAB_R_EARTH = ${EARTH_RADIUS_KM_GLSL};
${SLAB_TERRAIN_GLSL}
const float HB = ${HORIZON_BINS}.0;
// 앱 TerrainField 격자(SkyScene3D: rings = FIELD_RINGS + FAR_FIELD_RINGS, farM = FAR_FIELD_FAR_M,
// 살 FIELD_SPOKES)와 groundProjection.ringDistanceM 의 두 구간 로그 간격.
const float MESH_SPOKES = ${FIELD_SPOKES}.0;
const int   MESH_RINGS_I = ${FIELD_RINGS + FAR_FIELD_RINGS};
const float MESH_RINGS = ${FIELD_RINGS + FAR_FIELD_RINGS}.0;
const float MESH_INNER = ${FIELD_INNER_RINGS}.0;
const float MESH_FOOT = ${FIELD_FOOT_M};
const float MESH_HINGE = ${FIELD_HINGE_M}.0;
const float MESH_FAR = ${FAR_FIELD_FAR_M}.0;
void main(){
  float az = (floor(gl_FragCoord.x) + 0.5) / HB * 6.2831853;
  vec2 hz = vec2(sin(az), -cos(az));          // (동, 남) — 북이 −z
  float eyeM = slab_terrainM(vec2(0.0)) + uEyeHeightM;
  float best = -1.5;                          // 라디안, 아주 낮게 시작
  // 0.5m ~ 70km 로그 간격 512걸음 — 간격이 거리의 2.4% 라 줌 9 화소보다 촘촘합니다.
  for (int i = 0; i < 512; i++){
    float d = 0.5 * pow(140000.0, float(i) / 511.0);
    float h = slab_terrainM(hz * d);
    if (h < -1e3) continue;
    float drop = d * d / (2.0 * SLAB_R_EARTH * 1000.0);
    best = max(best, atan(h - eyeM - drop, d));
  }
  // ── 그려진 지형 격자의 능선 (§94) ─────────────────────────────────────────
  // 앱의 TerrainField 는 고리 × 살 **꼭짓점**에서만 높이를 읽고 그 사이를 곧게
  // 잇습니다. 봉우리가 꼭짓점 사이에 걸리면 그려진 능선이 자료보다 낮습니다
  // (요네자와 해 뜨는 쪽 최대 0.35°). 자료 능선으로 구름을 자르면 그 틈에서
  // 구름도 산도 없는 하늘이 드러났습니다 — 그래서 같은 꼭짓점으로 한 번 더 굽습니다.
  float jf = az / 6.2831853 * MESH_SPOKES;
  float j0 = floor(jf), tj = jf - j0;
  float a0 = j0 / MESH_SPOKES * 6.2831853, a1 = (j0 + 1.0) / MESH_SPOKES * 6.2831853;
  vec2 hz0 = vec2(sin(a0), -cos(a0)), hz1 = vec2(sin(a1), -cos(a1));
  float mesh = -1.5;
  for (int k = 0; k < MESH_RINGS_I; k++){
    float kf = float(k);
    float d = kf < MESH_INNER
      ? MESH_FOOT * pow(MESH_HINGE / MESH_FOOT, kf / MESH_INNER)
      : MESH_HINGE * pow(MESH_FAR / MESH_HINGE, (kf - MESH_INNER) / (MESH_RINGS - MESH_INNER - 1.0));
    float h0 = slab_terrainM(hz0 * d), h1 = slab_terrainM(hz1 * d);
    if (h0 < -1e3 || h1 < -1e3) continue;
    float drop = d * d / (2.0 * SLAB_R_EARTH * 1000.0);
    mesh = max(mesh, mix(atan(h0 - eyeM - drop, d), atan(h1 - eyeM - drop, d), tj));
  }
  float v = clamp((degrees(best) - (${HORIZON_LO_DEG})) / ${HORIZON_SPAN_DEG}, 0.0, 1.0) * 65535.0;
  float hi = floor(v / 256.0);
  float vm = clamp((degrees(mesh) - (${HORIZON_LO_DEG})) / ${HORIZON_SPAN_DEG}, 0.0, 1.0) * 65535.0;
  float him = floor(vm / 256.0);
  gl_FragColor = vec4(hi / 255.0, (v - hi * 256.0) / 255.0, him / 255.0, (vm - him * 256.0) / 255.0);
}
`;

const FRAG = `
precision highp float;
${ATMOSPHERE_GLSL}
${CLOUD_SLAB_GLSL}
${SLAB_TERRAIN_GLSL}
// ── 운해를 땅이 가리는가 (§83) ────────────────────────────────────────────
//
// 구름은 지형 **위에** 합성됩니다(깊이 없음, SceneComposer). 땅에서 올려다볼
// 때는 구름이 지평선 위라 문제가 드러나지 않았지만, 산 위에서 운해를 내려다보면
// 발밑 사면과 덱 위로 솟은 이웃 봉우리까지 **구름이 덮어 버립니다.**
//
// 그래서 운해 화소마다 시선을 덱에 닿을 때까지 따라가며 지형 높이장
// (TerrainField 와 **같은 패치**)과 견줍니다. 도중에 땅이 시선보다 높으면
// 그 화소는 땅이 앞에 있는 것이므로 운해를 그리지 않습니다.
//
// ⚠ 곡률: 직선 시선은 멀어질수록 지면에서 d²/2R 만큼 **떠오릅니다**
//   (TerrainField 의 낙차와 같은 식, 부호만 시선 쪽에서 본 것).
// ⚠ 패치 밖(약 60km 너머)은 모르는 곳 — 가리지 않습니다.
uniform float uTerrainOcclude;   // 1 이면 켬 (패치가 있을 때만 의미)

/**
 * 시선이 슬랜트 tEndKm 안에서 **처음 땅에 막히는** 슬랜트 거리(km). 안 막히면 1e9.
 *
 * 걸음 사이에서 막혔으면 그 걸음의 거리를 돌려줍니다(실제 교차보다 조금 멂) —
 * 그보다 먼 구름만 가리므로, 막힌 자리와 걸음 사이의 구름을 덜 가리는 쪽입니다.
 */
float slab_terrainHitSeg(vec3 dir, float sinE, float cosE, float t0Km, float tEndKm){
  if (uDemValid < 0.5 && uDemFarValid < 0.5) return 1e9;
  if (tEndKm <= t0Km) return 1e9;
  float eyeGround = slab_terrainM(vec2(0.0));
  float eyeKm = eyeGround > -1e3 ? (eyeGround + uEyeHeightM) / 1000.0 : uObserverAltKm;
  vec2 hz = cosE > 1e-4 ? dir.xz / cosE : vec2(0.0);
  float minGap = 1e9, tMin = 0.0;
  for (int i = 1; i <= 32; i++){
    // 가까운 쪽에 몰아 뜹니다 — 발밑 사면은 수십 m 안에서 시선을 막습니다.
    float f = float(i) / 32.0;
    float t = t0Km + (tEndKm - t0Km) * f * f;
    float dKm = t * cosE;
    float rayKm = eyeKm + t * sinE + dKm * dKm / (2.0 * SLAB_R_EARTH);
    float terr = slab_terrainM(hz * dKm * 1000.0);
    if (terr < -1e3) continue;
    float gap = rayKm - terr / 1000.0;
    if (gap < 0.0) return t;
    // 여유는 **각도**로 견줍니다(여유 ÷ 거리). 미터로 견주면 발밑 몇 m 앞
    // 땅(여유 0.1m)이 늘 이겨, 먼 능선을 다시 볼 기회를 발밑에 써 버립니다.
    float gapAng = gap / max(dKm, 1e-4);
    if (gapAng < minGap) { minGap = gapAng; tMin = f; }
  }
  // ⚠ 먼 쪽은 걸음이 tEnd/16 까지 벌어져, 능선 **꼭대기를 스치는** 시선이
  //   걸음 사이로 빠집니다(덕유산에서 3km 밖 능선 55화소 중 8개, 파고든 깊이
  //   18~121m). 시선이 땅에 각도로 가장 가까웠던 걸음 **양옆 1.5걸음**을
  //   16번 더 봅니다. (±1걸음 8번이던 때 구례 능선 누수 6/3,196 → 3/3,196.
  //   굽힌 지평선 아래 화소만 걸으므로 비용은 잡음 안입니다.)
  float fLo = max(tMin - 1.5 / 32.0, 0.0), fHi = min(tMin + 1.5 / 32.0, 1.0);
  for (int j = 0; j < 16; j++){
    float f = mix(fLo, fHi, (float(j) + 0.5) / 16.0);
    float t = t0Km + (tEndKm - t0Km) * f * f;
    float dKm = t * cosE;
    float rayKm = eyeKm + t * sinE + dKm * dKm / (2.0 * SLAB_R_EARTH);
    float terr = slab_terrainM(hz * dKm * 1000.0);
    if (terr > -1e3 && terr / 1000.0 > rayKm) return t;
  }
  return 1e9;
}

float slab_terrainHitKm(vec3 dir, float sinE, float cosE, float tEndKm){
  return slab_terrainHitSeg(dir, sinE, cosE, 0.0, tEndKm);
}

/** 운해(§83): 시선이 tEndKm 에서 덱에 닿기 **전에** 땅에 부딪히는가. */
bool slab_terrainBlocks(vec3 dir, float sinE, float cosE, float tEndKm){
  if (uTerrainOcclude < 0.5) return false;
  return slab_terrainHitKm(dir, sinE, cosE, tEndKm) < 1e8;
}

/**
 * §84 — **올려다보는** 하늘도 땅이 가립니다. 능선 뒤의 저층운이 능선 앞에
 * 그려지던 것(구름이 깊이 없이 지형 위에 얹힘)을 막습니다.
 *
 * 한 화소에 한 번만 걷고 세 층이 같이 씁니다. 70km 까지만 봅니다 — 성긴
 * 패치가 60km 까지라 그 너머는 모르는 곳입니다.
 */
uniform float uTerrainOccludeSky;
const float SLAB_SKY_OCCLUDE_KM = 70.0;

/** 굽힌 지평선(없으면 uHorizonValid 0 — 그때는 다 걷습니다). */
uniform sampler2D uHorizonTex;
uniform float uHorizonValid;
/** 이 방위에서 땅이 올라오는 가장 높은 고도각(도). 이웃 두 칸까지의 최댓값. */
float slab_horizonDeg(vec3 dir){
  float az = atan(dir.x, -dir.z);             // 북 0, 동 +
  if (az < 0.0) az += 6.2831853;
  float u = az / 6.2831853 * ${HORIZON_BINS}.0;
  float m = 0.0;
  for (int k = -1; k <= 1; k++){
    float c = mod(floor(u) + float(k) + ${HORIZON_BINS}.0, ${HORIZON_BINS}.0);
    vec4 t = texture2D(uHorizonTex, vec2((c + 0.5) / ${HORIZON_BINS}.0, 0.5));
    m = max(m, (t.r * 255.0 * 256.0 + t.g * 255.0) / 65535.0);
  }
  return ${HORIZON_LO_DEG} + m * ${HORIZON_SPAN_DEG};
}

/** 그려진 지형 격자의 능선(°) — 굽기의 B·A. 칸 사이는 곧게 잇습니다(격자처럼). */
float slab_meshHorizonDeg(vec3 dir){
  float az = atan(dir.x, -dir.z);
  if (az < 0.0) az += 6.2831853;
  float u = az / 6.2831853 * ${HORIZON_BINS}.0 - 0.5;
  float c0 = mod(floor(u) + ${HORIZON_BINS}.0, ${HORIZON_BINS}.0);
  float c1 = mod(c0 + 1.0, ${HORIZON_BINS}.0);
  vec4 t0 = texture2D(uHorizonTex, vec2((c0 + 0.5) / ${HORIZON_BINS}.0, 0.5));
  vec4 t1 = texture2D(uHorizonTex, vec2((c1 + 0.5) / ${HORIZON_BINS}.0, 0.5));
  float m0 = (t0.b * 255.0 * 256.0 + t0.a * 255.0) / 65535.0;
  float m1 = (t1.b * 255.0 * 256.0 + t1.a * 255.0) / 65535.0;
  return ${HORIZON_LO_DEG} + mix(m0, m1, fract(u)) * ${HORIZON_SPAN_DEG};
}

/**
 * **DEM 이 없을 때의 대체** (§87) — 옛 능선 밴드(방위 31점 × 거리 5·15·40km).
 *
 * 타일을 못 받으면 지형은 그 밴드로 그려지고, 구름은 예전처럼 산 **앞**에
 * 칠해졌습니다. 밴드마다 능선 고도각과 **거리**를 한 줄씩 구워 두고, 화소가
 * 그 능선 아래이면서 구름이 그 거리보다 멀 때만 가립니다 — 능선 앞의 구름은
 * 남습니다. 방위 보간은 밴드 메시(TerrainRing, 72분할 선형)와 같게 굽습니다.
 */
uniform sampler2D uBandTex;     // HORIZON_BINS × 3, RG 고도각(16비트) · B 거리 · A 산 있음
uniform float uBandValid;
float slab_bandBlockKm(vec3 dir, float sinE, float cosE){
  float az = atan(dir.x, -dir.z);
  if (az < 0.0) az += 6.2831853;
  float u = (floor(az / 6.2831853 * ${HORIZON_BINS}.0) + 0.5) / ${HORIZON_BINS}.0;
  float best = 1e9;
  for (int j = 0; j < 3; j++){
    vec4 t = texture2D(uBandTex, vec2(u, (float(j) + 0.5) / 3.0));
    if (t.a < 0.5) continue;
    float deg = ${HORIZON_LO_DEG} + (t.r * 255.0 * 256.0 + t.g * 255.0) / 65535.0 * ${HORIZON_SPAN_DEG};
    if (sinE >= sin(radians(deg))) continue;
    best = min(best, (t.b * 255.0 / 2.5) / max(cosE, 1e-3));   // 슬랜트 km
  }
  return best;
}

// ── 층 사이의 빛 (§88) ────────────────────────────────────────────────────
// 층 번호: 0 상층 · 1 중층 · 2 저층. 운량 채널: 상층 b · 중층 g · 저층 r.
uniform float uInterLayer;   // 1 = 층 사이의 빛 켬(기본). 판정의 대조용 스위치.
float slab_covOf(vec4 c, int K){ return K == 0 ? c.b : (K == 1 ? c.g : c.r); }
/** 층의 명목 광학두께 — 두께(hThick) × tauK. 셰이더가 이미 쓰는 두 상수의 곱. */
float slab_nomTau(int K){ return K == 0 ? TAUK_HIGH * 0.6 : (K == 1 ? TAUK_MID * 1.0 : TAUK_LOW * 1.6); }
/** 2-stream 반사율 R = tp/(tp+2), tp = (1−g)τ. */
float slab_nomR(int K, float g){ float tp = (1.0 - g) * slab_nomTau(K); return tp / (tp + 2.0); }

uniform vec2  uRes;
uniform mat4  uInvViewProj;
uniform vec3  uCamPos;
// 관측 고도에서 지평선이 내려앉은 만큼의 sin (음수). 지면과 구름이
// **정확히 같은 선에서** 만나게 하는 값입니다.
uniform float uHorizonSinE;
// ⚠ uSunDir·uSunAltDeg 는 **구름을 비추는 광원**입니다. 밤에 달이 박명보다 하늘을
//   더 밝히면 여기에 달이 들어옵니다(§92). 화면 순응·밤 여부는 진짜 해 고도
//   uDispSunAltDeg 로 봅니다.
uniform vec3  uSunDir;
uniform float uSunAltDeg, uSunAzDeg;
uniform float uDispSunAltDeg;
// 광원이 달이면 하늘빛에 곱하는 이득과 더하는 밤하늘 바닥. 해면 1 과 0 이라
// 식이 그대로입니다(x·1 + 0 = x — 낮 화면은 한 바이트도 안 바뀝니다).
uniform float uLightGain;
uniform vec3  uSkyAdd;
// 구름 속(§93) — 관측자를 감싼 구름의 소광(1/km, 0 이면 끔)·밑면·윗면(km)과
// 관측 고도의 직달광(광원이 달이면 이득까지 곱한 값).
uniform float uFogBeta, uFogBaseKm, uFogTopKm;
// 두 번에 나눠 그리기(§96): 0 = 한 번에 다, 1 = 관측자 **위** 층만(산보다 먼저),
// 2 = 관측자 **아래** 층(운해)과 구름 속 안개만(산보다 나중에).
uniform float uPassMode;
uniform vec3  uFogBeam;
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
uniform float uVolSteps;
uniform float uSaturation;
uniform sampler2D uGenusTex;
uniform float uNfEnable, uNfCapKm, uNfViewSteps, uNfShadowSteps;
uniform float uCloudLitFloor, uCloudAmbFloor, uCloudPhaseFloor;
uniform float uClusterAmt, uClusterMul;
uniform float uAmbDownDeg;
// 43절 — 스타일 보드용 자료 출력. 0 = 보통(색), 1 = 표시색+알파(미합성),
// 2 = (광학두께/40, 층, 태양비, 알파). 스타일화 패스가 구름 **자료**를
// 받아 제 방식으로 그리게 하려는 것입니다.
uniform float uDataOut;
uniform float uCloudModel, uCloudAsym, uCloudAniso, uCloudAnisoW,
              uCloudGroundAlb, uCloudSideLit, uCloudFaceUp;

// 광원(해 또는 달)이 밝히는 하늘. 달이면 이득을 곱하고 밤하늘 바닥을 더합니다(§92).
vec3 slab_sky(float elevDeg, float cosGamma){
  return atm_skyRadiance(elevDeg, cosGamma, uSunAltDeg, uBeta, uAngstrom, uElevScale, uOzoneDU)
    * uLightGain + uSkyAdd;
}

/**
 * **노출 맞춤 (§104)** — 직달을 하늘빛과 같은 눈금(×SOLAR_BEAM_SCALE)으로 올린 뒤에도, 구름 전체
 * 밝기는 예전 눈금에서 사진에 맞춰 둔 값을 지킵니다. 지형의 groundLighting 과 같은 방식입니다:
 * 수평면이 받는 빛을 예전 눈금 ÷ 새 눈금으로 나눈 값을 곱합니다.
 *
 *   한낮: 직달이 스무 배가 되어 이 값이 0.14 안팎 → 평균 밝기는 그대로, 해를 등진 면(하늘빛만)은
 *         어두워져 대비가 삽니다(사진 대비가 렌더의 1.6~2배였습니다).
 *   노을: 수평면 직달이 거의 0(sin h)이라 이 값이 1 가까이 → 해를 향한 옆면(cos)의 붉은 직달이
 *         그대로 살아 구름이 타오릅니다.
 *
 * beamS 는 이미 눈금을 곱한 직달, ambRef 는 수평면 하늘빛(복사휘도 평균 = 조도/π).
 */
float slab_expoNorm(vec3 beamS, float sinS, vec3 ambRef){
  const vec3 LWn = vec3(0.2126, 0.7152, 0.0722);
  // 이 셰이더의 약속: 하늘빛은 복사휘도(= 조도/π), 직달 항은 beam·cos. 그래서 수평면 직달은
  // beam·sin 이고, 예전 눈금의 beam 은 지금 것 ÷ (SOLAR_BEAM_SCALE/π) 입니다.
  float amb = dot(ambRef, LWn);
  float b = dot(beamS, LWn) * max(sinS, 0.0);
  return (amb + b / ${(SOLAR_BEAM_SCALE / Math.PI).toFixed(4)}) / max(amb + b, 1e-6);
}

/**
 * **자리마다 다른 직달 (§105·§106)** — 해쪽으로 d km 떨어진 구름에게 해는 d/R 만큼(111km 에 1°) 높습니다.
 * 표는 CPU 의 광선 적분(grazingRay.ts — 둥근 대기·표준대기 밀도·에어로졸 1.2km·오존층·굴절)으로 굽습니다.
 * 해가 진 뒤 머리 위 구름은 이미 지구 그림자인데 서쪽 먼 구름은 아직 햇빛을 받는 까닭이고,
 * "지평선 쪽만 타는" 노을의 물리입니다. 층마다 해 고도 −4~+4° 의 직달을 CPU(beamAtAltitude)
 * 에서 구워 두고 여기서 읽습니다. 8비트 텍스처에 log2 로 담습니다(0~1 → 2^-16~1, 한 칸 1/16 조리개)
 * — 노을 무렵의 어둡고 붉은 직달까지 담으려고. 0 은 "빛 없음".
 */
uniform sampler2D uBeamLUT;     // ${BEAM_LUT_N} × 3 (행 0 상층 · 1 중층 · 2 저층)
uniform float uBeamLUTGain;     // 눈금(SOLAR_BEAM_SCALE/π) × 달빛 이득
vec4 slab_beamLUT(int L, float dDeg){
  float u = (0.5 + clamp((dDeg + ${BEAM_LUT_SPAN.toFixed(1)}) / ${(2 * BEAM_LUT_SPAN).toFixed(1)}, 0.0, 1.0) * ${(BEAM_LUT_N - 1).toFixed(1)}) / ${BEAM_LUT_N.toFixed(1)};
  return texture2D(uBeamLUT, vec2(u, (float(L) + 0.5) / 3.0));
}
vec3 slab_beamDecode(vec4 t){
  return exp2(t.rgb * 16.0 - 16.0) * step(vec3(0.5 / 255.0), t.rgb) * uBeamLUTGain;
}
/** A 채널: 굴절(겉보기 − 진짜, 0~2°) — 빛이 들어오는 방향(§106). */
float slab_refrDecode(vec4 t){ return t.a * 2.0; }

void main(){
  // 화면 → 광선. 카메라 기저를 역행렬로 복원합니다.
  vec2 ndc = (gl_FragCoord.xy / uRes) * 2.0 - 1.0;
  vec4 far = uInvViewProj * vec4(ndc, 1.0, 1.0);
  vec3 dir = normalize(far.xyz / far.w - uCamPos);

  float sinE = dir.y;
  // ⚠ 예전에는 여기서 **+0.17°** 에서 잘랐습니다(sinE 0.003). 그런데 지면은
  // 관측 고도의 내려앉음(24m 면 -0.157°)에 놓입니다. 그래서 구름 밑과 지면
  // 위 사이에 하늘이 그대로 비치는 띠가 남았습니다 — 아래 horizonFade 가
  // 0.63° 에서야 다 차는 것까지 합치면 **0.79°** 입니다. 사용자가 말한
  // "지구곡면으로 구름이 지평선 아래로 흘러야 하는데 중간에 생기는 공백"이
  // 이것입니다.
  //
  // 껍질 교점은 sinE 가 음수여도 발산하지 않습니다 — 분모가
  // R·sinE + sqrt(R²sin²E + chord) 라 sinE<0 이면 커질 뿐입니다
  // (고도 -0.155° 에서 저층까지 152km, 0° 의 132km 보다 조금 멉니다).
  // ⚠ 관측자보다 **아래** 층이 하나라도 있으면 지평선 아래를 버리면 안 됩니다
  //   — 그게 운해입니다(발밑 −90° 부터 구름 껍질의 가장자리까지). 층별
  //   판정은 아래 반복문에서 합니다.
  float lowestLayerKm = min(slab_lowSurfKm(), min(uLayerAltKm.y, uLayerAltKm.z));
  bool anyLayerBelow = uObserverAltKm > lowestLayerKm;
  if (sinE <= uHorizonSinE && !anyLayerBelow && uFogBeta <= 0.0) discard;   // 그 아래는 지형과 지면이 담당
  float cosE = max(sqrt(max(0.0, 1.0 - sinE*sinE)), 1e-4);
  // §84 — 이 시선이 땅에 막히는 거리. 그보다 먼 (관측자보다 위) 층은 안 그립니다.
  //
  // ⚠ 두 토막으로 걷습니다. 처음엔 70km 를 한 번에 걸었는데, 가까운 쪽 걸음이
  //   0.07 → 0.27 → 0.62km 로 벌어져 **300~500m 앞 작은 언덕**을 건너뛰었습니다
  //   (구례에서 능선 3,196화소 중 85개가 샘, 대부분 여기). 가장 가까운 층(저층)
  //   까지를 먼저 촘촘히 걷고, 안 막혔을 때만 그 너머를 걷습니다.
  float tBlockSky = 1e9;
  // 굽힌 지평선보다 0.3° 넘게 위면 걸어 봐야 안 막힙니다 — 건너뜁니다.
  bool belowRidge = uHorizonValid < 0.5
    || sinE < sin(radians(slab_horizonDeg(dir) + 0.3));
  if (uTerrainOccludeSky > 0.5 && sinE > uHorizonSinE && belowRidge) {
    float tLow = min(slab_sphereIntersect(sinE, cosE,
      max(uLayerAltKm.x, uObserverAltKm + 0.01)).sDistKm, SLAB_SKY_OCCLUDE_KM);
    tBlockSky = slab_terrainHitSeg(dir, sinE, cosE, 0.0, tLow);
    if (tBlockSky > 1e8)
      tBlockSky = slab_terrainHitSeg(dir, sinE, cosE, tLow, SLAB_SKY_OCCLUDE_KM);
    // §94 — 그려진 격자의 능선보다 위라면 자료가 막아도 자르지 않습니다. 거기엔
    // 산이 **그려지지 않으므로** 자르면 구름도 산도 없는 하늘 띠가 생깁니다.
    // 구름 버퍼는 절반 해상도로 그려 늘리므로 가장자리가 1~2 화소 흐립니다. 능선 **바로
    // 위**에서 그 흐린 알파 틈으로 구름 아래의 해가 샜습니다(요네자와 재현 42화소).
    // 그래서 구름을 그려진 능선보다 이 버퍼 1.5 화소 아래까지 그립니다 — 산이 구름 뒤에
    // 그려지는 경로(배율 > 1)에서는 산이 그 몫을 덮습니다.
    if (uHorizonValid > 0.5
        && sinE > sin(radians(slab_meshHorizonDeg(dir)) - 1.5 * uPixelAngleRad)) tBlockSky = 1e9;
  }
  // §87 — DEM 이 **아예 없을 때만** 밴드로 대신합니다. DEM 경로는 그대로.
  if (uTerrainOccludeSky > 0.5 && uBandValid > 0.5 && uDemValid < 0.5 && uDemFarValid < 0.5
      && sinE > uHorizonSinE)
    tBlockSky = min(tBlockSky, slab_bandBlockKm(dir, sinE, cosE));
  float cosG = clamp(dot(dir, uSunDir), -1.0, 1.0);

  vec2 sunXZ = length(uSunDir.xz) > 1e-4 ? normalize(uSunDir.xz) : vec2(0.0, 1.0);

  // 층 주변광 — 그 층 고도에서 본 하늘
  //
  // ⚠ cosG(시선-태양 각)를 빼고 **하늘 전체 평균**으로 바꿔 봤다가
  // 되돌렸습니다. 물리로는 그쪽이 옳습니다 — 구름을 비추는 하늘빛은 내가
  // 어디서 보느냐로 바뀌지 않으니까요. 그런데 (1) 고치려던 문제(태양쪽
  // 그늘까지 따뜻한 것)를 **못 고쳤고**, (2) verify-sunset-gap 이 일곱 개
  // 깨졌습니다 — 세로기울기 0.667 → 0.948 로 천정이 지평선만큼 밝아지고
  // 명암폭이 80 → 59 로 무너졌습니다. 사용자가 첫 번째로 꼽은
  // "지평선쪽만 빛나면서"가 바로 그 지표입니다.
  //
  // 즉 이 시선 의존이 지금은 지평선 집중을 만드는 일을 겸하고 있습니다.
  // 걷어 내려면 그 집중을 다른 곳에서 만들어 줘야 합니다(계획 22절).
  vec3 ambUp   = slab_sky(72.0, cosG);
  // ⚠ 아래쪽 주변광을 **12°에서 뜨면 노을빛을 통째로 놓칩니다.**
  //
  // 해가 지평선 아래로 내려가면 따뜻한 띠가 고도 0~6°로 얇게 내려앉습니다.
  // 태양 -3°·이격 20°에서 재면 고도 1°가 따뜻함 +0.485 인데 12°는 이미
  // **-0.325(파랑)** 입니다. 그런데 저층 구름은 그 시각에 직달광이
  // 0.0006 까지 죽어 사실상 이 주변광만으로 칠해집니다 — 그래서 노을에
  // 구름이 분홍이 아니라 남색이 됩니다(계획 38절).
  //
  // 태양 0°에서는 12°도 +0.756 이라 멀쩡합니다. 결함은 해가 진 뒤에만
  // 나타나고, 사용자가 준 19:01(따뜻) → 19:11·19:16(남색) 화면이 그 전이
  // 그대로입니다.
  vec3 ambDown = slab_sky(uAmbDownDeg, cosG);
  vec3 ambBase = mix(ambDown, ambUp, 0.35);

  // ── 구름을 비추는 하늘: 시선과 무관한 **반구 조도** (계획 40절) ──────
  //
  // ambBase 는 cosG(시선-태양 각)를 물고 있습니다. 그건 구름이 받는 빛이
  // 카메라를 어디로 돌리느냐에 따라 바뀐다는 뜻이라 물리로 틀렸고, 크기도
  // 틀렸습니다 — 태양 쪽을 볼 때(감마 0) 진짜 반구 적분의 **4~20배**입니다:
  //
  //   태양 30도 18.4배 · 12도 20.6배 · 0도 14.6배 · -3도 8.5배
  //
  // 광환(aureole) 한 점을 반구 전체인 양 쓴 탓입니다. 그래서 노을에 태양
  // 쪽 구름이 전부 밝게 떠 버립니다.
  //
  // 대신 진짜 조도 적분을 6점 구적으로 칩니다. 가중치는 수평면 조도의
  // sin(e)cos(e) 이고, 마디는 고도 22·56도 × 태양기준 방위 28·70·145도
  // 입니다. 태양고도 -6~60도, 구름고도 0.6~8km 전 범위에서 진짜 적분의
  // **0.91~1.01배**로 들어옵니다(tools 의 quad3 탐색).
  float qSinS = uSunDir.y;
  float qCosS = sqrt(max(0.0, 1.0 - qSinS * qSinS));
  vec3 ambHemi = vec3(0.0);
  vec3 ambVertSun = vec3(0.0), ambVertAnti = vec3(0.0);
  // 구적 열두 번은 legacy 경로에서 쓰이지 않으므로 켤 때만 칩니다.
  if (uCloudModel > 0.5) {
  for (int qe = 0; qe < 2; qe++){
    float qElev = qe == 0 ? 22.0 : 56.0;
    float qSe = sin(qElev * 0.017453293), qCe = cos(qElev * 0.017453293);
    for (int qa = 0; qa < 3; qa++){
      float qAz = qa == 0 ? 28.0 : (qa == 1 ? 70.0 : 145.0);
      float qCg = qSe * qSinS + qCe * qCosS * cos(qAz * 0.017453293);
      ambHemi += slab_sky(qElev, qCg);
    }
  }
  ambHemi *= (1.0 / 6.0);

  // ── 수직면이 받는 하늘 — 노을 구름이 분홍인 진짜 이유 ────────────────
  //
  // 위 적분은 **수평 윗면**의 것입니다(가중치 sin(e)cos(e)). 그런데 노을에
  // 타오르는 것은 구름의 **옆면**이고, 수직면의 가중치는 cos^2(e)cos(phi)
  // 라 무게가 지평선에 쏠립니다 — 곧 박명 아치를 정면으로 봅니다.
  // 같은 태양·같은 고도에서 잰 차이가 이만큼입니다:
  //
  //   태양  0도: 수평 L 1.13e-1 따뜻 -0.387  |  태양쪽 수직 L 2.24e-1 따뜻 +0.342
  //   태양 -3도: 수평 L 6.07e-2 따뜻 -0.524  |  태양쪽 수직 L 7.48e-2 따뜻 -0.027
  //
  // 밝기는 2배, 색은 파랑에서 주황으로 뒤집힙니다. 수평면만 쓰면 노을
  // 구름이 남색이 되는 것이 당연합니다.
  //
  // 마디는 고도 8·34도 × 면 기준 방위 -25·+15·+40도. 태양을 향한 면과
  // 등진 면 양쪽에서 진짜 적분의 0.92~1.11배입니다(quad4 탐색).
  // 면의 방위는 화소마다 다르므로 여기서는 **태양쪽**과 **반대쪽** 둘만
  // 굽고, 실제 면은 그 사이를 코사인으로 잇습니다.
  for (int ve = 0; ve < 2; ve++){
    float vElev = ve == 0 ? 8.0 : 34.0;
    float vSe = sin(vElev * 0.017453293), vCe = cos(vElev * 0.017453293);
    for (int va = 0; va < 3; va++){
      float vAz = va == 0 ? -25.0 : (va == 1 ? 15.0 : 40.0);
      float cS0 = vSe * qSinS + vCe * qCosS * cos(vAz * 0.017453293);
      float cS1 = vSe * qSinS + vCe * qCosS * cos((180.0 + vAz) * 0.017453293);
      ambVertSun  += slab_sky(vElev, cS0);
      ambVertAnti += slab_sky(vElev, cS1);
    }
  }
  ambVertSun *= (1.0 / 6.0);
  ambVertAnti *= (1.0 / 6.0);
  }

  // 지평선 부근 대기 색상 (먼 구름이 지평선과 융합될 때 쓸 안개 빛)
  vec3 horizonHaze = slab_sky(1.0, cosG);

  // 밤 환경 계수 (달빛과 도시 불빛 반사율 상향)
  // 진짜 해로 봅니다 — 광원이 달이어도 밤은 밤입니다.
  float nightFactor = clamp((-uDispSunAltDeg - 2.0) / 10.0, 0.0, 1.0);
  // 달빛은 따로 더하지 않습니다(§92). 예전의 상수 달빛
  // vec3(0.045, 0.068, 0.098) × 조도 × 2.5 는 보름에 대낮 하늘과 맞먹어 밤 구름이
  // 하늘색으로 빛났습니다. 이제 달이 광원 자리(uSunDir)에 들어와 햇빛과 같은
  // 식으로 비춥니다.
  // 도시 스카이글로. 예전 값 vec3(0.14,0.082,0.032)*2.5 는 두 가지가
  // 틀렸습니다: (1) 세기가 커서 한밤중(태양 -42°) 화면 평균 휘도가 124로
  // 대낮(145)에 육박했고, (2) R:B 가 4.4:1 이라 순금색이었습니다.
  // 실제 도시광은 대기 산란을 거치면서 **채도가 낮은 호박빛 회색**으로
  // 사진에 찍히고, 요즘 가로등은 나트륨등보다 훨씬 하얗습니다.
  // ⚠ 비스듬 경로 항이 들어오면서 한 번 더 낮췄습니다. 그 항이 지평선
  // 쪽 광학두께를 키워 주변광(ambBase * (0.26 + 0.30*T))을 어둡게 만드는데,
  // 도시광은 그대로라 상대적으로 세집니다 — 한밤중 R/B 가 0.99 에서 1.20
  // 으로 다시 금색 쪽으로 갔습니다. 톤 곡선이 이 구간에서 압축이 심해
  // 0.75배로는 1.15 까지밖에 안 내려갔고, 0.54배로 눌렀습니다.
  vec3 cityGlowColor = vec3(0.015, 0.0118, 0.0086) * uCityLight * 2.5;

  // 먼 층(고층 11km)부터 가까운 층(저층 1.4km) 순으로 over 합성
  vec3 lin = vec3(0.0);
  float acc = 0.0;
  // 43절 자료 출력용 — 시선 광학두께 합, 층·태양비의 알파 가중 합성
  float tauAcc = 0.0, layerAcc = 0.0, sunAcc = 0.0;

  for (int L = 0; L < 3; L++){
    float hBase  = L == 0 ? uLayerAltKm.z : (L == 1 ? uLayerAltKm.y : uLayerAltKm.x);
    // 구름 고도에서 본 태양. 지평선이 dip 만큼 내려가므로 관측자에게
    // 진 해도 구름에는 아직 떠 있습니다 — 저층 2km 는 1.44도, 중층 6km 는
    // 2.49도. beamAtAltitude 가 이미 같은 보정을 씁니다.
    float dipDeg = degrees(acos(SLAB_R_EARTH / (SLAB_R_EARTH + hBase)));
    float sunElevC = radians(uSunAltDeg + dipDeg);
    float sinSunC = sin(sunElevC), cosSunC = cos(sunElevC);
    // 구름 국소좌표(수평 xy · 위 z)에서 본 태양 방향.
    //
    // ⚠ 예전 sunLightDir 은 세로 성분에 **sinE(시선 고도)** 를 넣고 있었습니다.
    // 태양의 높이 자리에 카메라의 높이가 들어간 셈이라, 위를 보면 태양이
    // 머리 위로 올라오고 지평선을 보면 옆으로 눕습니다. 조명이 시선을
    // 따라다니면 안 됩니다(40절).
    vec3 sunDirLocal = normalize(vec3(sunXZ * cosSunC, sinSunC));
    float hThick = L == 0 ? 0.6 : (L == 1 ? 1.0 : 1.6); // 층의 수직 두께 (km)
    int nSteps   = L == 0 ? 1 : (L == 1 ? 2 : 3);       // 체적 샘플링 스텝 수
    // 주의: 스텝마다 h 가 달라 slab_sphereIntersect 를 다시 풀므로, 세 스텝은
    // 같은 구름의 위아래가 아니라 **지상 위치가 다른 세 겹**입니다. 틈이
    // 겹칠 확률이 p^3 으로 줄어 대비가 사라집니다. 얼마나 먹는지 재려고
    // 스텝 수를 밖에서 누를 수 있게 했습니다.
    nSteps = int(min(float(nSteps), uVolSteps));

    vec3  beam   = L == 0 ? uBeamHigh : (L == 1 ? uBeamMid : uBeamLow);
    float expoL  = 1.0;   // §104 — 아래에서 자리가 정해진 뒤 셉니다
    float cellKm = L == 0 ? CELL_HIGH : (L == 1 ? CELL_MID : CELL_LOW);
    float tauK   = L == 0 ? TAUK_HIGH : (L == 1 ? TAUK_MID : TAUK_LOW);
    float seed   = float(L) * 31.7;
    vec2  wind   = L == 0 ? uWindHigh : (L == 1 ? uWindMid : uWindLow);
    vec2  windNorm = length(wind) > 1e-3 ? normalize(wind) : vec2(1.0, 0.0);

    // ── 지상 위치는 층 밑면에서 **한 번만** 풉니다 ─────────────────────
    //
    // 예전에는 스텝마다 h 를 바꿔 다시 투영했습니다. 시선이 누울수록
    // 지상거리는 h 에 거의 비례하므로, 밑면 1.4km / 꼭대기 3.0km 면
    // **지상 위치가 두 배 벌어집니다.** 그러면 세 스텝이 같은 구름의
    // 위아래가 아니라 서로 무관한 세 겹이 되고, 틈이 겹칠 확률이 p^3 으로
    // 줄어 대비가 통째로 사라집니다.
    //
    // 측정(태양 0°, build-sunset-gap): 명암폭 28.1 → 65.2, 세로기울기
    // 0.954 → 0.857. 체적 스텝은 이제 **음영만** 나눕니다.
    // 관측자보다 **위** 층은 예전처럼 지평선 위만. **아래** 층(운해)은
    // 시선이 껍질에 닿는 동안 — 곧 먼 가장자리 아래 전부.
    //
    // §82 — 저층은 **윗면**(단면의 반값 폭)을 넘어서야 "위" 입니다. 예전에는
    // hBase(덱 한가운데)를 넘는 순간 판을 아래로 뒤집어, 관측자 바로 밑에
    // 1.6km 짜리 판이 생겼습니다.
    float deckTop = L == 2 ? slab_lowSurfKm() : hBase;
    float thickBelow = (L == 2 && uLowDeckKm.y > 0.0)
      ? max(uLowDeckKm.y - uLowDeckKm.x, 0.15) : hThick;
    bool layerBelow = uObserverAltKm > deckTop;
    if (uPassMode > 0.5 && uPassMode < 1.5 && layerBelow) continue;
    if (uPassMode > 1.5 && !layerBelow) continue;
    // 덱 **속**(밑면 < 관측자 ≤ 윗면)이면 올려다본 구름이 관측자 바로 위에서
    // 시작합니다. 아래를 보면 안 그립니다(안개 상태는 그리지 않음 — §82.5).
    float hSurf = layerBelow ? deckTop : max(hBase, uObserverAltKm + 0.01);
    SlabGeom geom = slab_sphereIntersect(sinE, cosE, hSurf);
    if (!layerBelow && sinE <= uHorizonSinE) continue;
    if (!geom.hit) continue;
    // §83 — 운해(아래 층)만 땅과 견줍니다. 올려다보는 하늘은 예전 그대로.
    if (layerBelow && slab_terrainBlocks(dir, sinE, cosE, geom.sDistKm)) continue;
    if (!layerBelow && geom.sDistKm > tBlockSky) continue;
    vec2 km = dir.xz * geom.distRatio;
    // §105 — 이 구름 자리에서 본 해: 해쪽으로 떨어진 만큼(d/R) 높습니다. 방향·직달·노출 맞춤이
    // 모두 이 값을 씁니다. 관측자 둘레(d≈0)에서는 예전 층 값과 같습니다.
    float dSunDeg = degrees(dot(km, sunXZ) / SLAB_R_EARTH);
    // §106 — 빛이 **들어오는 방향**은 그 자리의 국소 수평 기준 겉보기 고도입니다: 진짜 해 고도
    // (관측자 해 + d/R) + 굴절. dip 은 "해가 보이느냐"(직달 표가 셈)이지 방향이 아닙니다 — 예전에는
    // dip 을 방향에도 더해, 해 0° 에 머리 위 1.5km 구름이 빛을 1.25° 위에서 받았습니다. 실제로는
    // 거의 수평(굴절 0.43°)이고, 해가 지면 **아래에서** 올라옵니다(밑면이 붉게 타는 까닭).
    if (uBeamLUTGain > 0.0) {
      vec4 bt = slab_beamLUT(L, dSunDeg);
      beam = slab_beamDecode(bt);
      sunElevC = radians(uSunAltDeg + dSunDeg + slab_refrDecode(bt));
    } else {
      sunElevC = radians(uSunAltDeg + dipDeg + dSunDeg);
    }
    sinSunC = sin(sunElevC); cosSunC = cos(sunElevC);
    sunDirLocal = normalize(vec3(sunXZ * cosSunC, sinSunC));
    expoL = slab_expoNorm(beam, sinSunC, uCloudModel > 0.5 ? ambHemi : ambBase);
    vec4 cv = texture2D(uCoverTex, slab_coverUv(km, uRangeKm));
    float cover = L == 0 ? cv.b : (L == 1 ? cv.g : cv.r);
    float conf  = cv.a;
    vec2 kmN = km + wind * uDriftHours;

    // ── 층 사이의 빛 (§88) ────────────────────────────────────────────────
    //
    // 예전에는 층마다 **위는 텅 빈 하늘, 아래는 맨땅(알베도 0.15)** 이었습니다.
    // 중층이 100% 덮여 있어도 저층은 해와 열린 하늘을 온전히 받았고(중층 0%·100%
    // 에서 저층 밝기가 소수점까지 같음), 운해 위의 구름 밑면은 발밑의 하얀 바다를
    // 모른 채 땅빛만 받았습니다. 사진(두 층 사이, 해질녘)과 렌더의 비가 0.96 대
    // 1.52 로 갈렸습니다(§86).
    //
    // 1) **아래**: 이 층 밑이 구름이면 그 반사율이 땅 대신 바닥이 됩니다.
    //    ag = mix(땅, R아래, 아래층 운량) — 아래에서부터 쌓습니다.
    // 2) **위**: 윗층마다 — 직달은 태양 쪽으로 그 높이까지 올라간 자리의 운량만큼
    //    가려지고(투과 exp(−τ/sin h)), 하늘은 머리 위 운량만큼 **윗층을 투과한
    //    확산광**으로 바뀝니다. 두 층 사이에서 빛이 오가므로 1/(1 − R위·ag) 를
    //    곱합니다(되튐).
    // R·τ 는 층의 명목값입니다(slab_nomTau). 새 조정 상수는 없습니다.
    float agBelow = uCloudGroundAlb;
    for (int K = 2; K >= 0; K--){
      if (K <= L || uInterLayer < 0.5) break;
      agBelow = mix(agBelow, slab_nomR(K, uCloudAsym), slab_covOf(cv, K));
    }
    float upDir = 1.0;
    vec3 upHemi = ambHemi, upSide0 = ambVertAnti, upSide1 = ambVertSun;
    // ── 해가 낮을 때, 해쪽 먼 구름이 노을빛(해쪽 지평선 띠)을 가림 (§103) ──
    //
    // 이 셰이더에서 노을 구름을 분홍으로 칠하는 것은 직달이 아니라 **해쪽 수직면이
    // 받는 하늘빛** — 해쪽 지평선 위의 밝은 띠입니다(위 수직면 적분 주석). 직달은
    // 해쪽 저층에서 해 +5° 에도 밝기의 1~2% 뿐이었습니다(verify-twilight-glow 의 자료 2).
    // 그 띠를 이 층 고도에서 보면 8~90km 앞의 같은 층·윗층을 지나므로, 그 자리
    // 운량만큼 띠가 가려지고 옆면은 해 반대쪽 하늘만큼만 밝습니다. 가린 몫만큼
    // 해쪽 수직면 빛을 반대쪽 수직면 빛으로 바꿉니다 — 둘 다 이미 있는 하늘
    // 적분이라 새 밝기 상수는 없습니다. 해가 이 층에서 3° 넘게 떠 있으면 하늘빛이
    // 해 둘레 광환이 지배해 지평선 띠 이야기가 아니므로 건드리지 않습니다.
    // 사용자 제안: "태양이 있는 방향에서 낮은 구름에 해당하는 먼 거리에 구름이
    // 있으면 어둡게, 없으면 밝게."
    if (uCloudModel > 0.5) {
      float glowW = smoothstep(3.0, 0.0, degrees(sunElevC));
      if (glowW > 0.0) {
        float blk = 0.0;
        for (int s = 0; s < 4; s++){
          float dK = s == 0 ? 8.0 : (s == 1 ? 20.0 : (s == 2 ? 45.0 : 90.0));
          vec4 cvF = texture2D(uCoverTex, slab_coverUv(km + sunXZ * dK, uRangeKm));
          float open = 1.0;
          for (int K = 0; K < 3; K++){
            if (K > L) break;          // 이 층과 윗층만 — 아래층은 시선 아래입니다
            open *= 1.0 - slab_covOf(cvF, K);
          }
          blk += 1.0 - open;
        }
        upSide1 = mix(upSide1, upSide0, blk * 0.25 * glowW);
      }
    }
    // 윗층이 앞으로 흩은 햇빛 — 방향을 대부분 간직합니다(아래 릴리프에서 씀).
    vec3 upFwd = vec3(0.0);
    for (int U = 0; U < 2; U++){
      if (U >= L || uInterLayer < 0.5) break;
      float hU = U == 0 ? uLayerAltKm.z : uLayerAltKm.y;
      if (hU - hBase < 0.1) continue;
      float tanS = max(tan(max(sunElevC, 0.0)), 0.02);
      vec2 offKm = sunXZ * min((hU - hBase) / tanS, uRangeKm);
      vec4 cvS = texture2D(uCoverTex, slab_coverUv(km + offKm, uRangeKm));
      float covS = slab_covOf(cvS, U);
      float covA = slab_covOf(cv, U);
      float tauU = slab_nomTau(U);
      // 직달은 **윗층의 실제 두께장**을 태양 쪽 교점에서 읽습니다. 운량(고른 값)으로
      // 가리면 흐린 날 저층이 고르게 칠해져 무늬가 사라집니다 — 국소대비가 사진의
      // 0.52배 → 0.06배로 떨어졌습니다. 윗층의 틈과 얇은 곳으로 햇빛이 새야 아래가
      // 얼룩집니다. 잔무늬는 끕니다(det 0) — 굵은 모양만으로 충분하고 값이 쌉니다.
      vec2 windU = U == 0 ? uWindHigh : uWindMid;
      vec2 windNormU = length(windU) > 1e-3 ? normalize(windU) : vec2(1.0, 0.0);
      float thU = slab_layer_thickness(U, km + offKm + windU * uDriftHours, covS,
        U == 0 ? CELL_HIGH : CELL_MID, cvS.a, float(U) * 31.7, windNormU, 0.0, 1.0, 0.0, 1.0);
      float tauK_U = U == 0 ? TAUK_HIGH : TAUK_MID;
      // ⚠ **유사변환한 τ** 로 가립니다 — (1−g)τ. 물방울·얼음은 거의 앞으로만
      //   흩어서(g 0.85), 몇 도 꺾인 빛은 여전히 해 쪽에서 오고 릴리프를 해처럼
      //   비춥니다. 이 셰이더의 2-stream 이 이미 같은 변환을 씁니다. 처음에 맨 τ 를
      //   썼더니 권운(τ 1.7) 밑이 직달의 7% 만 받아 온 하늘이 회색으로 가라앉았습니다.
      float trDir = exp(-(1.0 - uCloudAsym) * thU * tauK_U / max(sinSunC, 0.05));
      float tpU = (1.0 - uCloudAsym) * tauU;
      float trDif = 2.0 / (tpU + 2.0);
      // 윗층 U 바로 밑의 바닥 — U 보다 아래 층들(이 층 포함)과 땅.
      float agU = uCloudGroundAlb;
      for (int K = 2; K >= 0; K--){
        if (K <= U) break;
        agU = mix(agU, slab_nomR(K, uCloudAsym), slab_covOf(cv, K));
      }
      float bounce = 1.0 / max(1.0 - slab_nomR(U, uCloudAsym) * agU, 0.2);
      // 에너지를 나눕니다: 윗층을 지난 빛 중 **직달로 계속 가는 몫(trDir)** 은
      // 아래에서 Edir 이 따로 세므로, 확산으로는 나머지만 보탭니다.
      vec3 dirTop = beam * upDir * max(sinSunC, 0.0);
      // ⚠ 윗층을 지나며 흩어진 햇빛(trDif − trDir)은 **등방이 아닙니다.** g 0.85 라
      //   해 쪽이 훨씬 밝고(구름 너머 해가 있는 자리가 환한 것), 아래 구름의 릴리프를
      //   여전히 해 쪽에서 비춥니다. 이걸 고르게 펴면 흐린 날 저층의 무늬가 통째로
      //   사라졌습니다(국소대비 사진의 0.52배 → 0.06배). 따로 들고 가서 릴리프에만
      //   방향을 씌웁니다 — 평평한 면에서는 고르게 편 것과 **같은 값**입니다.
      vec3 fwd = max(trDif - trDir, 0.0) * dirTop * bounce;
      vec3 under = trDif * upHemi * bounce;
      upHemi  = mix(upHemi,  under, covA);
      upSide0 = mix(upSide0, under, covA);
      upSide1 = mix(upSide1, under, covA);
      upFwd   = mix(upFwd, fwd + upFwd * trDif * bounce, covA);
      upDir  *= trDir;   // 틈(두께 0)이면 1 — 운량을 따로 곱하지 않습니다
    }

    // ── 구름 군집 — 셀보다 **큰** 규모 (계획 37절) ────────────────────
    //
    // slab_fbm 은 셀 크기에서 시작해 옥타브마다 **더 잘게만** 갑니다.
    // 그래서 이 필드의 최대 특징이 셀의 1.7배 — 저층 3.3km 뿐입니다.
    // 실제 적운 벌판은 수십 km 짜리 군집과 구름거리로 조직됩니다.
    //
    // 그게 없으면 먼 하늘이 무너집니다. 고도 5°에서 3.3km 구름은 가로
    // 11° · 세로 0.95° 짜리 얇은 조각이라, 여러 개가 겹쳐 균일한 띠로
    // 뭉갭니다. 같은 고도에서 20km 군집이면 가로 60° 로 남습니다.
    // ("먼거리 구름이 갈수록 작게 보이고 뭉쳐 있다" 는 지적의 정체)
    //
    // 원근으로 작아지는 것 자체는 옳으므로 건드리지 않습니다. 모자란
    // 것은 **큰 규모**이지 원근이 아닙니다.
    //
    // 평균이 1 이라 예보 운량을 밀지 않습니다 (fbm 평균 0.5 → 0.55+0.45).
    float cluster = mix(1.0,
      0.55 + 0.9 * slab_fbm(kmN / max(1e-3, cellKm * uClusterMul) + 71.3, 3),
      uClusterAmt);

    // ── 근거리 볼륨 (계획 27·33절) ──────────────────────────────────────
    //
    // 저층에서만, 관측자 기준 수평 uNfCapKm 안에서만 씁니다. 그 밖은 아래
    // 껍질 근사가 그대로 맡습니다. 평판 근사입니다(구면 보정 없음) — 22km
    // 안에서 곡률 오차는 지구 반지름 대비 38m로 층 두께의 몇 % 뿐이고,
    // 근거리 볼륨 하네스가 그 근사로 이미 검증됐습니다(계획 27·33절).
    //
    // ⚠ **이음매가 없습니다.** 이 볼륨의 구름 밑면(genus에 따라
    // 0.7~1.1km)이 아래 껍질의 밑면(hBase=1.5km)과 다른 높이라, uNfCapKm
    // 경계에서 밑면이 뚝 바뀝니다. 다음에 볼 자리로 33.6절에 적어 뒀습니다.
    float genus = (L == 2) ? texture2D(uGenusTex, slab_coverUv(km, uRangeKm)).r : 0.0;
    bool nfUsed = false;
    // ⚠ 근거리 볼륨은 **올려다보는** 모형입니다(밑면부터 적분). 관측자가
    //   층 위에 있으면 쓰지 않고, 밑면 높이도 관측자 기준으로 잽니다.
    if (L == 2 && uNfEnable > 0.5 && cover > 0.02 && !layerBelow) {
      float nfB = nf_baseKm(genus) - uObserverAltKm, nfT = nf_thickKm(genus);
      float nfT0 = nfB / sinE;
      float nfT1 = min((nfB + nfT) / sinE, uNfCapKm / cosE);
      if (nfT1 > nfT0) {
        int nfN  = int(min(uNfViewSteps, 48.0));
        int nfSN = int(min(uNfShadowSteps, 8.0));
        float nfDt = (nfT1 - nfT0) / float(nfN);
        // 화소마다 시작점을 흔들어 스텝 밴딩을 잡음으로 바꿉니다 — 슬랩의
        // 잔무늬 발자국 LOD 와 같은 이유(계획 8절), 스텝이 성글어 안
        // 흔들면 가로줄이 보입니다.
        // slab_hash21 을 씁니다 — sin·dot 해시(예전 여기 값)는 낮은 정밀도에서
        // 방향성 얼룩을 남깁니다. 그 결과가 verify-device-repro 의
        // 격자성(축 정렬 무늬) 판정에 그대로 잡혔습니다.
        float nfJit = slab_hash21(gl_FragCoord.xy);
        float nfTrans = 1.0;
        vec3 nfAcc = vec3(0.0);
        for (int i = 0; i < 48; i++){
          if (i >= nfN) break;
          float nfS = nfT0 + (float(i) + nfJit) * nfDt;
          vec3 p = dir * nfS;
          p.xz += kmN - km;   // 슬랩과 같은 이류 — 같은 바람에 같이 흐릅니다.
          float d = nf_density(p, genus, cover);
          if (d <= 0.001) continue;

          // 자기그림자 / 연직 투과 — 운형에 따라 빛이 오는 방향이 다릅니다.
          // 적운은 직달광이 지배해 태양 쪽으로 걷고, 먹구름은 직달광이
          // 밑면까지 못 와 그 기둥을 연직으로 뚫고 내려온 확산광이 정합니다
          // (계획 33.3절 — 고정 걸음이 아니라 **남은 두께를 등분**해야
          // sunT 가 기둥의 연직 광학두께 그 자체가 됩니다).
          //
          // ⚠ 태양이 지평선 아래(uSunDir.y < 0)면 적운 쪽 행진이 판 밑으로
          // 빠져나갑니다 — 이 층은 1.6~2.6km 두께뿐이라, 아래로 꺾인 방향은
          // 한두 걸음 만에 구름을 벗어나 빈 공기만 잽니다. 그러면
          // nfShadow≈0, nfSunT≈1(안 가려짐)이 **밤에도** 나와, 그 값을 쓰는
          // 달빛 항이 감쇠 없이 구름 전체를 밝힙니다(실기기 재현 하네스에서
          // 잡힘 — 한밤중 화면 평균 휘도가 대낮과 맞먹었습니다). y 성분에
          // 바닥을 둬 행진이 항상 위쪽으로 기울게 합니다.
          vec3 nfSunDirUp = vec3(uSunDir.x, max(uSunDir.y, 0.15), uSunDir.z);
          vec3 nfLightDir = normalize(mix(nfSunDirUp, vec3(0.0, 1.0, 0.0), genus));
          float nfRemain = max(0.05, nfB + nfT - p.y);
          float nfDs = mix(1.8, nfRemain, genus) / float(nfSN);
          // 화소 하나로는 모자랍니다 — 그림자 스텝이 몇 개뿐이라(기본 5개)
          // 시선을 따라 흔들지 않으면 표본 높이(p.y)에 걸린 계단이 그대로
          // 가로줄로 남습니다. 표본 순번 i도 황금각으로 섞어 줄을 깹니다.
          float nfSj = fract(nfJit + float(i) * 0.6180339887);
          float nfShadow = 0.0;
          for (int j = 0; j < 8; j++){
            if (j >= nfSN) break;
            nfShadow += nf_density(p + nfLightDir * ((float(j) + nfSj) * nfDs), genus, cover);
          }
          float nfSunT = exp(-nfShadow * nfDs * mix(7.0, 5.0, genus));

          float nfTau = d * nfDt * mix(9.0, 14.0, genus);
          float nfA = 1.0 - exp(-nfTau);
          float nfT_ = 1.0 - nfA;

          // 아래부터는 위 껍질 경로와 같은 조명 재료(beam·ambBase·
          // horizonHaze·채도부스트)를 씁니다 — 색이 갈라지면 22km 경계가
          // 눈에 띕니다. reach 자리에 nfSunT, thick 자리에 d 를 씁니다.
          float nfPh = 0.45 + 0.55 * pow(max(cosG, 0.0), 5.0);
          vec3 cc = beam * nfSunT * nfPh * (0.20 + 1.15 * nfT_)
                  + ambBase * (0.26 + 0.30 * nfT_);

          if (nightFactor > 0.01 && uCityLight > 0.01) {
            float nfHFrac = clamp((p.y - nfB) / nfT, 0.0, 1.0);
            float nfUpwell = (1.0 - exp(-nfTau * 0.80)) * (0.85 - 0.40 * nfHFrac);
            cc += cityGlowColor * nfUpwell * nightFactor * 0.6;
          }

          cc = max(cc, ambBase * 0.18 * nfA);
          cc *= vec3(0.97, 0.99, 1.00);   // 저층 틴트 — 껍질 경로와 같은 값.

          cc *= expoL;   // §104 — 껍질 경로와 같은 노출 맞춤(같은 저층)
          float nfHaze = 1.0 - exp(-nfS * 0.0030);
          cc = mix(cc, horizonHaze, clamp(nfHaze, 0.0, 0.85) * uAerialScale);

          cc = max(cc, vec3(0.0));   // §108 — 껍질 경로와 같이 채도 외삽을 뺐습니다

          nfAcc += nfTrans * nfA * cc;
          nfTrans *= nfT_;
          if (nfTrans < 0.01) break;
        }
        float nfAlpha = 1.0 - nfTrans;
        if (nfAlpha > 0.0015) {
          lin = nfAcc + lin * nfTrans;
          acc = nfAlpha + acc * nfTrans;
          nfUsed = true;
        }
      }
    }

    // ── 비스듬히 뚫고 지나가는 거리 ────────────────────────────────────
    //
    // 구름 층은 두께가 있는 판입니다. 천정을 보면 시선이 그 두께를 수직으로
    // 지나지만, 지평선 쪽을 보면 **거의 나란히** 지나므로 훨씬 긴 거리를
    // 통과합니다. 그게 먼 하늘의 구름이 층층이 쌓여 벽처럼 보이는 이유입니다.
    //
    // 예전에는 이 항이 통째로 없어서, 고도 2°에서 본 구름과 천정의 구름이
    // **같은 광학두께**였습니다. 그래서 지평선이 물리와 반대로 옅어졌고,
    // 그걸 가리려고 아래 horizonFade 가 4.6°까지 넓게 걸려 있었습니다.
    //
    // 껍질 교점을 밑면·윗면 두 번 풀어 그 차이를 씁니다. 평면 근사 1/sin 은
    // 0.2°에서 286배로 발산하지만, 구면에서는 시선이 층을 빠져나가므로
    // 곡률이 상한을 정합니다 — 저층 38배, 중층 25배, 상층 17배.
    float slant = 1.0;
    {
      // 위에서 볼 때는 시선이 들어간 면(윗면)의 **반대편이 아래**입니다.
      float hOpp = layerBelow ? hSurf - thickBelow : hSurf + hThick;
      float tRef = layerBelow ? thickBelow : hThick;
      SlabGeom gTop = slab_sphereIntersect(sinE, cosE, hOpp);
      slant = gTop.hit
        ? clamp(abs(gTop.sDistKm - geom.sDistKm) / tRef, 1.0, 40.0)
        : 40.0;   // 반대편 면을 못 만나면 층을 끝까지 스치는 것
    }

    // 이 화소가 담당하는 지상 거리(반경 방향). 지평선으로 갈수록 시선이
    // 층을 스치듯 지나 급격히 늘어납니다.
    float footKm = uPixelAngleRad * geom.sDistKm / max(abs(sinE), 0.02);
    // 발자국이 셀 반쯤을 넘어서면 잔무늬를 믿을 수 없습니다.
    float det = 1.0 - smoothstep(0.45, 2.0, footKm / cellKm);
    // 잔 옥타브가 죽은 뒤에도 굵은 장은 한동안 더 해상됩니다. 셀의 3배에서
    // 놓기 시작해 9배(고도 0.4° 부근)에서 상수가 됩니다.
    float detCoarse = 1.0 - smoothstep(3.0, 9.0, footKm / cellKm);

    // 반대쪽 극단 — **천정** 입니다. 위를 보면 지상거리가 0 으로 수렴하므로
    // 노이즈 좌표도 한 점에 모입니다. 저층 기준 고도 75~90°가 통틀어
    // 0.19셀이라, 셀 규모 무늬로는 **아무 구조도 안 생깁니다**.
    //
    // ⚠ 옥타브를 더 켜는 것으로는 안 됩니다. fbm 은 옥타브마다 진폭이
    // 절반이라 8옥타브째 기여가 전체의 0.4% 입니다 — 실제로 +4 까지
    // 올려 봤지만 그림이 거의 그대로였습니다. 필요한 것은 스펙트럼 꼬리가
    // 아니라 **셀보다 훨씬 잔 규모의 독립 항**, 곧 구름 자체의 빌로우입니다.
    //
    // 그래서 세부 계수를 두 개로 나눕니다: det 는 지평선 쪽에서 잔무늬를
    // 끄고, billowAmt 는 천정 쪽에서 빌로우를 켭니다.
    //
    // ⚠ 빌로우를 하늘 전체에 켜면 노을이 망가집니다 — 셀 규모의 큰 덩어리를
    // 잔결로 잘게 부수기 때문입니다 (측정: 태양 0° 명암폭 95.5 → 67.7).
    // 그래서 **지상 좌표가 셀 하나도 못 채우는 곳**에서만 켭니다. 저층
    // 기준으로 천정이 0.125, 고도 50°가 0.59, 고도 14°(노을 시선)가 2.8
    // 입니다. 문턱을 넓게 잡으면 노을 시선까지 켜져 대비를 먹으므로
    // 0.4~2.0 으로 잡습니다 — 대체로 위를 올려다볼 때 켜집니다.
    float billowAmt = det * (1.0 - smoothstep(0.4, 2.0, length(km) / cellKm));

    // ── 수직 체적 스텝 (같은 구름의 위아래) ────────────────────────────
    //
    // 근거리 볼륨이 이 층·이 화소를 이미 그렸으면 건너뜁니다 — 같은 구름을
    // 두 방식으로 겹쳐 그리지 않습니다.
    if (!nfUsed)
    for (int S = 0; S < 3; S++){
      if (S >= nSteps) break;
      float sFrac = nSteps > 1 ? float(S) / float(nSteps - 1) : 0.0;


      // 윗면으로 갈수록 돔 형태로 둥글게 모이는 체적 프로파일
      float shape = 1.0 - sFrac * sFrac * 0.45;
      // 스텝이 달라도 씨앗은 **같습니다.**
      //
      // 예전에는 seed + S*0.15 였습니다. 0.15셀만큼 어긋난 노이즈를 세 겹
      // 겹치는 셈이라, 한 겹의 틈을 다른 겹이 메웁니다. 수직 체적이란
      // 같은 구름의 위아래이지 서로 다른 세 구름이 아닙니다. 두께장을
      // 공유하고 **음영만** 스텝별로 나눠야 틈이 틈으로 남습니다.
      //
      // 릴리프·자기그림자도 반드시 이 값을 씁니다 — 다르면 서로 무관한 두
      // 노이즈를 빼는 셈이라 기울기가 난수가 되고, 그걸 6배 키운 노멀이
      // 입체감을 만들기는커녕 지웁니다.
      float sSeed = seed;
      float thick = slab_layer_thickness(L, kmN, cover * shape, cellKm, conf, sSeed, windNorm, det, detCoarse, billowAmt, cluster);
      if (thick <= 0.0) continue;

      // ── 3D 입체 릴리프 음영 ──
      float eps = cellKm * SLAB_RELIEF_EPS;
      // ⚠ 릴리프도 **같은 cluster** 를 써야 합니다. 다르면 서로 무관한
      // 두 필드를 빼는 셈이라 기울기가 난수가 됩니다(실기기 결함 2번).
      float tX = slab_layer_thickness(L, kmN + vec2(eps, 0.0), cover * shape, cellKm, conf, sSeed, windNorm, det, detCoarse, billowAmt, cluster);
      float tY = slab_layer_thickness(L, kmN + vec2(0.0, eps), cover * shape, cellKm, conf, sSeed, windNorm, det, detCoarse, billowAmt, cluster);
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
      float stepTau = (thick * tauK * slant) / float(nSteps);
      float T = exp(-stepTau);
      float stepAlpha = 1.0 - T;

      // 자기그림자 (Self-shadow)
      // ── 태양 투과율 ────────────────────────────────────────────────
      //
      // 예전에는 셀의 0.55 배만큼 옆으로 **한 번** 떠서 끝냈습니다. 태양이
      // 어디에 있든 같은 거리라, 노을의 긴 그림자가 아예 생기지 않습니다.
      // 광선이 두께 hThick 인 층을 옆으로 뚫고 나가는 수평 거리는
      // hThick/tan(태양고도) 이고 해가 낮을수록 급히 길어집니다 —
      // 태양 45도면 1.6km, 5도면 18km. 그 경로를 3점으로 적분하고,
      // 광학두께도 수직이 아니라 **빗변** 길이로 셉니다.
      float thickSun;
      float reach;
      if (uCloudModel > 0.5) {
        float runKm = min(hThick / max(0.02, tan(max(sunElevC, 0.007))), cellKm * 6.0);
        float acc = 0.0, wsum = 0.0;
        // ⚠ 표본을 **가까운 쪽에 몰아** 뜹니다.
        //
        // 예전에는 f = 1/3, 2/3, 1 에 가중치 0.92·0.83·0.75 로 거의 고르게
        // 떴습니다. 그런데 runKm 은 광선이 층을 빠져나가는 거리(태양 40°에서
        // 1.6셀)라, 가장 먼 표본은 **옆 덩이**에 떨어집니다. 구름이 셀 규모로
        // 되풀이되므로 그 표본은 나와 무관하거나 오히려 반대 위상입니다.
        //
        // 그래서 그림자가 엉뚱한 쪽에 생겼습니다. 구름 휘도 기울기와 화면 위
        // 태양 방향의 각을 재면 124.6°·152.7° — 옆에서 비출 때 거의 정반대
        // 였습니다(0°가 옳음). 태양이 낮을수록 runKm 이 길어져 더 심했습니다.
        //
        // 물리로는 **가장 가까운 가림물이 지배**합니다. 광선이 처음 만나는
        // 물질이 이미 대부분을 막기 때문입니다. 표본을 가까운 쪽으로 당기고
        // 가중치도 그렇게 주면, 먼 표본은 낮은 해에서만 거들게 됩니다.
        const float SUN_F[3] = float[3](0.12, 0.35, 0.75);
        const float SUN_W[3] = float[3](1.0, 0.62, 0.34);
        for (int ks = 0; ks < 3; ks++){
          float f = SUN_F[ks];
          float w = SUN_W[ks];
          acc += slab_layer_thickness(L, kmN + sunXZ * (runKm * f), cover * shape,
                                      cellKm, conf, sSeed, windNorm, det, detCoarse, billowAmt, cluster) * w;
          wsum += w;
        }
        thickSun = acc / wsum;
        // 태양 경로의 광학두께는 **원시 소산**입니다 — 유사변환 (1-g) 는
        // 확산 수송의 것이고, 직달빔의 감쇠는 소산 그대로입니다.
        //
        // 예전에 여기에 (1-g) 나 그 중간값을 넣어 reach 를 억지로 살리려
        // 했는데, 그건 아래의 **기하 오류**를 색보정으로 덮는 일이었습니다.
        // 기하를 고치고 나니 보정계수가 필요 없어졌습니다.
        //
        // ⚠ **기둥 전체가 아니라 나보다 더 두꺼운 몫**만 셉니다.
        //
        // 예전에는 thickSun(태양 쪽 이웃의 기둥 두께)을 그대로 넣었습니다.
        // 그건 "구름 **반대편**까지 햇빛이 닿는가"를 묻고 그 답으로 **이쪽
        // 면**을 칠한 것입니다. 저층 두께 1.4·tauK 15 면 지수가 7 이라
        // reach = 9e-4 — 실측하면 구름 안쪽 빛의 **5~6% 만 직달**이고
        // 94~95% 가 하늘빛이었습니다. 진짜 햇빛 받는 적운은 정반대로
        // 직달이 85~90% 입니다. 조명이 태양 방향을 안 따라가는 것도,
        // 입체감이 없는 것도 전부 여기서 나옵니다 — 방향을 아는 항이
        // 전체의 5% 밖에 안 되니 나머지 95% 의 등방 하늘빛에 묻힙니다.
        //
        // 두꺼운 구름에서 우리가 보는 빛은 **표면 한 겹**에서 나옵니다.
        // 그 표면에 해가 닿느냐를 정하는 것은 내 기둥의 두께가 아니라
        // 태양 쪽 이웃이 나보다 얼마나 더 솟았느냐입니다.
        //
        //   균일한 판의 윗면 → 이웃도 나와 같음 → 초과 0 → 온전히 햇빛 (옳음)
        //   봉우리 꼭대기   → 이웃이 더 낮음   → 초과 0 → 온전히 햇빛 (옳음)
        //   더 높은 봉우리 뒤 → 이웃이 더 두꺼움 → 초과 큼 → 그늘 (옳음)
        //
        // ⚠ 알려진 한계: 균일한 두꺼운 판이면 초과가 0 이라 온전히 햇빛인데,
        // 그건 **윗면** 이야기입니다. 지상에서 보는 것은 대개 **밑면**이고
        // 밑면은 제 기둥에 가려집니다. 스텝이 하나뿐이라(uVolSteps=1) 둘을
        // 구분할 수 없습니다. 제 기둥의 일부를 섞어 중간을 잡아 봤지만
        // (0.15·0.30·0.50) 직달 몫이 다시 1~9% 로 주저앉아 방향 이득이
        // 통째로 사라졌습니다 — 반쪽 타협이 성립하지 않습니다. 세로 구조를
        // 실제로 넣기 전까지는 초과분만 씁니다.
        float sunExcess = max(0.0, thickSun - thick);
        reach = exp(-sunExcess * tauK
                    * min(1.0 / max(0.10, sinSunC), 8.0) * 0.55);
      } else {
        thickSun = slab_layer_thickness(L, kmN + sunXZ * (cellKm * 0.55), cover * shape, cellKm, conf, sSeed, windNorm, det, detCoarse, billowAmt, cluster);
        reach = exp(-thickSun * tauK * 0.55);
      }

      // ── 해쪽 먼 구름이 낮은 햇빛을 가림 (§103) ────────────────────────
      //
      // 노을 무렵 이 층에 닿는 햇빛은 **해쪽으로 수십~수백 km 를 거의 수평으로**
      // 지나온 빛입니다. 그 길에 같은 층의 구름이 있으면 이 구름은 불이 안 붙고,
      // 맑으면 타오릅니다 — "서쪽 하늘이 트여야 노을이 진다" 는 그 현상입니다.
      // 위의 reach 는 가까운 이웃(저층 약 7km 안)만, upDir 은 **윗층**만 봅니다.
      // 같은 층의 먼 구간은 아무도 안 봤습니다.
      //
      // 광선을 해쪽으로 되짚으며 높이를 셉니다: h(d) = d·tan(층에서 본 해 고도)
      // + d²/2R(땅이 휘어 멀어지는 몫). 층 두께 안에 머무는 동안의 표본마다 그 자리
      // 예보 운량만큼 막힙니다(운량 = 그 구간에서 구름을 만날 확률). 해가 조금만
      // 높아도 광선이 몇 km 안에 층을 벗어나므로 낮에는 저절로 아무 일도 없습니다.
      // 사용자 제안: "태양이 있는 방향에서 낮은 구름에 해당하는 먼 거리에 구름이
      // 있으면 어둡게, 없으면 밝게."
      if (uCloudModel > 0.5 && sinSunC > -0.02) {
        // §106 — 빛이 아래에서 오면(해가 진 뒤) 광선은 해쪽으로 되짚을 때 먼저 **내려갑니다**.
        float tanS = tan(sunElevC);
        float nearKm = cellKm * 6.0;   // 위 reach 가 이미 본 구간
        float farT = 1.0;
        for (int fs = 0; fs < 6; fs++){
          float dK = fs == 0 ? 10.0 : (fs == 1 ? 20.0 : (fs == 2 ? 40.0 : (fs == 3 ? 80.0 : (fs == 4 ? 160.0 : 300.0))));
          if (dK <= nearKm || dK > uRangeKm) continue;
          float rise = dK * tanS + dK * dK / (2.0 * SLAB_R_EARTH);
          if (rise > hThick) break;   // 광선이 이 층을 위로 벗어났습니다(다시 안 들어옵니다)
          if (rise < 0.0) continue;   // 층 밑을 지나는 구간 — 이 층은 안 가립니다
          vec4 cvF = texture2D(uCoverTex, slab_coverUv(km + sunXZ * dK, uRangeKm));
          farT *= 1.0 - slab_covOf(cvF, L);
        }
        reach *= farT;
      }

      // 체적 수직 조명: 윗면(S->2)은 직달광과 림라이트가 강하고, 밑면(S->0)은 깊은 체적 음영
      // 체적 수직 조명 프로파일. 스텝이 하나뿐이면 프로파일이 의미가 없고
      // 0.65 / 0.50 이 그냥 **상수 감광**으로 남아 구름만 어두워집니다.
      // 그건 대비를 얻는 정직한 방법이 아니므로 1.0 으로 둡니다.
      float vertLit = nSteps > 1 ? (0.65 + 0.55 * sFrac) : 1.0;
      float vertShadow = nSteps > 1 ? (0.50 + 0.50 * sFrac) : 1.0;

      // ── 구름 안의 빛: 보존산란 2-stream 슬랩 해 (계획 40절) ────────
      //
      // 예전에는 세 항(직달 lit · 주변 amb · 다중산란 ms)을 각자 다른 바닥
      // 상수로 만들어 더했습니다. 바닥이 여섯 개였고 그중 어느 것도 서로를
      // 모르므로 에너지가 보존되지 않았습니다 — 하나를 올리면 다른 곳이
      // 깨지는 것이 그 때문입니다(39절).
      //
      // 구름은 가시광에서 거의 흡수하지 않습니다(단일산란 알베도 ≈ 0.9999).
      // 흡수가 없는 평면평행 슬랩의 2-stream 해는 **정확히** R + Tr = 1 을
      // 만족합니다:
      //
      //   R = tp/(tp+2),   Tr = 2/(tp+2),   tp = (1-g)*tau   (유사변환)
      //
      // 내부 평균복사 Jbar 도 깊이에 대해 **선형**으로 닫힙니다. 등방
      // 산란원이므로 이 Jbar 가 곧 시선으로 나가는 원천함수입니다.
      // 바닥 상수도, 2-stream 흉내 곱셈도 필요 없습니다.
      vec3 cc;
      // 이 표본이 받는 빛 중 직달의 몫(0=그늘, 1=햇빛). 43절 자료 출력용.
      float stepSunFrac = reach;
      if (uCloudModel > 0.5) {
        // 단위를 **플럭스/파이(등가 등방 복사휘도)** 로 통일합니다. 그래야
        // 직달 beam 과 하늘 ambBase 를 그냥 더할 수 있습니다.
        // 직달광이 이 조각에 얼마나 실리는가는 **면의 코사인**이 정합니다.
        // 평면평행처럼 sin(태양고도)를 쓰면 해가 지평선에 있을 때 0 이 되어
        // 노을 구름이 통째로 죽습니다. 실제로 노을에 구름이 타오르는 이유가
        // 바로 3차원 구름의 **옆면**이 수평 광선을 정면으로 받기 때문입니다.
        // 릴리프 노멀 n 이 우리가 가진 유일한 모양 정보이므로 그걸 씁니다.
        float cosFace = max(0.0, dot(n, sunDirLocal));
        // uCloudSideLit 은 노멀이 못 담는 잔여(구름 덩어리 사이 반사 등)
        // 바닥입니다. 0 이면 노멀이 등지는 면은 직달광이 정확히 0.
        vec3 Edir = beam * reach * upDir * (cosFace + uCloudSideLit * (1.0 - cosFace) * max(0.0, sinSunC));
        // 하늘빛은 reach 를 곱하지 **않습니다** — 자기그림자에 든 구름도
        // 하늘 전체에서 확산광을 받습니다. 대신 **어느 쪽을 보는 면인가**로
        // 세 적분을 잇습니다: 위를 보면 ambHemi, 옆을 보면 태양쪽/반대쪽
        // 수직면 적분.
        //
        // uCloudFaceUp 이 1 보다 작은 이유: 높이장의 노멀은 구름을 위에서
        // 눌러 본 것이라 옆면을 과소평가합니다. 실제 뭉게구름은 노멀이
        // 곧추서 있어도 옆구리가 있습니다.
        float faceUp = clamp(n.z * uCloudFaceUp, 0.0, 1.0);
        vec2 nh = n.xy;
        float faceSun = length(nh) > 1e-4 ? dot(normalize(nh), sunXZ) : 0.0;
        vec3 ambSide = mix(upSide0, upSide1, 0.5 + 0.5 * faceSun);
        // 앞으로 흩은 햇빛(§88): 평면(n 위)에서 1, 해를 향한 면은 더, 등진 면은 덜.
        float fwdRelief = max(0.0, 1.0 + dot(n, sunDirLocal) - sunDirLocal.z);
        vec3 Fdn = Edir + mix(ambSide, upHemi, faceUp) + upFwd * fwdRelief;
        stepSunFrac = dot(Edir, vec3(0.2126, 0.7152, 0.0722))
                    / max(1e-6, dot(Fdn, vec3(0.2126, 0.7152, 0.0722)));
        float tp = thick * tauK * (1.0 - uCloudAsym);
        float ag = agBelow;   // §88 — 밑이 구름이면 그 반사율
        float kk = (1.0 - ag) / (2.0 + tp * (1.0 - ag));
        // 깊이 xd: 윗면 0 → 밑면 tp.
        //
        // 스텝이 하나뿐이면 그 표본이 기둥 전체를 대표해야 하는데, 한가운데를
        // 쓰면 **깊이 의존이 통째로 사라집니다** — Jbar 가 tp 에 거의 무관한
        // 상수(F의 0.53~0.58배)가 되어 노을이 평평해집니다(측정: 태양 -3°
        // 명암폭 97.3 → 62.3).
        //
        // 실제로는 어디를 보느냐가 정합니다. 위를 올려다보면 구름의 **밑면**을
        // 보므로 기둥 전체를 통과한 빛(Tr, 두꺼우면 어둡다)이고, 지평선을
        // 스치듯 보면 옆면과 윗면이 같이 들어옵니다. sinE 가 그 기하입니다.
        // ⚠ 예전에 여기 (1-sFrac)*2.0 을 썼습니다. sFrac 은 이미 0(밑면)
        // ~1(윗면) 이라 (1-sFrac) 만으로 기둥 전체를 덮는데, 2 를 곱하면
        // 맨 아래 표본이 기둥의 **두 배** 깊이를 봅니다. 그러면 밑면이
        // 과하게 어두워져 3스텝이 대비를 부풀립니다 — verify-photo-match 가
        // 국소대비를 사진의 2.0~2.6배로 잡은 것이 그것이었습니다.
        // ⚠ 위에서 내려다볼 때(운해)는 반대입니다 — 보이는 것은 햇빛을 바로
        //   받는 **윗면**이라 깊이 0 에 가깝고, 스치듯 볼수록 옆면이 섞여
        //   0.45 로 갑니다. 예전 식에 sinE < 0 을 넣으면 깊이가 **음수**가
        //   되어(−0.82 아래) 윗면이 물리적으로 불가능하게 밝아졌습니다.
        float viewDepth = layerBelow ? mix(0.45, 0.0, clamp(-sinE, 0.0, 1.0))
                                     : mix(0.45, 1.0, sinE);
        float xd = tp * viewDepth * (nSteps > 1 ? (1.0 - sFrac) : 1.0);
        vec3 Jbar = Fdn * max(0.0, 1.0 - kk * (1.0 + xd));
        // ── 아래에서 오는 햇빛 — 밑면 (§106) ─────────────────────────────
        //
        // 해가 진 뒤 이 층에서 해가 아직 보이면(직달 표 > 0) 빛은 국소 수평 **아래**에서 들어와
        // 밑면을 비춥니다. 같은 2-흐름을 뒤집어 씁니다: 밑면 조도 F↑ = 직달 × sin(−고도), 비춰진
        // 면에서 본 깊이는 위에서 볼 때의 반대(tp − xd). 노을 뒤 머리 위 구름 밑면이 붉게 타는
        // 것이 이 항입니다. 해가 위에 있으면 0 입니다.
        if (sinSunC < 0.0) {
          // 윗층(upDir)은 아래에서 오는 빛을 안 가립니다 — 그래서 곱하지 않습니다.
          vec3 Fup = beam * (-sinSunC);
          float xdUp = max(0.0, tp - xd);
          Jbar += Fup * max(0.0, 1.0 - kk * (1.0 + xdUp));
        }
        // 남은 것은 위상함수의 **등방 초과분**뿐입니다. 구면 평균이 1 인
        // HG 에서 1 을 빼므로 이 항은 평균 0 — 에너지를 더하지도 빼지도
        // 않고 태양쪽 은테와 반대쪽 감광만 만듭니다. 전방 첨두는 유사변환
        // 때 이미 잘라 냈으므로 잔여 비등방은 작습니다.
        float g2 = uCloudAniso * uCloudAniso;
        float hg = (1.0 - g2) / pow(max(1e-3, 1.0 + g2 - 2.0 * uCloudAniso * cosG), 1.5);
        cc = max(Jbar + Edir * (hg - 1.0) * uCloudAnisoW, vec3(0.0));
      } else {
        // ── 구름의 위상함수는 거의 등방입니다 ──────────────────────────────
        //
        // 바닥 0.45 는 **단일산란** 위상함수의 모양입니다. 그런데 광학두께가
        // 1 을 넘는 구름 속에서는 빛이 여러 번 튀며 방향 기억을 잃어, 밖에서
        // 보는 밝기는 각도에 거의 무관해집니다(램버트에 가까움). 실제로 맑은
        // 날 뭉게구름은 산란각 60°에서 보든 120°에서 보든 똑같이 하얗습니다 —
        // 태양 쪽 가장자리만 전방산란으로 더 밝습니다(은테).
        //
        // 바닥이 0.45 면 옆에서 본 구름이 절반으로 죽습니다. 그게 맑은 날
        // 구름이 하늘보다 어둡게 나오는 가장 큰 몫이라 uniform 으로 뺍니다
        // (계획 36절). 은테를 만드는 cosG^5 항은 그대로 둡니다.
        float ph = uCloudPhaseFloor + (1.0 - uCloudPhaseFloor) * pow(max(cosG, 0.0), 5.0);
        // ── 두꺼워질수록 어두워지는 것은 직달광이 아닙니다 ──────────────────
        //
        // T 는 **이 표본을 시선 방향으로 뚫는 투과율**이라, 이 표본이 태양빛을
        // 얼마나 받는지와는 상관이 없습니다(그건 이미 reach 가 셉니다). 화면을
        // 얼마나 덮는지도 stepAlpha 가 따로 셉니다. 그러니 여기 T 를 한 번 더
        // 곱하는 것은 소멸을 두 번 세는 것이고, 얇은 가장자리를 빛나게 하려고
        // 넣은 장치입니다.
        //
        // 문제는 바닥이 0.20 이라 조금만 두꺼워지면 직달광이 5분의 1로 죽는다는
        // 것입니다. 구름은 빛을 거의 **흡수하지 않는** 산란체라(가시광 단일산란
        // 알베도 ≈ 0.9999) 두꺼워질수록 어두워질 이유가 없습니다 — 두꺼운
        // 적운의 햇빛 받는 면이 눈부시게 흰 것이 그 때문입니다.
        // 바닥을 uniform 으로 빼서 잽니다(계획 36절).
        vec3 lit = beam * reach * ph * (uCloudLitFloor + (1.35 - uCloudLitFloor) * T) * vertLit;
      
        // 다중 산란(Multiple Scattering) 투과광: 
        // 두꺼운 구름이라도 직달광(reach=0)이 산란을 통해 내부와 밑면을 밝힘
        float totalTau = max(thickSun, thick) * tauK; 
        float msTransmittance = 2.0 / (totalTau * 0.15 + 2.0); // 2-stream 근사
        // 다중산란. 두 가지를 고쳤습니다.
        //
        // (1) 세기가 0.5 로 커서 노을 대비를 통째로 먹었습니다 — 이 항만
        //     빼면 태양 0° 명암폭이 47.9 → 102 로 두 배가 됩니다.
        // (2) reach 를 안 봐서 **자기그림자에 든 구름에도 같은 양**이
        //     들어갔습니다. 그게 "태양 반대편 그림자"가 사라진 이유입니다.
        //     완전히 게이트하면 두꺼운 속이 새까매지므로, 그늘에서도 4분의 1은
        //     남깁니다 — 다중산란은 원래 직달광이 안 닿는 곳도 밝히니까요.
        vec3 ms = beam * msTransmittance * 0.12 * (0.3 + 0.7 * vertShadow)
              * (0.25 + 0.75 * reach);
        lit += ms * uMultiScatter;

        // 두꺼운 덱의 **밑면**도 하늘빛을 받습니다.
        //
        // 예전에는 (0.26 + 0.30*T) 뿐이라 T→0 이면 26% 로 굳었습니다. 태양이
        // 지평선에 있으면 beam 이 거의 0 인데 nightFactor 도 아직 0 이라
        // 달·도시광이 안 켜집니다. 그 틈에서 흐린 하늘을 밝힐 항이 하나도
        // 없어 **화면이 통째로 검어졌습니다** (전천후 격자: 흐림·천정·노을
        // 평균 휘도 0, 구름덮임 0 — 검은 구름이 하늘을 다 덮은 것입니다).
        //
        // 이미 계산해 둔 2-stream 투과율을 주변광에도 태웁니다. 얇으면
        // 1.11배(하늘과 거의 같음), 광학두께 15의 두꺼운 덱이면 0.52배로
        // 붙습니다 — 흐린 날 낮이 어둡긴 해도 캄캄하지는 않습니다.
        // ⚠ 바닥 0.26 은 **구름이 하늘의 26% 만 본다**는 뜻입니다. 실제 구름은
        // 하늘 반구 전체에서 확산광을 받으므로 그보다 훨씬 많이 받습니다.
        // 맑은 날 얇은 구름이 하늘보다 어둡게 나오는 주된 원인이라 여기도
        // uniform 으로 빼서 잽니다(계획 36절).
        vec3 amb = ambBase * (uCloudAmbFloor + 0.30 * T) * vertShadow;
        cc = lit + amb;
      }

      // 밤하늘 지상 도시 불빛 (구름 밑면 S=0에 가장 강하게 집중 투영)
      if (nightFactor > 0.01 && uCityLight > 0.01) {
        float layerHeightAtten = L == 2 ? 1.0 : (L == 1 ? 0.40 : 0.10);
        // 밑면 집중. 스텝이 하나뿐이면 프로파일이 없으므로 3스텝 시절의
        // 평균(0.65)을 씁니다 — 안 그러면 0.85 로 굳어 밤이 밝아집니다.
        float bottomWeight = nSteps > 1 ? (0.85 - 0.40 * sFrac) : 0.65;
        float upwellingScatter = (1.0 - exp(-thick * tauK * 0.80)) * layerHeightAtten * bottomWeight;
        vec3 cityAmb = cityGlowColor * upwellingScatter * (0.45 + 0.55 * max(n.z, 0.1));
        cc += cityAmb * nightFactor * 0.6; // 너무 과하지 않게 줄임
      }

      // 입체 릴리프 음영 부여.
      //
      // 2-stream 에서는 릴리프가 이미 **물리적으로** 들어가 있습니다 —
      // 직달은 면 코사인(cosFace), 하늘은 면이 보는 입체각(0.5+0.5*n.z).
      // 여기서 한 번 더 곱하면 같은 기하를 두 번 세고, 게다가 relief 는
      // 태양 아래에서 rake 라는 **가짜 광원**으로 갈아탑니다.
      if (uCloudModel <= 0.5) cc *= (0.76 + 0.50 * clamp(relief, -0.6, 1.0));

      // 구름은 자기가 가린 하늘보다 어두울 수 있어도 **완전히 검을 수는
      // 없습니다.** 두꺼운 덱의 밑면도 옆과 아래에서 들어오는 빛을 받습니다.
      //
      // 이게 없으면 태양이 지평선에 있어 beam 이 거의 0 인데 nightFactor 도
      // 아직 0 이라 달·도시광이 안 켜지는 틈에서, 흐린 하늘이 통째로
      // 검어집니다 (전천후 격자: 흐림·천정·노을 화면 평균 휘도 1.9).
      //
      // 바닥으로 두는 것이 핵심입니다. 주변광 공식에 더하거나 곱하면 얇은
      // 구름까지 밝아져 노을 대비를 먹습니다 (측정: 태양 0° 명암폭
      // 95.5 → 67.7). 바닥은 원래 그보다 어두운 화소만 건드립니다.
      // (1 - T) 를 곱하는 것이 핵심입니다. 바닥은 **두꺼운 구름 속에서
      // 여러 번 산란된 빛**이므로 얇은 구름에는 있을 이유가 없고, 얇은
      // 구름까지 들어 올리면 노을 대비를 깎습니다 (측정: 고정 바닥 0.40
      // 이면 태양 -3° 명암폭 105.7 → 87.8).
      //
      // ⚠ 이 바닥은 안전망일 뿐입니다. "흐린 날 노을에 화면이 검다"의
      // 진짜 원인은 구름이 아니라 **하늘돔**입니다 — 흐림·천정·노을에서
      // 슬랩 덮임이 0.093 인데도 화면 평균 휘도가 1.7 이고, 같은 시각
      // 맑음은 146.8 입니다. 두 경우의 천정 복사휘도는 0.045 로 같으니
      // 차이는 betaMie(0.046 대 0.219)를 받는 쪽에 있습니다.
      // docs/SKY_REBUILD_PLAN.md 15절에 남겼습니다.
      // ⚠ 이 바닥은 **legacy 전용**입니다. 2-stream 에는 필요가 없고
      // 있으면 해롭습니다: Jbar 는 구조상 0 이 될 수 없고(가장 두꺼운
      // 밑면도 F 의 0.11배), 반대로 ambBase 는 태양 쪽에서 진짜 반구
      // 조도의 8.5배라 바닥이 본체보다 커집니다. 실제로 켜 둔 채 재 보니
      // 노을 화면이 통째로 균일한 잿빛으로 덮여 구름 구조가 사라졌습니다.
      if (uCloudModel <= 0.5) cc = max(cc, ambBase * 0.18 * (1.0 - T));

      // 층별 틴트 & 깊이감
      vec3 tint = L == 0 ? vec3(1.05, 0.98, 1.03) : (L == 1 ? vec3(1.00, 1.00, 1.01) : vec3(0.97, 0.99, 1.00));
      cc *= tint;

      // 대기 원근감 (Aerial Perspective)
      // 대기 원근감. 100km 에서 이미 42%, 357km 에서 85% 를 한 가지 안개색
      // 으로 덮으므로, 노을의 분홍·보라·파랑 **변화**를 지우는 쪽으로도
      // 작용합니다. 세기를 uniform 으로 빼 얼마나 먹는지 잽니다.
      // 0.0055 는 100km 에서 벌써 42% 를 한 가지 안개색으로 덮어 노을의
      // 색 변화를 지웠습니다. 절반으로 낮추면 깊이감은 남고 대비는 돌아옵니다.
      cc *= expoL;   // §104 — 하늘 연무를 섞기 전에(연무는 하늘빛이라 맞출 것이 없습니다)
      float aerialHaze = 1.0 - exp(-geom.sDistKm * 0.0030);
      cc = mix(cc, horizonHaze, clamp(aerialHaze, 0.0, 0.85) * uAerialScale);

      // ⚠ 예전에는 여기서 두께에 비례해 채도를 최대 1.245배 **외삽**했습니다(물리 근거 없음).
      //   두꺼운 구름일수록 색을 짙게 했는데, 직달이 제 눈금이 된 뒤(§104~§106) 노을에 해 받은
      //   두꺼운 구름을 원색으로 밀었습니다(사진 대조 원색 7.4%, 사진 0.9%). 구름 색은 직달과
      //   하늘빛이 2-흐름 안에서 섞인 그대로 둡니다. 모자라던 채도는 구름만의 것이 아니라 **휴대폰
      //   JPEG 의 전역 채도**였으므로 표시 단계(displaySaturation)로 옮겼습니다(§108).
      cc = max(cc, vec3(0.0));

      // 체적 누적 합성
      lin = cc * stepAlpha + lin * (1.0 - stepAlpha);
      tauAcc += stepTau;
      layerAcc = float(L) * stepAlpha + layerAcc * (1.0 - stepAlpha);
      sunAcc = stepSunFrac * stepAlpha + sunAcc * (1.0 - stepAlpha);
      acc = stepAlpha + acc * (1.0 - stepAlpha);
      if (acc > 0.98) break;
    }
  }

  // 지평선 곡률 융합 — 층이 지구 어깨 뒤로 넘어가며 사라지는 마지막 조각.
  //
  // 예전 값은 sinE 0.003~0.080, 곧 **고도 4.6°까지** 걸렸습니다. 그건
  // 곡률이 아니라 위 slant 항이 없어서 옅어진 지평선을 가리는 덮개였습니다.
  // 이제 지평선은 물리대로 두꺼워지므로, 실제로 층이 시야에서 사라지는
  // 마지막 0.6° 만 남깁니다.
  // 지평선에서 위로 0.23° 만 남깁니다. 시작점을 지면과 같은 선(uHorizonSinE)에
  // 두는 것이 핵심입니다 — 예전에는 여기가 0.17° 로 지면보다 위에 있어
  // 둘 사이가 벌어졌습니다.
  // ⚠ 아래 층(운해)이 있으면 끕니다. 켜 두면 지평선 아래를 0 으로 만들어
  //   운해를 통째로 지우고, 지평선 바로 위에는 구름바다에 검은 줄을 긋습니다.
  float horizonFade = anyLayerBelow ? 1.0 : smoothstep(uHorizonSinE, uHorizonSinE + 0.004, sinE);
  float accPre = acc;
  acc *= horizonFade;

  // ── 구름 속 (§93) ──────────────────────────────────────────────────────
  //
  // 산 위가 구름 속이면 그 구름이 **눈앞에서부터** 시야를 덮습니다. 예전에는
  // 덱 속에서도 머리 위 구름만 그리고 안개는 그리지 않았습니다(§82.3).
  //
  // 불투명도는 시선이 구름을 빠져나가거나(윗면·밑면) 땅에 닿을 때까지의 거리로
  // 1 − exp(−β·d). β 는 층의 소광(TAUK_*)에 관측 고도 운량을 곱한 것이라 새 상수가
  // 없습니다. 밝기는 위 2-stream 의 내부 평균복사와 **같은 식**을 관측자 깊이에서
  // 푼 것입니다 — 윗면에 가까울수록 밝고, 밑면에 가까울수록 어둡습니다.
  if (uFogBeta > 0.0 && uObserverAltKm > uFogBaseKm && uObserverAltKm < uFogTopKm
      && (uPassMode < 0.5 || uPassMode > 1.5)) {
    float hObs = uObserverAltKm;
    float dExit = sinE > 1e-4 ? (uFogTopKm - hObs) / sinE
                : (sinE < -1e-4 ? (hObs - uFogBaseKm) / (-sinE) : 1e3);
    // 98% 를 넘는 거리 너머는 걷지 않습니다.
    float dMax = min(dExit, 4.0 / uFogBeta);
    float dHit = slab_terrainHitSeg(dir, sinE, cosE, 0.0, dMax);
    // DEM 이 없으면 평평한 발밑(눈높이)만 압니다.
    if (dHit > 1e8 && uDemValid < 0.5 && uDemFarValid < 0.5 && sinE < -1e-4)
      dHit = (uEyeHeightM / 1000.0) / (-sinE);
    float fogA = 1.0 - exp(-uFogBeta * min(dExit, dHit));
    float tpF = (1.0 - uCloudAsym) * uFogBeta * (uFogTopKm - uFogBaseKm);
    float xdF = (1.0 - uCloudAsym) * uFogBeta * (uFogTopKm - hObs);
    float kkF = (1.0 - uCloudGroundAlb) / (2.0 + tpF * (1.0 - uCloudGroundAlb));
    vec3 FdnF = uFogBeam * max(uSunDir.y, 0.0) + (uCloudModel > 0.5 ? ambHemi : ambBase);
    vec3 Lfog = FdnF * max(0.0, 1.0 - kkF * (1.0 + xdF));
    Lfog *= slab_expoNorm(uFogBeam, uSunDir.y, uCloudModel > 0.5 ? ambHemi : ambBase);   // §104
    // 구름 쪽은 지평선 페이드를 먹인 알파로 다시 미리곱합니다.
    vec3 linC = accPre > 1e-4 ? lin / accPre * acc : vec3(0.0);
    lin = Lfog * fogA + linC * (1.0 - fogA);
    acc = fogA + acc * (1.0 - fogA);
  }

  if (acc <= 0.002) discard;

  vec3 disp = atm_display(lin / max(acc, 1e-4), uSaturation, uDispSunAltDeg);
  if (uDataOut > 2.5) {
    // 자료 3: **톤 곡선 전** 선형 휘도 — log2 를 −12~+4 에 8비트로(한 칸 1/16 조리개).
    // 사진과 견줄 때 톤 곡선이 어두운 쪽을 얼마나 벌리는지 가르려고 둡니다(§88).
    float Y = dot(lin / max(acc, 1e-4), vec3(0.2126, 0.7152, 0.0722));
    gl_FragColor = vec4(clamp((log2(max(Y, 1e-6)) + 12.0) / 16.0, 0.0, 1.0), 0.0, 0.0, acc);
    return;
  }
  if (uDataOut > 1.5) {
    // 자료 2: 두께(0~40 → 0~1) · 층(0 상 · 0.5 중 · 1 저) · 태양비 · 알파
    gl_FragColor = vec4(min(tauAcc, 40.0) / 40.0,
                        layerAcc / max(acc, 1e-4) * 0.5,
                        sunAcc / max(acc, 1e-4),
                        acc);
    return;
  }
  if (uDataOut > 0.5) {
    // 자료 1: 표시색(미합성) · 알파. 합성은 스타일 패스가 합니다.
    gl_FragColor = vec4(disp, acc);
    return;
  }
  gl_FragColor = vec4(disp * acc, acc);
}
`;

export interface CloudSlabHandle {
  mesh: THREE.Mesh;
  /**
   * **발밑 운해·구름 속 안개 전용** 두 번째 판(§96). `setSplitPasses(true)` 를 부르면 `mesh` 는
   * 관측자 위 층만, 이것은 아래 층과 안개만 그립니다. 앱은 `mesh` 를 산보다 먼저, 이것을 산보다
   * 나중에 합성합니다 — 그래야 하늘 구름은 산 뒤로, 운해는 먼 골짜기 앞으로 갑니다. uniform 은
   * `mesh` 와 **같은 객체**를 나눠 씁니다(uPassMode 만 따로).
   */
  meshBelow: THREE.Mesh;
  setSplitPasses: (on: boolean) => void;
  material: THREE.ShaderMaterial;
  /** 운량장. 검증 하네스가 내용을 읽습니다. */
  coverTex: THREE.DataTexture;
  /**
   * 저층 운형장 — R 채널에 0(적운형)~1(층운형)을 담습니다. `coverTex`와
   * 같은 크기·매핑을 씁니다(계획 33절 근거리 볼륨).
   */
  genusTex: THREE.DataTexture;
  /** 운량장이 덮는 반경 (km) */
  rangeKm: number;
  /**
   * 층 높이(km)를 예보 단면에 맞춰 덮습니다(`utils/cloudProfile.ts`).
   * 안 부르면 예전 상수 그대로입니다.
   */
  setLayerAltitudesKm: (lowKm: number, midKm: number, highKm: number) => void;
  /** 저층 덱 밑면·윗면(km, 해발, §82). 모르면 null — 위에서 볼 면이 hBase 로 돌아갑니다. */
  setLowDeckKm: (baseKm: number | null | undefined, topKm: number | null | undefined) => void;
  /**
   * 관측자를 감싼 구름(§93, `cloudProfile.cloudAround`). null 이면 안개를 끕니다.
   * 소광은 그 높이 층(저·중·상)의 TAUK 에 운량을 곱해 냅니다.
   */
  setInCloud: (c: { cover: number; baseKm: number; topKm: number } | null) => void;
  /**
   * 지형 높이장(§83·§84) — 구름을 땅이 가리게 합니다. TerrainField 와 **같은 패치**
   * (촘촘한 것, 성긴 것)를 넘기세요. null 이면 가림이 꺼집니다. 렌더러를 주면
   * 지형 지평선을 한 번 구워 올려다보는 하늘의 걸음질을 줄입니다(없으면 다 걷습니다).
   */
  setDemPatches: (patch: DemPatch | null, farPatch: DemPatch | null, renderer?: THREE.WebGLRenderer) => void;
  /**
   * DEM 이 없을 때 쓰는 능선 밴드(§87). `createTerrainBands` 에 준 것과 같은 값을
   * 넘기세요. DEM 패치가 있으면 셰이더가 이것을 안 씁니다.
   */
  setBandHorizon: (
    bandAngles: number[][] | null | undefined, distancesKm: number[] | null | undefined,
    maxVisualDeg: number, seaDipDeg: number,
  ) => void;
  dispose: () => void;
}

export function createCloudSlab(opts: {
  rangeKm?: number;
  texSize?: number;
  /** 층별 노이즈 셀 크기(km) 덮어쓰기. 하네스가 값을 훑을 때 씁니다. */
  cellKm?: Partial<Record<LayerKey, number>>;
  /** 층별 두께→광학두께 배율 덮어쓰기. */
  tauK?: Partial<Record<LayerKey, number>>;
  /** 모양장의 층별 유효 중심. 훑어보려고 열어 둡니다 (기본 SHAPE_MEAN). */
  shapeMean?: Partial<Record<LayerKey, number>>;
  /** 모양장의 층별 유효 폭 ÷ uShapeSigma (기본 SHAPE_SIG_RATIO). */
  shapeSigRatio?: Partial<Record<LayerKey, number>>;
} = {}): CloudSlabHandle {
  const rangeKm = opts.rangeKm ?? SLAB_RANGE_KM;
  const size = opts.texSize ?? SLAB_TEX;
  const cell = { ...CELL_KM, ...(opts.cellKm ?? {}) };
  const tau = { ...TAU_K, ...(opts.tauK ?? {}) };
  const shapeMean = { ...SHAPE_MEAN, ...(opts.shapeMean ?? {}) };
  const shapeSigRatio = { ...SHAPE_SIG_RATIO, ...(opts.shapeSigRatio ?? {}) };

  const data = new Uint8Array(size * size * 4);
  const coverTex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  coverTex.minFilter = THREE.LinearFilter;
  coverTex.magFilter = THREE.LinearFilter;
  coverTex.wrapS = THREE.ClampToEdgeWrapping;
  coverTex.wrapT = THREE.ClampToEdgeWrapping;
  coverTex.needsUpdate = true;

  // coverTex와 같은 크기·같은 sqrt 매핑(slab_coverUv)을 씁니다 — 같은
  // 방향의 조회가 두 텍스처에서 같은 텍셀을 가리켜야 근거리 볼륨의 운량과
  // 운형이 서로 어긋나지 않습니다.
  const genusData = new Uint8Array(size * size * 4);
  const genusTex = new THREE.DataTexture(genusData, size, size, THREE.RGBAFormat);
  genusTex.minFilter = THREE.LinearFilter;
  genusTex.magFilter = THREE.LinearFilter;
  genusTex.wrapS = THREE.ClampToEdgeWrapping;
  genusTex.wrapT = THREE.ClampToEdgeWrapping;
  genusTex.needsUpdate = true;

  // §105 직달 표 — updateCloudSlab 이 해가 움직일 때만 다시 굽습니다.
  const beamLutData = new Uint8Array(BEAM_LUT_N * 3 * 4);
  const beamLut = new THREE.DataTexture(beamLutData, BEAM_LUT_N, 3, THREE.RGBAFormat);
  beamLut.minFilter = THREE.LinearFilter;
  beamLut.magFilter = THREE.LinearFilter;
  beamLut.wrapS = THREE.ClampToEdgeWrapping;
  beamLut.wrapT = THREE.ClampToEdgeWrapping;
  beamLut.needsUpdate = true;

  // ⚠ ALT_* 는 더 이상 치환하지 않습니다 — uLayerAltKm uniform 입니다.
  const frag = FRAG
    .replace(/CELL_LOW/g, cell.low.toFixed(2))
    .replace(/CELL_MID/g, cell.mid.toFixed(2))
    .replace(/CELL_HIGH/g, cell.high.toFixed(2))
    .replace(/TAUK_LOW/g, tau.low.toFixed(2))
    .replace(/TAUK_MID/g, tau.mid.toFixed(2))
    .replace(/TAUK_HIGH/g, tau.high.toFixed(2))
    .replace(/SHAPE_MEAN_LOW/g, shapeMean.low.toFixed(4))
    .replace(/SHAPE_MEAN_MID/g, shapeMean.mid.toFixed(4))
    .replace(/SHAPE_MEAN_HIGH/g, shapeMean.high.toFixed(4))
    .replace(/SHAPE_SIGR_LOW/g, shapeSigRatio.low.toFixed(4))
    .replace(/SHAPE_SIGR_MID/g, shapeSigRatio.mid.toFixed(4))
    .replace(/SHAPE_SIGR_HIGH/g, shapeSigRatio.high.toFixed(4));

  let horizonTarget: THREE.WebGLRenderTarget | null = null;
  let bandTex: THREE.DataTexture | null = null;

  const material = new THREE.ShaderMaterial({
    uniforms: {
      ...makeTuningUniforms(),
      uRes: { value: new THREE.Vector2(1, 1) },
      uInvViewProj: { value: new THREE.Matrix4() },
      uCamPos: { value: new THREE.Vector3() },
      uHorizonSinE: { value: 0 },
      uObserverAltKm: { value: 0 },
      uLowDeckKm: { value: new THREE.Vector2(-1, -1) },
      // §83 지형 가림 — 패치는 setDemPatches 로 받습니다. 없으면 꺼진 것과 같습니다.
      ...makeDemUniforms(null),
      ...makeDemUniforms(null, 'demFar'),
      uTerrainOcclude: { value: 1 },
      uTerrainOccludeSky: { value: 1 },
      uHorizonTex: { value: null },
      uHorizonValid: { value: 0 },
      // §88 — 층 사이의 빛. 켭니다: 에너지 경계를 지키고(verify-two-deck), 앞으로 흩은
      // 햇빛을 릴리프에 방향째 씌운 뒤 사진 대조가 끈 것과 같은 34/37 입니다(§88.5).
      uInterLayer: { value: 1 },
      uBandTex: { value: null },
      uBandValid: { value: 0 },
      uEyeHeightM: { value: 1.6 },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunAltDeg: { value: 0 },
      uSunAzDeg: { value: 0 },
      uDispSunAltDeg: { value: 0 },
      uLightGain: { value: 1 },
      uSkyAdd: { value: new THREE.Vector3(0, 0, 0) },
      uFogBeta: { value: 0 },
      uPassMode: { value: 0 },
      uFogBaseKm: { value: -1 },
      uFogTopKm: { value: -1 },
      uFogBeam: { value: new THREE.Vector3(0, 0, 0) },
      uCityLight: { value: 1.0 },
      uBeamLow: { value: new THREE.Vector3(1, 1, 1) },
      uBeamMid: { value: new THREE.Vector3(1, 1, 1) },
      uBeamHigh: { value: new THREE.Vector3(1, 1, 1) },
      uCoverTex: { value: coverTex },
      uBeamLUT: { value: beamLut },
      uBeamLUTGain: { value: 0 },
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
      // 수직 체적 스텝 기본값 1 — 두 지표가 서로 반대로 움직여서 고른 값.
      //
      // 비스듬 경로 항을 넣자 3스텝이 명암폭에서는 앞섰습니다. 지평선
      // 광학두께가 최대 38배로 커지므로 그걸 나눠야 윗면·밑면 구조가
      // 살아나기 때문입니다. 그런데 **세로기울기는 크게 나빠집니다**:
      //
      //   태양 0°   1스텝  명암폭 95.8   세로기울기 0.667
      //             3스텝  명암폭 107.8  세로기울기 0.846
      //
      // 세로기울기는 "지평선쪽만 빛나면서" 를 직접 재는 값이고, 사용자가
      // 처음 감동했다고 꼽은 세 가지 중 첫 번째입니다 (계획 1절). 명암폭
      // 12% 를 얻자고 하늘이 다시 고르게 밝아지는 것은 남는 장사가
      // 아닙니다. 구조는 남겨 뒀으니 되살리려면 이 값만 올리면 됩니다.
      uVolSteps: { value: 1 },
      uSaturation: { value: 1 },
      uGenusTex: { value: genusTex },
      // 근거리 볼륨 (계획 27·33·35절). **기본은 끔입니다.**
      //
      // ⚠ 켜고 A/B(build-nf-seam-check.js)로 재보니 지평선 바로 위에
      // 회색 얼룩 띠가 생겼습니다 — 노을의 따뜻한 지평선과 위쪽 차가운
      // 구름 사이에 있어야 할 자리가 탁한 회색으로 뭉갭니다. 사용자가
      // "어두운 부분과 밝은 부분의 경계가 이상하다"고 짚은 것이 이것으로
      // 보이고, 회귀(34.4절: sunset-gap·photo-match)도 이 방향입니다.
      // 원인을 아직 못 갈랐습니다(35절) — 갈라질 때까지 예전에 검증된
      // 껍질 그대로 나가는 쪽이 낫습니다. 코드·유니폼은 그대로 두었으니
      // `nfEnabled:true` 로 언제든 다시 켜서 이어 갈 수 있습니다.
      uNfEnable: { value: 0 },
      uNfCapKm: { value: 22 },
      uNfViewSteps: { value: 28 },
      uNfShadowSteps: { value: 5 },
      // ── 구름 밝기의 바닥 셋 (계획 36절) ────────────────────────────
      //
      // 사용자가 실기기에서 "맑은 날인데 구름이 너무 어둡다" 고 짚었고,
      // 같은 순간 QR·사진으로 재니 **구름이 자기가 가린 하늘보다 어두웠습니다**
      // (구름밝기비 0.76~0.95, 1 을 넘어야 정상). 셋 다 구름을 흡수체처럼
      // 다루던 값이라 비흡수 산란체 쪽으로 옮겼습니다.
      //
      // ⚠ **주변광 바닥(amb)은 0.26 그대로 둡니다.** 셋 중 구름을 가장 크게
      // 밝히지만(+0.077), 그늘진 구름까지 같이 들어 올려 노을 실루엣을
      // 지웁니다 — 0.35 로만 올려도 verify-sunset-gap 의 태양 -3° 명암폭이
      // 88.4 로 문턱(90) 아래로 떨어집니다. 반대로 직달 쪽 둘(lit·ph)은
      // 햇빛 받는 면만 밝히므로 빛/그늘 대비가 보존됩니다.
      //
      // 캐노니컬 판정으로 고른 값입니다(내 훑기 습작의 노을 장면이 판정과
      // 달라 한 번 거짓말했습니다 — 36.4절):
      //
      //   구름밝기비 0.814 → 0.895 (화면 48°) · 0.760 → 0.945 (옆 90°)
      //   어두운쪽채도 0.359 → 0.415 (사진 0.44)
      //   노을 명암폭 92.2 → 103.3 (오히려 좋아짐) · 네 단언 모두 통과
      uCloudLitFloor: { value: 0.45 },
      uCloudAmbFloor: { value: 0.26 },
      uCloudPhaseFloor: { value: 0.90 },
      // 40절 — 0 이면 예전 삼항 합, 1 이면 보존산란 2-stream 슬랩 해.
      uCloudModel: { value: 1 },
      uCloudAsym: { value: 0.85 },      // 물방울 비대칭 인자 g (유사변환용)
      uCloudAniso: { value: 0.45 },     // 절단 후 잔여 비등방
      uCloudAnisoW: { value: 0.35 },
      uCloudGroundAlb: { value: 0.15 }, // 지면 알베도 (육지)
      uCloudSideLit: { value: 0.25 },   // 노멀이 못 담는 잔여 직달광
      uCloudFaceUp: { value: 0.65 },    // 높이장 노멀이 과소평가하는 옆면 보정
      // 41절 — 0 이면 예전(면적·두께가 같이 운량에 비례), 1 이면 문턱형.
      uShapeMode: { value: 1 },
      uShapeDepth: { value: 1.2 },      // 구름 한가운데의 광학 두께 배수
      uShapeEdge: { value: 0.70 },      // 가장자리 단면 (작을수록 칼같이 섬)
      uShapeSigma: { value: 0.16 },     // 모양장(빠른 잡음)의 표준편차
      // 층 높이(km). 밑값은 예전에 박아 쓰던 상수이고, 예보 단면이 오면
      // `setLayerAltitudesKm` 으로 덮습니다(utils/cloudProfile.ts).
      uLayerAltKm: { value: new THREE.Vector3(
        LAYER_ALTITUDE_KM.low, LAYER_ALTITUDE_KM.mid, LAYER_ALTITUDE_KM.high) },
      uFbmRot: { value: 1 },            // 41절 — fbm 옥타브 회전
      // 구름 군집 (계획 37절). 규모는 셀의 3배 — 저층 6km 입니다.
      // ⚠ 셀×7(14km)로는 **아무 일도 안 일어납니다.** 한 화면 안에서
      // 너무 천천히 변해 군집으로 안 보입니다(먼 하늘 구름각크기
      // 5.88° 그대로). 셀×3 에서 8.83° 로 커집니다.
      uClusterAmt: { value: 0.7 },
      uClusterMul: { value: 3.0 },
      // 구름을 비추는 아래쪽 하늘을 어느 고도에서 뜨는가 (계획 38절).
      uAmbDownDeg: { value: 12.0 },
      uDataOut: { value: 0 },
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
  // 두 번째 판 — 재질을 복제하되 uniform 항목은 **같은 객체**를 가리킵니다(세터들이 .value 만
  // 바꾸므로 한쪽을 고치면 양쪽에 들어갑니다). uPassMode 만 따로 둡니다.
  const materialBelow = material.clone();
  materialBelow.uniforms = { ...material.uniforms, uPassMode: { value: 2 } };
  materialBelow.depthTest = false;
  const meshBelow = new THREE.Mesh(geometry, materialBelow);
  meshBelow.frustumCulled = false;
  meshBelow.name = 'cloudSlabBelow';
  meshBelow.visible = false;

  return {
    mesh,
    meshBelow,
    setSplitPasses: (on: boolean) => {
      material.uniforms.uPassMode.value = on ? 1 : 0;
      // 나눠 그릴 때만 하늘 구름 판이 지형 깊이에 가려집니다(위 VERT 주석). 기본은 예전 그대로.
      material.depthTest = on;
      material.needsUpdate = true;
    },
    material,
    coverTex,
    genusTex,
    rangeKm,
    setLayerAltitudesKm: (lowKm, midKm, highKm) => {
      // 터무니없는 값이 오면 무시합니다 — 0 이나 음수가 들어가면 셰이더의
      // 고도 계산이 통째로 무너집니다.
      const okv = (v: number) => Number.isFinite(v) && v > 0.05 && v < 25;
      if (!okv(lowKm) || !okv(midKm) || !okv(highKm)) return;
      (material.uniforms.uLayerAltKm.value as THREE.Vector3).set(lowKm, midKm, highKm);
    },
    setDemPatches: (patch, farPatch, renderer) => {
      const put = (u: Record<string, { value: unknown }>) => {
        Object.entries(u).forEach(([k, v]) => {
          if (material.uniforms[k]) material.uniforms[k].value = v.value;
        });
      };
      put(makeDemUniforms(patch));
      put(makeDemUniforms(farPatch, 'demFar'));
      // 성긴 패치만 첨탑을 걷어냅니다 — TerrainField.setPatch 와 같은 규약.
      material.uniforms.uDemFarDespike.value = farPatch ? 1 : 0;
      // §84 지평선 굽기. 렌더러가 없거나 패치가 없으면 굽지 않고, 셰이더는 다 걷습니다.
      horizonTarget?.dispose();
      horizonTarget = null;
      material.uniforms.uHorizonValid.value = 0;
      material.uniforms.uHorizonTex.value = null;
      if (renderer && (patch || farPatch)) {
        horizonTarget = bakeHorizon(renderer, material.uniforms);
        material.uniforms.uHorizonTex.value = horizonTarget.texture;
        material.uniforms.uHorizonValid.value = 1;
      }
    },
    setBandHorizon: (bandAngles, distancesKm, maxVisualDeg, seaDipDeg) => {
      bandTex?.dispose();
      bandTex = null;
      material.uniforms.uBandValid.value = 0;
      material.uniforms.uBandTex.value = null;
      if (!bandAngles || !distancesKm || bandAngles.length === 0) return;
      bandTex = bakeBandHorizon(bandAngles, distancesKm, maxVisualDeg, seaDipDeg);
      material.uniforms.uBandTex.value = bandTex;
      material.uniforms.uBandValid.value = 1;
    },
    setLowDeckKm: (baseKm, topKm) => {
      // 모르면(null·NaN·뒤집힘) (-1,-1) — 셰이더가 §81 그대로 갑니다.
      const v = material.uniforms.uLowDeckKm.value as THREE.Vector2;
      const ok = baseKm != null && topKm != null && Number.isFinite(baseKm)
        && Number.isFinite(topKm) && topKm > baseKm && baseKm >= 0 && topKm < 6;
      if (ok) v.set(baseKm as number, topKm as number); else v.set(-1, -1);
    },
    setInCloud: (c) => {
      const un = material.uniforms;
      const ok = !!c && Number.isFinite(c.cover) && c.cover > 0 && Number.isFinite(c.baseKm)
        && Number.isFinite(c.topKm) && c.topKm > c.baseKm;
      if (!ok) { un.uFogBeta.value = 0; un.uFogBaseKm.value = -1; un.uFogTopKm.value = -1; return; }
      const midKm = (c!.baseKm + c!.topKm) / 2;
      const tauK = midKm < LAYER_BAND_KM.lowTop ? tau.low : (midKm < LAYER_BAND_KM.midTop ? tau.mid : tau.high);
      un.uFogBeta.value = Math.min(1, c!.cover) * tauK;
      un.uFogBaseKm.value = c!.baseKm;
      un.uFogTopKm.value = c!.topKm;
    },
    dispose: () => {
      geometry.dispose();
      material.dispose();
      materialBelow.dispose();
      coverTex.dispose();
      genusTex.dispose();
      beamLut.dispose();
      horizonTarget?.dispose();
      bandTex?.dispose();
    },
  };
}

/** 16비트 고도각 부호화 — HORIZON_BAKE_FRAG 와 같은 눈금. */
function encodeHorizonDeg(deg: number): [number, number] {
  const v = Math.round(Math.min(1, Math.max(0,
    (deg - Number(HORIZON_LO_DEG)) / Number(HORIZON_SPAN_DEG))) * 65535);
  return [v >> 8, v & 255];
}

/**
 * 능선 밴드의 **밴드 메시와 같은** 실루엣을 방위 칸마다 굽습니다(§87).
 * `TerrainRing.createTerrainBands` 의 보간(72분할, 분할점마다 각도 선형 보간,
 * 그 사이 선형)과 산 판정(수평선 침강 + 0.005°)을 그대로 따릅니다.
 */
export function bandHorizonAt(
  angles: number[], azDeg: number, maxVisualDeg: number, seaDipDeg: number,
): number | null {
  const SEG = 72;
  const vertex = (s: number) => {
    const azFrac = (((s % SEG) + SEG) % SEG) / SEG;
    const idx = azFrac * (angles.length - 1);
    const i0 = Math.floor(idx), i1 = Math.min(i0 + 1, angles.length - 1);
    const f = idx - i0;
    const raw = angles[i0] * (1 - f) + angles[i1] * f;
    return raw > -seaDipDeg + 0.005 ? Math.min(raw, maxVisualDeg) : null;
  };
  const x = (((azDeg % 360) + 360) % 360) / 360 * SEG;
  const s0 = Math.floor(x), t = x - s0;
  const a = vertex(s0), b = vertex(s0 + 1);
  if (a == null && b == null) return null;
  // 한쪽만 산이면 메시의 그 변은 수평선에서 산꼭대기로 선형으로 오릅니다.
  const lo = -seaDipDeg;
  const v = (a ?? lo) * (1 - t) + (b ?? lo) * t;
  return v > lo + 0.005 ? v : null;
}

function bakeBandHorizon(
  bandAngles: number[][], distancesKm: number[], maxVisualDeg: number, seaDipDeg: number,
): THREE.DataTexture {
  const rows = 3;
  const data = new Uint8Array(HORIZON_BINS * rows * 4);
  for (let j = 0; j < Math.min(rows, bandAngles.length); j++) {
    const angles = bandAngles[j];
    const dKm = distancesKm[j] ?? 0;
    if (!angles || angles.length === 0 || !(dKm > 0)) continue;
    for (let i = 0; i < HORIZON_BINS; i++) {
      const deg = bandHorizonAt(angles, (i + 0.5) / HORIZON_BINS * 360, maxVisualDeg, seaDipDeg);
      if (deg == null) continue;
      const [hi, lo] = encodeHorizonDeg(deg);
      const o = (j * HORIZON_BINS + i) * 4;
      data[o] = hi; data[o + 1] = lo;
      data[o + 2] = Math.min(255, Math.round(dKm * 2.5));   // 0~102km
      data[o + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, HORIZON_BINS, rows, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

/**
 * 지형 지평선을 한 줄 렌더 타깃에 굽습니다(§84). 구름 재질의 DEM 유니폼을
 * **그대로 공유**합니다 — 다른 높이를 보면 건너뛰면 안 되는 화소를 건너뜁니다.
 */
function bakeHorizon(
  renderer: THREE.WebGLRenderer,
  src: Record<string, THREE.IUniform>,
): THREE.WebGLRenderTarget {
  const target = new THREE.WebGLRenderTarget(HORIZON_BINS, 1, {
    format: THREE.RGBAFormat, type: THREE.UnsignedByteType,
    minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
    depthBuffer: false, generateMipmaps: false,
  });
  target.texture.wrapS = THREE.RepeatWrapping;
  const uniforms: Record<string, THREE.IUniform> = {};
  for (const k of Object.keys(src)) {
    if (k.startsWith('uDem') || k === 'uEyeHeightM') uniforms[k] = src[k];
  }
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: 'void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: HORIZON_BAKE_FRAG,
    depthTest: false, depthWrite: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  const scene = new THREE.Scene();
  scene.add(quad);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const prev = renderer.getRenderTarget();
  renderer.setRenderTarget(target);
  renderer.render(scene, cam);
  renderer.setRenderTarget(prev);
  quad.geometry.dispose();
  mat.dispose();
  return target;
}

/** 운량장을 굽는 데 필요한 것 — 방위·거리로 층 운량과 확신도를 답하는 함수. */
export interface CoverageSource {
  (azimuthDeg: number, distanceKm: number): {
    low: number; mid: number; high: number; confidence: number;
    /**
     * 저층 운형 — 0(적운형)~1(층운형), 근거리 볼륨이 씁니다(계획 33절).
     * 생략하면 0(적운형)으로 굽습니다 — 이 함수를 직접 구현한 예전
     * 호출부(하네스 습작들)가 이 값 없이도 그대로 컴파일·실행되게
     * 하려는 것입니다.
     */
    lowGenus?: number;
  };
}

/**
 * 운량장을 다시 굽습니다. **매 프레임 부르면 안 됩니다** — 128×128 이면
 * 16,384 회 조회라 수십 ms 가 듭니다. 기상이나 시각이 바뀔 때만 부르세요.
 *
 * 운형장(`genusTex`)도 같은 루프에서 같이 굽습니다 — 조회를 두 번 하면
 * 16,384 회가 배로 늡니다.
 */
export function bakeCloudSlabCoverage(handle: CloudSlabHandle, src: CoverageSource): void {
  const size = handle.coverTex.image.width as number;
  const data = handle.coverTex.image.data as Uint8Array;
  const genusData = handle.genusTex.image.data as Uint8Array;
  const R = handle.rangeKm;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      // uv → 제곱근 사상의 역: r = |p|, d = R·r²
      const px = ((i + 0.5) / size) * 2 - 1;
      const py = ((j + 0.5) / size) * 2 - 1;
      const r = Math.hypot(px, py);
      const k = (j * size + i) * 4;
      if (r > 1) {
        data[k] = data[k + 1] = data[k + 2] = data[k + 3] = 0;
        genusData[k] = genusData[k + 1] = genusData[k + 2] = 0; genusData[k + 3] = 255;
        continue;
      }
      const d = R * r * r;
      const az = r < 1e-6 ? 0 : (Math.atan2(px / r, -py / r) * 180) / Math.PI;
      const c = src((az + 360) % 360, d);
      data[k] = Math.max(0, Math.min(255, c.low * 255));
      data[k + 1] = Math.max(0, Math.min(255, c.mid * 255));
      data[k + 2] = Math.max(0, Math.min(255, c.high * 255));
      data[k + 3] = Math.max(0, Math.min(255, c.confidence * 255));
      const g = Math.max(0, Math.min(255, (c.lowGenus ?? 0) * 255));
      genusData[k] = g; genusData[k + 1] = g; genusData[k + 2] = g; genusData[k + 3] = 255;
    }
  }
  handle.coverTex.needsUpdate = true;
  handle.genusTex.needsUpdate = true;
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
  /** 수직 체적 스텝 수 상한 (기본 1). 올리면 층을 여러 겹으로 나눕니다. */
  volSteps?: number;
  /**
   * 근거리 볼륨 켬/끔 (기본 **끔** — 계획 35절, 노을 경계에 회색 얼룩
   * 띠가 생기는 결함을 원인을 갈라내기 전까지는 예전 껍질로 갑니다).
   * `true`로 켜면 A/B 비교나 이어지는 수정 작업에 씁니다.
   */
  nfEnabled?: boolean;
  /** 근거리 볼륨이 담당하는 수평 반경 (km, 기본 22 — 계획 33절에서 검증한 값). */
  nfCapKm?: number;
  /** 근거리 볼륨 시선 스텝 수 상한 (기본 28, 최대 48). 내리면 가벼워집니다. */
  nfViewSteps?: number;
  /** 근거리 볼륨 그림자 스텝 수 상한 (기본 5, 최대 8). */
  nfShadowSteps?: number;
  /** 두꺼운 표본의 직달광 바닥 (기본 0.70). 올리면 햇빛 받는 구름면이 밝아집니다. */
  cloudLitFloor?: number;
  /** 구름이 받는 하늘 확산광의 바닥 (기본 0.55). 올리면 구름 전체가 밝아집니다. */
  cloudAmbFloor?: number;
  /** 구름 위상함수의 바닥 (기본 0.90). 올리면 옆에서 본 구름이 밝아집니다. */
  cloudPhaseFloor?: number;
  /** 40절 — 'twoStream' 이면 보존산란 슬랩 해, 'legacy' 면 예전 삼항 합. */
  cloudModel?: 'legacy' | 'twoStream';
  cloudAsym?: number;
  cloudAniso?: number;
  cloudAnisoW?: number;
  cloudGroundAlb?: number;
  cloudSideLit?: number;
  cloudFaceUp?: number;
  /** 41절 — 'threshold' 면 면적은 운량이·두께는 물리가 정합니다. */
  cloudShape?: 'legacy' | 'threshold';
  shapeDepth?: number;
  shapeEdge?: number;
  shapeSigma?: number;
  fbmRotate?: boolean;
  /** 구름 군집 세기 (0 = 없음). 셀보다 큰 규모의 덩어리를 만듭니다. */
  clusterAmt?: number;
  /** 군집 규모 = 셀 크기 × 이 값 (기본 3 → 저층 6km). */
  clusterMul?: number;
  /** 구름을 비추는 아래쪽 하늘의 표본 고도 (기본 12°). 낮출수록 노을빛을 받습니다. */
  ambDownDeg?: number;
  /** 43절 — 0 보통 · 1 표시색+알파 · 2 (두께, 층, 태양비, 알파). 스타일 보드용. */
  dataOut?: number;
  visible: boolean;
}

/** 매 프레임 부르는 쪽. 카메라와 태양만 갱신하므로 값쌉니다. */
export function updateCloudSlab(handle: CloudSlabHandle, u: CloudSlabUpdate): void {
  handle.mesh.visible = u.visible;
  handle.meshBelow.visible = false;
  if (!u.visible) return;
  const uni = handle.material.uniforms;

  (uni.uRes.value as THREE.Vector2).set(u.widthPx, u.heightPx);
  u.camera.updateMatrixWorld();
  // 화면 → 세계. 광선 복원에 씁니다.
  (uni.uInvViewProj.value as THREE.Matrix4)
    .multiplyMatrices(u.camera.projectionMatrix, u.camera.matrixWorldInverse)
    .invert();
  (uni.uCamPos.value as THREE.Vector3).setFromMatrixPosition(u.camera.matrixWorld);
  // 지면(TerrainRing 의 setGroundHorizon)과 **같은 식**으로 지평선을 구합니다.
  // 둘이 어긋나면 그 차이가 그대로 하늘이 비치는 띠가 됩니다.
  uni.uHorizonSinE.value = -Math.sin(
    (seaHorizonDipDeg(u.atmosphere.observerElevM ?? 0) * Math.PI) / 180,
  );
  // 관측자 해발 고도 — 구름층 위에 서 있는지를 셰이더가 알아야 합니다(운해).
  uni.uObserverAltKm.value = Math.max(0, u.atmosphere.observerElevM ?? 0) / 1000;

  // ── 광원 고르기 (§92) ────────────────────────────────────────────────
  // 셰이더는 광원 하나만 계산합니다. 박명과 달빛 중 하늘을 더 밝히는 쪽을 넣고,
  // 달이면 햇빛과 **같은 식**에 이득만 곱합니다(달빛은 햇빛을 되비춘 것).
  const ml = u.moonDir && u.moonAltDeg !== undefined && u.moonIllum !== undefined
    ? moonLight(u.sunAltDeg, u.moonAltDeg, u.moonIllum, u.atmosphere)
    : { gain: 0, useMoon: false };
  const lightByMoon = ml.useMoon && !!u.moonDir && u.moonAltDeg !== undefined;
  const lightAlt = lightByMoon ? u.moonAltDeg! : u.sunAltDeg;
  (uni.uSunDir.value as THREE.Vector3).copy(lightByMoon ? u.moonDir! : u.sunDir).normalize();
  uni.uSunAltDeg.value = lightAlt;
  uni.uSunAzDeg.value = u.sunAzDeg;
  uni.uDispSunAltDeg.value = u.sunAltDeg;
  uni.uLightGain.value = lightByMoon ? ml.gain : 1;
  (uni.uSkyAdd.value as THREE.Vector3).set(
    lightByMoon ? NIGHT_SKY.r : 0, lightByMoon ? NIGHT_SKY.g : 0, lightByMoon ? NIGHT_SKY.b : 0);
  uni.uCityLight.value =
    typeof u.cityLight === 'number' ? Math.max(0, Math.min(1, u.cityLight))
      : u.cityLight === false ? 0.0 : 1.0;

  // ⚠ 셰이더가 쓰는 높이와 **같은 값**이어야 합니다. 예전에는 여기만 상수를
  //   보고 있어서, 높이를 바꾸면 빛줄기 색만 옛 높이로 남았을 것입니다.
  const alt = uni.uLayerAltKm.value as THREE.Vector3;
  // ── 직달을 하늘빛과 같은 눈금으로 (§104) ──────────────────────────────
  //
  // `beamFor`(= beamAtAltitude)는 대기 밖 햇빛을 1 로 둔 **투과율**이고, 셰이더의 하늘빛
  // (atm_skyRadiance)은 산란에 skyExposure(22)를 곱한 복사휘도입니다. 그대로 더하면 하늘빛이
  // 스무 배 넘게 셉니다 — 맑은 날 수평면 확산 비율이 해 60° 에서 0.75(맑은 하늘 모형 약 0.11),
  // 해쪽 구름 옆면의 직달 몫이 해 +5° 에도 2% 였습니다. 그래서 노을 구름이 붉은 직달이 아니라
  // 하늘빛으로 칠해졌고, 해쪽 먼 구름이 직달을 막아도(§103) 화면이 거의 안 바뀌었습니다.
  // 지형이 먼저 찾아 쓰던 같은 눈금(SOLAR_BEAM_SCALE, 맑은 하늘 직달/확산 비에서 역산)을
  // 씁니다. 달빛도 같은 식이라 같이 곱합니다(하늘빛 쪽도 같은 skyExposure 를 탑니다).
  const beamOf = (km: number): RGB => {
    const b = lightByMoon ? beamAtAltitude(lightAlt, km, u.atmosphere) : u.beamFor(km);
    const k = BEAM_TO_SLAB * (lightByMoon ? ml.gain : 1);
    return { r: b.r * k, g: b.g * k, b: b.b * k };
  };
  const bl = beamOf(alt.x);
  const bm = beamOf(alt.y);
  const bh = beamOf(alt.z);
  (uni.uBeamLow.value as THREE.Vector3).set(bl.r, bl.g, bl.b);
  (uni.uBeamMid.value as THREE.Vector3).set(bm.r, bm.g, bm.b);
  (uni.uBeamHigh.value as THREE.Vector3).set(bh.r, bh.g, bh.b);
  // §105 — 자리마다 다른 해 고도의 직달 표. 해(또는 달)가 0.01° 넘게 움직였거나 층 높이·대기가
  // 바뀌었을 때만 다시 굽습니다(층당 64번 beamAtAltitude). 호출부가 넘긴 beamFor 를 존중하려고
  // d=0 에서 beamFor 와 같아지게 채널별 비를 곱합니다(보통은 1).
  {
    const lutTex = uni.uBeamLUT.value as THREE.DataTexture;
    const key = [lightAlt.toFixed(2), alt.x.toFixed(3), alt.y.toFixed(3), alt.z.toFixed(3),
      bl.r.toFixed(6), bm.r.toFixed(6), bh.r.toFixed(6), u.atmosphere.betaMie, u.atmosphere.elevScale,
      u.atmosphere.observerElevM ?? 0].join('|');
    if ((lutTex.userData as any).key !== key) {
      (lutTex.userData as any).key = key;
      const d = lutTex.image.data as Uint8Array;
      const rows: [number, RGB][] = [[alt.z, bh], [alt.y, bm], [alt.x, bl]];   // 행 0 상층 · 1 중층 · 2 저층
      const enc = (v: number) => (v < 2 ** -16 ? 0 : Math.max(1, Math.min(255, Math.round((Math.log2(v) + 16) / 16 * 255))));
      // §106 — 표는 광선 적분(grazingRay)으로. 높이는 해면 기준(관측 고도 + 층 높이).
      // 호출부 beamFor 가 표준 식(beamAtAltitude)에서 벗어난 만큼(보통 1)은 채널별로 그대로 곱합니다.
      const obsKmSea = Math.max(0, u.atmosphere.observerElevM ?? 0) / 1000;
      rows.forEach(([km, b0], row) => {
        const ref = beamAtAltitude(lightAlt, km, u.atmosphere);
        const k = BEAM_TO_SLAB * (lightByMoon ? ml.gain : 1);
        const ratio = (c: 'r' | 'g' | 'b') => (ref[c] > 1e-9 ? b0[c] / (ref[c] * k) : 1);
        const rr = ratio('r'), rg = ratio('g'), rb = ratio('b');
        for (let i = 0; i < BEAM_LUT_N; i++) {
          const dDeg = -BEAM_LUT_SPAN + (2 * BEAM_LUT_SPAN * i) / (BEAM_LUT_N - 1);
          const b = beamGrazing(lightAlt + dDeg, obsKmSea + km, u.atmosphere);
          const o = (row * BEAM_LUT_N + i) * 4;
          d[o] = enc(b.r * rr); d[o + 1] = enc(b.g * rg); d[o + 2] = enc(b.b * rb);
          d[o + 3] = Math.max(0, Math.min(255, Math.round(b.refrDeg / 2 * 255)));
        }
      });
      lutTex.needsUpdate = true;
    }
    uni.uBeamLUTGain.value = BEAM_TO_SLAB * (lightByMoon ? ml.gain : 1);
  }
  // 두 번째 판(§96)은 그릴 것이 있을 때만 켭니다 — 관측자 아래 층이 있거나 구름 속일 때.
  // "아래" 는 셰이더와 같은 식: 저층은 덱 윗면(모르면 층 높이), 중·상층은 층 높이.
  if (uni.uPassMode.value > 0.5) {
    const obsKm = uni.uObserverAltKm.value as number;
    const lowDeck = uni.uLowDeckKm.value as THREE.Vector2;
    const lowSurf = lowDeck.y > 0 ? Math.max(lowDeck.y, alt.x) : alt.x;
    const fogOn = (uni.uFogBeta.value as number) > 0
      && obsKm > (uni.uFogBaseKm.value as number) && obsKm < (uni.uFogTopKm.value as number);
    handle.meshBelow.visible = fogOn || obsKm > lowSurf || obsKm > alt.y || obsKm > alt.z;
  }
  // 구름 속 안개가 받는 직달광 — 관측 고도에서(§93). 안개가 꺼져 있으면 안 구합니다.
  if ((uni.uFogBeta.value as number) > 0) {
    const bf = beamOf(Math.max(0, u.atmosphere.observerElevM ?? 0) / 1000);
    (uni.uFogBeam.value as THREE.Vector3).set(bf.r, bf.g, bf.b);
  }

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
  uni.uVolSteps.value = u.volSteps ?? 1;
  // 기본 끔 — 재질 기본값과 같은 이유(위 uNfEnable 주석, 계획 35절).
  uni.uNfEnable.value = u.nfEnabled === true ? 1 : 0;
  uni.uNfCapKm.value = u.nfCapKm ?? 22;
  uni.uNfViewSteps.value = u.nfViewSteps ?? 28;
  uni.uNfShadowSteps.value = u.nfShadowSteps ?? 5;
  uni.uCloudLitFloor.value = u.cloudLitFloor ?? 0.45;
  uni.uCloudAmbFloor.value = u.cloudAmbFloor ?? 0.26;
  uni.uCloudPhaseFloor.value = u.cloudPhaseFloor ?? 0.90;
  uni.uCloudModel.value = u.cloudModel === 'legacy' ? 0 : 1;
  uni.uCloudAsym.value = u.cloudAsym ?? 0.85;
  uni.uCloudAniso.value = u.cloudAniso ?? 0.45;
  uni.uCloudAnisoW.value = u.cloudAnisoW ?? 0.35;
  uni.uCloudGroundAlb.value = u.cloudGroundAlb ?? 0.15;
  uni.uCloudSideLit.value = u.cloudSideLit ?? 0.25;
  uni.uCloudFaceUp.value = u.cloudFaceUp ?? 0.65;
  uni.uShapeMode.value = u.cloudShape === 'legacy' ? 0 : 1;
  uni.uShapeDepth.value = u.shapeDepth ?? 1.2;
  uni.uShapeEdge.value = u.shapeEdge ?? 0.70;
  uni.uShapeSigma.value = u.shapeSigma ?? 0.16;
  uni.uFbmRot.value = u.fbmRotate === false ? 0 : 1;
  uni.uClusterAmt.value = u.clusterAmt ?? 0.7;
  uni.uClusterMul.value = u.clusterMul ?? 3.0;
  // ── 아래쪽 주변광 표본 고도는 **태양을 따라 내려갑니다** (계획 38절) ──
  //
  // 낮에는 12°가 맞습니다(태양 0°에서도 그 고도가 따뜻함 +0.756). 그런데
  // 해가 지면 따뜻한 띠가 0~6°로 얇게 내려앉아 12°는 이미 파랗습니다
  // (태양 -3°에서 -0.325). 저층 구름은 그 시각 직달광이 0.0006 까지 죽어
  // 이 표본만으로 칠해지므로, 12°를 고집하면 노을 구름이 남색이 됩니다.
  //
  // 고정 6°로도 고쳐지지만 낮까지 같이 바뀝니다. 태양 고도를 따라가면
  // **낮은 손대지 않고** 박명만 고칠 수 있습니다.
  const _ss = (e0: number, e1: number, x: number) => {
    const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  };
  uni.uAmbDownDeg.value = u.ambDownDeg ?? (12.0 - 8.0 * _ss(6, -4, u.sunAltDeg));
  uni.uDataOut.value = u.dataOut ?? 0;
}

/**
 * 이미 풀린 하늘 기둥(`LayerSample[]`)에서 운량장 원천을 만듭니다.
 *
 * 앱의 타임라인은 팬을 들고 있지 않고 재구성된 기둥만 넘겨줍니다. 그래서
 * (방위, 거리)로 이중선형 조회하는 원천을 여기서 만듭니다.
 *
 * ⚠ **천정 부챗살의 정체가 여기 있었습니다(§101).** 예전 주석은 "직교 좌표
 * 텍스처에 구우니 중심 텍셀이 하나라 바람개비가 사라진다" 고 적었지만 틀렸습니다.
 * 텍셀마다 `src(방위, 거리)` 를 부르므로, 맨 안쪽 고리보다 가까운 텍셀은 거리
 * 클램프로 **그 방위의** 고리 값을 받았습니다. 기둥의 맨 윗 고도는 69.6°(8단
 * 등입체각)라 그 고리가 상층 4.1km·중층 1.7km 에 있고, 그 안쪽 — 고도 70° 위
 * 하늘 전체 — 에서 24방위의 서로 다른 값이 천정 한 점으로 모였습니다.
 *
 * 이제 맨 안쪽 고리 안에서는 **공간 해상도를 그 고리의 것으로 고정**합니다:
 * 거리 d 에서 방위 창을 (d0/d − 1) 표본 폭으로 넓혀 평균합니다(d0 = 고리 거리). 고리에서는
 * 창 0(그 값 그대로, 이음매 없음), d0/25 안쪽에서는 한 바퀴 전체 평균 — 천정에서 한 값이 됩니다.
 * 그 사이의 무늬 폭은 고리의 표본 간격(상층 약 1km)을 유지하고 중심으로 좁아지지
 * 않습니다.
 */
export function coverageFromSamples(
  samples: {
    layer: LayerKey; azimuthDeg: number; distanceKm: number; cover: number; confidence: number;
    /** 저층 운형 판정 입력 (계획 33절) — `LayerSample`이 이미 들고 있는 값입니다. */
    precipMmH?: number; humidityPct?: number; lowPct?: number; highPct?: number;
  }[]
): CoverageSource {
  type Row = { az: number[]; dist: number[]; cover: Float32Array; conf: Float32Array; genus?: Float32Array };
  const byLayer: Record<string, Row> = {};

  for (const key of ['low', 'mid', 'high'] as LayerKey[]) {
    const mine = samples.filter(s => s.layer === key);
    if (mine.length === 0) continue;
    const az = Array.from(new Set(mine.map(s => s.azimuthDeg))).sort((a, b) => a - b);
    const dist = Array.from(new Set(mine.map(s => s.distanceKm))).sort((a, b) => a - b);
    const cover = new Float32Array(az.length * dist.length);
    const conf = new Float32Array(az.length * dist.length);
    // 저층만 운형이 필요합니다(근거리 볼륨이 저층만 담당). 방향마다 다른
    // 씨앗을 줘 문턱 경계 판정(적운/층적운)이 모든 방위에서 똑같이 튀지
    // 않게 합니다 — CloudDeck 등 다른 곳의 방향별 씨앗과 같은 관례입니다.
    const genus = key === 'low' ? new Float32Array(az.length * dist.length) : undefined;
    const ai = new Map(az.map((v, i) => [v, i]));
    const di = new Map(dist.map((v, i) => [v, i]));
    for (const s of mine) {
      const i = ai.get(s.azimuthDeg)!, j = di.get(s.distanceKm)!;
      const idx = j * az.length + i;
      cover[idx] = s.cover;
      conf[idx] = s.confidence;
      if (genus) {
        const seed = ((Math.sin(s.azimuthDeg * 12.9898 + s.distanceKm * 0.037 + 17.3) * 43758.5453) % 1 + 1) % 1;
        genus[idx] = lowLayerGenus(
          s.cover,
          { precipitation: s.precipMmH, humidity: s.humidityPct, lowPct: s.lowPct ?? s.cover * 100, highPct: s.highPct ?? 0 },
          seed
        );
      }
    }
    byLayer[key] = { az, dist, cover, conf, genus };
  }

  const lookup = (row: Row | undefined, azDeg: number, distKm: number) => {
    if (!row) return { c: 0, f: 0, g: 0 };
    const { az, dist, cover, conf, genus } = row;
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
    // 맨 안쪽 고리보다 가까우면 그 고리를 방위로 평균합니다(위 머리말, §101).
    const dIn = dist[0];
    if (distKm < dIn && nA > 1) {
      // 창 폭(표본 수). 고리에서 0(그 값 그대로 — 이음매 없음), 안으로 갈수록 넓어집니다.
      const width = distKm > 1e-9 ? dIn / distKm - 1 : Infinity;
      const ring = (arr: Float32Array) => {
        if (width >= nA) {
          let acc = 0;
          for (let i = 0; i < nA; i++) acc += arr[i];
          return acc / nA;
        }
        // 고리 값을 방위로 선형 보간한 주기 함수를 [u - w/2, u + w/2] 에서 평균합니다.
        const u = a0 + tA;
        const steps = Math.max(2, Math.ceil(width * 4));
        let acc = 0;
        for (let k = 0; k <= steps; k++) {
          const x = u - width / 2 + (width * k) / steps;
          const f = Math.floor(x);
          const i0 = ((f % nA) + nA) % nA, i1 = (i0 + 1) % nA;
          const t = x - f;
          const v = arr[i0] * (1 - t) + arr[i1] * t;
          acc += (k === 0 || k === steps ? 0.5 : 1) * v;
        }
        return acc / steps;
      };
      return { c: ring(cover), f: ring(conf), g: genus ? ring(genus) : 0 };
    }
    const mix = (arr: Float32Array) =>
      (at(arr, a0, d0) * (1 - tA) + at(arr, a1, d0) * tA) * (1 - tD) +
      (at(arr, a0, d1) * (1 - tA) + at(arr, a1, d1) * tA) * tD;
    return { c: mix(cover), f: mix(conf), g: genus ? mix(genus) : 0 };
  };

  return (azimuthDeg: number, distanceKm: number) => {
    const lo = lookup(byLayer.low, azimuthDeg, distanceKm);
    const mi = lookup(byLayer.mid, azimuthDeg, distanceKm);
    const hi = lookup(byLayer.high, azimuthDeg, distanceKm);
    return {
      low: lo.c, mid: mi.c, high: hi.c,
      confidence: Math.max(lo.f, mi.f, hi.f),
      lowGenus: lo.g,
    };
  };
}
