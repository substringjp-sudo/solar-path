/**
 * TerrainRing.ts
 *
 * Why: 기존 panoramicAngles (360° 지형 프로필)를 3D 원통형 geometry로 변환하고,
 * 지평선 하단을 메우는 3D 땅(Ground Plane) 및 지평선 방위(Compass) 표시 라인 그룹을 생성합니다.
 */
import * as THREE from 'three';
import { clamp01 } from '../../utils/sunsetPhysics';

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
    side: THREE.FrontSide,
    depthWrite: true,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'terrainRing';
  mesh.renderOrder = 0;
  
  return mesh;
}

/**
 * 지평선 발 아래 전체를 덮는 3D 대지(Ground Plane) 원반 Mesh를 생성합니다.
 */
export function createGroundPlane(): THREE.Mesh {
  const geometry = new THREE.CircleGeometry(TERRAIN_RING_RADIUS, 64);
  
  // 색상을 내경/외경 그라데이션으로 조절 가능하게 vertex colors 설정
  const posCount = geometry.attributes.position.count;
  const colors = new Float32Array(posCount * 3);
  for (let i = 0; i < posCount; i++) {
    colors[i * 3] = 0.04;
    colors[i * 3 + 1] = 0.06;
    colors[i * 3 + 2] = 0.08;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const material = new THREE.MeshBasicMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
    depthWrite: true,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'groundPlane';
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = -1.2; // 지평선 약간 아래
  mesh.renderOrder = -1;

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

/**
 * 지형 및 지면 색상을 태양 고도와 날씨에 따라 업데이트합니다.
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

  const t = clamp01((sunAltitude + 6) / 14);

  const sunsetGlowFactor = Math.max(0, 1.0 - (overcast * 1.3 + dustIntensity * 0.9)) *
    (1.0 - Math.pow(Math.abs(t - 0.4) / 0.4, 2));
  const glow = clamp01(sunsetGlowFactor);

  const nightBase = { r: 0.05, g: 0.06, b: 0.12 };
  const dayBase = { r: 0.18, g: 0.25, b: 0.19 };
  const goldenBase = { r: 0.24, g: 0.10, b: 0.07 };
  const nightTop = { r: 0.08, g: 0.09, b: 0.17 };
  const dayTop = { r: 0.26, g: 0.24, b: 0.20 };
  const goldenTop = { r: 0.35, g: 0.16, b: 0.10 };

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

/**
 * 지면 원반(Ground Plane)의 색상을 태양 고도와 날씨에 따라 업데이트합니다.
 */
export function updateGroundColors(
  mesh: THREE.Mesh,
  sunAltitude: number,
  overcast: number = 0
): void {
  const geometry = mesh.geometry as THREE.BufferGeometry;
  const colorAttr = geometry.attributes.color as THREE.BufferAttribute;
  if (!colorAttr) return;

  const t = clamp01((sunAltitude + 6) / 14);
  const lerp = (a: number, b: number, f: number) => a + (b - a) * f;

  // 지면 색상 톤: 밤 (어두운 실루엣) -> 낮 (은은한 녹음/토양 톤)
  const nightG = { r: 0.03, g: 0.04, b: 0.07 };
  const dayG = { r: 0.12, g: 0.16, b: 0.14 };
  const goldenG = { r: 0.18, g: 0.09, b: 0.06 };

  const sunsetGlow = clamp01(1.0 - Math.pow(Math.abs(t - 0.4) / 0.4, 2)) * (1.0 - overcast);

  const r = lerp(lerp(nightG.r, dayG.r, t), goldenG.r, sunsetGlow * 0.5);
  const g = lerp(lerp(nightG.g, dayG.g, t), goldenG.g, sunsetGlow * 0.5);
  const b = lerp(lerp(nightG.b, dayG.b, t), goldenG.b, sunsetGlow * 0.5);

  const count = colorAttr.count;
  const posAttr = geometry.attributes.position as THREE.BufferAttribute;
  
  for (let i = 0; i < count; i++) {
    // 중심부에서 외곽으로 갈수록 지평선 지형 색상과 은은히 블렌딩
    const px = posAttr.getX(i);
    const py = posAttr.getY(i);
    const distRatio = Math.sqrt(px * px + py * py) / TERRAIN_RING_RADIUS;

    const factor = 1.0 - distRatio * 0.3;
    colorAttr.setXYZ(i, r * factor, g * factor, b * factor);
  }

  colorAttr.needsUpdate = true;
}
