/**
 * **구름 군집 — 먼 하늘이 살아나는가** (계획 37절).
 *
 * 사용자 지적: "먼거리의 구름이 갈수록 작게 보이고 뭉쳐있다."
 *
 * 원근으로 작아지는 것 자체는 옳습니다. 모자란 것은 **큰 규모**입니다 —
 * `slab_fbm` 이 셀에서 시작해 더 잘게만 가므로 이 필드의 최대 특징이
 * 저층 3.3km 뿐이고, 고도 5°에서 그건 가로 11°·세로 0.95° 짜리 얇은
 * 조각이라 여럿이 겹쳐 균일한 띠로 뭉갭니다.
 *
 * 지평선을 향해 보고, **화면 아래 3분의 1**(먼 하늘)의 구름각크기를
 * 잽니다. 군집이 들어오면 그 값이 커져야 합니다.
 *
 * 사용: node tools/shader-preview/build-cloud-cluster.js
 *       node tools/shader-preview/shoot.js cloud-cluster.html cloud-cluster.png 40000
 */
const fs = require('fs');
const path = require('path');
const { PREVIEW } = require('./paths');

const STATS_SRC = fs.readFileSync(
  path.join(__dirname, '../photo-ref/sky-stats.js'), 'utf8')
  .replace(/if \(typeof module[\s\S]*$/, '');

const TW = 460, TH = 340;
const FOV_DEG = 70;                 // 실기기 화면과 같은 화각
const VIEW_ELEV = 12;               // 지평선을 담되 먼 하늘이 넓게 들어오게
const SUN_ALT = 12.76, SUN_AZ = 90.35;
const VIEW_AZ = SUN_AZ + 90;
const CASES = [
  { name: '군집 없음 (전)',   amt: 0.0, mul: 3 },
  { name: '군집 0.7 (채택)',  amt: 0.7, mul: 3 },
  { name: '군집 1.0',         amt: 1.0, mul: 3 },
];

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
 body{margin:0;background:#0b0f15;font-family:sans-serif;color:#dde}
 #wrap{position:relative;width:${TW * CASES.length + 24}px;padding:12px}
 .lbl{position:absolute;color:#fff;font-size:11px;font-family:monospace;
   pointer-events:none;line-height:1.45;background:rgba(6,10,16,.85);
   padding:4px 7px;border-radius:4px}
 h3{font-size:13px;margin:6px 0}
 .sub{font-size:11px;color:#8aa;margin:0 0 8px}
</style></head><body>
<div id="wrap">
<h3>구름 군집 — 화각 70°, 시선 고도 12°, 지평선 쪽 먼 하늘</h3>
<p class="sub">아래쪽 라벨은 화면 **아래 3분의 1**(먼 하늘)에서만 잰 값입니다. 군집이 들어오면 구름각크기가 커져야 합니다.</p>
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
${STATS_SRC}

const TW=${TW}, TH=${TH}, FOV_DEG=${FOV_DEG};
const VIEW_ELEV=${VIEW_ELEV}, SUN_ALT=${SUN_ALT}, SUN_AZ=${SUN_AZ}, VIEW_AZ=${VIEW_AZ};
const CASES=${JSON.stringify(CASES)};

const canvas=document.getElementById('c');
canvas.width=TW*CASES.length; canvas.height=TH;
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

// 아침 QR 실측 예보 그대로 (저 15% 는 너무 성겨 먼 하늘 구조가 안 보이므로
// 이 습작만 저층을 40% 로 올립니다 — 군집의 유무를 보는 것이 목적입니다).
const OFFSETS=[-180,-150,-120,-90,-60,-30,0,30,60,90,120,150,180];
const DISTS=[5,12,30,70,160,360];
const jit=(v,d,a)=>Math.max(0,Math.min(100, v+16*Math.sin(d*0.031+a*0.017)+11*Math.cos(d*0.017-a*0.026)));
const pts=[{distance:0,azimuthOffset:0,low:40,mid:20,high:0,humidity:79,precipitation:0,visibility:17960}];
for(const off of OFFSETS) for(const d of DISTS)
  pts.push({distance:d,azimuthOffset:off,low:jit(40,d,off),mid:jit(20,d,off+40),
            high:0,humidity:79,precipitation:0});
const fan=new WeatherFan(pts,SUN_AZ);
bakeCloudSlabCoverage(slab,(azDeg,distKm)=>{const {data,confidence}=fan.sample(azDeg,distKm);
  if(!data) return {low:0,mid:0,high:0,confidence:0};
  return {low:data.low/100,mid:data.mid/100,high:data.high/100,
          confidence:Math.max(0,Math.min(1,confidence))};});

const atm=makeAtmosphereParams({latitude:37.47,observerElevM:24,dayOfYear:247,
  humidityPct:79,visibilityM:17960});

function shoot(c){
  const cam=new THREE.PerspectiveCamera(FOV_DEG,TW/TH,0.1,2000);
  cam.position.set(0,0,0); cam.up.set(0,1,0);
  const az=VIEW_AZ*Math.PI/180, er=VIEW_ELEV*Math.PI/180;
  cam.lookAt(100*Math.cos(er)*Math.sin(az),100*Math.sin(er),-100*Math.cos(er)*Math.cos(az));
  cam.updateMatrixWorld(true);
  const a=SUN_ALT*Math.PI/180, z=SUN_AZ*Math.PI/180;
  const sunDir=new THREE.Vector3(Math.cos(a)*Math.sin(z),Math.sin(a),-Math.cos(a)*Math.cos(z)).normalize();
  applyTuningUniforms(skydome.mesh.material.uniforms);
  updateSkydome(skydome,SUN_ALT,SUN_AZ,atm);
  applyTuningUniforms(skydome.mesh.material.uniforms);
  updateTerrainColors(terrain,SUN_ALT,SUN_AZ,atm);
  updateGroundColors(ground,SUN_ALT,SUN_AZ,atm);
  updateCloudSlab(slab,{camera:cam,widthPx:TW,heightPx:TH,sunDir,
    sunAltDeg:SUN_ALT,sunAzDeg:SUN_AZ,cityLight:0,
    beamFor:(altKm)=>beamAtAltitude(SUN_ALT,altKm,atm),atmosphere:atm,
    layerWinds:{low:{speedKmh:15.5,bearingDeg:114},mid:{speedKmh:34,bearingDeg:99},
                high:{speedKmh:77,bearingDeg:84}},
    driftHours:0,visible:true, clusterAmt:c.amt, clusterMul:c.mul});
  applyTuningUniforms(slab.mesh.material.uniforms);
  renderer.setRenderTarget(null); renderer.setClearColor(0x000000,1);
  renderer.render(scene,cam);
  const buf=new Uint8Array(4*TW*TH);
  gl.readPixels(0,0,TW,TH,gl.RGBA,gl.UNSIGNED_BYTE,buf);
  const out=new Uint8Array(buf.length);
  for(let r=0;r<TH;r++) out.set(buf.subarray((TH-1-r)*TW*4,(TH-r)*TW*4), r*TW*4);
  return out;
}

/** 화면 아래쪽 띠만 잘라 냅니다 — 시선 고도보다 낮은 = 먼 하늘. */
function lowerBand(buf, from, to){
  const y0=Math.floor(TH*from), y1=Math.floor(TH*to), H=y1-y0;
  const out=new Uint8Array(TW*H*4);
  out.set(buf.subarray(y0*TW*4, y1*TW*4));
  return {data:out,H};
}

const 결과=[];
CASES.forEach((c,i)=>{
  const img=shoot(c);
  // 지평선 위 먼 하늘 — 지형(맨 아래)은 빼고 그 위 띠만.
  const band=lowerBand(img, 0.42, 0.72);
  const sp=angularSpectrum(band.data, TW, band.H, { fovDeg: FOV_DEG }) || {};
  const s=skyStats(band.data, TW, band.H, {});
  결과.push({이름:c.name, 구름각크기:sp.구름각크기 ?? null, 무늬기울기:sp.무늬기울기 ?? null,
             국소대비:s.국소대비, 밝기폭:s.밝기폭});
  const im=ctx2d.createImageData(TW,TH); im.data.set(img); ctx2d.putImageData(im,i*TW,0);
  const d=document.createElement('div'); d.className='lbl';
  d.style.left=(i*TW+8)+'px'; d.style.top='8px';
  d.innerHTML=c.name
    +'<br><b>먼 하늘 구름각크기 '+(sp.구름각크기 ?? '—')+'°</b>'
    +'<br>무늬기울기 '+(sp.무늬기울기 ?? '—')
    +'<br>국소대비 '+s.국소대비+' · 밝기폭 '+s.밝기폭;
  labels.appendChild(d);
});

window.__stats={glError:gl.getError(), 결과};
window.__errors=errors;
document.title='DONE::'+(errors.length?'SHADER_ERR':'OK')+'::'+gl.getError();
</script></body></html>`;

fs.mkdirSync(PREVIEW, { recursive: true });
fs.writeFileSync(path.join(PREVIEW, 'cloud-cluster.html'), html);
console.log('생성 완료: cloud-cluster.html');
