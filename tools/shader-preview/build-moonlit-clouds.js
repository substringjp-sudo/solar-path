/**
 * **달빛 구름** (§92) — 밤 구름이 달빛을 햇빛과 같은 물리로 받는가.
 *
 * 사용자 화면(2026-09-25 21:37, 요네자와, 달 98%·고도 47°)에서 얇은 상층운이
 * 대낮 하늘처럼 하늘색으로 빛났고, 그 틈은 새까맸습니다. 구름의 달빛은 초창기에
 * 박아 둔 상수(보름에 대낮 하늘과 맞먹는 값)였고, 하늘에는 달빛이 아예 없었습니다.
 *
 * ## 자 — 달빛은 햇빛이다
 *
 * 달빛은 햇빛을 되비춘 것이라 **색과 방향 분포가 같고 세기만 다릅니다.** 그러니
 * 달 아래 구름 ÷ 그 뒤 하늘의 비는, **해를 달 자리에 둔 낮**의 같은 비와 같아야
 * 합니다(밤하늘 바닥만큼 조금 낮아질 뿐). 이 비는 달빛의 절대 세기(이득)와 무관해서,
 * 이득을 어떻게 고르든 움직이지 않는 자입니다.
 *
 * 경우 (카메라 방위 150°·고도 32°·세로 60°, 도시광 0):
 *   night   — 해 −44.5°, 달 46.9°/159.6°, 98%   (사용자 화면)
 *   ref     — 해를 달 자리(46.9°/159.6°)에 둔 낮, 달 없음
 *   noMoon  — night 에서 달 조도 0
 *   nightGap / noMoonGap — 얇게 덮은(저·중·상 5·10·30%) 밤, 달 있음/없음 — 틈 밝기용
 *   moonSet — night 에서 달을 −30° 로 (지평선 아래)
 *   twi     — 해 −8°, 달 없음 (밝기 비교용)
 *   day     — 해 30°, 달 40° 떠 있음 / 달 없음 (낮에는 달이 아무것도 안 바꾼다)
 *
 * 출구: 자료 0(표시) · 자료 2(알파) · 자료 3(톤 곡선 전 선형 휘도).
 * 하늘의 선형 휘도는 셰이더의 JS 쌍둥이(skyRadiance + 달 항)로 화소 방향마다 칩니다.
 *
 * 준비: node tools/shader-preview/stage-esm.js
 * 사용: node tools/shader-preview/build-moonlit-clouds.js
 *       node tools/shader-preview/verify-moonlit-clouds.js
 */
const fs = require('fs');
const path = require('path');
const { PREVIEW } = require('./paths');

const W = 200, H = 200, FOV = 60, CAM_AZ = 150, CAM_EL = 32;

const html = `<!doctype html>
<html><head><meta charset="utf-8"></head><body>
<script type="module">
import * as THREE from './app/vendor/three.module.js';
import { createSkydome, updateSkydome } from './app/components/SkyScene3D/Skydome.js';
import { createCloudSlab, updateCloudSlab, bakeCloudSlabCoverage }
  from './app/components/SkyScene3D/CloudSlab.js';
import * as A from './app/utils/atmosphere.js';

const errors = [];
window.addEventListener('error', e => errors.push(String(e.message)));
{ const oe = console.error; console.error = (...a) => { errors.push(a.map(String).join(' ').slice(0, 300)); oe(...a); }; }
try {
const W=${W}, H=${H}, FOV=${FOV}, CAM_AZ=${CAM_AZ}, CAM_EL=${CAM_EL};
const canvas = document.createElement('canvas'); canvas.width=W; canvas.height=H;
const renderer = new THREE.WebGLRenderer({ canvas, antialias:false, alpha:true, premultipliedAlpha:true });
renderer.setPixelRatio(1); renderer.setSize(W,H,false);
const gl = renderer.getContext();
const atmosphere = A.makeAtmosphereParams({ latitude: 37.92, observerElevM: 250, dayOfYear: 268, humidityPct: 75, visibilityM: 25000 });
const D = Math.PI/180;
const dirOf = (alt, az) => new THREE.Vector3(Math.cos(alt*D)*Math.sin(az*D), Math.sin(alt*D), -Math.cos(alt*D)*Math.cos(az*D)).normalize();
// 달 항이 없는 예전 코드에서도 돌아가게(대조용) — 없으면 이득 0.
const moonLightOf = (s, m, f) => (A.moonLight ? A.moonLight(s, m, f, atmosphere) : { gain: 0, useMoon: false });

const cam = new THREE.PerspectiveCamera(FOV, W/H, 0.1, 2000); cam.position.set(0,0,0);
cam.lookAt(100*Math.cos(CAM_EL*D)*Math.sin(CAM_AZ*D), 100*Math.sin(CAM_EL*D), -100*Math.cos(CAM_EL*D)*Math.cos(CAM_AZ*D));
cam.updateMatrixWorld(true);

function shoot({ sunAlt, sunAz, moonAlt, moonAz, moonIllum, cover = [0.2, 0.3, 0.65] }, dataOut, withSky){
  const scene = new THREE.Scene();
  const ml = moonLightOf(sunAlt, moonAlt, moonIllum);
  if (withSky) {
    const sky = createSkydome(); scene.add(sky.mesh);
    updateSkydome(sky, sunAlt, sunAz, atmosphere, 1.0, { altDeg: moonAlt, azDeg: moonAz, gain: ml.gain });
  }
  const slab = createCloudSlab(); slab.mesh.renderOrder = 10; scene.add(slab.mesh);
  bakeCloudSlabCoverage(slab, () => ({ low: cover[0], mid: cover[1], high: cover[2], confidence: 1 }));
  const wd={ speedKmh:20, bearingDeg:250 };
  updateCloudSlab(slab, { camera: cam, widthPx: W, heightPx: H,
    sunDir: dirOf(sunAlt, sunAz), sunAltDeg: sunAlt, sunAzDeg: sunAz,
    moonDir: dirOf(moonAlt, moonAz), moonAltDeg: moonAlt, moonIllum,
    cityLight: 0,
    beamFor:(k)=>A.beamAtAltitude(sunAlt, k, atmosphere), atmosphere,
    layerWinds:{ low:wd, mid:wd, high:wd }, driftHours:0, visible:true, dataOut });
  if (ROD1) scene.traverse(o => { const u = o.material && o.material.uniforms; if (u && u.ADAPT_ROD) u.ADAPT_ROD.value = 1; });
  renderer.setClearColor(0x000000, withSky ? 1 : 0); renderer.render(scene, cam);
  const b=new Uint8Array(4*W*H); gl.readPixels(0,0,W,H,gl.RGBA,gl.UNSIGNED_BYTE,b);
  return b;
}

// 화소 → 세계 방향 (readPixels 는 아래가 0 행)
const ndc = new THREE.Vector3();
function pixelDir(x, y){
  ndc.set((x+0.5)/W*2-1, (y+0.5)/H*2-1, 0.5).unproject(cam);
  return ndc.clone().normalize();
}
const Y = c => 0.2126*c.r + 0.7152*c.g + 0.0722*c.b;
function skyLin(sc, dir){
  const e = Math.asin(Math.max(-1, Math.min(1, dir.y)))/D;
  const g = Math.acos(Math.max(-1, Math.min(1, dir.dot(dirOf(sc.sunAlt, sc.sunAz)))))/D;
  let y = Y(A.skyRadiance(e, g, sc.sunAlt, atmosphere, 0));
  const ml = moonLightOf(sc.sunAlt, sc.moonAlt, sc.moonIllum);
  if (ml.gain > 0) {
    const gm = Math.acos(Math.max(-1, Math.min(1, dir.dot(dirOf(sc.moonAlt, sc.moonAz)))))/D;
    y += ml.gain * Y(A.skyRadiance(e, gm, sc.moonAlt, atmosphere, 0));
  }
  return y;
}
const lin8 = v => { v/=255; return v<=0.04045 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4); };

const NIGHT = { sunAlt: -44.48, sunAz: 317.8, moonAlt: 46.92, moonAz: 159.6, moonIllum: 0.982 };
const SC = {
  night:   NIGHT,
  ref:     { sunAlt: 46.92, sunAz: 159.6, moonAlt: -60, moonAz: 0, moonIllum: 0 },
  noMoon:  { ...NIGHT, moonIllum: 0 },
  // 틈을 재려고 얇게 덮은 밤 — 사용자 화면처럼 구름 사이로 하늘이 보여야 합니다.
  nightGap:  { ...NIGHT, cover: [0.05, 0.1, 0.3] },
  noMoonGap: { ...NIGHT, cover: [0.05, 0.1, 0.3], moonIllum: 0 },
  moonSet: { ...NIGHT, moonAlt: -30 },
  twi:     { sunAlt: -8, sunAz: 290, moonAlt: -60, moonAz: 0, moonIllum: 0 },
  // 닻과 같은 밝기의 박명(해 −10.5°) — 표시가 보름달 밤과 얼마나 같은지 보려고 둡니다.
  twiAnchor: { sunAlt: -10.5, sunAz: 290, moonAlt: -60, moonAz: 0, moonIllum: 0, cover: [0.05, 0.1, 0.3] },
  dayMoon: { sunAlt: 30, sunAz: 200, moonAlt: 40, moonAz: 120, moonIllum: 0.98 },
  dayNo:   { sunAlt: 30, sunAz: 200, moonAlt: 40, moonAz: 120, moonIllum: 0 },
};

// §95 — 밤 암순응(ADAPT_ROD)을 1 로 눌러 찍은 짝. 해 −12° 위는 바이트가 같아야 하고 밤은 달라야 합니다.
let ROD1 = false;
const rodPair = {};
for (const k of ['twi', 'nightGap']) {
  ROD1 = true; const a = shoot(SC[k], 0, true); ROD1 = false; const b = shoot(SC[k], 0, true);
  let d = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
  rodPair[k] = d;
}
window.__rodPair = rodPair;
const R = {};
for (const [k, sc] of Object.entries(SC)) {
  const d0 = shoot(sc, 0, true);
  const d2 = shoot(sc, 2, false);
  const d3 = shoot(sc, 3, false);
  const ratios = [];
  let dispCloud = 0, nC = 0, dispGap = 0, nG = 0, dispAll = 0;
  for (let y=0; y<H; y++) for (let x=0; x<W; x++){
    const i = (y*W+x)*4;
    const dl = 0.2126*lin8(d0[i]) + 0.7152*lin8(d0[i+1]) + 0.0722*lin8(d0[i+2]);
    dispAll += dl;
    const a = d2[i+3]/255;
    if (a > 0.95) {
      const cl = Math.pow(2, d3[i]/255*16 - 12);
      ratios.push(cl / skyLin(sc, pixelDir(x, y)));
      dispCloud += dl; nC++;
    } else if (a < 0.02) { dispGap += dl; nG++; }
  }
  ratios.sort((p,q)=>p-q);
  const q = f => ratios.length ? ratios[Math.floor(f*(ratios.length-1))] : null;
  const ml = moonLightOf(sc.sunAlt, sc.moonAlt, sc.moonIllum);
  R[k] = { 비_중앙: q(0.5), 비_10: q(0.1), 비_90: q(0.9), 구름화소: nC, 틈화소: nG,
    표시_구름: nC ? dispCloud/nC : null, 표시_틈: nG ? dispGap/nG : null, 표시_전체: dispAll/(W*H),
    이득: ml.gain, 달모드: ml.useMoon, 바이트: Array.from(d0) };
}
// 이득의 닻 — 보름달 하늘(달 기준고도) = 해 기준깊이의 박명 하늘 (JS 쪽 정의 확인)
const anchor = A.moonLight ? {
  목표: A.hemiSkyLuminance(A.MOON_SKY_ANCHOR_SUN_DEG, atmosphere),
  달하늘: Y(A.NIGHT_SKY) + A.moonSkyGain(atmosphere) * A.hemiSkyLuminance(A.MOON_REF_ALT_DEG, atmosphere),
  K: A.moonSkyGain(atmosphere),
} : null;
window.__stats = { glError: gl.getError(), R, anchor, rodPair };
} catch (e) { errors.push('예외: ' + (e && e.stack || e)); }
window.__errors = errors;
document.title = 'DONE::' + (errors.length ? 'ERR' : 'OK');
</script></body></html>`;

fs.mkdirSync(PREVIEW, { recursive: true });
fs.writeFileSync(path.join(PREVIEW, 'moonlit-clouds.html'), html);
console.log('생성 완료: moonlit-clouds.html');
