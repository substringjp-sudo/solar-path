/**
 * TerrainRing.ts
 *
 * Why: 기존 panoramicAngles (360° 지형 프로필)를 3D 원통형 geometry로 변환하고,
 * 지평선 하단을 메우는 3D 땅(Ground Plane) 및 지평선 방위(Compass) 표시 라인 그룹을 생성합니다.
 */
import * as THREE from 'three';
import { clamp01 } from '../../utils/sunsetPhysics';
import { ATMOSPHERE_GLSL, makeTuningUniforms } from '../../utils/atmosphere';

/**
 * 지표 알베도 — 지면이 받은 빛 중 되쏘는 비율.
 *
 * 지적대로 **대지는 햇빛을 그렇게 반사하지 않습니다.** 이 낮은 값이 곧
 * "땅은 하늘보다 훨씬 어둡다"는 결론이고, 예전 화면이 부자연스러웠던 이유가
 * 그 반대였기 때문입니다.
 *
 * | 지표 | 알베도 |
 * |---|---|
 * | 숲 | 0.12 |
 * | 도시 (아스팔트·콘크리트 혼합) | 0.15 |
 * | 풀·농지 | 0.23 |
 * | 눈 | 0.75 |
 *
 * 관측점의 지표 종류를 알 방법이 없으므로 도시와 초지 사이의 대표값을 씁니다.
 *
 * 색은 **따뜻한 쪽(흙·마른 풀·아스팔트)** 으로 기울입니다. 이유가 있습니다:
 * 해 질 녘 수평면이 받는 빛은 대부분 **천정 쪽 파란 하늘**에서 옵니다
 * (직달광은 스치는 각이라 약합니다). 알베도까지 중립이면 결과가 푸르뎅뎅한
 * 회색이 되고, 초록으로 두면 이끼색이 됩니다 — 렌더로 확인한 사항입니다.
 */
export const GROUND_ALBEDO = { r: 0.22, g: 0.17, b: 0.13 };

/**
 * 지면에만 거는 국소 순응 배율. 물리가 아니라 **표시** 선택입니다 —
 * 자세한 근거는 `GROUND_FRAG`의 "국소 순응" 주석.
 *
 * 렌더로 훑어 고른 값입니다 (태양 고도 4°, 하늘 휘도 253 기준):
 *
 *   ×1.0  지면 15 (하늘의 6%)   검은 띠
 *   ×1.8  지면 68 (27%)
 *   ×2.2  지면 80 (32%)         ← 채택
 *   ×3.2  지면 113 (45%)
 *   ×6.0  지면 163 (64%)        땅이 하늘만큼 밝아짐
 */
export const GROUND_EXPOSURE = 2.2;

/**
 * 능선 각도 상한.
 *
 * 예전 값 8°는 관측점에서 5km 떨어진 **700m 산까지**밖에 못 담습니다.
 * 설악(1708m)이 5km 앞이면 18.9°, 2000m면 21.8°입니다. 25°면 국내 어떤
 * 산도 잘리지 않습니다.
 */
export const TERRAIN_MAX_ANGLE_DEG = 25;

const TERRAIN_RING_RADIUS = 480; // 스카이돔(500) 바로 안쪽
const TERRAIN_SEGMENTS = 72;     // 5° 간격으로 충분히 부드러운 실루엣

/**
 * panoramicAngles 배열로부터 360° 지형 링 메시를 생성합니다.
 */
export function createTerrainRing(
  panoramicAngles: number[],
  maxVisualAngle: number = 8
): THREE.Mesh {
  const angleCount = panoramicAngles.length;
  if (angleCount === 0) {
    return new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({ visible: false })
    );
  }

  const vertexCount = TERRAIN_SEGMENTS * 2;
  const positions = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 3);
  const indices: number[] = [];

  for (let i = 0; i < TERRAIN_SEGMENTS; i++) {
    const azFrac = i / TERRAIN_SEGMENTS;
    const azRad = azFrac * Math.PI * 2;

    const angleIdx = azFrac * (angleCount - 1);
    const idx0 = Math.floor(angleIdx);
    const idx1 = Math.min(idx0 + 1, angleCount - 1);
    const frac = angleIdx - idx0;
    const terrainAngleDeg = panoramicAngles[idx0] * (1 - frac) + panoramicAngles[idx1] * frac;

    const terrainElevRad = (Math.min(terrainAngleDeg, maxVisualAngle) * Math.PI) / 180;
    const baseElevRad = (-2 * Math.PI) / 180;

    const dirX = Math.sin(azRad);
    const dirZ = -Math.cos(azRad); // Three.js: -Z = North

    const bIdx = i * 2;
    positions[bIdx * 3] = dirX * TERRAIN_RING_RADIUS * Math.cos(baseElevRad);
    positions[bIdx * 3 + 1] = TERRAIN_RING_RADIUS * Math.sin(baseElevRad);
    positions[bIdx * 3 + 2] = dirZ * TERRAIN_RING_RADIUS * Math.cos(baseElevRad);

    const tIdx = i * 2 + 1;
    positions[tIdx * 3] = dirX * TERRAIN_RING_RADIUS * Math.cos(terrainElevRad);
    positions[tIdx * 3 + 1] = TERRAIN_RING_RADIUS * Math.sin(terrainElevRad);
    positions[tIdx * 3 + 2] = dirZ * TERRAIN_RING_RADIUS * Math.cos(terrainElevRad);

    colors[bIdx * 3] = 0.05; colors[bIdx * 3 + 1] = 0.06; colors[bIdx * 3 + 2] = 0.08;
    colors[tIdx * 3] = 0.08; colors[tIdx * 3 + 1] = 0.09; colors[tIdx * 3 + 2] = 0.11;

    const nextI = (i + 1) % TERRAIN_SEGMENTS;
    const b0 = i * 2, t0 = i * 2 + 1;
    const b1 = nextI * 2, t1 = nextI * 2 + 1;
    indices.push(b0, t0, b1);
    indices.push(b1, t0, t1);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const material = new THREE.MeshBasicMaterial({
    vertexColors: true,
    // ⚠ 예전에는 `FrontSide` 였고, 그래서 **한 번도 화면에 안 나왔습니다.**
    // 이 링은 관측자를 둘러싼 원통이라 항상 **안쪽에서** 봅니다. 그런데 감김
    // 방향상 안쪽이 뒷면이라 통째로 컬링됐습니다 (검은 배경에 지형만 그려
    // 세어 보니 0픽셀). 지면 원반이 그리기 순서 때문에 안 보이던 것과 같은
    // 종류의 버그입니다 — 둘 다 코드를 읽어서는 안 잡히고, 씬에서 빼 보거나
    // 단독으로 그려 봐야 드러납니다.
    side: THREE.DoubleSide,
    depthWrite: true,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'terrainRing';
  mesh.renderOrder = 0;
  
  return mesh;
}

const BAND_VERT = `
precision highp float;
attribute float aElevDeg;
attribute vec3  aHaze;      // 이 방위 지평선 하늘색 (연무)
varying float vElevDeg;
varying vec3 vDir;
varying vec3 vHaze;
void main() {
  vElevDeg = aElevDeg;
  vHaze = aHaze;
  vDir = normalize(position);
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
}
`;

const BAND_FRAG = `
precision highp float;

${ATMOSPHERE_GLSL}

uniform vec3  uTerrainRadiance;  // 이 능선이 되쏘는 복사휘도 (선형)
uniform float uDistanceKm;       // 이 거리대까지의 거리
uniform float uBeta;
uniform float uAngstrom;
uniform float uElevScale;
uniform float uSunAltDeg;
uniform float uSaturation;
uniform float uExposure;

varying float vElevDeg;
varying vec3  vDir;
varying vec3  vHaze;

void main() {
  // ── 거리별 대기 투시 ────────────────────────────────────────────────────
  //
  // 풍경 사진에서 깊이를 만드는 가장 강한 단서입니다. 능선은 멀어진다고
  // 투명해지지 않고 **색이 연무와 같아집니다** — 구름에서 쓴 것과 같은 원리.
  //
  // 5 / 15 / 40 km 세 거리대를 각각 다른 투과율로 칠하면, 가까운 능선은
  // 짙게 남고 먼 능선은 하늘색에 잠겨 겹쳐 보입니다. 예전에는 세 거리를
  // 최댓값으로 뭉개 하나의 띠로 그렸으므로 이 겹침이 아예 없었습니다.
  vec3 T = atm_aerialTransmittance(uDistanceKm, 0.0, uBeta, uAngstrom, uElevScale);
  // ⚠ 연무색은 **방위마다** 달라야 합니다. 하나로 고정하면 먼 능선이 태양
  // 쪽 색으로 온 하늘에 칠해져, 하늘과 경계가 생기고 반대쪽은 엉뚱하게
  // 밝아집니다. 정점 속성으로 그 방위의 지평선 하늘색을 받습니다 — 그래야
  // 먼 능선이 **자기 뒤 하늘에** 잠깁니다.
  vec3 col = uTerrainRadiance * uExposure * T + vHaze * (1.0 - T);

  // 능선 위쪽(하늘에 가까운 쪽)이 조금 밝습니다 — 사면이 하늘을 더 봅니다.
  col *= 0.82 + 0.30 * smoothstep(-2.0, 6.0, vElevDeg);

  gl_FragColor = vec4(atm_display(col, uSaturation, uSunAltDeg), 1.0);
}
`;

const GROUND_VERT = `
precision highp float;
varying vec3 vWorld;
void main() {
  // ⚠ 원반은 rotation.x = -PI/2 와 position.y = -8 을 갖습니다. 스카이돔처럼
  // 변환이 없는 메시의 VERT를 흉내 내어 gl_Position 에서 modelMatrix를
  // 빼먹으면, 원반이 회전 전(수직면) 자리에 그려져 지평선 아래가 통째로
  // 비어 버립니다. 둘 다 같은 월드 좌표를 써야 합니다.
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const GROUND_FRAG = `
precision highp float;

${ATMOSPHERE_GLSL}

// 물 알베도(0.06) 나누기 지표 알베도(약 0.19). uGroundRadiance 가 이미 지표
// 알베도를 먹었으므로, 물의 몸체색은 이 비율만 더 곱하면 됩니다.
#define WATER_ALBEDO_REL 0.32

uniform vec3  uGroundRadiance;  // 지면이 되쏘는 복사휘도 (선형, 하늘과 같은 단위)
uniform float uSunAzRad;
uniform float uSunAltDeg;
uniform float uSaturation;
uniform float uSheen;           // 태양 쪽 전방산란 광택 세기
uniform float uExposure;        // 국소 순응 보정 (아래 주석)

// ── 물 (docs/GROUND_PLAN.md 4·5단계) ────────────────────────────────────────
uniform sampler2D uWaterTex;    // 방위별 수역 비율 (0~1), 가로 = 방위
uniform float uHasWater;        // 0이면 물 경로를 통째로 건너뜁니다
uniform vec3  uSunRadiance;     // 지면 고도에서의 직달광 (선형)
uniform float uSunAltRad;
uniform float uSlopeVar;        // Cox-Munk 파면 경사 분산 σ²
// 물이 되비출 하늘을 셰이더 안에서 직접 계산합니다 (atm_skyRadiance).
uniform float uBeta;
uniform float uAngstrom;
uniform float uElevScale;
uniform float uOzoneDU;

varying vec3 vWorld;

/**
 * 프레넬 반사율 (Schlick, 물 n=1.33 → F0 = 0.02).
 *
 * 물이 특별한 이유가 이 함수에 있습니다. 수직으로 내려다보면 2%만 반사해
 * 거의 검지만, **스치는 각에서는 급격히 1에 가까워집니다** (85°에서 0.6 이상).
 * 해 질 녘 물이 타오르는 것이 정확히 이것입니다.
 */
float waterFresnel(float cosTheta) {
  float f = pow(1.0 - clamp(cosTheta, 0.0, 1.0), 5.0);
  return 0.02 + 0.98 * f;
}

void main() {
  // 관측자는 원점에 있습니다. 이 픽셀이 보이는 방향.
  vec3 dir = normalize(vWorld);
  float sinDown = max(1e-3, -dir.y);   // 아래를 볼수록 1에 가까움

  // ── 방위별 전방산란 광택 ────────────────────────────────────────────────
  //
  // 지면은 램버시안이 아닙니다. 풀·아스팔트·젖은 표면 모두 **태양 쪽으로
  // 강한 전방산란 로브**를 갖습니다. 낮은 태양에서 태양 쪽 지면을 보면
  // 번들거리고 반대쪽은 어두운 것이 그 때문입니다.
  //
  // 이 항이 없으면 지면이 방향에 무관한 한 가지 색이 되어 회색 판때기로
  // 보입니다 — 실루엣을 못 그리는 만큼, 이 각도 의존성이 "표면임"을 알려주는
  // 몇 안 되는 단서입니다.
  float az = atan(dir.x, -dir.z);
  float dAz = cos(az - uSunAzRad);            // 태양 쪽 +1, 반대쪽 -1
  // 스치는 각(지평선 쪽)일수록 전방산란이 강합니다.
  float grazing = 1.0 - sinDown;
  float sheen = uSheen * max(0.0, dAz) * pow(grazing, 2.0);

  // ── 발밑 감광 ───────────────────────────────────────────────────────────
  //
  // 눈높이 1.6m에서 아래를 보면 **거의 발밑**입니다 (고도각 -10°면 9m).
  // 그 근처는 자기 그림자와 주변 가림으로 하늘을 덜 봅니다.
  // 0.55까지 떨어뜨리면 톤 곡선을 지나며 화면 아래가 **완전히 검게** 됩니다
  // (측정: rgb(0,1,1)). 어두운 건 맞지만 새까매지면 표면이라는 감각이 사라져
  // 오히려 UI 배경처럼 보입니다. 0.78이 렌더로 고른 값입니다.
  float nearShade = mix(1.0, 0.78, smoothstep(0.05, 0.6, sinDown));

  // ── 국소 순응 ───────────────────────────────────────────────────────────
  //
  // 지면 복사휘도는 하늘의 알베도 배(≈0.2)라 **톤 곡선의 발끝**에 박힙니다.
  // ACES의 발끝은 거의 이차식이라 그 구간에서 화면값이 0에 붙어, 물리적으로
  // 맞는 값을 넣어도 검은 띠가 됩니다 (측정: rgb(0,1,1)).
  //
  // 사진에서 전경이 새까만 것은 사실이지만, **사람 눈은 국소로 순응합니다** —
  // 노을을 보다 발밑을 보면 땅이 보입니다. 전역 톤 곡선 하나로는 그 둘을
  // 동시에 담을 수 없어서, 사진가가 그래듀에이티드 ND를 쓰는 것과 같은 이유로
  // 지면에만 노출을 올립니다. 알베도를 부풀리는 것과 달리 **물리를 고치지 않고
  // 표시만 고치는** 선택이라 여기 한 줄로 분리해 둡니다.
  vec3 col = uGroundRadiance * uExposure * nearShade * (1.0 + sheen);

  // ── 물 ──────────────────────────────────────────────────────────────────
  if (uHasWater > 0.5) {
    float azFrac = fract((az / 6.2831853) + 1.0);
    float water = texture2D(uWaterTex, vec2(azFrac, 0.5)).r;

    if (water > 0.003) {
      // V = 수면에서 눈으로, L = 수면에서 태양으로.
      vec3 V = -dir;
      vec3 L = vec3(cos(uSunAltRad) * sin(uSunAzRad),
                    sin(uSunAltRad),
                    -cos(uSunAltRad) * cos(uSunAzRad));

      // ── 윤슬: Cox-Munk 파면 경사 ─────────────────────────────────────
      //
      // 잔물결 하나하나를 그릴 수는 없지만, **경사의 분포**는 압니다.
      // Cox & Munk (1954)가 풍속의 함수로 재 놓았습니다:
      //     σ² = 0.003 + 0.00512 · U      (U = 10m 풍속, m/s)
      //
      // 눈과 태양을 잇는 반벡터 H가 그 지점에서 정반사를 일으키는 면의
      // 법선입니다. H가 수직에서 얼마나 기울었는지를 가우시안에 넣으면
      // 그 경사를 가진 면의 비율 = 그 방향의 밝기가 됩니다.
      //
      // 풍속이 낮으면 좁고 날카로운 기둥, 높으면 넓고 부드러운 띠가 되는
      // 것이 σ² 하나에서 나옵니다.
      vec3 H = normalize(V + L);
      float cosN = max(H.y, 1e-3);            // 면 법선이 수직에서 기운 정도
      float tan2 = (1.0 - cosN * cosN) / (cosN * cosN);
      float p = exp(-tan2 / max(1e-4, uSlopeVar))
              / (3.14159265 * max(1e-4, uSlopeVar) * pow(cosN, 4.0));

      float cosV = max(-dir.y, 1e-3);         // 시선이 수면과 이루는 각
      float F = waterFresnel(dot(V, H));
      vec3 glitter = uSunRadiance * (F * p / (4.0 * cosV));

      // ── 하늘 되비침 ──────────────────────────────────────────────────
      //
      // 반짝임이 없는 곳의 물은 **하늘을 비춥니다.** 스치는 각일수록 프레넬이
      // 커져 더 많이 비추고, 내려다볼수록 물 자체 색(거의 검음)이 드러납니다.
      //
      // ⚠ **거울 방향의 하늘**을 봐야 합니다. 처음에 수평선 하늘색 하나를 모든
      // 시선각에 썼더니 수면 전체가 노을색으로 포화돼 윤슬이 파묻혔습니다
      // (측정: 수면 평균 238/255, 풍속을 4배 올려도 기둥 폭 0.56 → 0.59).
      // 고도 -10°로 내려다본 물은 +10° 하늘을 비추지 수평선을 비추지 않습니다.
      vec3 mirrorDir = vec3(dir.x, -dir.y, dir.z);
      float mirrorElev = degrees(asin(clamp(mirrorDir.y, -1.0, 1.0)));
      float cosG = dot(normalize(mirrorDir), L);
      vec3 skyRefl = atm_skyRadiance(mirrorElev, cosG, uSunAltDeg,
                                     uBeta, uAngstrom, uElevScale, uOzoneDU);

      float Fv = waterFresnel(cosV);
      vec3 body = uGroundRadiance * (WATER_ALBEDO_REL);   // 물 자체는 거의 검음
      vec3 waterCol = skyRefl * Fv + body * (1.0 - Fv);

      vec3 wet = (waterCol + glitter) * uExposure;
      col = mix(col, wet, water);
    }
  }

  // 하늘과 **같은 표시 경로**를 통과시킵니다. 이게 없으면 두 축이 달라져
  // 상수를 손으로 맞출 수밖에 없습니다 (예전이 그랬습니다).
  gl_FragColor = vec4(atm_display(col, uSaturation, uSunAltDeg), 1.0);
}
`;

/**
 * 방위별 수역 비율을 가로 한 줄짜리 텍스처로 굽습니다.
 *
 * uniform 배열을 동적 인덱스로 읽는 것은 GLSL ES 1.0에서 보장되지 않으므로
 * 텍스처를 씁니다 (텍스처 조회는 언제나 동적 인덱싱이 됩니다).
 *
 * `RepeatWrapping` + 선형 보간이라 방위 0°/360° 이음매가 자연히 이어지고,
 * 해안선이 계단이 아니라 부드러운 경계로 나옵니다.
 */
export function makeWaterTexture(waterFrac: number[] | null): THREE.DataTexture {
  const N = 64;
  const data = new Uint8Array(N * 4);
  for (let i = 0; i < N; i++) {
    let v = 0;
    if (waterFrac && waterFrac.length > 0) {
      // 방위 i/N 에 해당하는 입력 표본을 선형 보간합니다.
      const t = (i / N) * waterFrac.length;
      const a = Math.floor(t) % waterFrac.length;
      const b = (a + 1) % waterFrac.length;
      const f = t - Math.floor(t);
      v = waterFrac[a] * (1 - f) + waterFrac[b] * f;
    }
    const b8 = Math.round(Math.max(0, Math.min(1, v)) * 255);
    data[i * 4] = b8; data[i * 4 + 1] = b8; data[i * 4 + 2] = b8; data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, N, 1, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * 관측 고도에서 **바다 수평선**의 내려앉음(dip)을 구합니다 (도).
 *
 *     dip = acos(R / (R + h))
 *
 * 30m에서 0.176°, 100m에서 0.32°. 지형선과 달리 수평선은 완벽하게 평평하고
 * 이 각도 하나로 정해집니다 — 그래서 물은 "없는 걸 안 만들어도 되는" 지표면
 * 입니다.
 */
export function seaHorizonDipDeg(observerElevM: number): number {
  const R = 6371000;
  const h = Math.max(0, observerElevM);
  return (Math.acos(R / (R + h)) * 180) / Math.PI;
}

/**
 * 지면 원반을 **바다 수평선 각도에 맞춰** 내립니다.
 *
 * 원반 가장자리가 곧 보이는 지평선입니다. 예전에는 y = −8 (가장자리 −0.95°)
 * 로 고정이었는데, 실제 30m 관측점의 수평선은 −0.176° 입니다 — 5배 아래로
 * 내려가 있었습니다. 육지에서는 지형이 가려 안 보이지만 바다에서는 바로
 * 드러납니다.
 */
export function setGroundHorizon(mesh: THREE.Mesh, observerElevM: number): void {
  const dip = seaHorizonDipDeg(observerElevM);
  mesh.position.y = -TERRAIN_RING_RADIUS * Math.tan((dip * Math.PI) / 180);
}

/** 거리대 하나에 해당하는 능선 링 */
export interface TerrainBand {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  distanceKm: number;
}

export interface TerrainBandsHandle {
  group: THREE.Group;
  bands: TerrainBand[];
  dispose: () => void;
}

/**
 * **거리대별 능선 링**을 만듭니다 (docs/GROUND_PLAN.md 3단계).
 *
 * 예전 `createTerrainRing`은 세 거리(5·15·40km)의 지형각을 **최댓값 하나로
 * 뭉개** 띠 하나로 그렸습니다. 그러면 "가까운 언덕 뒤에 먼 산"이라는 정보가
 * 사라지고, 대기 투시를 걸 대상도 없어집니다 — 화면에 깊이가 안 생깁니다.
 *
 * 여기서는 거리대마다 링을 하나씩 만들고 **먼 것부터** 그립니다. 가까운
 * 능선이 먼 능선을 가리므로(화가 알고리즘) 겹침이 그대로 나타납니다.
 *
 * @param bandAngles     `[거리대][방위]` 지형각 (도)
 * @param distancesKm    각 거리대의 거리
 */
export function createTerrainBands(
  bandAngles: number[][],
  distancesKm: number[],
  maxVisualAngle: number = TERRAIN_MAX_ANGLE_DEG,
  /**
   * 방위별 수역 비율. 물인 방위에서는 능선을 접습니다 — 안 그러면 해면 위에
   * 육지색 띠가 얹혀 수평선이 지형선처럼 보입니다. (바다 표본은 고도 0이라
   * 지형각이 음수로 나오고, 그걸 0으로 클램프하면 지평선에 딱 붙은 얇은
   * 띠가 되어 그 자리를 가립니다.)
   */
  waterFrac?: number[] | null
): TerrainBandsHandle {
  const group = new THREE.Group();
  group.name = 'terrainBands';
  const bands: TerrainBand[] = [];

  // 먼 거리대를 먼저 그립니다. renderOrder가 클수록 나중이므로 가까울수록 큽니다.
  const order = distancesKm
    .map((d, i) => ({ d, i }))
    .sort((a, b) => b.d - a.d);

  order.forEach(({ d, i }, rank) => {
    const angles = bandAngles[i];
    if (!angles || angles.length === 0) return;

    const vertexCount = TERRAIN_SEGMENTS * 2;
    const positions = new Float32Array(vertexCount * 3);
    const elevAttr = new Float32Array(vertexCount);
    const hazeAttr = new Float32Array(vertexCount * 3);
    const indices: number[] = [];

    for (let s = 0; s < TERRAIN_SEGMENTS; s++) {
      const azFrac = s / TERRAIN_SEGMENTS;
      const azRad = azFrac * Math.PI * 2;

      const angleIdx = azFrac * (angles.length - 1);
      const i0 = Math.floor(angleIdx);
      const i1 = Math.min(i0 + 1, angles.length - 1);
      const f = angleIdx - i0;
      const raw = angles[i0] * (1 - f) + angles[i1] * f;
      let topDeg = Math.min(Math.max(raw, 0), maxVisualAngle);

      if (waterFrac && waterFrac.length > 0) {
        const wIdx = azFrac * (waterFrac.length - 1);
        const w0 = Math.floor(wIdx);
        const w1 = Math.min(w0 + 1, waterFrac.length - 1);
        const wf = wIdx - w0;
        const water = waterFrac[w0] * (1 - wf) + waterFrac[w1] * wf;
        // 물이 우세한 방위는 능선을 지평선 아래로 접습니다.
        topDeg = topDeg * (1 - Math.min(1, water * 1.4));
      }

      // ⚠ 아래로 얼마나 내릴지가 중요합니다.
      //
      // 처음에 -30°까지 내렸더니 띠가 **지면 원반을 통째로 덮었습니다**
      // (띠가 지면보다 나중에 그려집니다). 그러면 지평선 아래 전부가 "5km
      // 거리의 대기 투시를 먹은 색"이 되는데, 발밑 땅은 5km가 아니라 수십
      // 미터 앞이라 연무가 거의 없습니다. 태양 쪽을 볼 때 특히 어긋납니다 —
      // 어두워야 할 전경이 연무색으로 밝아집니다.
      //
      // 지면 원반의 가장자리가 고도 -0.95°이므로, 그보다 조금만 내려
      // 틈은 없애고 겹침은 최소로 둡니다.
      const botDeg = -2.5;
      const dirX = Math.sin(azRad);
      const dirZ = -Math.cos(azRad);

      // 거리대마다 반지름을 조금씩 달리해 z-fighting을 피합니다.
      const R = TERRAIN_RING_RADIUS - rank * 3;

      const put = (vi: number, deg: number) => {
        const e = (deg * Math.PI) / 180;
        positions[vi * 3] = dirX * R * Math.cos(e);
        positions[vi * 3 + 1] = R * Math.sin(e);
        positions[vi * 3 + 2] = dirZ * R * Math.cos(e);
        elevAttr[vi] = deg;
      };
      put(s * 2, botDeg);
      put(s * 2 + 1, topDeg);

      const n = (s + 1) % TERRAIN_SEGMENTS;
      indices.push(s * 2, s * 2 + 1, n * 2);
      indices.push(n * 2, s * 2 + 1, n * 2 + 1);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aElevDeg', new THREE.BufferAttribute(elevAttr, 1));
    geometry.setAttribute('aHaze', new THREE.BufferAttribute(hazeAttr, 3));
    geometry.setIndex(indices);

    const material = new THREE.ShaderMaterial({
      uniforms: {
        ...makeTuningUniforms(),
        uTerrainRadiance: { value: new THREE.Vector3(0.02, 0.018, 0.014) },
        uDistanceKm: { value: d },
        uBeta: { value: 0.08 },
        uAngstrom: { value: 1.3 },
        uElevScale: { value: 1.0 },
        uSunAltDeg: { value: 30 },
        uSaturation: { value: 1.0 },
        uExposure: { value: GROUND_EXPOSURE },
      },
      vertexShader: BAND_VERT,
      fragmentShader: BAND_FRAG,
      // 안쪽에서 보는 원통이라 감김 방향에 기대지 않습니다 (위 주석 참고).
      side: THREE.DoubleSide,
      depthWrite: true,
      depthTest: true,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `terrainBand_${d}km`;
    // 지면 원반(−0.5)보다 뒤, 구름(1)보다 앞. 먼 거리대일수록 먼저.
    mesh.renderOrder = -0.4 + rank * 0.05;
    group.add(mesh);
    bands.push({ mesh, material, distanceKm: d });
  });

  return {
    group,
    bands,
    dispose: () => {
      for (const b of bands) {
        b.mesh.geometry.dispose();
        b.material.dispose();
      }
    },
  };
}

/**
 * 거리대별 능선의 색을 갱신합니다. 지면 원반과 **같은 조도 × 알베도**를 쓰되,
 * 능선은 사면이라 하늘을 조금 덜 봅니다.
 */
export function updateTerrainBands(
  handle: TerrainBandsHandle,
  sunAltitude: number,
  opts: {
    skyMean: { r: number; g: number; b: number };
    /**
     * **방위·고도별** 하늘색 (연무). 먼 능선이 자기 뒤 하늘에 잠깁니다.
     *
     * 고도까지 받는 이유: 고정 고도(예: 1°)에서 뽑으면 능선 꼭대기가 조금
     * 높은 띠가 자기 뒤 하늘보다 밝게 칠해집니다. 실측에서 40km 띠가 15km
     * 띠보다 대비가 커지는 역전이 그래서 생겼습니다.
     */
    hazeAt: (azimuthDeg: number, elevDeg: number) => { r: number; g: number; b: number };
    beam?: { r: number; g: number; b: number };
    sunTransmittance?: number;
    betaMie: number;
    angstrom: number;
    elevScale: number;
    saturation?: number;
  }
): void {
  const sunT = clamp01(opts.sunTransmittance ?? 1);
  const sinAlt = Math.max(0, Math.sin((sunAltitude * Math.PI) / 180));
  const beam = opts.beam ?? { r: 0, g: 0, b: 0 };
  const direct = (sinAlt * sunT) / Math.PI;

  // 능선은 수평면이 아니라 사면이라 하늘을 덜 봅니다 (하늘 가림 ≈ 0.72).
  const SKY_VIEW = 0.72;
  const r = (opts.skyMean.r * SKY_VIEW + beam.r * direct) * GROUND_ALBEDO.r;
  const g = (opts.skyMean.g * SKY_VIEW + beam.g * direct) * GROUND_ALBEDO.g;
  const b = (opts.skyMean.b * SKY_VIEW + beam.b * direct) * GROUND_ALBEDO.b;

  for (const band of handle.bands) {
    const u = band.material.uniforms;
    (u.uTerrainRadiance.value as THREE.Vector3).set(r, g, b);

    // 방위별 연무를 정점 속성에 씁니다. 정점은 방위 s 마다 2개(아래/위)입니다.
    const hz = band.mesh.geometry.getAttribute('aHaze') as THREE.BufferAttribute;
    const el = band.mesh.geometry.getAttribute('aElevDeg') as THREE.BufferAttribute;
    for (let s = 0; s < TERRAIN_SEGMENTS; s++) {
      const az = (s / TERRAIN_SEGMENTS) * 360;
      // 능선 꼭대기 바로 뒤 하늘을 씁니다. 아래쪽 정점은 -30°라 하늘이
      // 없으므로 같은 값을 넣습니다 (거기는 어차피 앞 띠에 가려집니다).
      const topDeg = Math.max(0.3, el.getX(s * 2 + 1));
      const h = opts.hazeAt(az, topDeg);
      hz.setXYZ(s * 2, h.r, h.g, h.b);
      hz.setXYZ(s * 2 + 1, h.r, h.g, h.b);
    }
    hz.needsUpdate = true;
    u.uBeta.value = opts.betaMie;
    u.uAngstrom.value = opts.angstrom;
    u.uElevScale.value = opts.elevScale;
    u.uSunAltDeg.value = sunAltitude;
    u.uSaturation.value = (opts.saturation ?? 1.0) * 0.55;
  }
}

/**
 * 지평선 발 아래 전체를 덮는 3D 대지(Ground Plane) 원반 Mesh를 생성합니다.
 */
export function createGroundPlane(): THREE.Mesh {
  const geometry = new THREE.CircleGeometry(TERRAIN_RING_RADIUS, 64);

  const material = new THREE.ShaderMaterial({
    uniforms: {
      ...makeTuningUniforms(),
      // 지면이 되쏘는 복사휘도 (선형). 하늘과 **같은 단위**입니다.
      uGroundRadiance: { value: new THREE.Vector3(0.02, 0.019, 0.015) },
      uSunAzRad: { value: 0 },
      uSunAltDeg: { value: 30 },
      uSaturation: { value: 1.0 },
      uSheen: { value: 0.0 },
      uExposure: { value: 1.0 },
      uWaterTex: { value: makeWaterTexture(null) },
      uHasWater: { value: 0.0 },
      uSunRadiance: { value: new THREE.Vector3(0, 0, 0) },
      uSunAltRad: { value: 0.5 },
      uSlopeVar: { value: 0.03 },
      uBeta: { value: 0.08 },
      uAngstrom: { value: 1.3 },
      uElevScale: { value: 1.0 },
      uOzoneDU: { value: 330 },
    },
    vertexShader: GROUND_VERT,
    fragmentShader: GROUND_FRAG,
    side: THREE.DoubleSide,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: 3,
    polygonOffsetUnits: 3,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'groundPlane';
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = -8.0; // Z-fighting 차단을 위해 지형 링 하단 아래로 배치
  // ── renderOrder: 스카이돔(−1) **뒤에** 그려야 합니다 ──────────────────────
  //
  // 예전에는 −2 였습니다. 그러면 지면이 먼저 그려지는데 `depthWrite: false`라
  // 깊이를 안 남기고, 곧이어 스카이돔이 **`depthTest: false`로 전체 구를**
  // 칠하면서 지면을 통째로 덮어 버립니다.
  //
  // 측정: 지면 원반을 씬에서 아예 빼도 화면 최대 픽셀차가 **1/255** 였습니다.
  // 매 프레임 `updateGroundColors`로 색을 다시 칠하는데 한 픽셀도 안 나오고
  // 있었고, 지평선 아래에 보이던 금빛은 땅이 아니라 **하늘 셰이더의 아래쪽
  // 반구**였습니다 (docs/GROUND_PLAN.md §1).
  //
  // 스카이돔의 `depthTest: false`는 "항상 배경"이라는 의도이므로 건드리지
  // 않고, 지면을 그 뒤로 옮깁니다. 지형 링(0)보다는 앞에 두어 능선이 지면
  // 위에 얹히게 합니다.
  mesh.renderOrder = -0.5;

  return mesh;
}

/**
 * 3D 씬 내부에 지평선 방위 링과 N, E, S, W 방위 표시 선 및 포인트를 생성하는 그룹을 만듭니다.
 */
export function createCompassGroup(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'compassGroup';

  // 1. 방위 링 (Circle Line)
  const ringRadius = 475;
  const ringPoints: THREE.Vector3[] = [];
  const segments = 72;
  for (let i = 0; i <= segments; i++) {
    const theta = (i / segments) * Math.PI * 2;
    ringPoints.push(new THREE.Vector3(Math.sin(theta) * ringRadius, 0.2, -Math.cos(theta) * ringRadius));
  }
  const ringGeom = new THREE.BufferGeometry().setFromPoints(ringPoints);
  const ringMat = new THREE.LineBasicMaterial({
    color: 0x38bdf8,
    transparent: true,
    opacity: 0.35,
  });
  const ringLine = new THREE.Line(ringGeom, ringMat);
  group.add(ringLine);

  // 2. 주요 방위축 십자선 (N-S, E-W)
  const axisPoints: THREE.Vector3[] = [
    // N - S (Z축)
    new THREE.Vector3(0, 0.2, -ringRadius),
    new THREE.Vector3(0, 0.2, ringRadius),
    // E - W (X축)
    new THREE.Vector3(-ringRadius, 0.2, 0),
    new THREE.Vector3(ringRadius, 0.2, 0),
  ];
  const axisGeom = new THREE.BufferGeometry().setFromPoints(axisPoints);
  const axisMat = new THREE.LineBasicMaterial({
    color: 0x38bdf8,
    transparent: true,
    opacity: 0.2,
  });
  const axisLines = new THREE.LineSegments(axisGeom, axisMat);
  group.add(axisLines);

  // 3. 주요 8방위 노치 마커 (Points)
  const markerPositions: number[] = [];
  const markerColors: number[] = [];
  const directions = [
    { name: 'N', az: 0, main: true },
    { name: 'NE', az: 45, main: false },
    { name: 'E', az: 90, main: true },
    { name: 'SE', az: 135, main: false },
    { name: 'S', az: 180, main: true },
    { name: 'SW', az: 225, main: false },
    { name: 'W', az: 270, main: true },
    { name: 'NW', az: 315, main: false },
  ];

  directions.forEach(dir => {
    const rad = (dir.az * Math.PI) / 180;
    const x = Math.sin(rad) * ringRadius;
    const z = -Math.cos(rad) * ringRadius;
    markerPositions.push(x, 0.5, z);

    if (dir.name === 'N') {
      // 북쪽(N)은 붉은색 강렬한 마커
      markerColors.push(0.94, 0.25, 0.37);
    } else if (dir.main) {
      // 동, 남, 서는 연푸른색
      markerColors.push(0.22, 0.74, 0.97);
    } else {
      // 보조 방위는 은은한 백색
      markerColors.push(0.6, 0.7, 0.8);
    }
  });

  const markerGeom = new THREE.BufferGeometry();
  markerGeom.setAttribute('position', new THREE.Float32BufferAttribute(markerPositions, 3));
  markerGeom.setAttribute('color', new THREE.Float32BufferAttribute(markerColors, 3));

  const markerMat = new THREE.PointsMaterial({
    size: 10,
    vertexColors: true,
    transparent: true,
    opacity: 0.8,
  });
  const markers = new THREE.Points(markerGeom, markerMat);
  group.add(markers);

  return group;
}

const tempSunDir = new THREE.Vector3();
const tempNormal = new THREE.Vector3();

export function disposeTerrainRing(mesh: THREE.Mesh): void {
  mesh.geometry?.dispose();
  if (Array.isArray(mesh.material)) {
    mesh.material.forEach(m => m.dispose());
  } else {
    (mesh.material as THREE.Material)?.dispose();
  }
}

export function disposeGroundPlane(mesh: THREE.Mesh): void {
  mesh.geometry?.dispose();
  if (Array.isArray(mesh.material)) {
    mesh.material.forEach(m => m.dispose());
  } else {
    (mesh.material as THREE.Material)?.dispose();
  }
}

export function disposeCompassGroup(group: THREE.Group): void {
  group.traverse(child => {
    if (child instanceof THREE.Mesh || child instanceof THREE.Line || child instanceof THREE.LineSegments || child instanceof THREE.Points) {
      child.geometry?.dispose();
      if (Array.isArray(child.material)) {
        child.material.forEach(m => m.dispose());
      } else {
        (child.material as THREE.Material)?.dispose();
      }
    }
  });
}

/**
 * 지형 및 지면 색상을 태양 고도, 방위각, 날씨에 따라 입체 음영(Hillshading)으로 업데이트합니다.
 */
export function updateTerrainColors(
  mesh: THREE.Mesh,
  sunAltitude: number,
  sunAzimuth: number = 180,
  overcast: number = 0,
  dustIntensity: number = 0
): void {
  const geometry = mesh.geometry as THREE.BufferGeometry;
  const colorAttr = geometry.attributes.color as THREE.BufferAttribute;
  if (!colorAttr) return;

  const t = clamp01((sunAltitude + 6) / 14);

  const sunsetGlowFactor = Math.max(0, 1.0 - (overcast * 1.3 + dustIntensity * 0.9)) *
    (1.0 - Math.pow(Math.abs(t - 0.4) / 0.4, 2));
  const glow = clamp01(sunsetGlowFactor);

  // 태양 입사광 단위 벡터 L
  const altRad = (sunAltitude * Math.PI) / 180;
  const azRad = (sunAzimuth * Math.PI) / 180;
  tempSunDir.set(
    Math.sin(azRad) * Math.cos(altRad),
    Math.sin(altRad),
    -Math.cos(azRad) * Math.cos(altRad)
  ).normalize();

  const nightBase = { r: 0.04, g: 0.05, b: 0.10 };
  const dayBase = { r: 0.16, g: 0.22, b: 0.17 };
  const goldenBase = { r: 0.28, g: 0.14, b: 0.08 };

  const nightTop = { r: 0.07, g: 0.08, b: 0.15 };
  const dayTop = { r: 0.28, g: 0.26, b: 0.22 };
  const goldenTop = { r: 0.42, g: 0.20, b: 0.12 };

  const severity = Math.max(overcast, dustIntensity);
  const grayR = 0.15, grayG = 0.16, grayB = 0.17;

  const lerp = (a: number, b: number, f: number) => a + (b - a) * f;

  const count = colorAttr.count; // TERRAIN_SEGMENTS * 2
  const segments = count / 2;

  for (let i = 0; i < segments; i++) {
    // 세그먼트별 지형 법선 벡터 N (지평선 원통 세그먼트 방향)
    const segAz = (i / segments) * Math.PI * 2;
    tempNormal.set(Math.sin(segAz), 0.1, -Math.cos(segAz)).normalize();

    // 태양 입사각 내적 N dot L (입체 음영 요인)
    const dot = Math.max(-0.4, Math.min(1.0, tempNormal.dot(tempSunDir)));
    const hillshade = (dot + 0.4) / 1.4; // 0 ~ 1 범위로 정규화

    const bIdx = i * 2;
    const tIdx = i * 2 + 1;

    // 하단/상단 기본 색상
    const baseB = { r: lerp(nightBase.r, dayBase.r, t), g: lerp(nightBase.g, dayBase.g, t), b: lerp(nightBase.b, dayBase.b, t) };
    const baseT = { r: lerp(nightTop.r, dayTop.r, t), g: lerp(nightTop.g, dayTop.g, t), b: lerp(nightTop.b, dayTop.b, t) };

    // 음영(Hillshading) 반영: 양지는 밝고 구릿빛, 음지는 딥블루 그림자
    const shadeFactor = 0.4 + hillshade * 0.75;
    baseB.r *= shadeFactor; baseB.g *= shadeFactor; baseB.b *= shadeFactor;
    baseT.r *= shadeFactor; baseT.g *= shadeFactor; baseT.b *= shadeFactor;

    if (glow > 0.05) {
      baseT.r = lerp(baseT.r, goldenTop.r * hillshade, glow * 0.7);
      baseT.g = lerp(baseT.g, goldenTop.g * hillshade, glow * 0.7);
      baseT.b = lerp(baseT.b, goldenTop.b * hillshade, glow * 0.7);
    }

    if (severity > 0.1) {
      baseB.r = lerp(baseB.r, grayR, severity * 0.7);
      baseB.g = lerp(baseB.g, grayG, severity * 0.7);
      baseB.b = lerp(baseB.b, grayB, severity * 0.7);
      baseT.r = lerp(baseT.r, grayR, severity * 0.7);
      baseT.g = lerp(baseT.g, grayG, severity * 0.7);
      baseT.b = lerp(baseT.b, grayB, severity * 0.7);
    }

    colorAttr.setXYZ(bIdx, baseB.r, baseB.g, baseB.b);
    colorAttr.setXYZ(tIdx, baseT.r, baseT.g, baseT.b);
  }

  colorAttr.needsUpdate = true;
}

/**
 * 지면 원반의 밝기를 **조도 × 알베도**로 계산합니다.
 *
 * 예전에는 `nightG` / `dayG` / `goldenG` 상수를 태양 고도로 섞었습니다.
 * 근거가 없었고, 무엇보다 지면이 `MeshBasicMaterial`이라 하늘과 **다른 축**에
 * 있었습니다 — 하늘만 `atm_display`(톤매핑 + 눈 순응)를 통과했으니 두 밝기를
 * 비교할 방법이 아예 없었고, 그래서 상수를 손으로 맞출 수밖에 없었습니다.
 *
 * 이제 둘 다 선형 복사휘도로 계산해 같은 `atm_display`를 통과합니다.
 *
 *     지면 휘도 = (하늘에서 온 조도 + 직달 조도) × 알베도 / π
 *
 * 하늘 조도는 반구 평균 복사휘도 `L̄` 에서 `E = π·L̄` 이므로,
 * 나눗셈이 상쇄되어 `L̄ × 알베도` 가 됩니다. 직달 쪽만 `/π` 가 남습니다.
 *
 * **결과적으로 지면은 하늘보다 알베도 배(≈0.2)만큼 어둡습니다.** 이게 실제
 * 모습이고, 예전에 지평선 아래가 하늘보다 밝았던 것이 거꾸로였습니다.
 */
export function updateGroundColors(
  mesh: THREE.Mesh,
  sunAltitude: number,
  overcast: number = 0,
  opts?: {
    /** 반구 평균 하늘 복사휘도 (선형). 없으면 태양 고도로 근사합니다. */
    skyMean?: { r: number; g: number; b: number };
    /** 지면 고도에서의 직달광 (선형, `beamAtAltitude(alt, 0, atm)`). */
    beam?: { r: number; g: number; b: number };
    /** 구름을 통과한 직달광 비율 (0~1). */
    sunTransmittance?: number;
    sunAzimuthDeg?: number;
    saturation?: number;
    /** 방위별 수역 비율. `makeWaterTexture`로 구운 것을 넘깁니다. */
    waterTex?: THREE.DataTexture | null;
    /** 대기 파라미터 — 물이 되비출 하늘을 셰이더 안에서 직접 계산합니다. */
    betaMie?: number;
    angstrom?: number;
    elevScale?: number;
    ozoneDU?: number;
    /** 10m 고도 풍속 (m/s). 윤슬 폭이 이걸로 정해집니다. */
    windSpeedMs?: number;
  }
): void {
  const mat = mesh.material as THREE.ShaderMaterial;
  if (!mat?.uniforms?.uGroundRadiance) return;
  const u = mat.uniforms;

  const sunT = clamp01(opts?.sunTransmittance ?? 1 - overcast);
  const sinAlt = Math.max(0, Math.sin((sunAltitude * Math.PI) / 180));

  // 하늘 조도. 실측값이 없으면 태양 고도에 따른 대략적인 반구 평균으로
  // 대신합니다 (호출부가 값을 넘기면 그쪽이 항상 우선입니다).
  const sky = opts?.skyMean ?? fallbackSkyMean(sunAltitude);
  const beam = opts?.beam ?? { r: 0, g: 0, b: 0 };

  // E_sky/π = L̄  이므로 하늘 항은 알베도만 곱하면 됩니다.
  // 직달 항은 수평면 조도이므로 sin(고도)를 곱하고 π로 나눕니다.
  const direct = (sinAlt * sunT) / Math.PI;
  const r = sky.r * GROUND_ALBEDO.r + beam.r * direct * GROUND_ALBEDO.r;
  const g = sky.g * GROUND_ALBEDO.g + beam.g * direct * GROUND_ALBEDO.g;
  const b = sky.b * GROUND_ALBEDO.b + beam.b * direct * GROUND_ALBEDO.b;

  (u.uGroundRadiance.value as THREE.Vector3).set(r, g, b);
  u.uSunAltDeg.value = sunAltitude;
  u.uSunAzRad.value = ((opts?.sunAzimuthDeg ?? 180) * Math.PI) / 180;
  // 지면 채도는 하늘보다 낮춥니다. `DISP_SAT`은 하늘을 기준으로 맞춘 값이라
  // 그대로 지면에 걸면 흙색이 청록으로 뜹니다 — 지면은 이미 여러 색을 섞어
  // 되쏜 빛이라 실제로도 채도가 낮습니다.
  u.uSaturation.value = (opts?.saturation ?? 1.0) * 0.55;

  // 전방산란 광택은 **직달광이 있을 때만** 의미가 있습니다. 흐리면 방향성이
  // 없어져 사라져야 맞습니다.
  const lowSun = clamp01(1 - Math.abs(sunAltitude) / 25);
  // 1.6이면 광택이 그라데이션을 통째로 지배해, 지평선 쪽만 밝고 아래는
  // 까맣게 됩니다. 방향성이 읽힐 만큼만 남깁니다.
  u.uSheen.value = 0.75 * sunT * lowSun * clamp01(sunAltitude / 3 + 1);

  // 국소 순응 배율. 렌더로 고른 값입니다 — 이보다 낮으면 지평선 아래가 검은
  // 띠가 되고, 높이면 땅이 하늘만큼 밝아져 다시 거짓말이 됩니다.
  // 목표는 "명백히 어둡지만 표면으로 읽히는" 구간입니다.
  u.uExposure.value = GROUND_EXPOSURE;

  // ── 물 ────────────────────────────────────────────────────────────────
  if (opts?.waterTex) {
    u.uWaterTex.value = opts.waterTex;
    u.uHasWater.value = 1.0;
  } else {
    u.uHasWater.value = 0.0;
  }
  const bm = opts?.beam ?? { r: 0, g: 0, b: 0 };
  (u.uSunRadiance.value as THREE.Vector3).set(bm.r * sunT, bm.g * sunT, bm.b * sunT);
  u.uSunAltRad.value = (sunAltitude * Math.PI) / 180;
  u.uBeta.value = opts?.betaMie ?? 0.08;
  u.uAngstrom.value = opts?.angstrom ?? 1.3;
  u.uElevScale.value = opts?.elevScale ?? 1.0;
  u.uOzoneDU.value = opts?.ozoneDU ?? 330;
  // Cox & Munk (1954). 풍속이 0이어도 잔물결이 있어 0.003이 바닥입니다.
  u.uSlopeVar.value = 0.003 + 0.00512 * Math.max(0, opts?.windSpeedMs ?? 5.5);
}

/**
 * 호출부가 실제 하늘 값을 못 넘길 때 쓰는 반구 평균 근사.
 * 맑은 하늘의 대략적인 밝기 곡선일 뿐이고, 실측이 있으면 항상 그쪽을 씁니다.
 */
function fallbackSkyMean(sunAltDeg: number): { r: number; g: number; b: number } {
  const day = clamp01((sunAltDeg + 6) / 14);
  const night = 0.0015;
  const noon = 0.55;
  const s = night + (noon - night) * day * day;
  return { r: s * 0.85, g: s * 0.95, b: s * 1.15 };
}
