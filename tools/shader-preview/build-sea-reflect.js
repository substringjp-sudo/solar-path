/**
 * **하늘 되비침(프레넬)이 붙었는가** — 3번(씬 연결) 부수 작업.
 *
 * 2·4·5단계의 새 지형/해수면을 실제 앱 씬에 연결하려면, 49절에서 고친
 * 물빛(프레넬로 하늘을 비추는 것)이 새 `SeaPlane` 에도 있어야 합니다 —
 * 없으면 씬을 바꾸는 순간 노을에도 물이 상수색 평면으로 되돌아가는
 * **퇴보**입니다. 여기서는 그 항을 DEM 자료 없이 **고립시켜** 잽니다.
 *
 * ## 왜 DEM 을 안 쓰는가
 *
 * `patch: null` 로 두면 `uDemValid=0` 이 되어 해수면이 완전히 평평해지고
 * (`groundAtEye` 가 `uObsElevM` 로 물러남), 수심은 어디서나 999(모름)이라
 * 바닥 비침·포말이 전부 꺼집니다. 그러면 물빛은 오직
 *
 *     col = mix(body, skyRefl, Fv(cosV))
 *
 * 하나로 정해지고, `body` 는 상수(uSurfaceIrr × uWaterAlbedo)라 **미리
 * 압니다.** 그러면 측정은 재는 게 아니라 **재구성**이 되어, 진짜 DEM
 * 지형과 얽혀 다른 항(수심 흡수, 공기원근)이 신호를 가릴 걱정이 없습니다.
 *
 * ## 재는 법
 *
 * 카메라를 아래로 −45° 기울여 넓은 화각(88°) 으로 한 번 찍으면, 화면
 * 세로 한 줄이 그대로 시야각 −89°(거의 발밑) 에서 −1°(거의 수평선) 까지
 * 훑습니다. 각 행의 **실제 시야각**은 카메라 기하로 압니다 — 셰이더가
 * 아니라 여기서 손으로 계산합니다.
 *
 *     cosV(row)  = max(0.02, −sin(elev))
 *     Fv(row)    = 0.02 + 0.98·(1−cosV)⁵           ← waterFresnel, 같은 식
 *
 * `Fv` 가 0에 가까우면(발밑) 색이 `body` 에 붙어야 하고, 1에 가까우면
 * (수평선) `body` 에서 멀어져야 합니다 — **단조** 여야 합니다.
 *
 * 사용: node tools/shader-preview/build-sea-reflect.js
 *       node tools/shader-preview/verify-sea-reflect.js
 */
const fs = require('fs');
const path = require('path');
const { PREVIEW } = require('./paths');

const OBS_ELEV_M = 50, EYE_M = 1.6;
const PITCH_DEG = -45, FOV_DEG = 88, W = 32, H = 256;
const SUN_ALT_DEG = 6; // 노을 근처 — 하늘 색조가 방위마다 뚜렷이 갈립니다.

const waterFresnel = (cosTheta) => {
  const f = Math.pow(1 - Math.max(0, Math.min(1, cosTheta)), 5);
  return 0.02 + 0.98 * f;
};

// 행 → 시야각 (카메라 기하로 손수 계산 — 셰이더와 별개의 길입니다).
const tanV = Math.tan((FOV_DEG / 2) * Math.PI / 180);
const rowElevDeg = (y) => {
  const ny = (y / H) * 2 - 1;
  const dirCamY = ny * tanV;
  const dirCamZ = -1;
  const L = Math.hypot(dirCamY, dirCamZ);
  const localY = dirCamY / L;
  const pitchRad = (PITCH_DEG * Math.PI) / 180;
  // 카메라 로컬 (0,localY,localZ) 를 pitch 만큼 X축으로 돌립니다.
  const localZ = dirCamZ / L;
  const wy = localY * Math.cos(pitchRad) - localZ * Math.sin(pitchRad);
  return (Math.asin(Math.max(-1, Math.min(1, wy))) * 180) / Math.PI;
};

const rows = [];
for (let y = 0; y < H; y++) {
  const elevDeg = rowElevDeg(y);
  const cosV = Math.max(0.02, -Math.sin((elevDeg * Math.PI) / 180));
  rows.push({ y, elevDeg: +elevDeg.toFixed(3), fv: +waterFresnel(cosV).toFixed(4) });
}
console.log(`행 ${H} · 시야각 ${rows[0].elevDeg}°(맨아래) ~ ${rows[H - 1].elevDeg}°(맨위)`);
console.log(`Fv 범위 ${Math.min(...rows.map(r => r.fv)).toFixed(3)} ~ ${Math.max(...rows.map(r => r.fv)).toFixed(3)}`);

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
 body{margin:0;background:#0b0f15;font-family:sans-serif;color:#dde}
 #wrap{padding:12px;width:900px} h3{font-size:14px;margin:6px 0}
 canvas{border:1px solid #345;margin:4px} p{font:11px monospace}
</style></head><body>
<div id="wrap"><h3>해수면 — 하늘 되비침(프레넬) 단독 시험</h3>
<div id="shots"></div><div id="out"></div></div>
<script type="module">
import * as THREE from './app/vendor/three.module.js';
import { createSeaPlane, updateSeaPlaneEye } from './app/components/SkyScene3D/SeaPlane.js';

const errors=[]; const oe=console.error; console.error=(...a)=>{errors.push(a.join(' ')); oe(...a);};
window.addEventListener('error', e=>errors.push(String(e.message)));

const OBS=${OBS_ELEV_M}, EYE=${EYE_M}, PITCH=${PITCH_DEG}, FOV=${FOV_DEG}, W=${W}, H=${H};
const SUN_ALT=${SUN_ALT_DEG};
const ROWS=${JSON.stringify(rows)};

const canvas=document.createElement('canvas'); canvas.width=W; canvas.height=H;
const renderer=new THREE.WebGLRenderer({canvas, antialias:false, alpha:true});
renderer.setPixelRatio(1); renderer.setSize(W,H,false); renderer.setClearColor(0x000000,0);

// ⚠ patch 없이 만듭니다 — 이 시험의 핵심입니다(윗주석 참고).
const sea = createSeaPlane({ observerElevM: OBS, eyeHeightM: EYE,
  waterAlbedo: { r: 0.005, g: 0.038, b: 0.055 } });
sea.material.uniforms.uSurfaceIrr.value.set(0.30, 0.34, 0.44);
sea.material.uniforms.uSunAltDeg.value = SUN_ALT;
sea.material.uniforms.uSunAltRad.value = SUN_ALT * Math.PI / 180;
sea.material.uniforms.uSunRadiance.value.set(0.9, 0.6, 0.35);

const scene=new THREE.Scene(); scene.add(sea.mesh);
const cam=new THREE.PerspectiveCamera(FOV, W/H, 0.1, 200000); cam.position.set(0,0,0);
updateSeaPlaneEye(sea, cam);
cam.aspect = W/H; cam.updateProjectionMatrix();

const rt=new THREE.WebGLRenderTarget(W,H,{format:THREE.RGBAFormat,
  type:THREE.UnsignedByteType, minFilter:THREE.NearestFilter,
  magFilter:THREE.NearestFilter, depthBuffer:true});
const buf=new Uint8Array(W*H*4);

// ⚠ 태양 방위는 **고정**입니다. 처음에 카메라 방위를 따라 태양도 같이
//   돌렸더니 "해쪽"과 "반대" 샷이 매번 거울 방향이 태양을 정면으로
//   보는 기하가 되어(카메라가 어느 쪽을 보든 태양도 그쪽에 있으니) 두
//   측정이 **똑같이** 나왔습니다(방위 대비가 전혀 없었습니다). 태양은
//   한 자리(0°)에 두고 **카메라만** 그쪽을 보거나(해쪽) 등지게(반대) 돌려야
//   거울 방향의 태양 정렬(cosG)이 실제로 갈립니다.
sea.material.uniforms.uSunAzRad.value = 0;

function shoot(azDeg, fresnelOn){
  sea.material.uniforms.uFresnel.value = fresnelOn ? 1 : 0;
  const ar=azDeg*Math.PI/180, pr=PITCH*Math.PI/180;
  cam.up.set(0,1,0);
  cam.lookAt(Math.cos(pr)*Math.sin(ar), Math.sin(pr), -Math.cos(pr)*Math.cos(ar));
  cam.updateMatrixWorld(true);
  renderer.setRenderTarget(rt); renderer.clear(); renderer.render(scene,cam);
  renderer.readRenderTargetPixels(rt,0,0,W,H,buf);
  renderer.setRenderTarget(null); renderer.render(scene,cam);
  const c=document.createElement('canvas'); c.width=W; c.height=H;
  c.style.width='128px'; c.style.height=(H/2)+'px';
  c.getContext('2d').drawImage(canvas,0,0);
  document.getElementById('shots').appendChild(c);
  // 행 평균 (아래에서 위로 오는 원본을 그대로 인덱싱 — y=0 이 아래).
  const rows=[];
  for (let y=0;y<H;y++){
    let r=0,g=0,b=0,n=0;
    for (let x=0;x<W;x++){ const o=(y*W+x)*4;
      if (buf[o+3]>128){ r+=buf[o]; g+=buf[o+1]; b+=buf[o+2]; n++; } }
    rows.push(n?{r:r/n,g:g/n,b:b/n,n}:null);
  }
  return rows;
}

// 태양을 바라보는 방위(0°) 대 등지는 방위(180°), 그리고 끈 대조.
const onSunFacing = shoot(0, true);
const onSunAway   = shoot(180, true);
const off         = shoot(0, false);

const 표 = ROWS.map((r,i)=>({ ...r,
  켬_해쪽: onSunFacing[i], 켬_반대: onSunAway[i], 끔: off[i] }));

const lum = c => c ? (0.2126*c.r+0.7152*c.g+0.0722*c.b) : null;
const bodyRows = 표.filter(r => r.끔 && r.n === undefined ? false : r.끔);
// body 는 uFresnel=0 일 때의 값 — 모든 행에서 상수여야 합니다(대조).
const bodyVals = 표.map(r=>r.끔).filter(Boolean).map(lum);
const bodyMean = bodyVals.length ? bodyVals.reduce((a,b)=>a+b,0)/bodyVals.length : null;
const bodySpread = bodyVals.length ? Math.max(...bodyVals)-Math.min(...bodyVals) : null;

const valid = 표.filter(r => r.켬_해쪽 && r.끔);
const dev = valid.map(r => ({ fv: r.fv, d: Math.abs(lum(r.켬_해쪽) - lum(r.끔)) }));

// Fv 오름차순으로 정렬해 |켬−끔| 이 대체로 커지는지(단조) 봅니다.
const sortedByFv = dev.slice().sort((a,b)=>a.fv-b.fv);
let 역전=0;
for (let i=1;i<sortedByFv.length;i++) if (sortedByFv[i].d < sortedByFv[i-1].d - 5) 역전++;
const lo = sortedByFv.slice(0, Math.max(1, sortedByFv.length>>3));
const hi = sortedByFv.slice(-Math.max(1, sortedByFv.length>>3));
const meanD = a => a.reduce((x,y)=>x+y.d,0)/a.length;

const 결과 = {
  body평균: bodyMean===null?null:+bodyMean.toFixed(2),
  body변동폭: bodySpread===null?null:+bodySpread.toFixed(2),
  표본: dev.length,
  낮은Fv평균편차: +meanD(lo).toFixed(2),
  높은Fv평균편차: +meanD(hi).toFixed(2),
  역전횟수: 역전,
  방위별: valid.filter(r=>r.fv>0.5).map(r=>({
    fv:r.fv, 해쪽:+lum(r.켬_해쪽).toFixed(2), 반대:+lum(r.켬_반대).toFixed(2) })),
  표: valid.map(r=>({ elevDeg:r.elevDeg, fv:r.fv,
    켬:+lum(r.켬_해쪽).toFixed(2), 끔:+lum(r.끔).toFixed(2) })),
};
document.getElementById('out').innerHTML =
  '<p>body 평균 '+결과.body평균+' (변동폭 '+결과.body변동폭
  +') · 낮은/높은 Fv 평균 |켬−끔| '+결과.낮은Fv평균편차+' / '+결과.높은Fv평균편차
  +' · 역전 '+결과.역전횟수+'</p>';

window.__stats={ glError: renderer.getContext().getError(), 결과 };
window.__errors=errors;
document.title='DONE::'+(errors.length?'ERR':'OK')+'::'+renderer.getContext().getError();
</script></body></html>`;

fs.mkdirSync(PREVIEW, { recursive: true });
fs.writeFileSync(path.join(PREVIEW, 'sea-reflect.html'), html);
console.log('생성 완료: sea-reflect.html');
