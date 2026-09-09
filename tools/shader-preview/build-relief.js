/**
 * **해를 등진 산에 입체감이 있는가** (실기 보고: "산에 입체감이 느껴지지 않아").
 *
 * 지면 조명은 `조도 × 알베도` 였고, 하늘 몫은 **등방이니 각도가 없다**며
 * 어디서나 같은 값을 곱했습니다. 그러면 해를 등진 사면에서는 `ndl` 이 0 이라
 * 직달이 통째로 사라지고, 남는 것이 상수인 하늘 몫뿐입니다 — 능선이 한 가지
 * 색의 판지가 됩니다. 실기 화면에서 산이 납작해 보인 자리가 정확히 그쪽입니다.
 *
 * ## 재는 법 — 지면 화소 밝기의 **퍼짐**
 *
 * 같은 산을 해 쪽에서 한 번, 등진 쪽에서 한 번 찍고 지면 화소 밝기의
 * 표준편차를 봅니다. 입체감이란 결국 "면마다 밝기가 다르다" 이므로, 등진
 * 쪽에서 퍼짐이 0 에 가까우면 그게 판지입니다.
 *
 * ## 무엇을 껐다 켜 보는가
 *
 * - `GROUND_MIN_GLOW` — 표시의 최소 밝기 **바닥**. 바닥보다 어두운 곳을 전부
 *   같은 색으로 뭉개므로, 어두운 장면에서 음영을 지울 수 있습니다. 실제로
 *   지우고 있는지 여기서 같이 잽니다.
 *
 * ⚠ 대조: `uSkyView` 는 **수평면에서 정확히 1** 이어야 합니다(cos 0 = 1).
 * 평평한 땅의 밝기가 변하면 그건 음영이 아니라 전체를 어둡게 한 것입니다.
 *
 * 사용: node tools/shader-preview/build-relief.js
 *       node tools/shader-preview/verify-relief.js
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const { PREVIEW } = require('./paths');
const D = require('./dem-cpu');

/** 마니산 정상 — 3km 안에 455m 의 진짜 기복. */
const LAT = 37.61553, LON = 126.4300, DIR = 'dem-mani', BLOCK = 3;
const FIELD_FAR_M = 3000, EYE_M = 1.6;
/** 해 방위. 카메라는 늘 45° 를 봅니다 — 해만 옮겨 앞/뒤를 만듭니다. */
const LOOK_AZ = 45;
/**
 * ⚠ 해를 카메라 **바로 뒤**(225°)에 두면 보이는 면이 죄다 정면광이라
 * 원래 평평합니다 — 사진에서 정오광을 피하는 이유와 같습니다. 처음에 앞뒤
 * 둘만 놓고 재서 "어느 쪽이든 판지"라는 잘못된 결론이 나올 뻔했습니다.
 * 입체감이 가장 크게 드러나는 것은 **측광**이므로 그것을 같이 봅니다.
 */
const SUN = [
  { key: '역광 (해 정면)', az: 45 },
  { key: '측광 (왼쪽)', az: 135 },
  { key: '정면광 (해 등짐)', az: 225 },
  { key: '측광 (오른쪽)', az: 315 },
];
const SUN_ALT = 25;
/**
 * ⚠ 조도는 **앱이 실제로 쓰는 값**이어야 합니다. 처음엔 어림으로
 * `하늘 0.11 · 직달 2.4` 를 넣었는데, 앱의 대기 모형을 돌려 보니 해 25° 에서
 * 하늘 평균이 1.03, 직달(beam)이 0.66 입니다 — **하늘이 직달보다 큽니다.**
 * 어림값은 하늘을 10배 작게 잡아, 표시의 최소 밝기 바닥(0.038)이 신호를
 * 통째로 삼켰습니다. 그 상태로 재면 무엇을 켜든 σ 가 안 움직입니다.
 */
const SKY_MEAN = { r: 0.83, g: 1.03, b: 1.27 };
const BEAM = { r: 0.78, g: 0.66, b: 0.52 };

/**
 * ⚠ 조명 배선은 **앱에서 가져옵니다** — 여기 손으로 적으면 앱이 바뀔 때
 * 하네스만 옛 배선을 재게 됩니다. groundLighting 이 앱과 같은 한 벌
 * (수평면 조도 · 직달 복사휘도 · 노출 보정)을 돌려줍니다.
 */
const ATM = require('/tmp/skybuild/atmosphere.js');
const LIT = ATM.groundLighting(SUN_ALT, SKY_MEAN, BEAM, 1);
const SURFACE_IRR = [LIT.surfaceIrr.r, LIT.surfaceIrr.g, LIT.surfaceIrr.b];
const SUN_RADIANCE = [LIT.sunRadiance.r, LIT.sunRadiance.g, LIT.sunRadiance.b];
const EXPO = LIT.exposure;

/**
 * 대조군 — **직달 눈금만 1 로 되돌린** 같은 셰이더. 노출도 그 눈금에 맞춰
 * 1 이 됩니다. 두 벌의 차이는 오직 SOLAR_BEAM_SCALE 하나이므로, σ 가
 * 벌어진다면 그것은 눈금이 만든 것입니다.
 */
const S1 = Math.max(0, Math.sin((SUN_ALT * Math.PI) / 180)) / Math.PI;
const OLD_IRR = [SKY_MEAN.r + BEAM.r * S1, SKY_MEAN.g + BEAM.g * S1, SKY_MEAN.b + BEAM.b * S1];
const OLD_SUN = [BEAM.r, BEAM.g, BEAM.b];
/**
 * 새벽/해질녘(해 1°) — 실기 넷째 사진이 이 자리입니다. 앱의 대기 모형이
 * 주는 값: 하늘 평균 0.180, beam 0.03. 표시의 최소 밝기 바닥(0.038)과
 * **같은 자릿수**라, 바닥으로 자르면 지형이 통째로 바닥색이 됩니다.
 */
const DAWN_LIT = ATM.groundLighting(1, { r: 0.169, g: 0.180, b: 0.154 },
                                       { r: 0.12, g: 0.03, b: 0.00 }, 1);
const DAWN_IRR = [DAWN_LIT.surfaceIrr.r, DAWN_LIT.surfaceIrr.g, DAWN_LIT.surfaceIrr.b];
const DAWN_SUN = [DAWN_LIT.sunRadiance.r, DAWN_LIT.sunRadiance.g, DAWN_LIT.sunRadiance.b];

const get = (u) => new Promise((res, rej) => {
  https.get(u, r => {
    if (r.statusCode !== 200) { rej(new Error('HTTP ' + r.statusCode)); r.resume(); return; }
    const c = []; r.on('data', d => c.push(d)); r.on('end', () => res(Buffer.concat(c)));
  }).on('error', rej);
});

(async () => {
  const zoom = D.demZoomForRadius(FIELD_FAR_M, LAT, BLOCK);
  const t = D.lonLatToTileFloat(LON, LAT, zoom);
  const { originX, originY } = D.pickBlockOrigin(t.x, t.y, BLOCK);
  const demDir = path.join(PREVIEW, DIR);
  fs.mkdirSync(demDir, { recursive: true });
  for (let dy = 0; dy < BLOCK; dy++) for (let dx = 0; dx < BLOCK; dx++) {
    const f = path.join(demDir, `${zoom}_${originX + dx}_${originY + dy}.png`);
    if (fs.existsSync(f)) continue;
    fs.writeFileSync(f, await get(
      `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${zoom}/${originX + dx}/${originY + dy}.png`));
  }
  const dem = D.makeCpuDem({ demDir, zoom, lat: LAT, lon: LON });
  console.log(`발밑 ${dem.elevAtGround(0, 0).toFixed(1)}m`);

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
 body{margin:0;background:#0b0f15;font-family:sans-serif;color:#dde}
 #wrap{padding:12px;width:900px} canvas{border:1px solid #345;margin:2px} p{font:11px monospace}
</style></head><body>
<div id="wrap"><h3>해를 등진 산에 입체감이 있는가</h3>
<div id="shots"></div><div id="out"></div></div>
<script type="module">
import * as THREE from './app/vendor/three.module.js';
import { loadDemPatch, clearDemCache } from './app/utils/demTiles.js';
import { createTerrainField, updateTerrainFieldEye } from './app/components/SkyScene3D/TerrainField.js';

const errors=[]; const oe=console.error; console.error=(...a)=>{errors.push(a.join(' ')); oe(...a);};
window.addEventListener('error', e=>errors.push(String(e.message)));

const LAT=${LAT}, LON=${LON}, DIR='${DIR}', BLOCK=${BLOCK};
const FAR=${FIELD_FAR_M}, EYE=${EYE_M}, LOOK_AZ=${LOOK_AZ}, SUN=${JSON.stringify(SUN)}, SUN_ALT=${SUN_ALT};
const IRR=${JSON.stringify(SURFACE_IRR)}, SUNR=${JSON.stringify(SUN_RADIANCE)};
const EXPO=${EXPO};
const OLD_IRR=${JSON.stringify(OLD_IRR)}, OLD_SUN=${JSON.stringify(OLD_SUN)};
const DAWN_IRR=${JSON.stringify(DAWN_IRR)}, DAWN_SUN=${JSON.stringify(DAWN_SUN)};

const W=320, H=320, FOV=70, PITCH=-20;
const canvas=document.createElement('canvas'); canvas.width=W; canvas.height=H;
const renderer=new THREE.WebGLRenderer({canvas, antialias:false, alpha:true});
renderer.setPixelRatio(1); renderer.setSize(W,H,false); renderer.setClearColor(0x000000,0);
const rt=new THREE.WebGLRenderTarget(W,H,{format:THREE.RGBAFormat,type:THREE.UnsignedByteType,
  minFilter:THREE.NearestFilter, magFilter:THREE.NearestFilter, depthBuffer:true});
const buf=new Uint8Array(W*H*4);
const loadTexture=(u)=>new Promise((res,rej)=>{ new THREE.TextureLoader().load(u,res,undefined,rej); });

clearDemCache();
const patch=await loadDemPatch(LAT, LON, FAR, {renderer, loadTexture, block:BLOCK,
  tileUrl:(z,x,y)=>\`./\${DIR}/\${z}_\${x}_\${y}.png\`});
if(!patch) errors.push('패치 없음');

const scene=new THREE.Scene();
const cam=new THREE.PerspectiveCamera(FOV, 1, 0.1, 2000); cam.position.set(0,0,0);
const field=createTerrainField({patch, eyePatch:patch, eyeHeightM:EYE});
scene.add(field.mesh); updateTerrainFieldEye(field, cam);
const u=field.material.uniforms;
u.uSurfaceIrr.value.set(IRR[0], IRR[1], IRR[2]);
u.uSunRadiance.value.set(SUNR[0], SUNR[1], SUNR[2]);
u.uExposure.value=EXPO;
u.uAerial.value=0;
u.uSunAltDeg.value=SUN_ALT; u.uSunAltRad.value=SUN_ALT*Math.PI/180;

const pr=PITCH*Math.PI/180, ar=LOOK_AZ*Math.PI/180;
cam.up.set(0,1,0);
cam.lookAt(Math.sin(ar)*Math.cos(pr), Math.sin(pr), -Math.cos(ar)*Math.cos(pr));
cam.updateMatrixWorld(true);

/** 지면 화소 밝기의 평균·표준편차. 입체감 = 면마다 밝기가 다름. */
function shoot(label){
  renderer.setRenderTarget(rt); renderer.clear(); renderer.render(scene,cam);
  renderer.readRenderTargetPixels(rt,0,0,W,H,buf); renderer.setRenderTarget(null);
  renderer.render(scene,cam);
  const c=document.createElement('canvas'); c.width=W; c.height=H;
  c.style.width='160px'; c.style.height='160px';
  c.getContext('2d').drawImage(canvas,0,0);
  const d=document.createElement('div'); d.style.font='10px monospace'; d.textContent=label;
  document.getElementById('shots').appendChild(d);
  document.getElementById('shots').appendChild(c);
  const ls=[]; let sr=0, sg=0, sb=0;
  for(let i=0;i<W*H;i++){
    if(buf[i*4+3]<128) continue;
    ls.push(0.2126*buf[i*4]+0.7152*buf[i*4+1]+0.0722*buf[i*4+2]);
    sr+=buf[i*4]; sg+=buf[i*4+1]; sb+=buf[i*4+2];
  }
  let m=0; for(const x of ls) m+=x; m/=(ls.length||1);
  let v=0; for(const x of ls) v+=(x-m)*(x-m);
  const sd=Math.sqrt(v/(ls.length||1));
  const srt=ls.slice().sort((a,b)=>a-b);
  const nn=ls.length||1;
  return { 화소:ls.length, 평균:+m.toFixed(2), 표준편차:+sd.toFixed(3),
           평균색:[+(sr/nn).toFixed(1), +(sg/nn).toFixed(1), +(sb/nn).toFixed(1)],
           푸른끼:+((sb/nn)/Math.max(1,sr/nn)).toFixed(3),
           최소:+(srt[0]??0).toFixed(1), 최대:+(srt[srt.length-1]??0).toFixed(1),
           하위5:+(srt[Math.floor(srt.length*0.05)]??0).toFixed(1),
           상위95:+(srt[Math.floor(srt.length*0.95)]??0).toFixed(1) };
}

const 결과={};
for (const s of SUN) {
  u.uSunAzRad.value = s.az*Math.PI/180;
  결과[s.key] = {};
  for (const [k, glow] of [['그대로',1], ['바닥끔',0]]) {
    if (u.GROUND_MIN_GLOW) u.GROUND_MIN_GLOW.value = glow;
    결과[s.key][k] = shoot(s.key+' · '+k);
  }
  if (u.GROUND_MIN_GLOW) u.GROUND_MIN_GLOW.value = 1;
}
if(u.GROUND_MIN_GLOW) u.GROUND_MIN_GLOW.value=1;

// ── 진단: 항을 하나씩 지워 어디서 뭉개지는지 봅니다 ─────────────────────────
scene.add(field.mesh);
u.uSunAzRad.value = SUN[1].az*Math.PI/180;   // 측광 — 입체감이 가장 큰 자리
결과.진단={};
const diag=(label, f)=>{ f(); 결과.진단[label]=shoot('진단 '+label); };
diag('그대로', ()=>{ u.uSurfaceIrr.value.set(IRR[0],IRR[1],IRR[2]); u.uSunRadiance.value.set(SUNR[0],SUNR[1],SUNR[2]); });
diag('하늘몫 0 (직달만)', ()=>{ u.uSurfaceIrr.value.set(0,0,0); u.uSunRadiance.value.set(SUNR[0],SUNR[1],SUNR[2]); });
diag('직달 0 (하늘몫만)', ()=>{ u.uSurfaceIrr.value.set(IRR[0],IRR[1],IRR[2]); u.uSunRadiance.value.set(0,0,0); });
diag('직달만 · 노출 1/8', ()=>{ u.uExposure.value=0.125; });
// ⚠ 결정적 진단: 해를 **지평선에 수평으로** 두면 ndl = max(0, n.x) 이라
//   화면이 곧 법선의 x 성분입니다. 경사가 30° 면 0.5 까지, 평평하면 0.
u.uExposure.value=1;
// ── 새벽 (해 1°) — 실기 넷째 사진의 자리 ────────────────────────────────────
u.uSunAltRad.value=1*Math.PI/180; u.uSunAltDeg.value=1;
u.uSunAzRad.value=SUN[1].az*Math.PI/180;
diag('새벽 · 바닥 그대로', ()=>{ u.uSurfaceIrr.value.set(DAWN_IRR[0],DAWN_IRR[1],DAWN_IRR[2]);
  u.uSunRadiance.value.set(DAWN_SUN[0],DAWN_SUN[1],DAWN_SUN[2]);
  if(u.GROUND_MIN_GLOW) u.GROUND_MIN_GLOW.value=1; });
diag('새벽 · 바닥끔', ()=>{ if(u.GROUND_MIN_GLOW) u.GROUND_MIN_GLOW.value=0; });
if(u.GROUND_MIN_GLOW) u.GROUND_MIN_GLOW.value=1;
u.uSunAltRad.value=SUN_ALT*Math.PI/180; u.uSunAltDeg.value=SUN_ALT;
u.uSurfaceIrr.value.set(IRR[0],IRR[1],IRR[2]); u.uSunRadiance.value.set(SUNR[0],SUNR[1],SUNR[2]);

// ── 결정적 실험: 직달 눈금 하나만 바꾼 A/B ────────────────────────────
//
// 직달(directBeamRGB)이 돌려주는 것은 투과율이라 태양 상수가 빠져 있었고,
// 그래서 수평면 직달이 확산의 0.14배였습니다 (맑은 하늘은 3.7배).
// SOLAR_BEAM_SCALE 이 그 눈금을 채웁니다. 두 벌의 차이는 그 상수 하나뿐이고,
// 노출은 각자 **평평한 지면의 밝기를 지키도록** 따라옵니다 — 평균을 같은
// 자리에 두고 모양만 견주기 위해서입니다 (예전에 이 짝을 안 맞췄더니 평균
// 226 이 톤 곡선 어깨에서 뭉개져 시험이 통째로 무효였습니다).
u.uSunAltRad.value=SUN_ALT*Math.PI/180; u.uSunAltDeg.value=SUN_ALT;
u.uSunAzRad.value=SUN[1].az*Math.PI/180;
diag('옛 눈금 (S=1)', ()=>{ u.uSurfaceIrr.value.set(OLD_IRR[0],OLD_IRR[1],OLD_IRR[2]);
  u.uSunRadiance.value.set(OLD_SUN[0],OLD_SUN[1],OLD_SUN[2]); u.uExposure.value=1; });
diag('물리 눈금 (S=26)', ()=>{ u.uSurfaceIrr.value.set(IRR[0],IRR[1],IRR[2]);
  u.uSunRadiance.value.set(SUNR[0],SUNR[1],SUNR[2]); u.uExposure.value=EXPO; });
u.uExposure.value=EXPO;

diag('수평 해 (=n.x)', ()=>{ u.uSurfaceIrr.value.set(0,0,0);
  u.uSunRadiance.value.set(SUNR[0],SUNR[1],SUNR[2]);
  u.uSunAltRad.value=0; u.uSunAltDeg.value=0; u.uSunAzRad.value=Math.PI/2;
  if(u.GROUND_MIN_GLOW) u.GROUND_MIN_GLOW.value=0; });
// 같은 조건에서 법선 유한차분 간격만 바꿔 봅니다 (셰이더는 e = max(8, d·0.03)).
u.uSunAltRad.value=SUN_ALT*Math.PI/180; u.uSunAltDeg.value=SUN_ALT;
u.uExposure.value=EXPO; if(u.GROUND_MIN_GLOW) u.GROUND_MIN_GLOW.value=1;
u.uSurfaceIrr.value.set(IRR[0],IRR[1],IRR[2]); u.uSunRadiance.value.set(SUNR[0],SUNR[1],SUNR[2]);
scene.remove(field.mesh);

// ⚠ 대조: 평평한 땅(DEM 없음)에서는 천공률이 정확히 1 이어야 합니다.
scene.remove(field.mesh);
const flat=createTerrainField({patch:null, observerElevM:0, eyeHeightM:EYE});
scene.add(flat.mesh); updateTerrainFieldEye(flat, cam);
{ const fu=flat.material.uniforms;
  fu.uSurfaceIrr.value.set(IRR[0],IRR[1],IRR[2]); fu.uSunRadiance.value.set(SUNR[0],SUNR[1],SUNR[2]);
  fu.uAerial.value=0; fu.uSunAltDeg.value=SUN_ALT; fu.uSunAltRad.value=SUN_ALT*Math.PI/180;
  fu.uSunAzRad.value=SUN[0].az*Math.PI/180;
  결과.평판={ 그대로: shoot('평판') };
}

document.getElementById('out').innerHTML='<p>'+JSON.stringify(결과)+'</p>';
window.__stats={ glError: renderer.getContext().getError(), 결과 };
window.__errors=errors;
document.title='DONE::'+(errors.length?'ERR':'OK')+'::'+renderer.getContext().getError();
</script></body></html>`;

  fs.mkdirSync(PREVIEW, { recursive: true });
  fs.writeFileSync(path.join(PREVIEW, 'relief.html'), html);
  console.log('생성 완료: relief.html');
})();
