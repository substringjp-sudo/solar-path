/**
 * **지형 높이장 메시** — 실루엣을 자료가 정하게 합니다 (docs/COASTLINE_PLAN.md 2단계).
 *
 * 1단계에서 진짜 높이장(`utils/demTiles.ts`)이 생겼습니다. 여기서 그걸
 * **기하**로 바꿉니다. 지금까지 지면은 평평한 원반이었고 능선은 31방위짜리
 * 빌보드 띠였습니다 — 방위 해상도가 12° 라 곶도 만도 섬도 못 그립니다.
 *
 * ## 왜 미터 평면이 아니라 **각도 격자**인가
 *
 * 이 씬은 반경 500 짜리 돔에 **각도**로 그립니다. 구름도 능선 띠도 나침반도
 * 천체도 전부 그 규약 위에 있습니다. 여기에만 미터 좌표계를 들이면 3km 지점이
 * 돔(500) 밖으로 나가 깊이 순서가 통째로 깨집니다.
 *
 * 그래서 격자를 **시선 구면 위**에 놓습니다. 지상 거리 d, 고도 h 인 점은
 *
 *     낙차   = d² / 2R          (지구 곡률)
 *     고도각 = atan2(h − 눈높이 − 낙차, d)
 *
 * 로 **실제로 보이는 각도**에 놓입니다. 눈높이가 식 안에 들어가므로 관측
 * 고도도 여기서 자동으로 반영됩니다.
 *
 * ## 가림(occlusion)은 반경이 정합니다
 *
 * 모든 정점을 같은 반경에 놓으면 가까운 능선과 먼 산이 같은 깊이라 z-fighting
 * 이 납니다. 대신 반경을 **거리의 단조 증가 함수**로 둡니다. 카메라가 메시
 * 원점에 있으므로 깊이 = 반경이고, 따라서
 *
 *     가까운 것이 항상 앞  ⇔  d 가 작으면 R 도 작다
 *
 * 가 공짜로 성립합니다. 반경은 오직 **깊이 순서**만 나르고, 보이는 자리는
 * 전부 위의 고도각이 정합니다.
 *
 * ⚠ 그래서 이 메시는 **카메라 위치에 원점을 두어야** 합니다. 원점이 씬
 * 원점에 있으면 눈높이 1.6 만큼 어긋나, 가장 가까운 고리에서 각도가 0.9°
 * 까지 틀립니다. `updateTerrainFieldEye` 로 매 프레임 맞춥니다.
 */
import * as THREE from 'three';
import { makeDemUniforms, setDemObserver, type DemPatch } from '../../utils/demTiles';
import type { UrbanMaskResult } from '../../utils/mvtTiles';
import { makeTuningUniforms } from '../../utils/atmosphere';
import { CLOUD_SHADOW_HALF_M, createOpenSkyShadowTexture } from '../../utils/cloudShadowMap';
import { LAYER_TERRAIN_DIST, LAYER_TERRAIN_LIT } from './SceneComposer';
import { bindTerrainLook, makeTerrainLookUniforms } from './terrainLook';
import { createTerrainAmbientBake } from './terrainAmbient';
import {
  EARTH_RADIUS_EFFECTIVE_M, FIELD_NEAR_M, FIELD_FAR_M,
  createConcentricGeometry, ringDistanceM,
} from './groundProjection';

export { FIELD_NEAR_M, FIELD_FAR_M };

/**
 * 고리 수 × 살 수.
 *
 * 살(방위)이 실루엣을 정합니다 — 256 이면 1.41°, 지금 띠의 12° 보다
 * 8.5배 촘촘합니다. 고리는 로그 간격이라 가까울수록 촘촘합니다.
 */
// 발밑 24 + 바깥 128. 발밑 고리를 바깥에서 빼내면 먼 쪽 실루엣이 나빠집니다
// (최대오차 0.119° → 0.161°). 새로 덮는 구간이므로 **더합니다**.
export const FIELD_RINGS = 152;
export const FIELD_SPOKES = 256;

/**
 * 고리 k 의 지상 거리 (m). 판정(`verify-terrain-field.js`)의 CPU 참조도
 * **같은 거리**를 씁니다 — 안 그러면 표본 간격 차이를 결함으로 잘못 읽습니다.
 */
export function fieldRingDistanceM(k: number, rings: number = FIELD_RINGS): number {
  return ringDistanceM(k, rings, FIELD_FAR_M);
}

/** 동심원 격자. 배치와 규약은 `groundProjection.ts` 에 있습니다. */
export function createFieldGeometry(
  rings: number = FIELD_RINGS,
  spokes: number = FIELD_SPOKES,
  farM: number = FIELD_FAR_M,
  nearM?: number,
): THREE.BufferGeometry {
  return createConcentricGeometry(rings, spokes, farM, nearM);
}

/**
 * **먼 지형** 격자의 범위 (m).
 *
 * 3km 밖은 오랫동안 옛 31방위 능선 띠가 맡았습니다. 그 띠는 방위마다
 * **5·15·40km 딱 세 점**만 보므로 진짜 봉우리를 대부분 놓칩니다 — 도곡동에서
 * 재 보니 먼 산이 최대 **3.26° 낮게** 깔렸습니다(`verify-far-terrain.js`).
 * 그러면 3km 안의 앞산만 제 높이로 서서, 앞산이 실제보다 우뚝해 보입니다.
 * 실기에서 "산의 높이나 기울기가 조금 과장돼 보인다"고 한 것이 이것입니다.
 *
 * 여기서 같은 높이장 방식을 3km 밖으로 잇습니다. 성긴 패치(줌 9, 화소 약
 * 243m)를 쓰므로 봉우리가 조금 깎이지만, 12° 간격 세 점보다는 비교가 안 되게
 * 낫습니다.
 */
export const FAR_FIELD_NEAR_M = FIELD_FAR_M;
export const FAR_FIELD_FAR_M = 55000;
export const FAR_FIELD_RINGS = 96;

import {
  FIELD_VERT, FIELD_FRAG, SUN_RIDGE_DECODE_GLSL,
  SUN_SHADOW_BAKE_VERT, SUN_SHADOW_BAKE_FRAG,
  SHADE_MAP_SIZE, TERRAIN_SHADE_BAKE_VERT, TERRAIN_SHADE_BAKE_FRAG,
} from './TerrainFieldShaders';
export { FIELD_VERT, FIELD_FRAG, SUN_RIDGE_DECODE_GLSL };

export const VOLUMETRIC_TERRAIN_ALBEDO = { r: 0.048, g: 0.065, b: 0.048 };

function createEmptyUrbanTexture(): THREE.DataTexture {
  const tex = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, THREE.RGBAFormat);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

export interface TerrainFieldHandle {
  mesh: THREE.Mesh;
  /** §117 지형 거리 판의 쌍둥이 메시(`LAYER_TERRAIN_DIST`). 씬에 넣으면 합성기가 거리 판에 그립니다. */
  distMesh: THREE.Mesh;
  /** §129 볼륨 하늘용 쌍둥이(`LAYER_TERRAIN_LIT`) — 알베도·햇빛 몫. 합성기가 지형 빛 판에 그립니다. */
  litMesh: THREE.Mesh;
  /** 2026-11-18 가로등 빛 웅덩이(더하기). 부르는 쪽이 씬의 LAYER_MID 에 넣습니다. */
  lampMesh: THREE.Mesh;
  /** 가로등 밝기(0 = 낮·끔). 0 이면 메시를 숨깁니다. */
  setLampGlow: (glow: number) => void;
  /** §129 해 쪽 능선 굽기(한 화소, `SUN_RIDGE_DECODE_GLSL` 로 읽음)와 그것이 지금 해·지형으로 구운 값인지. */
  sunRidge: () => { texture: THREE.Texture; valid: boolean };
  material: THREE.ShaderMaterial;
  /** DEM 패치를 갈아 끼웁니다. null 이면 평평하게 물러납니다. */
  /** 둘째는 **발밑 고도용**, 셋째는 **성긴(먼 거리)** 패치입니다. 안 주면 그대로 둡니다. */
  setPatch: (
    patch: DemPatch | null,
    eyePatch?: DemPatch | null,
    farPatch?: DemPatch | null,
  ) => void;
  /**
   * 눈이 (lat, lon) 으로 옮겨 갔다고 알립니다 — 받아 둔 패치 안에서 지형이 눈을 따라오게 `uDemObs` 를 옮깁니다(패치를 다시 받지 않음).
   * 패치가 아직 없으면 아무것도 안 합니다. 연속 이동 조이스틱이 프레임마다 부릅니다.
   */
  setObserver: (lat: number, lon: number) => void;
  /** 도시·거주지 토지이용(MVT) 마스크를 적용합니다. null 이면 끄고 uFarUrban 으로 물러납니다. */
  setUrbanMask: (mask: UrbanMaskResult | null) => void;
  /** 도시·도로 마스크 중심 대비 눈 오프셋(동, 남 m)을 맞춥니다. */
  setUrbanEyeOffset?: (eastM: number, southM: number) => void;
  /** 절차적 지표 질감(풀·자갈·토양)의 기준점 대비 눈 오프셋(동, 남 m)을 맞춥니다. */
  setNoiseEyeOffset?: (eastM: number, southM: number) => void;
  /** 현재 업로드된 MVT 도시/물 텍스처(G 채널 = 물)를 반환합니다. */
  waterMaskTex: () => THREE.Texture | null;
  /** 빛지도 등 거시 도시 밀도(0~1)를 전달해 원경(3km 밖) 및 로드 전 바닥 회색 톤을 조절합니다. */
  setFarUrban: (farUrban: number) => void;
  /** 관측점 중심 ±halfKm 공간별 빛지도 격자(n×n)를 텍스처로 전달합니다. */
  setCityPatch: (patch: Float32Array | null, n: number, halfKm: number) => void;
  /**
   * 해 방위의 지평선 능선을 굽습니다(SUN_SHADOW_BAKE_FRAG). 해 방위(uSunAzRad)·지형·눈높이가
   * 그대로면 아무것도 안 합니다 — 매 프레임 불러도 됩니다. 그리기 전에 부릅니다.
   */
  bakeSunShadow: (renderer: THREE.WebGLRenderer, skipShadeBake?: boolean) => void;
  /**
   * §157 DEM 에서 하늘 보임(AO)을 한 번 굽습니다. 패치가 바뀔 때만 다시 굽고 아니면 아무것도 안 합니다 —
   * 매 프레임 불러도 됩니다. 그리기 전에 부릅니다(지형 빛 판이 읽음).
   */
  bakeAmbient: (renderer: THREE.WebGLRenderer) => void;
  dispose: () => void;
}

export function createTerrainField(opts: {
  patch?: DemPatch | null;
  /**
   * **발밑 고도만** 이 패치로 짚습니다. 먼 지형 격자가 성긴 패치로 그릴 때
   * 눈높이가 어긋나 이음매에 층계가 생기는 것을 막습니다 (groundAtEye 참고).
   * 안 주면 `patch` 자신이 정합니다 — 근거리 격자의 예전 동작 그대로입니다.
   */
  eyePatch?: DemPatch | null;
  /** DEM 이 없을 때만 쓰이는 대비책. 있으면 DEM 이 정합니다. */
  observerElevM?: number;
  eyeHeightM?: number;
  albedo?: { r: number; g: number; b: number };
  rings?: number;
  spokes?: number;
  /** 격자 안쪽·바깥쪽 거리 (m). 먼 지형 격자가 3km~55km 로 씁니다. */
  nearM?: number;
  farM?: number;
  /**
   * 튀는 화소를 걷어냅니다. **성긴 패치(먼 지형)에서만** 켭니다 — 저줌
   * Terrarium 타일의 R 채널 결함이 첨탑으로 서는 것을 막습니다
   * (demTiles.ts 의 dem_elevationDespiked 참고).
   */
  despike?: boolean;
  /**
   * **성긴 패치** (줌 9, 60km). 주면 이 격자 하나가 발밑부터 55km 까지
   * 맡습니다 — 촘촘한 패치가 보장하는 반지름 안쪽은 촘촘한 것으로, 밖은
   * 이것으로, 사이는 섞어서. 안 주면 예전대로 한 장만 씁니다.
   */
  farPatch?: DemPatch | null;
}): TerrainFieldHandle {
  const alb = opts.albedo ?? { r: 0.22, g: 0.17, b: 0.13 };
  const emptyUrbanTex = createEmptyUrbanTexture();
  let activeUrbanTex: THREE.DataTexture | null = null;
  let activePaveTex: THREE.DataTexture | null = null;
  let activeCityPatchTex: THREE.DataTexture | null = null;
  // 성긴 패치는 **늘** 튀는 화소를 걷어냅니다. 저줌 Terrarium 타일의 R 채널
  // 결함이 8.96° 짜리 첨탑으로 서는 것을 막습니다(계획서 8.1절). 촘촘한
  // 패치에는 걸지 않습니다 — 진짜 능선이 깎입니다.
  const material = new THREE.ShaderMaterial({
    uniforms: {
      ...makeDemUniforms(opts.patch ?? null),
      ...makeDemUniforms(opts.eyePatch ?? null, 'demEye'),
      ...makeDemUniforms(opts.farPatch ?? null, 'demFar'),
      uDemFarDespike: { value: 1 },
      // 0.30 은 훑어서 고른 값입니다. 섞는 구간에서 **가짜 기울기가 w'(r)·Δh
      // 로 생깁니다** — 촘촘한 패치(줌 13)와 성긴 패치(줌 9)가 같은 자리를
      // 10.9m 다르게 읽으므로, 폭이 좁으면 w' 이 커져 그 어긋남이 한 자리에
      // 몰립니다. 0.75 면 이음매 각짐이 0.84 → 1.35 (최대 5.1 → 8.8) 로
      // 나빠집니다.
      //
      // ⚠ 넓힌다고 **좋아지지는 않습니다.** 0.30 에서 두 격자와 비슷합니다
      //   (평균 0.838 대 0.818, 최대 5.13 대 5.02). 합치는 값은 이음매
      //   품질이 아니라 **메시가 하나가 되는 것**입니다 — 자료 경계가
      //   구조적으로 사라지고 드로우 콜이 줄어듭니다.
      //   (처음에 "−56%" 로 읽었는데 그건 자가 얇아서(한 방위 12줄) 난
      //   착시였습니다. 지금 자는 방위 넷 × 108줄이고 재현됩니다.)
      uBlendInner: { value: 0.30 },
      // 3m 는 어림이 아니라 **어긋남의 크기**에서 나옵니다. 지형은 정점에서,
      // 해수면은 프래그먼트에서 같은 0 등고선을 계산하므로 어긋남은 대략
      // "살 간격의 절반 × 물가 기울기" 입니다 — 물가가 흔한 1~3km 에서
      // 살 간격이 25~74m, 물가 기울기가 1:31(대부도에서 잰 값)이라 0.4~1.2m
      // 입니다. 재 보니 1m 로 이미 구멍이 다 닫히므로(4,821 → 0) 여유를
      // 두어 3m 로 잡습니다. 10m 를 줘도 내륙에 물이 안 번집니다(물화소 불변).
      uShoreOverlapM: { value: 3 },
      uShoreMode: { value: 1 },
      uObsElevM: { value: opts.observerElevM ?? 0 },
      uEyeHeightM: { value: opts.eyeHeightM ?? 1.6 },
      uBicubicNormal: { value: 1 },
      uDetail: { value: 0.10 },
      uHurst: { value: 0.82 },
      uSurfaceIrr: { value: new THREE.Vector3(0.05, 0.06, 0.08) },
      uSunRadiance: { value: new THREE.Vector3(0, 0, 0) },
      uSunAzRad: { value: 0 },
      uSunAltRad: { value: 0.5 },
      uSunAltDeg: { value: 30 },
      uMoonRadiance: { value: new THREE.Vector3(0, 0, 0) },
      uMoonAzRad: { value: 0 },
      uMoonAltRad: { value: 0 },
      uAlbedo: { value: new THREE.Vector3(alb.r, alb.g, alb.b) },
      uLitAlbedo: { value: new THREE.Vector3(VOLUMETRIC_TERRAIN_ALBEDO.r, VOLUMETRIC_TERRAIN_ALBEDO.g, VOLUMETRIC_TERRAIN_ALBEDO.b) },
      uExposure: { value: 1.0 },
      uDiagRaw: { value: 0 },
      uDepthOnly: { value: 0 },
      uSaturation: { value: 1.0 },
      // 지평선 부근 하늘빛(선형). 공기원근이 먼 지형을 여기로 끌고 갑니다.
      uHazeRadiance: { value: new THREE.Vector3(0.05, 0.06, 0.09) },
      uOzoneDU: { value: 330 },
      uHazeDirectional: { value: 1.0 },
      uHazeSkyScale: { value: 1.0 },
      uSunShadowTex: { value: null as THREE.Texture | null },
      uSunShadowValid: { value: 0.0 },
      uBakedShadeTex: { value: null as THREE.Texture | null },
      uBakedShadeValid: { value: 0.0 },
      uHazeShadow: { value: 1.0 },
      uAerial: { value: 1.0 },
      uShadow: { value: 1.0 },
      uCityTerrainGain: { value: 0.0 },
      uCityDirXZ: { value: new THREE.Vector2(0, -1) },
      uCityPatchTex: { value: emptyUrbanTex },
      uCityPatchValid: { value: 0 },
      uCityPatchHalfM: { value: 60000 },
      uCityPatchScale: { value: 0.0 },
      uDemDespike: { value: opts.despike ? 1 : 0 },
      uCloudShadowTex: { value: createOpenSkyShadowTexture() },
      uCloudShadowHalfM: { value: CLOUD_SHADOW_HALF_M },
      uCloudShadow: { value: 1.0 },
      // 조간대 폭 — **고도** 기준. 조수간만 1~2m 인 서해안 기준.
      uWetBandM: { value: 1.2 },
      // §157 볼륨 하늘 경로의 땅 보임새 — 값은 terrainLook.ts 한 곳에서(손잡이), 맵은 bakeAmbient 가 채웁니다.
      uAmbTex: { value: null as THREE.Texture | null },
      uAmbValid: { value: 0 },
      uUrbanTex: { value: emptyUrbanTex },
      uUrbanValid: { value: 0 },
      uUrbanHalfM: { value: 3200 },
      uPaveTex: { value: emptyUrbanTex },
      uPaveValid: { value: 0 },
      uPaveHalfM: { value: 1600 },
      uUrbanEyeOffset: { value: new THREE.Vector2(0, 0) },
      uNoiseEyeOffset: { value: new THREE.Vector2(0, 0) },
      uLampGlow: { value: 0 },
      // 가로등 빛(LED 4000 K 안팎, 약간 따뜻한 흰빛) × 바닥 웅덩이 가운데 밝기(화면 값).
      uLampColor: { value: new THREE.Vector3(0.30, 0.26, 0.20) },
      uFarUrban: { value: 0 },
      ...makeTerrainLookUniforms(),
      uBeta: { value: 0.08 },
      uAngstrom: { value: 1.3 },
      uElevScale: { value: 1.0 },
      ...makeTuningUniforms(),
    },
    vertexShader: FIELD_VERT,
    fragmentShader: FIELD_FRAG,
    side: THREE.DoubleSide,
    depthWrite: true,
    depthTest: true,
  });

  const mesh = new THREE.Mesh(
    createFieldGeometry(opts.rings ?? FIELD_RINGS, opts.spokes ?? FIELD_SPOKES,
                        opts.farM ?? FIELD_FAR_M, opts.nearM),
    material,
  );
  mesh.name = 'terrainField';
  mesh.frustumCulled = false;

  // §117 — 지형 거리 판의 쌍둥이. 기하와 uniform(같은 객체)을 나눠 쓰고 조각 셰이더만 거리를 적습니다.
  // 자식으로 달지 않습니다 — `assignLayer` 가 자손까지 한 층으로 덮어씁니다. 부르는 쪽이 씬에 넣고
  // `LAYER_TERRAIN_DIST` 에 둡니다(여기서 이미 그 층으로 둡니다).
  const distMaterial = material.clone();
  distMaterial.uniforms = material.uniforms;
  distMaterial.defines = { ...(material.defines ?? {}), TERRAIN_DIST_OUT: 1 };
  distMaterial.transparent = false;
  distMaterial.blending = THREE.NoBlending;
  const distMesh = new THREE.Mesh(mesh.geometry, distMaterial);
  distMesh.name = 'terrainFieldDist';
  distMesh.frustumCulled = false;
  distMesh.layers.set(LAYER_TERRAIN_DIST);
  // §129 볼륨 하늘용 쌍둥이 — 알베도·햇빛 몫(TERRAIN_LIT_OUT). 균일변수는 격자와 같은 객체입니다.
  const litMaterial = material.clone();
  litMaterial.uniforms = material.uniforms;
  litMaterial.defines = { ...(material.defines ?? {}), TERRAIN_LIT_OUT: 1 };
  litMaterial.transparent = false;
  litMaterial.blending = THREE.NoBlending;
  const litMesh = new THREE.Mesh(mesh.geometry, litMaterial);
  litMesh.name = 'terrainFieldLit';
  litMesh.frustumCulled = false;
  litMesh.layers.set(LAYER_TERRAIN_LIT);
  // 2026-11-18 가로등 빛 웅덩이 — 지형 위에 더하는 쌍둥이(창문 불빛처럼). 깊이는 격자가 쓴 것을 읽기만 합니다.
  const lampMaterial = material.clone();
  lampMaterial.uniforms = material.uniforms;
  lampMaterial.defines = { ...(material.defines ?? {}), TERRAIN_LAMP_OUT: 1 };
  lampMaterial.transparent = true;
  lampMaterial.blending = THREE.AdditiveBlending;
  lampMaterial.depthWrite = false;
  lampMaterial.depthTest = true;
  lampMaterial.depthFunc = THREE.LessEqualDepth;
  lampMaterial.polygonOffset = true;
  lampMaterial.polygonOffsetFactor = -1;
  lampMaterial.polygonOffsetUnits = -1;
  const lampMesh = new THREE.Mesh(mesh.geometry, lampMaterial);
  lampMesh.name = 'terrainFieldLamps';
  lampMesh.frustumCulled = false;
  lampMesh.visible = false;

  // 해 방위의 지평선 능선 — 한 화소짜리 굽기(SUN_SHADOW_BAKE_FRAG). uniform 은 격자와 **같은 객체**를
  // 나눠 써서 setPatch·해 갱신이 그대로 따라옵니다(굽기 셰이더는 uSunShadowTex 를 선언하지 않으므로
  // 제 출력을 읽는 되먹임이 없습니다).
  const shadowRT = new THREE.WebGLRenderTarget(1, 1, {
    format: THREE.RGBAFormat, type: THREE.UnsignedByteType,
    minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
    depthBuffer: false, stencilBuffer: false, generateMipmaps: false,
  });
  material.uniforms.uSunShadowTex.value = shadowRT.texture;
  const bakeMaterial = new THREE.ShaderMaterial({
    uniforms: material.uniforms,
    vertexShader: SUN_SHADOW_BAKE_VERT,
    fragmentShader: SUN_SHADOW_BAKE_FRAG,
    depthTest: false,
    depthWrite: false,
    blending: THREE.NoBlending,
  });
  const bakeQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), bakeMaterial);
  bakeQuad.frustumCulled = false;
  const bakeScene = new THREE.Scene();
  bakeScene.add(bakeQuad);
  const bakeCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  let bakedKey = '';
  let patchSerial = 0;

  // 256×256 산 그림자(해·달) 굽기 — 해/달 고도·방위가 바뀔 때만 갱신해 카메라 회전 중 36걸음 루프 생략.
  const shadeMapRT = new THREE.WebGLRenderTarget(SHADE_MAP_SIZE, SHADE_MAP_SIZE, {
    format: THREE.RGBAFormat, type: THREE.UnsignedByteType,
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    depthBuffer: false, stencilBuffer: false, generateMipmaps: false,
  });
  material.uniforms.uBakedShadeTex.value = shadeMapRT.texture;
  const shadeMapMat = new THREE.ShaderMaterial({
    uniforms: material.uniforms,
    vertexShader: TERRAIN_SHADE_BAKE_VERT,
    fragmentShader: TERRAIN_SHADE_BAKE_FRAG,
    depthTest: false,
    depthWrite: false,
    blending: THREE.NoBlending,
  });
  const shadeMapQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), shadeMapMat);
  shadeMapQuad.frustumCulled = false;
  const shadeMapScene = new THREE.Scene();
  shadeMapScene.add(shadeMapQuad);
  let shadeBakedKey = '';

  const ambientBake = createTerrainAmbientBake();
  const unbindLook = bindTerrainLook(material.uniforms);

  return {
    mesh,
    distMesh,
    litMesh,
    lampMesh,
    setLampGlow: (glow: number) => {
      const g = Number.isFinite(glow) ? Math.max(0, Math.min(1.5, glow)) : 0;
      material.uniforms.uLampGlow.value = g;
      lampMesh.userData.glowOn = g > 0.001;
    },
    material,
    sunRidge: () => ({ texture: shadowRT.texture, valid: material.uniforms.uSunShadowValid.value > 0.5 }),
    bakeSunShadow: (renderer, skipShadeBake = false) => {
      const u = material.uniforms;
      const hasDem = u.uDemValid?.value > 0.5 || u.uDemFarValid?.value > 0.5;
      if (!hasDem) {
        u.uSunShadowValid.value = 0;
        u.uBakedShadeValid.value = 0;
        bakedKey = '';
        shadeBakedKey = '';
        return;
      }
      // 해 **방위**가 0.0017° 움직이면 다시 굽습니다 — 한 화소라 값이 거의 들지 않습니다. 해 고도와는 무관합니다.
      const q = (x: number) => Math.round(x / 3e-5);
      // 눈 자리(uDemObs)도 넣습니다 — 연속 이동으로 눈이 옮겨 가면 해 쪽 능선(그 자리에서 본 산 그림자 경계)을 다시 굽습니다. 약 10 m 마다.
      const obs = u.uDemObs?.value as { x: number; y: number } | undefined;
      const qo = (x: number) => Math.round(x / 0.0025);
      const key = `${patchSerial}|${q(u.uSunAzRad.value)}|${u.uEyeHeightM.value}|${obs ? `${qo(obs.x)},${qo(obs.y)}` : ''}`;
      const qs = (x: number) => Math.round(x / 0.01);
      const moonActive = u.uMoonAltRad.value > 0 && (u.uMoonRadiance.value as THREE.Vector3).lengthSq() > 1e-8;
      const shadeKey = !skipShadeBake && u.uDemValid?.value > 0.5
        ? `${patchSerial}|${u.uShadow.value > 0.5 ? 1 : 0}|${qs(u.uSunAzRad.value)}|${moonActive ? qs(u.uMoonAzRad.value) : 'n'}`
        : '';
      const needRidge = key !== bakedKey;
      const needShadeMap = !skipShadeBake && shadeKey !== '' && shadeKey !== shadeBakedKey;
      if (u.uDemValid?.value <= 0.5) {
        u.uBakedShadeValid.value = 0;
        shadeBakedKey = '';
      }
      if (!needRidge && !needShadeMap) return;

      const prev = renderer.getRenderTarget();
      const prevAuto = renderer.autoClear;
      renderer.autoClear = false;
      if (needRidge) {
        renderer.setRenderTarget(shadowRT);
        renderer.render(bakeScene, bakeCam);
        u.uSunShadowValid.value = 1;
        bakedKey = key;
      }
      if (needShadeMap) {
        renderer.setRenderTarget(shadeMapRT);
        renderer.render(shadeMapScene, bakeCam);
        u.uBakedShadeValid.value = 1;
        shadeBakedKey = shadeKey;
      }
      renderer.setRenderTarget(prev);
      renderer.autoClear = prevAuto;
    },
    bakeAmbient: (renderer) => {
      const u = material.uniforms;
      const ok = ambientBake.bake(renderer, u);
      u.uAmbTex.value = ok ? ambientBake.texture() : null;
      u.uAmbValid.value = ok ? 1 : 0;
    },
    setObserver: (lat, lon) => {
      const dp = material.userData.demPatches as Record<string, DemPatch | null | undefined> | undefined;
      if (!dp) return;
      for (const k of ['dem', 'demEye', 'demFar']) setDemObserver(material.uniforms, k, dp[k], lat, lon);
    },
    setPatch: (patch, eyePatch, farPatch) => {
      patchSerial++;
      const dp = (material.userData.demPatches ??= {}) as Record<string, DemPatch | null | undefined>;
      dp.dem = patch;
      if (eyePatch !== undefined) dp.demEye = eyePatch;
      if (farPatch !== undefined) dp.demFar = farPatch;
      const put = (u: Record<string, { value: unknown }>) => {
        Object.entries(u).forEach(([k, v]) => {
          if (material.uniforms[k]) material.uniforms[k].value = v.value;
        });
      };
      // ⚠ makeDemUniforms 는 despike 를 0 으로 되돌립니다 — 격자가 만들어질
      // 때 정한 값을 지키려고 여기서 다시 씌웁니다.
      const despike = material.uniforms.uDemDespike?.value;
      put(makeDemUniforms(patch));
      if (material.uniforms.uDemDespike) material.uniforms.uDemDespike.value = despike;
      if (eyePatch !== undefined) put(makeDemUniforms(eyePatch, 'demEye'));
      if (farPatch !== undefined) {
        put(makeDemUniforms(farPatch, 'demFar'));
        if (material.uniforms.uDemFarDespike) material.uniforms.uDemFarDespike.value = 1;
      }
    },
    setUrbanMask: (mask) => {
      if (!mask) {
        material.uniforms.uUrbanTex.value = emptyUrbanTex;
        material.uniforms.uUrbanValid.value = 0;
        material.uniforms.uPaveTex.value = emptyUrbanTex;
        material.uniforms.uPaveValid.value = 0;
        activePaveTex?.dispose(); activePaveTex = null;
        if (activeUrbanTex) {
          activeUrbanTex.dispose();
          activeUrbanTex = null;
        }
        return;
      }
      const n = mask.size;
      const rgba = new Uint8Array(n * n * 4);
      const wData = mask.water;
      for (let i = 0; i < n * n; i++) {
        const v = mask.data[i];
        const o = i * 4;
        rgba[o] = v;
        rgba[o + 1] = wData ? wData[i] : 0;
        rgba[o + 2] = v;
        rgba[o + 3] = 255;
      }
      if (!activeUrbanTex || (activeUrbanTex.image as { width?: number })?.width !== n) {
        activeUrbanTex?.dispose();
        activeUrbanTex = new THREE.DataTexture(rgba, n, n, THREE.RGBAFormat);
        activeUrbanTex.colorSpace = THREE.NoColorSpace;
        activeUrbanTex.minFilter = THREE.LinearFilter;
        activeUrbanTex.magFilter = THREE.LinearFilter;
        activeUrbanTex.wrapS = THREE.ClampToEdgeWrapping;
        activeUrbanTex.wrapT = THREE.ClampToEdgeWrapping;
      } else {
        (activeUrbanTex.image.data as Uint8Array).set(rgba);
      }
      activeUrbanTex.needsUpdate = true;
      material.uniforms.uUrbanTex.value = activeUrbanTex;
      material.uniforms.uUrbanHalfM.value = mask.halfM;
      material.uniforms.uUrbanValid.value = 1;
      // 포장 지도(시멘트·아스팔트·고해상도 물 → R·G·B)
      if (mask.pave) {
        const pn = mask.pave.size, pd = mask.pave.data;
        const wh = mask.waterHi && mask.waterHi.size === pn ? mask.waterHi.data : null;
        const prgba = new Uint8Array(pn * pn * 4);
        for (let i = 0; i < pn * pn; i++) {
          prgba[i * 4] = pd[i * 2];
          prgba[i * 4 + 1] = pd[i * 2 + 1];
          prgba[i * 4 + 2] = wh ? wh[i] : 0;
          prgba[i * 4 + 3] = mask.pave.lamp ? mask.pave.lamp[i] : 0;   // A = 가로등 빛 웅덩이(2026-11-18)
        }
        activePaveTex?.dispose();
        activePaveTex = new THREE.DataTexture(prgba, pn, pn, THREE.RGBAFormat);
        activePaveTex.colorSpace = THREE.NoColorSpace;
        activePaveTex.minFilter = THREE.LinearFilter;
        activePaveTex.magFilter = THREE.LinearFilter;
        activePaveTex.wrapS = THREE.ClampToEdgeWrapping;
        activePaveTex.wrapT = THREE.ClampToEdgeWrapping;
        activePaveTex.needsUpdate = true;
        material.uniforms.uPaveTex.value = activePaveTex;
        material.uniforms.uPaveHalfM.value = mask.pave.halfM;
        material.uniforms.uPaveValid.value = 1;
      } else {
        material.uniforms.uPaveValid.value = 0;
      }
    },
    waterMaskTex: () => activeUrbanTex,
    setUrbanEyeOffset: (eastM, southM) => {
      const v = material.uniforms.uUrbanEyeOffset?.value as THREE.Vector2 | undefined;
      if (v) v.set(Number.isFinite(eastM) ? eastM : 0, Number.isFinite(southM) ? southM : 0);
    },
    setNoiseEyeOffset: (eastM, southM) => {
      const v = material.uniforms.uNoiseEyeOffset?.value as THREE.Vector2 | undefined;
      if (v) v.set(Number.isFinite(eastM) ? eastM : 0, Number.isFinite(southM) ? southM : 0);
    },
    setFarUrban: (farUrban) => {
      material.uniforms.uFarUrban.value = Math.max(0, Math.min(1, Number.isFinite(farUrban) ? farUrban : 0));
    },
    setCityPatch: (patch, n, halfKm) => {
      if (!patch || n <= 0 || patch.length < n * n || halfKm <= 0) {
        material.uniforms.uCityPatchValid.value = 0;
        material.uniforms.uCityPatchTex.value = emptyUrbanTex;
        activeCityPatchTex?.dispose();
        activeCityPatchTex = null;
        return;
      }
      const rgba = new Uint8Array(n * n * 4);
      for (let i = 0; i < n * n; i++) {
        const q = Math.round(Math.max(0, Math.min(1, patch[i] / 1.25)) * 255);
        rgba[i * 4] = q;
        rgba[i * 4 + 1] = q;
        rgba[i * 4 + 2] = q;
        rgba[i * 4 + 3] = 255;
      }
      activeCityPatchTex?.dispose();
      activeCityPatchTex = new THREE.DataTexture(rgba, n, n, THREE.RGBAFormat);
      activeCityPatchTex.colorSpace = THREE.NoColorSpace;
      activeCityPatchTex.minFilter = THREE.LinearFilter;
      activeCityPatchTex.magFilter = THREE.LinearFilter;
      activeCityPatchTex.wrapS = THREE.ClampToEdgeWrapping;
      activeCityPatchTex.wrapT = THREE.ClampToEdgeWrapping;
      activeCityPatchTex.needsUpdate = true;
      material.uniforms.uCityPatchTex.value = activeCityPatchTex;
      material.uniforms.uCityPatchHalfM.value = halfKm * 1000;
      material.uniforms.uCityPatchValid.value = 1;
    },
    dispose: () => {
      mesh.geometry.dispose();
      material.dispose();
      distMaterial.dispose();
      litMaterial.dispose();
      lampMaterial.dispose();
      bakeQuad.geometry.dispose();
      bakeMaterial.dispose();
      shadowRT.dispose();
      shadeMapQuad.geometry.dispose();
      shadeMapMat.dispose();
      shadeMapRT.dispose();
      emptyUrbanTex.dispose();
      activeUrbanTex?.dispose();
      activeUrbanTex = null;
      activeCityPatchTex?.dispose();
      activeCityPatchTex = null;
      unbindLook();
      ambientBake.dispose();
    },
  };
}

/**
 * ⚠ 메시 원점을 **눈**에 맞춥니다. 매 프레임 카메라가 움직이면 같이 옮겨야
 * 각도가 안 어긋납니다 (씬 원점에 두면 가장 가까운 고리에서 0.9° 틀립니다).
 *
 * ⚠ **Y(세로)는 카메라를 따라가지 않고 항상 0 입니다.** 이 씬의 카메라
 * `camera.position.y` 는 실제 미터가 아니라 화면단위 dip 트릭 값입니다
 * (지면 원반을 기울여 수평선 침강을 흉내 내던 예전 방식 — `TerrainRing.
 * setGroundHorizon`). 이 메시는 눈높이를 이미 **미터** 단위로
 * (`uEyeHeightM` + DEM 고도) 셰이더 안에서 정확히 계산하므로, 카메라의
 * Y 를 메시 위치에도 더하면 **두 셈법이 겹쳐 이중으로 셉니다** — 예를
 * 들어 카메라가 화면단위로 −17 만큼 내려가 있으면 지형 전체가 그만큼
 * 한 번 더 가라앉아 보입니다. 그래서 X/Z(수평 이동, 지금은 항상 0)만
 * 따라가고 Y 는 고정합니다.
 */
export function updateTerrainFieldEye(
  handle: TerrainFieldHandle,
  camera: THREE.Camera,
): void {
  // ⚠ **Y 도 따라가야 합니다.** 이 격자의 정점은 버텍스 셰이더가 눈에서 본
  // 진짜 고도각으로 놓고, 그 각의 기준점이 **메시 원점**입니다. 카메라가
  // 원점에서 벗어나 있으면 그 각이 그대로 화면에 나오지 않습니다.
  //
  // 예전에는 Y 를 0 으로 두었습니다 — "카메라 Y 는 실제 미터가 아니라 옛
  // 원반용 dip 트릭 값이니 따라가지 않는다" 는 이유였는데, 트릭 값이든
  // 아니든 **시차는 생깁니다.** 재 보니 하늘금이 이만큼 어긋났습니다:
  //
  //   해수면 관측지 (카메라 +1.26) : 0.13°~0.36° **아래로**
  //   마니산 350m  (카메라 −3.43) : 0.51°~0.90° **위로**
  //
  // 부호가 관측지 고도에 따라 뒤집히고, 방위마다 크기가 다릅니다(하늘금이
  // 걸리는 거리가 달라 고리 반경이 다르기 때문). 그래서 전체를 한 값으로
  // 보정할 수도 없는, 하늘금의 **모양**을 바꾸는 어긋남입니다.
  //
  // ⚠ 하네스가 이걸 못 잡은 이유: 거의 모두 카메라를 (0,0,0) 에 둡니다.
  //   verify-eye-origin.js 가 일부러 높이를 바꿔 가며 봅니다.
  handle.mesh.position.copy(camera.position);
  // §117 쌍둥이도 같은 자리·같은 보임(DEM 이 오기 전엔 격자를 숨깁니다 — 거리 판에도 없어야 합니다).
  // 하네스 몇은 바다 판 손잡이도 이 함수로 옮기는데, 그쪽엔 쌍둥이가 없습니다.
  if (handle.distMesh) {
    handle.distMesh.position.copy(camera.position);
    handle.distMesh.visible = handle.mesh.visible;
  }
  if (handle.litMesh) {
    handle.litMesh.position.copy(camera.position);
    handle.litMesh.visible = handle.mesh.visible;
  }
  if (handle.lampMesh) {
    handle.lampMesh.position.copy(camera.position);
    handle.lampMesh.visible = handle.mesh.visible && !!handle.lampMesh.userData.glowOn;
  }
}

/**
 * 어느 방위의 **지평선 각도**(도) — 그 방위에서 가장 높이 보이는 지형.
 *
 * 셰이더와 **같은 식**입니다. 판정이 이걸 CPU 로 다시 구해 화면에서 잰
 * 실루엣과 견줍니다. 여기서 쓰는 고도 표본은 호출부가 넘깁니다(앱은 DEM
 * 텍스처를, 판정은 PNG 를 직접 푼 값을 씁니다) — 그래야 두 구현이
 * 진짜로 독립입니다.
 */
export function horizonAngleDeg(
  azRad: number,
  elevAt: (east: number, south: number) => number,
  opts: { eyeHeightM: number; rings?: number },
): number {
  const rings = opts.rings ?? FIELD_RINGS;
  // ⚠ 지상 좌표는 (동, **남**) 입니다. 방위 A 는 북에서 시계방향이므로
  //   동 = sin A, 남 = −cos A. 부호를 놓치면 180° − A 의 거울상을 읽습니다.
  // ⚠ 발밑도 **같은 자료**에서 읽습니다 — 셰이더의 `groundAtEye` 와 같은 규약.
  const eye = elevAt(0, 0) + opts.eyeHeightM;
  let best = -Infinity;
  for (let k = 0; k < rings; k++) {
    const d = fieldRingDistanceM(k, rings);
    const h = elevAt(Math.sin(azRad) * d, -Math.cos(azRad) * d);
    const drop = (d * d) / (2 * EARTH_RADIUS_EFFECTIVE_M);
    const a = Math.atan2(h - eye - drop, d);
    if (a > best) best = a;
  }
  return (best * 180) / Math.PI;
}
