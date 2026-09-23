/**
 * **운해** — 관측자가 저층운 위에 서 있으면 아래를 볼 때 구름 바닥이 보이는가.
 *
 * 실기 요청: "해발 1600m 산 위에서 아래를 내려다보면 낮은 구름이 깔려 있는데
 * 그런 걸 구현할 수 있을까?"
 *
 * 예전 셰이더는 관측자를 해발 0 에 박아 두고 지평선 아래를 통째로 버렸습니다.
 * 그래서 1,600m 에서 1,200m 구름 위에 있어도 그 구름을 **머리 위에** 그렸습니다.
 *
 * ## 자 — 광학두께 출구(dataOut 2)
 *
 * `layer-elev` 과 같습니다. R = min(τ,40)/40 이라 조명과 무관합니다. 하늘돔은
 * 장면에 넣지 않습니다(구름 없는 화소가 하늘의 빨강을 τ 로 읽음).
 *
 * ## 경우
 *
 *   관측자 0m     · 저층 1.2km  — 예전과 같아야 함: 아래 0, 위에 구름
 *   관측자 1600m  · 저층 1.2km  — 운해: 아래에 구름, 위에 없음
 *   관측자 1600m  · 저층 2.5km  — 층이 머리 위: 아래 0, 위에 구름
 *   관측자 1600m  · 운량 0      — 자가 검증: τ 전부 0
 *
 * 그리고 **가장자리 단면** — 수평을 좁은 시야(세로 4°)로 보고 행마다 구름
 * 비율을 내서, 운해가 끝나는 고도각을 `cloudDeck.deckHorizonDipDeg` 의 예측
 * (−0.642°)과 견줍니다. 바다 수평선(−1.28°)과 구별되는지가 핵심입니다.
 *
 * 준비: node tools/shader-preview/stage-esm.js
 * 사용: node tools/shader-preview/build-cloud-sea.js
 *       node tools/shader-preview/verify-cloud-sea.js
 */
const fs = require('fs');
const path = require('path');
const { PREVIEW } = require('./paths');

const TW = 240, TH = 240;
const EDGE_W = 240, EDGE_H = 480, EDGE_FOV = 4;
const SUN_ALT = 20, SUN_AZ = 200;
const ELEVS = [-60, -30, -10, -3, 10, 30];
const COVER = 0.90;

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
 body{margin:0;background:#0b0f15;font-family:sans-serif;color:#dde}
 #wrap{padding:12px} h3{font-size:13px;margin:6px 0}
 canvas{border:1px solid #345;margin:2px} .cap{font:10px monospace;color:#9ab}
</style></head><body>
<div id="wrap"><h3>운해 — 관측자 고도 × 층 고도 × 시선 고도 (τ 출구)</h3>
<div id="shots"></div><div id="out"></div></div>
<script type="module">
import * as THREE from './app/vendor/three.module.js';
import { createCloudSlab, updateCloudSlab, bakeCloudSlabCoverage }
  from './app/components/SkyScene3D/CloudSlab.js';
import { WeatherFan } from './app/utils/skyColumn.js';
import { makeAtmosphereParams, beamAtAltitude } from './app/utils/atmosphere.js';
import { deckHorizonDipDeg } from './app/utils/cloudDeck.js';
import { seaHorizonDipDeg } from './app/utils/earth.js';

const errors = [];
window.addEventListener('error', e => errors.push(String(e.message)));

const TW=${TW}, TH=${TH}, EDGE_W=${EDGE_W}, EDGE_H=${EDGE_H}, EDGE_FOV=${EDGE_FOV};
const SUN_ALT=${SUN_ALT}, SUN_AZ=${SUN_AZ};
const ELEVS=${JSON.stringify(ELEVS)}, COVER=${COVER};

const glCanvas = document.createElement('canvas');
const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias:false, alpha:false });
renderer.setPixelRatio(1);
const gl = renderer.getContext();
const scene = new THREE.Scene();

function bake(slab, cover){
  const OFFSETS=[-180,-135,-90,-45,0,45,90,135], DISTS=[5,10,30,70,130,200,280,380];
  const pt=(d,off)=>({ distance:d, azimuthOffset:off, low:cover*100, mid:0, high:0,
                       humidity:65, precipitation:0, visibility:25000 });
  const pts=[pt(0,0)];
  for (const off of OFFSETS) for (const d of DISTS) pts.push(pt(d,off));
  const fan = new WeatherFan(pts, SUN_AZ);
  bakeCloudSlabCoverage(slab, (azDeg, distKm) => {
    const { data } = fan.sample(azDeg, distKm);
    if (!data) return { low:0, mid:0, high:0, confidence:1 };
    return { low:data.low/100, mid:0, high:0, confidence:1 };
  });
}

function shoot(o){
  const { obsM, lowKm, cover, elev, w, h, fov, sunAlt = SUN_ALT, dataOut = 2, deck = null } = o;
  glCanvas.width = w; glCanvas.height = h; renderer.setSize(w, h, false);
  const atmosphere = makeAtmosphereParams({
    latitude: 36.0, observerElevM: obsM, dayOfYear: 290,
    humidityPct: 65, visibilityM: 25000,
  });
  const slab = createCloudSlab(); slab.mesh.renderOrder = 10; scene.add(slab.mesh);
  slab.setLayerAltitudesKm(lowKm, 4.5, 10.0);
  // §82 덱 밑면·윗면. null 이면 모름 → §81 그대로.
  slab.setLowDeckKm(deck ? deck[0] : null, deck ? deck[1] : null);
  bake(slab, cover);
  const cam = new THREE.PerspectiveCamera(fov, w/h, 0.1, 2000);
  cam.position.set(0,0,0); cam.up.set(0,1,0);
  // 해를 등지고 봅니다 — 방위는 결과와 무관해야 하지만 한쪽에 고정합니다.
  const ar=(SUN_AZ+180)*Math.PI/180, er=elev*Math.PI/180;
  cam.lookAt(100*Math.cos(er)*Math.sin(ar), 100*Math.sin(er), -100*Math.cos(er)*Math.cos(ar));
  cam.updateMatrixWorld(true);
  const a=sunAlt*Math.PI/180, z=SUN_AZ*Math.PI/180;
  const sunDir=new THREE.Vector3(Math.cos(a)*Math.sin(z), Math.sin(a), -Math.cos(a)*Math.cos(z)).normalize();
  const wd={ speedKmh:30, bearingDeg:250 };
  updateCloudSlab(slab, {
    camera: cam, widthPx: w, heightPx: h,
    sunDir, sunAltDeg: sunAlt, sunAzDeg: SUN_AZ,
    beamFor:(altKm)=>beamAtAltitude(sunAlt, altKm, atmosphere),
    atmosphere,
    layerWinds:{ low:wd, mid:wd, high:wd },
    driftHours:0, visible:true,
    dataOut,
  });
  renderer.setRenderTarget(null);
  renderer.setClearColor(0x000000, 1);
  renderer.render(scene, cam);
  const buf=new Uint8Array(4*w*h);
  gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,buf);
  scene.remove(slab.mesh); slab.dispose?.();
  return buf;
}

const TAU_MIN = 0.16;   // 8비트 눈금 한 칸
function area(buf, w, h){
  let a=0, s=0;
  for (let i=0;i<w*h;i++){ const t=buf[i*4]/255*40; s+=t; if (t>=TAU_MIN) a++; }
  return { 면적:+(a/(w*h)).toFixed(4), 평균τ:+(s/(w*h)).toFixed(3) };
}

function paint(buf, w, h, label){
  const c=document.createElement('canvas'); c.width=w; c.height=h;
  c.style.width=(w/2)+'px'; c.style.height=(h/2)+'px';
  const cx=c.getContext('2d'); const img=cx.createImageData(w,h);
  for(let y=0;y<h;y++){ const s=(h-1-y)*w*4, d=y*w*4;
    for(let i=0;i<w*4;i++) img.data[d+i]=buf[s+i]; }
  cx.putImageData(img,0,0);
  const t=document.createElement('span'); t.className='cap'; t.textContent=label+' ';
  document.getElementById('shots').appendChild(t);
  document.getElementById('shots').appendChild(c);
}

const CASES = {
  '지상_층1.2':   { obsM: 0,    lowKm: 1.2, cover: COVER },
  '산1600_층1.2': { obsM: 1600, lowKm: 1.2, cover: COVER },
  '산1600_층2.5': { obsM: 1600, lowKm: 2.5, cover: COVER },
  '산1600_운량0': { obsM: 1600, lowKm: 1.2, cover: 0 },
  // §82 — 단면이 준 덱 밑면·윗면. 가중 평균(lowKm)은 그대로 1.2 입니다.
  '산1600_덱1.0-1.4': { obsM: 1600, lowKm: 1.2, cover: COVER, deck: [1.0, 1.4] },
  '산1600_덱0.8-1.8': { obsM: 1600, lowKm: 1.2, cover: COVER, deck: [0.8, 1.8] },  // 관측자가 덱 속
  '지상_덱1.0-1.4':   { obsM: 0,    lowKm: 1.2, cover: COVER, deck: [1.0, 1.4] },  // 지상은 덱과 무관해야
};
const 결과 = {};
for (const [name, c] of Object.entries(CASES)){
  결과[name] = {};
  for (const elev of ELEVS){
    const buf = shoot({ ...c, elev, w:TW, h:TH, fov:60 });
    if (elev === -30 || elev === 30) paint(buf, TW, TH, name+' '+elev+'°');
    결과[name]['고도'+elev] = area(buf, TW, TH);
  }
}

// ── 가장자리 단면 ──────────────────────────────────────────────────────
//
// 수평(피치 0)을 세로 4° 로 봅니다. 행 y(아래가 0)의 고도각은
//   ndc = (y+0.5)/H·2 − 1,   고도 = atan(ndc·tan(fov/2))
// 이고 가운데 열 근처에서 정확합니다. 가운데 1/3 열만 씁니다.
function rows(buf){
  const out=[];
  const t=Math.tan(EDGE_FOV/2*Math.PI/180);
  const x0=Math.floor(EDGE_W/3), x1=Math.floor(2*EDGE_W/3);
  for (let y=0;y<EDGE_H;y++){
    let a=0;
    for (let x=x0;x<x1;x++){ if (buf[(y*EDGE_W+x)*4]/255*40 >= TAU_MIN) a++; }
    const ndc=(y+0.5)/EDGE_H*2-1;
    out.push({ elev: Math.atan(ndc*t)*180/Math.PI, frac: a/(x1-x0) });
  }
  return out;
}
const 단면 = {};
for (const [name, c] of Object.entries(CASES)){
  const buf = shoot({ ...c, elev:0, w:EDGE_W, h:EDGE_H, fov:EDGE_FOV });
  if (name === '산1600_층1.2') paint(buf, EDGE_W, EDGE_H, name+' 수평 4°');
  단면[name] = rows(buf);
}

// ── 조명 — 윗면(위에서)과 밑면(아래에서) ──────────────────────────────
//
// 같은 덱, 같은 해. 두꺼운 층운은 위에서 보면 **반사**(R = tp/(tp+2))라
// 밝고, 아래에서 보면 **투과**(Tr = 2/(tp+2))라 어둡습니다. 조명 출구
// (dataOut 0)를 τ 가림(τ ≥ 1)으로 잘라 구름 화소만 평균합니다.
//
// ⚠ 이 자는 **방향**만 봅니다. 몇 배여야 하는지는 사진과 대조한 적이
//   없어 문턱을 두지 않습니다.
function litMean(o){
  const tau = shoot({ ...o, dataOut: 2 });
  const lit = shoot({ ...o, dataOut: 0 });
  let s=0, n=0, sat=0;
  for (let i=0;i<o.w*o.h;i++){
    if (tau[i*4]/255*40 < 1.0) continue;
    const L = 0.2126*lit[i*4] + 0.7152*lit[i*4+1] + 0.0722*lit[i*4+2];
    s += L; n++; if (Math.max(lit[i*4],lit[i*4+1],lit[i*4+2]) >= 254) sat++;
  }
  return { 휘도: n ? +(s/n).toFixed(2) : null, 화소: n, 포화: n ? +(sat/n).toFixed(4) : null };
}
const 조명 = {};
for (const sunAlt of [30, 10]){
  const base = { lowKm: 1.2, cover: COVER, w: TW, h: TH, fov: 60, sunAlt };
  조명['해'+sunAlt] = {
    '밑면_지상+30':  litMean({ ...base, obsM: 0,    elev: 30 }),
    '윗면_산-30':    litMean({ ...base, obsM: 1600, elev: -30 }),
    '윗면_산-60':    litMean({ ...base, obsM: 1600, elev: -60 }),
  };
}
{ const lit = shoot({ obsM:1600, lowKm:1.2, cover:COVER, elev:-30, w:TW, h:TH, fov:60, dataOut:0 });
  paint(lit, TW, TH, '조명 산1600 -30°'); }

document.getElementById('out').innerHTML='<p>'+JSON.stringify(결과)+'</p>';
window.__stats={
  glError: gl.getError(), 결과, 단면, 조명,
  예측: {
    가장자리: -deckHorizonDipDeg(1.2, 1.6),
    가장자리_덱14: -deckHorizonDipDeg(1.4, 1.6),
    바다수평선: -seaHorizonDipDeg(1600),
  },
};
window.__errors=errors;
document.title='DONE::'+(errors.length?'ERR':'OK')+'::'+gl.getError();
</script></body></html>`;

fs.writeFileSync(path.join(PREVIEW, 'cloud-sea.html'), html);
console.log('생성 완료: cloud-sea.html');
