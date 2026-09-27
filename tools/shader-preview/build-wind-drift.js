/**
 * **층별 바람 이류**를 검증합니다 — `CloudSlab.ts` 의 `layerWinds` / `driftHours`.
 *
 * 무엇을 재는가:
 *  1. 무풍이면 시간이 흘러도 그림이 **한 픽셀도** 안 바뀌는가.
 *  2. `uWindLow/Mid/High` 가 정말 **그 층에만** 걸리는가 (교차 누출 0).
 *     ⚠ §109 부터 상층 **모양**은 시어(상층풍 − 중층풍)를 따릅니다 — 중층풍이 상층 줄무늬 길이를
 *     바꾸는 건 설계입니다. 그래서 "안 샌다" 는 **흐름**(같은 바람에서 시간만 흘렸을 때의 차)으로
 *     재고, 모양 차(바람 없음 대비)는 따로 둡니다(§117.5).
 *  3. 이동량이 풍속에 **비례**하는가 (1 : 2 : 4).
 *  4. 이동 **방향**이 맞는가 — 서풍(방위 270°)이면 구름이 동쪽으로 흘러야
 *     하고, 북쪽을 볼 때 동쪽은 화면 오른쪽입니다.
 *
 * ⚠ 운량장을 **균일하게** 굽습니다. 슬랩은 이류를 잔무늬 좌표에만 걸고
 * 운량장은 그대로 두므로(이중 계산 방지), 운량장에 무늬가 있으면 그림이
 * 강체 평행이동이 아니게 되어 이동량 측정이 흐려집니다. 균일하게 두면
 * 보이는 구조가 전부 잔무늬라 정확히 평행이동합니다.
 *
 * 준비: node tools/shader-preview/stage-esm.js
 * 사용: node tools/shader-preview/build-wind-drift.js
 */
const fs = require('fs');
const path = require('path');
const { PREVIEW } = require('./paths');

const TW = 420, TH = 420;
const FOV_DEG = 30;          // 좁게 봐야 중앙 가로줄의 거리가 거의 일정합니다
const VIEW_AZ = 0, VIEW_ELEV = 8;
const SUN_ALT = 22, SUN_AZ = 105;

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
<h3>층별 바람 이류 — 북쪽을 봅니다. 서풍(270°)이므로 구름은 오른쪽(동)으로 흘러야 합니다</h3>
<p class="sub">운량장은 균일(0.5)입니다 — 보이는 무늬는 전부 슬랩의 잔무늬라 이류가 강체 평행이동으로 나타납니다.</p>
<canvas id="c"></canvas><div id="labels"></div></div>
<script type="module">
import * as THREE from './app/vendor/three.module.js';
import { createCloudSlab, updateCloudSlab, bakeCloudSlabCoverage }
  from './app/components/SkyScene3D/CloudSlab.js';
import { makeAtmosphereParams, beamAtAltitude } from './app/utils/atmosphere.js';

const errors = [];
const oe = console.error;
console.error = (...a) => { errors.push(a.join(' ')); oe(...a); };

const TW=${TW}, TH=${TH}, FOV_DEG=${FOV_DEG};
const VIEW_AZ=${VIEW_AZ}, VIEW_ELEV=${VIEW_ELEV}, SUN_ALT=${SUN_ALT}, SUN_AZ=${SUN_AZ};

const canvas = document.getElementById('c');
canvas.width = TW*4; canvas.height = TH;
const ctx2d = canvas.getContext('2d');
const glCanvas = document.createElement('canvas');
glCanvas.width = TW; glCanvas.height = TH;
const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias:false, alpha:false });
renderer.setPixelRatio(1); renderer.setSize(TW, TH, false);

const atmosphere = makeAtmosphereParams({
  latitude: 37.5, observerElevM: 30, dayOfYear: 240,
  humidityPct: 55, visibilityM: 30000,
});

const scene = new THREE.Scene();
const slab = createCloudSlab();
scene.add(slab.mesh);

const cam = new THREE.PerspectiveCamera(FOV_DEG, TW/TH, 0.1, 2000);
cam.position.set(0,0,0); cam.up.set(0,1,0);
{
  const ar=VIEW_AZ*Math.PI/180, er=VIEW_ELEV*Math.PI/180;
  cam.lookAt(100*Math.cos(er)*Math.sin(ar), 100*Math.sin(er), -100*Math.cos(er)*Math.cos(ar));
  cam.updateMatrixWorld(true);
}
const gl = renderer.getContext();
const labels = document.getElementById('labels');

/** 균일 운량장. only 를 주면 그 층에만 구름을 둡니다 (층 분리용). */
function bakeUniform(only){
  bakeCloudSlabCoverage(slab, () => ({
    low:  (!only || only==='low')  ? 0.5 : 0,
    mid:  (!only || only==='mid')  ? 0.5 : 0,
    high: (!only || only==='high') ? 0.5 : 0,
    confidence: 1,
  }));
}

const W = (kmh, deg) => ({ speedKmh: kmh, bearingDeg: deg });
const NOWIND = { low: W(0,0), mid: W(0,0), high: W(0,0) };

function shoot(layerWinds, driftHours){
  const a=SUN_ALT*Math.PI/180, z=SUN_AZ*Math.PI/180;
  const sunDir=new THREE.Vector3(Math.cos(a)*Math.sin(z), Math.sin(a), -Math.cos(a)*Math.cos(z)).normalize();
  updateCloudSlab(slab, {
    camera: cam, widthPx: TW, heightPx: TH,
    sunDir, sunAltDeg: SUN_ALT, sunAzDeg: SUN_AZ,
    beamFor: (altKm) => beamAtAltitude(SUN_ALT, altKm, atmosphere),
    atmosphere, layerWinds, driftHours, visible: true,
  });
  renderer.setRenderTarget(null);
  renderer.setClearColor(0x101822, 1);
  renderer.render(scene, cam);
  const buf=new Uint8Array(4*TW*TH);
  gl.readPixels(0,0,TW,TH,gl.RGBA,gl.UNSIGNED_BYTE,buf);
  return buf;
}
function paint(buf,x){
  const img=ctx2d.createImageData(TW,TH);
  for(let y=0;y<TH;y++){ const s=(TH-1-y)*TW*4, d=y*TW*4;
    for(let i=0;i<TW*4;i++) img.data[d+i]=buf[s+i]; }
  ctx2d.putImageData(img,x,0);
}
const lum=(b,p)=>0.2126*b[p*4]+0.7152*b[p*4+1]+0.0722*b[p*4+2];

/** 두 그림의 평균 절대 휘도차. 0 이면 완전히 같은 그림입니다. */
function meanDiff(a,b){
  let s=0; for(let p=0;p<TW*TH;p++) s+=Math.abs(lum(a,p)-lum(b,p));
  return +(s/(TW*TH)).toFixed(3);
}

/**
 * 가로 평행이동량(px)을 SSD 최소점으로 추정합니다.
 *
 * 중앙 가로띠만 씁니다 — 세로로 벗어날수록 그 방향의 지상 거리가 달라져
 * 이동량이 달라지므로, 한 가지 이동량으로 설명되는 좁은 띠에서 잽니다.
 * 정수 최소점 주변 3점 포물선으로 소수점까지 좁힙니다.
 */
function shiftX(base, moved, maxS, Y0, Y1){
  const y0=Y0 ?? Math.floor(TH/2)-40, y1=Y1 ?? Math.floor(TH/2)+40;
  const x0=maxS+6, x1=TW-maxS-6;
  const cost=[];
  for(let s=-maxS; s<=maxS; s++){
    let sum=0, n=0;
    for(let y=y0;y<y1;y++) for(let x=x0;x<x1;x+=2){
      const d=lum(base,y*TW+x)-lum(moved,y*TW+x+s);
      sum+=d*d; n++;
    }
    cost.push(sum/n);
  }
  let bi=0; for(let i=1;i<cost.length;i++) if(cost[i]<cost[bi]) bi=i;
  let sub=bi;
  if(bi>0 && bi<cost.length-1){
    const a=cost[bi-1], b=cost[bi], c=cost[bi+1];
    const den=a-2*b+c;
    if(Math.abs(den)>1e-9) sub = bi + 0.5*(a-c)/den;
  }
  return +(sub-maxS).toFixed(2);
}

const 결과 = {};

// ── 1. 무풍이면 시간이 흘러도 그대로 ────────────────────────────────────
bakeUniform(null);
const base = shoot(NOWIND, 0);
결과.무풍_1시간_차이 = meanDiff(base, shoot(NOWIND, 1.0));

// ── 2. 층 분리 — 한 층에만 바람을 걸고, 층별로 구운 운량장에서 잽니다 ──
// 대각선(같은 층)은 커야 하고, 대각선 밖(다른 층)은 0이어야 합니다.
const LAYERS = ['low','mid','high'];
const 교차 = {}, 흐름 = {};
for (const 운량층 of LAYERS){
  bakeUniform(운량층);
  const b = shoot(NOWIND, 0);
  for (const 바람층 of LAYERS){
    const w = { ...NOWIND, [바람층]: W(40, 270) };
    const k = 운량층 + '운량_' + 바람층 + '풍', moved = shoot(w, 0.05);
    교차[k] = meanDiff(b, moved);                 // 바람 없음 대비 — 흐름 + 모양
    흐름[k] = meanDiff(shoot(w, 0), moved);       // 같은 바람, 시간만 — 흐름만
  }
}
결과.층교차 = 교차;
결과.층흐름 = 흐름;

// ── 3·4. 속도 비례와 방향 부호 — 하층만 남기고 하층풍만 바꿉니다 ────────
bakeUniform('low');
const lowBase = shoot(NOWIND, 0);
const DH = 0.03;
const 이동 = {};
for (const kmh of [10, 20, 40]){
  이동['서풍' + kmh] = shiftX(lowBase, shoot({ ...NOWIND, low: W(kmh, 270) }, DH), 140);
}
이동['동풍20'] = shiftX(lowBase, shoot({ ...NOWIND, low: W(20, 90) }, DH), 140);
결과.이동px = 이동;
결과.속도비 = {
  '20대10': +(이동.서풍20 / (이동.서풍10 || 1e-9)).toFixed(3),
  '40대10': +(이동.서풍40 / (이동.서풍10 || 1e-9)).toFixed(3),
};
// §117.5 — 위 가로띠(80줄) 안에서도 이동량이 행마다 1.6배 달라(시선 고도 8°·세로 화각 30° 의 원근),
// 한 값으로 뭉치면 대비가 센 행 쪽으로 끌립니다(§104 조명 뒤 40km/h 가 88 → 110px). 그 띠 안의
// 좁은 두 띠(20줄)에서 따로 잽니다 — 띠 안 이동량 차가 몇 %라 거의 강체 평행이동입니다.
{
  const shots = { 10: null, 20: null, 40: null };
  for (const kmh of [10, 20, 40]) shots[kmh] = shoot({ ...NOWIND, low: W(kmh, 270) }, DH);
  const 띠 = {};
  for (const [y0, y1] of [[Math.floor(TH/2)-30, Math.floor(TH/2)-10], [Math.floor(TH/2)+10, Math.floor(TH/2)+30]]) {
    const m = {}; for (const kmh of [10, 20, 40]) m[kmh] = shiftX(lowBase, shots[kmh], 140, y0, y1);
    띠['행' + y0 + '-' + y1] = { px: [m[10], m[20], m[40]],
      '20대10': +(m[20] / (m[10] || 1e-9)).toFixed(3), '40대10': +(m[40] / (m[10] || 1e-9)).toFixed(3) };
  }
  결과.좁은띠속도비 = 띠;
}

// ── 눈으로 볼 네 칸 ─────────────────────────────────────────────────────
// 실측다운 비율(1 : 1.7 : 3.4)로 세 층을 함께 흘려 봅니다.
bakeUniform(null);
const REAL = { low: W(18,270), mid: W(31,270), high: W(62,270) };
const p1 = shoot(NOWIND, 0);
const p2 = shoot(REAL, 0.05);
const p3 = shoot(REAL, 0.10);
// 차이를 4배 키워 어디가 움직였는지 보이게 합니다.
const p4 = new Uint8Array(4*TW*TH);
for(let p=0;p<TW*TH;p++){
  const d=Math.min(255, Math.abs(lum(p1,p)-lum(p3,p))*4);
  p4[p*4]=d; p4[p*4+1]=d; p4[p*4+2]=d; p4[p*4+3]=255;
}
[p1,p2,p3,p4].forEach((b,i)=>paint(b,i*TW));
const 캡션=['이류 0','0.05시간 뒤','0.10시간 뒤','|0 − 0.10| ×4'];
캡션.forEach((t,i)=>{
  const d=document.createElement('div');
  d.className='lbl'; d.style.left=(i*TW+16)+'px'; d.style.top='58px';
  d.innerHTML=t;
  labels.appendChild(d);
});

window.__stats = { glError: gl.getError(), 결과 };
window.__errors = errors;
document.title = 'DONE::' + (errors.length ? 'SHADER_ERR' : 'OK') + '::' + gl.getError();
</script></body></html>`;

fs.mkdirSync(PREVIEW, { recursive: true });
fs.writeFileSync(path.join(PREVIEW, 'wind-drift.html'), html);
console.log('생성 완료: wind-drift.html');
