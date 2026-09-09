/**
 * **상층 권운 종횡비를 눈으로 견주는 판.**
 *
 * 실기 보고: "낮은 층의 구름 방향이랑 높은 층의 구름 방향이 너무 눈에 띄게
 * 차이가 나." `build-layer-grain.js` 로 재 보니 방향보다 **결집도**가
 * 문제였습니다 — 상층 0.745 대 저층 0.287, 2.60배. 상층만 종횡비 5.71:1
 * (바람축 배율 0.28 · 가로축 1.6) 의 뚜렷한 필라멘트이고 나머지는 사실상
 * 등방이라, 눈에는 두 층이 서로 무관한 그림으로 읽힙니다.
 *
 * 5.71 은 훑어본 적이 없는 값입니다. 옛 CloudDeck 은 같은 성질을 훑어 4 를
 * 골랐습니다(cloudPresets.ts 의 cellAspect).
 *
 * ## 종횡비만 바꾸고 특징 크기는 안 바꿉니다
 *
 * 두 배율을 아무렇게나 만지면 **종횡비와 크기가 같이** 움직여 무엇이 그림을
 * 바꿨는지 못 가립니다. 기하평균 √(0.28·1.6) = 0.6693 을 고정하고 비만
 * 바꿉니다:
 *
 *     비 5.71 → 0.28  · 1.6      (지금)
 *     비 4.00 → 0.3347 · 1.3387  (옛 덱과 같은 비)
 *
 * ## 무엇을 내나
 *
 * 실기 화면과 같은 조건으로 넷을 찍습니다 — 상층운 20%·6%, 시선 고도 35°와
 * 70°. 각 칸마다 구조 텐서로 결집도를 내고 PNG 를 함께 돌려줍니다.
 * 종횡비는 셰이더 상수라 A/B 는 **스테이징을 두 번** 해야 합니다.
 *
 * 준비: node tools/shader-preview/stage-esm.js
 * 사용: node tools/shader-preview/build-cirrus-aspect.js
 */
const fs = require('fs');
const path = require('path');
const { PREVIEW } = require('./paths');

const TW = 420, TH = 560;           // 세로 — 손전화 화면 비
const SUN_ALT = 28, SUN_AZ = 250;
const WIND_BEARING = 225;           // 실기 화면 셋 중 둘이 남서풍

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
 body{margin:0;background:#0b0f15;font-family:sans-serif;color:#dde}
 #wrap{padding:12px}
 h3{font-size:13px;margin:6px 0}
 canvas{border:1px solid #345;margin:2px}
 .cap{font:10px monospace;color:#9ab}
</style></head><body>
<div id="wrap"><h3>상층 권운 — 종횡비 견주기</h3>
<div id="shots"></div><div id="out"></div></div>
<script type="module">
import * as THREE from './app/vendor/three.module.js';
import { createSkydome, updateSkydome } from './app/components/SkyScene3D/Skydome.js';
import { createCloudSlab, updateCloudSlab, bakeCloudSlabCoverage }
  from './app/components/SkyScene3D/CloudSlab.js';
import { WeatherFan } from './app/utils/skyColumn.js';
import { makeAtmosphereParams, beamAtAltitude } from './app/utils/atmosphere.js';

const errors = [];
window.addEventListener('error', e => errors.push(String(e.message)));

const TW=${TW}, TH=${TH};
const SUN_ALT=${SUN_ALT}, SUN_AZ=${SUN_AZ}, WIND_BEARING=${WIND_BEARING};

const glCanvas = document.createElement('canvas');
glCanvas.width = TW; glCanvas.height = TH;
const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias:false, alpha:false });
renderer.setPixelRatio(1); renderer.setSize(TW, TH, false);
const gl = renderer.getContext();

const atmosphere = makeAtmosphereParams({
  latitude: 37.5, observerElevM: 30, dayOfYear: 240,
  humidityPct: 58, visibilityM: 30000,
});
const scene = new THREE.Scene();
const skydome = createSkydome();
scene.add(skydome.mesh);

// 값잡음 운량장 — 실기처럼 하늘에 얼룩이 있어야 필라멘트가 어떻게 얹히는지
// 보입니다. 균일장으로 찍으면 무늬만 남아 그림 판단이 안 됩니다.
function h21(x,y){ const s=Math.sin(x*127.1+y*311.7)*43758.5453; return s-Math.floor(s); }
function vn(x,y){
  const ix=Math.floor(x), iy=Math.floor(y);
  let fx=x-ix, fy=y-iy; fx=fx*fx*(3-2*fx); fy=fy*fy*(3-2*fy);
  const a=h21(ix,iy), b=h21(ix+1,iy), c=h21(ix,iy+1), d=h21(ix+1,iy+1);
  const t=a+(b-a)*fx; return t + ((c+(d-c)*fx)-t)*fy;
}
function fbmJS(x,y,o){ let s=0,a=0.5,n=0; for(let i=0;i<o;i++){ s+=a*vn(x,y); n+=a; x=x*2.03+7.1; y=y*2.03+3.7; a*=0.5; } return s/n; }

function bake(slab, meanHigh){
  const truth=(x,z)=>Math.max(0, Math.min(1, meanHigh + (fbmJS(x/72+97.7, z/72+97.7, 4)-0.5)*2.0));
  const OFFSETS=[-20,-10,0,10,20], DISTS=[10,30,70,130,200,280,380];
  const pts=[{ distance:0, azimuthOffset:0, low:0, mid:0, high:truth(0,0)*100,
               humidity:58, precipitation:0, visibility:30000 }];
  for (const off of OFFSETS) for (const d of DISTS){
    const a=(SUN_AZ+off)*Math.PI/180, x=d*Math.sin(a), z=-d*Math.cos(a);
    pts.push({ distance:d, azimuthOffset:off, low:0, mid:0, high:truth(x,z)*100,
               humidity:58, precipitation:0 });
  }
  const fan = new WeatherFan(pts, SUN_AZ);
  bakeCloudSlabCoverage(slab, (azDeg, distKm) => {
    const { data, confidence } = fan.sample(azDeg, distKm);
    if (!data) return { low:0, mid:0, high:0, confidence:0 };
    return { low:0, mid:0, high:data.high/100,
             confidence: Math.max(0, Math.min(1, confidence)) };
  });
}

function shoot(slab, elevDeg, fovDeg){
  const cam = new THREE.PerspectiveCamera(fovDeg, TW/TH, 0.1, 2000);
  cam.position.set(0,0,0);
  // 고각에서는 up 이 축퇴하므로 북으로 눕힙니다.
  if (elevDeg > 75) cam.up.set(0,0,-1); else cam.up.set(0,1,0);
  const ar=SUN_AZ*Math.PI/180, er=elevDeg*Math.PI/180;
  cam.lookAt(100*Math.cos(er)*Math.sin(ar), 100*Math.sin(er), -100*Math.cos(er)*Math.cos(ar));
  cam.updateMatrixWorld(true);

  const a=SUN_ALT*Math.PI/180, z=SUN_AZ*Math.PI/180;
  const sunDir=new THREE.Vector3(Math.cos(a)*Math.sin(z), Math.sin(a), -Math.cos(a)*Math.cos(z)).normalize();
  updateSkydome(skydome, SUN_ALT, SUN_AZ, atmosphere);
  const w = { speedKmh: 95, bearingDeg: WIND_BEARING };
  updateCloudSlab(slab, {
    camera: cam, widthPx: TW, heightPx: TH,
    sunDir, sunAltDeg: SUN_ALT, sunAzDeg: SUN_AZ,
    beamFor: (altKm) => beamAtAltitude(SUN_ALT, altKm, atmosphere),
    atmosphere,
    layerWinds: { low:{speedKmh:28,bearingDeg:WIND_BEARING},
                  mid:{speedKmh:48,bearingDeg:WIND_BEARING}, high:w },
    driftHours: 0, visible: true,
  });
  renderer.setRenderTarget(null);
  renderer.setClearColor(0x000000, 1);
  renderer.render(scene, cam);
  const buf=new Uint8Array(4*TW*TH);
  gl.readPixels(0,0,TW,TH,gl.RGBA,gl.UNSIGNED_BYTE,buf);
  return buf;
}

const lum=(b,p)=>0.2126*b[p*4]+0.7152*b[p*4+1]+0.0722*b[p*4+2];

/** 구조 텐서 → 주방향(0~180°)과 결집도(0=등방, 1=완전한 줄무늬). */
function grain(buf){
  let jxx=0, jyy=0, jxy=0;
  const m=Math.round(TH*0.10);
  for(let y=m;y<TH-m;y++) for(let x=m;x<TW-m;x++){
    const i=y*TW+x;
    const gx=lum(buf,i+1)-lum(buf,i-1);
    const gy=lum(buf,i+TW)-lum(buf,i-TW);
    jxx+=gx*gx; jyy+=gy*gy; jxy+=gx*gy;
  }
  const tr=jxx+jyy;
  const diff=Math.sqrt((jxx-jyy)*(jxx-jyy)+4*jxy*jxy);
  const gAng=0.5*Math.atan2(2*jxy, jxx-jyy)*180/Math.PI;
  let ang=(gAng+90)%180; if(ang<0) ang+=180;
  return { 주방향:+ang.toFixed(1), 결집도:+(tr>1e-6?diff/tr:0).toFixed(4) };
}

function toCanvas(buf){
  const c=document.createElement('canvas'); c.width=TW; c.height=TH;
  const cx=c.getContext('2d');
  const img=cx.createImageData(TW,TH);
  for(let y=0;y<TH;y++){ const s=(TH-1-y)*TW*4, d=y*TW*4;
    for(let i=0;i<TW*4;i++) img.data[d+i]=buf[s+i]; }
  cx.putImageData(img,0,0);
  return c;
}

const CASES = [
  { key:'상층 20%·고도 35°', mean:0.20, elev:35, fov:62 },
  { key:'상층 20%·고도 70°', mean:0.20, elev:70, fov:62 },
  { key:'상층 6%·고도 35°',  mean:0.06, elev:35, fov:62 },
  { key:'상층 45%·고도 35°', mean:0.45, elev:35, fov:62 },
];

const 결과={}, 그림={};
for (const c of CASES){
  const slab = createCloudSlab();
  slab.mesh.renderOrder = 10;
  scene.add(slab.mesh);
  bake(slab, c.mean);
  const buf = shoot(slab, c.elev, c.fov);
  const cv = toCanvas(buf);
  cv.style.width='210px'; cv.style.height='280px';
  const t=document.createElement('span'); t.className='cap'; t.textContent=c.key+' ';
  document.getElementById('shots').appendChild(t);
  document.getElementById('shots').appendChild(cv);
  결과[c.key] = grain(buf);
  그림[c.key] = cv.toDataURL('image/png');
  scene.remove(slab.mesh);
  slab.dispose?.();
}

document.getElementById('out').innerHTML='<p>'+JSON.stringify(결과)+'</p>';
window.__stats={ glError: gl.getError(), 결과 };
window.__png=그림;
window.__errors=errors;
document.title='DONE::'+(errors.length?'ERR':'OK')+'::'+gl.getError();
</script></body></html>`;

fs.writeFileSync(path.join(PREVIEW, 'cirrus-aspect.html'), html);
console.log('생성 완료: cirrus-aspect.html');
