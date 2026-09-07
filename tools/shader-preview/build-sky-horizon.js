/**
 * **하늘색과 지평선 공백** — 사용자 실기기 화면 조건 그대로 (계획 44절).
 *
 * 사용자 지적 셋:
 *  ① 하늘색이 실제보다 덜 푸르다
 *  ② 지구곡면으로 구름이 지평선 아래로 흘러야 하는데 중간에 공백이 생긴다
 *  ③ 룩앤필이 사진과 다르다
 *
 * ①은 사진 3장을 재서 원인을 좁혔습니다. **선형** B/R 이 사진은 3.2~4.2,
 * 우리는 2.5 입니다. 태양 근처가 희뿌연 것은 사진도 같으므로(사진3의 태양쪽
 * 1.5~1.85) 그건 물리이고, 문제는 **태양에서 먼 하늘**입니다. 손으로 갈라
 * 보니 산란 자체는 B/R 3.2 가 나오는데, 하늘에 닿기 전 태양광이 이미
 * 파랑을 잃어(투과율 B/R ×0.765) 2.4 로 내려앉습니다. 그 크기를 정하는 것이
 * 에어로졸 β 입니다.
 *
 * ②는 행별로 스캔했더니 구름 결이 지평선 2.8° 위에서 끊기고 그 아래가
 * 밝고 매끈한 띠였습니다. 후보는 `det`(세부 신뢰도)가 지평선에서 0 이 되어
 * 무늬가 평균으로 녹는 것과, 대기원근이 한 색으로 덮는 것 둘입니다.
 * 여기서 갈라 봅니다.
 *
 * 사용: node tools/shader-preview/build-sky-horizon.js
 *       node tools/shader-preview/shoot.js sky-horizon.html sky-horizon.png 90000
 */
const fs = require('fs');
const path = require('path');
const { PREVIEW } = require('./paths');

const TW = 420, TH = 560;
/** 실기기 화면과 같은 조건 — 2026/09/06 14:38 서울, FOV 60, 시선고도 23도 */
const FOV = 60, VIEW_ELEV = 23, VIEW_AZ = 211, SUN_AZ = 240, SUN_ALT = 50;

const CASES = [
  { name: '예전 (β0.076 · boost 1)', beta: 0.076, blue: 1.0, aerial: 1 },
  { name: '지금 (β0.050 · boost 1.55)', beta: null, blue: null, aerial: 1 },
];

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
 body{margin:0;background:#0b0f15;font-family:sans-serif;color:#dde}
 #wrap{position:relative;width:${TW * CASES.length + 24}px;padding:12px}
 .lbl{position:absolute;color:#fff;font-size:10px;font-family:monospace;
   pointer-events:none;line-height:1.4;background:rgba(6,10,16,.85);
   padding:3px 6px;border-radius:4px}
 h3{font-size:14px;margin:6px 0}
 .sub{font-size:11px;color:#8aa;margin:0 0 10px}
</style></head><body>
<div id="wrap">
<h3>하늘색 · 지평선 — 실기기 화면 조건 (FOV ${FOV}°, 시선고도 ${VIEW_ELEV}°, 태양 ${SUN_ALT}°)</h3>
<p class="sub">사진 목표: 태양 먼 하늘 sRGB [114,151,207] · 선형 B/R 3.2~4.2 · 채도 0.44 · 휘도 137</p>
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

const errors=[]; const oe=console.error; console.error=(...a)=>{errors.push(a.join(' ')); oe(...a);};

const TW=${TW}, TH=${TH}, FOV=${FOV};
const VIEW_ELEV=${VIEW_ELEV}, VIEW_AZ=${VIEW_AZ}, SUN_AZ=${SUN_AZ}, SUN_ALT=${SUN_ALT};
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

// 화면과 같은 날씨 — 저층 뭉게구름 위주, 상층운 0%
const OFFSETS=[-180,-150,-120,-90,-60,-30,0,30,60,90,120,150,180];
const DISTS=[5,12,30,70,160,360];
const jit=(v,d,a,k)=>Math.max(0,Math.min(100, v+16*Math.sin(d*0.031+a*0.017+k)+11*Math.cos(d*0.017-a*0.026+k)));
const W={low:40,mid:15,high:0,hum:60,vis:22000};
{
  const pts=[{distance:0,azimuthOffset:0,low:W.low,mid:W.mid,high:W.high,
              humidity:W.hum,precipitation:0,visibility:W.vis}];
  for(const off of OFFSETS) for(const d of DISTS)
    pts.push({distance:d,azimuthOffset:off,low:jit(W.low,d,off,0),
              mid:jit(W.mid,d,off+40,1),high:0,humidity:W.hum,precipitation:0});
  const fan=new WeatherFan(pts,SUN_AZ);
  bakeCloudSlabCoverage(slab,(azDeg,distKm)=>{const {data,confidence}=fan.sample(azDeg,distKm);
    if(!data) return {low:0,mid:0,high:0,confidence:0};
    return {low:data.low/100,mid:data.mid/100,high:0,
            confidence:Math.max(0,Math.min(1,confidence))};});
}

function shoot(c){
  resetTuning();
  const patch={};
  if(c.skyExpo!=null) patch.skyExposure=c.skyExpo;
  if(c.sat!=null) patch.displaySaturation=c.sat;
  if(c.blue!=null) patch.skyBlueBoost=c.blue;
  if(Object.keys(patch).length) setTuning(patch);
  const atm=makeAtmosphereParams({latitude:37.5,observerElevM:24,dayOfYear:249,
    humidityPct:W.hum,visibilityM:W.vis});
  if (c.beta != null) atm.betaMie = c.beta;
  const cam=new THREE.PerspectiveCamera(FOV,TW/TH,0.1,2000);
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
    layerWinds:{low:{speedKmh:14,bearingDeg:250},mid:{speedKmh:30,bearingDeg:235},
                high:{speedKmh:70,bearingDeg:220}},
    driftHours:0,visible:true, aerialScale:c.aerial});
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
const toLin=v=>{v/=255;return v<=0.04045?v/12.92:Math.pow((v+0.055)/1.055,2.4);};

/** 태양에서 먼 쪽 = 화면 왼쪽 3분의 1의 파란 하늘 화소 */
function skyStat(buf){
  let n=0,R=0,G=0,B=0;
  for(let y=0;y<Math.floor(TH*0.5);y++) for(let x=0;x<Math.floor(TW*0.34);x++){
    const p=(y*TW+x)*4;
    if(buf[p+2]-buf[p]>25){R+=buf[p];G+=buf[p+1];B+=buf[p+2];n++;}
  }
  if(!n) return null;
  R/=n;G/=n;B/=n;
  const mx=Math.max(R,G,B), mn=Math.min(R,G,B);
  return {rgb:[R,G,B].map(v=>Math.round(v)), 선형BR:+(toLin(B)/toLin(R)).toFixed(2),
          휘도:+(0.2126*R+0.7152*G+0.0722*B).toFixed(0), 채도:+((mx-mn)/mx).toFixed(3), n};
}

/** 지평선 위 구름 결이 어디서 끊기나 — 행별 국소대비 */
function horizonProfile(buf){
  const rows=[];
  for(let y=0;y<TH;y++){
    let s=0,c=0,n=0;
    for(let x=1;x<TW-1;x++){
      const p=(y*TW+x)*4;
      s+=lum(buf,p); c+=Math.abs(lum(buf,p)-lum(buf,p+4)); n++;
    }
    rows.push({y, L:s/n, C:c/n});
  }
  // 지면(대비 거의 0, 휘도 낮음)이 시작하는 행
  let ground=TH;
  for(let y=Math.floor(TH*0.5); y<TH; y++){
    if(rows[y].C < 0.15) { ground=y; break; }
  }
  // 그 위에서 결이 살아 있는 마지막 행 (대비 0.6 이상)
  let lastDetail=ground;
  for(let y=ground-1; y>Math.floor(TH*0.4); y--){
    if(rows[y].C > 0.6) { lastDetail=y; break; }
  }
  const degPerPx = FOV / TH;
  return { 지면행:ground, 결끝행:lastDetail, 공백px:ground-lastDetail,
           공백도:+((ground-lastDetail)*degPerPx).toFixed(2) };
}

const 결과=[];
CASES.forEach((c,i)=>{
  const img=shoot(c);
  const s=skyStat(img), h=horizonProfile(img);
  결과.push({이름:c.name, ...s, ...h});
  const im=ctx2d.createImageData(TW,TH); im.data.set(img); ctx2d.putImageData(im,i*TW,0);
  const d=document.createElement('div'); d.className='lbl';
  d.style.left=(canvas.offsetLeft+i*TW+6)+'px'; d.style.top=(canvas.offsetTop+6)+'px';
  d.innerHTML=c.name
    +'<br>하늘 ['+(s?s.rgb.join(','):'—')+']'
    +'<br><b>선형B/R '+(s?s.선형BR:'—')+'</b> 채도 '+(s?s.채도:'—')
    +'<br>휘도 '+(s?s.휘도:'—')
    +'<br>지평선 공백 <b>'+h.공백도+'°</b>';
  labels.appendChild(d);
});

window.__stats={glError:gl.getError(), 결과};
window.__errors=errors;
document.title='DONE::'+(errors.length?'SHADER_ERR':'OK')+'::'+gl.getError();
</script></body></html>`;

fs.mkdirSync(PREVIEW, { recursive: true });
fs.writeFileSync(path.join(PREVIEW, 'sky-horizon.html'), html);
console.log('생성 완료: sky-horizon.html');
