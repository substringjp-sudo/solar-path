/**
 * **2026-09-04 아침 QR 재현** — "하늘이 파랗지 않고 구름이 어둡다" 를 가릅니다.
 *
 * 사용자가 실기기 화면 QR 과 같은 순간의 사진을 같이 줬습니다. 그래서 이건
 * 지어낸 장면이 아니라 **입력이 전부 실측인 1:1 대조**입니다.
 *
 *   2026-09-04 07:13 KST, 37.4705 / 127.0331, 고도 24m
 *   태양 고도 +12.76°, 방위 90.35° (정동, 낮은 아침해)
 *   운량 저 15% / 중 18% / 상 0%, 습도 79%, 시정 17,960m
 *
 * 같은 순간 사진을 sky-stats 의 lightingStats 로 잰 값이 과녁입니다:
 *
 *   어두운쪽청색비 1.80 · 어두운쪽채도 0.543 · 밝기비 3.19
 *
 * 실기기 화면을 같은 자로 재면 1.27 / 0.218 / 1.38 — 참조 사진 4장의
 * 범위(1.47~3.65 / 0.33~0.73 / 1.60~4.01) **아래**입니다.
 *
 * 방위를 넷 돌립니다. 태양에서 멀수록 하늘이 파래야 하므로, 한 방향만 보고
 * "파랗지 않다"고 말하면 태양 근처를 본 탓인지 구분이 안 됩니다.
 *
 * 준비: node tools/shader-preview/stage-esm.js
 * 사용: node tools/shader-preview/build-morning-qr.js
 *       node tools/shader-preview/shoot.js morning-qr.html morning-qr.png 30000
 */
const fs = require('fs');
const path = require('path');
const { PREVIEW } = require('./paths');

const STATS_SRC = fs.readFileSync(
  path.join(__dirname, '../photo-ref/sky-stats.js'), 'utf8')
  .replace(/if \(typeof module[\s\S]*$/, '');

const TW = 400, TH = 400;
/** QR 디코드 값 그대로입니다 — 지어낸 값이 하나도 없습니다. */
const QR = {
  lat: 37.4705, lon: 127.0331, elevM: 24,
  sunAlt: 12.76, sunAz: 90.35,
  low: 15, mid: 18, high: 0, humidity: 79, vis: 17960,
  windKmh: 15.5, windDeg: 114,
};
/** 화면 화각 60°, 지평선이 패널 아래끝이라 시선 고도는 세로 화각의 절반. */
const VIEWS = [
  { name: '태양쪽 (0°)',   dAz: 0,   elev: 30 },
  { name: '실제 화면 (48°)', dAz: 48,  elev: 30 },
  { name: '옆 (90°)',      dAz: 90,  elev: 30 },
  { name: '반대편 (180°)',  dAz: 180, elev: 30 },
];

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
 body{margin:0;background:#0b0f15;font-family:sans-serif;color:#dde}
 #wrap{position:relative;width:${TW * VIEWS.length + 24}px;padding:12px}
 .lbl{position:absolute;color:#fff;font-size:11px;font-family:monospace;
   pointer-events:none;line-height:1.45;background:rgba(6,10,16,.82);
   padding:4px 7px;border-radius:4px}
 h3{font-size:13px;margin:6px 0}
 .sub{font-size:11px;color:#8aa;margin:0 0 8px}
</style></head><body>
<div id="wrap">
<h3>2026-09-04 07:13 아침 QR 재현 — 태양 +12.76°/90.35°, 저15 중18 상0, 시정 18km</h3>
<p class="sub">같은 순간 사진 과녁: 어두운쪽청색비 1.80 · 어두운쪽채도 0.543 · 밝기비 3.19</p>
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

const errors = [];
const oe = console.error;
console.error = (...a) => { errors.push(a.join(' ')); oe(...a); };
${STATS_SRC}

const TW=${TW}, TH=${TH};
const QR=${JSON.stringify(QR)};
const VIEWS=${JSON.stringify(VIEWS)};

const canvas = document.getElementById('c');
canvas.width = TW*VIEWS.length; canvas.height = TH;
const ctx2d = canvas.getContext('2d');
const glCanvas = document.createElement('canvas');
glCanvas.width = TW; glCanvas.height = TH;
const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias:false, alpha:false });
renderer.setPixelRatio(1); renderer.setSize(TW, TH, false);

const scene = new THREE.Scene();
const skydome = createSkydome(); scene.add(skydome.mesh);
const angles=[]; for(let i=0;i<72;i++) angles.push(0.4+0.9*Math.sin(i*0.21)+0.5*Math.sin(i*0.07+1.3));
const terrain = createTerrainRing(angles); scene.add(terrain);
const ground = createGroundPlane(); setGroundHorizon(ground, 24); scene.add(ground);
const slab = createCloudSlab(); slab.mesh.renderOrder = 10; scene.add(slab.mesh);
const gl = renderer.getContext();
const labels = document.getElementById('labels');

// 관측점 예보만 알고 주변은 모릅니다 — 앱과 같은 상황이라 고리에는 완만한
// 흔들림만 줍니다.
const OFFSETS=[-180,-150,-120,-90,-60,-30,0,30,60,90,120,150,180];
const DISTS=[5,12,30,70,160,360];
const jit=(v,d,a)=>Math.max(0,Math.min(100, v + 14*Math.sin(d*0.031+a*0.017) + 9*Math.cos(d*0.017-a*0.026)));
const pts=[{ distance:0, azimuthOffset:0, low:QR.low, mid:QR.mid, high:QR.high,
             humidity:QR.humidity, precipitation:0, visibility:QR.vis }];
for (const off of OFFSETS) for (const d of DISTS)
  pts.push({ distance:d, azimuthOffset:off, low:jit(QR.low,d,off), mid:jit(QR.mid,d,off+40),
             high:jit(QR.high,d,off+80), humidity:QR.humidity, precipitation:0 });
const fan = new WeatherFan(pts, QR.sunAz);
bakeCloudSlabCoverage(slab, (azDeg, distKm) => {
  const { data, confidence } = fan.sample(azDeg, distKm);
  if (!data) return { low:0, mid:0, high:0, confidence:0 };
  return { low:data.low/100, mid:data.mid/100, high:data.high/100,
           confidence: Math.max(0, Math.min(1, confidence)) };
});

const atmosphere = makeAtmosphereParams({
  latitude: QR.lat, observerElevM: QR.elevM, dayOfYear: 247,
  humidityPct: QR.humidity, visibilityM: QR.vis });

function shoot(v){
  const cam = new THREE.PerspectiveCamera(60, TW/TH, 0.1, 2000);
  cam.position.set(0,0,0); cam.up.set(0,1,0);
  const az=(QR.sunAz+v.dAz)*Math.PI/180, er=v.elev*Math.PI/180;
  cam.lookAt(100*Math.cos(er)*Math.sin(az), 100*Math.sin(er), -100*Math.cos(er)*Math.cos(az));
  cam.updateMatrixWorld(true);
  const a=QR.sunAlt*Math.PI/180, z=QR.sunAz*Math.PI/180;
  const sunDir=new THREE.Vector3(Math.cos(a)*Math.sin(z),Math.sin(a),-Math.cos(a)*Math.cos(z)).normalize();
  applyTuningUniforms(skydome.mesh.material.uniforms);
  updateSkydome(skydome, QR.sunAlt, QR.sunAz, atmosphere);
  applyTuningUniforms(skydome.mesh.material.uniforms);
  updateTerrainColors(terrain, QR.sunAlt, QR.sunAz, atmosphere);
  updateGroundColors(ground, QR.sunAlt, QR.sunAz, atmosphere);
  const W=(k,b)=>({ speedKmh:k, bearingDeg:b });
  updateCloudSlab(slab, { camera:cam, widthPx:TW, heightPx:TH, sunDir,
    sunAltDeg:QR.sunAlt, sunAzDeg:QR.sunAz, cityLight:0.4,
    beamFor:(altKm)=>beamAtAltitude(QR.sunAlt, altKm, atmosphere),
    atmosphere,
    layerWinds:{ low:W(QR.windKmh,QR.windDeg), mid:W(QR.windKmh*2.2,QR.windDeg-15),
                 high:W(QR.windKmh*5,QR.windDeg-30) },
    driftHours:0, visible:true });
  applyTuningUniforms(slab.mesh.material.uniforms);
  renderer.setRenderTarget(null); renderer.setClearColor(0x000000,1);
  renderer.render(scene, cam);
  const buf=new Uint8Array(4*TW*TH);
  gl.readPixels(0,0,TW,TH,gl.RGBA,gl.UNSIGNED_BYTE,buf);
  const out=new Uint8Array(buf.length);
  for(let r=0;r<TH;r++) out.set(buf.subarray((TH-1-r)*TW*4,(TH-r)*TW*4), r*TW*4);
  return out;
}

// ── 구름만 따로 재는 자 ────────────────────────────────────────────────
//
// ⚠ 전체 밝기비로는 구름을 못 잽니다. 운량이 15% 뿐이라 구름 화소가
// 소수라서, 밝은쪽/어두운쪽 백분위는 **하늘의 세로 그라데이션**이
// 지배합니다. 사용자가 말한 "얇은 구름은 하얗게 보여야 한다"를 재려면
// 구름 화소를 갈라야 합니다.
//
// 분할 규칙을 지어내지 않습니다 — 같은 장면을 운량 0 으로 한 번 더 그려
// **달라진 화소가 곧 구름**입니다. 그 화소에서 구름 휘도 ÷ 원래 하늘
// 휘도를 내면, 맑은 날 햇빛 받은 구름은 1 보다 큽니다(하늘보다 밝음).
function cloudVsSky(withCloud, noCloud){
  const lum=(b,p)=>0.2126*b[p]+0.7152*b[p+1]+0.0722*b[p+2];
  let sc=0, ss=0, n=0;
  for(let i=0;i<TW*TH;i++){
    const p=i*4;
    const dr=Math.abs(withCloud[p]-noCloud[p]);
    const dg=Math.abs(withCloud[p+1]-noCloud[p+1]);
    const db=Math.abs(withCloud[p+2]-noCloud[p+2]);
    if (dr+dg+db < 24) continue;          // 하늘 그대로면 구름이 아닙니다
    sc += lum(withCloud,p); ss += lum(noCloud,p); n++;
  }
  if (!n) return { 구름밝기비:0, 구름덮임:0, 구름휘도:0, 뒤하늘휘도:0 };
  return { 구름밝기비:+(sc/Math.max(1,ss)).toFixed(3),
           구름덮임:+(n/(TW*TH)).toFixed(3),
           구름휘도:+(sc/n).toFixed(1), 뒤하늘휘도:+(ss/n).toFixed(1) };
}

const 결과=[];
VIEWS.forEach((v,i)=>{
  const top = shoot(v);
  // 같은 장면, 구름만 뺀 판 — 위 cloudVsSky 의 기준입니다.
  const savedTex = slab.material.uniforms.uCoverTex.value;
  const blank = new THREE.DataTexture(new Uint8Array(savedTex.image.width*savedTex.image.height*4),
    savedTex.image.width, savedTex.image.height, THREE.RGBAFormat);
  blank.minFilter = THREE.LinearFilter; blank.magFilter = THREE.LinearFilter; blank.needsUpdate = true;
  slab.material.uniforms.uCoverTex.value = blank;
  const bare = shoot(v);
  slab.material.uniforms.uCoverTex.value = savedTex;
  const cs = cloudVsSky(top, bare);
  // 시선 고도 30° · 세로 화각 60° 라 지평선이 화면 아래끝입니다. 지형이
  // 걸리는 마지막 10% 만 뺍니다.
  const s = skyStats(top, TW, TH, { skyFrac: 0.90 });
  const l = lightingStats(top, TW, TH, { skyFrac: 0.90 });
  결과.push({ 방향:v.name,
    어두운쪽청색비:l.어두운쪽청색비, 어두운쪽채도:l.어두운쪽채도,
    밝은쪽채도:l.밝은쪽채도, 밝기비:l.밝기비,
    평균휘도:s.평균휘도, 채도:s.채도, ...cs });
  const img=ctx2d.createImageData(TW,TH); img.data.set(top); ctx2d.putImageData(img, i*TW, 0);
  const d=document.createElement('div');
  d.className='lbl'; d.style.left=(i*TW+10)+'px'; d.style.top='56px';
  d.innerHTML=v.name
    +'<br>어두운쪽청색비 '+l.어두운쪽청색비+' <b>(사진 1.78)</b>'
    +'<br>어두운쪽채도 '+l.어두운쪽채도+' <b>(0.44)</b>'
    +'<br>밝기비 '+l.밝기비+' <b>(1.39~1.57)</b>'
    +'<br><b>구름밝기비 '+cs.구름밝기비+'</b> (1 이하면 하늘보다 어두움)'
    +'<br>구름 '+cs.구름휘도+' / 뒤하늘 '+cs.뒤하늘휘도+' · 덮임 '+(cs.구름덮임*100).toFixed(0)+'%';
  labels.appendChild(d);
});

window.__stats={ glError:gl.getError(), 결과 };
window.__errors=errors;
document.title='DONE::'+(errors.length?'SHADER_ERR':'OK')+'::'+gl.getError();
</script></body></html>`;

fs.mkdirSync(PREVIEW, { recursive: true });
fs.writeFileSync(path.join(PREVIEW, 'morning-qr.html'), html);
console.log('생성 완료: morning-qr.html');
