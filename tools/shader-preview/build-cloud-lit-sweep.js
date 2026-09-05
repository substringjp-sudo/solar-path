/**
 * **구름 밝기 바닥 훑기** — 맑은 날 구름이 하늘보다 어두운 것을 고치되,
 * 애써 맞춘 노을을 깨지 않는 값을 고릅니다.
 *
 * 두 손잡이를 훑습니다 (둘 다 `CloudSlab` 의 바닥값):
 *   uCloudLitFloor — 두꺼운 표본의 직달광 바닥 (기본 0.20)
 *   uCloudAmbFloor — 구름이 받는 하늘 확산광 바닥 (기본 0.26)
 *
 * 두 장면을 **같은 값으로 동시에** 잽니다. 한쪽만 보고 고르면 다른 쪽이
 * 깨진다는 것을 이 저장소는 이미 여러 번 밟았습니다(계획 3절).
 *
 *   ① 아침 맑음 (QR 실측) — 구름밝기비가 1 을 넘어야 합니다.
 *        과녁: 사진에서 밝은쪽/어두운쪽 비 1.9 (day-cumulus_01)
 *   ② 노을 (태양 0°/-3°) — 명암폭·세로기울기가 안 무너져야 합니다.
 *        지금 값: 명암폭 96 / 92, 세로기울기 0.67 / 0.60
 *
 * 준비: node tools/shader-preview/stage-esm.js
 * 사용: node tools/shader-preview/build-cloud-lit-sweep.js
 *       node tools/shader-preview/shoot.js cloud-lit-sweep.html cloud-lit-sweep.png 60000
 */
const fs = require('fs');
const path = require('path');
const { PREVIEW } = require('./paths');

const STATS_SRC = fs.readFileSync(
  path.join(__dirname, '../photo-ref/sky-stats.js'), 'utf8')
  .replace(/if \(typeof module[\s\S]*$/, '');

const TW = 300, TH = 300;
const QR = {
  lat: 37.4705, elevM: 24, sunAlt: 12.76, sunAz: 90.35,
  low: 15, mid: 18, high: 0, humidity: 79, vis: 17960,
  windKmh: 15.5, windDeg: 114,
};
/** (litFloor, ambFloor) 조합. 첫 칸이 현재 값입니다. */
const COMBOS = [
  { lit: 0.20, amb: 0.26, ph: 0.45, expo: 0.62 },   // 현재 값
  { lit: 0.45, amb: 0.45, ph: 0.45, expo: 0.62 },
  { lit: 0.45, amb: 0.45, ph: 0.80, expo: 0.62 },
  { lit: 0.55, amb: 0.50, ph: 0.85, expo: 0.62 },
  { lit: 0.70, amb: 0.55, ph: 0.90, expo: 0.62 },
];

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
 body{margin:0;background:#0b0f15;font-family:sans-serif;color:#dde}
 #wrap{position:relative;width:${TW * COMBOS.length + 24}px;padding:12px}
 .lbl{position:absolute;color:#fff;font-size:10px;font-family:monospace;
   pointer-events:none;line-height:1.4;background:rgba(6,10,16,.85);
   padding:3px 6px;border-radius:4px}
 h3{font-size:13px;margin:6px 0}
 .sub{font-size:11px;color:#8aa;margin:0 0 8px}
</style></head><body>
<div id="wrap">
<h3>구름 밝기 바닥 훑기 — 위: 아침 맑음(QR 실측) · 아래: 노을 태양 -3°</h3>
<p class="sub">구름밝기비는 1 을 넘어야 하고(사진 ~1.9), 노을 명암폭·세로기울기는 안 무너져야 합니다.</p>
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
${STATS_SRC}

const TW=${TW}, TH=${TH};
const QR=${JSON.stringify(QR)};
const COMBOS=${JSON.stringify(COMBOS)};

const canvas=document.getElementById('c');
canvas.width=TW*COMBOS.length; canvas.height=TH*2;
const ctx2d=canvas.getContext('2d');
const glCanvas=document.createElement('canvas'); glCanvas.width=TW; glCanvas.height=TH;
const renderer=new THREE.WebGLRenderer({canvas:glCanvas,antialias:false,alpha:false});
renderer.setPixelRatio(1); renderer.setSize(TW,TH,false);
const gl=renderer.getContext();

const scene=new THREE.Scene();
const skydome=createSkydome(); scene.add(skydome.mesh);
const angles=[]; for(let i=0;i<72;i++) angles.push(0.4+0.9*Math.sin(i*0.21)+0.5*Math.sin(i*0.07+1.3));
const terrain=createTerrainRing(angles); scene.add(terrain);
const ground=createGroundPlane(); setGroundHorizon(ground,28); scene.add(ground);
const slab=createCloudSlab(); slab.mesh.renderOrder=10; scene.add(slab.mesh);
const labels=document.getElementById('labels');

// ── 장면 둘 ────────────────────────────────────────────────────────────
// 아침은 QR 실측 그대로. 노을은 build-sunset-gap 과 같은 합성 예보라
// 그 습작의 숫자와 바로 견줄 수 있습니다.
function h21(x,y){const s=Math.sin(x*127.1+y*311.7)*43758.5453; return s-Math.floor(s);}
function vn(x,y){const ix=Math.floor(x),iy=Math.floor(y);
  let fx=x-ix,fy=y-iy; fx=fx*fx*(3-2*fx); fy=fy*fy*(3-2*fy);
  const a=h21(ix,iy),b=h21(ix+1,iy),c=h21(ix,iy+1),d=h21(ix+1,iy+1);
  const t=a+(b-a)*fx; return t+((c+(d-c)*fx)-t)*fy;}
function fbmJS(x,y,o){let s=0,a=0.5,n=0;for(let i=0;i<o;i++){s+=a*vn(x,y);n+=a;x=x*2.03+7.1;y=y*2.03+3.7;a*=0.5;}return s/n;}
const MEAN={low:0.28,mid:0.42,high:0.30}, SC={low:26,mid:42,high:72}, OFF={low:0,mid:51.3,high:97.7};
const truth=(L,x,z)=>Math.max(0,Math.min(1, MEAN[L]+(fbmJS(x/SC[L]+OFF[L], z/SC[L]+OFF[L],4)-0.5)*2.4));
const OFFSETS=[-180,-150,-120,-90,-60,-30,0,30,60,90,120,150,180];
const DISTS=[5,12,30,70,160,360];

function bakeMorning(){
  const jit=(v,d,a)=>Math.max(0,Math.min(100, v+14*Math.sin(d*0.031+a*0.017)+9*Math.cos(d*0.017-a*0.026)));
  const pts=[{distance:0,azimuthOffset:0,low:QR.low,mid:QR.mid,high:QR.high,
              humidity:QR.humidity,precipitation:0,visibility:QR.vis}];
  for(const off of OFFSETS) for(const d of DISTS)
    pts.push({distance:d,azimuthOffset:off,low:jit(QR.low,d,off),mid:jit(QR.mid,d,off+40),
              high:jit(QR.high,d,off+80),humidity:QR.humidity,precipitation:0});
  const fan=new WeatherFan(pts,QR.sunAz);
  bakeCloudSlabCoverage(slab,(azDeg,distKm)=>{const {data,confidence}=fan.sample(azDeg,distKm);
    if(!data) return {low:0,mid:0,high:0,confidence:0};
    return {low:data.low/100,mid:data.mid/100,high:data.high/100,
            confidence:Math.max(0,Math.min(1,confidence))};});
}
function bakeSunset(){
  const SUN_AZ=268;
  const pts=[{distance:0,azimuthOffset:0,low:truth('low',0,0)*100,mid:truth('mid',0,0)*100,
              high:truth('high',0,0)*100,humidity:62,precipitation:0,visibility:24000}];
  for(const off of OFFSETS) for(const d of [2,5,12,30,70,160,360]){
    const a=(SUN_AZ+off)*Math.PI/180,x=d*Math.sin(a),z=-d*Math.cos(a);
    pts.push({distance:d,azimuthOffset:off,low:truth('low',x,z)*100,
              mid:truth('mid',x,z)*100,high:truth('high',x,z)*100,humidity:62,precipitation:0});
  }
  const fan=new WeatherFan(pts,SUN_AZ);
  bakeCloudSlabCoverage(slab,(azDeg,distKm)=>{const {data,confidence}=fan.sample(azDeg,distKm);
    if(!data) return {low:0,mid:0,high:0,confidence:0};
    return {low:data.low/100,mid:data.mid/100,high:data.high/100,
            confidence:Math.max(0,Math.min(1,confidence))};});
}

const atmMorning=makeAtmosphereParams({latitude:QR.lat,observerElevM:QR.elevM,dayOfYear:247,
  humidityPct:QR.humidity,visibilityM:QR.vis});
const atmSunset=makeAtmosphereParams({latitude:37.5,observerElevM:30,dayOfYear:240,
  humidityPct:62,visibilityM:24000});

function shoot(sc, combo){
  resetTuning();
  setTuning({ displayExposure: combo.expo });
  const cam=new THREE.PerspectiveCamera(60,TW/TH,0.1,2000);
  cam.position.set(0,0,0); cam.up.set(0,1,0);
  const az=sc.viewAz*Math.PI/180, er=sc.elev*Math.PI/180;
  cam.lookAt(100*Math.cos(er)*Math.sin(az),100*Math.sin(er),-100*Math.cos(er)*Math.cos(az));
  cam.updateMatrixWorld(true);
  const a=sc.sunAlt*Math.PI/180, z=sc.sunAz*Math.PI/180;
  const sunDir=new THREE.Vector3(Math.cos(a)*Math.sin(z),Math.sin(a),-Math.cos(a)*Math.cos(z)).normalize();
  applyTuningUniforms(skydome.mesh.material.uniforms);
  updateSkydome(skydome,sc.sunAlt,sc.sunAz,sc.atm);
  applyTuningUniforms(skydome.mesh.material.uniforms);
  updateTerrainColors(terrain,sc.sunAlt,sc.sunAz,sc.atm);
  updateGroundColors(ground,sc.sunAlt,sc.sunAz,sc.atm);
  const W=(k,b)=>({speedKmh:k,bearingDeg:b});
  updateCloudSlab(slab,{camera:cam,widthPx:TW,heightPx:TH,sunDir,
    sunAltDeg:sc.sunAlt,sunAzDeg:sc.sunAz,cityLight:0,
    beamFor:(altKm)=>beamAtAltitude(sc.sunAlt,altKm,sc.atm),atmosphere:sc.atm,
    layerWinds:{low:W(QR.windKmh,QR.windDeg),mid:W(QR.windKmh*2.2,QR.windDeg-15),
                high:W(QR.windKmh*5,QR.windDeg-30)},
    driftHours:0,visible:true,
    cloudLitFloor:combo.lit, cloudAmbFloor:combo.amb, cloudPhaseFloor:combo.ph});
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
function cloudVsSky(withC,noC){
  let sc=0,ss=0,n=0;
  for(let i=0;i<TW*TH;i++){const p=i*4;
    if(Math.abs(withC[p]-noC[p])+Math.abs(withC[p+1]-noC[p+1])+Math.abs(withC[p+2]-noC[p+2])<24) continue;
    sc+=lum(withC,p); ss+=lum(noC,p); n++;}
  return n? +(sc/Math.max(1,ss)).toFixed(3) : 0;
}
/** 노을 지표 — build-sunset-gap 과 같은 식입니다. */
function contrast(buf){const v=[];
  for(let y=Math.floor(TH*0.30);y<TH;y++) for(let x=0;x<TW;x+=2) v.push(lum(buf,(y*TW+x)*4));
  v.sort((a,b)=>a-b); return +(v[Math.floor(v.length*0.9)]-v[Math.floor(v.length*0.1)]).toFixed(1);}
function vertGrad(buf){
  const band=(y0,y1)=>{let s=0,n=0;
    for(let y=y0;y<y1;y++) for(let x=0;x<TW;x+=2){s+=lum(buf,(y*TW+x)*4);n++;} return s/Math.max(1,n);};
  return +(band(Math.floor(TH*0.76),TH)/Math.max(1,band(Math.floor(TH*0.30),Math.floor(TH*0.53)))).toFixed(3);}

const 결과=[];
COMBOS.forEach((combo,i)=>{
  // ① 아침 맑음
  bakeMorning();
  const mSc={sunAlt:QR.sunAlt,sunAz:QR.sunAz,viewAz:QR.sunAz+48,elev:30,atm:atmMorning};
  const mOn=shoot(mSc,combo);
  const savedTex=slab.material.uniforms.uCoverTex.value;
  const blank=new THREE.DataTexture(new Uint8Array(savedTex.image.width*savedTex.image.height*4),
    savedTex.image.width,savedTex.image.height,THREE.RGBAFormat);
  blank.minFilter=THREE.LinearFilter; blank.magFilter=THREE.LinearFilter; blank.needsUpdate=true;
  slab.material.uniforms.uCoverTex.value=blank;
  const mBare=shoot(mSc,combo);
  slab.material.uniforms.uCoverTex.value=savedTex;
  const 구름밝기비=cloudVsSky(mOn,mBare);
  const ml=lightingStats(mOn,TW,TH,{skyFrac:0.90});

  // ② 노을 -3°
  bakeSunset();
  const sSc={sunAlt:-3,sunAz:268,viewAz:262,elev:14,atm:atmSunset};
  const sImg=shoot(sSc,combo);
  const 명암폭=contrast(sImg), 세로기울기=vertGrad(sImg);

  결과.push({바닥:'lit '+combo.lit+' / amb '+combo.amb+' / ph '+combo.ph+' / 노출 '+combo.expo, 구름밝기비,
    어두운쪽채도:ml.어두운쪽채도, 노을명암폭:명암폭, 노을세로기울기:세로기울기});

  const im1=ctx2d.createImageData(TW,TH); im1.data.set(mOn); ctx2d.putImageData(im1,i*TW,0);
  const im2=ctx2d.createImageData(TW,TH); im2.data.set(sImg); ctx2d.putImageData(im2,i*TW,TH);
  const d=document.createElement('div'); d.className='lbl';
  d.style.left=(i*TW+6)+'px'; d.style.top='54px';
  d.innerHTML='lit '+combo.lit+' / amb '+combo.amb+' / ph '+combo.ph
    +'<br><b>노출 '+combo.expo+'</b>'
    +'<br><b>구름밝기비 '+구름밝기비+'</b>'
    +'<br>어두운쪽채도 '+ml.어두운쪽채도+' <b>(사진 0.44)</b>'
    +'<br>어두운쪽청색비 '+ml.어두운쪽청색비+' <b>(1.78)</b>'
    +'<br>하늘휘도 '+ml.밝은쪽따뜻함;
  labels.appendChild(d);
  const d2=document.createElement('div'); d2.className='lbl';
  d2.style.left=(i*TW+6)+'px'; d2.style.top=(TH+54)+'px';
  d2.innerHTML='노을 명암폭 '+명암폭+'<br>세로기울기 '+세로기울기;
  labels.appendChild(d2);
});

resetTuning();
window.__stats={glError:gl.getError(), 결과};
window.__errors=errors;
document.title='DONE::'+(errors.length?'SHADER_ERR':'OK')+'::'+gl.getError();
</script></body></html>`;

fs.mkdirSync(PREVIEW, { recursive: true });
fs.writeFileSync(path.join(PREVIEW, 'cloud-lit-sweep.html'), html);
console.log('생성 완료: cloud-lit-sweep.html');
