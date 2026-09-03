/**
 * **실제 하늘 사진과 렌더를 같은 자로 나란히 잽니다.**
 *
 * "하늘색이 현실감이 없고 구름 대비가 너무 심하다"는 지적을 숫자로 바꿉니다.
 * 위키미디어 공용의 실제 하늘 사진(tools/photo-ref/fetch-sky-refs.js)에서
 * 뽑은 지표가 과녁이고, 이 습작이 **같은 조건의 렌더**를 같은 지표로 잽니다.
 *
 * 지표 구현은 `tools/photo-ref/sky-stats.js` **한 파일**입니다 — 그 소스를
 * 이 HTML 에 그대로 삽입하므로 사진 쪽과 렌더 쪽이 갈라질 수 없습니다.
 * (앞서 하네스 상수가 낡아 단언이 거짓으로 깨진 일이 있었습니다. 같은 값을
 *  두 군데 적어 두지 않는 것이 그 병에 대한 처방입니다.)
 *
 * 준비: node tools/shader-preview/stage-esm.js
 *       node tools/photo-ref/fetch-sky-refs.js
 *       node tools/photo-ref/measure-photos.js
 * 사용: node tools/shader-preview/build-photo-match.js
 *       node tools/shader-preview/shoot.js photo-match.html photo-match.png 50
 *       node tools/shader-preview/verify-photo-match.js
 */
const fs = require('fs');
const path = require('path');
const { PREVIEW } = require('./paths');

const STATS_SRC = fs.readFileSync(
  path.join(__dirname, '../photo-ref/sky-stats.js'), 'utf8')
  .replace(/if \(typeof module[\s\S]*$/, '');   // 브라우저에는 export 가 없습니다

const TW = 320, TH = 320;
const SUN_AZ = 268;

// 사진 조건에 맞춘 렌더 장면입니다. `sky` 는 지면이 화면에 들어오는 만큼
// 잘라 내는 값 — 사진 쪽 manifest 의 같은 이름 값과 짝입니다.
// 사진 조건에 맞춘 렌더 장면입니다.
//
// ⚠ `sky` 와 `dAz` 는 눈대중이면 안 됩니다 — 첫 판에서 두 군데를 틀렸고,
//   그 상태의 숫자를 하마터면 원인으로 보고할 뻔했습니다.
//
//   1. **지면이 새어 들어왔습니다.** 화각 62°(수직 반각 31°)에서 지평선은
//      화면 위에서부터 `(tan31 + tan(elev)) / (2*tan31)` 자리에 옵니다.
//      elev 22° 면 0.836 인데 sky 를 0.90 으로 뒀더니 아래 6% 가 새까만
//      지면이었고, 그게 박명 "대비"를 통째로 부풀렸습니다.
//   2. **태양이 화면 안에 있었습니다.** elev 28° · dAz 0 이면 태양(고도 0°)이
//      화면 아래 끝에 걸립니다. 대조하는 사진들은 태양을 안 넣고 찍은
//      것이라, 그대로 두면 렌더만 불리한 비교가 됩니다.
const CASES = [
  { tag:'day-cumulus',  sunAlt: 40, dAz:  90, elev: 35, sky:1.00,
    w:{ low:34, mid:16, high:12, hum:55, vis:32000 } },
  { tag:'day-cirrus',   sunAlt: 40, dAz:  90, elev: 35, sky:1.00,
    w:{ low: 4, mid: 8, high:62, hum:48, vis:35000 } },
  { tag:'day-zenith',   sunAlt: 30, dAz:   0, elev: 72, sky:1.00,
    w:{ low: 8, mid:52, high:38, hum:58, vis:28000 } },
  { tag:'day-overcast', sunAlt: 40, dAz:  90, elev: 30, sky:0.97,
    w:{ low:92, mid:88, high:70, hum:92, vis: 9000 } },
  { tag:'sunset',       sunAlt:  0, dAz:  45, elev: 28, sky:0.94,
    w:{ low:18, mid:56, high:34, hum:64, vis:24000 } },
  { tag:'twilight',     sunAlt: -6, dAz:   0, elev: 22, sky:0.83,
    w:{ low:12, mid:34, high:40, hum:66, vis:26000 } },
  { tag:'night',        sunAlt:-30, dAz:   0, elev: 35, sky:1.00,
    w:{ low:16, mid:38, high:30, hum:70, vis:22000 } },
];

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
 body{margin:0;background:#0b0f15;font-family:sans-serif;color:#dde}
 #wrap{position:relative;width:${TW * 3 + 24}px;padding:12px}
 .lbl{position:absolute;color:#fff;font-size:10px;font-family:monospace;
   pointer-events:none;line-height:1.35;background:rgba(6,10,16,.80);
   padding:3px 6px;border-radius:4px}
 h3{font-size:13px;margin:6px 0}
 .sub{font-size:11px;color:#8aa;margin:0 0 8px}
</style></head><body>
<div id="wrap">
<h3>사진 대조용 렌더 — 실제 하늘 사진과 같은 조건, 같은 지표</h3>
<p class="sub">수치는 __stats 에. 과녁은 .harness/photoref/photo-stats.json 입니다.</p>
<canvas id="c"></canvas><div id="labels"></div></div>
<script type="module">
import * as THREE from './app/vendor/three.module.js';
import { createSkydome, updateSkydome } from './app/components/SkyScene3D/Skydome.js';
import { createTerrainRing, createGroundPlane, updateTerrainColors, updateGroundColors,
         setGroundHorizon } from './app/components/SkyScene3D/TerrainRing.js';
import { createCloudSlab, updateCloudSlab, bakeCloudSlabCoverage }
  from './app/components/SkyScene3D/CloudSlab.js';
import { WeatherFan } from './app/utils/skyColumn.js';
import { makeAtmosphereParams, beamAtAltitude } from './app/utils/atmosphere.js';

const errors = [];
const oe = console.error;
console.error = (...a) => { errors.push(a.join(' ')); oe(...a); };

// ── tools/photo-ref/sky-stats.js 를 그대로 삽입 ─────────────────────
${STATS_SRC}
// ────────────────────────────────────────────────────────────────────

const TW=${TW}, TH=${TH}, SUN_AZ=${SUN_AZ};
const CASES=${JSON.stringify(CASES)};

const canvas = document.getElementById('c');
canvas.width = TW*3; canvas.height = TH*3;
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
  const W=(k)=>({ speedKmh:k, bearingDeg:260 });
  updateCloudSlab(slab, {
    camera: cam, widthPx: TW, heightPx: TH, sunDir,
    sunAltDeg: c.sunAlt, sunAzDeg: SUN_AZ, cityLight: 0.2,
    beamFor:(altKm)=>beamAtAltitude(c.sunAlt, altKm, atmosphere),
    atmosphere, layerWinds:{ low:W(22), mid:W(37), high:W(75) },
    driftHours: 6, visible:true });
  renderer.setRenderTarget(null);
  renderer.setClearColor(0x000000, 1);
  renderer.render(scene, cam);
  const buf=new Uint8Array(4*TW*TH);
  gl.readPixels(0,0,TW,TH,gl.RGBA,gl.UNSIGNED_BYTE,buf);
  return buf;
}
/** ⚠ readPixels 는 아래가 y=0. skyStats 는 위가 y=0 을 기대하므로 뒤집습니다. */
function flip(buf){
  const out=new Uint8Array(buf.length);
  for(let r=0;r<TH;r++) out.set(buf.subarray((TH-1-r)*TW*4, (TH-r)*TW*4), r*TW*4);
  return out;
}
function paint(buf,x,y){
  const img=ctx2d.createImageData(TW,TH);
  img.data.set(buf);
  ctx2d.putImageData(img,x,y);
}

const 결과=[];
CASES.forEach((c,i)=>{
  bake(c.w);
  const top = flip(shoot(c));
  const s = skyStats(top, TW, TH, { skyFrac: c.sky });
  // 렌더의 가로 화각은 62° 입니다 — 사진 쪽 중앙값(63~67°)과 같은 대역이라
  // 각도로 환산한 크기·모양을 바로 견줄 수 있습니다.
  const sp = angularSpectrum(top, TW, TH, { skyFrac: c.sky, fovDeg: 62 }) || {};
  결과.push({ tag:c.tag, ...s, ...sp });
  paint(top, (i%3)*TW, Math.floor(i/3)*TH);
  const d=document.createElement('div');
  d.className='lbl'; d.style.left=((i%3)*TW+10)+'px'; d.style.top=(Math.floor(i/3)*TH+40)+'px';
  d.innerHTML=c.tag+'<br>채도 '+s.채도+'<br>국소 '+s.국소대비
             +'<br>구름각크기 '+sp.구름각크기+'°<br>무늬기울기 '+sp.무늬기울기;
  labels.appendChild(d);
});

window.__stats={ glError:gl.getError(), 결과 };
window.__errors=errors;
document.title='DONE::'+(errors.length?'SHADER_ERR':'OK')+'::'+gl.getError();
</script></body></html>`;

fs.mkdirSync(PREVIEW, { recursive: true });
fs.writeFileSync(path.join(PREVIEW, 'photo-match.html'), html);
console.log('생성 완료: photo-match.html');
