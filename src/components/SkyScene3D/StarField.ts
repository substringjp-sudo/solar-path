/**
 * StarField.ts
 *
 * 6.5등급까지 8,355개 항성 + 5대 행성을 단일 Points로 렌더합니다.
 *
 * Why 회전 행렬 방식인가: 별마다 매 프레임 적도→지평 좌표 변환을 CPU에서 돌리면
 * 8,355 × (sin·cos·asin·acos)가 되어 시간 슬라이더가 즉시 멎습니다.
 * 적도좌표 단위벡터를 attribute에 한 번 구워두고, 지방항성시와 위도로 만든
 * 회전 행렬 **하나만** uniform으로 넘기면 GPU가 전부 돌려줍니다.
 * CPU가 프레임당 하는 일은 행렬 1개 계산이 전부입니다.
 *
 * 밝기는 실제 등급 체계를 따릅니다. 등급이 1 낮아질 때마다 광속이 약 2.512배이므로,
 * 점 크기와 알파를 그 비율로 키웁니다. 지평선 근처 별이 흐려지는 대기 소광도
 * 같은 대기 모델에서 가져옵니다.
 */
import * as THREE from 'three';
import { getStarCatalog, bvToLinearRGB, STAR_MAG_LIMIT } from '../../utils/starCatalog';
import { getLMSTDeg } from '../../utils/celestialCoords';
import { PLANETS_METADATA, getPlanetEquatorialCoord, type PlanetKey } from '../../utils/celestialPlanets';

const STAR_RADIUS = 470; // 스카이돔(500) 안쪽, 구름(430)보다 바깥

/**
 * 셰이더 상수는 TS에서 한 번만 정의하고 템플릿으로 주입합니다.
 * GLSL에 숫자를 따로 적으면 카탈로그 하한이 바뀔 때 한쪽만 고쳐집니다.
 */
const VERT = `
precision highp float;

attribute float aMag;    // 겉보기 등급
attribute vec3  aColor;  // B-V에서 유도한 선형 RGB
attribute float aKind;   // 0 = 항성, 1 = 행성

uniform mat3  uEquToHorizon; // 적도좌표 → 지평좌표 회전
uniform float uMagLimit;     // 표시 상한 등급 (사용자 조절)
uniform float uBrightness;   // 밝기 배율 (사용자 조절)
uniform float uPixelRatio;
uniform float uSunAltDeg;    // 낮에는 별이 보이지 않음
uniform float uShowStars;    // 항성 레이어 ON/OFF (0/1)
uniform float uShowPlanets;  // 행성 레이어 ON/OFF (0/1)

varying vec3  vColor;
varying float vAlpha;

void main() {
  // 적도좌표 단위벡터를 지평좌표로 회전 (Y=up, -Z=North, X=East)
  vec3 h = uEquToHorizon * normalize(position);
  vec3 worldPos = h * ${STAR_RADIUS}.0;

  // ── 밝기: 등급 → 화면 밝기 ──────────────────────────────────────────────
  // 광속비(등급 1당 2.512배)를 그대로 쓰면 시리우스와 4등성의 비가 160:1이라
  // 4등성이 화면에서 완전히 사라집니다. 실제로 밤하늘을 보면 4등성도 분명히
  // 보이는데, 이는 눈의 반응이 로그에 가깝기 때문입니다. 등급 자체가 이미
  // 로그 척도이므로 등급을 선형으로 매핑하는 편이 눈에 보이는 것과 맞습니다.
  //   t = 0 → 카탈로그 하한(6.5등급),  t = 1 → 시리우스(-1.46등급)
  //
  // 정규화 기준은 uMagLimit이 아니라 **카탈로그 고정값**입니다. 한계 등급으로
  // 나누면 도시 하늘(4등급)에서 베가까지 같이 어두워지는데, 광공해는 흐린 별을
  // 가릴 뿐 밝은 별을 어둡게 만들지 않습니다.
  float t = clamp((${STAR_MAG_LIMIT.toFixed(2)} - aMag) / ${(STAR_MAG_LIMIT + 1.46).toFixed(2)}, 0.0, 1.0);
  float norm = pow(t, 1.15);
  // 한계 등급 부근에서 딱 잘리지 않고 부드럽게 사라지게 합니다.
  norm *= smoothstep(uMagLimit + 0.35, uMagLimit - 0.35, aMag);

  // ── 지평선 근처 대기 소광 ────────────────────────────────────────────────
  float altDeg = degrees(asin(clamp(h.y, -1.0, 1.0)));
  float airmass = 1.0 / max(0.09, sin(radians(max(altDeg, 3.0))));
  float extinction = exp(-0.16 * (airmass - 1.0));

  // ── 낮에는 사라짐 ────────────────────────────────────────────────────────
  // 시민박명(-6°)부터 보이기 시작해 항해박명(-12°) 아래에서 완전히 드러납니다.
  float night = smoothstep(-2.0, -11.0, uSunAltDeg);

  // ── 지평선 아래는 그리지 않음 ────────────────────────────────────────────
  float above = smoothstep(-1.5, 1.5, altDeg);

  float vis = norm * extinction * night * above * uBrightness;
  // 항성/행성 레이어 토글 — 같은 Points 안에서 종류별로 끕니다.
  vis *= mix(uShowStars, uShowPlanets, aKind);

  vAlpha = clamp(vis, 0.0, 1.0);
  vColor = aColor;

  // 밝은 별일수록 크게. 등급 차이는 알파보다 크기로 읽히는 편이 자연스럽습니다.
  // 행성은 한 단계 더 크게 그려 항성과 구분되게 합니다.
  float size = (1.3 + 3.4 * pow(clamp(vis, 0.0, 1.0), 0.55)) * (1.0 + aKind * 0.55);
  gl_PointSize = size * uPixelRatio;

  gl_Position = projectionMatrix * viewMatrix * vec4(worldPos, 1.0);
}
`;

const FRAG = `
precision highp float;

varying vec3  vColor;
varying float vAlpha;

void main() {
  if (vAlpha <= 0.002) discard;

  // 점을 원형으로 다듬고 가장자리를 부드럽게 (사각형 점은 바로 티가 납니다)
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d) * 2.0;
  // 중심은 포화시키고 바깥만 떨어뜨립니다 — 별은 작고 단단한 광점입니다.
  float core = 1.0 - smoothstep(0.35, 1.0, r);
  // 밝은 별에 약한 헤일로를 더해 반짝이는 느낌을 냅니다
  float halo = pow(1.0 - clamp(r, 0.0, 1.0), 3.0);

  float a = vAlpha * (core * 1.0 + halo * 0.30);
  if (a <= 0.002) discard;

  gl_FragColor = vec4(vColor, a);
}
`;

export interface StarFieldHandle {
  points: THREE.Points;
  material: THREE.ShaderMaterial;
  /** 항성 개수 (행성은 뒤에 이어붙음) */
  starCount: number;
  /** 마지막으로 GPU에 올린 행성 배열. 같은 배열이면 재전송을 건너뜁니다. */
  lastPlanets?: PlanetPoint[];
  dispose: () => void;
}

/** 행성 렌더링에 필요한 최소 정보 */
export interface PlanetPoint {
  raHours: number;
  decDeg: number;
  magnitude: number;
  color: [number, number, number];
}

/**
 * 항성 + 행성 Points 생성.
 * 행성은 위치가 매일 바뀌므로 뒤쪽 슬롯에 넣고 updateStarField에서 갱신합니다.
 */
export function createStarField(maxPlanets: number = 8): StarFieldHandle {
  const cat = getStarCatalog();
  const total = cat.count + maxPlanets;

  const positions = new Float32Array(total * 3);
  const mags = new Float32Array(total);
  const colors = new Float32Array(total * 3);
  const kinds = new Float32Array(total);

  // 적도좌표 → 단위벡터는 한 번만 계산해 구워둡니다.
  for (let i = 0; i < cat.count; i++) {
    const raRad = (cat.raHours[i] / 24) * Math.PI * 2;
    const decRad = (cat.decDeg[i] * Math.PI) / 180;
    const cd = Math.cos(decRad);
    positions[i * 3] = cd * Math.cos(raRad);
    positions[i * 3 + 1] = cd * Math.sin(raRad);
    positions[i * 3 + 2] = Math.sin(decRad);

    mags[i] = cat.magnitude[i];
    const [r, g, b] = bvToLinearRGB(cat.colorIndex[i]);
    colors[i * 3] = r;
    colors[i * 3 + 1] = g;
    colors[i * 3 + 2] = b;
    kinds[i] = 0;
  }
  // 행성 슬롯은 일단 보이지 않게 (등급을 크게)
  for (let i = cat.count; i < total; i++) {
    mags[i] = 99;
    kinds[i] = 1;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aMag', new THREE.BufferAttribute(mags, 1));
  geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('aKind', new THREE.BufferAttribute(kinds, 1));

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uEquToHorizon: { value: new THREE.Matrix3() },
      uMagLimit: { value: STAR_MAG_LIMIT },
      uBrightness: { value: 1.0 },
      uPixelRatio: { value: 1.0 },
      uSunAltDeg: { value: -20 },
      uShowStars: { value: 1.0 },
      uShowPlanets: { value: 1.0 },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
  });

  const points = new THREE.Points(geometry, material);
  points.name = 'starField';
  points.frustumCulled = false;
  points.renderOrder = -0.5; // 하늘(-1) 위, 구름(1) 아래

  return {
    points,
    material,
    starCount: cat.count,
    dispose: () => {
      geometry.dispose();
      material.dispose();
    },
  };
}

/**
 * 적도좌표를 지평좌표로 옮기는 회전 행렬.
 *
 * 적도 단위벡터 (cos δ cos α, cos δ sin α, sin δ) 를
 * Three.js 지평 좌표계 (X=동, Y=천정, -Z=북) 로 보냅니다.
 */
function fillEquToHorizon(lmstDeg: number, latDeg: number, out: THREE.Matrix3): void {
  const lst = (lmstDeg * Math.PI) / 180;
  const lat = (latDeg * Math.PI) / 180;
  const sinLst = Math.sin(lst);
  const cosLst = Math.cos(lst);
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);

  // 1) 적경 → 시각각: z축 기준 -LST 회전
  // 2) 시각각·적위 → 고도·방위: y축 기준 (90° - 위도) 회전
  // 두 회전을 합성한 행렬을 열 우선(Three.js Matrix3.set은 행 우선 입력)으로 구성합니다.
  //
  // 결과 벡터 성분:
  //   east  =  -(cos δ sin H)                       … X
  //   up    =  sinLat sin δ + cosLat cos δ cos H    … Y
  //   north =  cosLat sin δ - sinLat cos δ cos H    … -Z 방향이 북이므로 부호 반전
  //
  // cos H = cos(LST - α) = cosLst cos α + sinLst sin α
  // sin H = sin(LST - α) = sinLst cos α - cosLst sin α
  // 입력 벡터가 (cos δ cos α, cos δ sin α, sin δ) 이므로 위 식을 성분별로 정리하면:

  out.set(
    // X (동쪽): -(cosδ sinH) = -(sinLst·x - cosLst·y)
    -sinLst, cosLst, 0,
    // Y (천정): cosLat·(cosδ cosH) + sinLat·sinδ
    cosLat * cosLst, cosLat * sinLst, sinLat,
    // Z (남쪽 = -북): -(cosLat·sinδ - sinLat·cosδ cosH)
    sinLat * cosLst, sinLat * sinLst, -cosLat
  );
}

/**
 * 행성 색 — 실제 관측 색상을 선형 RGB로 근사했습니다.
 * (금성은 두꺼운 황산 구름 때문에 거의 흰색, 화성은 산화철 때문에 주황색)
 */
const PLANET_COLORS: Record<PlanetKey, [number, number, number]> = {
  mercury: [1.0, 0.94, 0.85],
  venus: [1.0, 0.97, 0.88],
  mars: [1.0, 0.55, 0.35],
  jupiter: [1.0, 0.92, 0.78],
  saturn: [1.0, 0.89, 0.68],
};

/** 5대 행성을 현재 시각 기준으로 계산해 Points 슬롯에 넣을 형태로 반환 */
export function buildPlanetPoints(date: Date): PlanetPoint[] {
  return (Object.keys(PLANETS_METADATA) as PlanetKey[]).map(key => {
    const eq = getPlanetEquatorialCoord(key, date);
    return {
      raHours: eq.raHours,
      decDeg: eq.decDeg,
      magnitude: PLANETS_METADATA[key].magnitude,
      color: PLANET_COLORS[key],
    };
  });
}

/**
 * 별·은하수가 **같은** 회전을 쓰도록 씬에서 한 번만 계산해 공유합니다.
 * 두 곳에서 따로 계산하면 언젠가 한쪽만 고쳐져 은하수가 별 사이를 미끄러집니다.
 */
export function computeEquToHorizon(
  date: Date,
  latitude: number,
  longitude: number,
  out: THREE.Matrix3
): THREE.Matrix3 {
  fillEquToHorizon(getLMSTDeg(date, longitude), latitude, out);
  return out;
}

export interface StarFieldUpdate {
  /** computeEquToHorizon으로 만든 공유 회전 행렬 */
  equToHorizon: THREE.Matrix3;
  sunAltDeg: number;
  /** 사용자 조절 밝기 (0~2, 기본 1) */
  brightness: number;
  /** 사용자 조절 표시 등급 상한 (예: 4.5면 도시 하늘 수준) */
  magLimit: number;
  pixelRatio: number;
  planets?: PlanetPoint[];
  /** 항성 레이어 표시 여부 (기본 true) */
  showStars?: boolean;
  /** 행성 레이어 표시 여부 (기본 true) */
  showPlanets?: boolean;
}

/**
 * 항성/행성 상태 갱신. 회전 행렬 하나와 uniform 몇 개만 바꾸므로
 * 매 프레임 호출해도 비용이 거의 없습니다.
 */
export function updateStarField(handle: StarFieldHandle, u: StarFieldUpdate): void {
  const uni = handle.material.uniforms;
  (uni.uEquToHorizon.value as THREE.Matrix3).copy(u.equToHorizon);
  uni.uMagLimit.value = u.magLimit;
  uni.uBrightness.value = u.brightness;
  uni.uSunAltDeg.value = u.sunAltDeg;
  uni.uPixelRatio.value = u.pixelRatio;
  uni.uShowStars.value = u.showStars === false ? 0 : 1;
  uni.uShowPlanets.value = u.showPlanets === false ? 0 : 1;

  // 행성은 개수가 적으므로 attribute를 직접 갱신합니다.
  //
  // 단, **같은 행성 배열이면 건너뜁니다.** `needsUpdate = true`는 바뀐 슬롯만이
  // 아니라 **버퍼 전체**를 다시 올립니다. 여기 버퍼에는 항성 8,355개가 함께
  // 들어 있어서, 행성 5칸을 쓰려고 매 프레임 100KB짜리 attribute 3개를
  // 통째로 GPU에 재전송하게 됩니다 (60fps면 초당 18MB).
  // 호출부가 행성 위치를 캐시하므로, 배열 정체성만 비교하면 충분합니다.
  if (u.planets && u.planets.length && u.planets !== handle.lastPlanets) {
    handle.lastPlanets = u.planets;
    const geo = handle.points.geometry;
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const mag = geo.getAttribute('aMag') as THREE.BufferAttribute;
    const col = geo.getAttribute('aColor') as THREE.BufferAttribute;
    const capacity = pos.count - handle.starCount;

    for (let i = 0; i < capacity; i++) {
      const idx = handle.starCount + i;
      const p = u.planets[i];
      if (!p) {
        mag.setX(idx, 99); // 미사용 슬롯은 숨김
        continue;
      }
      const raRad = (p.raHours / 24) * Math.PI * 2;
      const decRad = (p.decDeg * Math.PI) / 180;
      const cd = Math.cos(decRad);
      pos.setXYZ(idx, cd * Math.cos(raRad), cd * Math.sin(raRad), Math.sin(decRad));
      mag.setX(idx, p.magnitude);
      col.setXYZ(idx, p.color[0], p.color[1], p.color[2]);
    }
    pos.needsUpdate = true;
    mag.needsUpdate = true;
    col.needsUpdate = true;
  }
}
