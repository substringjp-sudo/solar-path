/**
 * **전천후 격자** — 이 앱은 노을 뷰어가 아니라 하루 종일·전 방향 하늘
 * 모니터입니다. 한 장면에서 좋아 보이는 값이 다른 장면을 깨는 일이
 * 반복돼서, 날씨 × 방향 × 시각을 한 번에 놓고 봅니다.
 *
 * 실제로 이 습작을 만든 계기가 그것입니다: 노을 대비를 되찾으려고 체적
 * 스텝을 3 → 1 로 바꿨더니 vertShadow 가 0.5 → 1.0 이 되어 **밤 구름이
 * 두 배 밝아졌고** 도시광 밑면 가중치도 0.65 → 0.85 로 올라가,
 * `verify-device-repro` 의 한밤중 단언 둘이 깨졌습니다.
 *
 *   날씨 3 (맑음 / 부분운 / 흐림)
 *   방향 3 (태양쪽 / 태양 반대편 / 천정)
 *   시각 4 (한낮 +40° / 노을 0° / 박명 -6° / 밤 -30°)
 *
 * = 36칸. 그림은 부분운 12칸만 싣고, 수치는 36칸 전부 냅니다.
 *
 * 준비: node tools/shader-preview/stage-esm.js
 * 사용: node tools/shader-preview/build-allsky-matrix.js
 */
const fs = require('fs');
const path = require('path');
const { PREVIEW } = require('./paths');

const TW = 240, TH = 240;
const FOV_DEG = 62;
const SUN_AZ = 268;

const WEATHER = [
  { name: '맑음',   low: 4,  mid: 5,  high: 10, hum: 42, vis: 35000 },
  { name: '부분운', low: 28, mid: 42, high: 30, hum: 62, vis: 24000 },
  { name: '흐림',   low: 88, mid: 92, high: 74, hum: 92, vis: 8000 },
];
const VIEWS = [
  { name: '태양쪽',   dAz: 0,   elev: 12 },
  { name: '반대편',   dAz: 180, elev: 12 },
  { name: '천정',     dAz: 0,   elev: 75 },
];
const SUNS = [
  { name: '한낮', alt: 40 },
  { name: '노을', alt: 0 },
  { name: '박명', alt: -6 },
  { name: '밤',   alt: -30 },
];

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
 body{margin:0;background:#0b0f15;font-family:sans-serif;color:#dde}
 #wrap{position:relative;width:${TW * 4 + 24}px;padding:12px}
 .lbl{position:absolute;color:#fff;font-size:10px;font-family:monospace;
   pointer-events:none;line-height:1.35;background:rgba(6,10,16,.78);
   padding:3px 6px;border-radius:4px}
 h3{font-size:13px;margin:6px 0}
 .sub{font-size:11px;color:#8aa;margin:0 0 8px}
</style></head><body>
<div id="wrap">
<h3>전천후 격자 — 부분운. 가로: 한낮 +40° / 노을 0° / 박명 -6° / 밤 -30°</h3>
<p class="sub">세로: 태양쪽 / 태양 반대편 / 천정. 수치는 맑음·흐림까지 36칸 전부 __stats 에 있습니다.</p>
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

const TW=${TW}, TH=${TH}, FOV_DEG=${FOV_DEG}, SUN_AZ=${SUN_AZ};
const WEATHER=${JSON.stringify(WEATHER)};
const VIEWS=${JSON.stringify(VIEWS)};
const SUNS=${JSON.stringify(SUNS)};

const canvas = document.getElementById('c');
canvas.width = TW*SUNS.length; canvas.height = TH*VIEWS.length;
const ctx2d = canvas.getContext('2d');
const glCanvas = document.createElement('canvas');
glCanvas.width = TW; glCanvas.height = TH;
const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias:false, alpha:false });
renderer.setPixelRatio(1); renderer.setSize(TW, TH, false);

const scene = new THREE.Scene();
const skydome = createSkydome(); scene.add(skydome.mesh);
const angles = [];
for (let i=0;i<72;i++) angles.push(0.4 + 0.9*Math.sin(i*0.21) + 0.5*Math.sin(i*0.07+1.3));
const terrain = createTerrainRing(angles); scene.add(terrain);
const ground = createGroundPlane(); setGroundHorizon(ground, 30); scene.add(ground);
const slab = createCloudSlab(); slab.mesh.renderOrder = 10; scene.add(slab.mesh);

const gl = renderer.getContext();
const labels = document.getElementById('labels');
const lum=(b,p)=>0.2126*b[p*4]+0.7152*b[p*4+1]+0.0722*b[p*4+2];

const OFFSETS=[-180,-150,-120,-90,-60,-30,0,30,60,90,120,150,180];
const DISTS=[2,5,12,30,70,160,360];
const jit=(v,d,a)=>Math.max(0,Math.min(100, v + 16*Math.sin(d*0.031+a*0.017) + 11*Math.cos(d*0.017-a*0.026)));
function bake(w){
  const pts=[{ distance:0, azimuthOffset:0, low:w.low, mid:w.mid, high:w.high,
               humidity:w.hum, precipitation:0, visibility:w.vis }];
  for (const off of OFFSETS) for (const d of DISTS){
    pts.push({ distance:d, azimuthOffset:off, low:jit(w.low,d,off),
      mid:jit(w.mid,d,off+40), high:jit(w.high,d,off+80),
      humidity:w.hum, precipitation:0 });
  }
  const fan = new WeatherFan(pts, SUN_AZ);
  bakeCloudSlabCoverage(slab, (azDeg, distKm) => {
    const { data, confidence } = fan.sample(azDeg, distKm);
    if (!data) return { low:0, mid:0, high:0, confidence:0 };
    return { low:data.low/100, mid:data.mid/100, high:data.high/100,
             confidence: Math.max(0, Math.min(1, confidence)) };
  });
}

function shoot(w, v, s, slabOnly){
  const cam = new THREE.PerspectiveCamera(FOV_DEG, TW/TH, 0.1, 2000);
  cam.position.set(0,0,0); cam.up.set(0,1,0);
  const az=(SUN_AZ+v.dAz)*Math.PI/180, er=v.elev*Math.PI/180;
  cam.lookAt(100*Math.cos(er)*Math.sin(az), 100*Math.sin(er), -100*Math.cos(er)*Math.cos(az));
  cam.updateMatrixWorld(true);
  const atmosphere = makeAtmosphereParams({
    latitude: 37.5, observerElevM: 30, dayOfYear: 240, humidityPct: w.hum, visibilityM: w.vis });
  const a=s.alt*Math.PI/180, z=SUN_AZ*Math.PI/180;
  const sunDir=new THREE.Vector3(Math.cos(a)*Math.sin(z), Math.sin(a), -Math.cos(a)*Math.cos(z)).normalize();

  skydome.mesh.visible=!slabOnly; terrain.visible=!slabOnly; ground.visible=!slabOnly;
  if(!slabOnly){
    updateSkydome(skydome, s.alt, SUN_AZ, atmosphere);
    updateTerrainColors(terrain, s.alt, SUN_AZ, atmosphere);
    updateGroundColors(ground, s.alt, SUN_AZ, atmosphere);
  }
  const W=(k)=>({ speedKmh:k, bearingDeg:260 });
  updateCloudSlab(slab, {
    camera: cam, widthPx: TW, heightPx: TH, sunDir,
    sunAltDeg: s.alt, sunAzDeg: SUN_AZ,
    // 밤 판정을 위해 달과 도시광을 앱 기본에 가깝게 둡니다.
    moonDir: new THREE.Vector3(0.35,0.55,-0.75).normalize(), moonAltDeg: 33, moonIllum: 0.55,
    cityLight: 0.65,
    beamFor:(altKm)=>beamAtAltitude(s.alt, altKm, atmosphere),
    atmosphere, layerWinds:{ low:W(22), mid:W(37), high:W(75) },
    driftHours: 6, visible:true });
  renderer.setRenderTarget(null);
  renderer.setClearColor(0x000000, 1);
  renderer.render(scene, cam);
  const buf=new Uint8Array(4*TW*TH);
  gl.readPixels(0,0,TW,TH,gl.RGBA,gl.UNSIGNED_BYTE,buf);
  return buf;
}
function paint(buf,x,y){
  const img=ctx2d.createImageData(TW,TH);
  for(let r=0;r<TH;r++){ const s=(TH-1-r)*TW*4, d=r*TW*4;
    for(let i=0;i<TW*4;i++) img.data[d+i]=buf[s+i]; }
  ctx2d.putImageData(img,x,y);
}

// ⚠ readPixels 는 **아래가 y=0**. 지평선 뷰에서 하늘은 y > 0.30*TH 입니다.
const SKY0 = (v) => v.name==='천정' ? 0 : Math.floor(TH*0.30);
function meanLum(buf,v){ let s=0,n=0;
  for(let y=SKY0(v);y<TH;y++) for(let x=0;x<TW;x++){ s+=lum(buf,y*TW+x); n++; }
  return +(s/Math.max(1,n)).toFixed(1); }
function contrast(buf,v){ const a=[];
  for(let y=SKY0(v);y<TH;y++) for(let x=0;x<TW;x+=2) a.push(lum(buf,y*TW+x));
  a.sort((p,q)=>p-q);
  return +(a[Math.floor(a.length*0.9)]-a[Math.floor(a.length*0.1)]).toFixed(1); }
function warmth(buf,v){ let r=0,b=0;
  for(let y=SKY0(v);y<TH;y++) for(let x=0;x<TW;x++){ r+=buf[(y*TW+x)*4]; b+=buf[(y*TW+x)*4+2]; }
  return +(r/Math.max(1,b)).toFixed(3); }
/** 구름덮임 — 하늘돔을 끄고 검은 배경에 슬랩만 그려서 잽니다. */
function cover(buf,v){ let n=0,t=0;
  for(let y=SKY0(v);y<TH;y++) for(let x=0;x<TW;x++){ t++; if(lum(buf,y*TW+x)>6) n++; }
  return +(n/Math.max(1,t)).toFixed(3); }
/** 축 정렬 무늬 — 천정 별똥·지평선 격자가 서면 1을 넘습니다. */
function gridness(buf){ let ax=0,dg=0;
  for(let y=2;y<TH-2;y++) for(let x=2;x<TW-2;x++){
    const i=y*TW+x, L=lum(buf,i);
    ax+=Math.abs(L-lum(buf,i+1))+Math.abs(L-lum(buf,i+TW));
    dg+=Math.abs(L-lum(buf,i+TW+1))+Math.abs(L-lum(buf,i+TW-1)); }
  return +(ax/Math.max(1e-6, dg/Math.SQRT2)).toFixed(3); }

const 결과=[];
WEATHER.forEach(w=>{
  bake(w);
  VIEWS.forEach((v,vi)=>{
    SUNS.forEach((s,si)=>{
      const buf=shoot(w,v,s,false);
      const cbuf=shoot(w,v,s,true);
      const row={ 날씨:w.name, 방향:v.name, 시각:s.name, 태양고도:s.alt,
        평균휘도:meanLum(buf,v), 명암폭:contrast(buf,v), RB:warmth(buf,v),
        구름덮임:cover(cbuf,v), 격자성:gridness(buf) };
      결과.push(row);
      if (w.name==='부분운'){
        paint(buf, si*TW, vi*TH);
        const d=document.createElement('div');
        d.className='lbl'; d.style.left=(si*TW+10)+'px'; d.style.top=(vi*TH+44)+'px';
        d.innerHTML=v.name+' · '+s.name+'<br>휘도 '+row.평균휘도+'<br>명암폭 '+row.명암폭
                   +'<br>덮임 '+row.구름덮임+'<br>격자 '+row.격자성;
        labels.appendChild(d);
      }
    });
  });
});

window.__stats={ glError:gl.getError(), 결과 };
window.__errors=errors;
document.title='DONE::'+(errors.length?'SHADER_ERR':'OK')+'::'+gl.getError();
</script></body></html>`;

fs.mkdirSync(PREVIEW, { recursive: true });
fs.writeFileSync(path.join(PREVIEW, 'allsky-matrix.html'), html);
console.log('생성 완료: allsky-matrix.html');
