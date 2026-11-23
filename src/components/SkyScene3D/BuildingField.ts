/**
 * BuildingField.ts — 반경 1 km LOD1 건물 고도 매스 메시 (구면 투영 + 지형 3패스 호환).
 *
 * TerrainField / SeaPlane 과 동일한 `GROUND_PROJECT_GLSL` 및 `ringRadius` 깊이 규약을 쓰므로,
 * 산·언덕·지평선·구름·해·달과의 앞뒤 가림(depth)이 정확히 일치하며
 * 볼륨 하늘의 `LAYER_TERRAIN_DIST`(구름 차단) · `LAYER_TERRAIN_LIT`(하늘/태양/연무 조도)에도 함께 들어갑니다.
 */
import * as THREE from 'three';
import { DEM_GLSL, demGlsl, makeDemUniforms, setDemObserver, type DemPatch } from '../../utils/demTiles';
import { ATMOSPHERE_GLSL, GROUND_DISPLAY_GLSL, makeTuningUniforms } from '../../utils/atmosphere';
import {
  GROUND_PROJECT_GLSL,
  RADIUS_FAR,
  RADIUS_NEAR,
  RADIUS_REF_FAR_M,
  RADIUS_REF_NEAR_M,
} from './groundProjection';
import { LAYER_TERRAIN_DIST, LAYER_TERRAIN_LIT, TERRAIN_DIST_GLSL } from './SceneComposer';
import { LIT2_ENCODE_GLSL } from './terrainLook';
import { createBuildingThreeGeometry, WINDOW_CELL_M, type BuildingMeshData } from '../../utils/buildingTiles';
import { clamp01, smoothstep01 as smooth01 } from '../../utils/math';

/**
 * 현지 시각(0~24h)에 따른 야간 창문 점등 비율 (0~1).
 * - 저녁(16:00~21:30): 약 46% 점등
 * - 늦은 밤~자정(21:30~24:00): 46% -> 22% 점진 감소
 * - 심야(00:00~02:00): 22% -> 1% 감소
 * - 새벽 2시 이후(02:00~05:30): 1%(0.01) 유지 (건물당 floor 내림으로 소형 시골 건물은 완전 소등)
 */
export function computeNightWindowRate(localHour: number): number {
  const h = ((localHour % 24) + 24) % 24;
  if (h >= 2 && h < 5.5) return 0.01;
  if (h < 2) return 0.22 - (0.22 - 0.01) * smooth01(h / 2.0);
  if (h >= 21.5) return 0.46 - (0.46 - 0.22) * smooth01((h - 21.5) / 2.5);
  if (h >= 16) return 0.46;
  if (h < 8.5) return 0.01 + (0.24 - 0.01) * smooth01((h - 5.5) / 3.0);
  return 0.24 + (0.46 - 0.24) * smooth01((h - 8.5) / 7.5);
}

/** 태양 고도(°), 도시 불빛 옵션 및 지역 빛지도 밝기(localNorm)에 따른 창문 발광 세기. */
export function computeNightWindowGlow(sunAltDeg: number, cityLightsEnabled: boolean = true, localNorm: number = 1): number {
  if (!cityLightsEnabled || !Number.isFinite(sunAltDeg)) return 0;
  const regionScale = 0.25 + 0.75 * Math.max(0, Math.min(1, localNorm));
  return smooth01((6.0 - sunAltDeg) / 10.0) * regionScale;
}

const BUILDING_VERT = /* glsl */ `
precision highp float;
${DEM_GLSL}
${demGlsl('demEye')}
${demGlsl('demFar')}
${GROUND_PROJECT_GLSL}

attribute vec2 aGroundPos;
attribute vec4 aWallCoord;
attribute float aStyle;

uniform float uObsElevM;
uniform float uEyeHeightM;
uniform float uBlendInner;
uniform vec2  uBldEyeOffset;

varying vec3  vNormalW;
varying float vDistM;
varying float vSlantM;
varying vec3  vViewDir;
varying vec2  vBuildPos;
varying vec4  vWallCoord;
varying float vStyle;

float bf_groundAtEye() {
  if (uDemEyeValid > 0.5) return demEye_elevationAt(vec2(0.0));
  return uDemValid > 0.5 ? dem_elevationAt(vec2(0.0)) : uObsElevM;
}

float bf_fineWeight(vec2 g) {
  if (uDemValid < 0.5) return 0.0;
  float rp = dem_probeRadiusM();
  return 1.0 - smoothstep(rp * uBlendInner, rp * 0.98, length(g));
}

float bf_groundElev(vec2 g) {
  bool hasFine = uDemValid > 0.5;
  bool hasFar = uDemFarValid > 0.5;
  if (!hasFine && !hasFar) return uObsElevM;
  if (!hasFar) return dem_elevationAt(g);
  if (!hasFine) return demFar_elevationDespiked(g);
  float w = bf_fineWeight(g);
  if (w <= 0.001) return demFar_elevationDespiked(g);
  if (w >= 0.999) return dem_elevationAt(g);
  return mix(demFar_elevationDespiked(g), dem_elevationAt(g), w);
}

float bf_ringRadius(float distM) {
  float t = log(max(distM, ${RADIUS_REF_NEAR_M.toFixed(1)}) / ${RADIUS_REF_NEAR_M.toFixed(1)})
          / log(${RADIUS_REF_FAR_M.toFixed(1)} / ${RADIUS_REF_NEAR_M.toFixed(1)});
  return ${RADIUS_NEAR.toFixed(1)} + ${(RADIUS_FAR - RADIUS_NEAR).toFixed(1)} * clamp(t, 0.0, 1.0);
}

void main() {
  vec2 g = vec2(position.x, position.z) - uBldEyeOffset;
  float d = max(length(g), 0.1);
  float r = bf_ringRadius(d);

  // 건물 중심 지반 고도에 상대 높이(position.y)를 더해 경사지 위에서도 옥상이 수평을 유지
  vec2 gCenter = aGroundPos - uBldEyeOffset;
  float baseElevM = bf_groundElev(gCenter);
  float h = baseElevM + position.y;
  float eyeElevM = bf_groundAtEye() + uEyeHeightM;

  vec3 p = gp_project(g, h, eyeElevM, r);
  float dzM = h - eyeElevM - gp_drop(d);
  vSlantM = sqrt(d * d + dzM * dzM);
  vDistM = d;
  vNormalW = normalize(normal);
  vViewDir = normalize(p);
  vBuildPos = aGroundPos;
  vWallCoord = aWallCoord;
  vStyle = aStyle;

  vec4 wp = modelMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

/**
 * 2026-11-18 가로등 머리(사용자 제안: 큰 도로에 가로등). 건물과 같은 지반 고도·투영 규약(BUILDING_VERT 머리)을 쓰고,
 * 땅 위 position.y(9 m) 자리에 화면 크기 점으로 그립니다. 멀수록 작아지고(1.5~9 px) 대기에 잠깁니다.
 */
const LAMP_VERT = BUILDING_VERT.slice(0, BUILDING_VERT.indexOf('void main() {')) + /* glsl */ `
uniform float uLampPx;
varying float vElevSin;
void main() {
  vec2 g = vec2(position.x, position.z) - uBldEyeOffset;
  float d = max(length(g), 0.1);
  // 240 m 이내의 가까운 가로등은 3D 가로등 형태(lampMesh3D)가 전담하므로 점 스프라이트를 그리지 않음
  if (d < 240.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    return;
  }
  float r = bf_ringRadius(d);
  float h = bf_groundElev(g) + position.y;
  float eyeElevM = bf_groundAtEye() + uEyeHeightM;
  vec3 p = gp_project(g, h, eyeElevM, r);
  vDistM = d;
  vElevSin = p.y / max(length(p), 0.001);
  vec4 wp = modelMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * viewMatrix * wp;
  gl_PointSize = clamp(uLampPx * 200.0 / d, 3.0 * uLampPx, 10.0 * uLampPx);
}
`;
const LAMP_FRAG = /* glsl */ `
precision highp float;
${ATMOSPHERE_GLSL}
varying float vDistM;
varying float vElevSin;
uniform float uLampGlow;
uniform float uBeta;
uniform float uAngstrom;
uniform float uElevScale;
void main() {
  if (vDistM < 240.0 || uLampGlow <= 0.001) discard;
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  if (dot(q, q) > 1.0) discard;
  // 지평선 위 하늘과 겹쳐 별과 혼동되는 것을 원천 차단 (지평선 아래 도로만 은은히 표시)
  float skyGuard = 1.0 - smoothstep(-0.004, 0.016, vElevSin);
  if (skyGuard <= 0.002) discard;
  vec2 bulb = vec2(q.x * 0.85, (q.y + 0.42) * 1.35);
  float r2 = dot(bulb, bulb);
  float hood = smoothstep(-0.22, 0.04, q.y + 0.42);
  float core = exp(-r2 * 22.0) * hood;
  float halo = exp(-r2 * 5.2) * mix(0.2, 1.0, hood);
  float intensity = core + halo * 0.7;
  if (intensity <= 0.003) discard;
  vec3 T = atm_aerialTransmittance(vDistM / 1000.0, 0.0, uBeta, uAngstrom, uElevScale);
  float nearIn = smoothstep(240.0, 330.0, vDistM);
  float fade = (1.0 - smoothstep(1350.0, 1580.0, vDistM)) * nearIn;
  vec3 col = vec3(1.00, 0.93, 0.78) * core + vec3(1.00, 0.56, 0.16) * halo * 0.7;
  gl_FragColor = vec4(col * uLampGlow * T * fade * skyGuard, 1.0);
}
`;

/**
 * 2026-11-23 근·중거리(400 m 이내, 300 m 까지 원형 유지)의 3D 가로등(기둥·팔·갓·전구) 셰이더.
 * 밤하늘 배경과 겹쳐도 기둥과 갓 실루엣이 뚜렷이 보여 별과 혼동되지 않으며,
 * 먼 거리(300~400 m)에서 서서히 자라나 근거리에서는 바닥에서 자라나는 느낌이 보이지 않습니다.
 */
const LAMP_3D_VERT = BUILDING_VERT.slice(0, BUILDING_VERT.indexOf('void main() {')) + /* glsl */ `
attribute vec2 aLampXZ;
attribute vec2 aLampDir;
attribute float aPart;
varying float vPart;
varying float vLocalY;
void main() {
  vec2 gCenter = aLampXZ - uBldEyeOffset;
  float dCenter = length(gCenter);
  if (dCenter > 400.0 || dCenter < 0.4) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  float scaleFade = 1.0 - smoothstep(300.0, 400.0, dCenter);
  vec2 fDir = length(aLampDir) > 0.1 ? normalize(aLampDir) : vec2(1.0, 0.0);
  vec2 rDir = vec2(-fDir.y, fDir.x);
  vec3 localPos = position * scaleFade;
  vec2 worldXZ = localPos.x * fDir + localPos.z * rDir;
  vec2 g = gCenter + worldXZ;
  float d = max(length(g), 0.1);
  float r = bf_ringRadius(d);
  float baseElevM = bf_groundElev(gCenter);
  float h = baseElevM + localPos.y;
  float eyeElevM = bf_groundAtEye() + uEyeHeightM;
  vec3 p = gp_project(g, h, eyeElevM, r);
  vDistM = d;
  vPart = aPart;
  vLocalY = position.y;
  vNormalW = normalize(vec3(
    normal.x * fDir.x + normal.z * rDir.x,
    normal.y,
    normal.x * fDir.y + normal.z * rDir.y
  ));
  vec4 wp = modelMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
const LAMP_3D_FRAG = /* glsl */ `
precision highp float;
${ATMOSPHERE_GLSL}
${GROUND_DISPLAY_GLSL}
varying vec3  vNormalW;
varying float vDistM;
varying float vPart;
varying float vLocalY;
uniform float uLampGlow;
uniform float uSunAzRad;
uniform float uSunAltRad;
uniform float uSunAltDeg;
uniform vec3  uSurfaceIrr;
uniform vec3  uSunRadiance;
uniform float uExposure;
uniform float uSaturation;
uniform float uBeta;
uniform float uAngstrom;
uniform float uElevScale;
void main() {
  vec3 n = normalize(vNormalW);
  if (vPart > 0.5) {
    // 전구 발광면: 밤에는 따뜻한 가로등 불빛, 낮에는 밝은 유리/반사판
    vec3 dayCol = vec3(0.42, 0.44, 0.48) * uSurfaceIrr;
    vec3 bulbEmit = vec3(1.00, 0.78, 0.42) * (0.65 + 1.35 * uLampGlow) * step(0.001, uLampGlow);
    vec3 col = dayCol + bulbEmit;
    gl_FragColor = vec4(atm_display_ground(col * uExposure, uSaturation, uSunAltDeg) + bulbEmit * 0.45, 1.0);
    return;
  }
  vec3 sun = vec3(cos(uSunAltRad) * sin(uSunAzRad), sin(uSunAltRad), -cos(uSunAltRad) * cos(uSunAzRad));
  float ndl = max(0.0, dot(n, sun));
  float sunUp = max(0.0, sin(uSunAltRad));
  vec3 directFlat = (uSunRadiance * sunUp) / 3.14159265;
  vec3 skyIrr = max(vec3(0.0), uSurfaceIrr - directFlat);
  vec3 directLit = (uSunRadiance * ndl) / 3.14159265;
  vec3 metalAlb = vec3(0.055, 0.055, 0.058) * (0.78 + 0.22 * n.y);
  vec3 col = metalAlb * (skyIrr + directLit);
  vec3 T = atm_aerialTransmittance(vDistM / 1000.0, 0.0, uBeta, uAngstrom, uElevScale);
  col *= T;
  // 기둥·팔·갓 자체는 발광하지 않고(uExposure 미적용), 밤에는 등기구 갓 아랫면(전구 주변)만 은은히 비침
  float hoodUnder = smoothstep(8.30, 8.60, vLocalY) * max(0.0, -n.y);
  vec3 hoodBounce = vec3(0.32, 0.23, 0.12) * uLampGlow * hoodUnder * 0.45 * T;
  vec3 nightSilhouette = vec3(0.022, 0.023, 0.026) * uLampGlow * (0.75 + 0.25 * max(0.0, n.y)) * T;
  gl_FragColor = vec4(atm_display_ground(col * uExposure, uSaturation, uSunAltDeg) + nightSilhouette + hoodBounce, 1.0);
}
`;

const BUILDING_FRAG = /* glsl */ `
precision highp float;

uniform float uEyeHeightM;

varying vec3  vNormalW;
varying float vDistM;
varying float vSlantM;
varying vec3  vViewDir;
// 건물 자리(건물마다 다른 씨앗). 창문·빛 판·기본 세 갈래가 모두 씁니다 — 2026-11-18 전에는 창문 갈래에만 선언돼
// 빛 판·기본 갈래 셰이더가 컴파일되지 않아(bSeed 미선언) 외벽이 통째로 안 그려졌습니다.
varying vec2  vBuildPos;
varying vec4  vWallCoord;
varying float vStyle;

float bf_hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}

/**
 * 2026-11-23 볼륨(TERRAIN_LIT_OUT) · 직접(#else) 패스 공용 외장/지붕 질감 계산.
 * 밤에도 맨박스처럼 보이지 않도록 스타일별 창틀·멀리언·벽돌 줄눈·골강판·파라펫 테두리를 생성합니다.
 */
void bf_facadeMaterial(
  vec3 n,
  vec2 bSeed,
  float bTone,
  float bWarm,
  float detailFade,
  out vec3 outMatAlb,
  out float outGlassMask,
  out float outGroundAo
) {
  outMatAlb = vec3(0.20, 0.205, 0.215);
  outGlassMask = 0.0;
  outGroundAo = 1.0;

  if (abs(n.y) > 0.5) {
    // 옥상/지붕면: 경사 지붕(n.y < 0.99)은 기와·슬레이트·금속, 평지붕은 방수 아스팔트 + 미세 입자 질감
    float isSloped = step(n.y, 0.99);
    float roofGrain = detailFade > 0.01
      ? (0.92 + 0.16 * bf_hash13(vec3(floor(vBuildPos * 0.8), bTone * 13.0)))
      : 1.0;
    vec3 flatRoofTone = vStyle < 0.5
      ? mix(vec3(0.11, 0.12, 0.125), vec3(0.10, 0.13, 0.115), bWarm)
      : (vStyle < 1.5
        ? vec3(0.115, 0.12, 0.13)
        : (vStyle < 2.5 ? vec3(0.12, 0.11, 0.10) : vec3(0.095, 0.10, 0.11)));
    vec3 slopedRoofTone = vStyle < 0.5
      ? mix(vec3(0.19, 0.11, 0.085), vec3(0.12, 0.125, 0.135), bWarm)
      : (vStyle < 2.5
        ? mix(vec3(0.17, 0.10, 0.08), vec3(0.13, 0.145, 0.13), bWarm)
        : vec3(0.135, 0.145, 0.16));
    outMatAlb = mix(flatRoofTone, slopedRoofTone, isSloped) * (0.92 + 0.16 * bTone) * roofGrain;
    return;
  }

  // 지면 접지 음영(1~3층 가로 협곡 그늘)
  outGroundAo = 0.54 + 0.46 * smoothstep(0.0, 10.5, max(0.0, vWallCoord.y));

  // 원거리(>680m) 또는 상공 조감도(uEyeHeightM > 320m)에서는 서브픽셀 창틀·벽돌 줄눈 연산을 즉시 생략
  if (detailFade <= 0.005) {
    if (vStyle < 0.5) {
      outMatAlb = mix(vec3(0.245, 0.24, 0.225), vec3(0.195, 0.20, 0.21), bWarm) * (0.90 + 0.20 * bTone);
    } else if (vStyle < 1.5) {
      vec3 mullion = vec3(0.165, 0.175, 0.19) * (0.9 + 0.2 * bTone);
      vec3 curtainGlass = mix(vec3(0.048, 0.072, 0.105), vec3(0.052, 0.084, 0.095), bWarm);
      outMatAlb = mix(mullion, curtainGlass, 0.60);
    } else if (vStyle < 2.5) {
      outMatAlb = mix(vec3(0.225, 0.145, 0.112), vec3(0.24, 0.20, 0.158), bWarm) * (0.88 + 0.24 * bTone);
    } else {
      outMatAlb = vec3(0.125, 0.13, 0.14) * (0.90 + 0.20 * bTone);
    }
    return;
  }

  float cellU = vWallCoord.x / ${WINDOW_CELL_M.toFixed(1)};
  float cellV = vWallCoord.y / ${WINDOW_CELL_M.toFixed(1)};
  float colIdx = floor(cellU);
  float rowIdx = floor(cellV);
  float uF = fract(cellU);
  float vF = fract(cellV);
  float inGrid = step(0.0, vWallCoord.x) * step(0.0, vWallCoord.y)
    * step(cellU, vWallCoord.z) * step(cellV, vWallCoord.w);

  // 상단 옥상 파라펫/처마 띠(앞뒤 건물 실루엣 분리)
  float wallH = max(${WINDOW_CELL_M.toFixed(1)}, vWallCoord.w * ${WINDOW_CELL_M.toFixed(1)});
  float topDist = max(0.0, wallH - max(0.0, vWallCoord.y));
  float parapetRim = 1.0 - smoothstep(0.0, 0.42, topDist);
  float corniceShadow = smoothstep(0.35, 0.55, topDist) * (1.0 - smoothstep(0.65, 1.15, topDist));

  if (vStyle < 0.5) {
    // 0: 아파트·주거 — 콘크리트 패널 이음새 + 미세 표면 입자 + 펀치드 윈도우 창틀 음영
    float micro = 0.93 + 0.14 * bf_hash13(vec3(floor(vWallCoord.x * 2.2), floor(vWallCoord.y * 2.2), bSeed.x));
    float jointX = 1.0 - smoothstep(0.0, 0.04, abs(fract(cellU * 0.5) - 0.5));
    float slabLine = 1.0 - smoothstep(0.0, 0.13, vF);
    vec3 aptWall = mix(vec3(0.245, 0.24, 0.225), vec3(0.195, 0.20, 0.21), bWarm) * (0.90 + 0.20 * bTone);
    aptWall *= mix(1.0, micro * (1.0 - 0.14 * slabLine - 0.08 * jointX), detailFade);
    float aa = clamp(vDistM * 0.00055, 0.02, 0.20);
    float wx = smoothstep(0.22 - aa, 0.22 + aa, uF) * (1.0 - smoothstep(0.78 - aa, 0.78 + aa, uF));
    float wy = smoothstep(0.28 - aa, 0.28 + aa, vF) * (1.0 - smoothstep(0.74 - aa, 0.74 + aa, vF));
    float frameX = smoothstep(0.16 - aa, 0.16 + aa, uF) * (1.0 - smoothstep(0.84 - aa, 0.84 + aa, uF));
    float frameY = smoothstep(0.22 - aa, 0.22 + aa, vF) * (1.0 - smoothstep(0.80 - aa, 0.80 + aa, vF));
    float frameRing = max(0.0, frameX * frameY - wx * wy) * inGrid * detailFade;
    outGlassMask = wx * wy * inGrid * detailFade;
    vec3 glassCol = vec3(0.045, 0.062, 0.085);
    outMatAlb = mix(aptWall * (1.0 - 0.24 * frameRing), glassCol, outGlassMask);
  } else if (vStyle < 1.5) {
    // 1: 오피스·타워 — 유리 커튼월 + 층간 스팬드럴 띠 + 칸별 유리 톤 편차 + 알루미늄 멀리언
    vec3 mullion = vec3(0.165, 0.175, 0.19) * (0.9 + 0.2 * bTone);
    float paneVar = 0.84 + 0.32 * bf_hash13(vec3(colIdx + 3.0, rowIdx + 11.0, bSeed.y));
    vec3 curtainGlass = mix(vec3(0.048, 0.072, 0.105), vec3(0.052, 0.084, 0.095), bWarm) * paneVar;
    float spandrel = 1.0 - smoothstep(0.15, 0.23, vF);
    float aa = clamp(vDistM * 0.00055, 0.02, 0.18);
    float wx = smoothstep(0.09 - aa, 0.09 + aa, uF) * (1.0 - smoothstep(0.91 - aa, 0.91 + aa, uF));
    float wy = smoothstep(0.22 - aa, 0.22 + aa, vF) * (1.0 - smoothstep(0.89 - aa, 0.89 + aa, vF));
    outGlassMask = wx * wy * inGrid * detailFade;
    vec3 spandrelCol = mullion * 0.68;
    vec3 frameCol = mix(mullion, spandrelCol, spandrel * detailFade);
    outMatAlb = mix(frameCol, curtainGlass, mix(0.60, outGlassMask, detailFade));
  } else if (vStyle < 2.5) {
    // 2: 저층 상가·벽돌/석재 — 영식/이식 벽돌·석재 줄눈 질감 + 1층 쇼윈도
    float brickRow = floor(vWallCoord.y * 4.5);
    float brickCol = floor(vWallCoord.x * 2.0 + mod(brickRow, 2.0) * 0.5);
    float bVar = 0.86 + 0.28 * bf_hash13(vec3(brickCol, brickRow, bSeed.x));
    float mortarH = 1.0 - smoothstep(0.0, 0.14, abs(fract(vWallCoord.y * 4.5) - 0.5));
    float mortarV = 1.0 - smoothstep(0.0, 0.10, abs(fract(vWallCoord.x * 2.0 + mod(brickRow, 2.0) * 0.5) - 0.5));
    float mortar = max(mortarH, mortarV) * detailFade;
    vec3 brickBase = mix(vec3(0.225, 0.145, 0.112), vec3(0.24, 0.20, 0.158), bWarm) * (0.88 + 0.24 * bTone);
    vec3 brickWall = brickBase * mix(1.0, bVar * (1.0 - 0.22 * mortar), detailFade);
    float isGround = 1.0 - smoothstep(3.0, 3.6, vWallCoord.y);
    float aa = clamp(vDistM * 0.00055, 0.02, 0.20);
    float wx = mix(
      smoothstep(0.24 - aa, 0.24 + aa, uF) * (1.0 - smoothstep(0.76 - aa, 0.76 + aa, uF)),
      smoothstep(0.08 - aa, 0.08 + aa, uF) * (1.0 - smoothstep(0.92 - aa, 0.92 + aa, uF)),
      isGround
    );
    float wy = mix(
      smoothstep(0.30 - aa, 0.30 + aa, vF) * (1.0 - smoothstep(0.74 - aa, 0.74 + aa, vF)),
      smoothstep(0.10 - aa, 0.10 + aa, vF) * (1.0 - smoothstep(0.90 - aa, 0.90 + aa, vF)),
      isGround
    );
    outGlassMask = wx * wy * inGrid * detailFade;
    outMatAlb = mix(brickWall, vec3(0.042, 0.056, 0.076), outGlassMask);
  } else {
    // 3: 산업·창고 — 골강판 리브 + 수평 패널 이음새 + 상부 채광창
    vec3 metalWall = vec3(0.125, 0.13, 0.14) * (0.90 + 0.20 * bTone);
    float rib = sin(vWallCoord.x * 6.28318 * 2.0) * 0.11 * detailFade;
    float seam = (1.0 - smoothstep(0.0, 0.06, fract(vWallCoord.y * 0.4))) * 0.15 * detailFade;
    float clerestory = smoothstep(0.72, 0.78, vF) * (1.0 - smoothstep(0.88, 0.92, vF)) * inGrid * detailFade * 0.65;
    outGlassMask = clerestory;
    outMatAlb = mix(metalWall * (1.0 + rib - seam), vec3(0.055, 0.066, 0.082), clerestory);
  }

  outMatAlb *= (1.0 + 0.14 * parapetRim * detailFade - 0.14 * corniceShadow * detailFade);
}

#ifdef TERRAIN_DIST_OUT
${TERRAIN_DIST_GLSL}
void main() {
  gl_FragColor = terrainDistEncode(vSlantM / 1000.0);
}
#elif defined(TERRAIN_WINDOW_OUT)
${ATMOSPHERE_GLSL}

uniform float uWinRate;
uniform float uWinGlow;
uniform float uBeta;
uniform float uAngstrom;
uniform float uElevScale;

void main() {
  if (uWinGlow <= 0.001 || uWinRate <= 0.0 || vDistM > 8500.0 || uEyeHeightM > 900.0) discard;
  if (vWallCoord.x < 0.0 || vWallCoord.y < 0.0 || abs(vNormalW.y) > 0.5) discard;
  // 창고/산업 시설(style 3)은 야간 창문 점등 대폭 축소
  float styleRate = vStyle > 2.5 ? uWinRate * 0.15 : uWinRate;

  float cellU = vWallCoord.x / ${WINDOW_CELL_M.toFixed(1)};
  float cellV = vWallCoord.y / ${WINDOW_CELL_M.toFixed(1)};
  float colIdx = floor(cellU);
  float rowIdx = floor(cellV);
  if (colIdx < 0.0 || colIdx >= vWallCoord.z || rowIdx < 0.0 || rowIdx >= vWallCoord.w) discard;

  // 건물 전체 창문 개수에 내림(floor) 적용 → 2시 이후 1%일 때 소형 시골 건물(<100칸)은 0개로 완전 소등
  float totalWin = vWallCoord.z * vWallCoord.w;
  float litQuota = floor(totalWin * clamp(styleRate, 0.0, 1.0));
  if (litQuota < 0.5) discard;

  vec2 bSeed = fract(vBuildPos * 0.0173) * 97.0;
  float seedZ = bSeed.x * 1.31 + bSeed.y * 2.17;
  float rLit = bf_hash13(vec3(colIdx + 1.0, rowIdx + 1.0, seedZ));
  if (rLit >= litQuota / max(1.0, totalWin)) discard;

  float uF = fract(cellU);
  float vF = fract(cellV);
  float farPad = smoothstep(500.0, 2600.0, vDistM) * 0.16;
  float aa = clamp(vDistM * 0.00055, 0.02, 0.24);
  float wx = smoothstep(0.25 - farPad - aa, 0.25 - farPad + aa, uF) * (1.0 - smoothstep(0.75 + farPad - aa, 0.75 + farPad + aa, uF));
  float wy = smoothstep(0.30 - farPad - aa, 0.30 - farPad + aa, vF) * (1.0 - smoothstep(0.74 + farPad - aa, 0.74 + farPad + aa, vF));
  float winShape = mix(wx * wy, 0.78, smoothstep(1400.0, 3600.0, vDistM));
  if (winShape < 0.01) discard;

  float rTone = bf_hash13(vec3(colIdx + 19.0, rowIdx + 7.0, seedZ * 1.37 + 5.0));
  vec3 colWarm = vec3(1.00, 0.68, 0.30);
  vec3 colSoft = vec3(1.00, 0.86, 0.62);
  vec3 colCool = vec3(0.84, 0.91, 1.00);
  vec3 winTint = rTone < 0.58 ? mix(colWarm, colSoft, rTone / 0.58)
                              : mix(colSoft, colCool, ((rTone - 0.58) / 0.42) * 0.65);

  float lum = (0.48 + 0.34 * rTone) * uWinGlow * (0.82 + 0.24 * vF);
  vec3 T = atm_aerialTransmittance(vDistM / 1000.0, 0.0, uBeta, uAngstrom, uElevScale);
  float distFade = 1.0 - smoothstep(4500.0, 8500.0, vDistM);
  gl_FragColor = vec4(winTint * winShape * lum * T * distFade, 1.0);
}
#elif defined(TERRAIN_LIT_OUT)
${TERRAIN_DIST_GLSL}
${LIT2_ENCODE_GLSL}

uniform float uSunAzRad;
uniform float uSunAltRad;
uniform float uMoonAzRad;
uniform float uMoonAltRad;
uniform float uOvercast;
uniform vec2  uCityDirXZ;

layout(location = 1) out highp vec4 pc_fragColor1;
layout(location = 2) out highp vec4 pc_fragColor2;

void main() {
  vec3 n = normalize(vNormalW);
  vec3 sun = vec3(cos(uSunAltRad) * sin(uSunAzRad),
                  sin(uSunAltRad),
                 -cos(uSunAltRad) * cos(uSunAzRad));
  float ndl = max(0.0, dot(n, sun));
  vec3 moon = vec3(cos(uMoonAltRad) * sin(uMoonAzRad),
                   sin(uMoonAltRad),
                  -cos(uMoonAltRad) * cos(uMoonAzRad));
  float ndlMoon = uMoonAltRad > -0.02 ? max(0.0, dot(n, moon)) : 0.0;
  float cloudT = clamp(1.0 - uOvercast, 0.05, 1.0);

  vec2 bSeed = fract(vBuildPos * 0.0173) * 97.0;
  float bTone = fract(sin(dot(bSeed, vec2(127.1, 311.7))) * 43758.5453);
  float bWarm = fract(sin(dot(bSeed, vec2(269.5, 183.3))) * 43758.5453);
  float detailFade = (1.0 - smoothstep(320.0, 680.0, vDistM)) * (1.0 - smoothstep(140.0, 340.0, uEyeHeightM));

  vec3 facadeAlb;
  float glassMask;
  float groundAo;
  bf_facadeMaterial(n, bSeed, bTone, bWarm, detailFade, facadeAlb, glassMask, groundAo);

  // 수직 벽면도 방위(도시광 주 방향 + 직교 보조축)와 높이에 따라 밝기가 달라져 꺾인 건물 면과 앞·뒤 건물 실루엣이 분리됩니다.
  vec2 cDir = normalize(uCityDirXZ + vec2(1e-5));
  vec2 cPerp = vec2(-cDir.y, cDir.x);
  vec2 nXZ = normalize(vec2(n.x, n.z) + vec2(1e-5));
  float wallAz = 0.82 + 0.40 * dot(nXZ, cDir) + 0.16 * dot(nXZ, cPerp);
  float heightGrad = abs(n.y) > 0.5 ? 1.0 : (0.82 + 0.26 * smoothstep(0.0, 26.0, max(0.0, vWallCoord.y)));
  float skyHemi = abs(n.y) > 0.5
    ? (0.96 + 0.14 * n.y)
    : clamp(0.54 * wallAz * groundAo * heightGrad, 0.16, 1.15);

  float fillGeo = clamp((dot(n, sun) + 0.6) / 1.6, 0.0, 1.0);
  float fillFlat = clamp((sin(uSunAltRad) + 0.6) / 1.6, 0.05, 1.0);
  float fill = (1.0 - cloudT) * 0.45 * clamp(fillGeo / fillFlat, 0.0, 2.0);
  vec3 grayShift = vec3(0.92 + 0.16 * bTone) * vec3(1.0 + (bWarm - 0.5) * 0.05, 1.0, 1.0 - (bWarm - 0.5) * 0.05);
  vec3 litAlb = facadeAlb * 0.65 * grayShift;
  if (abs(n.y) > 0.5) {
    litAlb *= 0.84;
  }
  float litDirect = clamp(max(ndl, ndlMoon) * cloudT, 0.0, 1.0);
  gl_FragColor = vec4(sqrt(clamp(litAlb, 0.0, 1.0)), litDirect);
  pc_fragColor1 = lit2Encode(skyHemi, 0.0, fill, 1.0 - cloudT);
  pc_fragColor2 = terrainDistEncode(vSlantM / 1000.0);
}
#else

${ATMOSPHERE_GLSL}
${GROUND_DISPLAY_GLSL}

uniform float uDepthOnly;
uniform float uSunAzRad;
uniform float uSunAltRad;
uniform float uSunAltDeg;
uniform float uMoonAzRad;
uniform float uMoonAltRad;
uniform vec3  uSurfaceIrr;
uniform vec3  uSunRadiance;
uniform vec3  uMoonRadiance;
uniform float uExposure;
uniform float uSaturation;
uniform vec3  uHazeRadiance;
uniform float uAerial;
uniform float uBeta;
uniform float uAngstrom;
uniform float uElevScale;
uniform float uOzoneDU;
uniform float uOvercast;
uniform float uDiagRaw;
uniform float uCityWallGain;
uniform vec2  uCityDirXZ;

void main() {
  if (uDepthOnly > 0.5) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  vec3 n = normalize(vNormalW);
  vec3 sun = vec3(cos(uSunAltRad) * sin(uSunAzRad),
                  sin(uSunAltRad),
                 -cos(uSunAltRad) * cos(uSunAzRad));
  float ndl = max(0.0, dot(n, sun));
  float cloudT = clamp(1.0 - uOvercast, 0.05, 1.0);

  vec3 moon = vec3(cos(uMoonAltRad) * sin(uMoonAzRad),
                   sin(uMoonAltRad),
                  -cos(uMoonAltRad) * cos(uMoonAzRad));
  float ndlMoon = max(0.0, dot(n, moon)) * cloudT;
  float sunUp = max(0.0, sin(uSunAltRad));
  float moonUp = max(0.0, sin(uMoonAltRad));
  vec3 directFlat = (uSunRadiance * sunUp + uMoonRadiance * moonUp) / 3.14159265;
  vec3 skyIrr = max(vec3(0.0), uSurfaceIrr - directFlat);
  vec3 directLit = (uSunRadiance * ndl * cloudT + uMoonRadiance * ndlMoon) / 3.14159265;

  // 건물 씨앗 + 타입별 외장 스타일 (0=아파트/주거, 1=오피스/커튼월, 2=상가/벽돌·석재, 3=창고/산업)
  vec2 bSeed = fract(vBuildPos * 0.0173) * 97.0;
  float bTone = fract(sin(dot(bSeed, vec2(127.1, 311.7))) * 43758.5453);
  float bWarm = fract(sin(dot(bSeed, vec2(269.5, 183.3))) * 43758.5453);
  float detailFade = (1.0 - smoothstep(320.0, 680.0, vDistM)) * (1.0 - smoothstep(140.0, 340.0, uEyeHeightM));

  vec3 alb;
  float glassMask;
  float groundAo;
  bf_facadeMaterial(n, bSeed, bTone, bWarm, detailFade, alb, glassMask, groundAo);

  vec2 cDir = normalize(uCityDirXZ + vec2(1e-5));
  vec2 cPerp = vec2(-cDir.y, cDir.x);
  vec2 nXZ = normalize(vec2(n.x, n.z) + vec2(1e-5));
  float wallAz = abs(n.y) > 0.5 ? 1.0 : (0.92 + 0.30 * dot(nXZ, cDir) + 0.14 * dot(nXZ, cPerp));
  float heightGrad = abs(n.y) > 0.5 ? 1.0 : (0.86 + 0.22 * smoothstep(0.0, 26.0, max(0.0, vWallCoord.y)));
  float hemi = (0.72 + 0.28 * n.y) * wallAz * heightGrad;

  vec3 col = alb * hemi * groundAo * (skyIrr + directLit);

  // 낮 창문 유리 프레넬 하늘·태양 반사 (유리창만 유광 반사)
  if (glassMask > 0.01) {
    vec3 V = normalize(-vViewDir);
    float ndv = max(0.0, dot(n, V));
    float fresnel = 0.04 + 0.96 * pow(1.0 - ndv, 4.0);
    vec3 H = normalize(sun + V);
    float spec = pow(max(0.0, dot(n, H)), 48.0) * cloudT;
    float glassGain = vStyle > 0.5 && vStyle < 1.5 ? 1.15 : 0.75;
    vec3 skyBounce = skyIrr * vec3(0.65, 0.80, 1.0) * 0.32 * fresnel;
    vec3 sunGlint = uSunRadiance * spec * 0.12 * fresnel;
    col += (skyBounce + sunGlint) * glassMask * glassGain;
  }

  // 지역 빛지도 기반 야간 건물 외벽 방향성 반사 (2900~3100K 도시광, 암부 대비 유지)
  if (uCityWallGain > 1e-5) {
    float cDirDot = 0.16 + 0.70 * max(0.0, dot(nXZ, cDir)) + 0.18 * max(0.0, dot(nXZ, cPerp));
    float wallSlope = 0.35 + 0.65 * (1.0 - abs(n.y));
    col += alb * vec3(1.00, 0.787, 0.573) * (uCityWallGain * cDirDot * wallSlope * groundAo * heightGrad);
  }

  if (uAerial > 0.5) {
    vec3 T = atm_aerialTransmittance(vDistM / 1000.0, 0.0, uBeta, uAngstrom, uElevScale);
    vec3 dir = normalize(vViewDir);
    float elevDeg = degrees(asin(clamp(dir.y, -1.0, 1.0)));
    float cosG = clamp(dot(dir, sun), -1.0, 1.0);
    vec3 haze = max(atm_skyRadianceLit(max(0.5, elevDeg), cosG, uSunAltDeg,
      max(0.001, uBeta), max(0.1, uAngstrom), max(0.1, uElevScale), max(50.0, uOzoneDU), vec3(1.0)), vec3(0.0));
    float hazeScale = 1.0 / max(1e-4, uExposure * atm_groundEyeAdapt(uSunAltDeg));
    col = col * T + haze * (1.0 - T) * hazeScale;
  }

  gl_FragColor = vec4(atm_display_ground(col * uExposure, uSaturation, uSunAltDeg), 1.0);
  if (uDiagRaw > 0.5) gl_FragColor = vec4(0.85, 0.85, 0.90, 1.0);
}
#endif
`;

/**
 * 2026-11-23 근·중거리(400 m 이내, 300 m 까지 원형 유지)의 가로등을 실제 3D 형태(기둥 · 팔 · 갓 · 전구)로 그리는 프로토타입 기하.
 * +X 방향을 도로 안쪽으로 두고(셰이더에서 aLampDir 로 회전), part=0 은 기둥·팔·갓, part=1 은 아래쪽 전구 발광면.
 */
function createLampPrototypeGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const parts: number[] = [];

  const pushQuad = (
    a: [number, number, number],
    b: [number, number, number],
    c: [number, number, number],
    d: [number, number, number],
    n: [number, number, number],
    part: number,
  ) => {
    for (const p of [a, b, c, a, c, d]) {
      positions.push(p[0], p[1], p[2]);
      normals.push(n[0], n[1], n[2]);
      parts.push(part);
    }
  };

  const addTaperBox = (
    x0: number, x1: number,
    y0: number, y1: number,
    z0: number, z1: number,
    topScaleXZ: number,
    part: number,
  ) => {
    const cx = (x0 + x1) * 0.5;
    const cz = (z0 + z1) * 0.5;
    const tx0 = cx + (x0 - cx) * topScaleXZ;
    const tx1 = cx + (x1 - cx) * topScaleXZ;
    const tz0 = cz + (z0 - cz) * topScaleXZ;
    const tz1 = cz + (z1 - cz) * topScaleXZ;

    pushQuad([tx0, y1, tz1], [tx1, y1, tz1], [tx1, y1, tz0], [tx0, y1, tz0], [0, 1, 0], part);
    pushQuad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], part);
    pushQuad([x0, y0, z1], [x1, y0, z1], [tx1, y1, tz1], [tx0, y1, tz1], [0, 0, 1], part);
    pushQuad([x1, y0, z0], [x0, y0, z0], [tx0, y1, tz0], [tx1, y1, tz0], [0, 0, -1], part);
    pushQuad([x1, y0, z1], [x1, y0, z0], [tx1, y1, tz0], [tx1, y1, tz1], [1, 0, 0], part);
    pushQuad([x0, y0, z0], [x0, y0, z1], [tx0, y1, tz1], [tx0, y1, tz0], [-1, 0, 0], part);
  };

  // 1) 기둥 (0 ~ 8.6m, 아래 0.26m → 위 0.16m)
  addTaperBox(-0.13, 0.13, 0.0, 8.60, -0.13, 0.13, 0.62, 0.0);
  // 2) 수평 암 / 브래킷 (기둥 꼭대기에서 도로 안쪽 +X 로 1.45m 뻗음)
  addTaperBox(0.02, 1.45, 8.38, 8.54, -0.06, 0.06, 1.0, 0.0);
  // 3) 등기구 갓 (위쪽과 옆쪽을 덮는 갓 — 밤하늘 위에서도 가로등 윤곽이 뚜렷함)
  addTaperBox(1.12, 1.80, 8.50, 8.68, -0.22, 0.22, 0.88, 0.0);
  // 4) 아래쪽 발광 전구판 (갓 아래에만 위치해 위쪽 별과 섞이지 않음)
  addTaperBox(1.18, 1.72, 8.43, 8.50, -0.16, 0.16, 1.0, 1.0);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('aPart', new THREE.Float32BufferAttribute(parts, 1));
  return geo;
}

export interface BuildingFieldHandle {
  mesh: THREE.Mesh;
  distMesh: THREE.Mesh;
  litMesh: THREE.Mesh;
  windowMesh: THREE.Mesh;
  /** 2026-11-18 중·원거리 가로등 점(지평선 아래 도로용). 부르는 쪽이 씬의 LAYER_MID 에 넣습니다. */
  lampPoints: THREE.Points;
  /** 2026-11-23 근·중거리(400 m 이내, 300 m 까지 원형 유지)의 실제 3D 가로등 형태(기둥·팔·갓·전구). */
  lampMesh3D: THREE.Mesh;
  /** 가로등 자리(동 x, 남 z, m) 쌍과 선택적 도로 방향 벡터(dx, dz). null 이면 지웁니다. */
  setLamps: (xz: Float32Array | null | undefined, dirs?: Float32Array | null | undefined) => void;
  /** 가로등 밝기(0 = 끔)와 화면 배율(점 크기). */
  setLampGlow: (glow: number, pixelRatio?: number) => void;
  material: THREE.ShaderMaterial;
  setBuildings: (data: BuildingMeshData | null) => void;
  setPatch: (patch: DemPatch | null, eyePatch?: DemPatch | null, farPatch?: DemPatch | null) => void;
  /** 눈이 (lat, lon) 으로 옮겨 갔다고 알립니다(`TerrainFieldHandle.setObserver` 와 같음). */
  setObserver: (lat: number, lon: number) => void;
  /** 건물 기준점 대비 현재 눈의 오프셋(동쪽 m, 남쪽 m)을 셰이더에 전달해 이동 중에도 건물이 부드럽게 지나가게 합니다. */
  setEyeOffset: (eastM: number, southM: number) => void;
  setVisible: (v: boolean) => void;
  setWindowLighting: (rate: number, glow: number) => void;
  hasGeometry: () => boolean;
  geomSerial: () => number;
  dispose: () => void;
}

export function createBuildingField(opts: { observerElevM?: number; eyeHeightM?: number } = {}): BuildingFieldHandle {
  const uniforms: Record<string, THREE.IUniform> = {
    ...makeTuningUniforms(),
    ...makeDemUniforms(null),
    ...makeDemUniforms(null, 'demEye'),
    ...makeDemUniforms(null, 'demFar'),
    uObsElevM: { value: opts.observerElevM ?? 0 },
    uEyeHeightM: { value: opts.eyeHeightM ?? 1.6 },
    uBlendInner: { value: 0.30 },
    uBldEyeOffset: { value: new THREE.Vector2(0, 0) },
    uDepthOnly: { value: 0 },
    uSunAzRad: { value: 0 },
    uSunAltRad: { value: 0.5 },
    uSunAltDeg: { value: 30 },
    uMoonAzRad: { value: 0 },
    uMoonAltRad: { value: -0.5 },
    uSurfaceIrr: { value: new THREE.Vector3(0.3, 0.3, 0.3) },
    uSunRadiance: { value: new THREE.Vector3(1.5, 1.4, 1.2) },
    uMoonRadiance: { value: new THREE.Vector3(0, 0, 0) },
    uExposure: { value: 1 },
    uSaturation: { value: 1 },
    uHazeRadiance: { value: new THREE.Vector3(0.3, 0.4, 0.6) },
    uAerial: { value: 1 },
    uBeta: { value: 0.08 },
    uAngstrom: { value: 1.3 },
    uElevScale: { value: 1 },
    uOzoneDU: { value: 300 },
    uOvercast: { value: 0 },
    uDiagRaw: { value: 0 },
    uCityWallGain: { value: 0 },
    uCityDirXZ: { value: new THREE.Vector2(0, -1) },
    uWinRate: { value: 0.46 },
    uWinGlow: { value: 0 },
    uLampGlow: { value: 0 },
    uLampPx: { value: 1 },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: BUILDING_VERT,
    fragmentShader: BUILDING_FRAG,
    side: THREE.FrontSide,
    depthWrite: true,
    depthTest: true,
  });

  const distMaterial = material.clone();
  distMaterial.uniforms = material.uniforms;
  distMaterial.defines = { TERRAIN_DIST_OUT: 1 };
  distMaterial.transparent = false;
  distMaterial.blending = THREE.NoBlending;

  const litMaterial = material.clone();
  litMaterial.uniforms = material.uniforms;
  litMaterial.defines = { TERRAIN_LIT_OUT: 1 };
  litMaterial.transparent = false;
  litMaterial.blending = THREE.NoBlending;

  const windowMaterial = material.clone();
  windowMaterial.uniforms = material.uniforms;
  windowMaterial.defines = { TERRAIN_WINDOW_OUT: 1 };
  windowMaterial.transparent = true;
  windowMaterial.blending = THREE.AdditiveBlending;
  windowMaterial.depthWrite = false;
  windowMaterial.depthTest = true;
  windowMaterial.depthFunc = THREE.LessEqualDepth;
  windowMaterial.polygonOffset = true;
  windowMaterial.polygonOffsetFactor = -1;
  windowMaterial.polygonOffsetUnits = -1;

  const emptyGeo = new THREE.BufferGeometry();
  const mesh = new THREE.Mesh(emptyGeo, material);
  mesh.name = 'buildingField';
  mesh.frustumCulled = false;
  mesh.visible = false;

  const distMesh = new THREE.Mesh(emptyGeo, distMaterial);
  distMesh.name = 'buildingFieldDist';
  distMesh.frustumCulled = false;
  distMesh.visible = false;
  distMesh.layers.set(LAYER_TERRAIN_DIST);

  const litMesh = new THREE.Mesh(emptyGeo, litMaterial);
  litMesh.name = 'buildingFieldLit';
  litMesh.frustumCulled = false;
  litMesh.visible = false;
  litMesh.layers.set(LAYER_TERRAIN_LIT);

  const windowMesh = new THREE.Mesh(emptyGeo, windowMaterial);
  windowMesh.name = 'buildingFieldWindows';
  windowMesh.frustumCulled = false;
  windowMesh.visible = false;

  // 2026-11-18 중·원거리 가로등 점(밤에 지평선 아래 도로만 보임).
  const lampMaterial = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: LAMP_VERT,
    fragmentShader: LAMP_FRAG,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
  });
  const lampPoints = new THREE.Points(new THREE.BufferGeometry(), lampMaterial);
  lampPoints.name = 'streetLamps';
  lampPoints.frustumCulled = false;
  lampPoints.visible = false;

  // 2026-11-23 아주 가까운 가로등 3D 형태(기둥·팔·갓·전구). 불투명 메시라 밤하늘 별을 가리고 형태가 구분됨.
  const lampProto = createLampPrototypeGeometry();
  const lamp3DMaterial = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: LAMP_3D_VERT,
    fragmentShader: LAMP_3D_FRAG,
    side: THREE.FrontSide,
    depthWrite: true,
    depthTest: true,
  });
  const emptyInstGeo = new THREE.InstancedBufferGeometry();
  emptyInstGeo.attributes.position = lampProto.attributes.position;
  emptyInstGeo.attributes.normal = lampProto.attributes.normal;
  emptyInstGeo.attributes.aPart = lampProto.attributes.aPart;
  emptyInstGeo.instanceCount = 0;
  const lampMesh3D = new THREE.Mesh(emptyInstGeo, lamp3DMaterial);
  lampMesh3D.name = 'streetLamps3D';
  lampMesh3D.frustumCulled = false;
  lampMesh3D.visible = false;

  let hasLamps = false;
  let nearLampCount = 0;
  let rawLampXZ: Float32Array | null = null;
  let rawLampDirs: Float32Array | null = null;
  let lastLampFilterEastM = Number.NaN;
  let lastLampFilterSouthM = Number.NaN;
  const NEAR_LAMP_RADIUS_M = 435;

  let currentGeo = emptyGeo;
  let hasData = false;
  let enabled = false;
  let serial = 0;

  const rebuildNearLamps3D = (eastM: number, southM: number, force = false) => {
    if (!force && Number.isFinite(lastLampFilterEastM) && Math.hypot(eastM - lastLampFilterEastM, southM - lastLampFilterSouthM) < 25) {
      return;
    }
    lastLampFilterEastM = eastM;
    lastLampFilterSouthM = southM;

    const old3D = lampMesh3D.geometry;
    const instGeo = new THREE.InstancedBufferGeometry();
    instGeo.attributes.position = lampProto.attributes.position;
    instGeo.attributes.normal = lampProto.attributes.normal;
    instGeo.attributes.aPart = lampProto.attributes.aPart;

    const xz = rawLampXZ;
    const dirs = rawLampDirs;
    const n = xz ? Math.floor(xz.length / 2) : 0;
    if (n > 0) {
      const r2 = NEAR_LAMP_RADIUS_M * NEAR_LAMP_RADIUS_M;
      const keepIdx: number[] = [];
      for (let i = 0; i < n; i++) {
        const dx = xz![i * 2] - eastM;
        const dz = xz![i * 2 + 1] - southM;
        if (dx * dx + dz * dz <= r2) keepIdx.push(i);
      }
      const m = keepIdx.length;
      nearLampCount = m;
      if (m > 0) {
        const xzAttr = new Float32Array(m * 2);
        const dirAttr = new Float32Array(m * 2);
        for (let k = 0; k < m; k++) {
          const i = keepIdx[k];
          xzAttr[k * 2] = xz![i * 2];
          xzAttr[k * 2 + 1] = xz![i * 2 + 1];
          if (dirs && dirs.length >= (i + 1) * 2) {
            dirAttr[k * 2] = dirs[i * 2];
            dirAttr[k * 2 + 1] = dirs[i * 2 + 1];
          } else {
            dirAttr[k * 2] = 1;
            dirAttr[k * 2 + 1] = 0;
          }
        }
        instGeo.setAttribute('aLampXZ', new THREE.InstancedBufferAttribute(xzAttr, 2));
        instGeo.setAttribute('aLampDir', new THREE.InstancedBufferAttribute(dirAttr, 2));
        instGeo.instanceCount = m;
      } else {
        instGeo.instanceCount = 0;
      }
    } else {
      nearLampCount = 0;
      instGeo.instanceCount = 0;
    }
    lampMesh3D.geometry = instGeo;
    old3D.dispose();
  };

  const syncVisibility = () => {
    const eyeH = Number(uniforms.uEyeHeightM?.value ?? 1.6);
    const show = enabled && hasData;
    mesh.visible = show;
    distMesh.visible = show;
    litMesh.visible = show;
    windowMesh.visible = show && eyeH <= 650 && Number(uniforms.uWinGlow.value) > 0.001 && Number(uniforms.uWinRate.value) > 0;
    lampPoints.visible = hasLamps && eyeH <= 850 && Number(uniforms.uLampGlow.value) > 0.001;
    lampMesh3D.visible = hasLamps && nearLampCount > 0 && eyeH <= 220;
  };

  return {
    mesh,
    distMesh,
    litMesh,
    windowMesh,
    lampPoints,
    lampMesh3D,
    material,
    setLamps: (xz, dirs) => {
      const old = lampPoints.geometry;
      const geo = new THREE.BufferGeometry();

      const n = xz ? Math.floor(xz.length / 2) : 0;
      rawLampXZ = n > 0 && xz ? xz : null;
      rawLampDirs = n > 0 && dirs ? dirs : null;
      if (n > 0) {
        const pos = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) {
          pos[i * 3] = xz![i * 2];
          pos[i * 3 + 1] = 8.6;
          pos[i * 3 + 2] = xz![i * 2 + 1];
        }
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      }
      lampPoints.geometry = geo;
      old.dispose();
      hasLamps = n > 0;
      const curOff = material.uniforms.uBldEyeOffset?.value as THREE.Vector2 | undefined;
      rebuildNearLamps3D(curOff?.x ?? 0, curOff?.y ?? 0, true);
      syncVisibility();
    },
    setLampGlow: (glow, pixelRatio) => {
      uniforms.uLampGlow.value = Math.max(0, Math.min(1.5, Number.isFinite(glow) ? glow : 0));
      if (pixelRatio != null && Number.isFinite(pixelRatio)) uniforms.uLampPx.value = Math.max(1, pixelRatio);
      syncVisibility();
    },
    setBuildings: (data) => {
      serial++;
      const nextGeo = data ? createBuildingThreeGeometry(data) : new THREE.BufferGeometry();
      mesh.geometry = nextGeo;
      distMesh.geometry = nextGeo;
      litMesh.geometry = nextGeo;
      windowMesh.geometry = nextGeo;
      if (currentGeo !== nextGeo) currentGeo.dispose();
      currentGeo = nextGeo;
      hasData = !!data && data.vertexCount > 0;
      syncVisibility();
    },
    setObserver: (lat, lon) => {
      const dp = material.userData.demPatches as Record<string, DemPatch | null | undefined> | undefined;
      if (!dp) return;
      for (const k of ['dem', 'demEye', 'demFar']) setDemObserver(material.uniforms, k, dp[k], lat, lon);
    },
    setEyeOffset: (eastM, southM) => {
      const ex = Number.isFinite(eastM) ? eastM : 0;
      const sz = Number.isFinite(southM) ? southM : 0;
      const v = material.uniforms.uBldEyeOffset?.value as THREE.Vector2 | undefined;
      if (v) v.set(ex, sz);
      if (hasLamps) {
        rebuildNearLamps3D(ex, sz, false);
        syncVisibility();
      }
    },
    setPatch: (patch, eyePatch, farPatch) => {
      const dp = (material.userData.demPatches ??= {}) as Record<string, DemPatch | null | undefined>;
      dp.dem = patch;
      if (eyePatch !== undefined) dp.demEye = eyePatch;
      if (farPatch !== undefined) dp.demFar = farPatch;
      const put = (u: Record<string, { value: unknown }>) => {
        Object.entries(u).forEach(([k, v]) => {
          if (material.uniforms[k]) material.uniforms[k].value = v.value;
        });
      };
      put(makeDemUniforms(patch));
      if (eyePatch !== undefined) put(makeDemUniforms(eyePatch, 'demEye'));
      if (farPatch !== undefined) {
        put(makeDemUniforms(farPatch, 'demFar'));
        if (material.uniforms.uDemFarDespike) material.uniforms.uDemFarDespike.value = 1;
      }
    },
    setVisible: (v) => {
      enabled = v;
      syncVisibility();
    },
    setWindowLighting: (rate, glow) => {
      uniforms.uWinRate.value = clamp01(rate);
      uniforms.uWinGlow.value = clamp01(glow);
      syncVisibility();
    },
    hasGeometry: () => hasData,
    geomSerial: () => serial,
    dispose: () => {
      currentGeo.dispose();
      material.dispose();
      distMaterial.dispose();
      litMaterial.dispose();
      windowMaterial.dispose();
      lampPoints.geometry.dispose();
      lampMaterial.dispose();
      lampMesh3D.geometry.dispose();
      lampProto.dispose();
      lamp3DMaterial.dispose();
    },
  };
}

/**
 * `TerrainField.updateTerrainFieldEye` 와 동일하게 카메라 원점 맞추기.
 */
export function updateBuildingFieldEye(handle: BuildingFieldHandle, camera: THREE.Camera): void {
  handle.mesh.position.copy(camera.position);
  handle.distMesh.position.copy(camera.position);
  handle.litMesh.position.copy(camera.position);
  handle.windowMesh.position.copy(camera.position);
  handle.lampPoints.position.copy(camera.position);
  handle.lampMesh3D.position.copy(camera.position);
  handle.distMesh.visible = handle.mesh.visible;
  handle.litMesh.visible = handle.mesh.visible;
}
