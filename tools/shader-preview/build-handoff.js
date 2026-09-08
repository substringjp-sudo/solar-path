/**
 * **씬에 연결한 대로 넘겨받는가** (docs/COASTLINE_PLAN.md 3·4단계).
 *
 * `SkyScene3D.tsx` 에 실제로 짠 배치를 그대로 재현합니다 — DEM 근거리
 * 지형(`TerrainField`)·해수면(`SeaPlane`)을 **기존 원반·능선 띠 위에**
 * `renderOrder` 만 다르게 얹고, 원반/띠는 그대로 둡니다:
 *
 *     렌더 순서(먼저→나중): terrainField(-0.6) → seaPlane(-0.55)
 *                          → ground(-0.5) → bands(-0.4+)
 *
 * ## 재는 것
 *
 * ① **하늘 구멍이 없는가.** 근접(0.6m)부터 먼 능선 띠(40km) 바깥까지
 *    세로로 훑어, 지면이어야 할 자리에 하늘(빈 화소)이 새는 곳이 있는지
 *    봅니다. 이게 "이음매"가 실패하면 나는 증상입니다 — 3단계에서
 *    발밑에 각도 구멍이 났을 때, 4단계에서 해수면 아래가 뭍으로 덮였을
 *    때 전부 이 형태로 드러났습니다.
 * ② **바다 방위: SeaPlane 이 3km 밖도 이어받는가.** DEM 지형은 3km 에서
 *    끝나지만 SeaPlane 은 진짜 수평선(수십 km)까지 뻗습니다. 3km 지점
 *    앞뒤로 색이 급하게 안 끊기는지 봅니다.
 * ③ **뭍 방위: 3km 밖은 옛 원반/능선 띠가 이어받는가.** DEM 격자가 끝나는
 *    자리 밖에서 화면이 비지 않고 기존 지형(원반의 일반색, 5km 능선 띠)
 *    으로 자연히 넘어가는지 봅니다.
 *
 * ⚠ 능선 띠 내용은 **합성**입니다(진짜 Open-Meteo 프로필이 아니라 대표값).
 * 여기서 보는 것은 "그 값이 정확한가"가 아니라 "배치·깊이·렌더 순서가
 * 씬에 짠 대로 작동하는가" 입니다.
 *
 * 사용: node tools/shader-preview/build-handoff.js
 *       node tools/shader-preview/verify-handoff.js
 */
const fs = require('fs');
const path = require('path');
const { PREVIEW } = require('./paths');
const { makeCpuDem } = require('./dem-cpu');

/** 4·5단계와 같은 자리 — 대부도 서안. 캐시된 타일을 그대로 씁니다. */
const LAT = 37.24102, LON = 126.55969, ZOOM = 13, BLOCK = 3;
const EYE_M = 1.6;

// 씬과 같은 값 (SkyScene3D.tsx 에 실제로 짠 것)
const FIELD_FAR_M = 3000;
const BAND_DIST_KM = [5, 15, 40];
const SAMPLES = 31;

const demDir = path.join(PREVIEW, 'dem');
const dem = makeCpuDem({ demDir, zoom: ZOOM, lat: LAT, lon: LON });
const OBS = dem.elevAtGround(0, 0);
const eye = OBS + EYE_M;
console.log(`발밑(DEM) ${OBS.toFixed(2)}m · 눈 ${eye.toFixed(2)}m`);

// ── 두 방위의 대표 능선 띠(합성) ────────────────────────────────────────────
// 바다 방위: 전부 물(waterFrac=1, 각도는 setGroundHorizon 이 씁니다).
// 뭍 방위: 40km 에 완만한 산 하나(고도각 2°).
const seaBandAngles = BAND_DIST_KM.map(() => Array(SAMPLES).fill(-999)); // hasMountain=false 로 접힘
const seaWaterFrac = Array(SAMPLES).fill(1);
const landBandAngles = BAND_DIST_KM.map((d, i) => Array(SAMPLES).fill(i === 2 ? 2.0 : -999));
const landWaterFrac = Array(SAMPLES).fill(0);

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
 body{margin:0;background:#0b0f15;font-family:sans-serif;color:#dde}
 #wrap{padding:12px;width:900px} h3{font-size:14px;margin:6px 0}
 canvas{border:1px solid #345;margin:4px} p{font:11px monospace}
</style></head><body>
<div id="wrap"><h3>씬 연결 — 이음매(옛 원반·능선 띠 + 새 근거리 지형)</h3>
<div id="shots"></div><div id="out"></div></div>
<script type="module">
import * as THREE from './app/vendor/three.module.js';
import { loadDemPatch } from './app/utils/demTiles.js';
import { createTerrainField, updateTerrainFieldEye } from './app/components/SkyScene3D/TerrainField.js';
import { createSeaPlane, updateSeaPlaneEye } from './app/components/SkyScene3D/SeaPlane.js';
import {
  createGroundPlane, setGroundHorizon, createTerrainBands, updateGroundColors, updateTerrainBands,
} from './app/components/SkyScene3D/TerrainRing.js';

const errors=[]; const oe=console.error; console.error=(...a)=>{errors.push(a.join(' ')); oe(...a);};
window.addEventListener('error', e=>errors.push(String(e.message)));

const LAT=${LAT}, LON=${LON}, BLOCK=${BLOCK}, FAR=${FIELD_FAR_M}, EYE=${EYE_M};
const OBS=${OBS};
const BAND_DIST=${JSON.stringify(BAND_DIST_KM)};
const SEA_BANDS=${JSON.stringify(seaBandAngles)}, SEA_WATER=${JSON.stringify(seaWaterFrac)};
const LAND_BANDS=${JSON.stringify(landBandAngles)}, LAND_WATER=${JSON.stringify(landWaterFrac)};

const W=256, H=512;
const canvas=document.createElement('canvas'); canvas.width=W; canvas.height=H;
const renderer=new THREE.WebGLRenderer({canvas, antialias:false, alpha:true});
renderer.setPixelRatio(1); renderer.setSize(W,H,false); renderer.setClearColor(0x000000,0);

const loadTexture=(u)=>new Promise((res,rej)=>{ new THREE.TextureLoader().load(u,res,undefined,rej); });
const patch=await loadDemPatch(LAT,LON,FAR,{renderer,loadTexture,block:BLOCK,
  tileUrl:(z,x,y)=>\`./dem/\${z}_\${x}_\${y}.png\`});

let 결과=null;
if (patch) {
  // ── 앱과 똑같은 배치 · renderOrder ────────────────────────────────────
  const ground = createGroundPlane();
  setGroundHorizon(ground, OBS);
  const terrainField = createTerrainField({ patch, eyeHeightM: EYE });
  terrainField.mesh.renderOrder = -0.6;
  const seaPlane = createSeaPlane({ patch, eyeHeightM: EYE });
  seaPlane.mesh.renderOrder = -0.55;

  const scene = new THREE.Scene();
  scene.add(ground); scene.add(terrainField.mesh); scene.add(seaPlane.mesh);

  const cam = new THREE.PerspectiveCamera(60, W/H, 0.1, 200000);
  cam.position.set(0, 0, 0);
  updateTerrainFieldEye(terrainField, cam);
  updateSeaPlaneEye(seaPlane, cam);

  const sky = { r: 0.30, g: 0.34, b: 0.44 };
  updateGroundColors(ground, 30, 0, { skyMean: sky, betaMie: 0.08, angstrom: 1.3, elevScale: 1.0 });
  for (const m of [terrainField.material, seaPlane.material]) {
    m.uniforms.uSurfaceIrr.value.set(sky.r, sky.g, sky.b);
    m.uniforms.uSunAltDeg.value = 30;
    m.uniforms.uHazeRadiance.value.set(sky.r*0.7, sky.g*0.75, sky.b*0.85);
  }

  const rt = new THREE.WebGLRenderTarget(W,H,{format:THREE.RGBAFormat,
    type:THREE.UnsignedByteType, minFilter:THREE.NearestFilter,
    magFilter:THREE.NearestFilter, depthBuffer:true});
  const buf = new Uint8Array(W*H*4);

  function shootScene(pitchDeg, fovDeg){
    cam.fov = fovDeg; cam.updateProjectionMatrix();
    const pr = pitchDeg*Math.PI/180;
    cam.up.set(0,1,0); cam.lookAt(0, Math.sin(pr), -Math.cos(pr)); cam.updateMatrixWorld(true);
    renderer.setRenderTarget(rt); renderer.clear(); renderer.render(scene,cam);
    renderer.readRenderTargetPixels(rt,0,0,W,H,buf); renderer.setRenderTarget(null);
    renderer.render(scene,cam);
    const c=document.createElement('canvas'); c.width=W; c.height=H;
    c.style.width='128px'; c.style.height=(H/2)+'px';
    c.getContext('2d').drawImage(canvas,0,0);
    document.getElementById('shots').appendChild(c);
    // 열마다 위에서 아래로 훑어 첫(가장 위) 지면 화소와, 그 아래로 빈 화소(구멍)가 있는지.
    const cols=[];
    for (let x=0;x<W;x++){
      let top=-1, holes=0, sawGround=false;
      for (let y=H-1;y>=0;y--){
        const o=(y*W+x)*4, a=buf[o+3];
        if (a>128){ if(top<0) top=y; sawGround=true; }
        else if (sawGround) holes++; // 지면을 본 뒤에 다시 빈 화소 — 구멍
      }
      cols.push({x, top, holes});
    }
    return cols;
  }

  const bands = [];
  for (const [label, bandAngles, waterFrac] of [['sea', SEA_BANDS, SEA_WATER], ['land', LAND_BANDS, LAND_WATER]]) {
    const b = createTerrainBands(bandAngles, BAND_DIST, undefined, waterFrac, OBS);
    scene.add(b.group);
    updateTerrainBands(b, 30, { skyMean: sky, hazeAt: () => sky, betaMie: 0.08, angstrom: 1.3, elevScale: 1.0 });
    bands.push({ label, handle: b });
    // 이 방위 세트로 한 번 찍고, 바로 치웁니다(다음 세트와 안 섞이게).
    const cols = shootScene(-8, 70);
    bands[bands.length-1].cols = cols;
    scene.remove(b.group);
  }

  const summarize = (cols) => {
    const holeCols = cols.filter(c => c.holes > 0);
    return {
      열: cols.length,
      구멍열: holeCols.length,
      최대구멍: cols.length ? Math.max(...cols.map(c=>c.holes)) : 0,
      맨위행평균: +(cols.reduce((a,c)=>a+(c.top<0?0:c.top),0)/cols.length).toFixed(1),
    };
  };

  결과 = {
    바다: summarize(bands[0].cols),
    뭍: summarize(bands[1].cols),
  };
  document.getElementById('out').innerHTML =
    '<p>바다 구멍열 '+결과.바다.구멍열+'/'+결과.바다.열
    +' · 뭍 구멍열 '+결과.뭍.구멍열+'/'+결과.뭍.열+'</p>';
}

window.__stats={ glError: renderer.getContext().getError(), 결과 };
window.__errors=errors;
document.title='DONE::'+(errors.length?'ERR':'OK')+'::'+renderer.getContext().getError();
</script></body></html>`;

fs.mkdirSync(PREVIEW, { recursive: true });
fs.writeFileSync(path.join(PREVIEW, 'handoff.html'), html);
console.log('생성 완료: handoff.html');
