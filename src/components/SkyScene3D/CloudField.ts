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

export interface CloudField {
  mesh: THREE.InstancedMesh;
  material: THREE.ShaderMaterial;
  capacity: number;
  dispose: () => void;
}

const VERT = `
precision highp float;

attribute vec4 aUvRect;      // (u0, v0, u1, v1)
attribute vec3 aLit;         // 밝은면 색 (0-1)
attribute vec3 aShadow;      // 그늘면 색 (0-1)
attribute vec2 aSize;        // quad 가로/세로 (월드 유닛)
attribute vec2 aFlags;       // x: opacity, y: 0=빌보드 / 1=수평
attribute vec2 aSunDir;      // quad 로컬 공간에서의 태양 방향 (정규화)

varying vec2 vUv;
varying vec2 vQuad;
varying vec3 vLit;
varying vec3 vShadow;
varying float vOpacity;
varying vec2 vSunDir;

void main() {
  // instanceMatrix에는 구름 중심 위치만 담깁니다(크기/회전은 아래에서 처리).
  vec3 center = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);

  // PlaneGeometry(1,1)의 정점은 -0.5..0.5
  vec2 corner = position.xy;

  vec3 worldPos;
  if (aFlags.y < 0.5) {
    // 카메라를 향하는 빌보드: 뷰 행렬의 right/up 축으로 quad를 펼침
    vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 up    = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    worldPos = center + right * (corner.x * aSize.x) + up * (corner.y * aSize.y);
  } else {
    // 머리 위를 지나는 가까운 구름: XZ 평면에 눕힘
    worldPos = center + vec3(corner.x * aSize.x, 0.0, corner.y * aSize.y);
  }

  vUv = mix(aUvRect.xy, aUvRect.zw, corner + 0.5);
  vQuad = corner;
  vLit = aLit;
  vShadow = aShadow;
  vOpacity = aFlags.x;
  vSunDir = aSunDir;

  gl_Position = projectionMatrix * viewMatrix * vec4(worldPos, 1.0);
}
`;

const FRAG = `
precision highp float;

uniform sampler2D uAtlas;
uniform float uRimStrength;
uniform float uShadeContrast;

varying vec2 vUv;
varying vec2 vQuad;
varying vec3 vLit;
varying vec3 vShadow;
varying float vOpacity;
varying vec2 vSunDir;

void main() {
  float a = texture2D(uAtlas, vUv).a;
  if (a < 0.004) discard;

  // 태양 방향으로 shadow → lit 그라데이션. 단색 대비 부피감이 생기는 핵심.
  float t = clamp(dot(vSunDir, vQuad) * uShadeContrast + 0.5, 0.0, 1.0);
  vec3 col = mix(vShadow, vLit, t);

  // 실루엣 가장자리(알파가 떨어지는 영역)를 살짝 밝힘 → 역광 구름의 림라이트
  float rim = smoothstep(0.85, 0.15, a);
  col += vLit * rim * uRimStrength;

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
  addInstanced('aLit', 3);
  addInstanced('aShadow', 3);
  addInstanced('aSize', 2);
  addInstanced('aFlags', 2);
  addInstanced('aSunDir', 2);

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uAtlas: { value: atlas.texture },
      uRimStrength: { value: 0.28 },
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

  const uvRect = geometry.getAttribute('aUvRect') as THREE.InstancedBufferAttribute;
  const lit = geometry.getAttribute('aLit') as THREE.InstancedBufferAttribute;
  const shadow = geometry.getAttribute('aShadow') as THREE.InstancedBufferAttribute;
  const size = geometry.getAttribute('aSize') as THREE.InstancedBufferAttribute;
  const flags = geometry.getAttribute('aFlags') as THREE.InstancedBufferAttribute;
  const sunDir = geometry.getAttribute('aSunDir') as THREE.InstancedBufferAttribute;

  // 반투명 빌보드는 뒤에서 앞으로 그려야 겹침이 자연스럽습니다.
  // 인스턴스 배열 자체를 거리 내림차순 정렬 (먼 구름 먼저).
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

    // approximateCloudColors는 0-255로 돌려주므로 0-1로 정규화
    lit.setXYZ(i, c.litRGB.r / 255, c.litRGB.g / 255, c.litRGB.b / 255);
    shadow.setXYZ(i, c.shadowRGB.r / 255, c.shadowRGB.g / 255, c.shadowRGB.b / 255);

    size.setXY(i, c.sizeY * c.aspect, c.sizeY);
    flags.setXY(i, c.opacity, c.horizontal ? 1 : 0);

    // quad 로컬 공간에서 태양이 어느 쪽인지.
    // 수평 구름은 위에서 내리쬐므로 방위 차이를, 빌보드는 고도차를 y로 씁니다.
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
  lit.needsUpdate = true;
  shadow.needsUpdate = true;
  size.needsUpdate = true;
  flags.needsUpdate = true;
  sunDir.needsUpdate = true;
}
