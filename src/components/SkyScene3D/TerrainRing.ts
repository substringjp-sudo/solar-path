/**
 * TerrainRing.ts
 *
 * Why: 기존 panoramicAngles (360° 지형 프로필)를 3D 원통형 geometry로 변환.
 * 관측자를 중심으로 360° 둘러싼 지형 실루엣을 렌더링합니다.
 *
 * 쉐이딩 없이 flat color로 렌더링. 기존 terrainColors 팔레트를 그대로 사용.
 */
import * as THREE from 'three';
import { clamp01 } from '../../utils/sunsetPhysics';

const TERRAIN_RING_RADIUS = 480; // 스카이돔(500) 바로 안쪽
const TERRAIN_SEGMENTS = 72;     // 5° 간격으로 충분히 부드러운 실루엣

/**
 * panoramicAngles 배열로부터 360° 지형 링 메시를 생성합니다.
 * 
 * @param panoramicAngles 방위각별 지형 고도각 배열 (균등 간격)
 * @param maxVisualAngle 최대 시각 고도 (기본 8°)
 * @returns THREE.Mesh
 */
export function createTerrainRing(
  panoramicAngles: number[],
  maxVisualAngle: number = 8
): THREE.Mesh {
  const angleCount = panoramicAngles.length;
  if (angleCount === 0) {
    // fallback: 빈 geometry
    return new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({ visible: false })
    );
  }

  // 지형 geometry: 하단 링(지평선) + 상단 링(지형 꼭대기)을 연결하는 삼각형 띠
  const vertexCount = TERRAIN_SEGMENTS * 2; // 상단 + 하단
  const positions = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 3);
  const indices: number[] = [];

  for (let i = 0; i < TERRAIN_SEGMENTS; i++) {
    const azFrac = i / TERRAIN_SEGMENTS; // 0 ~ 1
    const azRad = azFrac * Math.PI * 2;

    // panoramicAngles에서 보간하여 해당 방위각의 지형 고도각을 구함
    const angleIdx = azFrac * (angleCount - 1);
    const idx0 = Math.floor(angleIdx);
    const idx1 = Math.min(idx0 + 1, angleCount - 1);
    const frac = angleIdx - idx0;
    const terrainAngleDeg = panoramicAngles[idx0] * (1 - frac) + panoramicAngles[idx1] * frac;

    // 지형 고도각을 구체 표면의 Y 좌표로 변환
    const terrainElevRad = (Math.min(terrainAngleDeg, maxVisualAngle) * Math.PI) / 180;
    const baseElevRad = (-2 * Math.PI) / 180; // 지평선 약간 아래

    // 방위각 방향의 XZ 좌표
    const dirX = Math.sin(azRad);
    const dirZ = -Math.cos(azRad); // Three.js: -Z = North

    // 하단 vertex (지평선 아래)
    const bIdx = i * 2;
    positions[bIdx * 3] = dirX * TERRAIN_RING_RADIUS * Math.cos(baseElevRad);
    positions[bIdx * 3 + 1] = TERRAIN_RING_RADIUS * Math.sin(baseElevRad);
    positions[bIdx * 3 + 2] = dirZ * TERRAIN_RING_RADIUS * Math.cos(baseElevRad);

    // 상단 vertex (지형 꼭대기)
    const tIdx = i * 2 + 1;
    positions[tIdx * 3] = dirX * TERRAIN_RING_RADIUS * Math.cos(terrainElevRad);
    positions[tIdx * 3 + 1] = TERRAIN_RING_RADIUS * Math.sin(terrainElevRad);
    positions[tIdx * 3 + 2] = dirZ * TERRAIN_RING_RADIUS * Math.cos(terrainElevRad);

    // 기본 색상: 어두운 실루엣 (나중에 updateTerrainColors에서 업데이트)
    colors[bIdx * 3] = 0.05; colors[bIdx * 3 + 1] = 0.06; colors[bIdx * 3 + 2] = 0.08;
    colors[tIdx * 3] = 0.08; colors[tIdx * 3 + 1] = 0.09; colors[tIdx * 3 + 2] = 0.11;

    // 삼각형 인덱스 (현재 세그먼트 → 다음 세그먼트 연결)
    const nextI = (i + 1) % TERRAIN_SEGMENTS;
    const b0 = i * 2, t0 = i * 2 + 1;
    const b1 = nextI * 2, t1 = nextI * 2 + 1;
    indices.push(b0, t0, b1);  // 삼각형 1
    indices.push(b1, t0, t1);  // 삼각형 2
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const material = new THREE.MeshBasicMaterial({
    vertexColors: true,
    side: THREE.FrontSide,
    depthWrite: true,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'terrainRing';
  mesh.renderOrder = 0;
  
  return mesh;
}

/**
 * 지형 색상을 태양 고도와 날씨에 따라 업데이트합니다.
 * 기존 Visualizer의 terrainColors 로직과 동일한 팔레트를 사용.
 */
export function updateTerrainColors(
  mesh: THREE.Mesh,
  sunAltitude: number,
  overcast: number = 0,
  dustIntensity: number = 0
): void {
  const geometry = mesh.geometry as THREE.BufferGeometry;
  const colorAttr = geometry.attributes.color as THREE.BufferAttribute;
  if (!colorAttr) return;

  // 낮/밤 보간 (−6° ~ +8°)
  const t = clamp01((sunAltitude + 6) / 14);

  // 노을 강도
  const sunsetGlowFactor = Math.max(0, 1.0 - (overcast * 1.3 + dustIntensity * 0.9)) *
    (1.0 - Math.pow(Math.abs(t - 0.4) / 0.4, 2));
  const glow = clamp01(sunsetGlowFactor);

  // 팔레트: [night, day, golden]
  const nightBase = { r: 0.05, g: 0.06, b: 0.12 };
  const dayBase = { r: 0.18, g: 0.25, b: 0.19 };
  const goldenBase = { r: 0.24, g: 0.10, b: 0.07 };
  const nightTop = { r: 0.08, g: 0.09, b: 0.17 };
  const dayTop = { r: 0.26, g: 0.24, b: 0.20 };
  const goldenTop = { r: 0.35, g: 0.16, b: 0.10 };

  // 날씨 탈색
  const severity = Math.max(overcast, dustIntensity);
  const grayR = 0.15, grayG = 0.16, grayB = 0.17;

  const lerp = (a: number, b: number, f: number) => a + (b - a) * f;

  const count = colorAttr.count;
  for (let i = 0; i < count; i++) {
    const isTop = i % 2 === 1;
    const base = isTop
      ? { r: lerp(nightTop.r, dayTop.r, t), g: lerp(nightTop.g, dayTop.g, t), b: lerp(nightTop.b, dayTop.b, t) }
      : { r: lerp(nightBase.r, dayBase.r, t), g: lerp(nightBase.g, dayBase.g, t), b: lerp(nightBase.b, dayBase.b, t) };

    if (glow > 0.05) {
      const golden = isTop ? goldenTop : goldenBase;
      base.r = lerp(base.r, golden.r, glow * 0.6);
      base.g = lerp(base.g, golden.g, glow * 0.6);
      base.b = lerp(base.b, golden.b, glow * 0.6);
    }

    if (severity > 0.1) {
      base.r = lerp(base.r, grayR, severity * 0.7);
      base.g = lerp(base.g, grayG, severity * 0.7);
      base.b = lerp(base.b, grayB, severity * 0.7);
    }

    colorAttr.setXYZ(i, base.r, base.g, base.b);
  }

  colorAttr.needsUpdate = true;
}
