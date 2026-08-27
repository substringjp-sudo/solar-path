/**
 * **구름이 구름에 드리우는 그림자** (docs/CLOUD_VARIETY_PLAN.md 4단계).
 *
 * ## 무엇이 문제였나
 *
 * `solveColumnOptics`는 **관측점 수직 기둥 하나**를 풀고 그 직달광 배율을
 * 하늘 전체에 곱했습니다. 그래서 서쪽에 두꺼운 상층 띠가 있으면 **동쪽
 * 저층까지 같이 어두워졌습니다.** 옆 구름은 그늘인데 이 구름만 빛을 받는
 * 대비 — 노을 하늘의 인상을 거의 다 만드는 그것 — 이 원리적으로 나올 수
 * 없었습니다.
 *
 * ## 어떻게 재나
 *
 * **상층만** 서쪽 절반을 90%로 덮고 동쪽은 0%. **저층은 어디나 45%로 균일**.
 * 저층 운량이 같으므로 화면 차이는 오직 "위에 뭐가 있느냐"에서 옵니다.
 *
 * 태양은 방위 0°(정면)·고도 20°. 상층 10km와 저층 1.5km 사이의 지상
 * displacement는 23km쯤이라, 저층 구름의 그늘 여부는 그 구름에서 **북쪽으로
 * 23km 떨어진 지점의 상층 운량**이 정합니다.
 *
 * **상층 덱은 숨기고 잽니다.** 안 그러면 화면에 보이는 것이 저층인지 상층인지
 * 구분되지 않습니다 — 재려는 것은 저층에 드리운 그늘이지 상층 자체가 아닙니다.
 *
 *   왼쪽 패널: 관측점 기둥 배율 하나 (4단계 이전) → 양쪽 다 같이 어두움
 *   오른쪽   : 방향별 배율 → 서쪽만 어둡고 동쪽은 밝음
 *
 * 준비: node tools/shader-preview/stage-esm.js
 * 사용: node tools/shader-preview/build-cloud-shadow-preview.js
 *       node tools/shader-preview/verify-cloud-shadow.js
 */
const fs = require('fs');
const path = require('path');
const { PREVIEW } = require('./paths');

const VIEW_AZ = 0, VIEW_ELEV = 18, FOV_DEG = 66;
const TW = 520, TH = 420;
const SUN_ALT = 25, SUN_AZ = 0;
const MID_PCT = 45, HIGH_PCT = 90;

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
 body{margin:0;background:#12171c;font-family:sans-serif;color:#dde}
 #wrap{position:relative;width:${TW * 2 + 24}px;padding:12px}
 .lbl{position:absolute;color:#fff;font-size:12px;font-family:monospace;
   text-shadow:0 1px 3px #000;pointer-events:none;line-height:1.4}
 h3{font-size:13px;margin:8px 0}
</style></head><body>
<div id="wrap"><h3>중층 어디나 ${MID_PCT}% · 상층은 서쪽만 ${HIGH_PCT}% (상층 덱은 숨김) — 왼쪽: 관측점 기둥 배율 하나 &nbsp;|&nbsp; 오른쪽: 방향별 배율(4단계)</h3>
<canvas id="c"></canvas><div id="labels"></div></div>
<script type="module">
import * as THREE from './app/vendor/three.module.js';
import { createCloudDeck, updateCloudDeck } from './app/components/SkyScene3D/CloudDeck.js';
import { PRESET_OPTICS, blendedOpticsFromWeather } from './app/utils/cloudPresets.js';
import { WeatherFan, buildSkyColumns, solveColumnOptics, solveDirectionalShade,
         PLACEHOLDER_WIND_SPEED_KMH, PLACEHOLDER_WIND_BEARING_DEG }
  from './app/utils/skyColumn.js';

const errors = [];
const oe = console.error;
console.error = (...a) => { errors.push(a.join(' ')); oe(...a); };

const VIEW_AZ=${VIEW_AZ}, VIEW_ELEV=${VIEW_ELEV}, FOV_DEG=${FOV_DEG};
const TW=${TW}, TH=${TH}, SUN_ALT=${SUN_ALT}, SUN_AZ=${SUN_AZ};
const MID_PCT=${MID_PCT}, HIGH_PCT=${HIGH_PCT};

const canvas = document.getElementById('c');
canvas.width = TW*2; canvas.height = TH;
const renderer = new THREE.WebGLRenderer({ canvas, antialias:false, alpha:false });
renderer.setPixelRatio(1);
renderer.setSize(TW*2, TH, false);
const deck = createCloudDeck({ maxAnisotropy: renderer.capabilities.getMaxAnisotropy() });
const scene = new THREE.Scene();
scene.add(deck.group);

const RING_AZ = [0,30,60,90,120,150,180,-150,-120,-90,-60,-30];
const RING_D  = [10,30,70,130,200,280,380];
// 상층 경계를 **지상 좌표 x = 0** 에 정확히 놓습니다.
//
// 처음엔 방위 부호로 갈랐는데(a>0 && a<180 이면 동쪽), 그러면 링의 0°·180°
// 레이가 서쪽 값을 갖게 되어 보간된 경계가 15°쯤 돌아갑니다. 태양이 방위 0°
// 이면 그늘은 y축 방향으로만 밀리므로 경계는 x=0에 그대로 있어야 하는데,
// 경계가 돌아가 있으면 화면 위쪽(천정 쪽)이 통째로 그늘로 들어갑니다 —
// 저층은 고도 1.5km라 고도각 4° 위에서는 지상거리가 displacement(23km)보다
// 작아, 자기 위치보다 **밀린 위치**가 그늘 여부를 정하기 때문입니다.
const EAST = 0, WEST = HIGH_PCT, EDGE = HIGH_PCT / 2;
function ring() {
  const out = [{ distance:0, azimuthOffset:0, low:0, mid:MID_PCT, high:EDGE,
                 precipitation:0, humidity:60 }];
  for (const az of RING_AZ) for (const d of RING_D) {
    const a = (az+360)%360;
    const high = (a === 0 || a === 180) ? EDGE : (a < 180 ? EAST : WEST);
    out.push({ distance:d, azimuthOffset:az, low:0, mid:MID_PCT,
               high, precipitation:0, humidity:60 });
  }
  return out;
}
const samples = buildSkyColumns({
  fan: new WeatherFan(ring(), 0), driftMinutes: 0,
  windSpeedKmh: PLACEHOLDER_WIND_SPEED_KMH, windBearingDeg: PLACEHOLDER_WIND_BEARING_DEG,
});

const wx = { precipitation:0, humidity:60, lowPct:0, highPct:HIGH_PCT };
const tauFor = (layer) => blendedOpticsFromWeather(
  layer, layer==='high' ? HIGH_PCT/100 : MID_PCT/100, wx, 0.5).tau;

const optics = solveColumnOptics(samples, SUN_AZ, SUN_ALT, tauFor);
const shade  = solveDirectionalShade(samples, SUN_AZ, SUN_ALT, tauFor);

const clearBeam = { r: 1.55, g: 1.20, b: 0.86 };
const sA = SUN_ALT*Math.PI/180, sZ = SUN_AZ*Math.PI/180;
const sunDir = new THREE.Vector3(
  Math.cos(sA)*Math.sin(sZ), Math.sin(sA), -Math.cos(sA)*Math.cos(sZ)).normalize();
const cam = new THREE.PerspectiveCamera(FOV_DEG, TW/TH, 0.1, 2000);
cam.position.set(0,0,0); cam.up.set(0,1,0);
const ar = VIEW_AZ*Math.PI/180, er = VIEW_ELEV*Math.PI/180;
cam.lookAt(100*Math.cos(er)*Math.sin(ar), 100*Math.sin(er), -100*Math.cos(er)*Math.cos(ar));
cam.updateMatrixWorld(true);
const gl = renderer.getContext();
const labels = document.getElementById('labels');

function shoot(label, x, useShade) {
  updateCloudDeck(deck, {
    samples,
    // 4단계 이전 경로는 관측점 기둥 배율을 **여기서** 곱했습니다.
    beamFor: (altKm) => {
      const layer = altKm > 7 ? 'high' : altKm > 3 ? 'mid' : 'low';
      const f = useShade ? 1 : optics.beamFactor[layer];
      return { r: clearBeam.r*f, g: clearBeam.g*f, b: clearBeam.b*f };
    },
    beamShade: useShade ? shade : undefined,
    ambientFor: () => ({ up:{r:0.42,g:0.52,b:0.78}, down:{r:0.48,g:0.46,b:0.52} }),
    sunDir, sunAltDeg: SUN_ALT,
    tauFor, shadowFor: (l) => PRESET_OPTICS[l==='high'?'Cirrostratus':'Altocumulus'].shadowContrast,
    cellFor: (l) => PRESET_OPTICS[l==='high'?'Cirrostratus':'Altocumulus'],
    genusFor: (layer, at) => blendedOpticsFromWeather(layer, at.cover,
      { precipitation:at.precipMmH, humidity:at.humidityPct, lowPct:0, highPct:at.highPct }, 0.5),
    pixelAngleRad: (FOV_DEG*Math.PI/180)/TH,
    windBearingDeg: PLACEHOLDER_WIND_BEARING_DEG,
    betaMie: 0.08, angstrom: 1.3, elevScale: 1.0, timeSeconds: 0, visible: true,
  });
  // 재려는 것은 **중층에 드리운 그늘**입니다. 상층이 화면에 있으면
  // 무엇을 재는지 알 수 없습니다.
  //
  // 왜 저층이 아니라 중층인가: 저층은 고도 1.5km라 보이는 지상 범위가
  // 25km쯤인데, 상층(10km)과 저층 사이의 그늘 displacement가 태양 25°에서
  // 이미 20km입니다. 그러면 화면 왼쪽 끝과 오른쪽 끝이 **거의 같은 지점**의
  // 상층을 보게 되어 좌우가 갈리지 않습니다 (실측: 동−서 3.5). 중층은
  // 4.5km라 보이는 범위가 70km이고 displacement는 10km라, 화면 안에서
  // 그늘 경계가 지납니다.
  for (const l of deck.layers) if (l.layer !== 'mid') l.mesh.visible = false;

  const grab = (bg) => {
    renderer.setClearColor(bg,1);
    renderer.setViewport(x,0,TW,TH);
    renderer.setScissor(x,0,TW,TH);
    renderer.setScissorTest(true);
    renderer.clear();
    renderer.render(scene, cam);
    const b = new Uint8Array(4*TW*TH);
    gl.readPixels(x,0,TW,TH,gl.RGBA,gl.UNSIGNED_BYTE,b);
    return b;
  };
  const kb = grab(0x000000), kw = grab(0xffffff);

  const quarter = Math.floor(TW/4);
  const band = (x0,x1) => {
    let n=0, sumL=0, sumA=0, nA=0;
    for (let py=0; py<TH; py++) for (let px=x0; px<x1; px++) {
      const p = py*TW+px;
      const a = Math.max(0, Math.min(1, 1 - (kw[p*4+1]-kb[p*4+1])/255));
      sumA += a; nA++;
      if (a < 0.5) continue;
      sumL += 0.2126*(kb[p*4]/a) + 0.7152*(kb[p*4+1]/a) + 0.0722*(kb[p*4+2]/a);
      n++;
    }
    return { 밝기: +(n ? sumL/n : 0).toFixed(1), 운량: +(sumA/nA).toFixed(4) };
  };
  const 서쪽 = band(0, quarter);
  const 동쪽 = band(TW-quarter, TW);

  renderer.setClearColor(0x1d4f77,1);
  renderer.setViewport(x,0,TW,TH);
  renderer.setScissor(x,0,TW,TH);
  renderer.setScissorTest(true);
  renderer.clear();
  renderer.render(scene, cam);

  const d = document.createElement('div');
  d.className='lbl';
  d.style.left=(x+10+12)+'px'; d.style.top='34px';
  d.innerHTML = label +
    '<br>서(위에 상층 있음) 밝기 ' + 서쪽.밝기 + '  운량 ' + (서쪽.운량*100).toFixed(0) + '%' +
    '<br>동(위가 비어 있음) 밝기 ' + 동쪽.밝기 + '  운량 ' + (동쪽.운량*100).toFixed(0) + '%' +
    '<br>동 − 서 ' + (동쪽.밝기-서쪽.밝기).toFixed(1);
  labels.appendChild(d);
  return { 서쪽, 동쪽 };
}

const 기둥하나 = shoot('관측점 기둥 배율 하나', 0, false);
const 방향별 = shoot('방향별 배율 (4단계)', TW, true);

// 배율 자체의 분포 — 화면 차이의 원인.
let sMin=1e9, sMax=-1e9, sSum=0, sN=0;
for (let i=0;i<samples.length;i++) {
  if (samples[i].layer !== 'mid') continue;
  const v = shade[i];
  if (v<sMin) sMin=v; if (v>sMax) sMax=v; sSum+=v; sN++;
}
const 배율 = { 최소:+sMin.toFixed(4), 최대:+sMax.toFixed(4), 평균:+(sSum/sN).toFixed(4),
              전역:+optics.beamFactor.mid.toFixed(4) };

const glErr = gl.getError();
window.__stats = { glError: glErr, 기둥하나, 방향별, 배율 };
window.__errors = errors;
document.title = 'DONE::' + (errors.length?'SHADER_ERR':'OK') + '::' + glErr;
</script></body></html>`;

fs.mkdirSync(PREVIEW, { recursive: true });
fs.writeFileSync(path.join(PREVIEW, 'cloud-shadow.html'), html);
console.log('생성 완료: cloud-shadow.html');
