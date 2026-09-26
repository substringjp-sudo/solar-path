/**
 * **실기기 화면을 그대로 재현**합니다 — 화면 QR에서 디코드한 입력을 씁니다.
 *
 * 왜 필요한가: `verify-cloud-slab.js` 는 FOV 62°, 시선 고도 14°, 태양
 * +8~-3° 만 봅니다. 실기기 캡처는 **FOV 120°, 천정 포함, 태양 -42°**
 * 였습니다. 셋 다 하네스가 한 번도 안 밟은 영역이고, 거기서 그림이
 * 무너집니다. 이 습작은 그 사각지대를 정확히 겨냥합니다.
 *
 * 세로 3줄 = QR 세 장, 가로 4칸 = 원인 분리:
 *   현재 그대로 / 이류만 끔 / 도시광만 끔 / 둘 다 끔
 *
 * 준비: node tools/shader-preview/stage-esm.js
 * 사용: node tools/shader-preview/build-device-repro.js
 */
const fs = require('fs');
const path = require('path');
const { PREVIEW } = require('./paths');

const TW = 380, TH = 300;

/** 화면 QR 에서 디코드한 실제 입력 (tools/qr-report/decode-report.js). */
const SHOTS = [
  { name: '23:59 · FOV120', fov: 120, elev: 35,
    sunAlt: -42.11, sunAz: 348.53, low: 42, mid: 72, high: 78,
    humidity: 88, vis: 7600, driftH: 14.98 },
  { name: '22:40 · FOV60', fov: 60, elev: 30,
    sunAlt: -35.84, sunAz: 324.78, low: 44, mid: 64, high: 65,
    humidity: 88, vis: 6682, driftH: 13.67 },
  { name: '16:59 · FOV120', fov: 120, elev: 25,
    sunAlt: 24.66, sunAz: 263.37, low: 40, mid: 50, high: 42,
    humidity: 81, vis: 4948, driftH: 7.98 },
];

/** 앱이 실제로 쓰는 층별 바람. QR 은 하층만 싣습니다 — 중·상층은 기압면 비율. */
const WIND = { low: 13.9, mid: 24, high: 75 };
const WIND_DEG = 189;

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
 body{margin:0;background:#0b0f15;font-family:sans-serif;color:#dde}
 #wrap{position:relative;width:${TW * 4 + 24}px;padding:12px}
 .lbl{position:absolute;color:#fff;font-size:11px;font-family:monospace;
   pointer-events:none;line-height:1.4;background:rgba(6,10,16,.75);
   padding:4px 7px;border-radius:4px}
 h3{font-size:13px;margin:6px 0}
 .sub{font-size:11px;color:#8aa;margin:0 0 8px}
</style></head><body>
<div id="wrap">
<h3>실기기 재현 — 화면 QR 실측 입력. 가로: 도시광 세기 1.00 / 0.60 / 0.30 / 0</h3>
<p class="sub">위 두 줄은 한밤중(태양 -42°, -36°)입니다. 하늘이 금색이면 그건 구름이 아니라 조명 항입니다.</p>
<canvas id="c"></canvas><div id="labels"></div></div>
<script type="module">
import * as THREE from './app/vendor/three.module.js';
import { createSkydome, updateSkydome } from './app/components/SkyScene3D/Skydome.js';
import { createCloudSlab, updateCloudSlab, bakeCloudSlabCoverage }
  from './app/components/SkyScene3D/CloudSlab.js';
import { WeatherFan } from './app/utils/skyColumn.js';
import { makeAtmosphereParams, beamAtAltitude, moonLight, setSceneCityLight, applyTuningUniforms } from './app/utils/atmosphere.js';

const errors = [];
const oe = console.error;
console.error = (...a) => { errors.push(a.join(' ')); oe(...a); };

const TW=${TW}, TH=${TH};
const SHOTS=${JSON.stringify(SHOTS)};
const WIND=${JSON.stringify(WIND)}, WIND_DEG=${WIND_DEG};

const canvas = document.getElementById('c');
canvas.width = TW*4; canvas.height = TH*SHOTS.length;
const ctx2d = canvas.getContext('2d');
const glCanvas = document.createElement('canvas');
glCanvas.width = TW; glCanvas.height = TH;
const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias:false, alpha:false });
renderer.setPixelRatio(1); renderer.setSize(TW, TH, false);

const scene = new THREE.Scene();
const skydome = createSkydome();
scene.add(skydome.mesh);
const slab = createCloudSlab();
slab.mesh.renderOrder = 10;
scene.add(slab.mesh);

const gl = renderer.getContext();
const labels = document.getElementById('labels');
const lum=(b,p)=>0.2126*b[p*4]+0.7152*b[p*4+1]+0.0722*b[p*4+2];

/** 축 정렬 무늬 — 타일·블록이 드러나면 1보다 뚜렷이 큽니다. */
function gridness(buf){
  let ax=0,dg=0;
  for(let y=2;y<TH-2;y++) for(let x=2;x<TW-2;x++){
    const i=y*TW+x, L=lum(buf,i);
    ax+=Math.abs(L-lum(buf,i+1))+Math.abs(L-lum(buf,i+TW));
    dg+=Math.abs(L-lum(buf,i+TW+1))+Math.abs(L-lum(buf,i+TW-1));
  }
  return +(ax/Math.max(1e-6, dg/Math.SQRT2)).toFixed(3);
}
/** 화면 평균 휘도 — 한밤중이면 낮아야 합니다. */
function meanLum(buf){
  let s=0; for(let p=0;p<TW*TH;p++) s+=lum(buf,p);
  return +(s/(TW*TH)).toFixed(1);
}
/** 금색 치우침 — R/B. 1보다 크게 뜨면 주황입니다. */
function warmth(buf){
  let r=0,b=0;
  for(let p=0;p<TW*TH;p++){ r+=buf[p*4]; b+=buf[p*4+2]; }
  return +(r/Math.max(1,b)).toFixed(3);
}

function bakeFor(shot){
  const OFFSETS=[-180,-150,-120,-90,-60,-30,0,30,60,90,120,150,180];
  const DISTS=[2,5,12,30,70,160,360];
  // 관측점 값을 전 방위에 두되 거리마다 약간 흔듭니다 (앱의 링과 같은 모양).
  const jitter=(v,d,a)=>Math.max(0,Math.min(100, v + 18*Math.sin(d*0.031+a*0.017) + 12*Math.cos(d*0.017-a*0.026)));
  const pts=[{ distance:0, azimuthOffset:0, low:shot.low, mid:shot.mid, high:shot.high,
               humidity:shot.humidity, precipitation:0, visibility:shot.vis }];
  for (const off of OFFSETS) for (const d of DISTS){
    pts.push({ distance:d, azimuthOffset:off,
      low:jitter(shot.low,d,off), mid:jitter(shot.mid,d,off+40), high:jitter(shot.high,d,off+80),
      humidity:shot.humidity, precipitation:0 });
  }
  const fan = new WeatherFan(pts, 0);
  bakeCloudSlabCoverage(slab, (azDeg, distKm) => {
    const { data, confidence } = fan.sample(azDeg, distKm);
    if (!data) return { low:0, mid:0, high:0, confidence:0 };
    return { low:data.low/100, mid:data.mid/100, high:data.high/100,
             confidence: Math.max(0, Math.min(1, confidence)) };
  });
}

function shoot(shot, driftH, cityLight){
  const cam = new THREE.PerspectiveCamera(shot.fov, TW/TH, 0.1, 2000);
  cam.position.set(0,0,0); cam.up.set(0,1,0);
  const ar=shot.sunAz*Math.PI/180, er=shot.elev*Math.PI/180;
  cam.lookAt(100*Math.cos(er)*Math.sin(ar), 100*Math.sin(er), -100*Math.cos(er)*Math.cos(ar));
  cam.updateMatrixWorld(true);

  const atmosphere = makeAtmosphereParams({
    latitude: 37.48, observerElevM: 34, dayOfYear: 240,
    humidityPct: shot.humidity, visibilityM: shot.vis,
  });
  const a=shot.sunAlt*Math.PI/180, z=shot.sunAz*Math.PI/180;
  const sunDir=new THREE.Vector3(Math.cos(a)*Math.sin(z), Math.sin(a), -Math.cos(a)*Math.cos(z)).normalize();

  // 앱과 같이 하늘에도 달빛을 줍니다(§92) — 구름만 달을 알면 틈이 새까맣습니다.
  const MOON_DIR = new THREE.Vector3(0.3, 0.6, -0.7).normalize();
  const moonAlt = Math.asin(MOON_DIR.y) * 180 / Math.PI;
  const moonAz = (Math.atan2(MOON_DIR.x, -MOON_DIR.z) * 180 / Math.PI + 360) % 360;
  updateSkydome(skydome, shot.sunAlt, shot.sunAz, atmosphere, 1.0,
    { altDeg: moonAlt, azDeg: moonAz, gain: moonLight(shot.sunAlt, moonAlt, 0.9, atmosphere).gain });
  const W=(k)=>({ speedKmh: WIND[k], bearingDeg: WIND_DEG });
  updateCloudSlab(slab, {
    camera: cam, widthPx: TW, heightPx: TH,
    sunDir, sunAltDeg: shot.sunAlt, sunAzDeg: shot.sunAz,
    moonDir: MOON_DIR, moonAltDeg: moonAlt, moonIllum: 0.9,
    cityLight,
    beamFor: (altKm) => beamAtAltitude(shot.sunAlt, altKm, atmosphere),
    atmosphere,
    layerWinds: { low: W('low'), mid: W('mid'), high: W('high') },
    driftHours: driftH,
    visible: true,
  });
  // 앱처럼 광공해만큼 밤 암순응을 덜 받습니다(§95) — 매 장면 튜닝 값을 다시 넣습니다.
  if (setSceneCityLight) { setSceneCityLight(cityLight); applyTuningUniforms(skydome.material.uniforms); applyTuningUniforms(slab.material.uniforms); }
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

const 결과 = [];
SHOTS.forEach((shot, si) => {
  bakeFor(shot);
  // 도시광 세기를 훑습니다. 1.0 이 현재 값입니다.
  const cases = [
    ['도시광 1.00 (대도시)', shot.driftH, 1.0],
    ['도시광 0.60',          shot.driftH, 0.6],
    ['도시광 0.30',          shot.driftH, 0.3],
    ['도시광 0 (청정)',      shot.driftH, 0.0],
  ];
  cases.forEach(([tag, dh, city], ci) => {
    const buf = shoot(shot, dh, city);
    paint(buf, ci*TW, si*TH);
    const g = gridness(buf), m = meanLum(buf), w = warmth(buf);
    const d=document.createElement('div');
    d.className='lbl'; d.style.left=(ci*TW+16)+'px'; d.style.top=(si*TH+52)+'px';
    d.innerHTML = shot.name+'<br>'+tag+'<br>격자성 '+g+'<br>평균휘도 '+m+'<br>R/B '+w;
    labels.appendChild(d);
    결과.push({ 화면:shot.name, 조건:tag, 태양고도:shot.sunAlt, 격자성:g, 평균휘도:m, RB:w });
  });
});

window.__stats = { glError: gl.getError(), 결과 };
window.__errors = errors;
document.title = 'DONE::' + (errors.length ? 'SHADER_ERR' : 'OK') + '::' + gl.getError();
</script></body></html>`;

fs.mkdirSync(PREVIEW, { recursive: true });
fs.writeFileSync(path.join(PREVIEW, 'device-repro.html'), html);
console.log('생성 완료: device-repro.html');
