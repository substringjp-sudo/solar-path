/**
 * **QR 리포트를 그대로 되살려 그립니다.**
 *
 * 촬영 결과 화면의 QR 은 "촬영 당시의 관측 기상과 3D 물리 파라미터를 그대로
 * 복원할 수 있습니다" 라고 약속합니다. 그 약속을 하네스에서 실제로 지키게
 * 만든 것이 이 판입니다 — 실기에서 3D 썸네일이 검게 나와 못 본 화면을,
 * 같은 입력으로 여기서 다시 그려 눈으로 견줍니다.
 *
 * ⚠ **같은 그림이라고 주장하지 않습니다.** 시선 방위·고도와 화각은 QR 에
 * 없으므로(센서값이라 저장 안 됨) 몇 가지로 나눠 찍습니다. 같은 것은
 * **하늘의 상태**(태양 위치·층별 운량·습도·시정·바람)이지 구도가 아닙니다.
 *
 * 값은 CLI 로 넘깁니다:
 *   node tools/shader-preview/build-qr-replay.js '<QR JSON>'
 * 안 넘기면 아래 기본값(2026-09-10 07:29 KST 도곡동 캡처)을 씁니다.
 */
const fs = require('fs');
const path = require('path');
const { PREVIEW } = require('./paths');

const DEFAULT = {
  v: 1, t: '2026-09-09T22:29:26.711Z', lat: 37.4863, lon: 127.0443, elevM: 0,
  sunAlt: 15.06, sunAz: 95.04,
  obs: { low: 0, mid: 33, high: 53, humidity: 80, precip: 0, vis: 18980, dni: 43, water: 16.9 },
  wind: { kmh: 16.9, deg: 76.5, synthetic: false },
};
const Q = process.argv[2] ? JSON.parse(process.argv[2]) : DEFAULT;

const TW = 340, TH = 450;
const FOV_DEG = 60;
// 시선 — QR 에 없으므로 넷으로 나눠 찍습니다. 사진이 길 건너 하늘을 올려다본
// 구도라 고도 30~55° 언저리로 잡았습니다.
const VIEWS = [
  { key: '해 쪽 (동) · 고도 35°',   az: Q.sunAz,        elev: 35 },
  { key: '해 쪽 (동) · 고도 55°',   az: Q.sunAz,        elev: 55 },
  { key: '해 등지고 (서) · 고도 35°', az: (Q.sunAz + 180) % 360, elev: 35 },
  { key: '천정 쪽 · 고도 75°',      az: (Q.sunAz + 90) % 360,  elev: 75 },
];

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
 body{margin:0;background:#0b0f15;font-family:sans-serif;color:#dde}
 #wrap{padding:12px}
 h3{font-size:13px;margin:6px 0}
 canvas{border:1px solid #345;margin:2px}
 .cap{font:10px monospace;color:#9ab}
</style></head><body>
<div id="wrap"><h3>QR 되살리기 — 촬영 당시 하늘 상태로 다시 그림</h3>
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

const Q = ${JSON.stringify(Q)};
const TW=${TW}, TH=${TH}, FOV_DEG=${FOV_DEG};
const VIEWS = ${JSON.stringify(VIEWS)};

const glCanvas = document.createElement('canvas');
glCanvas.width = TW; glCanvas.height = TH;
const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias:false, alpha:false });
renderer.setPixelRatio(1); renderer.setSize(TW, TH, false);
const gl = renderer.getContext();

const day = (() => { const d = new Date(Q.t); const s = Date.UTC(d.getUTCFullYear(),0,0);
  return Math.floor((d.getTime()-s)/86400000); })();

const atmosphere = makeAtmosphereParams({
  latitude: Q.lat, observerElevM: Q.elevM, dayOfYear: day,
  humidityPct: Q.obs.humidity, visibilityM: Q.obs.vis,
});
const scene = new THREE.Scene();
const skydome = createSkydome();
scene.add(skydome.mesh);

const slab = createCloudSlab();
slab.mesh.renderOrder = 10;
scene.add(slab.mesh);

// ⚠ 앱의 진짜 팬 구성(weather.ts: 방위 ±20°, 거리 10~380km)을 씁니다.
//   관측점 한 곳의 값만 아니까 팬 전체에 같은 값을 깝니다 — QR 이 담은 것이
//   관측점 하나이므로 그 이상은 지어내지 않습니다.
{
  const OFFSETS=[-20,-10,0,10,20], DISTS=[10,30,70,130,200,280,380];
  const pt = (d, off) => ({ distance:d, azimuthOffset:off,
    low:Q.obs.low, mid:Q.obs.mid, high:Q.obs.high,
    humidity:Q.obs.humidity, precipitation:Q.obs.precip, visibility:Q.obs.vis });
  const pts=[pt(0,0)];
  for (const off of OFFSETS) for (const d of DISTS) pts.push(pt(d, off));
  const fan = new WeatherFan(pts, Q.sunAz);
  bakeCloudSlabCoverage(slab, (azDeg, distKm) => {
    const { data, confidence } = fan.sample(azDeg, distKm);
    if (!data) return { low:0, mid:0, high:0, confidence:0 };
    return { low:data.low/100, mid:data.mid/100, high:data.high/100,
             confidence: Math.max(0, Math.min(1, confidence)) };
  });
}

const lum=(b,p)=>0.2126*b[p*4]+0.7152*b[p*4+1]+0.0722*b[p*4+2];

function shoot(az, elev){
  const cam = new THREE.PerspectiveCamera(FOV_DEG, TW/TH, 0.1, 2000);
  cam.position.set(0,0,0);
  if (elev > 75) cam.up.set(0,0,-1); else cam.up.set(0,1,0);
  const ar=az*Math.PI/180, er=elev*Math.PI/180;
  cam.lookAt(100*Math.cos(er)*Math.sin(ar), 100*Math.sin(er), -100*Math.cos(er)*Math.cos(ar));
  cam.updateMatrixWorld(true);

  const a=Q.sunAlt*Math.PI/180, z=Q.sunAz*Math.PI/180;
  const sunDir=new THREE.Vector3(Math.cos(a)*Math.sin(z), Math.sin(a), -Math.cos(a)*Math.cos(z)).normalize();
  updateSkydome(skydome, Q.sunAlt, Q.sunAz, atmosphere);
  // 층별 바람 — QR 은 저층 바람 하나만 담습니다. 나머지는 앱과 같은 비율.
  const w = { speedKmh: Q.wind.kmh, bearingDeg: Q.wind.deg };
  updateCloudSlab(slab, {
    camera: cam, widthPx: TW, heightPx: TH,
    sunDir, sunAltDeg: Q.sunAlt, sunAzDeg: Q.sunAz,
    beamFor: (altKm) => beamAtAltitude(Q.sunAlt, altKm, atmosphere),
    atmosphere,
    layerWinds: { low: w,
                  mid: { speedKmh: w.speedKmh*1.7, bearingDeg: w.bearingDeg },
                  high:{ speedKmh: w.speedKmh*3.4, bearingDeg: w.bearingDeg } },
    driftHours: 0, visible: true,
  });
  renderer.setRenderTarget(null);
  renderer.setClearColor(0x000000, 1);
  renderer.render(scene, cam);
  const buf=new Uint8Array(4*TW*TH);
  gl.readPixels(0,0,TW,TH,gl.RGBA,gl.UNSIGNED_BYTE,buf);
  return buf;
}

function toPng(buf){
  const c=document.createElement('canvas'); c.width=TW; c.height=TH;
  const cx=c.getContext('2d');
  const img=cx.createImageData(TW,TH);
  for(let y=0;y<TH;y++){ const s=(TH-1-y)*TW*4, d=y*TW*4;
    for(let i=0;i<TW*4;i++) img.data[d+i]=buf[s+i]; }
  cx.putImageData(img,0,0);
  c.style.width='170px'; c.style.height='225px';
  document.getElementById('shots').appendChild(c);
  return c.toDataURL('image/png');
}

const 결과={}, 그림={};
for (const v of VIEWS){
  const buf = shoot(v.az, v.elev);
  let s=0; for(let i=0;i<TW*TH;i++) s+=lum(buf,i);
  결과[v.key] = { 평균밝기:+(s/(TW*TH)).toFixed(1) };
  그림[v.key] = toPng(buf);
}

document.getElementById('out').innerHTML='<p>'+JSON.stringify(결과)+'</p>';
window.__stats={ glError: gl.getError(), 결과, 입력: Q };
window.__png=그림;
window.__errors=errors;
document.title='DONE::'+(errors.length?'ERR':'OK')+'::'+gl.getError();
</script></body></html>`;

fs.writeFileSync(path.join(PREVIEW, 'qr-replay.html'), html);
console.log('생성 완료: qr-replay.html');
