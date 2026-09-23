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
import { ATMOSPHERE_GLSL, makeTuningUniforms, type AtmosphereParams } from '../../utils/atmosphere';
import { LAYER_ALTITUDE_KM, type LayerKey } from '../../utils/skyColumn';
import type { LayerWinds } from '../../utils/weather';
import type { RGB } from '../../utils/sunsetPhysics';
import { lowLayerGenus } from '../../utils/cloudPresets';
// ⚠ 지평선은 **지면과 같은 함수**로 구합니다. 식을 복사해 두면 한쪽만
// 바뀌었을 때 그 차이가 그대로 하늘이 비치는 띠가 됩니다.
import { seaHorizonDipDeg } from './TerrainRing';
import { DEM_GLSL, demGlsl, makeDemUniforms, type DemPatch } from '../../utils/demTiles';

/** 운량장이 덮는 반경 (km). 상층 지평선(357km)을 담습니다. */
export const SLAB_RANGE_KM = 360;
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

const VERT = `
void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const FRAG = `
precision highp float;
${ATMOSPHERE_GLSL}
${CLOUD_SLAB_GLSL}
${DEM_GLSL}
${demGlsl('demFar')}

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

/** 시선이 슬랜트 tEndKm 에서 운해에 닿기 **전에** 땅에 부딪히는가. */
bool slab_terrainBlocks(vec3 dir, float sinE, float cosE, float tEndKm){
  if (uTerrainOcclude < 0.5) return false;
  if (uDemValid < 0.5 && uDemFarValid < 0.5) return false;
  float eyeGround = slab_terrainM(vec2(0.0));
  float eyeKm = eyeGround > -1e3 ? (eyeGround + uEyeHeightM) / 1000.0 : uObserverAltKm;
  vec2 hz = cosE > 1e-4 ? dir.xz / cosE : vec2(0.0);
  float minGap = 1e9, tMin = 0.0;
  for (int i = 1; i <= 32; i++){
    // 가까운 쪽에 몰아 뜹니다 — 발밑 사면은 수십 m 안에서 시선을 막습니다.
    float f = float(i) / 32.0;
    float t = tEndKm * f * f;
    float dKm = t * cosE;
    float rayKm = eyeKm + t * sinE + dKm * dKm / (2.0 * SLAB_R_EARTH);
    float terr = slab_terrainM(hz * dKm * 1000.0);
    if (terr < -1e3) continue;
    float gap = rayKm - terr / 1000.0;
    if (gap < 0.0) return true;
    // 여유는 **각도**로 견줍니다(여유 ÷ 거리). 미터로 견주면 발밑 몇 m 앞
    // 땅(여유 0.1m)이 늘 이겨, 먼 능선을 다시 볼 기회를 발밑에 써 버립니다.
    float gapAng = gap / max(dKm, 1e-4);
    if (gapAng < minGap) { minGap = gapAng; tMin = f; }
  }
  // ⚠ 먼 쪽은 걸음이 tEnd/16 까지 벌어져, 능선 **꼭대기를 스치는** 시선이
  //   걸음 사이로 빠집니다(덕유산에서 3km 밖 능선 55화소 중 8개, 파고든 깊이
  //   18~121m). 시선이 땅에 각도로 가장 가까웠던 걸음 **양옆**을 8번 더 봅니다.
  float fLo = max(tMin - 1.0 / 32.0, 0.0), fHi = min(tMin + 1.0 / 32.0, 1.0);
  for (int j = 0; j < 8; j++){
    float f = mix(fLo, fHi, (float(j) + 0.5) / 8.0);
    float t = tEndKm * f * f;
    float dKm = t * cosE;
    float rayKm = eyeKm + t * sinE + dKm * dKm / (2.0 * SLAB_R_EARTH);
    float terr = slab_terrainM(hz * dKm * 1000.0);
    if (terr > -1e3 && terr / 1000.0 > rayKm) return true;
  }
  return false;
}

uniform vec2  uRes;
uniform mat4  uInvViewProj;
uniform vec3  uCamPos;
// 관측 고도에서 지평선이 내려앉은 만큼의 sin (음수). 지면과 구름이
// **정확히 같은 선에서** 만나게 하는 값입니다.
uniform float uHorizonSinE;
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
  if (sinE <= uHorizonSinE && !anyLayerBelow) discard;   // 그 아래는 지형과 지면이 담당
  float cosE = max(sqrt(max(0.0, 1.0 - sinE*sinE)), 1e-4);
  float cosG = clamp(dot(dir, uSunDir), -1.0, 1.0);
  float cosMoon = clamp(dot(dir, uMoonDir), -1.0, 1.0);

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
  vec3 ambUp   = atm_skyRadiance(72.0, cosG, uSunAltDeg, uBeta, uAngstrom, uElevScale, uOzoneDU);
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
  vec3 ambDown = atm_skyRadiance(uAmbDownDeg, cosG, uSunAltDeg, uBeta, uAngstrom, uElevScale, uOzoneDU);
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
      ambHemi += atm_skyRadiance(qElev, qCg, uSunAltDeg, uBeta, uAngstrom, uElevScale, uOzoneDU);
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
      ambVertSun  += atm_skyRadiance(vElev, cS0, uSunAltDeg, uBeta, uAngstrom, uElevScale, uOzoneDU);
      ambVertAnti += atm_skyRadiance(vElev, cS1, uSunAltDeg, uBeta, uAngstrom, uElevScale, uOzoneDU);
    }
  }
  ambVertSun *= (1.0 / 6.0);
  ambVertAnti *= (1.0 / 6.0);
  }

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
    // 덱 **속**(밑면 < 관측자 ≤ 윗면)이면 올려다본 구름이 관측자 바로 위에서
    // 시작합니다. 아래를 보면 안 그립니다(안개 상태는 그리지 않음 — §82.5).
    float hSurf = layerBelow ? deckTop : max(hBase, uObserverAltKm + 0.01);
    SlabGeom geom = slab_sphereIntersect(sinE, cosE, hSurf);
    if (!layerBelow && sinE <= uHorizonSinE) continue;
    if (!geom.hit) continue;
    // §83 — 운해(아래 층)만 땅과 견줍니다. 올려다보는 하늘은 예전 그대로.
    if (layerBelow && slab_terrainBlocks(dir, sinE, cosE, geom.sDistKm)) continue;
    vec2 km = dir.xz * geom.distRatio;
    vec4 cv = texture2D(uCoverTex, slab_coverUv(km, uRangeKm));
    float cover = L == 0 ? cv.b : (L == 1 ? cv.g : cv.r);
    float conf  = cv.a;
    vec2 kmN = km + wind * uDriftHours;

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
          vec3 cc = uBeamLow * nfSunT * nfPh * (0.20 + 1.15 * nfT_)
                  + ambBase * (0.26 + 0.30 * nfT_);

          if (nightFactor > 0.01 && moonAltFactor > 0.01) {
            float nfMoonPh = 0.40 + 0.60 * pow(max(cosMoon, 0.0), 4.0);
            cc += moonColor * nfSunT * nfMoonPh * (0.25 + 0.60 * nfT_) * nightFactor;
          }
          if (nightFactor > 0.01 && uCityLight > 0.01) {
            float nfHFrac = clamp((p.y - nfB) / nfT, 0.0, 1.0);
            float nfUpwell = (1.0 - exp(-nfTau * 0.80)) * (0.85 - 0.40 * nfHFrac);
            cc += cityGlowColor * nfUpwell * nightFactor * 0.6;
          }

          cc = max(cc, ambBase * 0.18 * nfA);
          cc *= vec3(0.97, 0.99, 1.00);   // 저층 틴트 — 껍질 경로와 같은 값.

          float nfHaze = 1.0 - exp(-nfS * 0.0030);
          cc = mix(cc, horizonHaze, clamp(nfHaze, 0.0, 0.85) * uAerialScale);

          float nfL = dot(cc, vec3(0.2126, 0.7152, 0.0722));
          cc = max(vec3(0.0), mix(vec3(nfL), cc, 1.0 + clamp(d * 0.5, 0.0, 0.7) * 0.35));

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
        vec3 Edir = beam * reach * (cosFace + uCloudSideLit * (1.0 - cosFace) * max(0.0, sinSunC));
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
        vec3 ambSide = mix(ambVertAnti, ambVertSun, 0.5 + 0.5 * faceSun);
        vec3 Fdn = Edir + mix(ambSide, ambHemi, faceUp);
        stepSunFrac = dot(Edir, vec3(0.2126, 0.7152, 0.0722))
                    / max(1e-6, dot(Fdn, vec3(0.2126, 0.7152, 0.0722)));
        float tp = thick * tauK * (1.0 - uCloudAsym);
        float ag = uCloudGroundAlb;
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

      // 밤하늘 달빛 직달광 & 산란광
      if (nightFactor > 0.01 && moonAltFactor > 0.01) {
        float moonPh = 0.40 + 0.60 * pow(max(cosMoon, 0.0), 4.0);
        vec3 moonLit = moonColor * reach * moonPh * (0.25 + 0.60 * T) * vertLit;
        cc += moonLit * nightFactor;
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
      float aerialHaze = 1.0 - exp(-geom.sDistKm * 0.0030);
      cc = mix(cc, horizonHaze, clamp(aerialHaze, 0.0, 0.85) * uAerialScale);

      // 채도 부스트. mix 의 계수가 1을 넘으므로 이건 보간이 아니라 **외삽**
      // 입니다 — 휘도보다 낮은 채널이 음수로 밀리고, 출력에서 0 으로
      // 잘립니다. 어두운 장면에서는 그게 곧 색이 통째로 빠지는 것입니다:
      // 전천후 격자의 흐림·천정·노을에서 파랑이 전 화소 0 이 되어 R/B 가
      // 98만까지 튀었습니다. 음수만 막으면 됩니다.
      float l = dot(cc, vec3(0.2126, 0.7152, 0.0722));
      cc = max(vec3(0.0), mix(vec3(l), cc, 1.0 + clamp(thick * 0.5, 0.0, 0.7) * 0.35));

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
  acc *= horizonFade;

  if (acc <= 0.002) discard;

  vec3 disp = atm_display(lin / max(acc, 1e-4), uSaturation, uSunAltDeg);
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
   * 지형 높이장(§83) — 운해를 땅이 가리게 합니다. TerrainField 와 **같은 패치**
   * (촘촘한 것, 성긴 것)를 넘기세요. null 이면 가림이 꺼집니다.
   */
  setDemPatches: (patch: DemPatch | null, farPatch: DemPatch | null) => void;
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
      uEyeHeightM: { value: 1.6 },
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

  return {
    mesh,
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
    setDemPatches: (patch, farPatch) => {
      const put = (u: Record<string, { value: unknown }>) => {
        Object.entries(u).forEach(([k, v]) => {
          if (material.uniforms[k]) material.uniforms[k].value = v.value;
        });
      };
      put(makeDemUniforms(patch));
      put(makeDemUniforms(farPatch, 'demFar'));
      // 성긴 패치만 첨탑을 걷어냅니다 — TerrainField.setPatch 와 같은 규약.
      material.uniforms.uDemFarDespike.value = farPatch ? 1 : 0;
    },
    setLowDeckKm: (baseKm, topKm) => {
      // 모르면(null·NaN·뒤집힘) (-1,-1) — 셰이더가 §81 그대로 갑니다.
      const v = material.uniforms.uLowDeckKm.value as THREE.Vector2;
      const ok = baseKm != null && topKm != null && Number.isFinite(baseKm)
        && Number.isFinite(topKm) && topKm > baseKm && baseKm >= 0 && topKm < 6;
      if (ok) v.set(baseKm as number, topKm as number); else v.set(-1, -1);
    },
    dispose: () => {
      geometry.dispose();
      material.dispose();
      coverTex.dispose();
      genusTex.dispose();
    },
  };
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

  // ⚠ 셰이더가 쓰는 높이와 **같은 값**이어야 합니다. 예전에는 여기만 상수를
  //   보고 있어서, 높이를 바꾸면 빛줄기 색만 옛 높이로 남았을 것입니다.
  const alt = uni.uLayerAltKm.value as THREE.Vector3;
  const bl = u.beamFor(alt.x);
  const bm = u.beamFor(alt.y);
  const bh = u.beamFor(alt.z);
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
 * ⚠ 같은 표본을 쓰는데도 **천정 바람개비가 사라집니다.** 결과를 직교
 * 좌표 텍스처에 굽기 때문입니다 — 중심 텍셀이 하나뿐이라 모든 방위가
 * 자동으로 같은 값을 갖습니다. 극좌표 격자에서는 맨 윗 고리의 방위별
 * 값이 한 점으로 빨려들며 부챗살이 됐습니다 (PR #14의 진단).
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
