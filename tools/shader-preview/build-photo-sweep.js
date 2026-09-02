/**
 * **어느 손잡이가 하늘을 원색으로 만드는가** — 진단 습작, 판정 없음.
 *
 * `verify-photo-match` 가 노을·박명·흐림에서 렌더가 사진과 크게 다르다고
 * 말했습니다(노을 원색 0.993 대 사진 0.000). 그 **원인**을 손잡이를 하나씩
 * 돌려 가릅니다. 추측을 적어 두는 대신 재서 가립니다 — 지금까지 이 저장소에서
 * 제 가설 넷이 측정에 뒤집혔습니다.
 *
 * 후보:
 *   DISP_SAT  = 1.22  톤매핑 뒤 채도를 22% 올리는 전역 상수
 *   ADAPT_MAX = 16.0  태양이 +6 → -14° 로 내려갈 때 노출을 16배까지
 *
 * 준비: node tools/shader-preview/stage-esm.js
 * 사용: node tools/shader-preview/build-photo-sweep.js
 *       node tools/shader-preview/shoot.js photo-sweep.html photo-sweep.png 60
 */
const fs = require('fs');
const path = require('path');
const { PREVIEW } = require('./paths');

const STATS_SRC = fs.readFileSync(
  path.join(__dirname, '../photo-ref/sky-stats.js'), 'utf8')
  .replace(/if \(typeof module[\s\S]*$/, '');

const TW = 220, TH = 220;
const SUN_AZ = 268;

// verify-photo-match 가 실패한 세 칸만 봅니다.
// verify-photo-match 가 실패한 세 칸만 봅니다.
// 기하는 build-photo-match.js 와 같습니다 — 지면을 자르고 태양을 화면 밖으로.
// 실패한 두 칸 + 망가지면 안 되는 낮 두 칸을 같이 봅니다.
// 한 장면만 보고 맞추다 다른 장면을 깬 적이 여러 번 있습니다(15·17절).
const CASES = [
  { tag:'sunset',       sunAlt:  0, dAz: 45, elev: 28, sky:0.94,
    w:{ low:18, mid:56, high:34, hum:64, vis:24000 } },
  { tag:'day-overcast', sunAlt: 40, dAz: 90, elev: 30, sky:0.97,
    w:{ low:92, mid:88, high:70, hum:92, vis: 9000 } },
  { tag:'day-cumulus',  sunAlt: 40, dAz: 90, elev: 35, sky:1.00,
    w:{ low:34, mid:16, high:12, hum:55, vis:32000 } },
  { tag:'twilight',     sunAlt: -6, dAz:  0, elev: 22, sky:0.83,
    w:{ low:12, mid:34, high:40, hum:66, vis:26000 } },
];
// 손잡이를 하나씩만 움직입니다 — 둘을 같이 바꾸면 어느 쪽이 먹었는지 못 가립니다.
// 손잡이를 하나씩만 움직입니다 — 둘을 같이 바꾸면 어느 쪽이 먹었는지 못 가립니다.
// 표시 변환(위)과 물리 쪽(아래)을 나눠 봅니다.
// 표시 변환은 이미 중립으로 내렸습니다(계획 20절). 이제 남은 격차 —
// 복사휘도 모델의 탈색 부족 — 을 AIR_WASH 로 훑습니다.
// displayContrast 는 1.06 으로 되돌린 상태입니다 — 1.00 으로 내렸더니
// 깊은 황혼에 저층이 안 꺼지고(6/255 문턱에 37.7) 노을 명암폭이 90 → 80.3 으로
// 떨어져, 사용자가 처음에 꼽은 "지평선쪽만 빛나면서"를 깎았습니다.
// 그래서 색은 **채도 쪽만으로** 잡아야 합니다. 얼마나 내려야 하는지 훑습니다.
const KNOBS = [
  { name:'SAT 1.22 (원래)', patch:{ displaySaturation: 1.22 } },
  { name:'SAT 1.00',       patch:{ displaySaturation: 1.00 } },
  { name:'SAT 0.90',       patch:{ displaySaturation: 0.90 } },
  { name:'SAT 0.80',       patch:{ displaySaturation: 0.80 } },
  { name:'SAT 0.70',       patch:{ displaySaturation: 0.70 } },
  { name:'SAT 0.60',       patch:{ displaySaturation: 0.60 } },
];

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
 body{margin:0;background:#0b0f15;font-family:sans-serif;color:#dde}
 #wrap{position:relative;width:${TW * KNOBS.length + 24}px;padding:12px}
 .lbl{position:absolute;color:#fff;font-size:10px;font-family:monospace;
   pointer-events:none;line-height:1.35;background:rgba(6,10,16,.80);
   padding:3px 6px;border-radius:4px}
 h3{font-size:13px;margin:6px 0}
</style></head><body>
<div id="wrap">
<h3>손잡이 하나씩 — 세로: 노을 / 박명 / 흐림</h3>
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

const TW=${TW}, TH=${TH}, SUN_AZ=${SUN_AZ};
const CASES=${JSON.stringify(CASES)};
const KNOBS=${JSON.stringify(KNOBS)};

const canvas = document.getElementById('c');
canvas.width = TW*KNOBS.length; canvas.height = TH*CASES.length;
const ctx2d = canvas.getContext('2d');
const glCanvas = document.createElement('canvas');
glCanvas.width = TW; glCanvas.height = TH;
const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias:false, alpha:false });
renderer.setPixelRatio(1); renderer.setSize(TW, TH, false);

const scene = new THREE.Scene();
const skydome = createSkydome(); scene.add(skydome.mesh);
const angles = [];
for (let i=0;i<72;i++) angles.push(0.4 + 0.9*Math.sin(i*0.21) + 0.5*Math.sin(i*0.07+1.3));
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
    pts.push({ distance:d, azimuthOffset:off, low:jit(w.low,d,off),
      mid:jit(w.mid,d,off+40), high:jit(w.high,d,off+80),
      humidity:w.hum, precipitation:0 });
  const fan = new WeatherFan(pts, SUN_AZ);
  bakeCloudSlabCoverage(slab, (azDeg, distKm) => {
    const { data, confidence } = fan.sample(azDeg, distKm);
    if (!data) return { low:0, mid:0, high:0, confidence:0 };
    return { low:data.low/100, mid:data.mid/100, high:data.high/100,
             confidence: Math.max(0, Math.min(1, confidence)) };
  });
}
function shoot(c){
  const cam = new THREE.PerspectiveCamera(62, TW/TH, 0.1, 2000);
  cam.position.set(0,0,0); cam.up.set(0,1,0);
  const az=(SUN_AZ+c.dAz)*Math.PI/180, er=c.elev*Math.PI/180;
  cam.lookAt(100*Math.cos(er)*Math.sin(az), 100*Math.sin(er), -100*Math.cos(er)*Math.cos(az));
  cam.updateMatrixWorld(true);
  const atmosphere = makeAtmosphereParams({
    latitude: 37.5, observerElevM: 30, dayOfYear: 240,
    humidityPct: c.w.hum, visibilityM: c.w.vis });
  const a=c.sunAlt*Math.PI/180, z=SUN_AZ*Math.PI/180;
  const sunDir=new THREE.Vector3(Math.cos(a)*Math.sin(z), Math.sin(a), -Math.cos(a)*Math.cos(z)).normalize();
  updateSkydome(skydome, c.sunAlt, SUN_AZ, atmosphere);
  updateTerrainColors(terrain, c.sunAlt, SUN_AZ, atmosphere);
  updateGroundColors(ground, c.sunAlt, SUN_AZ, atmosphere);
  // 튜닝을 바꾼 뒤 uniform 으로 밀어 넣습니다 — 앱이 하는 것과 같은 경로.
  applyTuningUniforms(skydome.mesh.material.uniforms);
  applyTuningUniforms(slab.mesh.material.uniforms);
  const W=(k)=>({ speedKmh:k, bearingDeg:260 });
  updateCloudSlab(slab, {
    camera: cam, widthPx: TW, heightPx: TH, sunDir,
    sunAltDeg: c.sunAlt, sunAzDeg: SUN_AZ, cityLight: 0.2,
    beamFor:(altKm)=>beamAtAltitude(c.sunAlt, altKm, atmosphere),
    atmosphere, layerWinds:{ low:W(22), mid:W(37), high:W(75) },
    driftHours: 6, visible:true });
  applyTuningUniforms(slab.mesh.material.uniforms);
  renderer.setRenderTarget(null);
  renderer.setClearColor(0x000000, 1);
  renderer.render(scene, cam);
  const buf=new Uint8Array(4*TW*TH);
  gl.readPixels(0,0,TW,TH,gl.RGBA,gl.UNSIGNED_BYTE,buf);
  const out=new Uint8Array(buf.length);
  for(let r=0;r<TH;r++) out.set(buf.subarray((TH-1-r)*TW*4,(TH-r)*TW*4), r*TW*4);
  return out;
}
function paint(buf,x,y){
  const img=ctx2d.createImageData(TW,TH); img.data.set(buf); ctx2d.putImageData(img,x,y);
}

const 결과=[];
CASES.forEach((c,ci)=>{
  bake(c.w);
  KNOBS.forEach((k,ki)=>{
    resetTuning(); setTuning(k.patch);
    const top = shoot(c);
    const s = skyStats(top, TW, TH, { skyFrac: c.sky });
    결과.push({ tag:c.tag, knob:k.name, ...s });
    paint(top, ki*TW, ci*TH);
    const d=document.createElement('div');
    d.className='lbl'; d.style.left=(ki*TW+8)+'px'; d.style.top=(ci*TH+36)+'px';
    d.innerHTML=k.name+'<br>채도 '+s.채도+'<br>원색 '+s.원색+'<br>국소 '+s.국소대비;
    labels.appendChild(d);
  });
});
resetTuning();

window.__stats={ glError:gl.getError(), 결과 };
window.__errors=errors;
document.title='DONE::'+(errors.length?'SHADER_ERR':'OK')+'::'+gl.getError();
</script></body></html>`;

fs.mkdirSync(PREVIEW, { recursive: true });
fs.writeFileSync(path.join(PREVIEW, 'photo-sweep.html'), html);
console.log('생성 완료: photo-sweep.html');
