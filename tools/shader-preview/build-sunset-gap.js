/**
 * **노을이 어디서 사라졌나** — PR #14 슬랩과 현재 슬랩을 같은 장면·같은
 * 태양 고도에서 나란히 놓고, 잃어버린 색을 어느 항이 먹는지 가릅니다.
 *
 * 장면 구성은 `build-cloud-slab.js` 와 **같습니다** (같은 합성 예보, 같은
 * 카메라, 같은 대기). 그래야 그 습작에서 본 숫자와 바로 비교됩니다.
 *
 * 의심하는 두 항을 세기 uniform 으로 빼서 하나씩 낮춥니다:
 *  - `uMultiScatter` — 다중산란. reach 를 안 보므로 **자기그림자에 든
 *    구름에도 같은 양이 들어갑니다.** 그림자를 메우고 얇은 가장자리와
 *    두꺼운 속의 차이를 줄입니다.
 *  - `uAerialScale` — 대기 원근감. 100km 에서 42%, 357km 에서 85% 를 한 가지
 *    안개색으로 덮으므로 분홍·보라·파랑의 **변화**를 지웁니다.
 *
 * 준비: node tools/shader-preview/stage-esm.js
 * 사용: node tools/shader-preview/build-sunset-gap.js
 */
const fs = require('fs');
const path = require('path');
const { PREVIEW } = require('./paths');

const TW = 300, TH = 300;
const FOV_DEG = 62;
const VIEW_AZ = 262, VIEW_ELEV = 14, SUN_AZ = 268;
const SUNS = [0, -3];

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
 body{margin:0;background:#0b0f15;font-family:sans-serif;color:#dde}
 #wrap{position:relative;width:${TW * 4 + 24}px;padding:12px}
 .lbl{position:absolute;color:#fff;font-size:11px;font-family:monospace;
   pointer-events:none;line-height:1.4;background:rgba(6,10,16,.78);
   padding:4px 7px;border-radius:4px}
 h3{font-size:13px;margin:6px 0}
 .sub{font-size:11px;color:#8aa;margin:0 0 8px}
</style></head><body>
<div id="wrap">
<h3>노을 색이 어디서 사라졌나 — 장면은 build-cloud-slab 과 동일</h3>
<p class="sub">가로: PR #14 / 현재 / 현재+다중산란 0.2 / 현재+셀 2.0km+다중산란 0.2</p>
<canvas id="c"></canvas><div id="labels"></div></div>
<script type="module">
import * as THREE from './app/vendor/three.module.js';
import { createSkydome, updateSkydome } from './app/components/SkyScene3D/Skydome.js';
import { createTerrainRing, createGroundPlane, updateTerrainColors, updateGroundColors,
         setGroundHorizon } from './app/components/SkyScene3D/TerrainRing.js';
import { createCloudSlab, updateCloudSlab, bakeCloudSlabCoverage }
  from './app/components/SkyScene3D/CloudSlab.js';
import { createPrevSlab, updatePrevSlab, bakePrevSlabCoverage }
  from './app/components/SkyScene3D/CloudSlabPrev.js';
import { WeatherFan } from './app/utils/skyColumn.js';
import { makeAtmosphereParams, beamAtAltitude } from './app/utils/atmosphere.js';

const errors = [];
const oe = console.error;
console.error = (...a) => { errors.push(a.join(' ')); oe(...a); };

const TW=${TW}, TH=${TH}, FOV_DEG=${FOV_DEG};
const VIEW_AZ=${VIEW_AZ}, VIEW_ELEV=${VIEW_ELEV}, SUN_AZ=${SUN_AZ};
const SUNS=${JSON.stringify(SUNS)};

const canvas = document.getElementById('c');
canvas.width = TW*4; canvas.height = TH*SUNS.length;
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
const cur = createCloudSlab(); cur.mesh.renderOrder = 10; scene.add(cur.mesh);
// PR #14 의 셀 크기·광학두께로 만든 현재 셰이더. 셀이 작아진 것이
// 대비를 먹는지 가르는 대조군입니다.
const wide = createCloudSlab({ cellKm:{low:2.0,mid:4.2,high:9.0},
                               tauK:{low:13.0,mid:9.0,high:3.2} });
wide.mesh.renderOrder = 10; scene.add(wide.mesh);
const prev = createPrevSlab(); prev.mesh.renderOrder = 10; scene.add(prev.mesh);

// build-cloud-slab.js 와 **같은** 합성 예보.
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
bakeCloudSlabCoverage(cur, src);
bakePrevSlabCoverage(prev, src);
bakeCloudSlabCoverage(wide, src);

const cam = new THREE.PerspectiveCamera(FOV_DEG, TW/TH, 0.1, 2000);
cam.position.set(0,0,0); cam.up.set(0,1,0);
{
  const ar=VIEW_AZ*Math.PI/180, er=VIEW_ELEV*Math.PI/180;
  cam.lookAt(100*Math.cos(er)*Math.sin(ar), 100*Math.sin(er), -100*Math.cos(er)*Math.cos(ar));
  cam.updateMatrixWorld(true);
}
const gl = renderer.getContext();
const labels = document.getElementById('labels');
const lum=(b,p)=>0.2126*b[p*4]+0.7152*b[p*4+1]+0.0722*b[p*4+2];

/** 노을 채도 — build-cloud-slab 과 같은 식이라 그 숫자와 바로 비교됩니다. */
function chroma(buf){
  let s=0,n=0;
  for(let p=0;p<TW*TH;p++){
    const r=buf[p*4],g=buf[p*4+1],b=buf[p*4+2];
    const mx=Math.max(r,g,b), mn=Math.min(r,g,b);
    if (mx<24) continue; s+=(mx-mn)/mx; n++;
  }
  return +(s/Math.max(1,n)).toFixed(3);
}
/**
 * 색상 변화 — 색이 있는 화소들의 색상각 표준편차(도).
 * "은은하게 보라색으로 물들고" 는 평균 채도가 아니라 **분홍·보라·파랑이
 * 한 화면에 같이 있는 것**이라, 채도만으로는 안 잡힙니다.
 */
function hueSpread(buf){
  let sx=0, sy=0, n=0; const hs=[];
  for(let p=0;p<TW*TH;p++){
    const r=buf[p*4]/255,g=buf[p*4+1]/255,b=buf[p*4+2]/255;
    const mx=Math.max(r,g,b), mn=Math.min(r,g,b), d=mx-mn;
    if (mx<0.12 || d<0.06) continue;
    let h;
    if (mx===r) h=((g-b)/d)%6; else if (mx===g) h=(b-r)/d+2; else h=(r-g)/d+4;
    h*=60; if(h<0)h+=360;
    hs.push(h); const rad=h*Math.PI/180; sx+=Math.cos(rad); sy+=Math.sin(rad); n++;
  }
  if(n<50) return 0;
  // 원형 표준편차 — 색상각은 360°에서 이어지므로 산술 표준편차를 쓰면
  // 빨강 부근이 0°와 359°로 갈려 거짓으로 커집니다.
  const R=Math.sqrt(sx*sx+sy*sy)/n;
  return +(Math.sqrt(-2*Math.log(Math.max(1e-6,R)))*180/Math.PI).toFixed(1);
}
/**
 * 세로 기울기 — 하늘 위쪽 1/3 평균 휘도 ÷ 아래쪽 1/3.
 *
 * "지평선쪽만 빛나면서" 를 직접 재는 값입니다. 1보다 훨씬 작아야 위는
 * 어둡고 지평선만 타오릅니다. 1에 가까우면 하늘 전체가 고르게 밝아
 * 노을이 아니라 그냥 밝은 흐린 날이 됩니다.
 */
function vertGrad(buf){
  const band=(y0,y1)=>{ let s=0,n=0;
    for(let y=y0;y<y1;y++) for(let x=0;x<TW;x+=2){ s+=lum(buf,y*TW+x); n++; }
    return s/Math.max(1,n); };
  // ⚠ readPixels 는 **아래가 y=0** 입니다. 지평선이 화면 아래에서 약 28%
  // 지점이므로 하늘은 y > 0.30*TH 입니다. 이걸 뒤집어 재면 "하늘 위쪽"
  // 자리에 지면이 들어가 값이 거꾸로 나옵니다.
  const top=band(Math.floor(TH*0.76), TH);              // 천정 쪽
  const bot=band(Math.floor(TH*0.30), Math.floor(TH*0.53)); // 지평선 바로 위
  return +(top/Math.max(1,bot)).toFixed(3);
}
/** 명암폭 — 하늘 화소 휘도의 p90 - p10. 구름 틈이 빛나고 그림자가 지면 커집니다. */
function contrast(buf){
  const v=[];
  for(let y=Math.floor(TH*0.30);y<TH;y++) for(let x=0;x<TW;x+=2) v.push(lum(buf,y*TW+x));
  if(!v.length) return 0;
  v.sort((a,b)=>a-b);
  return +(v[Math.floor(v.length*0.9)]-v[Math.floor(v.length*0.1)]).toFixed(1);
}

/**
 * 구름이 하늘을 얼마나 덮는가. 하늘돔·지형을 끄고 검은 배경에 슬랩만
 * 그려서 잽니다 — 하늘색이 섞이면 "구름인지 하늘인지"를 못 가립니다.
 *
 * 이걸 재는 이유: 노을의 세 가지(지평선만 빛남 / 구름 틈으로 빛나는 하늘 /
 * 반대편 그림자)는 전부 **대비** 현상이라, 하늘이 구름으로 꽉 차면 채도를
 * 아무리 올려도 안 나옵니다.
 */
function coverage(which, aerial, ms, sunAlt){
  skydome.mesh.visible=false; terrain.visible=false; ground.visible=false;
  const buf = shootRaw(sunAlt, which, aerial, ms);
  skydome.mesh.visible=true; terrain.visible=true; ground.visible=true;
  let n=0, tot=0;
  for(let y=Math.floor(TH*0.30);y<TH;y++) for(let x=0;x<TW;x++){
    const L=lum(buf,y*TW+x); tot++; if(L>8) n++;
  }
  return +(n/Math.max(1,tot)).toFixed(3);
}

function shootRaw(sunAlt, which, aerial, ms){
  const a=sunAlt*Math.PI/180, z=SUN_AZ*Math.PI/180;
  const sunDir=new THREE.Vector3(Math.cos(a)*Math.sin(z), Math.sin(a), -Math.cos(a)*Math.cos(z)).normalize();
  updateSkydome(skydome, sunAlt, SUN_AZ, atmosphere);
  updateTerrainColors(terrain, sunAlt, SUN_AZ, atmosphere);
  updateGroundColors(ground, sunAlt, SUN_AZ, atmosphere);
  const W=(k)=>({ speedKmh:k, bearingDeg:260 });
  const common={ camera:cam, widthPx:TW, heightPx:TH, sunDir,
    sunAltDeg:sunAlt, sunAzDeg:SUN_AZ,
    beamFor:(altKm)=>beamAtAltitude(sunAlt, altKm, atmosphere),
    atmosphere, layerWinds:{ low:W(22), mid:W(37), high:W(75) },
    driftHours:0, visible:true };
  cur.mesh.visible = which==='cur'; prev.mesh.visible = which==='prev';
  wide.mesh.visible = which==='wide';
  if (which==='cur') updateCloudSlab(cur, { ...common, cityLight:0, aerialScale:aerial, multiScatter:ms });
  else if (which==='wide') updateCloudSlab(wide, { ...common, cityLight:0, aerialScale:aerial, multiScatter:ms });
  else updatePrevSlab(prev, common);
  renderer.setRenderTarget(null);
  renderer.setClearColor(0x000000, 1);
  renderer.render(scene, cam);
  const buf=new Uint8Array(4*TW*TH);
  gl.readPixels(0,0,TW,TH,gl.RGBA,gl.UNSIGNED_BYTE,buf);
  return buf;
}
const shoot = shootRaw;
function paint(buf,x,y){
  const img=ctx2d.createImageData(TW,TH);
  for(let r=0;r<TH;r++){ const s=(TH-1-r)*TW*4, d=r*TW*4;
    for(let i=0;i<TW*4;i++) img.data[d+i]=buf[s+i]; }
  ctx2d.putImageData(img,x,y);
}

const 결과=[];
const CASES=[
  ['PR #14',              'prev', 1, 1],
  ['현재',                'cur',  1, 1],
  ['+다중산란 0.2',       'cur',  1, 0.2],
  ['+셀 2.0 +다중산란',   'wide', 1, 0.2],
];
SUNS.forEach((sunAlt, si)=>{
  CASES.forEach(([tag, which, aerial, ms], ci)=>{
    const buf=shoot(sunAlt, which, aerial, ms);
    paint(buf, ci*TW, si*TH);
    const ch=chroma(buf), hu=hueSpread(buf), co=contrast(buf);
    const cv=coverage(which, aerial, ms, sunAlt);
    const vg=vertGrad(buf);
    const d=document.createElement('div');
    d.className='lbl'; d.style.left=(ci*TW+12)+'px'; d.style.top=(si*TH+46)+'px';
    d.innerHTML='태양 '+sunAlt+'° <b>'+tag+'</b><br>채도 '+ch+'<br>색상변화 '+hu+'°<br>명암폭 '+co+'<br>구름덮임 '+cv+'<br><b>세로기울기 '+vg+'</b>';
    labels.appendChild(d);
    결과.push({ 태양고도:sunAlt, 조건:tag, 채도:ch, 색상변화:hu, 명암폭:co, 구름덮임:cv, 세로기울기:vg });
  });
});

window.__stats={ glError:gl.getError(), 결과 };
window.__errors=errors;
document.title='DONE::'+(errors.length?'SHADER_ERR':'OK')+'::'+gl.getError();
</script></body></html>`;

fs.mkdirSync(PREVIEW, { recursive: true });
fs.writeFileSync(path.join(PREVIEW, 'sunset-gap.html'), html);
console.log('생성 완료: sunset-gap.html');
