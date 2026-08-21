/**
 * 덱의 **방향별 환경광**을 실제로 렌더해서 확인합니다
 * (docs/CLOUD_TEXTURE_PLAN.md 3단계).
 *
 * ## 무엇을 확인하나
 *
 * 3단계 이전에는 `uAmbientUp`/`uAmbientDown`가 층당 uniform 하나였습니다.
 * 360° 덱 전체가 같은 색이라, 일몰에 태양 쪽 하늘은 타오르고 반대쪽은
 * 잿빛이어야 하는데 전부 같은 색이었습니다.
 *
 * 지금은 정점 속성(`aAmbientUp`/`aAmbientDown`)이 방향마다 다른 값을 담고,
 * `updateCloudDeck`이 192방향 그리드에서 실제 하늘 복사휘도(`skyRadiance` +
 * `angularSeparationDeg`)를 계산해 채웁니다. 여기서는 그 값이 **정점 속성을
 * 거쳐 실제로 화면 픽셀에 반영되는지**를 봅니다 — JS 콜백만 부르는 것으로는
 * VERT 배선(aAmbientUp → vAmbientUp)이 실제로 맞물렸는지 확인할 수 없습니다.
 *
 * ## 어떻게 재나
 *
 * 태양 고도를 낮게(6°) 두고 mid층을 거의 완전히 덮은(cover 0.97) 채,
 * 카메라를 태양 방위 쪽과 그 반대쪽으로 돌려 각각 렌더합니다. 덱이 화면을
 * 거의 채우므로 화면 평균 색이 곧 그 방향 환경광입니다.
 *
 * 합격 기준: 태양 쪽이 반대쪽보다 **뚜렷이 붉고(R/B 비 크고)**, 반대쪽이
 * 더 파랄 것.
 *
 * 준비: node tools/shader-preview/stage-esm.js
 * 사용: node tools/shader-preview/build-deck-ambient-preview.js
 *       node tools/shader-preview/shoot.js deck-ambient.html deck-ambient.png
 *       node tools/shader-preview/verify-deck-ambient.js
 */
const fs = require('fs');
const path = require('path');
const PREVIEW =
  '/tmp/claude-0/-home-user-solar-path/eaf4c0af-06ca-5c06-a0d7-588dbfb07373/scratchpad/preview';

const SUN_ALT = 6;
const SUN_AZ = 270;
const COVER = 0.97;
const VIEW_ELEV = 20;
const FOV_DEG = 60;
const TW = 480, TH = 480;

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
 body{margin:0;background:#12171c;font-family:sans-serif;color:#dde}
 #wrap{position:relative;width:${TW * 2 + 12}px;padding:12px}
 .lbl{position:absolute;color:#fff;font-size:12px;font-family:monospace;
   text-shadow:0 1px 3px #000;pointer-events:none}
 h3{font-size:13px;margin:8px 0}
</style></head><body>
<div id="wrap"><h3>덱 방향별 환경광 — 태양 쪽 vs 반대쪽 (태양 고도 ${SUN_ALT}°, mid 운량 ${COVER})</h3>
<canvas id="c"></canvas><div id="labels"></div></div>
<script type="module">
import * as THREE from './app/vendor/three.module.js';
import { createCloudDeck, updateCloudDeck } from './app/components/SkyScene3D/CloudDeck.js';
import { makeAtmosphereParams, skyRadiance, beamAtAltitude, applyCloudDimming, angularSeparationDeg }
  from './app/utils/atmosphere.js';

const errors = [];
const oe = console.error;
console.error = (...a) => { errors.push(a.join(' ')); oe(...a); };

const SUN_ALT = ${SUN_ALT}, SUN_AZ = ${SUN_AZ}, COVER = ${COVER};
const VIEW_ELEV = ${VIEW_ELEV}, FOV_DEG = ${FOV_DEG};
const TW = ${TW}, TH = ${TH};

const canvas = document.getElementById('c');
canvas.width = TW * 2; canvas.height = TH;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false });
renderer.setPixelRatio(1);
renderer.setSize(TW * 2, TH, false);

const maxAniso = renderer.capabilities.getMaxAnisotropy();
const deck = createCloudDeck({ maxAnisotropy: maxAniso });
const scene = new THREE.Scene();
scene.add(deck.group);

const atmosphere = makeAtmosphereParams({
  visibilityM: 30000, humidityPct: 55, latitude: 37.5, dayOfYear: 214 });

// 등입체각 격자 (skyColumn과 같은 형태) — mid층만, 전 방위 균일한 고운량.
const ELEVS = [];
for (let i = 0; i < 8; i++) {
  const t = (i + 0.5) / 8;
  ELEVS.push(Math.asin(t) * 180 / Math.PI);
}
const samples = [];
for (const layer of ['low', 'mid', 'high']) {
  for (let a = 0; a < 24; a++) {
    for (const e of ELEVS) {
      samples.push({ layer, azimuthDeg: (a*360)/24, elevationDeg: e,
        distanceKm: 10, confidence: 1, cover: layer === 'mid' ? COVER : 0 });
    }
  }
}

const beam = beamAtAltitude(SUN_ALT, 4, atmosphere);
const sAlt = SUN_ALT*Math.PI/180, sAz = SUN_AZ*Math.PI/180;
const sunDir = new THREE.Vector3(Math.cos(sAlt)*Math.sin(sAz), Math.sin(sAlt), -Math.cos(sAlt)*Math.cos(sAz));

// **실제 앱과 같은 ambientFor** — SkyScene3D.tsx의 식을 그대로 씁니다.
updateCloudDeck(deck, {
  samples,
  beamFor: () => beam,
  ambientFor: (layer, azDeg) => {
    const gammaUp = angularSeparationDeg(azDeg, 70, SUN_AZ, SUN_ALT);
    const gammaDown = angularSeparationDeg(azDeg, 15, SUN_AZ, SUN_ALT);
    return {
      up: skyRadiance(70, gammaUp, SUN_ALT, atmosphere),
      down: skyRadiance(15, gammaDown, SUN_ALT, atmosphere),
    };
  },
  sunDir, sunAltDeg: SUN_ALT,
  tauFor: () => 16,
  shadowFor: () => 0.4,
  cellFor: () => ({ cellSizeKm: 0.5, cellStrength: 0.9, cellVariant: 'billow', cellAspect: 1 }),
  pixelAngleRad: (FOV_DEG * Math.PI / 180) / TH,
  windBearingDeg: 260,   // 등방이라 결과에 영향 없음
  betaMie: atmosphere.betaMie, angstrom: atmosphere.angstrom, elevScale: atmosphere.elevScale,
  timeSeconds: 0, visible: true,
});

const cam = new THREE.PerspectiveCamera(FOV_DEG, TW / TH, 0.1, 2000);
cam.position.set(0, 0, 0);
const gl = renderer.getContext();
const labels = document.getElementById('labels');

function shoot(headingDeg, x) {
  const hr = headingDeg * Math.PI / 180, er = VIEW_ELEV * Math.PI / 180;
  cam.up.set(0, 1, 0);
  cam.lookAt(Math.sin(hr) * Math.cos(er), Math.sin(er), -Math.cos(hr) * Math.cos(er));
  renderer.setViewport(x, 0, TW, TH);
  renderer.setScissor(x, 0, TW, TH);
  renderer.setScissorTest(true);
  renderer.render(scene, cam);
  const buf = new Uint8Array(4 * TW * TH);
  gl.readPixels(x, 0, TW, TH, gl.RGBA, gl.UNSIGNED_BYTE, buf);
  let r=0,g=0,b=0,n=0;
  for (let p=0;p<TW*TH;p++){ r+=buf[p*4]; g+=buf[p*4+1]; b+=buf[p*4+2]; n++; }
  return { r: r/n, g: g/n, b: b/n };
}

const toward = shoot(SUN_AZ, 0);
const away = shoot((SUN_AZ + 180) % 360, TW);

[['태양 쪽 (az '+SUN_AZ+'°)', toward, 0], ['반대쪽 (az '+((SUN_AZ+180)%360)+'°)', away, TW]]
  .forEach(([label, c, x]) => {
    const d = document.createElement('div');
    d.className = 'lbl';
    d.style.left = (x + 10) + 'px'; d.style.top = '10px';
    d.textContent = label + '  rgb(' + c.r.toFixed(0) + ',' + c.g.toFixed(0) + ',' + c.b.toFixed(0) +
      ')  R/B=' + (c.r / Math.max(1, c.b)).toFixed(3);
    labels.appendChild(d);
  });

const glErr = gl.getError();
window.__stats = {
  태양쪽: toward, 반대쪽: away,
  태양쪽RB: toward.r / Math.max(1, toward.b),
  반대쪽RB: away.r / Math.max(1, away.b),
  glError: glErr,
};
window.__errors = errors;
document.title = 'DONE::' + (errors.length ? 'SHADER_ERR' : 'OK') + '::' + glErr;
</script></body></html>`;

fs.mkdirSync(PREVIEW, { recursive: true });
fs.writeFileSync(path.join(PREVIEW, 'deck-ambient.html'), html);
console.log('생성 완료: deck-ambient.html');
