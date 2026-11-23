/**
 * J2000 은하좌표 (l, b) -> 적도좌표 단위벡터 변환 공용 유틸리티.
 * MilkyWayBand.ts(지상 3D 하늘)와 SpaceBackdropGL.ts(우주 배경)가 동일한 기저와 변환을 공유합니다.
 */
import * as THREE from 'three';

// 북은하극(J2000): RA 12h51m26.28s (192.85948°), Dec +27.12825°
// 은하 중심(l=0, b=0): RA 17h45m37.2s (266.405°), Dec -28.936°
const NGP_RA_DEG = 192.85948;
const NGP_DEC_DEG = 27.12825;
const GC_RA_DEG = 266.405;
const GC_DEC_DEG = -28.936;

export function fromRaDec(raDeg: number, decDeg: number): THREE.Vector3 {
  const ra = (raDeg * Math.PI) / 180;
  const dec = (decDeg * Math.PI) / 180;
  const cd = Math.cos(dec);
  return new THREE.Vector3(cd * Math.cos(ra), cd * Math.sin(ra), Math.sin(dec));
}

// xg = 은하 중심, zg = 북은하극, yg = zg × xg (문헌 반올림 오차 ~0.0001° 직교화)
const GAL_Z = fromRaDec(NGP_RA_DEG, NGP_DEC_DEG).normalize();
const GAL_X = (() => {
  const x = fromRaDec(GC_RA_DEG, GC_DEC_DEG);
  return x.addScaledVector(GAL_Z, -x.dot(GAL_Z)).normalize();
})();
const GAL_Y = new THREE.Vector3().crossVectors(GAL_Z, GAL_X).normalize();

/** 은하 좌표 (l, b) [deg] -> J2000 적도좌표 단위벡터. */
export function galacticToEquatorial(lDeg: number, bDeg: number, out: THREE.Vector3): THREE.Vector3 {
  const l = (lDeg * Math.PI) / 180;
  const b = (bDeg * Math.PI) / 180;
  const cb = Math.cos(b);
  return out
    .set(0, 0, 0)
    .addScaledVector(GAL_X, cb * Math.cos(l))
    .addScaledVector(GAL_Y, cb * Math.sin(l))
    .addScaledVector(GAL_Z, Math.sin(b))
    .normalize();
}

/** 은하 경도 l [deg] 을 은하 중심 기준 각거리 0..180° 로 접습니다. */
export function foldLongitude(lDeg: number): number {
  const x = ((lDeg % 360) + 360) % 360;
  return x > 180 ? 360 - x : x;
}
