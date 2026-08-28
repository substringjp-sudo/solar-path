/**
 * 구름 — **껍질이 아니라 슬랩**. 전체화면 패스 하나로 그립니다.
 *
 * `docs/SKY_REBUILD_PLAN.md` 가 대체하려는 것이 `CloudDeck.ts`(구면 껍질 +
 * 극좌표 격자)와 `CloudField.ts`(빌보드)입니다. 하늘돔·별·태양·지형·달은
 * 그대로 두고 **구름 표현만** 바꿉니다.
 *
 * ## 왜 이 구조인가
 *
 * 화면 픽셀 → 방향 → 지상거리 → 월드 (x, z). 그게 전부입니다.
 * 덱 기하도 정점 보간도 (방위, 고도) 격자도 없습니다. 그래서:
 *
 *  - **천정 특이점이 없습니다.** 극좌표가 없으므로 극도 없습니다.
 *    지상거리 투영은 천정에서 선형으로 0에 수렴합니다 (d/Δ = 고도).
 *  - **지평선 타일 격자가 없습니다.** 노이즈를 월드 좌표로 읽으므로
 *    반복 주기가 화면 주파수로 올라오지 않습니다.
 *  - **구름에 두께가 있습니다.** 알파가 `1 - exp(-τ)` 에서 나오므로
 *    가장자리는 저절로 얇고, 얇으면 빛이 투과해 빛납니다.
 *
 * ## 문턱을 쓰지 않는 것이 핵심입니다
 *
 * 예전 덱은 셀 값을 문턱으로 **잘라** 알파를 만들었습니다. 그러면 두께가
 * 0 아니면 1이라, 노을에서 사람들이 보는 것 — 가장자리가 핑크로 빛나는
 * 구름, 그늘져 실루엣이 된 구름 — 이 원리적으로 생기지 않습니다.
 * 재보니 주변광이 구름 밝기의 88~99%를 차지했고 출력 채도가 0.04~0.12
 * 였습니다 (계획 4절).
 *
 * 두께로 읽으면 그 셋이 한 번에 나옵니다. 프로토타입에서 같은 조건의
 * 채도가 0.12 → 0.66 이었습니다.
 *
 * ## 운량장은 지상 2D 텍스처입니다
 *
 * 예보를 (방위, 고도) 격자가 아니라 **지상 평면**에 굽습니다. 그러면
 * 운량과 노이즈가 같은 투영을 지나는 같은 종류의 함수가 됩니다.
 *
 * ⚠ 반지름 방향을 **제곱근으로** 굽습니다. 선형이면 ±360km를 128텍셀로
 * 나눠 5.6km/텍셀이 되는데, 정작 위쪽 하늘을 만드는 2~12km 근방이 두어
 * 텍셀밖에 못 받습니다. 제곱근이면 중심 근처가 1km/텍셀, 가장자리가
 * 11km/텍셀 — 예보 모델 격자(2~11km)와 그대로 맞습니다.
 */
import * as THREE from 'three';
import { ATMOSPHERE_GLSL, makeTuningUniforms, type AtmosphereParams } from '../../utils/atmosphere';
import { LAYER_ALTITUDE_KM, type LayerKey } from '../../utils/skyColumn';
import type { RGB } from '../../utils/sunsetPhysics';

/** 운량장이 덮는 반경 (km). 상층 지평선(357km)을 담습니다. */
export const SLAB_RANGE_KM = 360;
/** 운량장 텍스처 한 변. 제곱근 사상이라 중심 근처가 촘촘합니다. */
export const SLAB_TEX = 128;

/** 층별 노이즈 셀 크기 (km) — 예보가 못 담는 잔여 형태의 규모. */
const CELL_KM: Record<LayerKey, number> = { low: 2.0, mid: 4.2, high: 9.0 };
/** 층별 두께 → 광학두께 배율. 두꺼운 저층일수록 큽니다. */
const TAU_K: Record<LayerKey, number> = { low: 13.0, mid: 9.0, high: 3.2 };

export const CLOUD_SLAB_GLSL = `
const float SLAB_R_EARTH = 6371.0;

float slab_hash21(vec2 p){
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float slab_vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f*f*(3.0-2.0*f);
  return mix(mix(slab_hash21(i), slab_hash21(i+vec2(1.0,0.0)), f.x),
             mix(slab_hash21(i+vec2(0.0,1.0)), slab_hash21(i+vec2(1.0,1.0)), f.x), f.y);
}
float slab_fbm(vec2 p, int oct){
  float s = 0.0, a = 0.5, n = 0.0;
  for (int i = 0; i < 6; i++){
    if (i >= oct) break;
    s += a * slab_vnoise(p); n += a; p = p*2.03 + 7.1; a *= 0.5;
  }
  return s / max(1e-5, n);
}

/**
 * 고도각 → 그 고도 구름층까지의 지상거리 (구면).
 *
 * 평면 근사 h·cot(ε) 는 지평선에서 발산합니다. 아래 형태는 켤레를 곱해
 * 정리한 것이라 천정에서도 큰 수의 상쇄가 없고, ε→0 에서 스스로
 * 수렴합니다.
 */
float slab_groundDist(float sinE, float cosE, float h){
  float chord = 2.0*SLAB_R_EARTH*h + h*h;
  float r = chord / (SLAB_R_EARTH*sinE + sqrt(SLAB_R_EARTH*SLAB_R_EARTH*sinE*sinE + chord));
  return (SLAB_R_EARTH + h) * asin(clamp(r*cosE/(SLAB_R_EARTH + h), 0.0, 1.0));
}

/** 지상 km → 운량장 uv. 반지름을 제곱근으로 굽습니다 (파일 위 주석). */
vec2 slab_coverUv(vec2 km, float rangeKm){
  float d = length(km);
  if (d < 1e-4) return vec2(0.5);
  float r = sqrt(min(d / rangeKm, 1.0));
  return 0.5 + 0.5 * (km / d) * r;
}

/**
 * 한 층의 두께. **문턱이 없습니다** — 운량이 두께를 정하고 가장자리는
 * 저절로 얇아집니다.
 *
 * conf 는 예보 확신도입니다. 낮으면 잔 무늬 진폭을 줄여 **암시로**
 * 남깁니다 — 아는 곳은 또렷하게, 모르는 곳은 풀어서 (계획 8절).
 */
float slab_thickness(vec2 km, float cover, float cellKm, float conf, float seed){
  vec2 p = km / cellKm + seed;
  float form = slab_fbm(p * 0.55, 4);
  float fine = slab_fbm(p * 1.60, 4);
  float m = cover * 1.75 * (0.50 + 0.50*form) + (fine - 0.5) * 0.34 * conf;
  return max(0.0, m - 0.42);
}
`;

const VERT = `
void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const FRAG = `
precision highp float;
${ATMOSPHERE_GLSL}
${CLOUD_SLAB_GLSL}

uniform vec2  uRes;
uniform mat4  uInvViewProj;
uniform vec3  uCamPos;
uniform vec3  uSunDir;
uniform float uSunAltDeg, uSunAzDeg;
uniform vec3  uBeamLow, uBeamMid, uBeamHigh;
uniform sampler2D uCoverTex;
uniform float uRangeKm;
uniform float uBeta, uAngstrom, uElevScale, uOzoneDU;
uniform float uDrift;
uniform float uSaturation;

void main(){
  // 화면 → 광선. 카메라 기저를 손으로 넘기지 않고 역행렬로 복원합니다.
  vec2 ndc = (gl_FragCoord.xy / uRes) * 2.0 - 1.0;
  vec4 far = uInvViewProj * vec4(ndc, 1.0, 1.0);
  vec3 dir = normalize(far.xyz / far.w - uCamPos);

  float sinE = dir.y;
  if (sinE <= 0.004) discard;          // 지평선 아래는 지형이 담당합니다
  float cosE = max(sqrt(max(0.0, 1.0 - sinE*sinE)), 1e-4);
  float cosG = clamp(dot(dir, uSunDir), -1.0, 1.0);

  vec2 dirXZ = normalize(dir.xz + vec2(1e-6));
  vec2 sunXZ = normalize(uSunDir.xz + vec2(1e-6));
  vec2 drift = vec2(uDrift * 0.0040, uDrift * 0.0016);

  // 층 주변광 — 그 층 고도에서 본 하늘 (계획 4절).
  vec3 ambUp   = atm_skyRadiance(72.0, cosG, uSunAltDeg, uBeta, uAngstrom, uElevScale, uOzoneDU);
  vec3 ambDown = atm_skyRadiance(12.0, cosG, uSunAltDeg, uBeta, uAngstrom, uElevScale, uOzoneDU);
  vec3 ambBase = mix(ambDown, ambUp, 0.35);

  // 먼 층(상)부터 가까운 층(저) 순으로 over 합성합니다.
  vec3 lin = vec3(0.0);
  float acc = 0.0;

  for (int L = 0; L < 3; L++){
    float h      = L == 0 ? ALT_HIGH : (L == 1 ? ALT_MID : ALT_LOW);
    vec3  beam   = L == 0 ? uBeamHigh : (L == 1 ? uBeamMid : uBeamLow);
    float cellKm = L == 0 ? CELL_HIGH : (L == 1 ? CELL_MID : CELL_LOW);
    float tauK   = L == 0 ? TAUK_HIGH : (L == 1 ? TAUK_MID : TAUK_LOW);
    float seed   = float(L) * 31.7;

    float d = slab_groundDist(sinE, cosE, h);
    vec2 km = dirXZ * d + drift;
    vec4 cv = texture2D(uCoverTex, slab_coverUv(km, uRangeKm));
    float cover = L == 0 ? cv.b : (L == 1 ? cv.g : cv.r);
    float conf  = cv.a;

    float thick = slab_thickness(km, cover, cellKm, conf, seed);
    if (thick <= 0.0) continue;

    float tau = thick * tauK;
    float T = exp(-tau);
    float alpha = 1.0 - T;

    // 자기그림자 — 태양 쪽으로 한 걸음 가서 두께를 다시 읽습니다.
    // 그 앞이 두꺼우면 여기는 그늘 → 어두운 실루엣.
    float thickSun = slab_thickness(km + sunXZ * (cellKm * 0.55), cover, cellKm, conf, seed);
    float reach = exp(-thickSun * tauK * 0.55);

    float ph = 0.45 + 0.55 * pow(max(cosG, 0.0), 5.0);
    // ⚠ 빔에 T를 곱하는 것이 핵심입니다. 얇을수록 빛이 통과해 빛나고,
    // 두꺼울수록 막혀 주변광만 남습니다.
    vec3 cc = beam * reach * ph * (0.20 + 1.15 * T) + ambBase * (0.26 + 0.30 * T);

    lin = cc * alpha + lin * (1.0 - alpha);
    acc = alpha + acc * (1.0 - alpha);
  }

  if (acc <= 0.002) discard;

  // 평균 색을 화면 색으로 옮긴 뒤 알파로 미리곱합니다 —
  // 합성기의 구름 버퍼가 미리곱 형태를 기대합니다 (SceneComposer 주석).
  vec3 disp = atm_display(lin / max(acc, 1e-4), uSaturation, uSunAltDeg);
  gl_FragColor = vec4(disp * acc, acc);
}
`;

export interface CloudSlabHandle {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  /** 운량장. 검증 하네스가 내용을 읽습니다. */
  coverTex: THREE.DataTexture;
  /** 운량장이 덮는 반경 (km) */
  rangeKm: number;
  dispose: () => void;
}

export function createCloudSlab(opts: { rangeKm?: number; texSize?: number } = {}): CloudSlabHandle {
  const rangeKm = opts.rangeKm ?? SLAB_RANGE_KM;
  const size = opts.texSize ?? SLAB_TEX;

  const data = new Uint8Array(size * size * 4);
  const coverTex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  coverTex.minFilter = THREE.LinearFilter;
  coverTex.magFilter = THREE.LinearFilter;
  coverTex.wrapS = THREE.ClampToEdgeWrapping;
  coverTex.wrapT = THREE.ClampToEdgeWrapping;
  coverTex.needsUpdate = true;

  const frag = FRAG
    .replace(/ALT_LOW/g, LAYER_ALTITUDE_KM.low.toFixed(2))
    .replace(/ALT_MID/g, LAYER_ALTITUDE_KM.mid.toFixed(2))
    .replace(/ALT_HIGH/g, LAYER_ALTITUDE_KM.high.toFixed(2))
    .replace(/CELL_LOW/g, CELL_KM.low.toFixed(2))
    .replace(/CELL_MID/g, CELL_KM.mid.toFixed(2))
    .replace(/CELL_HIGH/g, CELL_KM.high.toFixed(2))
    .replace(/TAUK_LOW/g, TAU_K.low.toFixed(2))
    .replace(/TAUK_MID/g, TAU_K.mid.toFixed(2))
    .replace(/TAUK_HIGH/g, TAU_K.high.toFixed(2));

  const material = new THREE.ShaderMaterial({
    uniforms: {
      ...makeTuningUniforms(),
      uRes: { value: new THREE.Vector2(1, 1) },
      uInvViewProj: { value: new THREE.Matrix4() },
      uCamPos: { value: new THREE.Vector3() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunAltDeg: { value: 0 },
      uSunAzDeg: { value: 0 },
      uBeamLow: { value: new THREE.Vector3(1, 1, 1) },
      uBeamMid: { value: new THREE.Vector3(1, 1, 1) },
      uBeamHigh: { value: new THREE.Vector3(1, 1, 1) },
      uCoverTex: { value: coverTex },
      uRangeKm: { value: rangeKm },
      uBeta: { value: 0.08 },
      uAngstrom: { value: 1.3 },
      uElevScale: { value: 1 },
      uOzoneDU: { value: 330 },
      uDrift: { value: 0 },
      uSaturation: { value: 1 },
    },
    vertexShader: VERT,
    fragmentShader: frag,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    // 합성기의 구름 버퍼는 **미리곱** 형태를 기대합니다. 색을 이미
    // 알파로 곱해 내보내므로 src 계수가 One 입니다.
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  });

  const geometry = new THREE.PlaneGeometry(2, 2);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.name = 'cloudSlab';

  return {
    mesh,
    material,
    coverTex,
    rangeKm,
    dispose: () => {
      geometry.dispose();
      material.dispose();
      coverTex.dispose();
    },
  };
}

/** 운량장을 굽는 데 필요한 것 — 방위·거리로 층 운량과 확신도를 답하는 함수. */
export interface CoverageSource {
  (azimuthDeg: number, distanceKm: number): {
    low: number; mid: number; high: number; confidence: number;
  };
}

/**
 * 운량장을 다시 굽습니다. **매 프레임 부르면 안 됩니다** — 128×128 이면
 * 16,384 회 조회라 수십 ms 가 듭니다. 기상이나 시각이 바뀔 때만 부르세요.
 */
export function bakeCloudSlabCoverage(handle: CloudSlabHandle, src: CoverageSource): void {
  const size = handle.coverTex.image.width as number;
  const data = handle.coverTex.image.data as Uint8Array;
  const R = handle.rangeKm;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      // uv → 제곱근 사상의 역: r = |p|, d = R·r²
      const px = ((i + 0.5) / size) * 2 - 1;
      const py = ((j + 0.5) / size) * 2 - 1;
      const r = Math.hypot(px, py);
      const k = (j * size + i) * 4;
      if (r > 1) { data[k] = data[k + 1] = data[k + 2] = data[k + 3] = 0; continue; }
      const d = R * r * r;
      const az = r < 1e-6 ? 0 : (Math.atan2(px / r, -py / r) * 180) / Math.PI;
      const c = src((az + 360) % 360, d);
      data[k] = Math.max(0, Math.min(255, c.low * 255));
      data[k + 1] = Math.max(0, Math.min(255, c.mid * 255));
      data[k + 2] = Math.max(0, Math.min(255, c.high * 255));
      data[k + 3] = Math.max(0, Math.min(255, c.confidence * 255));
    }
  }
  handle.coverTex.needsUpdate = true;
}

export interface CloudSlabUpdate {
  camera: THREE.Camera;
  widthPx: number;
  heightPx: number;
  sunDir: THREE.Vector3;
  sunAltDeg: number;
  sunAzDeg: number;
  /** 층 고도(km)에서 본 직달광. `beamAtAltitude` 를 그대로 넘기세요. */
  beamFor: (altKm: number) => RGB;
  atmosphere: AtmosphereParams;
  /** 바람 이류용 경과 시간 (초) */
  timeSeconds: number;
  saturation?: number;
  visible: boolean;
}

/** 매 프레임 부르는 쪽. 카메라와 태양만 갱신하므로 값쌉니다. */
export function updateCloudSlab(handle: CloudSlabHandle, u: CloudSlabUpdate): void {
  handle.mesh.visible = u.visible;
  if (!u.visible) return;
  const uni = handle.material.uniforms;

  (uni.uRes.value as THREE.Vector2).set(u.widthPx, u.heightPx);
  u.camera.updateMatrixWorld();
  // 화면 → 세계. 광선 복원에 씁니다.
  (uni.uInvViewProj.value as THREE.Matrix4)
    .multiplyMatrices(u.camera.projectionMatrix, u.camera.matrixWorldInverse)
    .invert();
  (uni.uCamPos.value as THREE.Vector3).setFromMatrixPosition(u.camera.matrixWorld);

  (uni.uSunDir.value as THREE.Vector3).copy(u.sunDir).normalize();
  uni.uSunAltDeg.value = u.sunAltDeg;
  uni.uSunAzDeg.value = u.sunAzDeg;

  const bl = u.beamFor(LAYER_ALTITUDE_KM.low);
  const bm = u.beamFor(LAYER_ALTITUDE_KM.mid);
  const bh = u.beamFor(LAYER_ALTITUDE_KM.high);
  (uni.uBeamLow.value as THREE.Vector3).set(bl.r, bl.g, bl.b);
  (uni.uBeamMid.value as THREE.Vector3).set(bm.r, bm.g, bm.b);
  (uni.uBeamHigh.value as THREE.Vector3).set(bh.r, bh.g, bh.b);

  uni.uBeta.value = u.atmosphere.betaMie;
  uni.uAngstrom.value = u.atmosphere.angstrom;
  uni.uElevScale.value = u.atmosphere.elevScale;
  uni.uOzoneDU.value = u.atmosphere.ozoneDU;
  uni.uDrift.value = u.timeSeconds;
  uni.uSaturation.value = u.saturation ?? 1;
}

/**
 * 이미 풀린 하늘 기둥(`LayerSample[]`)에서 운량장 원천을 만듭니다.
 *
 * 앱의 타임라인은 팬을 들고 있지 않고 재구성된 기둥만 넘겨줍니다. 그래서
 * (방위, 거리)로 이중선형 조회하는 원천을 여기서 만듭니다.
 *
 * ⚠ 같은 표본을 쓰는데도 **천정 바람개비가 사라집니다.** 결과를 직교
 * 좌표 텍스처에 굽기 때문입니다 — 중심 텍셀이 하나뿐이라 모든 방위가
 * 자동으로 같은 값을 갖습니다. 극좌표 격자에서는 맨 윗 고리의 방위별
 * 값이 한 점으로 빨려들며 부챗살이 됐습니다 (PR #14의 진단).
 */
export function coverageFromSamples(
  samples: { layer: LayerKey; azimuthDeg: number; distanceKm: number; cover: number; confidence: number }[]
): CoverageSource {
  type Row = { az: number[]; dist: number[]; cover: Float32Array; conf: Float32Array };
  const byLayer: Record<string, Row> = {};

  for (const key of ['low', 'mid', 'high'] as LayerKey[]) {
    const mine = samples.filter(s => s.layer === key);
    if (mine.length === 0) continue;
    const az = Array.from(new Set(mine.map(s => s.azimuthDeg))).sort((a, b) => a - b);
    const dist = Array.from(new Set(mine.map(s => s.distanceKm))).sort((a, b) => a - b);
    const cover = new Float32Array(az.length * dist.length);
    const conf = new Float32Array(az.length * dist.length);
    const ai = new Map(az.map((v, i) => [v, i]));
    const di = new Map(dist.map((v, i) => [v, i]));
    for (const s of mine) {
      const i = ai.get(s.azimuthDeg)!, j = di.get(s.distanceKm)!;
      cover[j * az.length + i] = s.cover;
      conf[j * az.length + i] = s.confidence;
    }
    byLayer[key] = { az, dist, cover, conf };
  }

  const lookup = (row: Row | undefined, azDeg: number, distKm: number) => {
    if (!row) return { c: 0, f: 0 };
    const { az, dist, cover, conf } = row;
    const nA = az.length;
    // 방위는 360°에서 되감깁니다.
    let a0 = 0;
    while (a0 < nA - 1 && az[a0 + 1] <= azDeg) a0++;
    const a1 = (a0 + 1) % nA;
    const spanA = (az[a1] - az[a0] + 360) % 360 || 360 / nA;
    const tA = Math.max(0, Math.min(1, ((azDeg - az[a0] + 360) % 360) / spanA));
    // 거리는 클램프합니다 — 표본 밖은 가장 가까운 고리의 값입니다.
    let d0 = 0;
    while (d0 < dist.length - 2 && dist[d0 + 1] < distKm) d0++;
    const d1 = Math.min(dist.length - 1, d0 + 1);
    const spanD = Math.max(1e-6, dist[d1] - dist[d0]);
    const tD = Math.max(0, Math.min(1, (distKm - dist[d0]) / spanD));
    const at = (arr: Float32Array, ia: number, id: number) => arr[id * nA + ia];
    const mix = (arr: Float32Array) =>
      (at(arr, a0, d0) * (1 - tA) + at(arr, a1, d0) * tA) * (1 - tD) +
      (at(arr, a0, d1) * (1 - tA) + at(arr, a1, d1) * tA) * tD;
    return { c: mix(cover), f: mix(conf) };
  };

  return (azimuthDeg: number, distanceKm: number) => {
    const lo = lookup(byLayer.low, azimuthDeg, distanceKm);
    const mi = lookup(byLayer.mid, azimuthDeg, distanceKm);
    const hi = lookup(byLayer.high, azimuthDeg, distanceKm);
    return {
      low: lo.c, mid: mi.c, high: hi.c,
      confidence: Math.max(lo.f, mi.f, hi.f),
    };
  };
}
