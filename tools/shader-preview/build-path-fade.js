/**
 * **궤적 리본이 실제 태양·달 원반을 가리지 않는지** 검증합니다.
 *
 * `CelestialPathMesh.ts` 의 리본은 그 순간의 실제 위치를 지나므로,
 * "지금"에 해당하는 지점(dt=0)에서 태양·달 원반과 정확히 겹칩니다.
 * 겹치는 문제를 고치기 전/후를 **같은 셰이더**로, 근접 마스크 uniform만
 * 바꿔 비교합니다 (uNearFadeInner/Outer 를 극단값으로 밀면 마스크가
 * 항상 1이 되어 예전 동작을 재현합니다).
 *
 * 준비: node tools/shader-preview/stage-esm.js
 * 사용: node tools/shader-preview/build-path-fade.js
 */
const fs = require('fs');
const path = require('path');
const { PREVIEW } = require('./paths');

const TW = 380, TH = 380;
const FOV_DEG = 10; // 원반과 리본을 크게 보려면 좁은 화각이 필요합니다
const LAT = 37.5, LON = 127.0;
const DATE_ISO = new Date(Date.UTC(2026, 7, 27, 8, 40)).toISOString(); // 로컬 오후 5:40 근방, 해가 낮게

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
<h3>궤적 리본 근접 마스크 — 1·2칸 태양, 3·4칸 달 (좌: 마스크 없음(예전) / 우: 적용)</h3>
<p class="sub">FOV ${FOV_DEG}°, 실제 태양·달 위치를 화면 중앙에 맞춥니다. 십자선이 원반 중심입니다.</p>
<canvas id="c"></canvas><div id="labels"></div></div>
<script type="module">
import * as THREE from './app/vendor/three.module.js';
import { createSun, updateSun } from './app/components/SkyScene3D/SunMesh.js';
import { createMoonGroup, updateMoonPosition } from './app/components/SkyScene3D/MoonMesh.js';
import { createCelestialPathsGroup, updateCelestialPaths }
  from './app/components/SkyScene3D/CelestialPathMesh.js';
import { makeAtmosphereParams } from './app/utils/atmosphere.js';
import { getSunPosition, getMoonPosition } from './app/utils/celestial.js';

const errors = [];
const oe = console.error;
console.error = (...a) => { errors.push(a.join(' ')); oe(...a); };

const TW=${TW}, TH=${TH}, FOV_DEG=${FOV_DEG};
const LAT=${LAT}, LON=${LON};
const DATE = new Date(${JSON.stringify(DATE_ISO)});

const canvas = document.getElementById('c');
canvas.width = TW*4; canvas.height = TH;
const ctx2d = canvas.getContext('2d');
const glCanvas = document.createElement('canvas');
glCanvas.width = TW; glCanvas.height = TH;
const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias:true, alpha:false });
renderer.setPixelRatio(1); renderer.setSize(TW, TH, false);

const atmosphere = makeAtmosphereParams({ latitude: LAT, observerElevM: 30, dayOfYear: 240, humidityPct: 50 });

const scene = new THREE.Scene();
const bg = new THREE.Mesh(new THREE.SphereGeometry(490, 16, 8),
  new THREE.MeshBasicMaterial({ color: 0x1a2740, side: THREE.BackSide }));
scene.add(bg);

const sun = createSun(); scene.add(sun.mesh);
const moon = createMoonGroup(); scene.add(moon.group);
const paths = createCelestialPathsGroup(); scene.add(paths.containerGroup);

const sunPos = getSunPosition(DATE, LAT, LON);
const moonPos = getMoonPosition(DATE, LAT, LON);
updateSun(sun, sunPos.altitude, sunPos.azimuth, atmosphere);
updateMoonPosition(moon, DATE, LAT, LON);
updateCelestialPaths(paths, DATE, LAT, LON, sunPos.altitude, sunPos.azimuth);

const cam = new THREE.PerspectiveCamera(FOV_DEG, TW/TH, 0.1, 1000);
cam.position.set(0,0,0);

const gl = renderer.getContext();
const labels = document.getElementById('labels');

function look(altDeg, azDeg){
  const a=altDeg*Math.PI/180, z=azDeg*Math.PI/180;
  cam.lookAt(100*Math.cos(a)*Math.sin(z), 100*Math.sin(a), -100*Math.cos(a)*Math.cos(z));
  cam.updateMatrixWorld(true);
}
function setMask(inner, outer){
  for (const r of [paths.sun, paths.moon]){
    r.material.uniforms.uNearFadeInner.value = inner;
    r.material.uniforms.uNearFadeOuter.value = outer;
  }
}

function shoot(altDeg, azDeg){
  look(altDeg, azDeg);
  renderer.setRenderTarget(null);
  renderer.setClearColor(0x0b0f15, 1);
  renderer.render(scene, cam);
  const buf = new Uint8Array(4*TW*TH);
  gl.readPixels(0,0,TW,TH,gl.RGBA,gl.UNSIGNED_BYTE,buf);
  return buf;
}
function paint(buf, x){
  const img = ctx2d.createImageData(TW, TH);
  for (let y=0; y<TH; y++){
    const s=(TH-1-y)*TW*4, d=y*TW*4;
    for (let i=0;i<TW*4;i++) img.data[d+i]=buf[s+i];
  }
  ctx2d.putImageData(img, x, 0);
  // 중심 십자선 — 화면 중앙이 곧 실제 원반 중심입니다(카메라가 그쪽을 봄).
  ctx2d.strokeStyle='rgba(255,255,255,0.5)'; ctx2d.lineWidth=1;
  ctx2d.beginPath();
  ctx2d.moveTo(x+TW/2-10, TH/2); ctx2d.lineTo(x+TW/2+10, TH/2);
  ctx2d.moveTo(x+TW/2, TH/2-10); ctx2d.lineTo(x+TW/2, TH/2+10);
  ctx2d.stroke();
}

/** 중심 10px 반경 평균 알파(리본 불투명도) — 원반을 덮는 정도의 대용입니다. */
function centerCoverage(buf){
  const cx=TW/2, cy=TH/2, R=10;
  let s=0, n=0;
  for (let y=Math.floor(cy-R); y<cy+R; y++){
    for (let x=Math.floor(cx-R); x<cx+R; x++){
      if (Math.hypot(x-cx,y-cy) > R) continue;
      const p=(y*TW+x)*4;
      // 배경(0x1a2740 ≈ 26,39,64)과의 차이를 리본이 덮은 정도로 씁니다.
      const d = Math.abs(buf[p]-26)+Math.abs(buf[p+1]-39)+Math.abs(buf[p+2]-64);
      s += d; n++;
    }
  }
  return +(s/n).toFixed(1);
}

const 결과 = [];
// 1·2칸: 태양. 3·4칸: 달.
const TARGETS = [['태양', sunPos.altitude, sunPos.azimuth],
                  ['달',  moonPos.altitude, moonPos.azimuth]];
TARGETS.forEach(([name, alt, az], targetIdx) => {
  // ⚠ 실제 원반(sun.mesh / moon.group)이 화면 중앙에서 함께 그려지므로,
  // 그 밝기가 중심 측정값을 지배해 리본의 기여가 묻힙니다. 원반을 잠깐
  // 끄고 **리본만** 재고, 화면에 보여줄 때만 다시 켭니다.
  sun.mesh.visible = false; moon.group.visible = false;

  // GLSL smoothstep(edge0,edge1,x)는 edge0==edge1이면 정의되지 않습니다
  // (0으로 나눔). edge0<edge1을 지키면서 실제 dt(수 시간 이내)보다 훨씬
  // 작은 값으로 두면 mask≈1이 항상 유지됩니다 — 마스크 없음의 안전한 재현.
  setMask(-1000, -999); // 마스크 없음 — 예전 동작 재현
  const ribbonBefore = shoot(alt, az);
  const covBefore = centerCoverage(ribbonBefore);

  setMask(0.12, 0.4); // 기본값
  const ribbonAfter = shoot(alt, az);
  const covAfter = centerCoverage(ribbonAfter);

  // 화면에 보여줄 그림은 원반을 켠 채로 다시 찍습니다.
  sun.mesh.visible = true; moon.group.visible = true;
  setMask(-1000, -999);
  const before = shoot(alt, az);
  setMask(0.12, 0.4);
  const after = shoot(alt, az);

  // 대상마다 패널 2개씩 — 인덱스는 반복 순번으로 직접 계산합니다
  // (결과.length 로 계산하면 반복마다 1개씩만 늘어 두 번째 대상이
  // 첫 대상의 두 번째 패널을 덮어씁니다).
  const i0 = targetIdx * 2;
  paint(before, i0*TW);
  paint(after, (i0+1)*TW);

  for (const [j, tag, cov] of [[0,'마스크 없음',covBefore],[1,'마스크 적용',covAfter]]){
    const d=document.createElement('div');
    d.className='lbl'; d.style.left=((i0+j)*TW+16)+'px'; d.style.top='58px';
    d.innerHTML = name+' · '+tag+'<br>중심 리본 덮임 '+cov;
    labels.appendChild(d);
  }
  결과.push({ 대상:name, 고도:+alt.toFixed(1), 리본_마스크없음:covBefore, 리본_마스크적용:covAfter });
});

window.__stats = { glError: gl.getError(), 결과 };
window.__errors = errors;
document.title = 'DONE::' + (errors.length ? 'SHADER_ERR' : 'OK') + '::' + gl.getError();
</script></body></html>`;

fs.mkdirSync(PREVIEW, { recursive: true });
fs.writeFileSync(path.join(PREVIEW, 'path-fade.html'), html);
console.log('생성 완료: path-fade.html');
