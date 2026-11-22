/**
 * EarthGlobeGL.tsx — 우주 모드 지구본의 3D 텍스처 구면 레이어.
 *
 * 번들된 전 지구 고도·해저 수심(assets/dem/base_terrarium_z0.png)과
 * NASA 밤 불빛 지도(assets/nightlights/lights_01deg.png)를 `d3.geoOrthographic` 과
 * 1:1 일치하는 정사영 구면 레이트레이싱 셰이더로 렌더링합니다.
 */
import React, { useEffect, useRef } from 'react';
import { Image, StyleSheet } from 'react-native';
import { GLView, type ExpoWebGLRenderingContext } from 'expo-gl';
import * as THREE from 'three';
import * as FileSystem from 'expo-file-system';
import { unzlibSync } from 'fflate';
import { BASE_DEM_ASSET } from '../../utils/demTileCache';
import { getCachedNightLights, loadNightLights } from '../../utils/nightLightsAsset';
import type { NightLights } from '../../utils/cityLightMap';

interface DecodedRgb {
  w: number;
  h: number;
  rgba: Uint8Array;
}

let cachedDem: DecodedRgb | null = null;
let demPromise: Promise<DecodedRgb | null> | null = null;

function decodePngToRgba(bytes: Uint8Array): DecodedRgb {
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

async function loadBaseDemRgba(): Promise<DecodedRgb | null> {
  if (cachedDem) return cachedDem;
  if (demPromise) return demPromise;
  demPromise = (async () => {
    try {
      const source = Image.resolveAssetSource(BASE_DEM_ASSET);
      const uri = source?.uri;
      if (!uri) return null;
      let bytes: Uint8Array;
      if (uri.startsWith('file://') || uri.startsWith('/')) {
        const b64 = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' as any });
        const bin = atob(b64);
        bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      } else {
        const res = await fetch(uri);
        bytes = new Uint8Array(await res.arrayBuffer());
      }
      cachedDem = decodePngToRgba(bytes);
      return cachedDem;
    } catch {
      return null;
    }
  })();
  return demPromise;
}

function buildNightTexture(m: NightLights): THREE.DataTexture {
  // 3600×1800 -> 900×450 4배 다운샘플로 GPU 업로드 최적화
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
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const EARTH_FRAG = /* glsl */ `
precision highp float;

varying vec2 vUv;

uniform vec2 uSize;
uniform vec2 uCenter;
uniform float uRadius;
uniform vec3 uRotateDeg;
uniform vec3 uSunDir;
uniform sampler2D uDemTex;
uniform float uDemValid;
uniform sampler2D uNightTex;
uniform float uNightValid;
uniform float uOpacity;

const float PI = 3.14159265359;
const float RAD = 0.01745329252;

float decodeTerrarium(vec3 rgb) {
  vec3 c = rgb * 255.0;
  return (c.r * 256.0 + c.g + c.b / 256.0) - 32768.0;
}

float sampleElevAt(float lonRad, float latRad) {
  if (uDemValid < 0.5) return 0.0;
  float u = fract(lonRad / (2.0 * PI) + 0.5);
  float latC = clamp(latRad, -1.48442, 1.48442);
  float v = clamp(0.5 - log(tan(PI * 0.25 + latC * 0.5)) / (2.0 * PI), 0.0, 0.996);

  // 256×256 텍스처에서 RGB 채널 보간 아티팩트를 막기 위해 직접 4-tap 쌍선형 디코딩
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
  return mix(mix(h00, h10, f.x), mix(h01, h11, f.x), f.y);
}

void main() {
  if (uOpacity <= 0.01 || uDemValid < 0.5) discard;
  vec2 px = vec2(vUv.x * uSize.x, (1.0 - vUv.y) * uSize.y);
  float nx = (px.x - uCenter.x) / max(1.0, uRadius);
  float ny = -(px.y - uCenter.y) / max(1.0, uRadius);
  float r2 = nx * nx + ny * ny;
  if (r2 > 1.0) discard;
  float nz = sqrt(max(0.0, 1.0 - r2));
  vec3 nCam = vec3(nx, ny, nz);

  // d3.geoOrthographic().rotate([r0, r1, r2]) 역변환
  float roll = -uRotateDeg.z * RAD;
  float cr = cos(roll);
  float sr = sin(roll);
  vec3 nRoll = vec3(nx * cr - ny * sr, nx * sr + ny * cr, nz);

  float lat0 = -uRotateDeg.y * RAD;
  float cl = cos(lat0);
  float sl = sin(lat0);
  vec3 nEarth = vec3(
    nRoll.x,
    nRoll.y * cl + nRoll.z * sl,
    -nRoll.y * sl + nRoll.z * cl
  );

  float latRad = asin(clamp(nEarth.y, -1.0, 1.0));
  float lonRad = -uRotateDeg.x * RAD + atan(nEarth.x, nEarth.z);

  float h = sampleElevAt(lonRad, latRad);
  float ndl = dot(nCam, normalize(uSunDir));
  float day = smoothstep(-0.08, 0.16, ndl);
  float sunLit = 0.06 + 0.94 * max(0.0, ndl);

  vec3 col;
  if (h < 0.0) {
    // ── 바다: 수심별 색(연안 대륙붕 청록 -> 중층 코발트 -> 심해저/해구 남색) ──
    float depth = -h;
    vec3 colShelf = vec3(0.11, 0.56, 0.66);
    vec3 colMid   = vec3(0.05, 0.27, 0.50);
    vec3 colAbyss = vec3(0.015, 0.09, 0.22);
    float tShelf = smoothstep(0.0, 350.0, depth);
    float tAbyss = smoothstep(1400.0, 5200.0, depth);
    vec3 oceanBase = mix(colShelf, colMid, tShelf);
    oceanBase = mix(oceanBase, colAbyss, tAbyss);

    // 태양 반사광(Sun Glint) + 프레넬 림 반사
    vec3 H = normalize(normalize(uSunDir) + vec3(0.0, 0.0, 1.0));
    float spec = pow(max(0.0, dot(nCam, H)), 26.0) * 0.42 * day;
    float fresnel = pow(1.0 - nz, 3.0) * 0.22 * smoothstep(-0.15, 0.35, ndl);
    col = oceanBase * sunLit + vec3(0.88, 0.95, 1.0) * (spec + fresnel);
  } else {
    // ── 육지: 위도 기후대 + 고도 설선 + 실제 고도 차분(∇h) 태양광 지형 음영 ──
    float absLat = abs(latRad) / RAD;
    float dStep = 0.014;
    float hE = sampleElevAt(lonRad + dStep, latRad);
    float hW = sampleElevAt(lonRad - dStep, latRad);
    float hN = sampleElevAt(lonRad, min(1.48, latRad + dStep));
    float hS = sampleElevAt(lonRad, max(-1.48, latRad - dStep));

    // 화면 공간 접선 벡터 근사
    vec3 eastCam = normalize(cross(vec3(0.0, 1.0, 0.0), nCam) + vec3(1e-4, 0.0, 0.0));
    vec3 northCam = normalize(cross(nCam, eastCam));
    float slopeE = clamp((hE - hW) / 2800.0, -1.0, 1.0);
    float slopeN = clamp((hN - hS) / 2800.0, -1.0, 1.0);
    vec3 nRelief = normalize(nCam - eastCam * slopeE * 0.55 - northCam * slopeN * 0.55);
    float reliefLit = 0.08 + 0.92 * max(0.0, dot(nRelief, normalize(uSunDir)));

    // 위도대 기반 자연 토지색 (열대 우림 -> 아열대 건조 -> 온대 -> 타이가 -> 극지 빙설)
    vec3 colTrop = vec3(0.16, 0.36, 0.20);
    vec3 colArid = vec3(0.62, 0.52, 0.36);
    vec3 colTemp = vec3(0.24, 0.42, 0.27);
    vec3 colTaiga = vec3(0.19, 0.30, 0.24);
    vec3 colSnow = vec3(0.85, 0.90, 0.95);

    float wArid = exp(-pow((absLat - 23.0) / 10.5, 2.0));
    float wTemp = smoothstep(26.0, 40.0, absLat) * (1.0 - smoothstep(52.0, 64.0, absLat));
    float wTaiga = smoothstep(50.0, 62.0, absLat);
    float wPolar = smoothstep(66.0, 75.0, absLat);

    vec3 landBase = mix(colTrop, colArid, wArid * 0.78);
    landBase = mix(landBase, colTemp, wTemp);
    landBase = mix(landBase, colTaiga, wTaiga);

    // 고원/산맥 바위톤 및 고산 설선
    float rockT = smoothstep(1400.0, 3800.0, h);
    landBase = mix(landBase, vec3(0.46, 0.43, 0.37), rockT * 0.72);
    float snowLine = max(1200.0, 4400.0 - absLat * 46.0);
    float snowT = max(wPolar, smoothstep(snowLine, snowLine + 1100.0, h));
    landBase = mix(landBase, colSnow, snowT);

    col = landBase * reliefLit;

    // 밤 영역 도시 불빛
    if (uNightValid > 0.5 && day < 0.95) {
      float nu = fract(lonRad / (2.0 * PI) + 0.5);
      float nv = clamp(0.5 - latRad / PI, 0.0, 1.0);
      float cityQ = texture2D(uNightTex, vec2(nu, nv)).r;
      float cityL = cityQ * cityQ;
      col += vec3(1.0, 0.76, 0.38) * cityL * (1.0 - day) * 0.85;
    }
  }

  // 가장자리 안티에일리어싱
  float edgeAa = smoothstep(1.0, 0.992, sqrt(r2));
  gl_FragColor = vec4(col, uOpacity * edgeAa);
}
`;

interface Props {
  width: number;
  height: number;
  cx: number;
  cy: number;
  radius: number;
  rotate: readonly [number, number] | readonly [number, number, number];
  subsolar: { latitude: number; longitude: number };
  opacity?: number;
  onReadyChange?: (ready: boolean) => void;
}

export const EarthGlobeGL: React.FC<Props> = ({
  width,
  height,
  cx,
  cy,
  radius,
  rotate,
  subsolar,
  opacity = 1,
  onReadyChange,
}) => {
  const glRef = useRef<ExpoWebGLRenderingContext | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.OrthographicCamera | null>(null);
  const matRef = useRef<THREE.ShaderMaterial | null>(null);
  const readyRef = useRef(false);
  const onReadyCbRef = useRef(onReadyChange);
  onReadyCbRef.current = onReadyChange;

  const propsRef = useRef({ width, height, cx, cy, radius, rotate, subsolar, opacity });
  propsRef.current = { width, height, cx, cy, radius, rotate, subsolar, opacity };

  const renderNow = () => {
    const gl = glRef.current;
    const r = rendererRef.current;
    const s = sceneRef.current;
    const c = cameraRef.current;
    const m = matRef.current;
    if (!gl || !r || !s || !c || !m) return;
    const p = propsRef.current;
    const dpr = Math.max(1, gl.drawingBufferWidth / Math.max(1, p.width));
    if (Math.abs(gl.drawingBufferWidth - p.width * dpr) > 2) {
      r.setSize(p.width, p.height, false);
    }
    const RAD = Math.PI / 180;
    const dLon = (p.subsolar.longitude + p.rotate[0]) * RAD;
    const sLat = p.subsolar.latitude * RAD;
    const cLat = -p.rotate[1] * RAD;
    const sx = Math.cos(sLat) * Math.sin(dLon);
    const sy0 = Math.cos(cLat) * Math.sin(sLat) - Math.sin(cLat) * Math.cos(sLat) * Math.cos(dLon);
    const sz = Math.sin(cLat) * Math.sin(sLat) + Math.cos(cLat) * Math.cos(sLat) * Math.cos(dLon);
    const roll = (p.rotate[2] ?? 0) * RAD;
    const cr = Math.cos(roll);
    const sr = Math.sin(roll);
    const sunCamX = sx * cr - sy0 * sr;
    const sunCamY = sx * sr + sy0 * cr;

    (m.uniforms.uSize.value as THREE.Vector2).set(p.width, p.height);
    (m.uniforms.uCenter.value as THREE.Vector2).set(p.cx, p.cy);
    m.uniforms.uRadius.value = p.radius;
    (m.uniforms.uRotateDeg.value as THREE.Vector3).set(p.rotate[0], p.rotate[1], p.rotate[2] ?? 0);
    (m.uniforms.uSunDir.value as THREE.Vector3).set(sunCamX, sunCamY, sz).normalize();
    m.uniforms.uOpacity.value = p.opacity;

    r.render(s, c);
    gl.endFrameEXP();
  };

  useEffect(() => {
    renderNow();
  });

  useEffect(() => () => {
    readyRef.current = false;
    onReadyCbRef.current?.(false);
    matRef.current?.dispose();
    rendererRef.current?.dispose();
    glRef.current = null;
    rendererRef.current = null;
    sceneRef.current = null;
    cameraRef.current = null;
    matRef.current = null;
  }, []);

  const onContextCreate = async (gl: ExpoWebGLRenderingContext) => {
    glRef.current = gl;
    const p = propsRef.current;
    const renderer = new THREE.WebGLRenderer({
      canvas: {
        width: gl.drawingBufferWidth,
        height: gl.drawingBufferHeight,
        style: {},
        addEventListener: () => {},
        removeEventListener: () => {},
        clientHeight: gl.drawingBufferHeight,
      } as any,
      context: gl as any,
      alpha: true,
      antialias: true,
    });
    renderer.setSize(gl.drawingBufferWidth, gl.drawingBufferHeight, false);
    renderer.setClearColor(0x000000, 0);

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const mat = new THREE.ShaderMaterial({
      vertexShader: EARTH_VERT,
      fragmentShader: EARTH_FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uSize: { value: new THREE.Vector2(p.width, p.height) },
        uCenter: { value: new THREE.Vector2(p.cx, p.cy) },
        uRadius: { value: p.radius },
        uRotateDeg: { value: new THREE.Vector3(p.rotate[0], p.rotate[1], p.rotate[2] ?? 0) },
        uSunDir: { value: new THREE.Vector3(0.4, 0.2, 0.85) },
        uDemTex: { value: null },
        uDemValid: { value: 0 },
        uNightTex: { value: null },
        uNightValid: { value: 0 },
        uOpacity: { value: p.opacity },
      },
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    scene.add(quad);

    rendererRef.current = renderer;
    sceneRef.current = scene;
    cameraRef.current = camera;
    matRef.current = mat;

    const dem = await loadBaseDemRgba();
    if (dem && matRef.current === mat) {
      const tex = new THREE.DataTexture(dem.rgba, dem.w, dem.h, THREE.RGBAFormat);
      tex.colorSpace = THREE.NoColorSpace;
      tex.minFilter = THREE.NearestFilter;
      tex.magFilter = THREE.NearestFilter;
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.needsUpdate = true;
      mat.uniforms.uDemTex.value = tex;
      mat.uniforms.uDemValid.value = 1;
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
    <GLView
      pointerEvents="none"
      style={StyleSheet.absoluteFill}
      onContextCreate={onContextCreate}
    />
  );
};
