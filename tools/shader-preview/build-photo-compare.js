/**
 * **실제 하늘 사진과 렌더를 나란히** — 진단 습작, 판정 없음.
 *
 * `verify-photo-match` 가 숫자로 말한 것을 눈으로도 볼 수 있게 놓습니다.
 * 왼쪽이 사진(하늘 부분만 잘라 냄), 가운데가 현행 렌더, 오른쪽이 표시
 * 변환을 중립(DISP_SAT 1.00 · DISP_CONTR 1.00)으로 둔 렌더입니다.
 *
 * 준비: node tools/shader-preview/stage-esm.js
 *       node tools/photo-ref/fetch-sky-refs.js
 * 사용: node tools/shader-preview/build-photo-compare.js
 *       node tools/shader-preview/shoot.js photo-compare.html photo-compare.png 80
 */
const fs = require('fs');
const path = require('path');
const { PREVIEW } = require('./paths');

const STATS_SRC = fs.readFileSync(
  path.join(__dirname, '../photo-ref/sky-stats.js'), 'utf8')
  .replace(/if \(typeof module[\s\S]*$/, '');

const CELL = 300;
const SUN_AZ = 268;

// 사진 쪽 대표 한 장씩. 조건마다 여러 장을 받았지만 눈으로 볼 때는
// 조건을 대표하는 한 장이 낫습니다(숫자는 verify 쪽에서 전부 씁니다).
const PAIRS = [
  { tag:'day-cumulus',  photo:'day-cumulus_01.jpg',  pSky:1.00,
    sunAlt: 40, dAz: 90, elev: 35, sky:1.00, w:{ low:34, mid:16, high:12, hum:55, vis:32000 } },
  { tag:'day-cirrus',   photo:'day-cirrus_03.jpg',   pSky:0.72,
    sunAlt: 40, dAz: 90, elev: 35, sky:1.00, w:{ low: 4, mid: 8, high:62, hum:48, vis:35000 } },
  { tag:'day-overcast', photo:'day-overcast_05.jpg', pSky:0.60,
    sunAlt: 40, dAz: 90, elev: 30, sky:0.97, w:{ low:92, mid:88, high:70, hum:92, vis: 9000 } },
  { tag:'sunset',       photo:'sunset_06.jpg',       pSky:0.85,
    sunAlt:  0, dAz: 45, elev: 28, sky:0.94, w:{ low:18, mid:56, high:34, hum:64, vis:24000 } },
  { tag:'twilight',     photo:'twilight_08.jpg',     pSky:0.64,
    sunAlt: -6, dAz:  0, elev: 22, sky:0.83, w:{ low:12, mid:34, high:40, hum:66, vis:26000 } },
];

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
 body{margin:0;background:#0b0f15;font-family:sans-serif;color:#dde}
 #wrap{position:relative;width:${CELL * 3 + 40}px;padding:14px}
 h3{font-size:14px;margin:4px 0 2px}
 .sub{font-size:11px;color:#8aa;margin:0 0 10px}
 .lbl{position:absolute;color:#fff;font-size:10px;font-family:monospace;
   pointer-events:none;line-height:1.4;background:rgba(6,10,16,.82);
   padding:3px 6px;border-radius:4px}
 .hdr{position:absolute;color:#cde;font-size:12px;font-family:monospace;
   font-weight:bold;pointer-events:none}
</style></head><body>
<div id="wrap">
<h3>실제 하늘 사진 대 렌더</h3>
<p class="sub">왼쪽 사진 · 가운데 현행 · 오른쪽 표시변환 중립(DISP_SAT 1.00 · DISP_CONTR 1.00).
사진은 하늘 부분만 잘라 냈고, 세 장 다 폭 320 으로 맞춘 뒤 같은 함수로 쟀습니다.</p>
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
import { setTuning, resetTuning } from './app/utils/skyTuning.js';

const errors = [];
const oe = console.error;
console.error = (...a) => { errors.push(a.join(' ')); oe(...a); };
${STATS_SRC}

const CELL=${CELL}, SUN_AZ=${SUN_AZ};
const PAIRS=${JSON.stringify(PAIRS)};
const HDR_H = 22;

const canvas = document.getElementById('c');
canvas.width = CELL*3; canvas.height = (CELL+HDR_H)*PAIRS.length;
const ctx2d = canvas.getContext('2d');
const glCanvas = document.createElement('canvas');
glCanvas.width = CELL; glCanvas.height = CELL;
const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias:false, alpha:false });
renderer.setPixelRatio(1); renderer.setSize(CELL, CELL, false);

const scene = new THREE.Scene();
const skydome = createSkydome(); scene.add(skydome.mesh);
const angles=[]; for(let i=0;i<72;i++) angles.push(0.4+0.9*Math.sin(i*0.21)+0.5*Math.sin(i*0.07+1.3));
const terrain = createTerrainRing(angles); scene.add(terrain);
const ground = createGroundPlane(); setGroundHorizon(ground, 30); scene.add(ground);
const slab = createCloudSlab(); slab.mesh.renderOrder = 10; scene.add(slab.mesh);
const gl = renderer.getContext();
const labels = document.getElementById('labels');

const OFFSETS=[-180,-150,-120,-90,-60,-30,0,30,60,90,120,150,180];
const DISTS=[2,5,12,30,70,160,360];
const jit=(v,d,a)=>Math.max(0,Math.min(100, v + 16*Math.sin(d*0.031+a*0.017) + 11*Math.cos(d*0.017-a*0.026)));
function bake(w){
  const pts=[{ distance:0, azimuthOffset:0, low:w.low, mid:w.mid, high:w.high,
               humidity:w.hum, precipitation:0, visibility:w.vis }];
  for (const off of OFFSETS) for (const d of DISTS)
    pts.push({ distance:d, azimuthOffset:off, low:jit(w.low,d,off), mid:jit(w.mid,d,off+40),
               high:jit(w.high,d,off+80), humidity:w.hum, precipitation:0 });
  const fan = new WeatherFan(pts, SUN_AZ);
  bakeCloudSlabCoverage(slab, (azDeg, distKm) => {
    const { data, confidence } = fan.sample(azDeg, distKm);
    if (!data) return { low:0, mid:0, high:0, confidence:0 };
    return { low:data.low/100, mid:data.mid/100, high:data.high/100,
             confidence: Math.max(0, Math.min(1, confidence)) };
  });
}
function shoot(c){
  const cam = new THREE.PerspectiveCamera(62, 1, 0.1, 2000);
  cam.position.set(0,0,0); cam.up.set(0,1,0);
  const az=(SUN_AZ+c.dAz)*Math.PI/180, er=c.elev*Math.PI/180;
  cam.lookAt(100*Math.cos(er)*Math.sin(az), 100*Math.sin(er), -100*Math.cos(er)*Math.cos(az));
  cam.updateMatrixWorld(true);
  const atmosphere = makeAtmosphereParams({ latitude:37.5, observerElevM:30, dayOfYear:240,
    humidityPct:c.w.hum, visibilityM:c.w.vis });
  const a=c.sunAlt*Math.PI/180, z=SUN_AZ*Math.PI/180;
  const sunDir=new THREE.Vector3(Math.cos(a)*Math.sin(z),Math.sin(a),-Math.cos(a)*Math.cos(z)).normalize();
  updateSkydome(skydome, c.sunAlt, SUN_AZ, atmosphere);
  updateTerrainColors(terrain, c.sunAlt, SUN_AZ, atmosphere);
  updateGroundColors(ground, c.sunAlt, SUN_AZ, atmosphere);
  applyTuningUniforms(skydome.mesh.material.uniforms);
  const W=(k)=>({ speedKmh:k, bearingDeg:260 });
  updateCloudSlab(slab, { camera:cam, widthPx:CELL, heightPx:CELL, sunDir,
    sunAltDeg:c.sunAlt, sunAzDeg:SUN_AZ, cityLight:0.2,
    beamFor:(altKm)=>beamAtAltitude(c.sunAlt, altKm, atmosphere),
    atmosphere, layerWinds:{ low:W(22), mid:W(37), high:W(75) }, driftHours:6, visible:true });
  applyTuningUniforms(slab.mesh.material.uniforms);
  renderer.setRenderTarget(null); renderer.setClearColor(0x000000,1);
  renderer.render(scene, cam);
  const buf=new Uint8Array(4*CELL*CELL);
  gl.readPixels(0,0,CELL,CELL,gl.RGBA,gl.UNSIGNED_BYTE,buf);
  const out=new Uint8Array(buf.length);
  for(let r=0;r<CELL;r++) out.set(buf.subarray((CELL-1-r)*CELL*4,(CELL-r)*CELL*4), r*CELL*4);
  return out;
}
const loadImg = src => new Promise(res => { const i=new Image(); i.onload=()=>res(i); i.onerror=()=>res(null); i.src=src; });

const 결과=[];
(async () => {
  for (let i=0;i<PAIRS.length;i++){
    const c = PAIRS[i];
    const y = i*(CELL+HDR_H) + HDR_H;
    // ── 사진: 하늘 부분만 잘라 정사각으로 ──
    const img = await loadImg('./photoref/' + c.photo);
    let pStats = null;
    if (img){
      const sh = Math.round(img.naturalHeight * c.pSky);
      ctx2d.drawImage(img, 0, 0, img.naturalWidth, sh, 0, y, CELL, CELL);
      const px = ctx2d.getImageData(0, y, CELL, CELL);
      pStats = skyStats(new Uint8Array(px.data.buffer.slice(0)), CELL, CELL, { skyFrac:1.0 });
    }
    bake(c.w);
    // ── 현행 ──
    resetTuning();
    const cur = shoot(c);
    const curS = skyStats(cur, CELL, CELL, { skyFrac:c.sky });
    let im = ctx2d.createImageData(CELL, CELL); im.data.set(cur);
    ctx2d.putImageData(im, CELL, y);
    // ── 표시 변환 중립 ──
    setTuning({ displaySaturation: 1.00, displayContrast: 1.00 });
    const neu = shoot(c);
    const neuS = skyStats(neu, CELL, CELL, { skyFrac:c.sky });
    im = ctx2d.createImageData(CELL, CELL); im.data.set(neu);
    ctx2d.putImageData(im, CELL*2, y);
    resetTuning();

    결과.push({ tag:c.tag, 사진:pStats, 현행:curS, 중립:neuS });
    // 조건 이름은 왼쪽 라벨 안에 넣습니다 — 따로 띄웠더니 한 줄 위 칸에
    // 얹혀서, 그림만 보면 어느 행이 무슨 조건인지 거꾸로 읽혔습니다.
    const put=(col,txt)=>{ const d=document.createElement('div');
      d.className='lbl'; d.style.left=(14+col*CELL+8)+'px'; d.style.top=(y+44+4)+'px';
      d.innerHTML=txt; labels.appendChild(d); };
    const fmt=(n,s)=>n+'<br>채도 '+s.채도+'<br>국소대비 '+s.국소대비+'<br>원색 '+s.원색;
    if(pStats) put(0, fmt('사진 — ' + c.tag, pStats));
    put(1, fmt('현행', curS));
    put(2, fmt('중립', neuS));
  }
  window.__stats={ glError:gl.getError(), 결과 };
  window.__errors=errors;
  document.title='DONE::'+(errors.length?'SHADER_ERR':'OK')+'::'+gl.getError();
})();
</script></body></html>`;

fs.mkdirSync(PREVIEW, { recursive: true });

// 사진은 서버가 내주는 자리로 복사합니다 — 브라우저가 <img> 로 읽어야
// 사진과 렌더를 같은 캔버스에서 같은 함수로 잴 수 있습니다.
const SRC = path.join(__dirname, '../../.harness/photoref');
const DST = path.join(PREVIEW, 'photoref');
if (fs.existsSync(SRC)) {
  fs.mkdirSync(DST, { recursive: true });
  for (const f of fs.readdirSync(SRC))
    if (f.endsWith('.jpg')) fs.copyFileSync(path.join(SRC, f), path.join(DST, f));
} else {
  console.log('⚠ 사진이 없습니다 — node tools/photo-ref/fetch-sky-refs.js 를 먼저 돌리세요.');
}

fs.writeFileSync(path.join(PREVIEW, 'photo-compare.html'), html);
console.log('생성 완료: photo-compare.html');
