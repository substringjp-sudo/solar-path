/**
 * EarthGlobeGL.tsx — 우주 모드 지구본의 3D 폴리곤 지형 · 해양 광학 · 밤하늘 셰이더 레이어.
 *
 * - 번들된 전 지구 고도·해저 수심(assets/dem/base_terrarium_z0.png)으로 실제 3D 구면 폴리곤
 *   정점을 변위(고산·산맥 입체 폴리곤)하고, 위도·경도·고도·경사도 기반 토질/식생/암석/설선 색을 입힙니다.
 * - 바다는 해저 수심에 따른 Beer-Lambert 흡수·산란, 스넬 법칙 굴절, 프레넬 반사 및 태양 반사광을 계산합니다.
 * - 태양이 닿지 않는 밤 영역은 대기 박명(Rayleigh/Mie) 산란과 우주 시점 암부 대비, NASA 야간 불빛을 표현합니다.
 */
import React, { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { GLView, type ExpoWebGLRenderingContext } from 'expo-gl';
import { Renderer } from 'expo-three';
import * as THREE from 'three';
import { unzlibSync } from 'fflate';
import { BASE_DEM_PNG_B64 } from '../../utils/baseDemData';
import { LAND_SDF_PNG_B64 } from '../../utils/landMaskData';
import { fromBase64, getCachedNightLights, loadNightLights } from '../../utils/nightLightsAsset';
import type { NightLights } from '../../utils/cityLightMap';
import {
  computeEqToCamMatrix,
  createSpaceMilkyWay,
  createSpaceStarField,
  updateSpacePlanets,
  type SpaceMilkyWayHandle,
  type SpaceStarFieldHandle,
} from './SpaceBackdropGL';

interface DecodedDem {
  w: number;
  h: number;
  rgba: Uint8Array;
  elevM: Float32Array;
}

interface DecodedLandMask {
  w: number;
  h: number;
  rgba: Uint8Array;
}

let cachedDem: DecodedDem | null = null;
let cachedLandMask: DecodedLandMask | null = null;
let cachedSphereGeo: THREE.BufferGeometry | null = null;

function decodePngToRgba(bytes: Uint8Array): { w: number; h: number; rgba: Uint8Array } {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let p = 8;
  let w = 0;
  let h = 0;
  let ct = 0;
  const idat: Uint8Array[] = [];
  while (p < bytes.length) {
    const len = dv.getUint32(p);
    const type = String.fromCharCode(bytes[p + 4], bytes[p + 5], bytes[p + 6], bytes[p + 7]);
    const body = bytes.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      w = dv.getUint32(p + 8);
      h = dv.getUint32(p + 12);
      ct = body[9];
    } else if (type === 'IDAT') {
      idat.push(body);
    } else if (type === 'IEND') {
      break;
    }
    p += 12 + len;
  }
  const bpp = ({ 0: 1, 2: 3, 4: 2, 6: 4 } as Record<number, number>)[ct] ?? 3;
  const total = idat.reduce((a, b) => a + b.length, 0);
  const z = new Uint8Array(total);
  let o = 0;
  for (const b of idat) { z.set(b, o); o += b.length; }
  const raw = unzlibSync(z);
  const stride = w * bpp;
  const rgba = new Uint8Array(w * h * 4);
  let prev = new Uint8Array(stride);
  let cur = new Uint8Array(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      let v = row[x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const pp = a + b - c;
        const pa = Math.abs(pp - a);
        const pb = Math.abs(pp - b);
        const pc = Math.abs(pp - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[x] = v & 255;
    }
    for (let x = 0; x < w; x++) {
      const dst = (y * w + x) * 4;
      if (bpp === 1) {
        const g = cur[x];
        rgba[dst] = g; rgba[dst + 1] = g; rgba[dst + 2] = g; rgba[dst + 3] = 255;
      } else if (bpp === 2) {
        const g = cur[x * 2];
        rgba[dst] = g; rgba[dst + 1] = g; rgba[dst + 2] = g; rgba[dst + 3] = cur[x * 2 + 1];
      } else if (bpp === 3) {
        rgba[dst] = cur[x * 3];
        rgba[dst + 1] = cur[x * 3 + 1];
        rgba[dst + 2] = cur[x * 3 + 2];
        rgba[dst + 3] = 255;
      } else {
        rgba[dst] = cur[x * 4];
        rgba[dst + 1] = cur[x * 4 + 1];
        rgba[dst + 2] = cur[x * 4 + 2];
        rgba[dst + 3] = cur[x * 4 + 3];
      }
    }
    const tmp = prev; prev = cur; cur = tmp;
  }
  return { w, h, rgba };
}

function getBaseDemSync(): DecodedDem | null {
  if (cachedDem) return cachedDem;
  try {
    const bytes = fromBase64(BASE_DEM_PNG_B64);
    const { w, h, rgba } = decodePngToRgba(bytes);
    const elevM = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) {
      const idx = i * 4;
      elevM[i] = rgba[idx] * 256 + rgba[idx + 1] + rgba[idx + 2] / 256 - 32768;
    }
    cachedDem = { w, h, rgba, elevM };
    return cachedDem;
  } catch (e) {
    if (__DEV__) console.warn('[EarthGlobeGL] base DEM decode failed', e);
    return null;
  }
}

function getLandMaskSync(): DecodedLandMask | null {
  if (cachedLandMask) return cachedLandMask;
  try {
    const bytes = fromBase64(LAND_SDF_PNG_B64);
    const { w, h, rgba } = decodePngToRgba(bytes);
    cachedLandMask = { w, h, rgba };
    return cachedLandMask;
  } catch (e) {
    if (__DEV__) console.warn('[EarthGlobeGL] land mask decode failed', e);
    return null;
  }
}

function sampleLandSdfCpu(lm: DecodedLandMask, lonRad: number, latRad: number): number {
  let u = (lonRad / (Math.PI * 2) + 0.5) % 1;
  if (u < 0) u += 1;
  const v = Math.max(0, Math.min(1, 0.5 - latRad / Math.PI));
  const x = Math.min(lm.w - 1, Math.max(0, Math.floor(u * lm.w)));
  const y = Math.min(lm.h - 1, Math.max(0, Math.floor(v * lm.h)));
  return lm.rgba[(y * lm.w + x) * 4] / 255;
}

function sampleElevCpu(dem: DecodedDem, lm: DecodedLandMask | null, lonRad: number, latRad: number): number {
  const twoPi = Math.PI * 2;
  let u = (lonRad / twoPi + 0.5) % 1;
  if (u < 0) u += 1;
  const latC = Math.max(-1.48442, Math.min(1.48442, latRad));
  const v = Math.max(0, Math.min(0.996, 0.5 - Math.log(Math.tan(Math.PI * 0.25 + latC * 0.5)) / twoPi));

  const stX = u * dem.w - 0.5;
  const stY = v * dem.h - 0.5;
  const i0x = Math.floor(stX);
  const i0y = Math.floor(stY);
  const fx = stX - i0x;
  const fy = stY - i0y;

  const x0 = ((i0x % dem.w) + dem.w) % dem.w;
  const x1 = (x0 + 1) % dem.w;
  const y0 = Math.max(0, Math.min(dem.h - 1, i0y));
  const y1 = Math.max(0, Math.min(dem.h - 1, i0y + 1));

  const h00 = dem.elevM[y0 * dem.w + x0];
  const h10 = dem.elevM[y0 * dem.w + x1];
  const h01 = dem.elevM[y1 * dem.w + x0];
  const h11 = dem.elevM[y1 * dem.w + x1];
  let h = (h00 * (1 - fx) + h10 * fx) * (1 - fy) + (h01 * (1 - fx) + h11 * fx) * fy;

  // 남극(-78° ~ -84°) 이남은 메르카토르 절단선 대신 균일한 빙상 고원으로 부드럽게 수렴시켜 극점 핀휠 방지
  if (latRad < -1.36) {
    const t = Math.max(0, Math.min(1, (-1.36 - latRad) / 0.10));
    const st = t * t * (3 - 2 * t);
    h = h * (1 - st) + 2200 * st;
  }

  if (lm) {
    const sdf = sampleLandSdfCpu(lm, lonRad, latRad);
    h = sdf >= 0.5 ? Math.max(h, 25) : Math.min(h, -25);
  }
  return h;
}

/**
 * 실제 지형 고도로 정점을 변위시킨 3D 지구 폴리곤 메시를 생성합니다.
 * 육지 산맥/고원은 반경 최대 +2.4%까지 입체 돌출되고, 해수면 이하는 반경 1.0을 유지합니다.
 */
function getEarthTerrainGeometry(dem: DecodedDem, lm: DecodedLandMask | null): THREE.BufferGeometry {
  if (cachedSphereGeo) return cachedSphereGeo;
  const geo = new THREE.SphereGeometry(1, 160, 96);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const count = pos.count;
  const sphereNormals = new Float32Array(count * 3);
  const elevAttr = new Float32Array(count);

  const RELIEF_SCALE = 0.024;
  for (let i = 0; i < count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const len = Math.hypot(x, y, z) || 1;
    const nx = x / len;
    const ny = y / len;
    const nz = z / len;

    sphereNormals[i * 3] = nx;
    sphereNormals[i * 3 + 1] = ny;
    sphereNormals[i * 3 + 2] = nz;

    const latRad = Math.asin(Math.max(-1, Math.min(1, ny)));
    const lonRad = Math.atan2(nx, nz);
    const h = sampleElevCpu(dem, lm, lonRad, latRad);
    elevAttr[i] = h;

    const disp = h > 0 ? Math.min(1, h / 8848) * RELIEF_SCALE : 0;
    const r = 1 + disp;
    pos.setXYZ(i, nx * r, ny * r, nz * r);
  }

  geo.setAttribute('aSphereNormal', new THREE.BufferAttribute(sphereNormals, 3));
  geo.setAttribute('aElev', new THREE.BufferAttribute(elevAttr, 1));
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  cachedSphereGeo = geo;
  return geo;
}

function buildNightTexture(m: NightLights): THREE.DataTexture {
  const dw = 900;
  const dh = 450;
  const rgba = new Uint8Array(dw * dh * 4);
  const stepX = m.w / dw;
  const stepY = m.h / dh;
  for (let y = 0; y < dh; y++) {
    const sy = Math.min(m.h - 1, Math.floor(y * stepY));
    for (let x = 0; x < dw; x++) {
      const sx = Math.min(m.w - 1, Math.floor(x * stepX));
      const v = m.data[sy * m.w + sx];
      const dst = (y * dw + x) * 4;
      rgba[dst] = v;
      rgba[dst + 1] = v;
      rgba[dst + 2] = v;
      rgba[dst + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(rgba, dw, dh, THREE.RGBAFormat);
  tex.colorSpace = THREE.NoColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

const EARTH_VERT = /* glsl */ `
attribute vec3 aSphereNormal;
attribute float aElev;

varying vec3 vEarthPos;
varying vec3 vCamNormal;
varying vec3 vSphereCamNormal;
varying float vElev;
varying float vClipBack;

uniform float uMorph;
uniform vec2 uSizePx;
uniform vec2 uCenterPx;
uniform float uRadiusPx;
uniform vec3 uRotateDeg;

const float V_RAD = 0.01745329252;
const float V_MAX_MERC_LAT = 1.483529864;

void main() {
  vEarthPos = normalize(aSphereNormal);
  vCamNormal = normalize(normalMatrix * normal);
  vSphereCamNormal = normalize(normalMatrix * aSphereNormal);
  vElev = aElev;
  vClipBack = 0.0;

  if (uMorph >= 0.999) {
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    return;
  }

  // d3.geoProjection(morphRaw(uMorph, -r1)) 와 1:1 일치하는 정사영 <-> 메르카토르 보간
  float r0 = uRotateDeg.x * V_RAD;
  float c0 = cos(r0), s0 = sin(r0);
  // Y축 회전(+r0): aSphereNormal(x=동, y=북, z=앞)
  float rx = vEarthPos.x * c0 + vEarthPos.z * s0;
  float ry = vEarthPos.y;
  float rz = -vEarthPos.x * s0 + vEarthPos.z * c0;

  // X축 회전(-r1): phi0 = -uRotateDeg.y
  float p0 = -uRotateDeg.y * V_RAD;
  float cp0 = cos(p0), sp0 = sin(p0);
  float cx = rx;
  float cy = ry * cp0 - rz * sp0;
  float cz = ry * sp0 + rz * cp0;

  // 뒤쪽 반구(±180° 경도 래핑 구간) 삼각형 늘어짐 방지
  if (cz <= 0.02) {
    vClipBack = 1.0;
  }

  // 정사영(돌린 좌표 그대로)
  float xo = cx;
  float yo = cy;

  // 메르카토르(기울임 되돌린 원래 위도 · 경도차)
  float xUnrot = cz * cp0 - cy * sp0;
  float zUnrot = cz * sp0 + cy * cp0;
  if (xUnrot <= 0.02) {
    vClipBack = 1.0;
  }
  float phi = clamp(asin(clamp(zUnrot, -1.0, 1.0)), -V_MAX_MERC_LAT, V_MAX_MERC_LAT);
  float dl = atan(cx, xUnrot);
  float m0 = log(tan(0.7853981634 + clamp(p0, -V_MAX_MERC_LAT, V_MAX_MERC_LAT) * 0.5));
  float k = max(0.1, cp0);
  float xm = k * dl;
  float ym = k * (log(tan(0.7853981634 + phi * 0.5)) - m0);

  float px = mix(xm, xo, uMorph);
  float py = mix(ym, yo, uMorph);

  // 롤(r2) 적용 후 픽셀 -> NDC 변환
  float r2 = uRotateDeg.z * V_RAD;
  float cr = cos(r2), sr = sin(r2);
  float rpx = px * cr - py * sr;
  float rpy = px * sr + py * cr;

  float screenX = uCenterPx.x + rpx * uRadiusPx;
  float screenY = uCenterPx.y - rpy * uRadiusPx;
  float ndcX = (screenX / max(1.0, uSizePx.x)) * 2.0 - 1.0;
  float ndcY = 1.0 - (screenY / max(1.0, uSizePx.y)) * 2.0;
  gl_Position = vec4(ndcX, ndcY, 0.0, 1.0);
}
`;

const EARTH_FRAG = /* glsl */ `
precision highp float;

varying vec3 vEarthPos;
varying vec3 vCamNormal;
varying vec3 vSphereCamNormal;
varying float vElev;
varying float vClipBack;

uniform float uMorph;
uniform vec3 uSunDir;
uniform sampler2D uDemTex;
uniform float uDemValid;
uniform sampler2D uLandTex;
uniform float uLandValid;
uniform sampler2D uNightTex;
uniform float uNightValid;
uniform float uOpacity;
uniform float uSunDeclDeg;
uniform float uTimeHours;

const float PI = 3.14159265359;
const float RAD = 0.01745329252;

float hash3(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.x + p.y) * p.z);
}

float noise3(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(
      mix(hash3(i + vec3(0.0, 0.0, 0.0)), hash3(i + vec3(1.0, 0.0, 0.0)), f.x),
      mix(hash3(i + vec3(0.0, 1.0, 0.0)), hash3(i + vec3(1.0, 1.0, 0.0)), f.x),
      f.y
    ),
    mix(
      mix(hash3(i + vec3(0.0, 0.0, 1.0)), hash3(i + vec3(1.0, 0.0, 1.0)), f.x),
      mix(hash3(i + vec3(0.0, 1.0, 1.0)), hash3(i + vec3(1.0, 1.0, 1.0)), f.x),
      f.y
    ),
    f.z
  );
}

float fbm3(vec3 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * noise3(p);
    p = p * 2.03 + vec3(13.7, 29.1, 7.3);
    a *= 0.5;
  }
  return v;
}

float decodeTerrarium(vec3 rgb) {
  vec3 c = floor(rgb * 255.0 + 0.5);
  return (c.r * 256.0 + c.g + c.b / 256.0) - 32768.0;
}

float sampleElevAt(float lonRad, float latRad) {
  if (uDemValid < 0.5) return vElev;
  float u = fract(lonRad / (2.0 * PI) + 0.5);
  float latC = clamp(latRad, -1.48442, 1.48442);
  float v = clamp(0.5 - log(tan(PI * 0.25 + latC * 0.5)) / (2.0 * PI), 0.0, 0.996);

  float texSize = 256.0;
  vec2 st = vec2(u * texSize - 0.5, v * texSize - 0.5);
  vec2 i0 = floor(st);
  vec2 f = st - i0;
  float u0 = fract((i0.x + 0.5) / texSize);
  float u1 = fract((i0.x + 1.5) / texSize);
  float v0 = clamp((i0.y + 0.5) / texSize, 0.0, 1.0);
  float v1 = clamp((i0.y + 1.5) / texSize, 0.0, 1.0);

  float h00 = decodeTerrarium(texture2D(uDemTex, vec2(u0, v0)).rgb);
  float h10 = decodeTerrarium(texture2D(uDemTex, vec2(u1, v0)).rgb);
  float h01 = decodeTerrarium(texture2D(uDemTex, vec2(u0, v1)).rgb);
  float h11 = decodeTerrarium(texture2D(uDemTex, vec2(u1, v1)).rgb);
  float h = mix(mix(h00, h10, f.x), mix(h01, h11, f.x), f.y);

  // 남극(-78° ~ -84°) 이남은 메르카토르 절단선 대신 균일한 빙상 고원으로 수렴시켜 극점 방사형 핀휠 제거
  float antPole = smoothstep(-1.36, -1.46, latRad);
  return mix(h, 2200.0, antPole);
}

void main() {
  if (uOpacity <= 0.01 || vClipBack > 0.5) discard;

  vec3 nEarth = normalize(vEarthPos);
  vec3 nSphere = normalize(vSphereCamNormal);
  vec3 nMesh = normalize(vCamNormal);
  vec3 L = normalize(uSunDir);
  vec3 V = vec3(0.0, 0.0, 1.0);

  float latRad = asin(clamp(nEarth.y, -1.0, 1.0));
  float lonRad = atan(nEarth.x, nEarth.z);
  float absLat = abs(latRad) / RAD;

  float hRaw = sampleElevAt(lonRad, latRad);
  float eqU = fract(lonRad / (2.0 * PI) + 0.5);
  float eqV = clamp(0.5 - latRad / PI, 0.0, 1.0);
  float landSdf = uLandValid > 0.5 ? texture2D(uLandTex, vec2(eqU, eqV)).r : (hRaw >= 0.0 ? 0.6 : 0.4);
  float landMask = smoothstep(0.492, 0.508, landSdf);
  float h = landSdf >= 0.5 ? max(hRaw, 25.0) : min(hRaw, -25.0);

  float detailN = fbm3(nEarth * 16.0);
  float fineN = fbm3(nEarth * 46.0);

  float ndl = dot(nSphere, L);
  float nz = clamp(nSphere.z, 0.0, 1.0);
  // 실제 천문학 수치 기반 낮/박명/밤 경계:
  // - 태양 시반경(16') + 대기 굴절(34') = -0.833°, 고도 h 에 따른 지평선 부각 sqrt(2h/R) 반영
  float sunAltDeg = asin(clamp(ndl, -1.0, 1.0)) / RAD;
  float dipDeg = h > 0.0 ? sqrt(2.0 * h / 6371000.0) / RAD : 0.0;
  float effSunAlt = sunAltDeg + 0.833 + dipDeg;
  float day = smoothstep(-0.35, 1.4, effSunAlt);
  float civilTw = smoothstep(-5.5, -0.5, sunAltDeg);
  float twilightBell = exp(-pow((sunAltDeg + 1.5) / 2.8, 2.0));
  float nightDeep = smoothstep(0.0, -10.0, sunAltDeg);
  vec3 sunTint = mix(vec3(1.0, 0.50, 0.22), vec3(1.0, 0.98, 0.95), smoothstep(-0.8, 9.0, effSunAlt));

  vec3 oceanCol = vec3(0.0);
  if (landMask < 0.99) {
    // ── 바다: 수심 Beer-Lambert 흡수 + 스넬 굴절 + 미세 파랑 프레넬 반사 + 산란 ──
    float depth = max(25.0, -hRaw);

    // 미세 해수면 파랑 법선 섭동
    float w1 = noise3(nEarth * 68.0);
    float w2 = noise3(nEarth * 145.0 + vec3(4.2, -2.7, 1.9));
    vec3 eastCam = normalize(cross(vec3(0.0, 1.0, 0.0), nSphere) + vec3(1e-4, 0.0, 0.0));
    vec3 northCam = normalize(cross(nSphere, eastCam));
    vec3 nWave = normalize(nSphere + eastCam * ((w1 - 0.5) * 0.07) + northCam * ((w2 - 0.5) * 0.07));

    // 스넬의 법칙 굴절 (공기 n=1.0 -> 해수 n=1.333)
    vec3 refrView = refract(-V, nWave, 1.0 / 1.333);
    float refrPath = 1.0 / max(0.28, abs(dot(refrView, nSphere)));

    // Beer-Lambert 스펙트럼 감쇠 (적색 빠르게 흡수, 청색 심층 투과)
    vec3 sigma = vec3(0.46, 0.125, 0.045);
    vec3 transmittance = exp(-sigma * (depth / 115.0) * refrPath);

    // 얕은 대륙붕 해저/플랑크톤 산란 -> 중층 코발트 -> 심해저 남색
    vec3 colShelfSand = vec3(0.14, 0.58, 0.62);
    vec3 colShallowScatter = vec3(0.05, 0.36, 0.52);
    vec3 colPelagic = vec3(0.018, 0.125, 0.32);
    vec3 colAbyss = vec3(0.005, 0.028, 0.09);

    float vecShallow = smoothstep(0.32, 0.498, landSdf);
    float tCoastal = max(exp(-depth / 180.0), vecShallow * 0.72);
    float tAbyss = smoothstep(1600.0, 5200.0, depth) * (1.0 - vecShallow * 0.65);

    vec3 scatterCol = mix(colPelagic, colShallowScatter, tCoastal);
    scatterCol = mix(scatterCol, colAbyss, tAbyss);
    // 얕은 바다는 굴절 투과광(해저면 반사) 반영
    vec3 oceanBody = mix(scatterCol, colShelfSand, transmittance.r * tCoastal * 0.65);

    // 산란/일조량 (밤 바다는 깊은 심야 남색으로 가라앉혀 육지·야경과 대비)
    float oceanDiff = max(0.0, dot(nWave, L)) * day;
    float nightAmbient = mix(0.010, 0.003, nightDeep) + civilTw * 0.008;
    vec3 litBody = oceanBody * (nightAmbient + sunTint * oceanDiff * 0.98) + vec3(0.001, 0.003, 0.010) * (1.0 - day);

    // Schlick 프레넬 반사 (F0 = 0.02 for water)
    float cosThetaV = max(0.0, dot(nWave, V));
    float fresnel = 0.02 + 0.98 * pow(1.0 - cosThetaV, 5.0);

    // 태양 반사광(Sun Glint): 날카로운 코어 + 파랑 산란 로브
    vec3 H = normalize(L + V);
    float ndh = max(0.0, dot(nWave, H));
    float specCore = pow(ndh, 80.0) * 0.72;
    float specBroad = pow(ndh, 16.0) * 0.14;
    vec3 glint = sunTint * (specCore + specBroad) * day * (0.45 + 0.55 * fresnel);

    // 하늘/대기 프레넬 반사 — 태양이 비추는 낮쪽에서만 반사 (밤쪽은 0)
    vec3 skyReflect = vec3(0.24, 0.52, 0.86) * fresnel * (0.46 * smoothstep(0.0, 0.45, ndl));

    oceanCol = litBody * (1.0 - fresnel * 0.35 * day) + skyReflect + glint;
  }

  vec3 landCol = vec3(0.0);
  if (landMask > 0.01) {
    // ── 육지: 3D 폴리곤 지형 법선 + DEM 고해상도 기울기 + 위도/토질 기반 색상 ──
    float hLand = max(25.0, hRaw);
    float poleSafe = 1.0 - smoothstep(78.0, 86.0, absLat);
    float dStep = 0.012;
    float hE = sampleElevAt(lonRad + dStep, latRad);
    float hW = sampleElevAt(lonRad - dStep, latRad);
    float hN = sampleElevAt(lonRad, min(1.48, latRad + dStep));
    float hS = sampleElevAt(lonRad, max(-1.48, latRad - dStep));

    vec3 eastCam = normalize(cross(vec3(0.0, 1.0, 0.0), nSphere) + vec3(1e-4, 0.0, 0.0));
    vec3 northCam = normalize(cross(nSphere, eastCam));
    float slopeE = clamp((hE - hW) / 2400.0, -1.0, 1.0) * poleSafe;
    float slopeN = clamp((hN - hS) / 2400.0, -1.0, 1.0) * poleSafe;
    float slopeMag = clamp(length(vec2(slopeE, slopeN)) * 1.4, 0.0, 1.0);

    // 실제 3D 메시 폴리곤 법선 + 세부 지형 기울기 결합
    vec3 nDetail = normalize(nSphere - eastCam * slopeE * 0.52 - northCam * slopeN * 0.52);
    vec3 nRelief = normalize(mix(nDetail, nMesh, 0.55 * poleSafe));
    float diff = max(0.0, dot(nRelief, L)) * day;
    float nightAmbient = mix(0.022, 0.013, nightDeep) + civilTw * 0.012;

    // 지역별 토질·기후대 색상 (열대 우림 토양 / 적색 라테라이트·사막 사토 / 온대 양토 / 스텝·초원 / 한대 타이가 / 고산 암석·빙설)
    float lonDeg = lonRad / RAD;
    // 사하라·아라비아·중앙아시아·호주·미국 남서부 건조 지대 가중치
    float aridBelt = exp(-pow((absLat - 24.5) / 10.5, 2.0));
    float inlandArid = exp(-pow((absLat - 40.0) / 11.0, 2.0)) * smoothstep(35.0, 75.0, lonDeg) * (1.0 - smoothstep(105.0, 130.0, lonDeg));
    float ausArid = exp(-pow((latRad / RAD + 24.0) / 9.0, 2.0)) * smoothstep(112.0, 125.0, lonDeg) * (1.0 - smoothstep(142.0, 154.0, lonDeg));
    float wArid = clamp(max(aridBelt * (0.58 + 0.42 * detailN), max(inlandArid * 0.85, ausArid * 0.95)), 0.0, 1.0);

    vec3 colTropicalSoil = mix(vec3(0.07, 0.22, 0.09), vec3(0.15, 0.27, 0.11), detailN);
    vec3 colSandDesert   = mix(vec3(0.72, 0.58, 0.39), vec3(0.61, 0.44, 0.28), fineN);
    vec3 colRedSoil      = mix(vec3(0.62, 0.35, 0.21), vec3(0.51, 0.28, 0.18), detailN);
    vec3 colSteppeClay   = mix(vec3(0.43, 0.40, 0.24), vec3(0.33, 0.35, 0.19), fineN);
    vec3 colTemperate    = mix(vec3(0.14, 0.29, 0.15), vec3(0.24, 0.34, 0.18), detailN);
    vec3 colTaiga        = mix(vec3(0.10, 0.18, 0.13), vec3(0.19, 0.22, 0.16), detailN);
    vec3 colTundra       = mix(vec3(0.30, 0.28, 0.22), vec3(0.37, 0.34, 0.28), fineN);
    vec3 colRock         = mix(vec3(0.38, 0.35, 0.31), vec3(0.52, 0.48, 0.42), fineN);
    vec3 colSnow         = vec3(0.86, 0.90, 0.95);

    float wTemp = smoothstep(28.0, 42.0, absLat) * (1.0 - smoothstep(52.0, 64.0, absLat));
    float wTaiga = smoothstep(50.0, 62.0, absLat) * (1.0 - smoothstep(64.0, 72.0, absLat));
    float wTundra = smoothstep(61.0, 69.0, absLat);
    float wPolar = smoothstep(68.0, 77.0, absLat);

    // 적색 사토(호주/사하라 일부/고원)와 황토/모래 사막 블렌드
    vec3 aridMix = mix(colSandDesert, colRedSoil, smoothstep(0.45, 0.85, ausArid + detailN * 0.45));
    vec3 landBase = mix(colTropicalSoil, colSteppeClay, smoothstep(10.0, 22.0, absLat) * 0.55);
    landBase = mix(landBase, aridMix, wArid * 0.88);
    landBase = mix(landBase, colTemperate, wTemp * (1.0 - wArid * 0.65));
    landBase = mix(landBase, colTaiga, wTaiga);
    landBase = mix(landBase, colTundra, wTundra);

    // 연안 저지대 사질/충적토
    float coastalSand = (1.0 - smoothstep(0.0, 45.0, hLand)) * (0.25 + 0.35 * wArid);
    landBase = mix(landBase, vec3(0.58, 0.51, 0.37), coastalSand * 0.45);

    // 고원·산맥 암석 노출 (고도 + 경사도 모두 반영)
    float rockT = clamp(max(smoothstep(1250.0, 3400.0, hLand), slopeMag * 0.85), 0.0, 1.0);
    landBase = mix(landBase, colRock, rockT * 0.78);

    // 위도별 설선 및 극지 빙설
    float snowLine = max(1100.0, 4500.0 - absLat * 48.0);
    float snowT = max(wPolar, smoothstep(snowLine, snowLine + 1000.0, hLand) * (1.0 - slopeMag * 0.35));
    landBase = mix(landBase, colSnow, snowT);

    landCol = landBase * (nightAmbient + sunTint * diff * 0.96);

    // 밤 영역 도시 불빛 (어두운 밤 배경 위로 또렷하게)
    if (uNightValid > 0.5 && day < 0.85) {
      float cityQ = texture2D(uNightTex, vec2(eqU, eqV)).r;
      float cityL = cityQ * cityQ;
      float limbVis = smoothstep(0.05, 0.32, nz);
      landCol += vec3(1.0, 0.78, 0.42) * cityL * (1.0 - day) * limbVis * 0.98;
    }
  }

  vec3 col = mix(oceanCol, landCol, landMask);

  // ── 절차적 전지구 구름층 (기후대 순환: ITCZ · 아열대 건조대 · 중위도 편서풍 소용돌이) ──
  if (uMorph >= 0.5) {
    float latDeg = latRad / RAD;
    float drift = uTimeHours * 0.008;
    float cd = cos(drift), sd = sin(drift);
    vec3 cEarth = vec3(nEarth.x * cd + nEarth.z * sd, nEarth.y, -nEarth.x * sd + nEarth.z * cd);
    vec3 swirl = vec3(
      fbm3(cEarth * 2.6 + vec3(1.7, 3.1, 0.9)) - 0.5,
      fbm3(cEarth * 2.6 + vec3(5.2, 0.4, 7.8)) - 0.5,
      fbm3(cEarth * 2.6 + vec3(9.1, 4.7, 2.3)) - 0.5
    );
    vec3 cPos = normalize(cEarth + swirl * 0.34);
    float cMacro = fbm3(cPos * 4.4);
    float cDetail = fbm3(cPos * 12.5 + swirl * 1.4);
    float cRaw = cMacro * 0.66 + cDetail * 0.34;

    // 위도별 대기 순환 가중치 (계절에 따른 적도 수렴대 이동 반영)
    float itczLat = uSunDeclDeg * 0.25;
    float itcz = exp(-pow((latDeg - itczLat) / 8.5, 2.0)) * 0.16;
    float subtropDry = exp(-pow((absLat - 26.5) / 8.0, 2.0)) * 0.14;
    float midStorm = exp(-pow((absLat - 50.0) / 12.5, 2.0)) * 0.13;
    float cCover = clamp(cRaw + itcz + midStorm - subtropDry, 0.0, 1.0);
    float cloudAlpha = smoothstep(0.50, 0.78, cCover) * 0.86 * smoothstep(0.5, 0.95, uMorph);

    if (cloudAlpha > 0.005) {
      // 구름 아래 지표면/바다 음영
      col *= (1.0 - cloudAlpha * 0.34 * day);

      float cloudSunAlt = sunAltDeg + 0.833 + 0.45;
      float cloudDay = smoothstep(-0.6, 2.2, cloudSunAlt);
      float cloudTw = exp(-pow((cloudSunAlt + 0.6) / 2.4, 2.0));
      vec3 cloudDayCol = vec3(0.95, 0.97, 1.0) * (0.35 + 0.65 * max(0.0, ndl));
      vec3 cloudTwCol = vec3(0.98, 0.54, 0.26);
      vec3 cloudNightCol = vec3(0.007, 0.011, 0.022);
      vec3 cloudCol = mix(cloudNightCol, cloudDayCol, cloudDay);
      cloudCol = mix(cloudCol, cloudTwCol, cloudTw * 0.72);
      col = mix(col, cloudCol, cloudAlpha);
    }
  }

  // ── 우주 시점 대기 림 & 야간 산소 대기광(557.7nm Airglow) ──
  float limb = pow(1.0 - nz, 7.0);
  vec3 rayleighRim = vec3(0.28, 0.60, 0.96) * limb * smoothstep(-1.0, 18.0, sunAltDeg) * 0.40;
  vec3 terminatorRim = vec3(0.90, 0.42, 0.16) * limb * twilightBell * 0.14;
  float airglowBand = exp(-pow((nz - 0.075) / 0.045, 2.0)) * smoothstep(-3.0, -14.0, sunAltDeg);
  vec3 airglowRim = vec3(0.16, 0.68, 0.42) * airglowBand * 0.18;
  col += rayleighRim + terminatorRim + airglowRim;

  // 가장자리 안티에일리어싱 (정사영 구일 때만 가장자리 소프트 처리)
  float edgeAa = uMorph >= 0.999 ? smoothstep(0.0, 0.06, nz) : 1.0;
  gl_FragColor = vec4(col, uOpacity * edgeAa);
}
`;

interface Props {
  width: number;
  height: number;
  cx: number;
  cy: number;
  radius: number;
  morph?: number;
  rotate: readonly [number, number] | readonly [number, number, number];
  subsolar: { latitude: number; longitude: number };
  selectedDate?: Date;
  opacity?: number;
  onReadyChange?: (ready: boolean) => void;
}

const smoothstepNum = (e0: number, e1: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

export const EarthGlobeGL: React.FC<Props> = ({
  width,
  height,
  cx,
  cy,
  radius,
  morph = 1,
  rotate,
  subsolar,
  selectedDate,
  opacity = 1,
  onReadyChange,
}) => {
  const glRef = useRef<ExpoWebGLRenderingContext | null>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.OrthographicCamera | null>(null);
  const skySceneRef = useRef<THREE.Scene | null>(null);
  const skyCameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const milkyWayRef = useRef<SpaceMilkyWayHandle | null>(null);
  const starFieldRef = useRef<SpaceStarFieldHandle | null>(null);
  const eqToCamRef = useRef(new THREE.Matrix3());
  const meshRef = useRef<THREE.Mesh | null>(null);
  const matRef = useRef<THREE.ShaderMaterial | null>(null);
  const readyRef = useRef(false);
  const onReadyCbRef = useRef(onReadyChange);
  onReadyCbRef.current = onReadyChange;

  const propsRef = useRef({ width, height, cx, cy, radius, morph, rotate, subsolar, selectedDate, opacity });
  propsRef.current = { width, height, cx, cy, radius, morph, rotate, subsolar, selectedDate, opacity };

  const renderNow = () => {
    const gl = glRef.current;
    const r = rendererRef.current;
    const s = sceneRef.current;
    const c = cameraRef.current;
    const mesh = meshRef.current;
    const m = matRef.current;
    if (!gl || !r || !s || !c || !mesh || !m) return;
    const p = propsRef.current;

    r.setPixelRatio(1);
    r.setSize(gl.drawingBufferWidth, gl.drawingBufferHeight, false);
    r.setViewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    c.left = -p.width / 2;
    c.right = p.width / 2;
    c.top = p.height / 2;
    c.bottom = -p.height / 2;
    c.near = 0.1;
    c.far = Math.max(100, p.radius * 8);
    c.position.set(0, 0, Math.max(10, p.radius * 4));
    c.updateProjectionMatrix();

    const RAD = Math.PI / 180;
    const r0 = p.rotate[0];
    const r1 = p.rotate[1];
    const r2 = p.rotate[2] ?? 0;

    // d3.geoOrthographic().rotate([r0, r1, r2]) 와 1:1 일치하는 ZXY 오일러 회전
    mesh.position.set(p.cx - p.width / 2, p.height / 2 - p.cy, 0);
    mesh.scale.setScalar(Math.max(1, p.radius));
    mesh.rotation.order = 'ZXY';
    mesh.rotation.set(-r1 * RAD, r0 * RAD, r2 * RAD);

    const camDirOf = (latDeg: number, lonDeg: number) => {
      const dLon = (lonDeg + r0) * RAD;
      const sLat = latDeg * RAD;
      const cLat = -r1 * RAD;
      const sx = Math.cos(sLat) * Math.sin(dLon);
      const sy0 = Math.cos(cLat) * Math.sin(sLat) - Math.sin(cLat) * Math.cos(sLat) * Math.cos(dLon);
      const sz = Math.sin(cLat) * Math.sin(sLat) + Math.cos(cLat) * Math.cos(sLat) * Math.cos(dLon);
      const roll = r2 * RAD;
      const cr = Math.cos(roll);
      const sr = Math.sin(roll);
      return [sx * cr - sy0 * sr, sx * sr + sy0 * cr, sz] as const;
    };
    const [sunCamX, sunCamY, sunCamZ] = camDirOf(p.subsolar.latitude, p.subsolar.longitude);
    const curDate = p.selectedDate ?? new Date();

    m.uniforms.uMorph.value = p.morph;
    (m.uniforms.uSizePx.value as THREE.Vector2).set(p.width, p.height);
    (m.uniforms.uCenterPx.value as THREE.Vector2).set(p.cx, p.cy);
    m.uniforms.uRadiusPx.value = p.radius;
    (m.uniforms.uRotateDeg.value as THREE.Vector3).set(r0, r1, r2);
    (m.uniforms.uSunDir.value as THREE.Vector3).set(sunCamX, sunCamY, sunCamZ).normalize();
    m.uniforms.uOpacity.value = p.opacity;
    m.uniforms.uSunDeclDeg.value = p.subsolar.latitude;
    m.uniforms.uTimeHours.value = (curDate.getTime() / 3600000) % 2400;

    r.setClearColor(0x000000, 0);
    r.clear(true, true, false);

    // Pass 1: 심우주 배경 (은하수 + 6.5등급 별 + 5대 행성 + 카메라 동적 노출)
    const skyOpacity = p.morph >= 0.9 ? Math.min(1, (p.morph - 0.9) / 0.1) * p.opacity : 0;
    const skyScene = skySceneRef.current;
    const skyCam = skyCameraRef.current;
    const mw = milkyWayRef.current;
    const sf = starFieldRef.current;
    if (skyOpacity > 0.005 && skyScene && skyCam && mw && sf) {
      const f = Math.max(p.width, p.height) * 0.9;
      skyCam.fov = (2 * Math.atan((p.height * 0.5) / Math.max(1, f)) * 180) / Math.PI;
      skyCam.aspect = Math.max(0.1, p.width / Math.max(1, p.height));
      skyCam.updateProjectionMatrix();

      computeEqToCamMatrix(curDate, p.rotate, eqToCamRef.current);
      updateSpacePlanets(sf, curDate);

      // 우주 카메라 동적 노출: 낮 지구 면적 + 시야 내 비차폐 태양에 따라 노출 자동 조절
      const earthFill = Math.max(0.25, Math.min(1.0, p.radius / (Math.min(p.width, p.height) * 0.42)));
      const earthGlare = smoothstepNum(-0.35, 0.55, sunCamZ) * earthFill;
      let sunInView = 0;
      if (sunCamZ < -0.05) {
        const sunSx = p.cx + (sunCamX / -sunCamZ) * f;
        const sunSy = p.cy - (sunCamY / -sunCamZ) * f;
        const inFrame = sunSx >= -40 && sunSx <= p.width + 40 && sunSy >= -40 && sunSy <= p.height + 40;
        const unoccluded = Math.hypot(sunSx - p.cx, sunSy - p.cy) > p.radius * 0.96;
        if (inFrame && unoccluded) sunInView = 1;
      }
      const totalLight = Math.min(1, earthGlare * 0.72 + sunInView * 0.85);
      const exposure = 1.25 * (1 - totalLight) + 0.28 * totalLight;
      const dpr = Math.max(1, gl.drawingBufferWidth / Math.max(1, p.width));

      (mw.material.uniforms.uEqToCam.value as THREE.Matrix3).copy(eqToCamRef.current);
      mw.material.uniforms.uExposure.value = exposure;
      mw.material.uniforms.uOpacity.value = skyOpacity;
      (mw.material.uniforms.uSunCamDir.value as THREE.Vector3).set(sunCamX, sunCamY, sunCamZ).normalize();
      mw.material.uniforms.uSunVisible.value = sunInView;

      (sf.material.uniforms.uEqToCam.value as THREE.Matrix3).copy(eqToCamRef.current);
      sf.material.uniforms.uExposure.value = exposure;
      sf.material.uniforms.uOpacity.value = skyOpacity;
      sf.material.uniforms.uPixelRatio.value = dpr;
      (sf.material.uniforms.uSunCamDir.value as THREE.Vector3).set(sunCamX, sunCamY, sunCamZ).normalize();
      sf.material.uniforms.uSunVisible.value = sunInView;

      r.render(skyScene, skyCam);
    }

    // Pass 2: 3D 지구본 (심우주 배경을 깊이 버퍼 초기화 후 정확히 가림)
    r.clearDepth();
    r.render(s, c);
    gl.endFrameEXP();
  };

  useEffect(() => {
    renderNow();
  });

  useEffect(() => () => {
    readyRef.current = false;
    onReadyCbRef.current?.(false);
    milkyWayRef.current?.dispose();
    starFieldRef.current?.dispose();
    matRef.current?.dispose();
    rendererRef.current?.dispose();
    glRef.current = null;
    rendererRef.current = null;
    sceneRef.current = null;
    cameraRef.current = null;
    skySceneRef.current = null;
    skyCameraRef.current = null;
    milkyWayRef.current = null;
    starFieldRef.current = null;
    meshRef.current = null;
    matRef.current = null;
  }, []);

  const onContextCreate = async (gl: ExpoWebGLRenderingContext) => {
    glRef.current = gl;
    const p = propsRef.current;
    const renderer = new Renderer({ gl });
    renderer.autoClear = false;
    renderer.setPixelRatio(1);
    renderer.setSize(gl.drawingBufferWidth, gl.drawingBufferHeight, false);
    renderer.setClearColor(0x000000, 0);

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(
      -p.width / 2,
      p.width / 2,
      p.height / 2,
      -p.height / 2,
      0.1,
      Math.max(100, p.radius * 8),
    );
    camera.position.set(0, 0, Math.max(10, p.radius * 4));

    const skyScene = new THREE.Scene();
    const fInit = Math.max(p.width, p.height) * 0.9;
    const skyCamera = new THREE.PerspectiveCamera(
      (2 * Math.atan((p.height * 0.5) / Math.max(1, fInit)) * 180) / Math.PI,
      Math.max(0.1, p.width / Math.max(1, p.height)),
      1,
      1000,
    );
    const mw = createSpaceMilkyWay();
    const sf = createSpaceStarField(8);
    skyScene.add(mw.mesh);
    skyScene.add(sf.points);
    skySceneRef.current = skyScene;
    skyCameraRef.current = skyCamera;
    milkyWayRef.current = mw;
    starFieldRef.current = sf;

    const mat = new THREE.ShaderMaterial({
      vertexShader: EARTH_VERT,
      fragmentShader: EARTH_FRAG,
      transparent: true,
      depthTest: true,
      depthWrite: true,
      uniforms: {
        uMorph: { value: p.morph },
        uSizePx: { value: new THREE.Vector2(p.width, p.height) },
        uCenterPx: { value: new THREE.Vector2(p.cx, p.cy) },
        uRadiusPx: { value: p.radius },
        uRotateDeg: { value: new THREE.Vector3(p.rotate[0], p.rotate[1], p.rotate[2] ?? 0) },
        uSunDir: { value: new THREE.Vector3(0.4, 0.2, 0.85) },
        uDemTex: { value: null },
        uDemValid: { value: 0 },
        uLandTex: { value: null },
        uLandValid: { value: 0 },
        uNightTex: { value: null },
        uNightValid: { value: 0 },
        uOpacity: { value: p.opacity },
        uSunDeclDeg: { value: p.subsolar.latitude },
        uTimeHours: { value: ((p.selectedDate ?? new Date()).getTime() / 3600000) % 2400 },
      },
    });

    rendererRef.current = renderer;
    sceneRef.current = scene;
    cameraRef.current = camera;
    matRef.current = mat;

    const dem = getBaseDemSync();
    const lm = getLandMaskSync();
    if (dem && matRef.current === mat) {
      const geo = getEarthTerrainGeometry(dem, lm);
      const mesh = new THREE.Mesh(geo, mat);
      scene.add(mesh);
      meshRef.current = mesh;

      const tex = new THREE.DataTexture(dem.rgba, dem.w, dem.h, THREE.RGBAFormat);
      tex.colorSpace = THREE.NoColorSpace;
      tex.minFilter = THREE.NearestFilter;
      tex.magFilter = THREE.NearestFilter;
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.needsUpdate = true;
      mat.uniforms.uDemTex.value = tex;
      mat.uniforms.uDemValid.value = 1;

      if (lm) {
        const landTex = new THREE.DataTexture(lm.rgba, lm.w, lm.h, THREE.RGBAFormat);
        landTex.colorSpace = THREE.NoColorSpace;
        landTex.minFilter = THREE.LinearFilter;
        landTex.magFilter = THREE.LinearFilter;
        landTex.wrapS = THREE.RepeatWrapping;
        landTex.wrapT = THREE.ClampToEdgeWrapping;
        landTex.needsUpdate = true;
        mat.uniforms.uLandTex.value = landTex;
        mat.uniforms.uLandValid.value = 1;
      }

      readyRef.current = true;
      onReadyCbRef.current?.(true);
      renderNow();
    }

    const nl = getCachedNightLights() ?? (await loadNightLights().catch(() => null));
    if (nl && matRef.current === mat) {
      mat.uniforms.uNightTex.value = buildNightTexture(nl);
      mat.uniforms.uNightValid.value = 1;
      renderNow();
    }
  };

  return (
    <View collapsable={false} pointerEvents="none" style={StyleSheet.absoluteFill}>
      <GLView
        style={StyleSheet.absoluteFill}
        onContextCreate={onContextCreate}
      />
    </View>
  );
};
