/**
 * **황혼에 층이 시간차를 두고 꺼지는가** (docs/CLOUD_VARIETY_PLAN.md 6단계).
 *
 * 사진 ④는 저층이 이미 지구 그림자에 들어갔는데 중·상층만 붉게 남은
 * 순간입니다. 이 계산은 **이미 있습니다** — `beamAtAltitude`가 고도별
 * 수평선 내려앉음 `acos(R/(R+h))` 를 태양 고도에 더해 주므로,
 *
 *   저층 1.5km → +1.25°   중층 4.5km → +2.16°   상층 10km → +3.21°
 *
 * 관측자 일몰 후에도 상층은 3.2°까지 햇빛을 받습니다. 그러니 이 단계는
 * 새로 만드는 게 아니라 **재는 것**입니다. 안 갈리면 그때 원인을 찾습니다.
 *
 * ## 어떻게 재나
 *
 * 세 층을 다 50%로 채우고 태양 고도 +2 / −1 / −2 / −3 / −4° 에서 렌더합니다.
 * 층마다 **다른 두 층을 숨기고** 재야 무엇을 재는지가 분명합니다 — 겹쳐
 * 놓으면 화면에 보이는 것이 어느 층인지 알 수 없습니다.
 *
 * 두 가지를 봅니다:
 *   - **밝기**: 직달광이 끊기면 떨어집니다.
 *   - **붉은기 R/B**: 끊기기 직전이 가장 붉습니다 (긴 대기 경로).
 *
 * 준비: node tools/shader-preview/stage-esm.js
 * 사용: node tools/shader-preview/build-twilight-layers-preview.js
 *       node tools/shader-preview/verify-twilight-layers.js
 */
const fs = require('fs');
const path = require('path');
const PREVIEW =
  '/tmp/claude-0/-home-user-solar-path/eaf4c0af-06ca-5c06-a0d7-588dbfb07373/scratchpad/preview';

const SUN_ALTS = [2, -1, -2, -3, -4, -6, -9];
const TW = 240, TH = 260, VIEW_ELEV = 14, FOV_DEG = 60;
const SUN_AZ = 270;

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
 body{margin:0;background:#12171c;font-family:sans-serif;color:#dde}
 #wrap{position:relative;width:${TW * SUN_ALTS.length + 24}px;padding:12px}
 .lbl{position:absolute;color:#fff;font-size:11px;font-family:monospace;
   text-shadow:0 1px 3px #000;pointer-events:none;line-height:1.35}
 h3{font-size:13px;margin:8px 0}
</style></head><body>
<div id="wrap"><h3>황혼의 층 분리 — 저·중·상층 모두 50%, 태양 고도만 바뀜 (합성 화면)</h3>
<canvas id="c"></canvas><div id="labels"></div></div>
<script type="module">
import * as THREE from './app/vendor/three.module.js';
import { createCloudDeck, updateCloudDeck } from './app/components/SkyScene3D/CloudDeck.js';
import { PRESET_OPTICS, blendedOpticsFromWeather } from './app/utils/cloudPresets.js';
import { WeatherFan, buildSkyColumns, solveColumnOptics, solveDirectionalShade,
         LAYER_ALTITUDE_KM, PLACEHOLDER_WIND_SPEED_KMH, PLACEHOLDER_WIND_BEARING_DEG }
  from './app/utils/skyColumn.js';
import { makeAtmosphereParams, beamAtAltitude, skyRadiance, applyCloudDimming,
         angularSeparationDeg } from './app/utils/atmosphere.js';

const errors = [];
const oe = console.error;
console.error = (...a) => { errors.push(a.join(' ')); oe(...a); };

const SUN_ALTS = ${JSON.stringify(SUN_ALTS)};
const TW=${TW}, TH=${TH}, VIEW_ELEV=${VIEW_ELEV}, FOV_DEG=${FOV_DEG}, SUN_AZ=${SUN_AZ};

const canvas = document.getElementById('c');
canvas.width = TW*SUN_ALTS.length; canvas.height = TH;
const renderer = new THREE.WebGLRenderer({ canvas, antialias:false, alpha:false });
renderer.setPixelRatio(1);
renderer.setSize(TW*SUN_ALTS.length, TH, false);
const deck = createCloudDeck({ maxAnisotropy: renderer.capabilities.getMaxAnisotropy() });
const scene = new THREE.Scene();
scene.add(deck.group);

const RING_AZ = [0,30,60,90,120,150,180,-150,-120,-90,-60,-30];
const RING_D  = [10,30,70,130,200,280,380];
function ring() {
  const one = (d, az) => ({ distance:d, azimuthOffset:az, low:50, mid:50, high:50,
                            humidity:60, precipitation:0 });
  const out = [one(0,0)];
  for (const az of RING_AZ) for (const d of RING_D) out.push(one(d,az));
  return out;
}
const samples = buildSkyColumns({
  fan: new WeatherFan(ring(), SUN_AZ), driftMinutes: 0,
  windSpeedKmh: PLACEHOLDER_WIND_SPEED_KMH, windBearingDeg: PLACEHOLDER_WIND_BEARING_DEG,
});

const atmosphere = makeAtmosphereParams({
  latitude: 37.5, observerElevM: 30, dayOfYear: 200, betaMie: 0.08,
});
const wx = { precipitation:0, humidity:60, lowPct:50, highPct:50 };
const tauFor = (layer) => blendedOpticsFromWeather(layer, 0.5, wx, 0.5).tau;

const cam = new THREE.PerspectiveCamera(FOV_DEG, TW/TH, 0.1, 2000);
cam.position.set(0,0,0); cam.up.set(0,1,0);
const ar = SUN_AZ*Math.PI/180, er = VIEW_ELEV*Math.PI/180;
cam.lookAt(100*Math.cos(er)*Math.sin(ar), 100*Math.sin(er), -100*Math.cos(er)*Math.cos(ar));
cam.updateMatrixWorld(true);
const gl = renderer.getContext();
const labels = document.getElementById('labels');

function apply(sunAltDeg) {
  const optics = solveColumnOptics(samples, SUN_AZ, sunAltDeg, tauFor);
  const shade = solveDirectionalShade(samples, SUN_AZ, sunAltDeg, tauFor);
  const sA = sunAltDeg*Math.PI/180, sZ = SUN_AZ*Math.PI/180;
  const sunDir = new THREE.Vector3(
    Math.cos(sA)*Math.sin(sZ), Math.sin(sA), -Math.cos(sA)*Math.cos(sZ)).normalize();
  updateCloudDeck(deck, {
    samples,
    // **실제 대기 함수를 그대로 씁니다.** 여기서 상수를 넣으면 재려는 것
    // (고도별 수평선 내려앉음)이 사라집니다.
    beamFor: (altKm) => beamAtAltitude(sunAltDeg, altKm, atmosphere),
    beamShade: shade,
    ambientFor: (layer, azDeg, elevDeg) => {
      const f = optics.diffuseFactor[layer];
      const gU = angularSeparationDeg(azDeg, 70, SUN_AZ, sunAltDeg);
      const gD = angularSeparationDeg(azDeg, 15, SUN_AZ, sunAltDeg);
      return {
        up: applyCloudDimming(skyRadiance(70, gU, sunAltDeg, atmosphere), f),
        down: applyCloudDimming(skyRadiance(15, gD, sunAltDeg, atmosphere), f),
      };
    },
    sunDir, sunAltDeg,
    tauFor, shadowFor: (l) => blendedOpticsFromWeather(l, 0.5, wx, 0.5).shadowContrast,
    cellFor: (l) => PRESET_OPTICS[l==='high'?'Cirrus':l==='mid'?'Altocumulus':'Cumulus'],
    genusFor: (layer, at) => blendedOpticsFromWeather(layer, at.cover,
      { precipitation:at.precipMmH, humidity:at.humidityPct, lowPct:0, highPct:at.highPct }, 0.5),
    pixelAngleRad: (FOV_DEG*Math.PI/180)/TH,
    windBearingDeg: PLACEHOLDER_WIND_BEARING_DEG,
    betaMie: atmosphere.betaMie, angstrom: atmosphere.angstrom,
    elevScale: atmosphere.elevScale, timeSeconds: 0, visible: true,
  });
}

function measure(x, only) {
  for (const l of deck.layers) l.mesh.visible = (only === null || l.layer === only);
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
  let n=0, sR=0, sG=0, sB=0;
  for (let p=0; p<TW*TH; p++) {
    const a = 1 - (kw[p*4+1]-kb[p*4+1])/255;
    if (a < 0.5) continue;
    sR += kb[p*4]/a; sG += kb[p*4+1]/a; sB += kb[p*4+2]/a; n++;
  }
  if (!n) return { 밝기: 0, 붉은기: 0, 픽셀: 0 };
  const R=sR/n, G=sG/n, B=sB/n;
  return { 밝기: +(0.2126*R+0.7152*G+0.0722*B).toFixed(1),
           붉은기: +(B > 1 ? R/B : 0).toFixed(3),
           // 초록 치우침 — 1보다 크면 R·B 평균보다 G가 높습니다. 황혼 하늘은
           // 오존 Chappuis 흡수 때문에 파랑/보라여야 하고, 초록으로 뜨면
           // 그 흡수가 빠졌다는 신호입니다.
           초록: +((R+B) > 2 ? (2*G/(R+B)) : 0).toFixed(3),
           픽셀: n };
}

const 결과 = [];
SUN_ALTS.forEach((alt, i) => {
  const x = i*TW;
  apply(alt);
  const row = { 태양고도: alt };
  for (const L of ['low','mid','high']) row[L] = measure(x, L);
  // 합성 화면 — 사람이 보는 것.
  for (const l of deck.layers) l.mesh.visible = true;
  renderer.setClearColor(0x1a2f4a,1);
  renderer.setViewport(x,0,TW,TH);
  renderer.setScissor(x,0,TW,TH);
  renderer.setScissorTest(true);
  renderer.clear();
  renderer.render(scene, cam);

  const d = document.createElement('div');
  d.className='lbl';
  d.style.left=(x+10+12)+'px'; d.style.top='34px';
  d.innerHTML = '태양 ' + alt + '°' +
    '<br>상층 ' + row.high.밝기 + ' (R/B ' + row.high.붉은기 + ')' +
    '<br>중층 ' + row.mid.밝기 + ' (R/B ' + row.mid.붉은기 + ')' +
    '<br>저층 ' + row.low.밝기 + ' (R/B ' + row.low.붉은기 + ')';
  labels.appendChild(d);
  결과.push(row);
});

const glErr = gl.getError();
window.__stats = { glError: glErr, 결과,
  층고도: { low: LAYER_ALTITUDE_KM.low, mid: LAYER_ALTITUDE_KM.mid, high: LAYER_ALTITUDE_KM.high } };
window.__errors = errors;
document.title = 'DONE::' + (errors.length?'SHADER_ERR':'OK') + '::' + glErr;
</script></body></html>`;

fs.mkdirSync(PREVIEW, { recursive: true });
fs.writeFileSync(path.join(PREVIEW, 'twilight-layers.html'), html);
console.log('생성 완료: twilight-layers.html');
