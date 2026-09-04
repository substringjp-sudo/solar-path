/**
 * **구름 테두리가 각진가, 하늘과 겉도는가** (계획 41절).
 *
 * 사용자 지적: "여전히 구름의 테두리가 각지고 구름이 하늘과 어울리지 않는다.
 * 특히 맑은 날 바로 위를 볼 때."
 *
 * 짚이는 곳은 fbm 의 옥타브 전이입니다:
 *
 *   p = mod(p*2.03 + 7.1, SLAB_LATTICE);
 *
 * **회전이 없습니다.** slab_vnoise 는 정수 격자 위의 값잡음이라 등고선이
 * 원래 마름모·사각으로 눕는데, 다섯 옥타브가 전부 **같은 축**을 쓰면 그
 * 축 정렬이 상쇄되지 않고 겹쳐 쌓입니다. 게다가 두께장은 baseSub 문턱으로
 * 잘리므로, 실루엣이 곧 그 각진 등고선입니다.
 *
 * 재는 것:
 *  - **축정렬도** — 구름 경계 화소의 기울기 방향 히스토그램. 격자에 눕지
 *    않았다면 어느 방향도 특별하지 않아야 하므로 최대/평균이 1 에 가깝고,
 *    각지면 0·45·90·135도 근처가 솟습니다.
 *  - **반투명띠** — 하늘도 구름도 아닌 중간 화소의 비율. 0 에 가까우면
 *    테두리가 칼같이 서서 붙여 놓은 스티커처럼 보입니다.
 *  - **구름-하늘 색차** — 같은 자리의 운량 0 판과의 평균 거리.
 *
 * 사용: node tools/shader-preview/build-cloud-edge.js
 *       node tools/shader-preview/shoot.js cloud-edge.html cloud-edge.png 60000
 *       node tools/shader-preview/verify-cloud-edge.js
 */
const fs = require('fs');
const path = require('path');
const { PREVIEW } = require('./paths');

const TW = 380, TH = 380;
/** 맑은 날. 사용자가 짚은 "바로 위"가 첫 칸입니다. */
const VIEWS = [
  { key: '천정 80°', elev: 80 },
  { key: '중간 45°', elev: 45 },
  { key: '지평 12°', elev: 12 },
];

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
 body{margin:0;background:#0b0f15;font-family:sans-serif;color:#dde}
 #wrap{position:relative;width:${TW * VIEWS.length + 24}px;padding:12px}
 .lbl{position:absolute;color:#fff;font-size:11px;font-family:monospace;
   pointer-events:none;line-height:1.45;background:rgba(6,10,16,.85);
   padding:4px 7px;border-radius:4px}
 h3{font-size:13px;margin:6px 0}
 .sub{font-size:11px;color:#8aa;margin:0 0 8px}
</style></head><body>
<div id="wrap">
<h3>구름 테두리 — 격자에 눕지 않았는가, 하늘과 이어지는가</h3>
<p class="sub">맑은 날(저층 25%·중층 10%), 태양 40°. 축정렬도가 1 에 가까울수록 방향이 고르고, 반투명띠가 클수록 테두리가 부드럽습니다.</p>
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
const VIEWS=${JSON.stringify(VIEWS)};
const SUN_ALT=40, SUN_AZ=180;

const canvas=document.getElementById('c');
canvas.width=TW*VIEWS.length; canvas.height=TH;
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
const jit=(v,d,a)=>Math.max(0,Math.min(100, v+14*Math.sin(d*0.031+a*0.017)+9*Math.cos(d*0.017-a*0.026)));
const pts=[{distance:0,azimuthOffset:0,low:25,mid:10,high:0,humidity:55,precipitation:0,visibility:30000}];
for(const off of OFFSETS) for(const d of DISTS)
  pts.push({distance:d,azimuthOffset:off,low:jit(25,d,off),mid:jit(10,d,off+40),
            high:0,humidity:55,precipitation:0});
const fan=new WeatherFan(pts,SUN_AZ);
bakeCloudSlabCoverage(slab,(azDeg,distKm)=>{const {data,confidence}=fan.sample(azDeg,distKm);
  if(!data) return {low:0,mid:0,high:0,confidence:0};
  return {low:data.low/100,mid:data.mid/100,high:data.high/100,
          confidence:Math.max(0,Math.min(1,confidence))};});

const atm=makeAtmosphereParams({latitude:37.5,observerElevM:24,dayOfYear:247,
  humidityPct:55,visibilityM:30000});

function shoot(elev){
  const cam=new THREE.PerspectiveCamera(70,TW/TH,0.1,2000);
  cam.position.set(0,0,0); cam.up.set(0,1,0);
  const az=(SUN_AZ+90)*Math.PI/180, er=elev*Math.PI/180;
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

/**
 * 축정렬도 — 구름 실루엣의 기울기 방향이 특정 축에 눕는가.
 *
 * 운량 0 판과의 차이(=구름의 세기장)에 소벨을 걸고, 방향을 36칸(5도)에
 * 세기 가중으로 담습니다. 격자에 안 눕는 잡음이면 어느 칸도 특별하지
 * 않아 최대/평균이 1 에 가깝습니다.
 */
function axisAlign(withC,noC){
  const d=new Float32Array(TW*TH);
  for(let i=0;i<TW*TH;i++){const p=i*4;
    d[i]=Math.abs(lum(withC,p)-lum(noC,p));}
  const bins=new Float64Array(36); let tot=0;
  for(let y=1;y<TH-1;y++) for(let x=1;x<TW-1;x++){
    const i=y*TW+x;
    const gx=(d[i-TW+1]+2*d[i+1]+d[i+TW+1])-(d[i-TW-1]+2*d[i-1]+d[i+TW-1]);
    const gy=(d[i+TW-1]+2*d[i+TW]+d[i+TW+1])-(d[i-TW-1]+2*d[i-TW]+d[i-TW+1]);
    const m=Math.hypot(gx,gy);
    if(m<6) continue;                       // 잡음 바닥은 뺍니다
    let a=Math.atan2(gy,gx)*180/Math.PI;    // -180~180
    a=((a%180)+180)%180;                    // 방향은 180도 주기
    bins[Math.min(35,Math.floor(a/5))]+=m; tot+=m;
  }
  if(tot<=0) return {축정렬도:null, 봉우리각:null, 경계세기:0};
  const mean=tot/36; let mx=0, mi=0;
  for(let i=0;i<36;i++) if(bins[i]>mx){mx=bins[i]; mi=i;}
  return {축정렬도:+(mx/mean).toFixed(3), 봉우리각:mi*5+2.5, 경계세기:+(tot/1000).toFixed(1)};
}

/**
 * 반투명띠 — 하늘도 구름도 아닌 화소의 비율.
 *
 * 구름 세기장을 0~1 로 정규화해, 0.15~0.85 인 화소가 얼마나 되는지 셉니다.
 * 테두리가 칼같이 서면 이 값이 0 에 수렴하고, 붙여 놓은 스티커가 됩니다.
 */
function softEdge(withC,noC){
  const d=[]; let mx=0;
  for(let i=0;i<TW*TH;i++){const p=i*4;
    const v=Math.abs(lum(withC,p)-lum(noC,p)); d.push(v); if(v>mx) mx=v;}
  if(mx<4) return {반투명띠:null, 구름화소:0};
  let mid=0, on=0;
  for(const v of d){const t=v/mx; if(t>0.15){on++; if(t<0.85) mid++;}}
  return {반투명띠:+(mid/Math.max(1,on)).toFixed(3), 구름화소:on};
}

/**
 * **불투명도 분포** — 뭉게구름인가 안개인가.
 *
 * 맑은 날 실제 적운은 **낱개로 떨어진 불투명한 덩어리**이고 사이는 파란
 * 하늘입니다. 우리 것이 "하늘과 겉돈다"면 그 반대일 수 있습니다 — 온
 * 화면이 옅은 반투명으로 덮여 구름도 하늘도 아닌 상태.
 *
 * 구름 세기장을 0~1 로 정규화해서:
 *  - 불투명비 = 0.85 를 넘는 화소 / 구름 화소. 낱개 덩어리면 큽니다.
 *  - 트인하늘 = 0.05 아래인 화소 / 전체. 맑은 날이면 커야 합니다.
 */
function opacity(withC,noC){
  const d=[]; let mx=0;
  for(let i=0;i<TW*TH;i++){const p=i*4;
    const v=Math.abs(lum(withC,p)-lum(noC,p)); d.push(v); if(v>mx) mx=v;}
  if(mx<4) return {불투명비:null, 트인하늘:null};
  let solid=0, on=0, clear=0;
  for(const v of d){const t=v/mx;
    if(t<0.05) clear++;
    if(t>0.15){on++; if(t>0.85) solid++;}}
  return {불투명비:+(solid/Math.max(1,on)).toFixed(3),
          트인하늘:+(clear/d.length).toFixed(3)};
}

/** 구름과 그 자리 하늘의 평균 색거리. 클수록 겉돕니다. */
function colorGap(withC,noC){
  let s=0,n=0;
  for(let i=0;i<TW*TH;i++){const p=i*4;
    const dr=withC[p]-noC[p], dg=withC[p+1]-noC[p+1], db=withC[p+2]-noC[p+2];
    const m=Math.abs(dr)+Math.abs(dg)+Math.abs(db);
    if(m<24) continue;
    s+=Math.sqrt(dr*dr+dg*dg+db*db); n++;}
  return n? {색거리:+(s/n).toFixed(1), 비교화소:n} : {색거리:null, 비교화소:0};
}

const 결과=[];
VIEWS.forEach((v,i)=>{
  const on=shoot(v.elev);
  const savedTex=slab.material.uniforms.uCoverTex.value;
  const blank=new THREE.DataTexture(new Uint8Array(savedTex.image.width*savedTex.image.height*4),
    savedTex.image.width,savedTex.image.height,THREE.RGBAFormat);
  blank.minFilter=THREE.LinearFilter; blank.magFilter=THREE.LinearFilter; blank.needsUpdate=true;
  slab.material.uniforms.uCoverTex.value=blank;
  const bare=shoot(v.elev);
  slab.material.uniforms.uCoverTex.value=savedTex;

  const a=axisAlign(on,bare), s=softEdge(on,bare), c=colorGap(on,bare), o=opacity(on,bare);
  결과.push({시선:v.key, ...a, ...s, ...o, ...c});
  const im=ctx2d.createImageData(TW,TH); im.data.set(on); ctx2d.putImageData(im,i*TW,0);
  const d=document.createElement('div'); d.className='lbl';
  d.style.left=(i*TW+8)+'px'; d.style.top='8px';
  d.innerHTML=v.key
    +'<br><b>축정렬도 '+(a.축정렬도??'—')+'</b> (봉우리 '+(a.봉우리각??'—')+'°)'
    +'<br>반투명띠 '+(s.반투명띠??'—')
    +'<br><b>불투명비 '+(o.불투명비??'—')+'</b> · 트인하늘 <b>'+(o.트인하늘??'—')+'</b>'
    +'<br>색거리 '+(c.색거리??'—')+' · 구름화소 '+s.구름화소;
  labels.appendChild(d);
});

window.__stats={glError:gl.getError(), 결과};
window.__errors=errors;
document.title='DONE::'+(errors.length?'SHADER_ERR':'OK')+'::'+gl.getError();
</script></body></html>`;

fs.mkdirSync(PREVIEW, { recursive: true });
fs.writeFileSync(path.join(PREVIEW, 'cloud-edge.html'), html);
console.log('생성 완료: cloud-edge.html');
