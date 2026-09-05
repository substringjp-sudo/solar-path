/**
 * **면적은 운량이, 두께는 물리가** — 문턱형 모양장 훑기 (계획 41절).
 *
 * 두 가지를 **동시에** 만족해야 합니다.
 *
 *  1. **면적 보존** — 렌더된 트인하늘이 (1 - 운량) 을 따라가야 합니다.
 *     이걸 놓치면 예보가 화면까지 못 옵니다.
 *  2. **불투명** — 맑은 날 적운은 낱개로 떨어진 불투명 덩어리입니다.
 *     예전 식은 구름 화소의 1.6~8.4% 만 불투명했습니다.
 *
 * 훑는 것은 문턱 A·B 와 이득 G 입니다: thr = A - B*cover, d = (f-thr)*G.
 *
 * 사용: node tools/shader-preview/build-shape-sweep.js
 *       node tools/shader-preview/shoot.js shape-sweep.html shape-sweep.png 150000
 */
const fs = require('fs');
const path = require('path');
const { PREVIEW } = require('./paths');

const TW = 200, TH = 200;
const COVERS = [10, 25, 50, 75, 95];
const CASES = [
  { name: '저층 예전',  layer: 'low',  shape: 'legacy' },
  { name: '저층 σ.115', layer: 'low',  shape: 'threshold', sig: 0.115 },
  { name: '저층 σ.16',  layer: 'low',  shape: 'threshold', sig: 0.16 },
  { name: '저층 σ.22',  layer: 'low',  shape: 'threshold', sig: 0.22 },
  { name: '중층 σ.16',  layer: 'mid',  shape: 'threshold', sig: 0.16 },
  { name: '고층 σ.16',  layer: 'high', shape: 'threshold', sig: 0.16 },
];

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
 body{margin:0;background:#0b0f15;font-family:sans-serif;color:#dde}
 #wrap{position:relative;width:${TW * COVERS.length + 24}px;padding:12px}
 .lbl{position:absolute;color:#fff;font-size:9px;font-family:monospace;
   pointer-events:none;line-height:1.35;background:rgba(6,10,16,.85);
   padding:2px 4px;border-radius:3px}
 h3{font-size:13px;margin:6px 0}
 .sub{font-size:11px;color:#8aa;margin:0 0 8px}
</style></head><body>
<div id="wrap">
<h3>문턱형 모양장 — 면적은 운량을 따라가고, 덩어리는 불투명한가</h3>
<p class="sub">가로: 저층 운량 10/25/50/75/95%. 세로: 후보. 트인하늘이 (1-운량)에 가깝고 불투명비가 클수록 좋습니다.</p>
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
const TW=${TW}, TH=${TH};
const COVERS=${JSON.stringify(COVERS)}, CASES=${JSON.stringify(CASES)};
// ⚠ 시선을 기울이면 화면 아래쪽이 지평선을 향해 층을 **스치듯** 지나므로
// 겉보기 운량이 실제보다 큽니다. 예보 운량과 1:1 로 견주려면 천정 근처를
// 좁은 화각으로 봐야 합니다 — 여기서는 67~97도, 빗변 계수 1.05 입니다.
const SUN_ALT=40, SUN_AZ=180, VIEW_ELEV=82, FOV=30;

const canvas=document.getElementById('c');
canvas.width=TW*COVERS.length; canvas.height=TH*CASES.length;
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
const atm=makeAtmosphereParams({latitude:37.5,observerElevM:24,dayOfYear:247,
  humidityPct:55,visibilityM:30000});

const OFFSETS=[-180,-120,-60,0,60,120,180], DISTS=[5,12,30,70,160,360];
/** 저층만 씁니다 — 층이 겹치면 면적 판정이 흐려집니다. */
function bake(cv, layer){
  const one=(v)=>({low:layer==='low'?v:0, mid:layer==='mid'?v:0, high:layer==='high'?v:0});
  const pts=[{distance:0,azimuthOffset:0,...one(cv),humidity:55,precipitation:0,visibility:30000}];
  for(const off of OFFSETS) for(const d of DISTS)
    pts.push({distance:d,azimuthOffset:off,...one(cv),humidity:55,precipitation:0});
  const fan=new WeatherFan(pts,SUN_AZ);
  bakeCloudSlabCoverage(slab,(azDeg,distKm)=>{const {data,confidence}=fan.sample(azDeg,distKm);
    if(!data) return {low:0,mid:0,high:0,confidence:0};
    return {low:data.low/100,mid:data.mid/100,high:data.high/100,
            confidence:Math.max(0,Math.min(1,confidence))};});
}

function shoot(c){
  const cam=new THREE.PerspectiveCamera(FOV,TW/TH,0.1,2000);
  cam.position.set(0,0,0); cam.up.set(0,1,0);
  const az=(SUN_AZ+90)*Math.PI/180, er=VIEW_ELEV*Math.PI/180;
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
    layerWinds:{low:{speedKmh:12,bearingDeg:270},mid:{speedKmh:28,bearingDeg:255},
                high:{speedKmh:70,bearingDeg:240}},
    driftHours:0,visible:true,
    cloudShape:c.shape, shapeSigma:c.sig});
  applyTuningUniforms(slab.mesh.material.uniforms);
  renderer.setRenderTarget(null); renderer.setClearColor(0x000000,1);
  renderer.render(scene,cam);
  const buf=new Uint8Array(4*TW*TH);
  gl.readPixels(0,0,TW,TH,gl.RGBA,gl.UNSIGNED_BYTE,buf);
  const out=new Uint8Array(buf.length);
  for(let r=0;r<TH;r++) out.set(buf.subarray((TH-1-r)*TW*4,(TH-r)*TW*4), r*TW*4);
  return out;
}

const lum=(b,p)=>0.2126*b[p]+0.7152*b[p+1]+0.0722*b[p+2];
/** 세기장을 절대 기준으로 봅니다 — 판마다 최대로 정규화하면 비교가 안 됩니다. */
function metrics(withC,noC){
  let clear=0, on=0, solid=0;
  for(let i=0;i<TW*TH;i++){const p=i*4;
    const v=Math.abs(lum(withC,p)-lum(noC,p));
    if(v<6) clear++;
    if(v>18){on++; if(v>60) solid++;}}
  const N=TW*TH;
  return {트인하늘:+(clear/N).toFixed(3), 구름면적:+(on/N).toFixed(3),
          불투명비:+(solid/Math.max(1,on)).toFixed(3)};
}

const 결과=[];
CASES.forEach((c,row)=>{
  COVERS.forEach((cv,col)=>{
    bake(cv, c.layer);
    const on=shoot(c);
    const savedTex=slab.material.uniforms.uCoverTex.value;
    const blank=new THREE.DataTexture(new Uint8Array(savedTex.image.width*savedTex.image.height*4),
      savedTex.image.width,savedTex.image.height,THREE.RGBAFormat);
    blank.minFilter=THREE.LinearFilter; blank.magFilter=THREE.LinearFilter; blank.needsUpdate=true;
    slab.material.uniforms.uCoverTex.value=blank;
    const bare=shoot(c);
    slab.material.uniforms.uCoverTex.value=savedTex;
    const m=metrics(on,bare);
    결과.push({후보:c.name, 운량:cv, ...m, 면적오차:+(m.구름면적-cv/100).toFixed(3)});
    const im=ctx2d.createImageData(TW,TH); im.data.set(on); ctx2d.putImageData(im,col*TW,row*TH);
    const d=document.createElement('div'); d.className='lbl';
    d.style.left=(col*TW+4)+'px'; d.style.top=(row*TH+4)+'px';
    d.innerHTML=c.name+' · '+cv+'%'
      +'<br>면적 '+m.구름면적+' (오차 '+(m.구름면적-cv/100).toFixed(2)+')'
      +'<br><b>불투명 '+m.불투명비+'</b>';
    labels.appendChild(d);
  });
});
window.__stats={glError:gl.getError(), 결과};
window.__errors=errors;
document.title='DONE::'+(errors.length?'SHADER_ERR':'OK')+'::'+gl.getError();
</script></body></html>`;

fs.mkdirSync(PREVIEW, { recursive: true });
fs.writeFileSync(path.join(PREVIEW, 'shape-sweep.html'), html);
console.log('생성 완료: shape-sweep.html');
