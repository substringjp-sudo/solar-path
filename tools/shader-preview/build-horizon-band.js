/**
 * **지평선 띠의 결** — det 이 죽는 고도에서 구조가 남는가 (계획 44절).
 *
 * det 은 고도 2° 아래에서 0 이 됩니다. 예전에는 거기서 모양장이 상수 0.5 가
 * 되어 매끈한 한 장이 나왔습니다. 굵은 옥타브 폴백(detCoarse)이 그 자리에
 * 10~50km 규모 조직을 남기는지 **고도 구간별 국소대비**로 잽니다.
 *
 * 알파만 봅니다 — 색은 대기원근이 덮어 구조를 가립니다.
 *
 * 사용: node tools/shader-preview/build-horizon-band.js
 *       node tools/shader-preview/shoot.js horizon-band.html horizon-band.png 60000
 */
const fs = require('fs');
const path = require('path');
const { PREVIEW } = require('./paths');

const TW = 560, TH = 300;
const FOV = 26, VIEW_ELEV = 5.5, VIEW_AZ = 211, SUN_AZ = 240, SUN_ALT = 50;
const OBS_ELEV_M = 24;
/** 결을 재는 고도 구간 (도) */
const BANDS = [[0, 1], [1, 2], [2, 4], [4, 8], [8, 16]];

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
 body{margin:0;background:#0b0f15;font-family:sans-serif;color:#dde}
 #wrap{position:relative;width:${TW + 24}px;padding:12px}
 h3{font-size:14px;margin:6px 0}
 .sub{font-size:11px;color:#8aa;margin:0 0 10px}
 table{border-collapse:collapse;font:11px monospace;margin-top:10px}
 td,th{border:1px solid #345;padding:3px 8px;text-align:right}
</style></head><body>
<div id="wrap">
<h3>지평선 띠의 결 — 구름 알파 (화각 ${FOV}°, 시선고도 ${VIEW_ELEV}°)</h3>
<p class="sub">국소대비가 0 에 가까우면 그 고도는 매끈한 한 장입니다.
 det 은 2° 아래에서 0 이 되므로, 거기서 대비가 살아 있어야 굵은 폴백이 일한 것입니다.</p>
<canvas id="c"></canvas><div id="tbl"></div></div>
<script type="module">
import * as THREE from './app/vendor/three.module.js';
import { createCloudSlab, updateCloudSlab, bakeCloudSlabCoverage }
  from './app/components/SkyScene3D/CloudSlab.js';
import { WeatherFan } from './app/utils/skyColumn.js';
import { makeAtmosphereParams, beamAtAltitude, applyTuningUniforms } from './app/utils/atmosphere.js';

const errors=[]; const oe=console.error; console.error=(...a)=>{errors.push(a.join(' ')); oe(...a);};
const TW=${TW}, TH=${TH}, FOV=${FOV}, OBS_ELEV_M=${OBS_ELEV_M};
const VIEW_ELEV=${VIEW_ELEV}, VIEW_AZ=${VIEW_AZ}, SUN_AZ=${SUN_AZ}, SUN_ALT=${SUN_ALT};
const BANDS=${JSON.stringify(BANDS)};

const canvas=document.getElementById('c');
canvas.width=TW; canvas.height=TH;
const ctx2d=canvas.getContext('2d');
const glCanvas=document.createElement('canvas'); glCanvas.width=TW; glCanvas.height=TH;
const renderer=new THREE.WebGLRenderer({canvas:glCanvas,antialias:false,alpha:false});
renderer.setPixelRatio(1); renderer.setSize(TW,TH,false);
const gl=renderer.getContext();
const scene=new THREE.Scene();
const slab=createCloudSlab(); scene.add(slab.mesh);

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

const atm=makeAtmosphereParams({latitude:37.5,observerElevM:OBS_ELEV_M,dayOfYear:249,
  humidityPct:W.hum,visibilityM:W.vis});
const cam=new THREE.PerspectiveCamera(FOV,TW/TH,0.1,2000);
cam.position.set(0,0,0); cam.up.set(0,1,0);
{
  const az=VIEW_AZ*Math.PI/180, er=VIEW_ELEV*Math.PI/180;
  cam.lookAt(100*Math.cos(er)*Math.sin(az),100*Math.sin(er),-100*Math.cos(er)*Math.cos(az));
  cam.updateMatrixWorld(true);
}
const a=SUN_ALT*Math.PI/180, z=SUN_AZ*Math.PI/180;
const sunDir=new THREE.Vector3(Math.cos(a)*Math.sin(z),Math.sin(a),-Math.cos(a)*Math.cos(z)).normalize();
updateCloudSlab(slab,{camera:cam,widthPx:TW,heightPx:TH,sunDir,
  sunAltDeg:SUN_ALT,sunAzDeg:SUN_AZ,cityLight:0,
  beamFor:(altKm)=>beamAtAltitude(SUN_ALT,altKm,atm),atmosphere:atm,
  layerWinds:{low:{speedKmh:14,bearingDeg:250},mid:{speedKmh:30,bearingDeg:235},
              high:{speedKmh:70,bearingDeg:220}},
  driftHours:0,visible:true});
applyTuningUniforms(slab.mesh.material.uniforms);
slab.mesh.material.uniforms.uDataOut.value=1;
renderer.setRenderTarget(null); renderer.setClearColor(0x000000,0);
renderer.render(scene,cam);
slab.mesh.material.uniforms.uDataOut.value=0;
const raw=new Uint8Array(4*TW*TH);
gl.readPixels(0,0,TW,TH,gl.RGBA,gl.UNSIGNED_BYTE,raw);
const img=new Uint8Array(raw.length);
for(let r=0;r<TH;r++) img.set(raw.subarray((TH-1-r)*TW*4,(TH-r)*TW*4), r*TW*4);

const half=Math.tan(FOV*Math.PI/360);
const rowElev=y=>VIEW_ELEV + Math.atan((1-2*(y+0.5)/TH)*half)*180/Math.PI;

/** 구간별: 알파 평균과, 8화소 간격 국소대비(굵은 조직 규모) */
const 결과=BANDS.map(([lo,hi])=>{
  let n=0, sum=0, c8=0, n8=0, c60=0, n60=0;
  for(let y=0;y<TH;y++){
    const e=rowElev(y); if(e<lo||e>=hi) continue;
    for(let x=0;x<TW;x++){ sum+=img[(y*TW+x)*4+3]/255; n++; }
    for(let x=0;x+8<TW;x++){ c8+=Math.abs(img[(y*TW+x)*4+3]-img[(y*TW+x+8)*4+3])/255; n8++; }
    for(let x=0;x+60<TW;x++){ c60+=Math.abs(img[(y*TW+x)*4+3]-img[(y*TW+x+60)*4+3])/255; n60++; }
  }
  return {고도:lo+'~'+hi+'°', 알파평균:n?+(sum/n).toFixed(3):null,
          잔결_8px:n8?+(c8/n8).toFixed(4):null, 굵은결_60px:n60?+(c60/n60).toFixed(4):null};
});

const im=ctx2d.createImageData(TW,TH);
for(let p=0;p<TW*TH;p++){ const v=img[p*4+3];
  im.data[p*4]=v; im.data[p*4+1]=v; im.data[p*4+2]=v; im.data[p*4+3]=255; }
ctx2d.putImageData(im,0,0);
document.getElementById('tbl').innerHTML='<table><tr><th>고도</th><th>알파 평균</th><th>잔결 8px</th><th>굵은결 60px</th></tr>'
  +결과.map(r=>'<tr><td>'+r.고도+'</td><td>'+r.알파평균+'</td><td>'+r.잔결_8px+'</td><td>'+r.굵은결_60px+'</td></tr>').join('')+'</table>';

window.__stats={glError:gl.getError(), 결과};
window.__errors=errors;
document.title='DONE::'+(errors.length?'SHADER_ERR':'OK')+'::'+gl.getError();
</script></body></html>`;

fs.mkdirSync(PREVIEW, { recursive: true });
fs.writeFileSync(path.join(PREVIEW, 'horizon-band.html'), html);
console.log('생성 완료: horizon-band.html');
