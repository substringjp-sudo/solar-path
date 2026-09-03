/**
 * **근거리 볼륨 이음매 진단** — 켬/끔을 같은 노을 장면에서 나란히 놓고,
 * 사용자가 지적한 "어두운 부분과 밝은 부분의 경계가 이상하다"가 여기서
 * 오는지 봅니다. 장면은 build-sunset-gap.js 와 같습니다.
 *
 * 사용: node tools/shader-preview/build-nf-seam-check.js
 */
const fs = require('fs');
const path = require('path');
const { PREVIEW } = require('./paths');

const TW = 700, TH = 700;
const FOV_DEG = 62;
const VIEW_AZ = 262, VIEW_ELEV = 14, SUN_AZ = 268;
const SUNS = [-3];

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
 body{margin:0;background:#0b0f15;font-family:sans-serif;color:#dde}
 #wrap{position:relative;width:${TW * 3 + 24}px;padding:12px}
 .lbl{position:absolute;color:#fff;font-size:11px;font-family:monospace;
   pointer-events:none;line-height:1.4;background:rgba(6,10,16,.78);
   padding:4px 7px;border-radius:4px}
 h3{font-size:13px;margin:6px 0}
 .sub{font-size:11px;color:#8aa;margin:0 0 8px}
</style></head><body>
<div id="wrap">
<h3>근거리 볼륨 켬/끔 — 노을 경계가 볼륨 이음매에서 오는가</h3>
<p class="sub">가로: 근거리 볼륨 켬(기본) / 끔(예전 껍질만) / 차이(절대값 ×3)</p>
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

const TW=${TW}, TH=${TH}, FOV_DEG=${FOV_DEG};
const VIEW_AZ=${VIEW_AZ}, VIEW_ELEV=${VIEW_ELEV}, SUN_AZ=${SUN_AZ};
const SUNS=${JSON.stringify(SUNS)};

const canvas = document.getElementById('c');
canvas.width = TW*3; canvas.height = TH*SUNS.length;
const ctx2d = canvas.getContext('2d');
const glCanvas = document.createElement('canvas');
glCanvas.width = TW; glCanvas.height = TH;
const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias:false, alpha:false });
renderer.setPixelRatio(1); renderer.setSize(TW, TH, false);

const atmosphere = makeAtmosphereParams({
  latitude: 37.5, observerElevM: 30, dayOfYear: 240, humidityPct: 62, visibilityM: 24000 });

const scene = new THREE.Scene();
const skydome = createSkydome(); scene.add(skydome.mesh);
const angles = [];
for (let i=0;i<72;i++) angles.push(0.4 + 0.9*Math.sin(i*0.21) + 0.5*Math.sin(i*0.07+1.3));
const terrain = createTerrainRing(angles); scene.add(terrain);
const ground = createGroundPlane(); setGroundHorizon(ground, 30); scene.add(ground);
const slab = createCloudSlab(); slab.mesh.renderOrder = 10; scene.add(slab.mesh);

function h21(x,y){ const s=Math.sin(x*127.1+y*311.7)*43758.5453; return s-Math.floor(s); }
function vn(x,y){
  const ix=Math.floor(x), iy=Math.floor(y);
  let fx=x-ix, fy=y-iy; fx=fx*fx*(3-2*fx); fy=fy*fy*(3-2*fy);
  const a=h21(ix,iy), b=h21(ix+1,iy), c=h21(ix,iy+1), d=h21(ix+1,iy+1);
  const t=a+(b-a)*fx; return t + ((c+(d-c)*fx)-t)*fy;
}
function fbmJS(x,y,o){ let s=0,a=0.5,n=0; for(let i=0;i<o;i++){ s+=a*vn(x,y); n+=a; x=x*2.03+7.1; y=y*2.03+3.7; a*=0.5; } return s/n; }
const MEAN={low:0.28,mid:0.42,high:0.30}, SC={low:26,mid:42,high:72}, OFF={low:0,mid:51.3,high:97.7};
const truth=(L,x,z)=>Math.max(0,Math.min(1, MEAN[L] + (fbmJS(x/SC[L]+OFF[L], z/SC[L]+OFF[L],4)-0.5)*2.4));
const OFFSETS=[-180,-150,-120,-90,-60,-30,0,30,60,90,120,150,180];
const DISTS=[2,5,12,30,70,160,360];
const pts=[{ distance:0, azimuthOffset:0, low:truth('low',0,0)*100, mid:truth('mid',0,0)*100,
             high:truth('high',0,0)*100, humidity:62, precipitation:0, visibility:24000 }];
for (const off of OFFSETS) for (const d of DISTS){
  const a=(SUN_AZ+off)*Math.PI/180, x=d*Math.sin(a), z=-d*Math.cos(a);
  pts.push({ distance:d, azimuthOffset:off, low:truth('low',x,z)*100,
             mid:truth('mid',x,z)*100, high:truth('high',x,z)*100, humidity:62, precipitation:0 });
}
const fan = new WeatherFan(pts, SUN_AZ);
const src = (azDeg, distKm) => {
  const { data, confidence } = fan.sample(azDeg, distKm);
  if (!data) return { low:0, mid:0, high:0, confidence:0 };
  return { low:data.low/100, mid:data.mid/100, high:data.high/100,
           confidence: Math.max(0, Math.min(1, confidence)) };
};
bakeCloudSlabCoverage(slab, src);

const cam = new THREE.PerspectiveCamera(FOV_DEG, TW/TH, 0.1, 2000);
cam.position.set(0,0,0); cam.up.set(0,1,0);
{
  const ar=VIEW_AZ*Math.PI/180, er=VIEW_ELEV*Math.PI/180;
  cam.lookAt(100*Math.cos(er)*Math.sin(ar), 100*Math.sin(er), -100*Math.cos(er)*Math.cos(ar));
  cam.updateMatrixWorld(true);
}
const gl = renderer.getContext();
const labels = document.getElementById('labels');

function shootRaw(sunAlt, nfEnabled){
  const a=sunAlt*Math.PI/180, z=SUN_AZ*Math.PI/180;
  const sunDir=new THREE.Vector3(Math.cos(a)*Math.sin(z), Math.sin(a), -Math.cos(a)*Math.cos(z)).normalize();
  updateSkydome(skydome, sunAlt, SUN_AZ, atmosphere);
  updateTerrainColors(terrain, sunAlt, SUN_AZ, atmosphere);
  updateGroundColors(ground, sunAlt, SUN_AZ, atmosphere);
  const W=(k)=>({ speedKmh:k, bearingDeg:260 });
  updateCloudSlab(slab, { camera:cam, widthPx:TW, heightPx:TH, sunDir,
    sunAltDeg:sunAlt, sunAzDeg:SUN_AZ,
    beamFor:(altKm)=>beamAtAltitude(sunAlt, altKm, atmosphere),
    atmosphere, layerWinds:{ low:W(22), mid:W(37), high:W(75) },
    driftHours:0, cityLight:0, nfEnabled, visible:true });
  renderer.setRenderTarget(null);
  renderer.setClearColor(0x000000, 1);
  renderer.render(scene, cam);
  const buf=new Uint8Array(4*TW*TH);
  gl.readPixels(0,0,TW,TH,gl.RGBA,gl.UNSIGNED_BYTE,buf);
  return buf;
}
function paint(buf,x,y){
  const img=ctx2d.createImageData(TW,TH);
  const flip=new Uint8ClampedArray(buf.length);
  for(let r=0;r<TH;r++) flip.set(buf.subarray((TH-1-r)*TW*4,(TH-r)*TW*4), r*TW*4);
  img.data.set(flip); ctx2d.putImageData(img,x,y);
}

/** 세로 한 줄씩 평균 휘도 — 경계가 어느 화면 행(고도)에서 지는지 잡습니다. */
function rowProfile(buf){
  const out=[];
  for(let y=0;y<TH;y++){ let s=0;
    for(let x=0;x<TW;x++){ const p=(y*TW+x)*4; s+=0.2126*buf[p]+0.7152*buf[p+1]+0.0722*buf[p+2]; }
    out.push(+(s/TW).toFixed(1));
  }
  return out;  // y=0 이 화면 맨 아래(readPixels 관례).
}
window.__profiles = {};

SUNS.forEach((sunAlt,row)=>{
  const on = shootRaw(sunAlt, true);
  const off = shootRaw(sunAlt, false);
  window.__profiles['sun'+sunAlt] = { on: rowProfile(on), off: rowProfile(off) };
  const diff = new Uint8Array(TW*TH*4);
  for(let i=0;i<TW*TH;i++){ const p=i*4;
    diff[p]=Math.min(255,Math.abs(on[p]-off[p])*3);
    diff[p+1]=Math.min(255,Math.abs(on[p+1]-off[p+1])*3);
    diff[p+2]=Math.min(255,Math.abs(on[p+2]-off[p+2])*3);
    diff[p+3]=255;
  }
  paint(on, 0, row*TH);
  paint(off, TW, row*TH);
  paint(diff, TW*2, row*TH);
  [['근거리 볼륨 켬','태양 '+sunAlt+'°'],['근거리 볼륨 끔',''],['차이 ×3','']].forEach((t,i)=>{
    const d=document.createElement('div'); d.className='lbl';
    d.style.left=(i*TW+8)+'px'; d.style.top=(row*TH+8)+'px';
    d.innerHTML=t[0]+(t[1]?'<br>'+t[1]:'');
    labels.appendChild(d);
  });
});

window.__errors = errors;
document.title = 'DONE::' + (errors.length ? 'SHADER_ERR' : 'OK') + '::' + gl.getError();
</script></body></html>`;

fs.mkdirSync(PREVIEW, { recursive: true });
fs.writeFileSync(path.join(PREVIEW, 'nf-seam-check.html'), html);
console.log('생성 완료: nf-seam-check.html');
