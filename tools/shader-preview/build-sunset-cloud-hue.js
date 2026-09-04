/**
 * **노을 구름이 분홍인가 남색인가** (계획 38절).
 *
 * 사용자 지적: "노을일 때 구름색이 지나치게 어둡고 기괴하게 파란색이 된다.
 * 보통 노을에는 구름이 핑크색으로 물들어 밝아지는데."
 *
 * 원인 후보는 **구름을 비추는 아래쪽 하늘의 표본 고도**입니다. 해가 지면
 * 따뜻한 띠가 고도 0~6°로 얇게 내려앉는데 `ambDown` 은 12°에서 뜹니다:
 *
 *   태양 -3°·이격 20°:  고도 1° 따뜻 +0.485 · 6° +0.178 · **12° -0.325**
 *
 * 그 시각 저층 구름은 직달광이 0.0006 까지 죽어 이 주변광만으로 칠해지므로,
 * 파란 표본을 쓰면 구름이 통째로 남색이 됩니다.
 *
 * 구름은 분할 규칙을 지어내지 않고 **같은 장면을 운량 0 으로 한 번 더 그려
 * 달라진 화소**로 가릅니다(36절과 같은 방법).
 *
 * 사용: node tools/shader-preview/build-sunset-cloud-hue.js
 *       node tools/shader-preview/shoot.js sunset-cloud-hue.html sunset-cloud-hue.png 60000
 */
const fs = require('fs');
const path = require('path');
const { PREVIEW } = require('./paths');

const TW = 320, TH = 320;
const FOV_DEG = 70;
const SUN_AZ = 263;                 // 사용자 화면의 방위
const VIEW_ELEV = 12;
/** 사용자 화면과 같은 구간 — 일몰 18:59, 화면은 19:01 / 19:11 / 19:16. */
const SUNS = [0, -1.5, -3.5];
/** 12°=예전 고정값, 6°=고정 대안, 0=태양을 따라가는 채택안. */
const AMB = [12, 6, 0];

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
 body{margin:0;background:#0b0f15;font-family:sans-serif;color:#dde}
 #wrap{position:relative;width:${TW * AMB.length + 24}px;padding:12px}
 .lbl{position:absolute;color:#fff;font-size:10px;font-family:monospace;
   pointer-events:none;line-height:1.4;background:rgba(6,10,16,.85);
   padding:3px 6px;border-radius:4px}
 h3{font-size:13px;margin:6px 0}
 .sub{font-size:11px;color:#8aa;margin:0 0 8px}
</style></head><body>
<div id="wrap">
<h3>노을 구름 색 — 아래쪽 주변광을 어느 고도에서 뜨는가</h3>
<p class="sub">가로: 고정 12°(예전) / 고정 6° / <b>태양 추종(채택)</b>. 세로: 태양 0° / -1.5° / -3.5°. 구름따뜻함이 뒤하늘보다 커야 "분홍으로 물든" 것입니다.</p>
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

const TW=${TW}, TH=${TH}, FOV_DEG=${FOV_DEG};
const SUN_AZ=${SUN_AZ}, VIEW_ELEV=${VIEW_ELEV};
const SUNS=${JSON.stringify(SUNS)}, AMB=${JSON.stringify(AMB)};

const canvas=document.getElementById('c');
canvas.width=TW*AMB.length; canvas.height=TH*SUNS.length;
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

// 사용자 화면과 같은 조건: 상층운 0%, 저·중층만.
const OFFSETS=[-180,-150,-120,-90,-60,-30,0,30,60,90,120,150,180];
const DISTS=[5,12,30,70,160,360];
const jit=(v,d,a)=>Math.max(0,Math.min(100, v+16*Math.sin(d*0.031+a*0.017)+11*Math.cos(d*0.017-a*0.026)));
const pts=[{distance:0,azimuthOffset:0,low:35,mid:25,high:0,humidity:70,precipitation:0,visibility:20000}];
for(const off of OFFSETS) for(const d of DISTS)
  pts.push({distance:d,azimuthOffset:off,low:jit(35,d,off),mid:jit(25,d,off+40),
            high:0,humidity:70,precipitation:0});
const fan=new WeatherFan(pts,SUN_AZ);
bakeCloudSlabCoverage(slab,(azDeg,distKm)=>{const {data,confidence}=fan.sample(azDeg,distKm);
  if(!data) return {low:0,mid:0,high:0,confidence:0};
  return {low:data.low/100,mid:data.mid/100,high:data.high/100,
          confidence:Math.max(0,Math.min(1,confidence))};});

const atm=makeAtmosphereParams({latitude:37.5,observerElevM:24,dayOfYear:247,
  humidityPct:70,visibilityM:20000});

function shoot(sunAlt, ambDeg){
  const cam=new THREE.PerspectiveCamera(FOV_DEG,TW/TH,0.1,2000);
  cam.position.set(0,0,0); cam.up.set(0,1,0);
  const az=SUN_AZ*Math.PI/180, er=VIEW_ELEV*Math.PI/180;
  cam.lookAt(100*Math.cos(er)*Math.sin(az),100*Math.sin(er),-100*Math.cos(er)*Math.cos(az));
  cam.updateMatrixWorld(true);
  const a=sunAlt*Math.PI/180;
  const sunDir=new THREE.Vector3(Math.cos(a)*Math.sin(az),Math.sin(a),-Math.cos(a)*Math.cos(az)).normalize();
  applyTuningUniforms(skydome.mesh.material.uniforms);
  updateSkydome(skydome,sunAlt,SUN_AZ,atm);
  applyTuningUniforms(skydome.mesh.material.uniforms);
  updateTerrainColors(terrain,sunAlt,SUN_AZ,atm);
  updateGroundColors(ground,sunAlt,SUN_AZ,atm);
  updateCloudSlab(slab,{camera:cam,widthPx:TW,heightPx:TH,sunDir,
    sunAltDeg:sunAlt,sunAzDeg:SUN_AZ,cityLight:0,
    beamFor:(altKm)=>beamAtAltitude(sunAlt,altKm,atm),atmosphere:atm,
    layerWinds:{low:{speedKmh:14,bearingDeg:270},mid:{speedKmh:30,bearingDeg:255},
                high:{speedKmh:70,bearingDeg:240}},
    driftHours:0,visible:true,
    // 0 이면 넘기지 않습니다 — updateCloudSlab 의 태양 추종 기본값이 씁니다.
    ...(ambDeg > 0 ? { ambDownDeg: ambDeg } : {})});
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
/** 따뜻함 — 밝기로 나눠 정규화. sky-stats 의 lightingStats 와 같은 식입니다. */
const warm=(b,p)=>(b[p]-b[p+2])/Math.max(24,Math.max(b[p],Math.max(b[p+1],b[p+2])));

function cloudVsSky(withC,noC){
  let cw=0,sw=0,cl=0,sl=0,n=0;
  for(let i=0;i<TW*TH;i++){const p=i*4;
    if(Math.abs(withC[p]-noC[p])+Math.abs(withC[p+1]-noC[p+1])+Math.abs(withC[p+2]-noC[p+2])<24) continue;
    cw+=warm(withC,p); sw+=warm(noC,p); cl+=lum(withC,p); sl+=lum(noC,p); n++;}
  if(!n) return null;
  return { 구름따뜻함:+(cw/n).toFixed(3), 하늘따뜻함:+(sw/n).toFixed(3),
           따뜻함차:+((cw-sw)/n).toFixed(3),
           구름휘도:+(cl/n).toFixed(1), 하늘휘도:+(sl/n).toFixed(1),
           구름밝기비:+(cl/Math.max(1,sl)).toFixed(3) };
}

const 결과=[];
SUNS.forEach((sa,row)=>{
  AMB.forEach((ad,col)=>{
    const on=shoot(sa,ad);
    const savedTex=slab.material.uniforms.uCoverTex.value;
    const blank=new THREE.DataTexture(new Uint8Array(savedTex.image.width*savedTex.image.height*4),
      savedTex.image.width,savedTex.image.height,THREE.RGBAFormat);
    blank.minFilter=THREE.LinearFilter; blank.magFilter=THREE.LinearFilter; blank.needsUpdate=true;
    slab.material.uniforms.uCoverTex.value=blank;
    const bare=shoot(sa,ad);
    slab.material.uniforms.uCoverTex.value=savedTex;
    const m=cloudVsSky(on,bare);
    결과.push({태양:sa, 표본고도:ad, ...(m||{})});
    const im=ctx2d.createImageData(TW,TH); im.data.set(on); ctx2d.putImageData(im,col*TW,row*TH);
    const d=document.createElement('div'); d.className='lbl';
    d.style.left=(col*TW+6)+'px'; d.style.top=(row*TH+6)+'px';
    d.innerHTML='태양 '+sa+'° · 표본 '+(ad>0?ad+'°':'태양추종')
      + (m ? '<br><b>구름따뜻함 '+m.구름따뜻함+'</b> (하늘 '+m.하늘따뜻함+')'
           + '<br>따뜻함차 <b>'+m.따뜻함차+'</b>'
           + '<br>구름밝기비 '+m.구름밝기비 : '<br>(구름 없음)');
    labels.appendChild(d);
  });
});

window.__stats={glError:gl.getError(), 결과};
window.__errors=errors;
document.title='DONE::'+(errors.length?'SHADER_ERR':'OK')+'::'+gl.getError();
</script></body></html>`;

fs.mkdirSync(PREVIEW, { recursive: true });
fs.writeFileSync(path.join(PREVIEW, 'sunset-cloud-hue.html'), html);
console.log('생성 완료: sunset-cloud-hue.html');
