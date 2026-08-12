/**
 * CelestialPathMesh.ts
 *
 * 태양·달의 하루 궤적을 AR 가이드처럼 보이는 리본으로 렌더합니다.
 *
 * Why THREE.Line을 버렸나: 이전 구현은 LineBasicMaterial의 `linewidth: 2`를 썼는데,
 * 이 값은 WebGL/ANGLE에서 **완전히 무시됩니다.** 어떤 값을 넣어도 항상 1px
 * 헤어라인이 나옵니다. 궤적선이 초라해 보이던 직접적인 원인이 이것이었습니다.
 *
 * 대신 카메라를 향해 펼쳐지는 리본을 정점 셰이더에서 만듭니다. 화면상 두께가
 * 일정하게 유지되고, 다음 정보를 색으로 실어 나릅니다.
 *   - 지나간 구간은 흐리게, 앞으로 올 구간은 진하게
 *   - 현재 시각 위치에 밝은 마커
 *   - 정시마다 눈금
 *   - 지평선 아래 구간은 점선으로 (실제로는 보이지 않는 경로임을 알림)
 */
import * as THREE from 'three';
import { getSunPath, getMoonPath } from '../../utils/celestial';

const PATH_RADIUS = 445;
/** 리본 반폭 (월드 단위). 반경 445에서 ±3.2면 약 0.8° — AR 가이드로 읽히는 두께입니다. */
const RIBBON_HALF_WIDTH = 3.2;

const VERT = `
precision highp float;

attribute float aSide;      // -1 / +1 (리본 좌우)
attribute float aHours;     // 자정 기준 경과 시간 0~24
attribute float aAltDeg;    // 그 지점의 고도각

uniform float uWidth;
uniform float uNowHours;

varying float vHours;
varying float vAltDeg;
varying float vAcross;

void main() {
  // 이웃 정점 방향을 쓰지 않고, 카메라 기준 접선의 수직으로 펼칩니다.
  // (경로가 구면 위에 있으므로 반경 방향과 접선의 외적이 곧 리본 폭 방향)
  vec3 p = position;
  vec3 radial = normalize(p);

  // 접선은 CPU에서 넣어준 다음 정점과의 차이 대신, 구면 상 근사로 구합니다.
  // normal 속성에 접선을 담아 전달했습니다.
  vec3 tangent = normalize(normal);
  vec3 side = normalize(cross(radial, tangent));

  vec3 worldPos = p + side * (aSide * uWidth);

  vHours = aHours;
  vAltDeg = aAltDeg;
  vAcross = aSide;

  gl_Position = projectionMatrix * viewMatrix * vec4(worldPos, 1.0);
}
`;

const FRAG = `
precision highp float;

uniform vec3  uColor;
uniform float uNowHours;
uniform float uOpacity;

varying float vHours;
varying float vAltDeg;
varying float vAcross;

void main() {
  // 리본 단면 — 가운데가 진하고 가장자리로 부드럽게 사라짐
  float core = 1.0 - smoothstep(0.35, 1.0, abs(vAcross));

  // 지나간 시간은 흐리게, 다가올 시간은 진하게
  float dt = vHours - uNowHours;
  float past = smoothstep(-3.5, 0.0, dt);      // 과거일수록 0
  float timeFade = mix(0.28, 1.0, past);

  // 현재 시각 부근에 밝은 마커
  float nowGlow = exp(-pow(dt * 3.2, 2.0));

  // 정시 눈금
  float tick = smoothstep(0.93, 1.0, abs(fract(vHours) * 2.0 - 1.0));

  // 이동 방향 화살표 (> > >) 마커 — 태양이 진행하는 방향(미래)으로 뾰족하게 가리킴
  float arrowFrac = fract(vHours * 1.5);
  float vShape = (1.0 - abs(vAcross)) * 0.16; // 리본 중앙이 미래 방향으로 뾰족한 V자
  float arrowLine = smoothstep(0.04, 0.0, abs(arrowFrac - vShape - 0.4)) * smoothstep(0.05, 0.2, 1.0 - abs(vAcross));

  // 지평선 아래 구간은 점선 처리 (보이지 않는 경로)
  float below = step(vAltDeg, 0.0);
  float dash = step(0.5, fract(vHours * 6.0));
  float belowMask = mix(1.0, dash * 0.45, below);

  float a = core * timeFade * belowMask * uOpacity;
  a += nowGlow * core * 0.9;
  a += tick * core * 0.35;
  a += arrowLine * 0.75;

  if (a <= 0.004) discard;

  vec3 col = uColor + vec3(1.0) * (nowGlow * 0.55 + tick * 0.25 + arrowLine * 0.6);
  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
}
`;

export interface PathRibbon {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
}

export interface CelestialPathsGroup {
  sun: PathRibbon;
  moon: PathRibbon;
  /** 관측자 발밑에서 태양 반대쪽으로 늘어나는 바닥 그림자 */
  groundShadowMesh: THREE.Mesh;
  containerGroup: THREE.Group;
  dispose: () => void;
}

function createRibbon(color: THREE.Color, maxPoints: number): PathRibbon {
  // 정점은 (경로점 × 2). 실제 값은 update에서 채웁니다.
  const count = maxPoints * 2;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geometry.setAttribute('aSide', new THREE.BufferAttribute(new Float32Array(count), 1));
  geometry.setAttribute('aHours', new THREE.BufferAttribute(new Float32Array(count), 1));
  geometry.setAttribute('aAltDeg', new THREE.BufferAttribute(new Float32Array(count), 1));

  const indices: number[] = [];
  for (let i = 0; i < maxPoints - 1; i++) {
    const a = i * 2;
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  geometry.setIndex(indices);

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: color },
      uWidth: { value: RIBBON_HALF_WIDTH },
      uNowHours: { value: 12 },
      uOpacity: { value: 0.85 },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2; // 구름(1) 위에 가이드로 얹힘

  return { mesh, material };
}

const MAX_POINTS = 128;

export function createCelestialPathsGroup(): CelestialPathsGroup {
  const containerGroup = new THREE.Group();
  containerGroup.name = 'celestialPathsGroup';

  const sun = createRibbon(new THREE.Color(1.0, 0.72, 0.25), MAX_POINTS);
  sun.mesh.name = 'sunPathRibbon';
  const moon = createRibbon(new THREE.Color(0.62, 0.78, 1.0), MAX_POINTS);
  moon.mesh.name = 'moonPathRibbon';
  moon.material.uniforms.uOpacity.value = 0.6;

  containerGroup.add(sun.mesh);
  containerGroup.add(moon.mesh);

  // 더미 바닥 그림자 메시 (사용자 요청으로 사각형 폴리곤 비활성화)
  const shadowGeo = new THREE.BufferGeometry();
  const shadowMat = new THREE.MeshBasicMaterial({ visible: false });
  const groundShadowMesh = new THREE.Mesh(shadowGeo, shadowMat);
  groundShadowMesh.name = 'groundShadowMesh';
  groundShadowMesh.visible = false;

  return {
    sun,
    moon,
    groundShadowMesh,
    containerGroup,
    dispose: () => {
      [sun, moon].forEach(r => {
        r.mesh.geometry.dispose();
        r.material.dispose();
      });
      groundShadowMesh.geometry.dispose();
      (groundShadowMesh.material as THREE.Material).dispose();
    },
  };
}

const _v = new THREE.Vector3();
const _next = new THREE.Vector3();

function toVec(altDeg: number, azDeg: number, out: THREE.Vector3): THREE.Vector3 {
  const a = (altDeg * Math.PI) / 180;
  const z = (azDeg * Math.PI) / 180;
  return out.set(
    PATH_RADIUS * Math.cos(a) * Math.sin(z),
    PATH_RADIUS * Math.sin(a),
    -PATH_RADIUS * Math.cos(a) * Math.cos(z)
  );
}

function fillRibbon(
  ribbon: PathRibbon,
  pts: { altitude: number; azimuth: number; time: Date }[],
  nowHours: number
): void {
  const geo = ribbon.mesh.geometry;
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const nrm = geo.getAttribute('normal') as THREE.BufferAttribute;
  const side = geo.getAttribute('aSide') as THREE.BufferAttribute;
  const hrs = geo.getAttribute('aHours') as THREE.BufferAttribute;
  const alt = geo.getAttribute('aAltDeg') as THREE.BufferAttribute;

  const n = Math.min(pts.length, MAX_POINTS);
  if (n === 0) {
    geo.setDrawRange(0, 0);
    return;
  }
  const t0 = pts[0].time.getTime();

  for (let i = 0; i < n; i++) {
    const p = pts[i];
    toVec(p.altitude, p.azimuth, _v);
    // 접선: 다음 점 방향 (마지막은 이전 점 기준)
    const j = i < n - 1 ? i + 1 : i - 1;
    const q = pts[Math.max(0, j)];
    toVec(q.altitude, q.azimuth, _next);
    if (i === n - 1) _next.sub(_v).multiplyScalar(-1).add(_v);
    const tangent = _next.clone().sub(_v).normalize();
    if (!isFinite(tangent.x) || tangent.lengthSq() < 1e-8) tangent.set(0, 1, 0);

    // 경로 시작(그 지역의 자정)부터 흐른 시간. UTC 시각을 쓰면 UTC+9 같은
    // 지역에서 궤적 한가운데에 23→0 불연속이 생겨 과거/미래 페이드가 뒤집힙니다.
    const hour = (p.time.getTime() - t0) / 3600000;

    for (const s of [0, 1]) {
      const idx = i * 2 + s;
      pos.setXYZ(idx, _v.x, _v.y, _v.z);
      nrm.setXYZ(idx, tangent.x, tangent.y, tangent.z);
      side.setX(idx, s === 0 ? -1 : 1);
      hrs.setX(idx, hour);
      alt.setX(idx, p.altitude);
    }
  }

  // 남는 정점은 마지막 점에 겹쳐 숨김
  for (let i = n; i < MAX_POINTS; i++) {
    for (const s of [0, 1]) {
      const idx = i * 2 + s;
      const prev = (n - 1) * 2 + s;
      pos.setXYZ(idx, pos.getX(prev), pos.getY(prev), pos.getZ(prev));
      nrm.setXYZ(idx, 0, 1, 0);
      side.setX(idx, 0);
      hrs.setX(idx, 0);
      alt.setX(idx, -90);
    }
  }

  geo.setDrawRange(0, (n - 1) * 6);
  pos.needsUpdate = true;
  nrm.needsUpdate = true;
  side.needsUpdate = true;
  hrs.needsUpdate = true;
  alt.needsUpdate = true;

  ribbon.material.uniforms.uNowHours.value = nowHours;
}

/**
 * 태양·달 궤적 리본 + 바닥 그림자 갱신.
 */
export function updateCelestialPaths(
  paths: CelestialPathsGroup,
  date: Date,
  lat: number,
  lng: number,
  sunAltitude: number,
  sunAzimuth: number
): void {
  // getSunPath/getMoonPath는 그 지역 자정부터 24시간을 훑으므로,
  // "지금"도 같은 기준(자정 이후 경과 시간)으로 맞춰야 합니다.
  const nowHours =
    date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600;
  fillRibbon(paths.sun, getSunPath(date, lat, lng), nowHours);
  fillRibbon(paths.moon, getMoonPath(date, lat, lng), nowHours);

  // 바닥 그림자 비활성화
  const shadow = paths.groundShadowMesh;
  shadow.visible = false;
}
