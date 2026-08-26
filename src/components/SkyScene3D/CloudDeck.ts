/**
 * CloudDeck.ts
 *
 * 층별 **연속 구름층(deck)** 을 돔 캡 메시로 그립니다.
 *
 * Why 빌보드만으로는 안 되나: 빌보드는 개별 스프라이트라 아무리 많이 뿌려도
 * 경계가 보이는 조각들이지 이어진 구름층이 되지 않습니다. 그런데 흐린 날의
 * 핵심 실루엣은 바로 그 "이어짐"입니다.
 *
 * 기상학의 옥타 척도가 그대로 렌더 전략이 됩니다:
 *
 *   0~1/8 SKC/FEW  고립된 적운          → 빌보드만
 *   2~4/8 SCT      적운 field           → 빌보드, 간격 좁게
 *   5~7/8 BKN      적운→층적운 병합 시작 → 빌보드 + 덱 알파 램프 인
 *     8/8 OVC      층운/난층운          → 덱이 주체
 *
 * 물리적 근거: 적운 field에서 구름 지름 D, 간격 L일 때 운량 ≈ (D/L)².
 * 운량이 0.5를 넘으면 개별 적운이 서로 닿기 시작하고, 이것이 실제
 * 적운→층적운 전이입니다. mergeFactor 하나로 두 표현을 잇습니다.
 */
import * as THREE from 'three';
import { ATMOSPHERE_GLSL, makeTuningUniforms } from '../../utils/atmosphere';
import { CELL_FIELD_GLSL } from '../../utils/cloudCellField';
import {
  createCloudCellTexture,
  CELL_CHANNEL_MASK,
  type CloudCellTexture,
} from './cloudCellTexture';
import {
  LAYER_ALTITUDE_KM,
  EARTH_RADIUS_KM,
  elevationGrid,
  type LayerKey,
  type LayerSample,
} from '../../utils/skyColumn';

/** 층별 덱 반지름 — 빌보드 셸 바로 안쪽에 둡니다. */
const DECK_RADIUS: Record<LayerKey, number> = {
  low: 396,
  mid: 426,
  high: 456,
};

/**
 * 조각별 입체 음영의 세기. 셀 값을 구름 윗면 높이로 읽어 태양 쪽 기울기로
 * 밝기를 흔듭니다. 기울기는 평균이 0이라 하늘 전체 밝기는 바뀌지 않습니다.
 * 렌더로 고른 값 — 자세한 근거는 FRAG의 "조각의 입체감" 주석.
 */
const CELL_RELIEF_STRENGTH = 0.45;

/** 덱 메시 해상도 (방위 × 고도). 샘플 격자보다 촘촘해야 보간이 매끄럽습니다. */
const MESH_AZ = 72;
const MESH_ELEV = 32;

const VERT = `
precision highp float;

attribute float aCover;      // 이 방향 층 운량 0~1
attribute float aElevDeg;
attribute float aAzDeg;
attribute vec3  aAmbientUp;   // 3단계: 방향별 하늘빛 (덱 상단이 받음)
attribute vec3  aAmbientDown; // 3단계: 방향별 확산광 (덱 하단이 받음)
// 다양성 2단계: 이 방향 운형의 광학. 예전에는 층당 uniform 하나였습니다
// (= 하늘 360°가 한 가지 운형). (τ, 그늘대비, 조각세기, 조각크기km)
attribute vec4  aOptics;
attribute float aAspect;      // 바람 방향 늘임 비율 (1 = 등방, 권운만 예외)

varying float vCover;
varying float vElevDeg;
varying float vAzDeg;
varying vec3  vDir;
varying vec3  vAmbientUp;
varying vec3  vAmbientDown;
varying vec4  vOptics;
varying float vAspect;

void main() {
  vCover       = aCover;
  vElevDeg     = aElevDeg;
  vAzDeg       = aAzDeg;
  vAmbientUp   = aAmbientUp;
  vAmbientDown = aAmbientDown;
  vOptics      = aOptics;
  vAspect      = aAspect;
  vDir     = normalize(position);
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
}
`;

const FRAG = `
precision highp float;

${ATMOSPHERE_GLSL}
${CELL_FIELD_GLSL}

uniform vec3  uBeam;        // 이 층 고도에서의 직달광 (위층 감쇠 반영됨)
uniform vec3  uSunDir;
uniform float uSunAltDeg;
uniform float uSaturation;
uniform float uOpacity;     // 레이어 전체 페이드
uniform float uTime;        // 바람에 따른 무늬 이동

// ── 조각 무늬 (docs/CLOUD_TEXTURE_PLAN.md 2단계) ──────────────────────────
uniform sampler2D uCellTex;      // 구운 셀 필드 (RGBA = 씨앗 4개)
uniform vec4  uCellMaskA;        // 이 층이 읽을 채널
uniform vec4  uCellMaskB;        // 두 번째 탭이 읽을 채널
uniform vec2  uCellAcross;       // 바람을 가로지르는 단위벡터 (XZ 평면)
uniform float uPatchUvScale;     // 패치용 — 훨씬 큰 스케일
uniform float uCellTileCells;    // 텍스처 한 타일에 든 조각 수
/**
 * 이 층에 조각이 **하나라도** 있는가 (0 = 층 전체가 층상운).
 *
 * 조각 세기는 이제 방향마다 다르지만(vOptics.z), 입체 음영 분기는
 * **uniform** 이어야 합니다 — GLSL ES 1.0에서 texture2D는 암시적 미분으로
 * 밉 레벨을 정하므로 비균일 분기 안에서는 결과가 정의되지 않습니다.
 * 그래서 층 전체의 최댓값으로 분기하고, 안에서 방향별 세기를 곱합니다.
 */
uniform float uAnyCells;
uniform float uCellReliefUv;     // 입체감 표본을 태양 쪽으로 밀 uv 거리
uniform float uCellRelief;       // 입체 음영 세기 (0 = 끔)
uniform float uAltKm;            // 이 층의 고도
uniform float uEarthRadiusKm;    // 지구 반지름 (구면 투영)
uniform float uPixelAngleRad;    // 화면 픽셀 하나의 각크기
uniform float uMaxAniso;         // 이방성 필터 최대 배율
uniform float uCellTexSize;      // 텍스처 한 변 (텍셀)

// ── 대기 투시 (docs/CLOUD_TEXTURE_PLAN.md 4단계) ──────────────────────────
uniform float uBeta;             // 에어로졸 혼탁도 — CloudField.ts와 같은 값
uniform float uAngstrom;
uniform float uElevScale;

varying float vCover;
varying float vElevDeg;
varying float vAzDeg;
varying vec3  vDir;
varying vec3  vAmbientUp;
varying vec3  vAmbientDown;
varying vec4  vOptics;
varying float vAspect;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  mat2 rot = mat2(0.80, 0.60, -0.60, 0.80);
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p = rot * p * 2.02;
    a *= 0.5;
  }
  return v;
}

void main() {
  if (vCover <= 0.005) discard;

  // ── 방향별 운형 광학 (docs/CLOUD_VARIETY_PLAN.md 2단계) ─────────────────
  //
  // 예전에는 이 넷이 전부 층당 uniform 하나였습니다. 그래서 방향마다 다른
  // 것은 운량(vCover)뿐이었고, **하늘 360°가 층마다 한 가지 운형**이었습니다.
  //
  // 정점 보간이 값을 이어 주므로 인접한 두 방향이 다른 운형이어도 경계에
  // 계단이 생기지 않습니다 — τ 16→30(고적운→고층운)은 그 사이를 부드럽게
  // 지나갑니다. 실제 대기에서도 운형은 선이 아니라 띠로 바뀝니다.
  float dTau         = max(vOptics.x, 0.05);
  float dShadow      = clamp(vOptics.y, 0.0, 1.0);
  float dCellStr     = clamp(vOptics.z, 0.0, 1.0);
  // 층상운(조각 없음)은 조각 크기가 0이라 나눗셈이 터집니다. 크기는
  // 아무 값이나 두고 dCellStr가 결과를 지웁니다.
  float dCellSizeKm  = max(vOptics.w, 0.02);
  float dAspect      = max(vAspect, 1.0);
  // 가로지르는 쪽이 조각 크기, 바람 쪽이 그 dAspect배.
  float acrossScale  = 1.0 / (dCellSizeKm * uCellTileCells);
  vec2  cellUvScale  = vec2(acrossScale, acrossScale / dAspect);

  // ── 투영: 고도 선형 → **지상거리 선형** ─────────────────────────────────
  //
  // 예전에는 uv 반지름이 시선 고도에 선형이었습니다(방위각 등거리).
  // 그러면 원근 단축이 없어 구름이 지평선까지 같은 크기로 깔립니다 —
  // 하늘이 벽지처럼 보이던 이유입니다.
  //
  // 실제 구름층은 고도 h의 **구면 껍질**이고, 시선이 닿는 지점까지의
  // 거리는 아래 구면 교점식으로 구합니다.
  vec2 hdir = vDir.xz;
  float hlen = max(1e-4, length(hdir));
  vec2 dirXZ = hdir / hlen;

  float elevRad = radians(max(vElevDeg, 0.0));
  float sinE = max(sin(elevRad), 0.0);
  float cosE = max(cos(elevRad), 1e-3);
  // ── 구면 투영 ──────────────────────────────────────────────────────────
  //
  // 평면 근사 d = h·cot(ε)는 지평선에서 **발산합니다**. 예전에는 상한을
  // 씌워 막았지만, 그건 곡률이 아니라 벽입니다: 상한에 닿는 순간 압축이
  // 뚝 멈춰 그 아래가 통째로 같은 배율로 뭉갭니다. 그리고 발산하는 구간이
  // 실제보다 훨씬 넓습니다 — 상층 10km에서 고도각 1°의 참값은 263km인데
  // 평면식은 573km, 0.2°에서는 336km 대 2865km로 **8.5배** 틀립니다.
  // 그 8배가 지평선 근처에 무한한 벽지를 깔아 "곡률 없는 무한 평면"으로
  // 보이게 만들던 것입니다.
  //
  // 정확한 값은 시선과 구름 구면(반지름 R+h)의 교점입니다. 경사거리 r은
  //   r = -R·sinε + sqrt(R²sin²ε + 2Rh + h²)
  // 인데 이 형태는 천정에서 큰 수 둘을 빼게 되어(6381 - 6371) float32에서
  // 유효숫자가 날아갑니다. 켤레를 곱해 정리한 아래 형태는 어느 고도각에서도
  // 상쇄가 없습니다.
  float Rk = uEarthRadiusKm;
  float h  = uAltKm;
  float chord = 2.0 * Rk * h + h * h;
  float r = chord / (Rk * sinE + sqrt(Rk * Rk * sinE * sinE + chord));
  // 구름층 위 호 길이. 지심각 θ = asin(r·cosε/(R+h)).
  float theta = asin(clamp(r * cosE / (Rk + h), 0.0, 1.0));
  // 상한이 필요 없습니다 — ε→0에서 sqrt(2Rh+h²)로 **스스로 수렴합니다.**
  float d = (Rk + h) * theta;

  // 바람에 따른 이동은 **km 단위**여야 합니다 — uv 단위로 밀면 층마다
  // 셀 크기가 달라 이동 속도가 제각각이 됩니다.
  vec2 driftKm = vec2(uTime * 0.0040, uTime * 0.0016);

  // ── 바람 정렬 이방성 (docs/CLOUD_TEXTURE_PLAN.md 6단계) ────────────────
  //
  // 권운은 낙하하는 얼음 결정이 풍속차에 끌려 생기는 낙적운이라, 태생부터
  // 바람 방향으로 길게 늘어난 필라멘트입니다. 등방 노이즈로는 절대 그
  // 모양이 안 나옵니다.
  //
  // 지상 좌표를 바람 축으로 회전한 뒤 **축마다 다른 배율**을 겁니다.
  // uCellAcross가 가로지르는 축, 그에 수직인 것이 바람 축입니다.
  // 등방 운형(cellAspect = 1)은 두 배율이 같아 회전이 무의미해지므로
  // 이 경로의 영향을 전혀 받지 않습니다.
  vec2 groundKm = dirXZ * d + driftKm;
  vec2 windAxis = vec2(-uCellAcross.y, uCellAcross.x);
  vec2 alignedKm = vec2(dot(groundKm, uCellAcross), dot(groundKm, windAxis));

  vec2 uvCell  = alignedKm * cellUvScale;
  vec2 uvPatch = (dirXZ * d + driftKm * 0.6) * uPatchUvScale;

  // ── 화면 픽셀 하나가 덮는 텍셀 수 (해석적으로) ─────────────────────────
  //
  // uv 변화율은 방향마다 다릅니다. 접선 방향은 d/cos ε, 반경 방향은
  // d/(sin ε · cos ε) — 비율이 정확히 1/sin ε 입니다. 지평선 쪽에서 반경
  // 방향이 훨씬 빨리 변하므로 무늬가 그 방향으로 눌립니다.
  //
  // 이방성 필터가 있으면 LOD는 **짧은 축** 기준으로 잡히므로 접선 쪽을 쓰되,
  // 비율이 필터 한계를 넘으면 그만큼 되돌립니다.
  // 배율이 축마다 다르므로 **더 촘촘한 쪽**을 씁니다 — 앨리어싱은 항상
  // 고주파 축에서 먼저 납니다. (권운은 가로지르는 축이 20배 촘촘합니다)
  float finestScale = max(cellUvScale.x, cellUvScale.y);
  float tangential = uCellTexSize * uPixelAngleRad * d * finestScale / cosE;
  float aniso = 1.0 / sinE;
  float tpp = tangential * max(1.0, aniso / max(1.0, uMaxAniso));

  // ── 두 스케일 ──────────────────────────────────────────────────────────
  //
  // 큰 스케일은 **합성하지 않습니다.** 576방향 기상 격자가 이미 방향마다
  // 다른 운량(vCover)을 주고 있고, 그게 진짜 데이터로 된 패치입니다.
  //
  // 한동안 그 위에 합성 패치를 하나 더 얹어 국소 운량을 흔들었는데, 렌더에서
  // 잡혔습니다: 지상거리 투영은 천정에서 d → 0 이라 **패치 uv가 한 점으로
  // 수축**합니다. 그러면 천정 부근 넓은 영역이 텍스처의 한 값을 공유해
  // 운량이 통째로 밀립니다 (측정 -5.2%p). 셀 쪽은 uv 배율이 8배 커서 그
  // 특이점이 눈에 안 띌 만큼 작습니다.
  //
  // 격자는 통계를, 텍스처는 모양을 — 계획의 원칙 그대로가 맞았습니다.
  float cellV = cell_sample(uCellTex, uvCell, uCellMaskA, uCellMaskB);

  // ── 조각의 입체감 ───────────────────────────────────────────────────────
  //
  // 여기까지의 셰이딩은 한 방향 안에서 **모든 조각이 같은 밝기**였습니다.
  // 조각은 알파로만 오려내고 색은 시선·광학두께로만 정해졌으니까요. 그래서
  // 하늘이 오려붙인 종이처럼 보였습니다 — 실제 구름 조각은 태양 쪽 면이
  // 밝고 반대쪽이 그늘집니다.
  //
  // 셀 값을 구름 윗면의 **높이**로 읽으면 기울기가 곧 법선입니다. 필요한
  // 것은 태양 쪽 기울기 하나뿐이므로(조명은 그 방향으로만 결정됩니다)
  // 전체 법선을 만들 것 없이 **태양 방향으로 한 번만 더** 뽑습니다.
  // 값이 태양 쪽으로 커지면 = 그쪽이 더 두껍다 = 여기는 반대 사면 → 어둡게.
  //
  // 텍스처 페치는 2회 → 4회가 됩니다. cellStrength가 0인 층운계는 조각이
  // 없으므로 uniform 분기로 건너뜁니다 (uniform이라 발산이 없습니다).
  //
  // 분기 조건이 **uniform**(uAnyCells)인 것이 중요합니다. 방향별 세기
  // (dCellStr)로 분기하면 비균일 흐름 안에서 texture2D를 부르게 되고,
  // 그러면 암시적 밉 레벨이 정의되지 않습니다. 세기는 안에서 곱합니다.
  float relief = 0.0;
  if (uAnyCells > 0.0) {
    vec2 sunXZ = normalize(uSunDir.xz + vec2(1e-5));
    vec2 sunAligned = vec2(dot(sunXZ, uCellAcross), dot(sunXZ, windAxis));
    vec2 sunUv = normalize(sunAligned * cellUvScale + vec2(1e-9)) * uCellReliefUv;
    float cellSun = cell_sample(uCellTex, uvCell + sunUv, uCellMaskA, uCellMaskB);
    // 낮은 태양일수록 옆에서 비추므로 대비가 큽니다.
    float sunLow = 1.0 - clamp(uSunAltDeg / 40.0, 0.0, 1.0);
    relief = clamp((cellV - cellSun) * 3.0, -1.0, 1.0) * (0.30 + 0.55 * sunLow)
             * step(0.001, dCellStr);
  }

  float t = cell_threshold(vCover, tpp);
  // 문턱 램프는 대칭이라 면적을 바꾸지 않습니다. 축소가 클수록 넓혀
  // 계단이 지글거리지 않게 합니다.
  float w = clamp(0.025 * max(1.0, tpp), 0.02, 0.40);
  float cellCut = smoothstep(t - w, t + w, cellV);

  // 층운계(cellStrength = 0)는 조각을 내지 않습니다 — WMO 정의상 요소가
  // 없는 구름입니다. 그때는 운량이 그대로 알파가 됩니다.
  float coverAlpha = mix(vCover, cellCut, dCellStr);

  // 두께 얼룩 — 덱이 균일한 판때기로 보이지 않게 합니다.
  float thickVar = 0.72 + 0.56 * fbm(uvPatch * 6.0 + 17.0);

  if (coverAlpha <= 0.004) discard;

  // 아래쪽 코드가 쓰는 이름들을 맞춰 둡니다.
  float holeCut = cellCut;
  float merge = vCover;

  // ── 광학 ────────────────────────────────────────────────────────────────
  float tau = dTau * thickVar;
  vec2 rt = atm_cloudRT(tau);
  float R = rt.x;
  float T = rt.y;

  // 덱을 아래에서 올려다보므로 기본은 **바닥면**입니다.
  // 바닥면 밝기는 위에서 통과해 내려온 확산광(T)이 지배합니다.
  // 이것이 흐린 날의 평평한 회색입니다 — 직달광이 도달하지 않으므로
  // 밝은 면/그늘 면 대비가 생기지 않습니다.
  vec3 baseCol = uBeam * T * 0.42 + vAmbientDown * (0.35 + T * 0.4);

  // 덱이 얇으면 태양 방향이 비쳐 밝은 얼룩이 생깁니다 (구름 사이 밝음).
  float sunAlign = clamp(dot(normalize(vDir), uSunDir), 0.0, 1.0);
  float bright = pow(sunAlign, 6.0) * T;
  baseCol += uBeam * bright * 0.5;

  // 구멍 가장자리는 위쪽 밝은 면이 살짝 보입니다.
  float edge = (1.0 - holeCut) * merge;
  baseCol += (uBeam * R + vAmbientUp * (1.0 - R)) * edge * 0.35;

  // 그늘 깊이 — 두꺼울수록 어둡습니다.
  baseCol *= 1.0 - dShadow * 0.42 * smoothstep(8.0, 60.0, tau);

  // 조각별 입체 음영. **대기 투시보다 앞**에 둡니다 — 멀리 있는 조각은
  // 아래에서 연무에 잠기면서 입체감도 같이 흐려져야 하기 때문입니다.
  // 기울기는 평균이 0이라 하늘 전체 밝기(=운량 통계)는 건드리지 않습니다.
  baseCol *= 1.0 + relief * uCellRelief;

  // ── 대기 투시 (docs/CLOUD_TEXTURE_PLAN.md 4단계) ────────────────────────
  //
  // 예전에는 지평선 근처에서 알파를 임의로 줄였습니다(smoothstep(1.5,14.0,·)).
  // 고도 14°는 중층 기준 16km — 그 거리에서 구름이 사라질 이유가 없는데도
  // 지웠고, 이 창을 그대로 재면 운량이 -28.3%p 모자랐습니다 (2단계 측정).
  //
  // 구름은 멀어진다고 투명해지지 않습니다 — 대기에 잠겨 **색이 하늘과
  // 같아질 뿐**입니다. CloudField.ts(빌보드)가 이미 이렇게 합니다.
  // 알파는 운량 그대로 두고(= 통계가 맞고), 색만 거리에 따라 vAmbientDown
  // (이 방향의 실제 하늘/연무 색, 3단계에서 방향별로 만들어짐)으로 보냅니다.
  vec3 Tpath = atm_aerialTransmittance(d, uAltKm, uBeta, uAngstrom, uElevScale);
  baseCol = baseCol * Tpath + vAmbientDown * (1.0 - Tpath);

  gl_FragColor = vec4(atm_display(baseCol, uSaturation, uSunAltDeg), coverAlpha * uOpacity);
}
`;

export interface CloudDeckLayer {
  layer: LayerKey;
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  coverAttr: THREE.BufferAttribute;
  ambientUpAttr: THREE.BufferAttribute;
  ambientDownAttr: THREE.BufferAttribute;
  opticsAttr: THREE.BufferAttribute;
  aspectAttr: THREE.BufferAttribute;
}

export interface CloudDeckHandle {
  group: THREE.Group;
  layers: CloudDeckLayer[];
  dispose: () => void;
  /** 구운 조각 무늬 — 검증 하네스가 크기·타일 수를 읽습니다 */
  cell: CloudCellTexture;
}

function buildDeckGeometry(layer: LayerKey): {
  geometry: THREE.BufferGeometry;
  coverAttr: THREE.BufferAttribute;
  ambientUpAttr: THREE.BufferAttribute;
  ambientDownAttr: THREE.BufferAttribute;
  opticsAttr: THREE.BufferAttribute;
  aspectAttr: THREE.BufferAttribute;
  dirs: { azDeg: number; elevDeg: number }[];
} {
  const radius = DECK_RADIUS[layer];
  const positions: number[] = [];
  const cover: number[] = [];
  const elevA: number[] = [];
  const azA: number[] = [];
  const indices: number[] = [];
  const dirs: { azDeg: number; elevDeg: number }[] = [];

  // 고도각은 1.5° ~ 89°. 지평선에 딱 붙이면 무한 원근으로 늘어납니다.
  for (let e = 0; e <= MESH_ELEV; e++) {
    const t = e / MESH_ELEV;
    const elevDeg = 1.5 + t * 87.5;
    const er = (elevDeg * Math.PI) / 180;

    for (let a = 0; a <= MESH_AZ; a++) {
      const azDeg = (a * 360) / MESH_AZ;
      const ar = (azDeg * Math.PI) / 180;

      positions.push(
        radius * Math.cos(er) * Math.sin(ar),
        radius * Math.sin(er),
        -radius * Math.cos(er) * Math.cos(ar)
      );
      cover.push(0);
      elevA.push(elevDeg);
      azA.push(azDeg);
      dirs.push({ azDeg, elevDeg });
    }
  }

  const stride = MESH_AZ + 1;
  for (let e = 0; e < MESH_ELEV; e++) {
    for (let a = 0; a < MESH_AZ; a++) {
      const i0 = e * stride + a;
      const i1 = i0 + 1;
      const i2 = (e + 1) * stride + a;
      const i3 = i2 + 1;
      indices.push(i0, i2, i1, i1, i2, i3);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const coverAttr = new THREE.Float32BufferAttribute(cover, 1);
  coverAttr.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('aCover', coverAttr);
  geometry.setAttribute('aElevDeg', new THREE.Float32BufferAttribute(elevA, 1));
  geometry.setAttribute('aAzDeg', new THREE.Float32BufferAttribute(azA, 1));

  // 3단계: 방향별 환경광. 정점 수만큼(층당 2,409) 미리 0으로 채워 두고
  // updateCloudDeck이 192방향 그리드에서 보간해 채웁니다.
  const nV = dirs.length;
  const ambientUpAttr = new THREE.Float32BufferAttribute(new Float32Array(nV * 3), 3);
  const ambientDownAttr = new THREE.Float32BufferAttribute(new Float32Array(nV * 3), 3);
  ambientUpAttr.setUsage(THREE.DynamicDrawUsage);
  ambientDownAttr.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('aAmbientUp', ambientUpAttr);
  geometry.setAttribute('aAmbientDown', ambientDownAttr);

  // 다양성 2단계: 방향별 운형 광학 (τ, 그늘, 조각세기, 조각크기km) + 늘임비.
  const opticsAttr = new THREE.Float32BufferAttribute(new Float32Array(nV * 4), 4);
  const aspectAttr = new THREE.Float32BufferAttribute(new Float32Array(nV), 1);
  opticsAttr.setUsage(THREE.DynamicDrawUsage);
  aspectAttr.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('aOptics', opticsAttr);
  geometry.setAttribute('aAspect', aspectAttr);

  geometry.setIndex(indices);

  return { geometry, coverAttr, ambientUpAttr, ambientDownAttr, opticsAttr, aspectAttr, dirs };
}

/** 층 → 메시 정점 방향 목록 (샘플 보간에 재사용) */
const deckDirs = new Map<LayerKey, { azDeg: number; elevDeg: number }[]>();

/** 지상거리 상한 — 층 고도의 몇 배까지 볼 것인가 (시선 고도 약 1.4°) */
/**
 * 두께 얼룩용 무늬의 물리 크기 (km).
 *
 * **운량에는 관여하지 않습니다.** τ를 ±28% 흔들어 덱이 균일한 판때기로
 * 보이지 않게 하는 밝기 얼룩일 뿐입니다. 예전에 여기에 운량 변조를 얹었다가
 * 천정 특이점으로 운량이 -5.2%p 밀렸습니다 (셰이더 주석 참고).
 */
const PATCH_SIZE_KM = 4;

export function createCloudDeck(opts: {
  /** 이방성 필터 최대 배율. `renderer.capabilities.getMaxAnisotropy()` */
  maxAnisotropy?: number;
} = {}): CloudDeckHandle {
  const group = new THREE.Group();
  group.name = 'cloudDeck';

  // 조각 무늬는 날씨·시각과 무관한 정적 텍스처라 한 번만 굽습니다.
  const cell = createCloudCellTexture();
  const maxAniso = Math.max(1, opts.maxAnisotropy ?? 1);
  cell.texture.anisotropy = maxAniso;
  cell.texture.needsUpdate = true;

  const layers: CloudDeckLayer[] = [];

  // 상층부터 그려야 아래층이 위에 얹힙니다.
  (['high', 'mid', 'low'] as LayerKey[]).forEach((layer, idx) => {
    const { geometry, coverAttr, ambientUpAttr, ambientDownAttr, opticsAttr, aspectAttr, dirs } =
      buildDeckGeometry(layer);
    deckDirs.set(layer, dirs);

    const material = new THREE.ShaderMaterial({
      uniforms: {
      ...makeTuningUniforms(),
        uBeam: { value: new THREE.Vector3(1, 1, 1) },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uSunAltDeg: { value: 30 },
        uSaturation: { value: 1 },
        uOpacity: { value: 1 },
        uTime: { value: 0 },

        uCellTex: { value: cell.texture },
        uCellMaskA: { value: new THREE.Vector4(1, 0, 0, 0) },
        uCellMaskB: { value: new THREE.Vector4(0, 1, 0, 0) },
        uCellAcross: { value: new THREE.Vector2(1, 0) },
        uPatchUvScale: { value: 1 / (PATCH_SIZE_KM * cell.tileCells) },
        // 조각 크기·세기·τ·그늘은 이제 정점 속성입니다 (2단계).
        // 셰이더가 조각 uv 배율을 직접 만들려면 타일당 조각 수가 필요합니다.
        uCellTileCells: { value: cell.tileCells },
        uAnyCells: { value: 1 },
        uAltKm: { value: LAYER_ALTITUDE_KM[layer] },
        // 조각 하나의 uv 폭은 1/tileCells. 그 35%만큼 태양 쪽으로 밀어
        // 기울기를 잽니다 — 너무 짧으면 필터에 묻히고, 너무 길면 옆
        // 조각을 집어 음영이 조각과 어긋납니다.
        uCellReliefUv: { value: (0.35 / cell.tileCells) },
        uCellRelief: { value: CELL_RELIEF_STRENGTH },
        uEarthRadiusKm: { value: EARTH_RADIUS_KM },
        uPixelAngleRad: { value: 0.002 },
        uMaxAniso: { value: maxAniso },
        uCellTexSize: { value: cell.size },

        // 4단계: 대기 투시. CloudField.ts와 같은 이름 — updateCloudDeck이
        // 매 프레임 env에서 채웁니다.
        uBeta: { value: 0.08 },
        uAngstrom: { value: 1.3 },
        uElevScale: { value: 1.0 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide,
      blending: THREE.NormalBlending,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `cloudDeck_${layer}`;
    mesh.frustumCulled = false;
    // 빌보드(2)보다 뒤, 하늘(-1)보다 앞. 상층이 더 뒤에 옵니다.
    mesh.renderOrder = 1 + idx * 0.1;
    group.add(mesh);

    layers.push({
      layer, mesh, material, coverAttr, ambientUpAttr, ambientDownAttr, opticsAttr, aspectAttr,
    });
  });

  return {
    group,
    layers,
    dispose: () => {
      for (const l of layers) {
        l.mesh.geometry.dispose();
        l.material.dispose();
      }
      // 텍스처는 모듈 캐시가 갖고 있으므로 여기서 버리지 않습니다.
    },
    cell,
  };
}

/**
 * 샘플 격자(방위 24 × 고도 8)를 덱 메시 정점(72 × 32)으로 보간합니다.
 * 최근접 4점 이중선형 — 격자가 규칙적이라 인덱스로 바로 찾습니다.
 */
function sampleCoverAt(
  samples: LayerSample[],
  layer: LayerKey,
  azSteps: number,
  elevs: number[],
  azDeg: number,
  elevDeg: number
): number {
  const layerSamples = samples.filter(s => s.layer === layer);
  if (layerSamples.length === 0) return 0;

  // 방위 인덱스 (순환)
  const aF = (azDeg / 360) * azSteps;
  const a0 = Math.floor(aF) % azSteps;
  const a1 = (a0 + 1) % azSteps;
  const at = aF - Math.floor(aF);

  // 고도 인덱스 (elevs는 오름차순)
  let e0 = 0;
  while (e0 < elevs.length - 2 && elevs[e0 + 1] < elevDeg) e0++;
  const e1 = Math.min(elevs.length - 1, e0 + 1);
  const span = Math.max(1e-6, elevs[e1] - elevs[e0]);
  const et = Math.max(0, Math.min(1, (elevDeg - elevs[e0]) / span));

  const at00 = layerSamples[a0 * elevs.length + e0]?.cover ?? 0;
  const at01 = layerSamples[a0 * elevs.length + e1]?.cover ?? 0;
  const at10 = layerSamples[a1 * elevs.length + e0]?.cover ?? 0;
  const at11 = layerSamples[a1 * elevs.length + e1]?.cover ?? 0;

  return (
    (at00 * (1 - et) + at01 * et) * (1 - at) + (at10 * (1 - et) + at11 * et) * at
  );
}

/**
 * `sampleCoverAt`와 같은 이중선형 보간을 vec3 그리드에 적용합니다
 * (docs/CLOUD_TEXTURE_PLAN.md 3단계).
 *
 * `grid`는 `azSteps × elevs.length` 방향, 채널당 순서로 저장됩니다
 * (`(a * elevs.length + e) * 3 + c`). 192개 격자점에서만 실제 계산(스카이
 * 복사휘도)을 하고, 여기서는 배열 조회 4번뿐이라 정점 수(2,409×3층)만큼
 * 불러도 저렴합니다.
 */
function sampleGridInto(
  grid: Float32Array,
  comps: number,
  azSteps: number,
  elevs: number[],
  azDeg: number,
  elevDeg: number,
  out: Float32Array,
  outOffset: number
): void {
  const nE = elevs.length;

  const aF = (azDeg / 360) * azSteps;
  const a0 = Math.floor(aF) % azSteps;
  const a1 = (a0 + 1) % azSteps;
  const at = aF - Math.floor(aF);

  let e0 = 0;
  while (e0 < nE - 2 && elevs[e0 + 1] < elevDeg) e0++;
  const e1 = Math.min(nE - 1, e0 + 1);
  const span = Math.max(1e-6, elevs[e1] - elevs[e0]);
  const et = Math.max(0, Math.min(1, (elevDeg - elevs[e0]) / span));

  const i00 = (a0 * nE + e0) * comps;
  const i01 = (a0 * nE + e1) * comps;
  const i10 = (a1 * nE + e0) * comps;
  const i11 = (a1 * nE + e1) * comps;

  for (let c = 0; c < comps; c++) {
    const v0 = grid[i00 + c] * (1 - et) + grid[i01 + c] * et;
    const v1 = grid[i10 + c] * (1 - et) + grid[i11 + c] * et;
    out[outOffset + c] = v0 * (1 - at) + v1 * at;
  }
}

export interface DeckUpdate {
  samples: LayerSample[];
  beamFor: (altKm: number) => { r: number; g: number; b: number };
  /**
   * 방향별 환경광 (docs/CLOUD_TEXTURE_PLAN.md 3단계).
   *
   * **`azDeg`/`elevDeg`로 나뉘어야 합니다.** 예전에는 층당 uniform 하나라
   * 360° 덱 전체가 같은 색이었습니다 — 일몰에 서쪽은 타오르고 동쪽은 잿빛이어야
   * 하는데 전부 같은 색이었습니다. 콜백이 방향마다 다시 불리므로, 안에서
   * 그 방향과 태양 사이 각거리(`angularSeparationDeg`)로 실제 하늘 복사휘도를
   * 계산해야 방향성이 생깁니다.
   *
   * 층별 `up`/`down` uniform 하나였을 때는 `applyCloudDimming`을 거치지 않은
   * **맑은 하늘 복사휘도**였습니다. 빌보드는 감광되는데 덱만 안 되고 있었고,
   * 하필 8/8에서는 화면을 덮는 것이 덱이라 운량을 올릴수록 오히려 밝아졌습니다
   * (측정: 태양 45°에서 6/8이 화면밝기 181, 8/8이 207). 감광은 그대로 유지하세요.
   *
   * 192방향(24×8)에서만 불립니다 — 정점(2,409×3층)마다 부르면 안 됩니다.
   * `skyRadiance` 한 번이 약 1.8µs라 192×3층×2(up/down) ≈ 1ms이지만,
   * 정점마다 부르면 7,227×2로 10배 넘게 뜁니다.
   */
  ambientFor: (
    layer: LayerKey,
    azDeg: number,
    elevDeg: number
  ) => {
    up: { r: number; g: number; b: number };
    down: { r: number; g: number; b: number };
  };
  sunDir: THREE.Vector3;
  sunAltDeg: number;
  tauFor: (layer: LayerKey) => number;
  shadowFor: (layer: LayerKey) => number;
  /**
   * 층별 대표 운형의 조각 기하.
   *
   * **광학두께와 같은 운형에서 나와야 합니다.** 두 값이 갈라지면
   * "권운처럼 얇은데 층적운처럼 큰 조각"이 나옵니다.
   */
  cellFor: (layer: LayerKey) => {
    cellSizeKm: number;
    cellStrength: number;
    cellVariant: 'billow' | 'fbm';
    /** 바람 방향 늘임 비율 (1 = 등방). 권운만 1이 아닙니다. */
    cellAspect: number;
  };
  /**
   * **방향별** 운형 광학 (docs/CLOUD_VARIETY_PLAN.md 2단계).
   *
   * 없으면 위의 `tauFor`/`shadowFor`/`cellFor` 스칼라가 하늘 전체에 그대로
   * 쓰입니다 — 2단계 이전의 동작이고, 기존 미리보기 하네스가 그 경로입니다.
   *
   * 있으면 192방향 격자에서 방향마다 불리고, 결과가 정점 속성으로 보간되어
   * 한 화면 안에서 운형이 갈립니다. `cover`는 그 방향 그 층의 운량으로,
   * 운형 판정의 주된 입력입니다.
   *
   * ⚠ **`cellVariant`(billow/fbm 채널)는 여기 없습니다.** 방향마다 바꾸려면
   * 두 채널을 섞어야 하는데, 독립인 균등분포 둘을 선형으로 섞으면 분포가
   * 좁아져 `cell_threshold`의 운량 보장이 깨집니다. 채널은 층당 하나로
   * 두고(`cellFor`), 방향별 차이는 조각 **크기·세기**가 냅니다 — 실제로
   * 한 층 안에서 채널이 갈리는 경우는 권운↔권적운뿐입니다.
   */
  genusFor?: (
    layer: LayerKey,
    azDeg: number,
    elevDeg: number,
    cover: number
  ) => {
    tau: number;
    shadowContrast: number;
    cellSizeKm: number;
    cellStrength: number;
    cellAspect: number;
  };
  /** 화면 픽셀 하나의 각크기 (rad) — 밉 필터 보정에 씁니다 */
  pixelAngleRad: number;
  /**
   * 필라멘트를 빗을 바람 방향 (도, 6단계).
   *
   * ⚠ 지금은 **실측이 아니라 대용 상수**입니다
   * (`skyColumn.ts: PLACEHOLDER_WIND_BEARING_DEG`). 이 앱은 바람을 받아오지
   * 않습니다. 등방 운형(cellAspect = 1)에는 아무 영향이 없고, 권운에만
   * 필라멘트 축으로 쓰입니다.
   */
  windBearingDeg: number;
  /**
   * 대기 투시 (docs/CLOUD_TEXTURE_PLAN.md 4단계) — `CloudField.ts`와 같은
   * 값을 넣으세요. 덱과 빌보드가 서로 다른 연무 세기를 쓰면 두 표현이
   * 이어지는 지점(BKN 경계)에서 색이 끊깁니다.
   */
  betaMie: number;
  angstrom: number;
  elevScale: number;
  timeSeconds: number;
  visible: boolean;
}

/** 격자 보간 결과를 받는 스크래치 (τ, 그늘, 조각세기, 조각크기, 늘임비) */
const _optics5 = new Float32Array(5);

export function updateCloudDeck(handle: CloudDeckHandle, u: DeckUpdate): void {
  const elevs = elevationGrid();
  const azSteps = 24;
  const nE = elevs.length;

  for (const l of handle.layers) {
    const dirs = deckDirs.get(l.layer);
    if (!dirs) continue;

    const arr = l.coverAttr.array as Float32Array;
    let maxCover = 0;
    for (let i = 0; i < dirs.length; i++) {
      const c = sampleCoverAt(u.samples, l.layer, azSteps, elevs, dirs[i].azDeg, dirs[i].elevDeg);
      arr[i] = c;
      if (c > maxCover) maxCover = c;
    }
    l.coverAttr.needsUpdate = true;

    // ── 3단계: 192방향 그리드에서 방향별 환경광을 채웁니다 ─────────────────
    // 여기서만 ambientFor(=skyRadiance)를 부릅니다. 정점 보간은 배열 조회뿐이라
    // 값싸게 2,409개로 퍼뜨릴 수 있습니다.
    const gridUp = new Float32Array(azSteps * nE * 3);
    const gridDown = new Float32Array(azSteps * nE * 3);
    for (let a = 0; a < azSteps; a++) {
      const azDeg = (a * 360) / azSteps;
      for (let e = 0; e < nE; e++) {
        const amb = u.ambientFor(l.layer, azDeg, elevs[e]);
        const i = (a * nE + e) * 3;
        gridUp[i] = amb.up.r; gridUp[i + 1] = amb.up.g; gridUp[i + 2] = amb.up.b;
        gridDown[i] = amb.down.r; gridDown[i + 1] = amb.down.g; gridDown[i + 2] = amb.down.b;
      }
    }
    const upArr = l.ambientUpAttr.array as Float32Array;
    const downArr = l.ambientDownAttr.array as Float32Array;
    for (let i = 0; i < dirs.length; i++) {
      sampleGridInto(gridUp, 3, azSteps, elevs, dirs[i].azDeg, dirs[i].elevDeg, upArr, i * 3);
      sampleGridInto(gridDown, 3, azSteps, elevs, dirs[i].azDeg, dirs[i].elevDeg, downArr, i * 3);
    }
    l.ambientUpAttr.needsUpdate = true;
    l.ambientDownAttr.needsUpdate = true;

    // ── 방향별 운형 광학 (docs/CLOUD_VARIETY_PLAN.md 2단계) ────────────────
    //
    // 환경광과 같은 방식입니다: 192방향 격자에서만 판정하고, 정점 2,409개로는
    // 배열 조회로 퍼뜨립니다. 운형 판정은 문턱 비교 몇 번이라 값싸지만,
    // 격자 하나로 맞춰 두면 운량·환경광과 **같은 해상도**를 갖습니다.
    const cellCfg = u.cellFor(l.layer);
    const 층대표 = {
      tau: u.tauFor(l.layer),
      shadowContrast: u.shadowFor(l.layer),
      cellSizeKm: cellCfg.cellSizeKm,
      cellStrength: cellCfg.cellStrength,
      cellAspect: cellCfg.cellAspect,
    };
    // 층상운은 조각 크기가 0입니다. 그대로 두면 이웃한 조각형 운형과의
    // 보간이 0 → 2.0 을 지나며 크기가 널뛰므로, **세기가 지울 값**이라도
    // 그 층의 대표 크기를 넣어 둡니다. 결과는 세기(0)가 어차피 지웁니다.
    const 층공칭크기: Record<LayerKey, number> = { high: 0.30, mid: 0.50, low: 1.20 };
    const nominal = 층공칭크기[l.layer];

    const gridG = new Float32Array(azSteps * nE * 5);
    let anyCells = 0;
    for (let a = 0; a < azSteps; a++) {
      const azDeg = (a * 360) / azSteps;
      for (let e = 0; e < nE; e++) {
        const c = u.genusFor
          ? sampleCoverAt(u.samples, l.layer, azSteps, elevs, azDeg, elevs[e])
          : 0;
        const g = u.genusFor ? u.genusFor(l.layer, azDeg, elevs[e], c) : 층대표;
        const i = (a * nE + e) * 5;
        gridG[i] = g.tau;
        gridG[i + 1] = g.shadowContrast;
        gridG[i + 2] = g.cellStrength;
        gridG[i + 3] = g.cellSizeKm > 0.001 ? g.cellSizeKm : nominal;
        gridG[i + 4] = Math.max(1, g.cellAspect);
        if (g.cellStrength > anyCells) anyCells = g.cellStrength;
      }
    }
    const optArr = l.opticsAttr.array as Float32Array;
    const aspArr = l.aspectAttr.array as Float32Array;
    for (let i = 0; i < dirs.length; i++) {
      sampleGridInto(gridG, 5, azSteps, elevs, dirs[i].azDeg, dirs[i].elevDeg, _optics5, 0);
      optArr[i * 4] = _optics5[0];
      optArr[i * 4 + 1] = _optics5[1];
      optArr[i * 4 + 2] = _optics5[2];
      optArr[i * 4 + 3] = _optics5[3];
      aspArr[i] = _optics5[4];
    }
    l.opticsAttr.needsUpdate = true;
    l.aspectAttr.needsUpdate = true;

    const uni = l.material.uniforms;
    const beam = u.beamFor(LAYER_ALTITUDE_KM[l.layer]);
    (uni.uBeam.value as THREE.Vector3).set(beam.r, beam.g, beam.b);
    (uni.uSunDir.value as THREE.Vector3).copy(u.sunDir);

    // 채널(billow/fbm)만 층당 하나로 남습니다 — 왜인지는 `genusFor` 주석 참고.
    const mask = CELL_CHANNEL_MASK[cellCfg.cellVariant];
    (uni.uCellMaskA.value as THREE.Vector4).fromArray(mask.a);
    (uni.uCellMaskB.value as THREE.Vector4).fromArray(mask.b);
    // 입체 음영 분기는 uniform 이어야 합니다 (FRAG의 uAnyCells 주석 참고).
    uni.uAnyCells.value = anyCells;

    // 바람 bearing → XZ 단위벡터. 덱 기하와 같은 규약을 씁니다
    // (buildDeckGeometry: x = sin(az), z = -cos(az)).
    // 필라멘트 축은 180° 주기라 "불어오는/불어가는" 구분은 결과에 영향이 없습니다.
    const windRad = (u.windBearingDeg * Math.PI) / 180;
    const windX = Math.sin(windRad);
    const windZ = -Math.cos(windRad);
    // 가로지르는 축 = 바람 축을 90° 돌린 것
    (uni.uCellAcross.value as THREE.Vector2).set(windZ, -windX);
    uni.uPixelAngleRad.value = u.pixelAngleRad;
    uni.uSunAltDeg.value = u.sunAltDeg;
    uni.uTime.value = u.timeSeconds;

    // 4단계: 대기 투시 — 빌보드(CloudField.ts)와 같은 값.
    uni.uBeta.value = u.betaMie;
    uni.uAngstrom.value = u.angstrom;
    uni.uElevScale.value = u.elevScale;

    // 운량이 사실상 0인 층만 끕니다.
    //
    // 예전 문턱은 0.45였습니다. 덱이 "BKN/OVC에서만 얹는 보조"였을 때는
    // 맞는 값이었지만(merge가 0.20에서 시작해 0.85에서 차므로 그 아래는
    // 기여가 거의 없었습니다), 2단계부터 덱이 층상운의 **주역**이라
    // 그 문턱은 운량 45% 미만의 하늘을 통째로 지워 버립니다.
    // 기준 사진(고적운 39%)이 정확히 여기 걸렸습니다.
    l.mesh.visible = u.visible && maxCover > 0.02;
  }
}
