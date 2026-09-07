/**
 * **지평선 공백** — 구름 밑과 지면 위 사이에 하늘이 비치는 띠 (계획 44절).
 *
 * 사용자 지적: "지구곡면으로 구름이 지평선 아래로 흘러야 하는데 중간에
 * 공백이 생긴다."
 *
 * 색으로는 못 잽니다 — 지평선에서는 대기원근 때문에 구름과 하늘이 거의
 * 같은 색입니다. 그래서 `uDataOut=1`(표시색+알파)로 굽고 **알파만** 봅니다.
 * 알파는 구름이 있느냐만 말하므로 띠의 시작·끝이 정확히 나옵니다.
 *
 * 화각을 6°로 좁혀 한 화소가 0.015° 를 담게 했습니다. 0.79° 짜리 띠가
 * 50화소로 벌어져 눈으로도 세어집니다.
 *
 * 사용: node tools/shader-preview/build-horizon-gap.js
 *       node tools/shader-preview/shoot.js horizon-gap.html horizon-gap.png 60000
 */
const fs = require('fs');
const path = require('path');
const { PREVIEW } = require('./paths');

const TW = 260, TH = 400;
/** 지평선을 가운데 두고 좁게 봅니다 — 한 화소 = 6/400 = 0.015° */
const FOV = 6, VIEW_ELEV = 0.4, VIEW_AZ = 211, SUN_AZ = 240, SUN_ALT = 50;
const OBS_ELEV_M = 24;

const CASES = [
  { name: '예전 (0.17° 에서 자름)', horizon: 0.003, fadeW: 0.008 },
  { name: '지금 (지평선에서 자름)',  horizon: null,  fadeW: null  },
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
<h3>지평선 공백 — 구름 알파로 직접 잼 (화각 ${FOV}°, 한 화소 ${(FOV / TH).toFixed(3)}°)</h3>
<p class="sub">관측 고도 ${OBS_ELEV_M}m → 지평선 내려앉음 −0.157°. 지면은 거기 놓입니다.
 구름이 그보다 위에서 끝나면 그 차이가 하늘이 비치는 띠입니다.</p>
<canvas id="c"></canvas><div id="labels"></div></div>
<script type="module">
import * as THREE from './app/vendor/three.module.js';
import { createCloudSlab, updateCloudSlab, bakeCloudSlabCoverage }
  from './app/components/SkyScene3D/CloudSlab.js';
import { seaHorizonDipDeg } from './app/components/SkyScene3D/TerrainRing.js';
import { WeatherFan } from './app/utils/skyColumn.js';
import { makeAtmosphereParams, beamAtAltitude, applyTuningUniforms } from './app/utils/atmosphere.js';

const errors=[]; const oe=console.error; console.error=(...a)=>{errors.push(a.join(' ')); oe(...a);};
const TW=${TW}, TH=${TH}, FOV=${FOV}, OBS_ELEV_M=${OBS_ELEV_M};
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

const dipSin = -Math.sin(seaHorizonDipDeg(OBS_ELEV_M)*Math.PI/180);

function shoot(c){
  const atm=makeAtmosphereParams({latitude:37.5,observerElevM:OBS_ELEV_M,dayOfYear:249,
    humidityPct:W.hum,visibilityM:W.vis});
  const cam=new THREE.PerspectiveCamera(FOV,TW/TH,0.1,2000);
  cam.position.set(0,0,0); cam.up.set(0,1,0);
  const az=VIEW_AZ*Math.PI/180, er=VIEW_ELEV*Math.PI/180;
  cam.lookAt(100*Math.cos(er)*Math.sin(az),100*Math.sin(er),-100*Math.cos(er)*Math.cos(az));
  cam.updateMatrixWorld(true);
  const a=SUN_ALT*Math.PI/180, z=SUN_AZ*Math.PI/180;
  const sunDir=new THREE.Vector3(Math.cos(a)*Math.sin(z),Math.sin(a),-Math.cos(a)*Math.cos(z)).normalize();
  updateCloudSlab(slab,{camera:cam,widthPx:TW,heightPx:TH,sunDir,
    sunAltDeg:SUN_ALT,sunAzDeg:SUN_AZ,cityLight:0,
    beamFor:(altKm)=>beamAtAltitude(SUN_ALT,altKm,atm),atmosphere:atm,
    layerWinds:{low:{speedKmh:14,bearingDeg:250},mid:{speedKmh:30,bearingDeg:235},
                high:{speedKmh:70,bearingDeg:220}},
    driftHours:0,visible:true});
  applyTuningUniforms(slab.mesh.material.uniforms);
  const u=slab.mesh.material.uniforms;
  u.uDataOut.value=1;                       // 표시색 + 알파
  if(c.horizon!=null){                      // 예전 동작 재현
    u.uHorizonSinE.value=c.horizon;
  }
  renderer.setRenderTarget(null); renderer.setClearColor(0x000000,0);
  renderer.render(scene,cam);
  u.uDataOut.value=0;
  const buf=new Uint8Array(4*TW*TH);
  gl.readPixels(0,0,TW,TH,gl.RGBA,gl.UNSIGNED_BYTE,buf);
  const out=new Uint8Array(buf.length);
  for(let r=0;r<TH;r++) out.set(buf.subarray((TH-1-r)*TW*4,(TH-r)*TW*4), r*TW*4);
  return out;
}

/** 화면 행 → 시선 고도(도). 화각 중심이 VIEW_ELEV 입니다. */
function rowElev(y){
  const half=Math.tan(FOV*Math.PI/360);
  const ndc=1-2*(y+0.5)/TH;
  return VIEW_ELEV + Math.atan(ndc*half)*180/Math.PI;
}
const dipDeg = seaHorizonDipDeg(OBS_ELEV_M);

function gapStat(buf){
  // 행마다 구름 알파 평균
  const rows=[];
  for(let y=0;y<TH;y++){
    let s=0; for(let x=0;x<TW;x++) s+=buf[(y*TW+x)*4+3];
    rows.push(s/TW/255);
  }
  // 아래에서 위로 올라가며 구름이 처음 나타나는 행
  let firstCloud=-1;
  for(let y=TH-1;y>=0;y--) if(rows[y]>0.02){ firstCloud=y; break; }
  const cloudBottomDeg = firstCloud<0 ? null : +rowElev(firstCloud).toFixed(3);
  const gap = cloudBottomDeg==null ? null : +(cloudBottomDeg-(-dipDeg)).toFixed(3);
  // 알파가 절반까지 차오르는 행 (융합이 끝나는 곳)
  let halfRow=-1;
  for(let y=TH-1;y>=0;y--) if(rows[y]>0.5*Math.max(...rows)){ halfRow=y; break; }
  return { 지면고도: +(-dipDeg).toFixed(3), 구름밑고도: cloudBottomDeg,
           공백도: gap, 반알파고도: halfRow<0?null:+rowElev(halfRow).toFixed(3),
           최대알파: +Math.max(...rows).toFixed(3) };
}

const 결과=[];
const labels=document.getElementById('labels');
CASES.forEach((c,i)=>{
  const img=shoot(c);
  const st=gapStat(img);
  결과.push({이름:c.name, ...st});
  // 알파를 회색으로 그려 띠가 보이게
  const im=ctx2d.createImageData(TW,TH);
  for(let p=0;p<TW*TH;p++){ const a=img[p*4+3];
    im.data[p*4]=a; im.data[p*4+1]=a; im.data[p*4+2]=a; im.data[p*4+3]=255; }
  ctx2d.putImageData(im,i*TW,0);
  // 지면선을 빨갛게
  const gy=Math.round(TH*(0.5-((-dipDeg)-VIEW_ELEV)/FOV));
  ctx2d.fillStyle='#f44'; ctx2d.fillRect(i*TW,gy,TW,1);
  const d=document.createElement('div'); d.className='lbl';
  d.style.left=(canvas.offsetLeft+i*TW+6)+'px'; d.style.top=(canvas.offsetTop+6)+'px';
  d.innerHTML=c.name+'<br>지면 '+st.지면고도+'° (빨간선)'
    +'<br>구름 밑 '+st.구름밑고도+'°'
    +'<br><b>공백 '+st.공백도+'°</b>';
  labels.appendChild(d);
});

window.__stats={glError:gl.getError(), 결과};
window.__errors=errors;
document.title='DONE::'+(errors.length?'SHADER_ERR':'OK')+'::'+gl.getError();
</script></body></html>`;

fs.mkdirSync(PREVIEW, { recursive: true });
fs.writeFileSync(path.join(PREVIEW, 'horizon-gap.html'), html);
console.log('생성 완료: horizon-gap.html');
