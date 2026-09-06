/**
 * MoonMesh.ts
 * 
 * 인간의 눈으로 보는 실감 나는 체감 착시 스케일(Moon Illusion Scale, 반지름 약 8.0 유닛)을 반영하고,
 * 달의 바다(Mare) 및 분화구(Crater) 3D 프로시저럴 표면 질감 셰이더와 눈부신 은백색 달빛,
 * 은은한 지구반사광(Earthshine)을 탑재하여 낭만적인 3D 달의 실제 위상을 100% 명확히 시각화합니다.
 */
import * as THREE from 'three';
import SunCalc from 'suncalc';
import { getMoonPosition } from '../../utils/celestial';

/** 사람 눈 체감 감성 착시 스케일 반영 (반지름 약 8.0 유닛) */
const MOON_ANGULAR_RADIUS_DEG = 1.02;
const MOON_DISTANCE = 490;

const VERT = `
varying vec2 vUv;
varying vec3 vNormal;
void main() {
  vUv = uv;
  vec2 st = (uv - 0.5) * 2.0;
  float z = sqrt(max(0.0, 1.0 - st.x * st.x - st.y * st.y));
  vNormal = vec3(st.x, st.y, z);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = `
precision highp float;

uniform float uPhase;       // 0~1 (0=신월, 0.25=상현, 0.5=보름, 0.75=하현)
uniform float uAngle;       // 달 위상 기울기 라디안
uniform vec3  uColorBright; // 햇빛 받는 은백색 달빛
uniform vec3  uColorDark;   // 그림자 면 지구반사광 (Earthshine)
varying vec2  vUv;
varying vec3  vNormal;

// 달 표면 프로시저럴 크레이터/바다(Maria) 노이즈 난수
float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float lunarTexture(vec2 uv) {
  vec2 p = (uv - 0.5) * 8.5;
  float n1 = noise(p * 1.5);
  float n2 = noise(p * 4.0 + 2.3);
  float n3 = noise(p * 9.0 + 5.7);

  // 달의 바다 (Mare - 어두운 부분) 및 고지대 분화구 (Highlands)
  float mare = smoothstep(0.35, 0.65, n1 * 0.6 + n2 * 0.4);
  float craters = pow(n3, 2.2) * 0.35;
  
  return mix(0.75, 1.05, mare) - craters;
}

void main() {
  vec2 st = (vUv - 0.5) * 2.0;
  float d = length(st);
  if (d > 1.0) discard;

  // 위상 경사 각도 회전
  float cosA = cos(uAngle);
  float sinA = sin(uAngle);
  vec2 p = vec2(cosA * st.x - sinA * st.y, sinA * st.x + cosA * st.y);

  // 3D 구면 법선 Z
  float z = sqrt(max(0.0, 1.0 - p.x * p.x - p.y * p.y));
  vec3 normal = vec3(p.x, p.y, z);

  // 입사광 방향 (uPhase: 0.0=신월, 0.25=상현, 0.5=보름, 0.75=하현)
  float phaseRad = (uPhase - 0.5) * 6.28318530718;
  vec3 lightDir = vec3(-sin(phaseRad), 0.0, cos(phaseRad));

  // 3D 터미네이터 음영 (NdotL)
  float NdotL = dot(normal, lightDir);
  float illum = smoothstep(-0.08, 0.12, NdotL);

  // 달 표면 크레이터 질감 합성
  float tex = lunarTexture(vUv);

  // 원반 가장자리 부드러운 안티앨리어싱
  float alpha = smoothstep(1.0, 0.94, d);

  // 햇빛 받는 고휘도 은백색 달빛 vs 은은한 딥블루 지구반사광 (Earthshine)
  vec3 brightCol = uColorBright * tex * 1.4;
  vec3 darkCol = uColorDark * (0.8 + tex * 0.2);

  vec3 finalCol = mix(darkCol, brightCol, illum);

  gl_FragColor = vec4(finalCol, alpha);
}
`;

export interface MoonHandle {
  group: THREE.Group;
  material: THREE.ShaderMaterial;
  dispose: () => void;
}

/**
 * 3D 스카이씬 달 메쉬 및 위상 셰이더 생성
 */
export function createMoonGroup(): MoonHandle {
  const group = new THREE.Group();
  group.name = 'moonGroup';

  // 시각 체감 반지름 계산 (약 8.0 유닛)
  const radius = MOON_DISTANCE * Math.tan((MOON_ANGULAR_RADIUS_DEG * Math.PI) / 180);
  const moonGeo = new THREE.PlaneGeometry(radius * 2, radius * 2);

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uPhase: { value: 0.5 },
      uAngle: { value: 0.0 },
      uColorBright: { value: new THREE.Color(0xf5f8ff) },
      uColorDark: { value: new THREE.Color(0x18243b) }, // 어두운 덩어리가 아닌 은은한 지구반사광
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
  });

  const moonMesh = new THREE.Mesh(moonGeo, material);
  moonMesh.name = 'moonDisk';
  // 지면(-0.5) 및 지형(-0.4)보다 뒤에 그려져 일몰/월몰 시 땅 뒤로 가려지도록 설정
  moonMesh.renderOrder = -0.53;
  group.add(moonMesh);

  return {
    group,
    material,
    dispose: () => {
      moonGeo.dispose();
      material.dispose();
    },
  };
}

/**
 * 실시간 달 위치 및 위상(Illumination phase/angle) 갱신
 */
export function updateMoonPosition(
  moonHandle: MoonHandle,
  date: Date,
  lat: number,
  lng: number
): void {
  const { group, material } = moonHandle;
  const moonPos = getMoonPosition(date, lat, lng);
  const moonIllum = SunCalc.getMoonIllumination(date);

  const altRad = (moonPos.altitude * Math.PI) / 180;
  const azRad = (moonPos.azimuth * Math.PI) / 180;

  // 3D 구면 좌표계 변환 (Y=up, -Z=North, X=East)
  const x = MOON_DISTANCE * Math.cos(altRad) * Math.sin(azRad);
  const y = MOON_DISTANCE * Math.sin(altRad);
  const z = -MOON_DISTANCE * Math.cos(altRad) * Math.cos(azRad);

  group.position.set(x, y, z);
  group.lookAt(0, 0, 0);

  // 달 고도가 -5도 이하이면 비가시화
  group.visible = moonPos.altitude > -5;

  // 위상(phase 0~1) 및 위상 기울기 각도(angle) 전송
  material.uniforms.uPhase.value = moonIllum.phase;
  material.uniforms.uAngle.value = moonIllum.angle;
}
