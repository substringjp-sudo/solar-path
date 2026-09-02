/**
 * **QR 로 조건을 아는 실제 장면을 그대로 렌더합니다** — 유일한 1:1 대조.
 *
 * 위키미디어 사진은 언제·어디서·어떤 예보였는지 모릅니다. 사용자가 찍은
 * 사진은 같은 순간의 QR 이 붙어 있어 **같은 입력을 넣은 렌더와 나란히**
 * 놓을 수 있습니다.
 *
 *   2026-09-02 18:45 KST, 37.2583 / 127.0539, 고도 34m
 *   태양 고도 +2.26°, 방위 278.35°
 *   운량 저 9% / 중 3% / 상 52%, 습도 89%, 시정 14,275m
 *
 * 사용자가 그 하늘에서 본 것(사진 두 장, 태양쪽과 반대편):
 *   - 앞의 뭉게구름은 태양면만 주황, 나머지는 보라에 가까움
 *   - 어떤 구름은 통째로 회색
 *   - 상층운은 해가 거의 졌는데도 아직 흰색
 *   - 반대편은 빛이 많이 들어와 백색에 가깝고, 지구 그림자 쪽은 어두워짐
 *
 * 이건 전부 **조명**이지 무늬가 아닙니다. 그래서 lightingStats 로 잽니다.
 *
 * 준비: node tools/shader-preview/stage-esm.js
 * 사용: node tools/shader-preview/build-qr-scene.js
 *       node tools/shader-preview/shoot.js qr-scene.html qr-scene.png 60
 */
const fs = require('fs');
const path = require('path');
const { PREVIEW } = require('./paths');

const STATS_SRC = fs.readFileSync(
  path.join(__dirname, '../photo-ref/sky-stats.js'), 'utf8')
  .replace(/if \(typeof module[\s\S]*$/, '');

const TW = 380, TH = 380;
// QR 디코드 값 그대로입니다 — 지어낸 값이 하나도 없습니다.
const QR = {
  lat: 37.2583, lon: 127.0539, elevM: 34,
  sunAlt: 2.26, sunAz: 278.35,
  low: 9, mid: 3, high: 52, humidity: 89, vis: 14275,
  windKmh: 6.7, windDeg: 61.3,
};
// 앱 화면의 화각이 55° 입니다. 시선 고도는 사진이 올려다본 각도에 맞춥니다.
const VIEWS = [
  { name: '태양쪽',  dAz: 0,   elev: 34 },
  { name: '반대편',  dAz: 180, elev: 30 },
];

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
 body{margin:0;background:#0b0f15;font-family:sans-serif;color:#dde}
 #wrap{position:relative;width:${TW * 2 + 24}px;padding:12px}
 .lbl{position:absolute;color:#fff;font-size:11px;font-family:monospace;
   pointer-events:none;line-height:1.4;background:rgba(6,10,16,.82);
   padding:4px 7px;border-radius:4px}
 h3{font-size:13px;margin:6px 0}
 .sub{font-size:11px;color:#8aa;margin:0 0 8px}
</style></head><body>
<div id="wrap">
<h3>QR 장면 재현 — 2026-09-02 18:45 KST, 태양 +2.26° / 278°, 저9 중3 상52</h3>
<p class="sub">왼쪽 태양쪽, 오른쪽 반대편. 사용자 사진과 같은 순간·같은 예보입니다.</p>
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

const TW=${TW}, TH=${TH};
const QR=${JSON.stringify(QR)};
const VIEWS=${JSON.stringify(VIEWS)};

const canvas = document.getElementById('c');
canvas.width = TW*2; canvas.height = TH;
const ctx2d = canvas.getContext('2d');
const glCanvas = document.createElement('canvas');
glCanvas.width = TW; glCanvas.height = TH;
const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias:false, alpha:false });
renderer.setPixelRatio(1); renderer.setSize(TW, TH, false);

const scene = new THREE.Scene();
const skydome = createSkydome(); scene.add(skydome.mesh);
const angles=[]; for(let i=0;i<72;i++) angles.push(0.4+0.9*Math.sin(i*0.21)+0.5*Math.sin(i*0.07+1.3));
const terrain = createTerrainRing(angles); scene.add(terrain);
const ground = createGroundPlane(); setGroundHorizon(ground, 30); scene.add(ground);
const slab = createCloudSlab(); slab.mesh.renderOrder = 10; scene.add(slab.mesh);
const gl = renderer.getContext();
const labels = document.getElementById('labels');

// 관측점 예보만 알고 주변은 모릅니다 — 앱이 실제로 처하는 상황과 같게,
// 고리에는 관측점 값에 완만한 흔들림만 줍니다.
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
  latitude: QR.lat, observerElevM: QR.elevM, dayOfYear: 245,
  humidityPct: QR.humidity, visibilityM: QR.vis });

function shoot(v){
  const cam = new THREE.PerspectiveCamera(55, TW/TH, 0.1, 2000);
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
    sunAltDeg:QR.sunAlt, sunAzDeg:QR.sunAz, cityLight:0.55,
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

const 결과=[];
const SWEEP=[0.0, 0.35, 0.6, 0.85];
SWEEP.forEach(sh=>{ VIEWS.forEach((v,i)=>{
  resetTuning(); setTuning({ msAzimWash: sh });
  const top = shoot(v);
  // 화각 55°, 시선 고도로 지평선 아래를 잘라 냅니다.
  const horiz = (Math.tan(27.5*Math.PI/180) + Math.tan(v.elev*Math.PI/180))
              / (2*Math.tan(27.5*Math.PI/180));
  const sky = Math.min(0.99, Math.max(0.3, horiz - 0.03));
  const s = skyStats(top, TW, TH, { skyFrac: sky });
  const l = lightingStats(top, TW, TH, { skyFrac: sky });
  const prof = warmthProfile(top, TW, TH, { skyFrac: sky, bands: 5 });
  결과.push({ SH:sh, 방향:v.name, 하늘비율:+sky.toFixed(2), 따뜻함프로파일:prof, ...s, ...l });
  if (sh === 0.0) { const img=ctx2d.createImageData(TW,TH); img.data.set(top); ctx2d.putImageData(img, i*TW, 0); }
  const d=document.createElement('div');
  d.className='lbl'; d.style.left=(i*TW+10)+'px'; d.style.top='58px';
  d.innerHTML=v.name+'<br>채도 '+s.채도+'<br>국소대비 '+s.국소대비
    +'<br>밝은쪽따뜻함 '+l.밝은쪽따뜻함+'<br>어두운쪽따뜻함 '+l.어두운쪽따뜻함
    +'<br>따뜻함폭 '+l.따뜻함폭
    +'<br>프로파일 '+prof.join(' ');
  if (sh === 0.0) labels.appendChild(d);
}); });
resetTuning();

window.__stats={ glError:gl.getError(), 결과 };
window.__errors=errors;
document.title='DONE::'+(errors.length?'SHADER_ERR':'OK')+'::'+gl.getError();
</script></body></html>`;

fs.mkdirSync(PREVIEW, { recursive: true });
fs.writeFileSync(path.join(PREVIEW, 'qr-scene.html'), html);
console.log('생성 완료: qr-scene.html');
