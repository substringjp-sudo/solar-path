/**
 * **ACES vs AgX** (계획 42절 0단계).
 *
 * 사용자 화면 5장 중 셋(올리브 새벽 · 겨자 노을 · 뭉갠 지평선)의 원인을
 * 실측했더니 톤매핑 어깨였습니다. 태양 10도·이격 15도에서:
 *
 *   고도  1도  선형L 3.39  →  ACES 0.93 0.92 0.86 (채도 0.08)
 *   고도 12도  선형L 2.44  →  ACES 0.88 0.88 0.83 (채도 0.06)
 *
 * 선형 휘도가 1.4배 차이인데 화면에서는 거의 같습니다. **계조가 통째로
 * 사라진 것**이고, 채도 0.06~0.08 이면 색상각은 의미 없이 튑니다 —
 * 사용자가 "올리브·청록"이라 부른 것이 그 튐입니다.
 *
 * 재는 것:
 *  - **밝은쪽계조** — 상위 30% 밝기 화소의 휘도 p90-p10. 어깨에서 눌리면 0 에
 *    가까워집니다.
 *  - **무채색비율** — 채도 0.12 아래 화소의 비율. 회록·회백이 여기 잡힙니다.
 *  - **색상변화** — 채도 있는 화소의 색상각 원형 표준편차(sky-stats 와 동일).
 *  - 평균채도 · 평균휘도.
 *
 * 사용: node tools/shader-preview/build-tonemap-ab.js
 *       node tools/shader-preview/shoot.js tonemap-ab.html tonemap-ab.png 120000
 *       node tools/shader-preview/verify-tonemap-ab.js
 */
const fs = require('fs');
const path = require('path');
const { PREVIEW } = require('./paths');

const TW = 260, TH = 260;
const FOV = 66;

/** 사용자 화면 5장이 있던 자리를 그대로 씁니다. */
const SCENES = [
  { key: '새벽 NE',   sunAlt: -3,  sunAz: 68,  viewAz: 55,  elev: 10,
    low: 30, mid: 25, high: 20, hum: 70, vis: 20000 },
  { key: '일출 E',    sunAlt: 4,   sunAz: 88,  viewAz: 88,  elev: 10,
    low: 25, mid: 20, high: 15, hum: 65, vis: 24000 },
  { key: '한낮 좁은', sunAlt: 55,  sunAz: 180, viewAz: 175, elev: 30,
    low: 20, mid: 10, high: 5,  hum: 50, vis: 30000 },
  { key: '일몰 W',    sunAlt: 0,   sunAz: 274, viewAz: 274, elev: 8,
    low: 30, mid: 20, high: 25, hum: 68, vis: 20000 },
  { key: '박명 W',    sunAlt: -5,  sunAz: 278, viewAz: 265, elev: 12,
    low: 30, mid: 22, high: 20, hum: 72, vis: 18000 },
];
const CURVES = [
  { name: 'ACES 노출0.62 (예전)', tm: 'aces', expo: 0.62 },
  { name: 'AgX 노출0.90 (채택)',  tm: 'agx',  expo: 0.90 },
];

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
 body{margin:0;background:#0b0f15;font-family:sans-serif;color:#dde}
 #wrap{position:relative;width:${TW * CURVES.length + 24}px;padding:12px}
 .lbl{position:absolute;color:#fff;font-size:10px;font-family:monospace;
   pointer-events:none;line-height:1.4;background:rgba(6,10,16,.85);
   padding:3px 6px;border-radius:4px}
 h3{font-size:14px;margin:6px 0}
 .sub{font-size:11px;color:#8aa;margin:0 0 10px}
</style></head><body>
<div id="wrap">
<h3>톤매핑 — ACES vs AgX (사용자 화면 5장이 있던 자리)</h3>
<p class="sub">밝은쪽계조가 클수록 어깨에서 안 눌린 것, 무채색비율이 작을수록 회록·회백이 적은 것입니다.</p>
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
import { getTuning, setTuning } from './app/utils/skyTuning.js';

const errors=[]; const oe=console.error; console.error=(...a)=>{errors.push(a.join(' ')); oe(...a);};

const TW=${TW}, TH=${TH}, FOV=${FOV};
const SCENES=${JSON.stringify(SCENES)}, CURVES=${JSON.stringify(CURVES)};

const canvas=document.getElementById('c');
canvas.width=TW*CURVES.length; canvas.height=TH*SCENES.length;
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

const OFFSETS=[-180,-150,-120,-90,-60,-30,0,30,60,90,120,150,180];
const DISTS=[5,12,30,70,160,360];
const jit=(v,d,a,k)=>Math.max(0,Math.min(100, v+16*Math.sin(d*0.031+a*0.017+k)+11*Math.cos(d*0.017-a*0.026+k)));
function bake(s){
  const pts=[{distance:0,azimuthOffset:0,low:s.low,mid:s.mid,high:s.high,
              humidity:s.hum,precipitation:0,visibility:s.vis}];
  for(const off of OFFSETS) for(const d of DISTS)
    pts.push({distance:d,azimuthOffset:off,low:jit(s.low,d,off,0),
              mid:jit(s.mid,d,off+40,1),high:jit(s.high,d,off+80,2),
              humidity:s.hum,precipitation:0});
  const fan=new WeatherFan(pts,s.sunAz);
  bakeCloudSlabCoverage(slab,(azDeg,distKm)=>{const {data,confidence}=fan.sample(azDeg,distKm);
    if(!data) return {low:0,mid:0,high:0,confidence:0};
    return {low:data.low/100,mid:data.mid/100,high:data.high/100,
            confidence:Math.max(0,Math.min(1,confidence))};});
}

function shoot(s, tm){
  setTuning({ tonemap: tm.tm, displayExposure: tm.expo });
  const atm=makeAtmosphereParams({latitude:37.5,observerElevM:24,dayOfYear:247,
    humidityPct:s.hum,visibilityM:s.vis});
  const cam=new THREE.PerspectiveCamera(FOV,TW/TH,0.1,2000);
  cam.position.set(0,0,0); cam.up.set(0,1,0);
  const az=s.viewAz*Math.PI/180, er=s.elev*Math.PI/180;
  cam.lookAt(100*Math.cos(er)*Math.sin(az),100*Math.sin(er),-100*Math.cos(er)*Math.cos(az));
  cam.updateMatrixWorld(true);
  const a=s.sunAlt*Math.PI/180, z=s.sunAz*Math.PI/180;
  const sunDir=new THREE.Vector3(Math.cos(a)*Math.sin(z),Math.sin(a),-Math.cos(a)*Math.cos(z)).normalize();
  applyTuningUniforms(skydome.mesh.material.uniforms);
  updateSkydome(skydome,s.sunAlt,s.sunAz,atm);
  applyTuningUniforms(skydome.mesh.material.uniforms);
  updateTerrainColors(terrain,s.sunAlt,s.sunAz,atm);
  applyTuningUniforms(terrain.material ? terrain.material.uniforms : null);
  updateGroundColors(ground,s.sunAlt,s.sunAz,atm);
  updateCloudSlab(slab,{camera:cam,widthPx:TW,heightPx:TH,sunDir,
    sunAltDeg:s.sunAlt,sunAzDeg:s.sunAz,cityLight:0,
    beamFor:(altKm)=>beamAtAltitude(s.sunAlt,altKm,atm),atmosphere:atm,
    layerWinds:{low:{speedKmh:14,bearingDeg:250},mid:{speedKmh:30,bearingDeg:235},
                high:{speedKmh:70,bearingDeg:220}},
    driftHours:0,visible:true});
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
const satOf=(b,p)=>{const mx=Math.max(b[p],b[p+1],b[p+2]), mn=Math.min(b[p],b[p+1],b[p+2]);
  return mx<1?0:(mx-mn)/mx;};
function hueOf(b,p){
  const r=b[p],g=b[p+1],bl=b[p+2];
  const mx=Math.max(r,g,bl), mn=Math.min(r,g,bl);
  if(mx-mn<1) return null;
  let h;
  if(mx===r) h=60*(((g-bl)/(mx-mn))%6);
  else if(mx===g) h=60*((bl-r)/(mx-mn)+2);
  else h=60*((r-g)/(mx-mn)+4);
  return (h+360)%360;
}

/** 하늘 화소만 — 아래 25%(지형)는 뺍니다. */
function metrics(buf){
  const y1=Math.floor(TH*0.75);
  const L=[], S=[], H=[];
  for(let y=0;y<y1;y++) for(let x=0;x<TW;x++){
    const p=(y*TW+x)*4;
    L.push(lum(buf,p)); S.push(satOf(buf,p));
    const h=hueOf(buf,p); if(satOf(buf,p)>0.12) H.push(h);
  }
  L.sort((a,b)=>a-b);
  // 밝은쪽 상위 30% 안에서의 계조
  const hi=L.slice(Math.floor(L.length*0.7));
  const q=(arr,f)=>arr[Math.min(arr.length-1,Math.floor(arr.length*f))];
  const 밝은쪽계조 = +(q(hi,0.9)-q(hi,0.1)).toFixed(2);
  const 무채색비율 = +(S.filter(v=>v<0.12).length/S.length).toFixed(3);
  const 평균채도 = +(S.reduce((a,b)=>a+b,0)/S.length).toFixed(3);
  const 평균휘도 = +(L.reduce((a,b)=>a+b,0)/L.length).toFixed(1);
  // 색상 원형 표준편차
  let sx=0, sy=0;
  for(const h of H){ sx+=Math.cos(h*Math.PI/180); sy+=Math.sin(h*Math.PI/180); }
  const R=H.length? Math.sqrt(sx*sx+sy*sy)/H.length : 1;
  const 색상변화 = +(Math.sqrt(Math.max(0,-2*Math.log(Math.max(1e-6,R))))*180/Math.PI).toFixed(1);
  return { 밝은쪽계조, 무채색비율, 평균채도, 평균휘도, 색상변화 };
}

const 결과=[];
SCENES.forEach((s,row)=>{
  bake(s);
  CURVES.forEach((c,col)=>{
    const img=shoot(s,c);
    const m=metrics(img);
    결과.push({장면:s.key, 커브:c.name, ...m});
    const im=ctx2d.createImageData(TW,TH); im.data.set(img); ctx2d.putImageData(im,col*TW,row*TH);
    const d=document.createElement('div'); d.className='lbl';
    d.style.left=(canvas.offsetLeft+col*TW+6)+'px'; d.style.top=(canvas.offsetTop+row*TH+6)+'px';
    d.innerHTML=s.key+' · '+c.name
      +'<br><b>밝은쪽계조 '+m.밝은쪽계조+'</b>'
      +'<br>무채색 '+m.무채색비율+' · 채도 '+m.평균채도
      +'<br>색상변화 '+m.색상변화+'° · 휘도 '+m.평균휘도;
    labels.appendChild(d);
  });
});

window.__stats={glError:gl.getError(), 결과};
window.__errors=errors;
document.title='DONE::'+(errors.length?'SHADER_ERR':'OK')+'::'+gl.getError();
</script></body></html>`;

fs.mkdirSync(PREVIEW, { recursive: true });
fs.writeFileSync(path.join(PREVIEW, 'tonemap-ab.html'), html);
console.log('생성 완료: tonemap-ab.html');
