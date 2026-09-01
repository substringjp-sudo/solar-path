/**
 * **하네스 그림과 앱 그림이 왜 다른가** — 같은 장면을 두 경로로 그립니다.
 *
 * 지금까지 튜닝은 전부 하네스 그림 위에서 했는데, 하네스는 **원해상도로
 * 곧장** 그리고 앱은 다릅니다:
 *
 *   하늘돔·구름   → 절반 해상도 버퍼 (DEFAULT_SOFT_SCALE = 2)
 *   그 위에        → 블룸 + 박명광선 + 디더 + 업스케일
 *   별·태양·지형   → 원해상도
 *
 * 즉 앱에서 보이는 것은 **하네스 그림을 절반으로 줄였다 늘리고 후처리를
 * 얹은 것**입니다. 어느 단계가 얼마나 먹는지 갈라 봅니다.
 *
 *   1칸 하네스 (원해상도, 후처리 없음)
 *   2칸 절반 해상도만 (후처리 없음)
 *   3칸 절반 + 블룸
 *   4칸 앱 그대로 (절반 + 블룸 + 박명광선 + 디더)
 *
 * 준비: node tools/shader-preview/stage-esm.js
 * 사용: node tools/shader-preview/build-app-vs-harness.js
 */
const fs = require('fs');
const path = require('path');
const { PREVIEW } = require('./paths');

const TW = 300, TH = 300;
const FOV_DEG = 62;
const VIEW_AZ = 262, VIEW_ELEV = 14, SUN_AZ = 268;
const SUNS = [25, 2, 0, -3];

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
<h3>하네스 그림 → 앱 그림. 가로: 원해상도 / 배율2(현행) / 배율1.5 / 배율1</h3>
<p class="sub">세로: 태양 +25° / +2° / 0° / -3°. 배율 외 조건은 전부 앱과 같습니다(블룸·박명광선·디더 켜짐).</p>
<canvas id="c"></canvas><div id="labels"></div></div>
<script type="module">
import * as THREE from './app/vendor/three.module.js';
import { createSkydome, updateSkydome } from './app/components/SkyScene3D/Skydome.js';
import { createTerrainRing, createGroundPlane, updateTerrainColors, updateGroundColors,
         setGroundHorizon } from './app/components/SkyScene3D/TerrainRing.js';
import { createCloudSlab, updateCloudSlab, bakeCloudSlabCoverage }
  from './app/components/SkyScene3D/CloudSlab.js';
import { createSun, updateSun } from './app/components/SkyScene3D/SunMesh.js';
import { createSceneComposer, assignLayer, LAYER_SOFT_SKY, LAYER_MID,
         LAYER_SOFT_CLOUD, DEFAULT_SOFT_SCALE }
  from './app/components/SkyScene3D/SceneComposer.js';
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

// 앱과 **같은 레이어 배치**로 씬을 짭니다. 합성기가 레이어로 층을 가릅니다.
const scene = new THREE.Scene();
const skydome = createSkydome(); assignLayer(skydome.mesh, LAYER_SOFT_SKY); scene.add(skydome.mesh);
const angles = [];
for (let i=0;i<72;i++) angles.push(0.4 + 0.9*Math.sin(i*0.21) + 0.5*Math.sin(i*0.07+1.3));
const terrain = createTerrainRing(angles); assignLayer(terrain, LAYER_MID); scene.add(terrain);
const ground = createGroundPlane(); setGroundHorizon(ground, 30);
assignLayer(ground, LAYER_MID); scene.add(ground);
const sun = createSun(); assignLayer(sun.mesh, LAYER_MID); scene.add(sun.mesh);
const slab = createCloudSlab(); slab.mesh.renderOrder = 10;
assignLayer(slab.mesh, LAYER_SOFT_CLOUD); scene.add(slab.mesh);

// 합성기 — 앱과 같은 기본값.
const composer = createSceneComposer(TW, TH, DEFAULT_SOFT_SCALE);

// build-cloud-slab.js 와 같은 합성 예보.
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
bakeCloudSlabCoverage(slab, (azDeg, distKm) => {
  const { data, confidence } = fan.sample(azDeg, distKm);
  if (!data) return { low:0, mid:0, high:0, confidence:0 };
  return { low:data.low/100, mid:data.mid/100, high:data.high/100,
           confidence: Math.max(0, Math.min(1, confidence)) };
});

const cam = new THREE.PerspectiveCamera(FOV_DEG, TW/TH, 0.1, 2000);
cam.position.set(0,0,0); cam.up.set(0,1,0);
{
  const ar=VIEW_AZ*Math.PI/180, er=VIEW_ELEV*Math.PI/180;
  cam.lookAt(100*Math.cos(er)*Math.sin(ar), 100*Math.sin(er), -100*Math.cos(er)*Math.cos(ar));
  cam.updateMatrixWorld(true);
}
// 합성기가 레이어로 고르므로 카메라는 다섯 레이어를 다 봐야 합니다.
cam.layers.enableAll();

const gl = renderer.getContext();
const labels = document.getElementById('labels');
const lum=(b,p)=>0.2126*b[p*4]+0.7152*b[p*4+1]+0.0722*b[p*4+2];
const SKY0 = Math.floor(TH*0.30);

function contrast(buf){ const a=[];
  for(let y=SKY0;y<TH;y++) for(let x=0;x<TW;x+=2) a.push(lum(buf,y*TW+x));
  a.sort((p,q)=>p-q);
  return +(a[Math.floor(a.length*0.9)]-a[Math.floor(a.length*0.1)]).toFixed(1); }
function meanLum(buf){ let s=0,n=0;
  for(let y=SKY0;y<TH;y++) for(let x=0;x<TW;x++){ s+=lum(buf,y*TW+x); n++; }
  return +(s/n).toFixed(1); }
function chroma(buf){ let s=0,n=0;
  for(let y=SKY0;y<TH;y++) for(let x=0;x<TW;x++){ const p=y*TW+x;
    const r=buf[p*4],g=buf[p*4+1],b=buf[p*4+2];
    const mx=Math.max(r,g,b), mn=Math.min(r,g,b);
    if (mx<24) continue; s+=(mx-mn)/mx; n++; }
  return +(s/Math.max(1,n)).toFixed(3); }
/** 세부 보존 — 이웃 화소 밝기차의 평균. 저해상도로 뭉개지면 떨어집니다. */
function detail(buf){ let s=0,n=0;
  for(let y=SKY0;y<TH-1;y++) for(let x=0;x<TW-1;x++){ const i=y*TW+x;
    s+=Math.abs(lum(buf,i)-lum(buf,i+1))+Math.abs(lum(buf,i)-lum(buf,i+TW)); n+=2; }
  return +(s/n).toFixed(3); }
/** 빛 받은 구름 평균 색상각 — 사진 잣대와 같은 식. */
function litHue(buf){
  const idx=[]; for(let y=SKY0;y<TH;y++) for(let x=0;x<TW;x++) idx.push(y*TW+x);
  const ls=idx.map(i=>lum(buf,i)).sort((a,b)=>a-b);
  const cut=ls[Math.floor(ls.length*0.70)];
  let sx=0, sy=0, n=0;
  for(const i of idx){ if(lum(buf,i)<cut) continue;
    const r=buf[i*4]/255,g=buf[i*4+1]/255,b=buf[i*4+2]/255;
    const mx=Math.max(r,g,b), mn=Math.min(r,g,b), d=mx-mn;
    if(mx<=0 || d/mx<0.05) continue;
    let h; if(mx===r)h=((g-b)/d)%6; else if(mx===g)h=(b-r)/d+2; else h=(r-g)/d+4;
    h*=60; if(h<0)h+=360;
    const rad=h*Math.PI/180; sx+=Math.cos(rad); sy+=Math.sin(rad); n++; }
  if(!n) return 0;
  let mh=Math.atan2(sy/n, sx/n)*180/Math.PI; if(mh<0)mh+=360;
  return +mh.toFixed(1); }

function setupSun(sunAlt){
  const a=sunAlt*Math.PI/180, z=SUN_AZ*Math.PI/180;
  const dir=new THREE.Vector3(Math.cos(a)*Math.sin(z), Math.sin(a), -Math.cos(a)*Math.cos(z)).normalize();
  updateSkydome(skydome, sunAlt, SUN_AZ, atmosphere);
  updateTerrainColors(terrain, sunAlt, SUN_AZ, atmosphere);
  updateGroundColors(ground, sunAlt, SUN_AZ, atmosphere);
  updateSun(sun, sunAlt, SUN_AZ, atmosphere);
  const W=(k)=>({ speedKmh:k, bearingDeg:260 });
  return { dir, common: { camera:cam, sunDir:dir, sunAltDeg:sunAlt, sunAzDeg:SUN_AZ,
    beamFor:(altKm)=>beamAtAltitude(sunAlt, altKm, atmosphere),
    atmosphere, layerWinds:{ low:W(22), mid:W(37), high:W(75) },
    driftHours:0, cityLight:0, visible:true } };
}
function grab(){
  const buf=new Uint8Array(4*TW*TH);
  gl.readPixels(0,0,TW,TH,gl.RGBA,gl.UNSIGNED_BYTE,buf);
  return buf;
}
/** 하네스 경로 — 원해상도로 곧장. */
function shootDirect(sunAlt){
  const { common } = setupSun(sunAlt);
  updateCloudSlab(slab, { ...common, widthPx:TW, heightPx:TH });
  renderer.setRenderTarget(null);
  renderer.setClearColor(0x000000, 1);
  renderer.clear();
  renderer.render(scene, cam);
  return grab();
}
/** 앱 경로 — 합성기를 통과. bloom/rays 를 꺼서 단계를 가릅니다. */
function shootComposed(sunAlt, scale, bloom, rays){
  const { dir, common } = setupSun(sunAlt);
  composer.setSoftScale(scale);
  composer.setBloom({ strength: bloom });
  composer.setGodRays({ strength: rays });
  composer.setDither(1);
  composer.setSun(rays > 0 ? dir : null, sunAlt);
  // 슬랩은 **합성기가 실제로 쓰는 저해상도 크기**를 받아야 합니다 —
  // 화소 각크기(LOD)가 거기서 나옵니다. 앱도 같은 값을 넘깁니다.
  const s = composer.softSize();
  updateCloudSlab(slab, { ...common, widthPx:s.width, heightPx:s.height });
  composer.render(renderer, scene, cam);
  return grab();
}
function paint(buf,x,y){
  const img=ctx2d.createImageData(TW,TH);
  for(let r=0;r<TH;r++){ const s=(TH-1-r)*TW*4, d=r*TW*4;
    for(let i=0;i<TW*4;i++) img.data[d+i]=buf[s+i]; }
  ctx2d.putImageData(img,x,y);
}

const 결과=[];
// 블룸·박명광선·디더가 거의 무해하다는 것은 이미 쟀습니다(세부 1.700 대
// 1.719). 이제 남은 유일한 레버 — **해상도 배율**을 훑습니다.
const CASES=[
  ['하네스(원해상도)', 'direct', 2,   0, 0],
  ['앱 배율 2 (현행)', 'comp',   2,   0.5, 0.35],
  ['배율 1.5',         'comp',   1.5, 0.5, 0.35],
  ['배율 1 (합성만)',  'comp',   1,   0.5, 0.35],
];
SUNS.forEach((sunAlt, si)=>{
  CASES.forEach(([tag, mode, sc, bl, ry], ci)=>{
    const buf = mode==='direct' ? shootDirect(sunAlt) : shootComposed(sunAlt, sc, bl, ry);
    paint(buf, ci*TW, si*TH);
    // 프래그먼트 비용의 대용 — swiftshader 는 CPU 래스터라이저라 벽시계
    // 시간이 화소 수에 거의 비례합니다. 실기기 GPU 의 절대값은 아니지만
    // **배율 사이의 상대비**는 이걸로 봅니다.
    let t0=performance.now();
    for(let k=0;k<6;k++){
      if(mode==='direct') shootDirect(sunAlt); else shootComposed(sunAlt, sc, bl, ry);
    }
    const ms=+((performance.now()-t0)/6).toFixed(1);
    const row={ 태양고도:sunAlt, 조건:tag, 평균휘도:meanLum(buf), 명암폭:contrast(buf),
                채도:chroma(buf), 세부:detail(buf), 색상각:litHue(buf), ms };
    결과.push(row);
    const d=document.createElement('div');
    d.className='lbl'; d.style.left=(ci*TW+12)+'px'; d.style.top=(si*TH+46)+'px';
    d.innerHTML='태양 '+sunAlt+'° <b>'+tag+'</b><br>휘도 '+row.평균휘도+'<br>명암폭 '+row.명암폭
               +'<br>세부 '+row.세부+'<br>색상 '+row.색상각+'°<br><b>'+row.ms+'ms</b>';
    labels.appendChild(d);
  });
});

// ── 배율 전환 직후 프레임이 멀쩡한가 ────────────────────────────────
//
// 앱은 프레임 시간을 보고 배율을 **실시간으로** 바꿉니다(적응 해상도).
// 배율을 바꾸면 렌더 타깃을 다시 만드는데, 그 직후 프레임이 검게 나오거나
// 옛 버퍼가 비치면 화면이 깜빡입니다. 전환 직후 한 장과 안정 상태 한 장을
// 비교해 같은 그림인지 봅니다.
const 전환 = [];
for (const [from, to] of [[2, 1], [1, 2], [2, 1.5], [1.5, 1]]) {
  composer.setSoftScale(from);
  shootComposed(0, from, 0.5, 0.35);          // 예열
  composer.setSoftScale(to);
  const 직후 = shootComposed(0, to, 0.5, 0.35); // 전환 직후 첫 프레임
  const 안정 = shootComposed(0, to, 0.5, 0.35); // 같은 배율 두 번째 프레임
  let diff = 0;
  for (let i = 0; i < TW * TH; i++) diff += Math.abs(lum(직후, i) - lum(안정, i));
  전환.push({ 전환: from + '→' + to, 평균차: +(diff / (TW * TH)).toFixed(3),
              직후휘도: meanLum(직후), 안정휘도: meanLum(안정) });
}

window.__stats={ glError:gl.getError(), 결과, 전환 };
window.__errors=errors;
document.title='DONE::'+(errors.length?'SHADER_ERR':'OK')+'::'+gl.getError();
</script></body></html>`;

fs.mkdirSync(PREVIEW, { recursive: true });
fs.writeFileSync(path.join(PREVIEW, 'app-vs-harness.html'), html);
console.log('생성 완료: app-vs-harness.html');
