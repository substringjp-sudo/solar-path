/**
 * CloudField.ts
 *
 * Why: 구름 하나당 Mesh+Material을 만들면 draw call이 구름 개수만큼 늘고(기존 최대 105개),
 * 업데이트마다 전량 dispose/재생성하느라 GC가 튑니다.
 *
 * 여기서는 InstancedMesh 하나 + 아틀라스 텍스처 하나로 모든 구름을 그립니다.
 *  - draw call: 구름이 몇 개든 1개
 *  - 업데이트: 지오메트리 생성 없이 인스턴스 속성 배열에 숫자만 씀
 *  - 빌보드 회전도 CPU lookAt이 아니라 vertex shader에서 처리
 *
 * 셰이딩은 라이팅 없이 lit/shadow 2색을 태양 방향으로 보간 + 가장자리 림라이트.
 * (기존처럼 두 색을 하나로 뭉개지 않기 때문에 부피감이 살아납니다.)
 */
import * as THREE from 'three';
import type { CloudAtlas } from './cloudAtlas';
import { CLOUD_SHELL_RADIUS, type CloudInstanceData } from './cloudPlacement';
import { ATMOSPHERE_GLSL } from '../../utils/atmosphere';

export interface CloudField {
  mesh: THREE.InstancedMesh;
  material: THREE.ShaderMaterial;
  capacity: number;
  dispose: () => void;
}

const VERT = `
precision highp float;

attribute vec4 aUvRect;      // (u0, v0, u1, v1)
attribute vec3 aBeam;        // 구름 고도에서의 직달광 (linear)
attribute vec3 aAmbient;     // 구름 주변 하늘색 (linear)
attribute vec2 aSize;        // quad 가로/세로 (월드 유닛)
attribute vec3 aParams;      // x: opacity, y: 0=빌보드/1=수평, z: 광학두께 tau
attribute vec2 aSunDir;      // quad 로컬 공간 태양 방향 (음영 그라데이션용)

uniform vec3 uSunDir;        // 월드 태양 방향 (정규화)

varying vec2  vUv;
varying vec2  vQuad;
varying vec3  vBeam;
varying vec3  vAmbient;
varying float vOpacity;
varying float vTau;
varying vec2  vSunDir2D;
varying float vCosView;      // 시선·태양 코사인 → 전방산란(실버라이닝)

void main() {
  vec3 center = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
  vec2 corner = position.xy;   // PlaneGeometry(1,1) → -0.5..0.5

  vec3 worldPos;
  if (aParams.y < 0.5) {
    // 카메라를 향하는 빌보드
    vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 up    = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    worldPos = center + right * (corner.x * aSize.x) + up * (corner.y * aSize.y);
  } else {
    // 머리 위를 지나는 가까운 구름은 눕힘
    worldPos = center + vec3(corner.x * aSize.x, 0.0, corner.y * aSize.y);
  }

  // 관측자(원점)에서 구름을 보는 방향과 태양 방향의 각도.
  // +1이면 구름 뒤에 태양이 있는 역광 → 실버라이닝이 생깁니다.
  vec3 viewDir = normalize(center);
  vCosView = clamp(dot(viewDir, uSunDir), -1.0, 1.0);

  vUv       = mix(aUvRect.xy, aUvRect.zw, corner + 0.5);
  vQuad     = corner;
  vBeam     = aBeam;
  vAmbient  = aAmbient;
  vOpacity  = aParams.x;
  vTau      = aParams.z;
  vSunDir2D = aSunDir;

  gl_Position = projectionMatrix * viewMatrix * vec4(worldPos, 1.0);
}
`;

const FRAG = `
precision highp float;

${ATMOSPHERE_GLSL}

uniform sampler2D uAtlas;
uniform float uShadeContrast;

varying vec2  vUv;
varying vec2  vQuad;
varying vec3  vBeam;
varying vec3  vAmbient;
varying float vOpacity;
varying float vTau;
varying vec2  vSunDir2D;
varying float vCosView;

void main() {
  float a = texture2D(uAtlas, vUv).a;
  if (a < 0.004) discard;

  // ── 구름 광학 ────────────────────────────────────────────────────────────
  // 2-stream 근사: R=확산반사(윗면이 희어짐), T=확산투과(아랫면으로 새는 빛)
  vec2 rt = atm_cloudRT(vTau);
  float R = rt.x;
  float T = rt.y;

  // 얇은 구름이 역광에서 빛나는 실버라이닝 (직달 투과 × 전방산란 위상)
  float silver = atm_cloudSilver(vTau, vCosView);

  // ── 구름 내부 위치에 따른 조명 ───────────────────────────────────────────
  // 태양을 향한 쪽(t→1)은 직접 조명, 반대쪽(t→0)은 내부를 통과한 확산광.
  // 가장자리(알파가 낮은 곳)는 광학적으로 얇으므로 빛이 더 잘 통과합니다.
  float t = clamp(dot(vSunDir2D, vQuad) * uShadeContrast + 0.5, 0.0, 1.0);
  float edgeThin = smoothstep(0.85, 0.1, a);   // 실루엣 가장자리일수록 1

  // 밝은 면: 반사 + 실버라이닝. 두꺼울수록 R이 커져 흰 윗면이 됩니다.
  vec3 litCol = vBeam * (R + silver) + vAmbient * (1.0 - R) * 0.55;
  // 그늘 면: 구름을 통과한 확산광 + 주변 하늘의 재조명.
  // 두꺼울수록 T가 작아져 어두운 회색이 됩니다. (빛을 흡수해서가 아니라
  // 빛이 그 지점까지 도달하지 못해서 — 물방울은 가시광을 거의 흡수하지 않습니다.)
  vec3 shadowCol = vBeam * T * 0.35 + vAmbient * (0.30 + T * 0.45);

  vec3 col = mix(shadowCol, litCol, t);

  // 가장자리는 얇아 빛이 새어나옵니다 (역광일수록 강하게)
  col += vBeam * edgeThin * silver * 0.6;

  // 하늘과 같은 톤매핑 — 구름만 따로 떠 보이지 않게
  col = 1.0 - exp(-col);
  col = atm_toSrgb(col);

  gl_FragColor = vec4(col, a * vOpacity);
}
`;

/**
 * 빈 구름 필드를 만듭니다. 인스턴스 내용은 updateCloudField()로 채웁니다.
 * @param capacity 최대 구름 개수 (버퍼 크기 고정)
 */
export function createCloudField(atlas: CloudAtlas, capacity: number = 320): CloudField {
  // PlaneGeometry를 그대로 사용합니다. InstancedBufferGeometry로 감싸고 attribute를
  // 공유하면, 원본 geometry를 dispose할 때 공유 중인 GPU 버퍼까지 해제되어 위험합니다.
  const geometry = new THREE.PlaneGeometry(1, 1);

  const addInstanced = (name: string, itemSize: number) => {
    const arr = new Float32Array(capacity * itemSize);
    const attr = new THREE.InstancedBufferAttribute(arr, itemSize);
    attr.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute(name, attr);
    return attr;
  };

  addInstanced('aUvRect', 4);
  addInstanced('aBeam', 3);
  addInstanced('aAmbient', 3);
  addInstanced('aSize', 2);
  addInstanced('aParams', 3);
  addInstanced('aSunDir', 2);

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uAtlas: { value: atlas.texture },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uShadeContrast: { value: 1.35 },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    blending: THREE.NormalBlending,
  });

  const mesh = new THREE.InstancedMesh(geometry, material, capacity);
  mesh.name = 'cloudField';
  mesh.count = 0;
  mesh.frustumCulled = false;
  // 하늘(-1)보다 앞, 지형보다 뒤에 그려지도록
  mesh.renderOrder = 1;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

  return {
    mesh,
    material,
    capacity,
    dispose: () => {
      geometry.dispose();
      material.dispose();
    },
  };
}

const _mat = new THREE.Matrix4();
const _pos = new THREE.Vector3();

/**
 * 구름 인스턴스 목록을 GPU 버퍼에 씁니다.
 * 지오메트리 생성/해제가 없어 매 프레임 호출해도 안전합니다.
 *
 * @param sunAzDeg 태양 방위각 — 화면상 음영 방향 계산용
 * @param sunAltDeg 태양 고도
 */
export function updateCloudField(
  field: CloudField,
  atlas: CloudAtlas,
  instances: CloudInstanceData[],
  sunAzDeg: number,
  sunAltDeg: number
): void {
  const { mesh, capacity } = field;
  const geometry = mesh.geometry as THREE.BufferGeometry;

  const uvRect  = geometry.getAttribute('aUvRect') as THREE.InstancedBufferAttribute;
  const beam    = geometry.getAttribute('aBeam') as THREE.InstancedBufferAttribute;
  const ambient = geometry.getAttribute('aAmbient') as THREE.InstancedBufferAttribute;
  const size    = geometry.getAttribute('aSize') as THREE.InstancedBufferAttribute;
  const params  = geometry.getAttribute('aParams') as THREE.InstancedBufferAttribute;
  const sunDir  = geometry.getAttribute('aSunDir') as THREE.InstancedBufferAttribute;

  // 월드 태양 방향 — 셰이더가 역광 여부(실버라이닝)를 판단하는 데 씁니다.
  const sAlt = (sunAltDeg * Math.PI) / 180;
  const sAz = (sunAzDeg * Math.PI) / 180;
  (field.material.uniforms.uSunDir.value as THREE.Vector3).set(
    Math.cos(sAlt) * Math.sin(sAz),
    Math.sin(sAlt),
    -Math.cos(sAlt) * Math.cos(sAz)
  );

  // 반투명 빌보드는 뒤에서 앞으로 그려야 겹침이 자연스럽습니다.
  const sorted = instances.slice(0, capacity).sort((a, b) => b.distanceKm - a.distanceKm);

  for (let i = 0; i < sorted.length; i++) {
    const c = sorted[i];

    const altRad = (c.elevationDeg * Math.PI) / 180;
    const azRad = (c.azimuthDeg * Math.PI) / 180;

    // Three.js 좌표계: Y=up, -Z=North, X=East
    _pos.set(
      CLOUD_SHELL_RADIUS * Math.cos(altRad) * Math.sin(azRad),
      CLOUD_SHELL_RADIUS * Math.sin(altRad),
      -CLOUD_SHELL_RADIUS * Math.cos(altRad) * Math.cos(azRad)
    );
    _mat.makeTranslation(_pos.x, _pos.y, _pos.z);
    mesh.setMatrixAt(i, _mat);

    const rect = atlas.rects.get(c.atlasKey);
    if (rect) {
      uvRect.setXYZW(i, rect.u0, rect.v0, rect.u1, rect.v1);
    } else {
      uvRect.setXYZW(i, 0, 0, 1, 1);
    }

    // 물리 복사휘도(linear). 셰이더가 여기서 2-stream 산란을 계산합니다.
    beam.setXYZ(i, c.beam.r, c.beam.g, c.beam.b);
    ambient.setXYZ(i, c.ambient.r, c.ambient.g, c.ambient.b);

    size.setXY(i, c.sizeY * c.aspect, c.sizeY);
    params.setXYZ(i, c.opacity, c.horizontal ? 1 : 0, c.tau);

    // quad 로컬 공간에서 태양이 어느 쪽인지 (면 내 음영 그라데이션용)
    const azDiff = ((sunAzDeg - c.azimuthDeg + 540) % 360) - 180;
    let sx: number;
    let sy: number;
    if (c.horizontal) {
      sx = Math.sin((azDiff * Math.PI) / 180);
      sy = Math.cos((azDiff * Math.PI) / 180);
    } else {
      sx = Math.sin((azDiff * Math.PI) / 180);
      sy = Math.sin(((sunAltDeg - c.elevationDeg) * Math.PI) / 180);
    }
    const len = Math.hypot(sx, sy) || 1;
    sunDir.setXY(i, sx / len, sy / len);
  }

  mesh.count = sorted.length;
  mesh.instanceMatrix.needsUpdate = true;
  uvRect.needsUpdate = true;
  beam.needsUpdate = true;
  ambient.needsUpdate = true;
  size.needsUpdate = true;
  params.needsUpdate = true;
  sunDir.needsUpdate = true;
}
