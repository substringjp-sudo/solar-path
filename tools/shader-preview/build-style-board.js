/**
 * **스타일 보드** — 같은 날씨 자료를 일곱 가지 양식으로 그린다 (계획 43절).
 *
 * 방향 전환: 사실주의를 쫓다가 계속 벽을 만났습니다(40~42절). 사용자의
 * 새 목표는 "어느 방향을 봤을 때 그 하늘의 어디가 두꺼운 구름·얇은 구름·
 * 태양·대기인지 **느끼고 이해**할 수 있게" — 정확한 사진이 아니라 **읽히는
 * 그림**입니다. 스타일화에서는 우리의 약점(딱딱한 테두리·단순한 형태)이
 * 그대로 양식이 됩니다.
 *
 * 구조: 렌더러가 색이 아니라 **자료**를 내고(uDataOut), 스타일 패스가 그
 * 자료로 제 방식대로 그립니다. 그래서 어느 양식이든 밑에 깔린 물리(위치·
 * 두께·빛)는 같습니다.
 *
 *   rtSky  — 구름 없는 하늘(스카이돔+지형), 표시색
 *   rtLin  — 구름 표시색 + 알파 (미합성)
 *   rtInfo — (광학두께/40, 층, 태양비, 알파)
 *
 * 양식 일곱: 셀(지브리) · 픽셀아트 · 수채 · 육각 모자이크 · 뭉실 장난감 ·
 * 목판화 · 블록(복셀 느낌). 첫 줄은 지금 렌더(비교용).
 *
 * 사용: node tools/shader-preview/build-style-board.js
 *       node tools/shader-preview/shoot.js style-board.html style-board.png 120000
 */
const fs = require('fs');
const path = require('path');
const { PREVIEW } = require('./paths');

const TW = 280, TH = 280;
const FOV = 66;

const SCENES = [
  { key: '오후 부분운', sunAlt: 42, sunAz: 210, viewAz: 150, elev: 22,
    low: 38, mid: 12, high: 10, hum: 55, vis: 26000 },
  { key: '뭉게+권운',  sunAlt: 28, sunAz: 230, viewAz: 205, elev: 18,
    low: 45, mid: 10, high: 45, hum: 60, vis: 22000 },
  { key: '노을',       sunAlt: 1,  sunAz: 272, viewAz: 268, elev: 9,
    low: 30, mid: 25, high: 20, hum: 68, vis: 20000 },
];
const STYLES = [
  { id: -1, name: '지금 렌더 (비교)' },
  { id: 0,  name: '셀 셰이딩 · 지브리풍' },
  { id: 1,  name: '픽셀아트 · 디더' },
  { id: 2,  name: '수채화' },
  { id: 3,  name: '육각 모자이크 (구역 분할)' },
  { id: 4,  name: '뭉실 장난감' },
  { id: 5,  name: '목판화 · 포스터' },
  { id: 6,  name: '블록 · 복셀 느낌' },
];

// ───────────────────────── 스타일 셰이더 ─────────────────────────
const STYLE_FRAG = `
precision highp float;
uniform sampler2D tSky, tLin, tInfo;
uniform int   uStyle;
uniform vec2  uRes;
uniform vec2  uSunUv;      // 태양의 화면 uv (화면 밖이면 -10)
uniform float uSunAlt;
varying vec2 vUv;

const vec3 LW = vec3(0.2126, 0.7152, 0.0722);
float lum(vec3 c){ return dot(c, LW); }
float hash21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p); f = f*f*(3.0 - 2.0*f);
  return mix(mix(hash21(i), hash21(i + vec2(1,0)), f.x),
             mix(hash21(i + vec2(0,1)), hash21(i + vec2(1,1)), f.x), f.y);
}
float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++){ s += a * vnoise(p); p = p * 2.03 + 7.1; a *= 0.5; } return s; }
float bayer4(vec2 px){
  int x = int(mod(px.x, 4.0)), y = int(mod(px.y, 4.0));
  int i = x + y * 4;
  // 4x4 Bayer 행렬 (0..15) / 16
  float m[16];
  m[0]=0.0; m[1]=8.0; m[2]=2.0; m[3]=10.0; m[4]=12.0; m[5]=4.0; m[6]=14.0; m[7]=6.0;
  m[8]=3.0; m[9]=11.0; m[10]=1.0; m[11]=9.0; m[12]=15.0; m[13]=7.0; m[14]=13.0; m[15]=5.0;
  for (int k = 0; k < 16; k++) if (k == i) return (m[k] + 0.5) / 16.0;
  return 0.5;
}

struct Cloud { float a; float tau; float layer; float sun; vec3 col; };
Cloud readCloud(vec2 uv){
  vec4 li = texture2D(tLin, uv);
  vec4 inf = texture2D(tInfo, uv);
  Cloud c; c.a = inf.a; c.tau = inf.r * 40.0; c.layer = inf.g; c.sun = inf.b; c.col = li.rgb;
  return c;
}
/** 구름 표시색에서 색조만 뽑기 (노을 착색을 양식에 옮길 때 씀) */
vec3 tintOf(vec3 c){ float m = max(c.r, max(c.g, c.b)); return m < 1e-3 ? vec3(1.0) : c / m; }
float sunDist(vec2 uv){ vec2 d = (uv - uSunUv) * vec2(uRes.x / uRes.y, 1.0); return length(d); }
float alphaBlur(vec2 uv, float rPx){
  vec2 t = rPx / uRes; float s = 0.0;
  for (int i = -2; i <= 2; i++) for (int j = -2; j <= 2; j++)
    s += texture2D(tInfo, uv + vec2(float(i), float(j)) * t).a;
  return s / 25.0;
}

// ── 0 셀 셰이딩 ──
vec3 styleCel(vec2 uv){
  vec3 sky = texture2D(tSky, uv).rgb;
  Cloud c = readCloud(uv);
  float sil = smoothstep(0.30, 0.42, c.a);
  float thin = (1.0 - smoothstep(0.6, 1.8, c.tau)) * c.a * (1.0 - sil);
  float shade = clamp(0.6 * c.sun + 0.4 * lum(c.col), 0.0, 1.0);
  float band = shade > 0.60 ? 1.0 : (shade > 0.34 ? 0.5 : 0.0);
  vec3 tint = tintOf(c.col);
  vec3 hi  = mix(vec3(1.0), sky, 0.08) * mix(vec3(1.0), tint, 0.65);
  vec3 mid = mix(vec3(0.80, 0.83, 0.88), sky, 0.25) * mix(vec3(1.0), tint, 0.45);
  vec3 lo  = mix(vec3(0.50, 0.54, 0.64), sky, 0.45);
  vec3 tone = band > 0.75 ? hi : (band > 0.25 ? mid : lo);
  // 두꺼운 밑면은 한 단 더 어둡게 — "두껍다"가 읽히는 곳
  tone *= mix(1.0, 0.70, smoothstep(6.0, 18.0, c.tau) * (1.0 - band));
  float ga = length(vec2(dFdx(c.a), dFdy(c.a)));
  float outline = smoothstep(0.05, 0.16, ga) * sil;
  vec3 col = mix(sky, tone, sil);
  col = mix(col, mix(sky, vec3(1.0), 0.55), thin * 0.6);
  col = mix(col, tone * 0.5, outline * 0.55);
  if (uSunAlt > -0.8) {
    float d = sunDist(uv);
    vec3 sunCol = mix(vec3(1.0, 0.97, 0.85), vec3(1.0, 0.55, 0.25), smoothstep(12.0, 0.0, uSunAlt));
    col = mix(col, sunCol, smoothstep(0.036, 0.030, d));
    col += sunCol * 0.25 * exp(-d * 14.0) * (1.0 - sil);
  }
  return col;
}

// ── 1 픽셀아트 ──
vec3 stylePixel(vec2 uv){
  float px = 4.0;
  vec2 cell = floor(uv * uRes / px);
  vec2 q = (cell + 0.5) * px / uRes;
  vec3 sky = texture2D(tSky, q).rgb;
  Cloud c = readCloud(q);
  vec3 tint = tintOf(c.col);
  vec3 hi = vec3(0.98) * mix(vec3(1.0), tint, 0.6);
  vec3 lo = mix(vec3(0.62, 0.66, 0.78), sky, 0.3);
  vec3 tone = mix(lo, hi, step(0.5, c.sun + 0.15 * (1.0 - smoothstep(3.0, 10.0, c.tau))));
  float on = step(0.42, c.a);
  vec3 col = mix(sky, tone, on);
  if (uSunAlt > -0.8) {
    float d = sunDist(q);
    col = mix(col, vec3(1.0, 0.85, 0.35), step(d, 0.03) * (1.0 - on));
  }
  // 디더는 **휘도에만** 겁니다. 채널마다 따로 반올림하면 하늘 그라데이션의
  // R·G·B 가 서로 다른 문턱을 넘어 분홍·청록 얼룩이 됩니다(첫 보드).
  float b = bayer4(cell);
  float L = lum(col);
  float Lq = (floor(L * 6.0 + b) + 0.5) / 6.0;
  col *= Lq / max(L, 1e-3);
  // 채도도 3단으로 — 팔레트 느낌
  float mx = max(col.r, max(col.g, col.b)), mn = min(col.r, min(col.g, col.b));
  float sat = mx < 1e-3 ? 0.0 : (mx - mn) / mx;
  float satQ = floor(sat * 3.0 + 0.5) / 3.0;
  col = mix(vec3(lum(col)), col, sat < 1e-3 ? 0.0 : satQ / sat);
  return clamp(col, 0.0, 1.0);
}

// ── 2 수채화 ──
vec3 styleWater(vec2 uv){
  vec3 sky = texture2D(tSky, uv).rgb;
  // 약간 번진 자료 (젖은 종이)
  vec2 wob = (vec2(fbm(uv * 9.0), fbm(uv * 9.0 + 31.7)) - 0.5) * 0.012;
  Cloud c = readCloud(uv + wob);
  float ab = alphaBlur(uv + wob, 2.2);
  float dens = (1.0 - exp(-c.tau * 0.30)) * smoothstep(0.04, 0.40, ab);
  // 가장자리 안료 고임(edge darkening): 경계 띠에서 밀도를 더합니다.
  // 미분으로 하면 픽셀 계단이 그대로 드러나므로 블러 알파의 띠로 만듭니다.
  float edge = smoothstep(0.12, 0.42, ab) * (1.0 - smoothstep(0.42, 0.78, ab));
  dens = clamp(dens + edge * 0.35, 0.0, 1.0);
  vec3 tint = tintOf(c.col);
  vec3 pig = mix(vec3(0.40, 0.46, 0.60), vec3(0.72, 0.58, 0.62), c.sun) * mix(vec3(1.0), tint, 0.5);
  dens *= 1.0 - c.sun * 0.55;                             // 햇빛 받는 곳은 종이가 비침
  float gran = 0.80 + 0.20 * fbm(gl_FragCoord.xy * 0.07);
  float paper = 0.93 + 0.07 * vnoise(gl_FragCoord.xy * 0.33);
  vec3 washSky = mix(vec3(0.98, 0.97, 0.94), sky, 0.82) * (0.94 + 0.06 * fbm(uv * 5.0));
  vec3 col = washSky * (1.0 - dens * gran) + pig * dens * gran;
  if (uSunAlt > -0.8) {
    float d = sunDist(uv);
    vec3 sunCol = mix(vec3(1.0, 0.95, 0.80), vec3(1.0, 0.60, 0.35), smoothstep(12.0, 0.0, uSunAlt));
    col = mix(col, sunCol, 0.85 * exp(-d * 22.0));
  }
  return col * paper;
}

// ── 3 육각 모자이크 ──
vec2 hexCenter(vec2 p){
  const vec2 s = vec2(1.0, 1.7320508);
  vec4 hC = floor(vec4(p, p - vec2(0.5, 1.0)) / s.xyxy) + 0.5;
  vec4 h = vec4(p - hC.xy * s, p - (hC.zw + 0.5) * s);
  return dot(h.xy, h.xy) < dot(h.zw, h.zw) ? hC.xy * s : (hC.zw + 0.5) * s;
}
float hexDist(vec2 v){ v = abs(v); return max(v.x, v.x * 0.5 + v.y * 0.8660254); }
vec3 styleHex(vec2 uv){
  float sz = 20.0;
  vec2 p = gl_FragCoord.xy / sz;
  vec2 hc = hexCenter(p);
  vec2 cuv = hc * sz / uRes;
  vec3 sky = texture2D(tSky, cuv).rgb;
  Cloud c = readCloud(cuv);
  vec3 tint = tintOf(c.col);
  // 셀 채움: 운량 → 채움 여부, 두께 → 밝기 3단, 태양비 → 따뜻함
  float on = smoothstep(0.22, 0.40, c.a);
  float thick = c.tau < 1.5 ? 0.0 : (c.tau < 6.0 ? 0.5 : 1.0);
  vec3 cloud = mix(vec3(0.97), vec3(0.55, 0.58, 0.66), thick) * mix(vec3(1.0), tint, 0.5);
  cloud = mix(cloud, cloud * vec3(1.05, 0.98, 0.92), c.sun * 0.6);
  vec3 fill = mix(sky, cloud, on);
  float d = hexDist(p - hc);
  float edge = smoothstep(0.50, 0.44, d);
  vec3 col = mix(fill * 0.86, fill, edge);
  if (uSunAlt > -0.8) {
    float ds = sunDist(cuv);
    col = mix(col, vec3(1.0, 0.86, 0.45), step(ds, 0.045) * (1.0 - on));
    col = mix(col, vec3(1.0, 0.92, 0.7), 0.35 * step(ds, 0.10) * (1.0 - on) * edge);
  }
  return col;
}

// ── 4 뭉실 장난감 ──
vec3 styleToy(vec2 uv){
  vec3 sky = texture2D(tSky, uv).rgb;
  sky = mix(sky, vec3(0.72, 0.84, 1.0), 0.28);              // 파스텔
  float ab = alphaBlur(uv, 2.6);
  float sil = smoothstep(0.40, 0.52, ab);
  vec2 e = 3.0 / uRes;
  float gx = alphaBlur(uv + vec2(e.x, 0.0), 2.6) - alphaBlur(uv - vec2(e.x, 0.0), 2.6);
  float gy = alphaBlur(uv + vec2(0.0, e.y), 2.6) - alphaBlur(uv - vec2(0.0, e.y), 2.6);
  vec3 n = normalize(vec3(-gx * 6.0, -gy * 6.0, 1.0));
  vec2 toSun = (uSunUv - uv) * vec2(uRes.x / uRes.y, 1.0);
  vec3 L = normalize(vec3(clamp(toSun, -1.0, 1.0), 0.75));
  float nd = 0.5 + 0.5 * dot(n, L);
  Cloud c = readCloud(uv);
  vec3 tint = tintOf(c.col);
  vec3 base = vec3(1.0, 0.99, 0.97) * mix(vec3(1.0), tint, 0.5);
  vec3 shadow = vec3(0.70, 0.72, 0.88);
  vec3 tone = mix(shadow, base, smoothstep(0.30, 0.85, nd));
  tone *= mix(1.0, 0.85, smoothstep(6.0, 16.0, c.tau) * (1.0 - nd));   // 두꺼운 밑면
  float rim = smoothstep(0.62, 0.50, ab) * sil;
  tone += rim * 0.18;
  vec3 col = mix(sky, tone, sil);
  if (uSunAlt > -0.8) {
    float d = sunDist(uv);
    vec3 sunCol = vec3(1.0, 0.88, 0.55);
    col = mix(col, sunCol, smoothstep(0.06, 0.05, d) * (1.0 - sil));
    col += sunCol * 0.2 * exp(-d * 10.0) * (1.0 - sil);
  }
  return col;
}

// ── 5 목판화 · 포스터 ──
vec3 styleWood(vec2 uv){
  vec3 sky = texture2D(tSky, uv).rgb;
  float Ls = lum(sky);
  float Lq = (floor(Ls * 5.0 + 0.5 * vnoise(gl_FragCoord.xy * 0.9)) + 0.5) / 5.0;   // bokashi 5단
  vec3 skyQ = sky * (Lq / max(Ls, 1e-3));
  Cloud c = readCloud(uv);
  float sil = step(0.38, c.a);
  vec3 paper = vec3(0.96, 0.93, 0.86);
  vec3 tint = tintOf(c.col);
  vec3 cloud = mix(paper, paper * vec3(0.82, 0.78, 0.76), (1.0 - c.sun) * 0.55) * mix(vec3(1.0), tint, 0.35);
  float hatch = step(0.55, fract((gl_FragCoord.x + gl_FragCoord.y) * 0.11))
              * smoothstep(4.0, 9.0, c.tau) * (1.0 - c.sun * 0.5);
  cloud = mix(cloud, cloud * 0.55, hatch * 0.85);
  float ga = length(vec2(dFdx(c.a), dFdy(c.a)));
  float outline = smoothstep(0.04, 0.13, ga);
  vec3 col = mix(skyQ, cloud, sil);
  col = mix(col, vec3(0.13, 0.11, 0.11), outline * 0.9);
  if (uSunAlt > -0.8) {
    float d = sunDist(uv);
    vec3 sunCol = mix(vec3(0.95, 0.55, 0.30), vec3(0.85, 0.20, 0.15), smoothstep(12.0, 0.0, uSunAlt));
    col = mix(col, sunCol, step(d, 0.042) * (1.0 - sil));
  }
  return col * (0.95 + 0.05 * vnoise(gl_FragCoord.xy * 0.5));
}

// ── 6 블록 · 복셀 느낌 ──
vec3 styleBlock(vec2 uv){
  float bs = 14.0;
  vec2 cell = floor(gl_FragCoord.xy / bs);
  vec2 cuv = (cell + 0.5) * bs / uRes;
  vec3 sky = texture2D(tSky, cuv).rgb;
  float Ls = lum(sky); float Lq = (floor(Ls * 6.0) + 0.5) / 6.0;
  vec3 skyQ = sky * (Lq / max(Ls, 1e-3));
  Cloud c = readCloud(cuv);
  float on = step(0.40, c.a);
  vec3 tint = tintOf(c.col);
  vec3 base = mix(vec3(0.97), vec3(0.62, 0.65, 0.74), smoothstep(3.0, 12.0, c.tau)) * mix(vec3(1.0), tint, 0.5);
  base = mix(base * 0.78, base, c.sun);
  vec2 f = fract(gl_FragCoord.xy / bs);
  float top = step(0.78, f.y);
  float side = step(f.x, 0.20) * (1.0 - top);
  float shade = top > 0.5 ? 1.14 : (side > 0.5 ? 0.72 : 0.94);
  vec3 col = mix(skyQ, base * shade, on);
  float bl = step(0.93, max(f.x, f.y));
  col *= 1.0 - bl * 0.10 * on;
  if (uSunAlt > -0.8) {
    float ds = sunDist(cuv);
    col = mix(col, vec3(1.0, 0.85, 0.40), step(ds, 0.04) * (1.0 - on));
  }
  return col;
}

void main(){
  vec2 uv = vUv;
  vec3 col;
  if (uStyle == 0) col = styleCel(uv);
  else if (uStyle == 1) col = stylePixel(uv);
  else if (uStyle == 2) col = styleWater(uv);
  else if (uStyle == 3) col = styleHex(uv);
  else if (uStyle == 4) col = styleToy(uv);
  else if (uStyle == 5) col = styleWood(uv);
  else col = styleBlock(uv);
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
 body{margin:0;background:#0b0f15;font-family:sans-serif;color:#dde}
 #wrap{position:relative;width:${TW * SCENES.length + 24}px;padding:12px}
 .lbl{position:absolute;color:#fff;font-size:10px;font-family:monospace;
   pointer-events:none;line-height:1.35;background:rgba(6,10,16,.80);
   padding:3px 6px;border-radius:4px}
 h3{font-size:14px;margin:6px 0}
 .sub{font-size:11px;color:#8aa;margin:0 0 10px}
</style></head><body>
<div id="wrap">
<h3>스타일 보드 — 같은 날씨 자료, 일곱 가지 양식</h3>
<p class="sub">가로: ${SCENES.map(s=>s.key).join(' · ')}　·　세로: ${STYLES.map(s=>s.name).join(' / ')}</p>
<canvas id="c"></canvas><div id="labels"></div></div>
<script type="module">
import * as THREE from './app/vendor/three.module.js';
import { createSkydome, updateSkydome } from './app/components/SkyScene3D/Skydome.js';
import { createTerrainRing, createGroundPlane, updateTerrainColors, updateGroundColors,
         setGroundHorizon } from './app/components/SkyScene3D/TerrainRing.js';
import { createCloudSlab, updateCloudSlab, bakeCloudSlabCoverage }
  from './app/components/SkyScene3D/CloudSlab.js';
import { WeatherFan } from './app/utils/skyColumn.js';
import { makeAtmosphereParams, beamAtAltitude, applyTuningUniforms } from './app/utils/atmosphere.js';

const errors=[]; const oe=console.error; console.error=(...a)=>{errors.push(a.join(' ')); oe(...a);};

const TW=${TW}, TH=${TH}, FOV=${FOV};
const SCENES=${JSON.stringify(SCENES)}, STYLES=${JSON.stringify(STYLES)};

const canvas=document.getElementById('c');
canvas.width=TW*SCENES.length; canvas.height=TH*STYLES.length;
const ctx2d=canvas.getContext('2d');
const glCanvas=document.createElement('canvas'); glCanvas.width=TW; glCanvas.height=TH;
const renderer=new THREE.WebGLRenderer({canvas:glCanvas,antialias:false,alpha:false});
renderer.setPixelRatio(1); renderer.setSize(TW,TH,false);
const gl=renderer.getContext();

const scene=new THREE.Scene();
const skydome=createSkydome(); scene.add(skydome.mesh);
const angles=[]; for(let i=0;i<72;i++) angles.push(0.35+0.5*Math.sin(i*0.21)+0.3*Math.sin(i*0.07+1.3));
const terrain=createTerrainRing(angles); scene.add(terrain);
const ground=createGroundPlane(); setGroundHorizon(ground,24); scene.add(ground);
const slab=createCloudSlab(); slab.mesh.renderOrder=10; scene.add(slab.mesh);
const labels=document.getElementById('labels');

const mkRT=()=>new THREE.WebGLRenderTarget(TW,TH,{minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter,
  format:THREE.RGBAFormat,type:THREE.UnsignedByteType,depthBuffer:true});
const rtSky=mkRT(), rtLin=mkRT(), rtInfo=mkRT();

const styleMat=new THREE.ShaderMaterial({
  uniforms:{ tSky:{value:rtSky.texture}, tLin:{value:rtLin.texture}, tInfo:{value:rtInfo.texture},
             uStyle:{value:0}, uRes:{value:new THREE.Vector2(TW,TH)},
             uSunUv:{value:new THREE.Vector2(-10,-10)}, uSunAlt:{value:0} },
  vertexShader:'varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.0,1.0); }',
  fragmentShader:${JSON.stringify(STYLE_FRAG)},
  depthTest:false, depthWrite:false });
const quadScene=new THREE.Scene();
quadScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2), styleMat));
const quadCam=new THREE.OrthographicCamera(-1,1,1,-1,0,1);

const OFFSETS=[-180,-150,-120,-90,-60,-30,0,30,60,90,120,150,180];
const DISTS=[5,12,30,70,160,360];
const jit=(v,d,a,k)=>Math.max(0,Math.min(100, v+16*Math.sin(d*0.031+a*0.017+k)+11*Math.cos(d*0.017-a*0.026+k)));
function bake(s){
  const pts=[{distance:0,azimuthOffset:0,low:s.low,mid:s.mid,high:s.high,humidity:s.hum,precipitation:0,visibility:s.vis}];
  for(const off of OFFSETS) for(const d of DISTS)
    pts.push({distance:d,azimuthOffset:off,low:jit(s.low,d,off,0),mid:jit(s.mid,d,off+40,1),high:jit(s.high,d,off+80,2),
              humidity:s.hum,precipitation:0});
  const fan=new WeatherFan(pts,s.sunAz);
  bakeCloudSlabCoverage(slab,(azDeg,distKm)=>{const {data,confidence}=fan.sample(azDeg,distKm);
    if(!data) return {low:0,mid:0,high:0,confidence:0};
    return {low:data.low/100,mid:data.mid/100,high:data.high/100,confidence:Math.max(0,Math.min(1,confidence))};});
}

function readBack(){
  const buf=new Uint8Array(4*TW*TH);
  gl.readPixels(0,0,TW,TH,gl.RGBA,gl.UNSIGNED_BYTE,buf);
  const out=new Uint8Array(buf.length);
  for(let r=0;r<TH;r++) out.set(buf.subarray((TH-1-r)*TW*4,(TH-r)*TW*4), r*TW*4);
  return out;
}

const savedBlend={blending:slab.material.blending, transparent:slab.material.transparent};

/** 한 장면을 준비하고 자료 세 장을 굽습니다. 반환: 원본 렌더 픽셀. */
function prepare(s){
  const atm=makeAtmosphereParams({latitude:37.5,observerElevM:24,dayOfYear:200,humidityPct:s.hum,visibilityM:s.vis});
  const cam=new THREE.PerspectiveCamera(FOV,TW/TH,0.1,2000);
  cam.position.set(0,0,0); cam.up.set(0,1,0);
  const az=s.viewAz*Math.PI/180, er=s.elev*Math.PI/180;
  cam.lookAt(100*Math.cos(er)*Math.sin(az),100*Math.sin(er),-100*Math.cos(er)*Math.cos(az));
  cam.updateMatrixWorld(true); cam.updateProjectionMatrix();
  const a=s.sunAlt*Math.PI/180, z=s.sunAz*Math.PI/180;
  const sunDir=new THREE.Vector3(Math.cos(a)*Math.sin(z),Math.sin(a),-Math.cos(a)*Math.cos(z)).normalize();
  // 태양 화면 uv
  const sp=sunDir.clone().multiplyScalar(500).project(cam);
  const behind = sunDir.dot(cam.getWorldDirection(new THREE.Vector3())) <= 0;
  styleMat.uniforms.uSunUv.value.set(behind? -10 : sp.x*0.5+0.5, behind? -10 : sp.y*0.5+0.5);
  styleMat.uniforms.uSunAlt.value=s.sunAlt;

  applyTuningUniforms(skydome.mesh.material.uniforms);
  updateSkydome(skydome,s.sunAlt,s.sunAz,atm);
  applyTuningUniforms(skydome.mesh.material.uniforms);
  updateTerrainColors(terrain,s.sunAlt,s.sunAz,atm);
  updateGroundColors(ground,s.sunAlt,s.sunAz,atm);
  const slabArgs={camera:cam,widthPx:TW,heightPx:TH,sunDir,sunAltDeg:s.sunAlt,sunAzDeg:s.sunAz,cityLight:0,
    beamFor:(altKm)=>beamAtAltitude(s.sunAlt,altKm,atm),atmosphere:atm,
    layerWinds:{low:{speedKmh:14,bearingDeg:250},mid:{speedKmh:30,bearingDeg:235},high:{speedKmh:70,bearingDeg:220}},
    driftHours:0,visible:true};

  // (0) 원본 렌더
  skydome.mesh.visible=true; terrain.visible=true; ground.visible=true; slab.mesh.visible=true;
  slab.material.blending=savedBlend.blending; slab.material.transparent=savedBlend.transparent;
  updateCloudSlab(slab,{...slabArgs, dataOut:0}); applyTuningUniforms(slab.mesh.material.uniforms);
  renderer.setRenderTarget(null); renderer.setClearColor(0x000000,1); renderer.render(scene,cam);
  const original=readBack();

  // (1) 하늘만
  slab.mesh.visible=false;
  renderer.setRenderTarget(rtSky); renderer.setClearColor(0x000000,1); renderer.clear(); renderer.render(scene,cam);

  // (2)(3) 구름 자료
  skydome.mesh.visible=false; terrain.visible=false; ground.visible=false; slab.mesh.visible=true;
  slab.material.blending=THREE.NoBlending; slab.material.transparent=false;
  slab.material.uniforms.uDataOut.value=1;
  renderer.setRenderTarget(rtLin); renderer.setClearColor(0x000000,0); renderer.clear(); renderer.render(scene,cam);
  slab.material.uniforms.uDataOut.value=2;
  renderer.setRenderTarget(rtInfo); renderer.setClearColor(0x000000,0); renderer.clear(); renderer.render(scene,cam);
  slab.material.uniforms.uDataOut.value=0;
  slab.material.blending=savedBlend.blending; slab.material.transparent=savedBlend.transparent;
  skydome.mesh.visible=true; terrain.visible=true; ground.visible=true;
  renderer.setRenderTarget(null);
  return original;
}

function shootStyle(id){
  styleMat.uniforms.uStyle.value=id;
  renderer.setRenderTarget(null); renderer.setClearColor(0x000000,1); renderer.render(quadScene,quadCam);
  return readBack();
}

SCENES.forEach((s,col)=>{
  bake(s);
  const original=prepare(s);
  STYLES.forEach((st,row)=>{
    const img = st.id<0 ? original : shootStyle(st.id);
    const im=ctx2d.createImageData(TW,TH); im.data.set(img); ctx2d.putImageData(im,col*TW,row*TH);
    const d=document.createElement('div'); d.className='lbl';
    d.style.left=(canvas.offsetLeft+col*TW+6)+'px'; d.style.top=(canvas.offsetTop+row*TH+6)+'px';
    d.innerHTML=st.name+' · '+s.key;
    labels.appendChild(d);
  });
});

window.__stats={glError:gl.getError()};
window.__errors=errors;
document.title='DONE::'+(errors.length?'SHADER_ERR':'OK')+'::'+gl.getError();
</script></body></html>`;

fs.mkdirSync(PREVIEW, { recursive: true });
fs.writeFileSync(path.join(PREVIEW, 'style-board.html'), html);
console.log('생성 완료: style-board.html');
