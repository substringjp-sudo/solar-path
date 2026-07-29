/**
 * CloudMesh.ts
 *
 * Why: 기존 10종 구름 SVG 템플릿을 3D 공간에 flat polygon으로 배치.
 * Billboard 방식(항상 카메라를 향함)으로 간단하게 표현하되,
 * 기존 approximateCloudColors()의 물리 기반 색상을 그대로 사용.
 *
 * 쉐이딩 없이 MeshBasicMaterial + flat color.
 */
import * as THREE from 'three';
import { svgPathToShapes } from './svgPathToShape';
import { clamp01 } from '../../utils/sunsetPhysics';

/** 구름 인스턴스 데이터 (Visualizer의 allCloudLayersData 항목과 대응) */
export interface Cloud3DData {
  /** 방위각 (도, N=0) */
  azimuthDeg: number;
  /** 고도각 (도) */
  elevationDeg: number;
  /** 관측자로부터의 거리 (km) */
  distanceKm: number;
  /** 구름 유형 */
  layerType: 'high' | 'mid' | 'low';
  /** 밀도 (0-100) */
  density: number;
  /** SVG path 문자열 (구름 모양) */
  svgPath: string;
  /** 구름의 lit(밝은면) 색상 — approximateCloudColors() 결과 */
  litColor: { r: number; g: number; b: number };
  /** 구름의 shadow(어두운면) 색상 */
  shadowColor: { r: number; g: number; b: number };
  /** 구름 preset 두께 */
  thickness: number;
  /** 투명도 (0-1) */
  opacity: number;
}

const CLOUD_DISTANCE = 400; // 스카이돔(500) 안쪽, 지형(480) 안쪽

// SVG path → Shape 캐시 (같은 path를 매번 파싱하지 않기 위해)
const shapeCache = new Map<string, THREE.Shape[]>();

function getCachedShapes(svgPath: string, scale: number): THREE.Shape[] {
  const key = `${svgPath}_${scale}`;
  if (shapeCache.has(key)) return shapeCache.get(key)!;
  const shapes = svgPathToShapes(svgPath, scale);
  shapeCache.set(key, shapes);
  return shapes;
}

/**
 * 단일 구름 메시를 생성합니다.
 * flat polygon, 쉐이딩 없음, billboard 방식.
 */
export function createCloudMesh(data: Cloud3DData): THREE.Mesh {
  // SVG 구름 shape → geometry
  // 스케일: 구름 크기를 거리와 유형에 따라 조절
  const baseScale = data.layerType === 'high' ? 0.08 : data.layerType === 'mid' ? 0.06 : 0.05;
  const distanceScale = Math.max(0.5, Math.min(2.0, data.distanceKm / 100));
  const scale = baseScale * distanceScale;
  
  const shapes = getCachedShapes(data.svgPath, scale);
  
  let geometry: THREE.BufferGeometry;
  if (shapes.length > 0) {
    geometry = new THREE.ShapeGeometry(shapes);
  } else {
    // fallback: 단순 사각형
    const fallbackShape = new THREE.Shape();
    fallbackShape.moveTo(-1, -0.3);
    fallbackShape.lineTo(1, -0.3);
    fallbackShape.lineTo(1, 0.3);
    fallbackShape.lineTo(-1, 0.3);
    fallbackShape.closePath();
    geometry = new THREE.ShapeGeometry(fallbackShape);
  }

  // 색상: lit/shadow 중간값 사용 (flat이므로 단색)
  const mixFactor = 0.6; // lit 쪽으로 약간 치우침
  const r = data.litColor.r * mixFactor + data.shadowColor.r * (1 - mixFactor);
  const g = data.litColor.g * mixFactor + data.shadowColor.g * (1 - mixFactor);
  const b = data.litColor.b * mixFactor + data.shadowColor.b * (1 - mixFactor);

  const material = new THREE.MeshBasicMaterial({
    color: new THREE.Color(r / 255, g / 255, b / 255),
    transparent: true,
    opacity: clamp01(data.opacity * (data.density / 100)),
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  const mesh = new THREE.Mesh(geometry, material);

  // 3D 위치 결정: 방위각 + 고도각 → 구면 좌표
  const altRad = (data.elevationDeg * Math.PI) / 180;
  const azRad = (data.azimuthDeg * Math.PI) / 180;
  
  const dist = CLOUD_DISTANCE * (0.7 + (data.distanceKm / 400) * 0.3);
  mesh.position.set(
    dist * Math.cos(altRad) * Math.sin(azRad),
    dist * Math.sin(altRad),
    -dist * Math.cos(altRad) * Math.cos(azRad)
  );

  mesh.name = `cloud_${data.layerType}_${data.distanceKm}`;

  return mesh;
}

/**
 * 여러 구름 데이터로 구름 그룹을 한번에 생성합니다.
 * 
 * @param clouds Cloud3DData 배열
 * @returns THREE.Group (모든 구름 메시 포함)
 */
export function createCloudGroup(clouds: Cloud3DData[]): THREE.Group {
  const group = new THREE.Group();
  group.name = 'cloudGroup';

  for (const cloud of clouds) {
    if (cloud.density < 5) continue; // 밀도 5% 미만은 건너뜀
    const mesh = createCloudMesh(cloud);
    group.add(mesh);
  }

  return group;
}

/**
 * 구름 그룹의 모든 메시가 카메라를 향하도록 업데이트합니다.
 * (Billboard 효과)
 * 
 * @param cloudGroup createCloudGroup()으로 생성된 그룹
 * @param camera 현재 카메라
 */
export function updateCloudBillboards(cloudGroup: THREE.Group, camera: THREE.Camera): void {
  cloudGroup.children.forEach(child => {
    if (child instanceof THREE.Mesh) {
      child.lookAt(camera.position);
    }
  });
}
