/**
 * **`CloudSlab.ts` 합격 습작** — 앱 모듈을 그대로 임포트합니다.
 *
 * 프로토타입(`build-look-sample.js`)은 셰이더를 하네스 안에 복사해 둔
 * 것이라 앱과 갈라질 수 있었습니다. 여기서는 앱이 쓰는 바로 그 모듈을
 * 임포트하므로, 이 화면이 곧 앱 화면입니다.
 *
 * 운량장은 실제 `WeatherFan` 을 통해 굽습니다 — 합성 예보를 팬에 넣고,
 * 팬이 답한 값으로 지상 2D 텍스처를 만듭니다. 앱에서 하는 일과 같습니다.
 *
 * 준비: node tools/shader-preview/stage-esm.js
 * 사용: node tools/shader-preview/build-cloud-slab.js
 */
const fs = require('fs');
const path = require('path');
const { PREVIEW } = require('./paths');

const TW = 460, TH = 460;
const FOV_DEG = 62;
const VIEW_AZ = 262, VIEW_ELEV = 14;
const SUN_AZ = 268;
const PANELS = [8, 2, 0, -3];

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
 body{margin:0;background:#0b0f15;font-family:sans-serif;color:#dde}
 #wrap{position:relative;width:${TW * 4 + 24}px;padding:12px}
 .lbl{position:absolute;color:#fff;font-size:12px;font-family:monospace;
   pointer-events:none;line-height:1.45;background:rgba(6,10,16,.72);
   padding:5px 8px;border-radius:5px}
 h3{font-size:13px;margin:6px 0}
 .sub{font-size:11px;color:#8aa;margin:0 0 8px}
</style></head><body>
<div id="wrap">
<h3>CloudSlab — 앱 모듈 그대로. 하늘돔·지형 위에 구름 슬랩을 얹습니다 (태양 고도만 바뀜)</h3>
<p class="sub">운량장은 실제 WeatherFan 을 통해 구운 지상 2D 텍스처입니다. 문턱 없음 · 극좌표 격자 없음.</p>
<canvas id="c"></canvas><div id="labels"></div></div>
<script type="module">
import * as THREE from './app/vendor/three.module.js';
import { createSkydome, updateSkydome } from './app/components/SkyScene3D/Skydome.js';
import { createTerrainRing, createGroundPlane, updateTerrainColors, updateGroundColors,
         setGroundHorizon } from './app/components/SkyScene3D/TerrainRing.js';
import { createCloudSlab, updateCloudSlab, bakeCloudSlabCoverage }
  from './app/components/SkyScene3D/CloudSlab.js';
import { WeatherFan } from './app/utils/skyColumn.js';
import { makeAtmosphereParams, beamAtAltitude } from './app/utils/atmosphere.js';

const errors = [];
const oe = console.error;
console.error = (...a) => { errors.push(a.join(' ')); oe(...a); };

const TW=${TW}, TH=${TH}, FOV_DEG=${FOV_DEG};
const VIEW_AZ=${VIEW_AZ}, VIEW_ELEV=${VIEW_ELEV}, SUN_AZ=${SUN_AZ};
const PANELS=${JSON.stringify(PANELS)};

const canvas = document.getElementById('c');
canvas.width = TW*4; canvas.height = TH;
const ctx2d = canvas.getContext('2d');
const glCanvas = document.createElement('canvas');
glCanvas.width = TW; glCanvas.height = TH;
const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias:false, alpha:false });
renderer.setPixelRatio(1); renderer.setSize(TW, TH, false);
renderer.autoClear = true;

const atmosphere = makeAtmosphereParams({
  latitude: 37.5, observerElevM: 30, dayOfYear: 240,
  humidityPct: 62, visibilityM: 24000,
});

const scene = new THREE.Scene();
const skydome = createSkydome();
scene.add(skydome.mesh);
const angles = [];
for (let i=0;i<72;i++) angles.push(0.4 + 0.9*Math.sin(i*0.21) + 0.5*Math.sin(i*0.07+1.3));
const terrain = createTerrainRing(angles);
scene.add(terrain);
const ground = createGroundPlane();
setGroundHorizon(ground, 30);
scene.add(ground);

// ── 구름 슬랩 ───────────────────────────────────────────────────────────
const slab = createCloudSlab();
// 하늘돔·지형보다 뒤에 그려 그 위에 얹습니다.
slab.mesh.renderOrder = 10;
scene.add(slab.mesh);

// 합성 예보를 실제 팬에 넣습니다 (앱에서 오는 경로와 같은 자료 구조).
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

// 계획 3절의 수정된 사다리.
const OFFSETS=[-180,-150,-120,-90,-60,-30,0,30,60,90,120,150,180];
const DISTS=[2,5,12,30,70,160,360];
const pts=[{ distance:0, azimuthOffset:0, low:truth('low',0,0)*100, mid:truth('mid',0,0)*100,
             high:truth('high',0,0)*100, humidity:62, precipitation:0, visibility:24000 }];
for (const off of OFFSETS) for (const d of DISTS){
  const a=(SUN_AZ+off)*Math.PI/180, x=d*Math.sin(a), z=-d*Math.cos(a);
  pts.push({ distance:d, azimuthOffset:off, low:truth('low',x,z)*100,
             mid:truth('mid',x,z)*100, high:truth('high',x,z)*100,
             humidity:62, precipitation:0 });
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

const gl = renderer.getContext();
const labels = document.getElementById('labels');

function shoot(sunAlt){
  const a=sunAlt*Math.PI/180, z=SUN_AZ*Math.PI/180;
  const sunDir=new THREE.Vector3(Math.cos(a)*Math.sin(z), Math.sin(a), -Math.cos(a)*Math.cos(z)).normalize();
  updateSkydome(skydome, sunAlt, SUN_AZ, atmosphere);
  updateTerrainColors(terrain, sunAlt, SUN_AZ, atmosphere);
  updateGroundColors(ground, sunAlt, SUN_AZ, atmosphere);
  updateCloudSlab(slab, {
    camera: cam, widthPx: TW, heightPx: TH,
    sunDir, sunAltDeg: sunAlt, sunAzDeg: SUN_AZ,
    beamFor: (altKm) => beamAtAltitude(sunAlt, altKm, atmosphere),
    atmosphere, timeSeconds: 0, visible: true,
  });
  renderer.setRenderTarget(null);
  renderer.setClearColor(0x000000, 1);
  renderer.render(scene, cam);
  const buf=new Uint8Array(4*TW*TH);
  gl.readPixels(0,0,TW,TH,gl.RGBA,gl.UNSIGNED_BYTE,buf);
  return buf;
}
function paint(buf,x){
  const img=ctx2d.createImageData(TW,TH);
  for(let y=0;y<TH;y++){ const s=(TH-1-y)*TW*4, d=y*TW*4;
    for(let i=0;i<TW*4;i++) img.data[d+i]=buf[s+i]; }
  ctx2d.putImageData(img,x,0);
}
const lum=(b,p)=>0.2126*b[p*4]+0.7152*b[p*4+1]+0.0722*b[p*4+2];
/** 노을 채도 — 계획 3단계 판정: 태양 0~+5° 에서 0.3 이상. */
function chroma(buf){
  let s=0,n=0;
  for(let p=0;p<TW*TH;p++){
    const r=buf[p*4],g=buf[p*4+1],b=buf[p*4+2];
    const mx=Math.max(r,g,b), mn=Math.min(r,g,b);
    if (mx<24) continue;
    s+=(mx-mn)/mx; n++;
  }
  return +(s/Math.max(1,n)).toFixed(3);
}
/** 축 정렬 격자성 — 타일 반복이 있으면 1보다 뚜렷이 큽니다. */
function gridness(buf){
  let ax=0,dg=0;
  for(let y=2;y<TH-2;y++) for(let x=2;x<TW-2;x++){
    const i=y*TW+x, L=lum(buf,i);
    ax+=Math.abs(L-lum(buf,i+1))+Math.abs(L-lum(buf,i+TW));
    dg+=Math.abs(L-lum(buf,i+TW+1))+Math.abs(L-lum(buf,i+TW-1));
  }
  return +(ax/Math.max(1e-6, dg/Math.SQRT2)).toFixed(3);
}

const 결과 = PANELS.map((alt,i)=>{
  const buf=shoot(alt); paint(buf,i*TW);
  const ch=chroma(buf), gr=gridness(buf);
  const d=document.createElement('div');
  d.className='lbl'; d.style.left=(i*TW+20)+'px'; d.style.top='58px';
  d.innerHTML='태양 '+alt+'°<br>채도 '+ch+'<br>격자성 '+gr;
  labels.appendChild(d);
  return { 태양고도:alt, 채도:ch, 격자성:gr };
});

window.__stats = { glError: gl.getError(), 결과,
  운량장: { 크기: slab.coverTex.image.width, 반경km: slab.rangeKm } };
window.__errors = errors;
document.title = 'DONE::' + (errors.length ? 'SHADER_ERR' : 'OK') + '::' + gl.getError();
</script></body></html>`;

fs.mkdirSync(PREVIEW, { recursive: true });
fs.writeFileSync(path.join(PREVIEW, 'cloud-slab.html'), html);
console.log('생성 완료: cloud-slab.html');
