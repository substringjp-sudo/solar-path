/**
 * **천정으로 빨려드는 왜곡을 재고, 원인을 가른다.**
 *
 * 실기 보고: "다시 하늘 정중앙에 모여드는 왜곡이 생겼어" (고도각 +85° 화면).
 *
 * ## 왜 아무도 못 잡았나
 *
 * `verify-cloud-slab.js` 머리말에는 "천정에 구멍도 첨점도 없다"고 적혀
 * 있는데, 정작 그것을 재는 단언이 **하나도 없습니다.** 옛 껍질 덱의
 * (방위, 고도) 극좌표 격자가 없어졌다는 뜻으로 적어 둔 문장이 판정 없이
 * 남아, 전혀 다른 기전으로 같은 증상이 돌아온 것을 통과시켰습니다.
 *
 * ## 자 — 방사 정렬
 *
 * 천정을 정면으로 올려다보면 천정이 화면 한가운데입니다. 그 점을 중심으로
 * 극좌표를 세우고, 화소마다 밝기 기울기를 반경 방향(r)과 접선 방향(φ)으로
 * 나눕니다.
 *
 *     방사정렬 = mean|∇I·φ̂| / mean|∇I·r̂|
 *
 * 무늬의 등고선이 **반경 방향으로 뻗으면**(=중심에서 뻗어 나가는 살) 기울기는
 * 접선 쪽이 커지므로 이 값이 1보다 큽니다. 등방이면 1 언저리입니다.
 *
 * ⚠ **바람에 눕는 평행 줄무늬는 이 자에 안 걸립니다.** 평행 줄은 중심 기준
 * 어느 쪽에서는 반경, 90° 돌면 접선이라 고리를 한 바퀴 돌며 상쇄됩니다.
 * 그래서 이 자는 "무늬에 방향이 있다"가 아니라 **"중심을 향해 조직됐다"**
 * 만 집어냅니다 — 재려는 것이 바로 그것입니다.
 *
 * ## 자가 스스로를 속이지 않는가
 *
 * 같은 화면에서 **가짜 중심**(천정에서 비켜난 점)으로도 잽니다. 진짜
 * 천정에서만 값이 뛰고 가짜 중심은 1 언저리여야, 이 자가 아무 무늬에나
 * 반응하는 것이 아니라 진짜 방사 조직을 본 것입니다.
 *
 * ## 원인 후보 둘을 하나씩 끕니다
 *
 *  (A) `slab_coverUv` 의 sqrt 반경 사상. `r = sqrt(d/range)` 는 d=0 에서
 *      미분이 무한대라, 운량 텍스처(128²)가 천정에서 방사로 터집니다.
 *      안쪽 텍셀 한 칸이 지상 22m 밖에 안 됩니다.
 *  (B) 상층 권운 특징 크기. 셀 9km 에 바람축 배율 0.28 이라 바람 방향
 *      특징이 32km 인데, 고도각 45° 위 하늘 전체의 지상 반경이 11km 뿐
 *      입니다 — 위쪽 하늘 전부가 특징 하나의 1/3 이라 한 덩어리
 *      그라데이션이 됩니다.
 *  (D) **LOD 봉투.** `billowAmt = det * (1 - smoothstep(0.4, 2.0,
 *      length(km)/cellKm))` 은 지상거리 = 층높이·cot(고도각) 이므로
 *      **고도각만의 함수**입니다. 곧 천정을 정확히 중심으로 한 회전대칭
 *      진폭 봉투이고, 위쪽 하늘 45°를 가로질러 상층 1.00→0.58,
 *      중층 1.00→0.62, 저층 1.00→0.88 로 떨어집니다. 무늬의 **성질**이
 *      반경에 따라 변하니 눈에는 과녁으로 읽힙니다. `slant` 도 같은
 *      성질이지만(1.00→1.41) 그쪽은 판을 비껴 보는 실제 광학이라
 *      물리적으로 옳습니다 — (D) 가 겨냥하는 것은 봉투가 아니라
 *      **물리 근거 없는 봉투**입니다.
 *
 * ## 잰 것 — 부챗살이 아니라 **과녁**이었습니다
 *
 * 처음 자(방사정렬 = 접선기울기/반경기울기)로는 아무것도 안 잡혔습니다 —
 * 모든 경우가 1 언저리였습니다. 그 자는 **고리와 부챗살을 못 가릅니다**:
 * 등고선이 반경으로 뻗어도 접선으로 감겨도 비가 1 에서 벗어나기 때문입니다.
 * 그래서 화면을 반경대 8 × 방위구획 24 로 잘라 다시 쟀습니다.
 *
 *     동심원비 = (반경대끼리 평균 차이) / (한 반경대 안 방위끼리 차이)
 *
 * | 경우 | 천정 | 가짜중심 | 반경σ | 방위σ |
 * |---|---|---|---|---|
 * | **구름 없음** (자의 바닥) | 0.534 | 0.218 | 8.90 | 16.66 |
 * | 앱 그대로 | **1.589** | 0.319 | 23.75 | 14.95 |
 * | 운량장 균일 | 1.159 | 0.133 | 17.99 | 15.52 |
 * | 상층 50% | 1.155 | 0.277 | 23.53 | 20.37 |
 *
 * ⚠ **구름 없는 대조가 이 자를 살렸습니다.** 천정을 정면으로 보면 하늘돔
 * 자신의 고도각 밝기 기울기가 화면 정중앙 중심의 완벽한 회전대칭이라,
 * 가짜 중심 대조만으로는 못 거릅니다 — 그 기울기는 **진짜로** 천정
 * 중심이니까요. 바닥이 0.534 이고 구름이 들어가면 반경σ 가 8.9 → 23.8 로
 * 2.7배 뛰는데 방위σ 는 오히려 줍니다. 과녁이 맞습니다.
 *
 * ## 그 과녁의 정체 — 천정에 뚫린 맨하늘 구멍
 *
 * 반경대별 평균 밝기 ('앱 그대로', 안쪽 → 바깥쪽):
 *
 *     구름 없음  120.7  121.8  124.2  127.7  131.9  136.7  141.7  146.5
 *     앱 그대로  120.7  121.8  126.5  149.7  166.3  175.6  174.2  178.8
 *
 * 안쪽 두 대가 **구름 없는 하늘과 소수점까지 같습니다.** 천정 둘레에는
 * 구름이 아예 없고, 바로 바깥에서 밝기가 튀어 테두리를 만듭니다. 실기에서
 * "정중앙에 모여든다"고 읽힌 것의 정체가 이 구멍과 그 테두리입니다.
 *
 * ## 대조로 죽인 후보들 — 세 개
 *
 *  - **(A) 죽음.** 운량장을 **완전히 균일**하게 줘도 1.159 (가짜 0.133) 이
 *    남습니다. 예보 자료에도, 운량 텍스처의 sqrt 사상에도 원인이 없습니다.
 *  - **(C) 죽음.** 신뢰도를 1 로 못 박은 경우가 원본과 **비트 단위로 동일**
 *    합니다 (1.155 / 반경σ 23.531 둘 다 일치).
 *  - **(D) 죽음.** billowAmt 는 고도각만의 함수라 회전대칭 봉투이고 층별
 *    낙폭(상 0.58 · 중 0.62 · 저 0.88) 순서가 측정된 고리 세기 순서(상 1.16
 *    > 중 0.91 > 저 0.53)와 맞아 유력해 보였습니다. 그래서 셰이더에서
 *    billowAmt = 1.0 으로 못 박고 다시 쟀는데 **1.589 → 1.615**, 안 움직
 *    입니다. 순서가 맞은 것은 우연이었습니다. 스테이징 사본에 대조가 실제로
 *    들어갔는지 확인한 뒤의 값입니다.
 *
 * ## 아직 안 죽인 후보 (B) — 지상 좌표 붕괴
 *
 * 지상거리 d = 층높이·cot(고도각) 이라 천정에서 0 으로 모입니다. 운량·모양·
 * 빌로우가 **전부** 지상 좌표의 함수이므로 천정 캡 전체가 사실상 한 값을
 * 나눠 씁니다. 그 값이 백분위 문턱을 넘느냐로 캡이 통째로 구름이거나 통째로
 * 맨하늘이 됩니다. 남은 유일한 후보지만 **아직 녹아웃 대조를 못 걸었습니다.**
 *
 * ⚠ 관련해서 따로 나온 사실: **저층은 위쪽 하늘에서 통째로 안 그려집니다.**
 * 운량 50% 에서 저층만 켠 화면이 8개 반경대 **전부** 구름 없는 하늘과
 * 동일합니다(고도각 49° 위). driftHours 로 장을 최대 308km 평행이동해도
 * (이동 3·6·9·14) 안 깨어납니다 — 곧 잡음 한 값의 동전 던지기가 아니라
 * 계통적입니다. 운량 90% 면 나타납니다(첫 대 138.0 대 맨하늘 120.7).
 * 중층은 50% 에서 정중앙까지 닿는 유일한 층입니다(122.7).
 *
 * 준비: node tools/shader-preview/stage-esm.js
 * 사용: node tools/shader-preview/build-zenith-pinch.js
 *
 * ⚠ 준비를 빠뜨리면 앱을 고쳐도 수치가 안 움직입니다 (paths.js 가 경고합니다).
 */
const fs = require('fs');
const path = require('path');
const { PREVIEW } = require('./paths');

const TW = 420, TH = 420;
// 세로 화각 90° — 화면 반높이가 천정에서 45° 입니다. 위쪽 하늘 전체가 들어옵니다.
const FOV_DEG = 90;
const SUN_ALT = 30, SUN_AZ = 262;

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
 body{margin:0;background:#0b0f15;font-family:sans-serif;color:#dde}
 #wrap{position:relative;padding:12px;width:${TW * 3 + 24}px}
 h3{font-size:13px;margin:6px 0}
 .sub{font-size:11px;color:#8aa;margin:0 0 8px}
 canvas{border:1px solid #345;margin:2px}
 .cap{font:10px monospace;color:#9ab;margin:0 0 6px}
</style></head><body>
<div id="wrap">
<h3>천정 수렴 — 천정을 정면으로 올려다본 화면 (중심이 곧 천정)</h3>
<p class="sub">방사정렬 = 접선 기울기 / 반경 기울기. 중심을 향해 조직될수록 1보다 큽니다.</p>
<div id="shots"></div><div id="out"></div></div>
<script type="module">
import * as THREE from './app/vendor/three.module.js';
import { createSkydome, updateSkydome } from './app/components/SkyScene3D/Skydome.js';
import { createCloudSlab, updateCloudSlab, bakeCloudSlabCoverage }
  from './app/components/SkyScene3D/CloudSlab.js';
import { WeatherFan, PLACEHOLDER_LAYER_WINDS } from './app/utils/skyColumn.js';
import { makeAtmosphereParams, beamAtAltitude } from './app/utils/atmosphere.js';

const errors = [];
const oe = console.error;
console.error = (...a) => { errors.push(a.join(' ')); oe(...a); };
window.addEventListener('error', e => errors.push(String(e.message)));

const TW=${TW}, TH=${TH}, FOV_DEG=${FOV_DEG};
const SUN_ALT=${SUN_ALT}, SUN_AZ=${SUN_AZ};

const glCanvas = document.createElement('canvas');
glCanvas.width = TW; glCanvas.height = TH;
const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias:false, alpha:false });
renderer.setPixelRatio(1); renderer.setSize(TW, TH, false);
const gl = renderer.getContext();

const atmosphere = makeAtmosphereParams({
  latitude: 37.5, observerElevM: 30, dayOfYear: 240,
  humidityPct: 62, visibilityM: 24000,
});

const scene = new THREE.Scene();
const skydome = createSkydome();
scene.add(skydome.mesh);

// ── 합성 예보 (build-cloud-slab.js 와 같은 자료) ────────────────────────
function h21(x,y){ const s=Math.sin(x*127.1+y*311.7)*43758.5453; return s-Math.floor(s); }
function vn(x,y){
  const ix=Math.floor(x), iy=Math.floor(y);
  let fx=x-ix, fy=y-iy; fx=fx*fx*(3-2*fx); fy=fy*fy*(3-2*fy);
  const a=h21(ix,iy), b=h21(ix+1,iy), c=h21(ix,iy+1), d=h21(ix+1,iy+1);
  const t=a+(b-a)*fx; return t + ((c+(d-c)*fx)-t)*fy;
}
function fbmJS(x,y,o){ let s=0,a=0.5,n=0; for(let i=0;i<o;i++){ s+=a*vn(x,y); n+=a; x=x*2.03+7.1; y=y*2.03+3.7; a*=0.5; } return s/n; }
const SC={low:26,mid:42,high:72}, OFF={low:0,mid:51.3,high:97.7};

/**
 * 층별 운량장을 굽습니다.
 *
 * ⚠ 평균 0 은 **정말 0** 이어야 합니다. 처음엔 MEAN + (fbm-0.5)*2.4 를
 *   클램프만 했는데, MEAN=0 이어도 fbm>0.5 인 절반이 양수로 남아 "그 층만"
 *   경우가 층 분리를 전혀 못 했습니다 — '구름 없음' 과 '저층만' 이 완전히
 *   같은 수치를 내서 알아챘습니다.
 */
function bake(slab, MEAN, mode, flatConf){
  const truth=(L,x,z)=>{
    if (MEAN[L] <= 0) return 0;
    if (mode === 'uniform') return MEAN[L];
    // 지상 좌표의 **줄무늬** — 파장 40km. 천정 둘레 몇 km 안에서는 거의
    // 상수여야 맞습니다. 거기서 부챗살이 뜨면 그건 자료가 아니라 사상의
    // 흠입니다 (증폭 대조).
    if (mode === 'stripe') return Math.max(0, Math.min(1,
      MEAN[L] + 0.45*Math.sin(2*Math.PI*(x*Math.cos(0.6)+z*Math.sin(0.6))/40)));
    return Math.max(0,Math.min(1, MEAN[L] + (fbmJS(x/SC[L]+OFF[L], z/SC[L]+OFF[L],4)-0.5)*2.4));
  };
  // ⚠ **앱의 진짜 팬을 씁니다** (weather.ts: angles ±20°, distances 10~380km).
  //   처음엔 -180~180 을 30° 간격으로 깔았는데, 그러면 신뢰도가 하늘 전체에서
  //   1 이라 **팬 가장자리 쐐기가 아예 안 생깁니다** — 천정 수렴이 재현될 리가
  //   없었습니다. 신뢰도는 방위에만 달려 거리가 0 으로 가도 안 눕고, 그래서
  //   천정에서 한 점으로 모입니다. 그 쐐기가 이 결함의 후보 (C) 입니다.
  const OFFSETS=[-20,-10,0,10,20];
  const DISTS=[10,30,70,130,200,280,380];
  const pts=[{ distance:0, azimuthOffset:0, low:truth('low',0,0)*100, mid:truth('mid',0,0)*100,
               high:truth('high',0,0)*100, humidity:62, precipitation:0, visibility:24000 }];
  for (const off of OFFSETS) for (const d of DISTS){
    const a=(SUN_AZ+off)*Math.PI/180, x=d*Math.sin(a), z=-d*Math.cos(a);
    pts.push({ distance:d, azimuthOffset:off, low:truth('low',x,z)*100,
               mid:truth('mid',x,z)*100, high:truth('high',x,z)*100,
               humidity:62, precipitation:0 });
  }
  const fan = new WeatherFan(pts, SUN_AZ);
  bakeCloudSlabCoverage(slab, (azDeg, distKm) => {
    const { data, confidence } = fan.sample(azDeg, distKm);
    if (!data) return { low:0, mid:0, high:0, confidence:0 };
    return { low:data.low/100, mid:data.mid/100, high:data.high/100,
             // flatConf 는 후보 (C) 를 끄는 대조입니다 — 신뢰도만 1 로 못 박습니다.
             confidence: flatConf ? 1 : Math.max(0, Math.min(1, confidence)) };
  });
}

// ── 천정을 정면으로 ─────────────────────────────────────────────────────
// 위를 똑바로 보므로 up 을 북(-z)으로 둡니다 — (0,1,0) 이면 축퇴합니다.
const cam = new THREE.PerspectiveCamera(FOV_DEG, TW/TH, 0.1, 2000);
cam.position.set(0,0,0);
cam.up.set(0,0,-1);
cam.lookAt(0, 100, 0);
cam.updateMatrixWorld(true);

function shoot(slab, driftH){
  const a=SUN_ALT*Math.PI/180, z=SUN_AZ*Math.PI/180;
  const sunDir=new THREE.Vector3(Math.cos(a)*Math.sin(z), Math.sin(a), -Math.cos(a)*Math.cos(z)).normalize();
  updateSkydome(skydome, SUN_ALT, SUN_AZ, atmosphere);
  updateCloudSlab(slab, {
    camera: cam, widthPx: TW, heightPx: TH,
    sunDir, sunAltDeg: SUN_ALT, sunAzDeg: SUN_AZ,
    beamFor: (altKm) => beamAtAltitude(SUN_ALT, altKm, atmosphere),
    atmosphere,
    layerWinds: PLACEHOLDER_LAYER_WINDS, driftHours: driftH || 0,
    visible: true,
  });
  renderer.setRenderTarget(null);
  renderer.setClearColor(0x000000, 1);
  renderer.render(scene, cam);
  const buf=new Uint8Array(4*TW*TH);
  gl.readPixels(0,0,TW,TH,gl.RGBA,gl.UNSIGNED_BYTE,buf);
  return buf;
}

const lum=(b,p)=>0.2126*b[p*4]+0.7152*b[p*4+1]+0.0722*b[p*4+2];

/**
 * 중심 (cx,cy) 기준 방사정렬. 반경 [r0,r1) 화소만 씁니다.
 *
 * 기울기를 반경·접선으로 나눠 절댓값 평균의 비를 냅니다. 등방이면 1,
 * 중심에서 뻗는 살이면 1보다 큽니다.
 */
function radialAlign(buf, cx, cy, r0, r1){
  let st=0, sr=0, n=0;
  for(let y=1;y<TH-1;y++) for(let x=1;x<TW-1;x++){
    const dx=x-cx, dy=y-cy;
    const r=Math.hypot(dx,dy);
    if (r<r0 || r>=r1) continue;
    const i=y*TW+x;
    const gx=lum(buf,i+1)-lum(buf,i-1);
    const gy=lum(buf,i+TW)-lum(buf,i-TW);
    const ur=dx/r, uy=dy/r;
    sr += Math.abs(gx*ur + gy*uy);       // 반경 성분
    st += Math.abs(-gx*uy + gy*ur);      // 접선 성분
    n++;
  }
  if (n<50) return null;
  return { 방사정렬:+(st/Math.max(1e-6,sr)).toFixed(3), 표본:n };
}

/**
 * **고리인가 부챗살인가.** 위의 방사정렬은 둘을 못 가릅니다 — 등고선이
 * 반경으로 뻗어도(살), 접선으로 감겨도(고리) 비가 1 에서 벗어납니다.
 * 실기 화면은 "모여든다"이니 어느 쪽인지 알아야 원인을 고릅니다.
 *
 * 화면을 반경대 × 방위구획으로 잘라 구획 평균 밝기를 냅니다.
 *
 *     동심원비 = (반경대끼리의 평균 차이) / (한 반경대 안 방위끼리의 차이)
 *
 * 완전한 과녁이면 방위 차이가 0 이라 크게 뜨고, 완전한 부챗살이면 반경대
 * 평균이 다 같아 0 으로 갑니다. 얼룩덜룩한 등방이면 1 언저리입니다.
 */
function ringVsSpoke(buf, cx, cy, rMax){
  const NB = 8, NA = 24;
  const sum = [], cnt = [];
  for (let i = 0; i < NB * NA; i++) { sum.push(0); cnt.push(0); }
  for (let y = 0; y < TH; y++) for (let x = 0; x < TW; x++){
    const dx = x - cx, dy = y - cy, r = Math.hypot(dx, dy);
    // 안쪽 8% 는 뺍니다 — 화소가 너무 적어 잡음만 큽니다.
    if (r < rMax * 0.08 || r >= rMax) continue;
    const bi = Math.min(NB - 1, Math.floor((r / rMax) * NB));
    let a = Math.atan2(dy, dx); if (a < 0) a += 2 * Math.PI;
    const ai = Math.min(NA - 1, Math.floor(a / (2 * Math.PI) * NA));
    const k = bi * NA + ai;
    sum[k] += lum(buf, y * TW + x); cnt[k]++;
  }
  const mean = (v) => v.reduce((a,b)=>a+b,0) / Math.max(1, v.length);
  const sd = (v) => { const m = mean(v); return Math.sqrt(mean(v.map(z=>(z-m)*(z-m)))); };
  const 대평균 = [], 방위편차 = [];
  for (let b = 0; b < NB; b++){
    const cells = [];
    for (let a = 0; a < NA; a++){ const k = b*NA+a; if (cnt[k] > 20) cells.push(sum[k]/cnt[k]); }
    if (cells.length < NA * 0.7) continue;
    대평균.push(mean(cells)); 방위편차.push(sd(cells));
  }
  if (대평균.length < 4) return { 동심원비:null, 반경편차:null, 방위편차:null };
  const rv = sd(대평균), av = mean(방위편차);
  return { 동심원비:+(rv/Math.max(1e-4,av)).toFixed(3),
           반경편차:+rv.toFixed(3), 방위편차:+av.toFixed(3),
           // 반경대별로 펼칩니다. 지상 좌표가 천정에서 한 점으로 모이면
           // **안쪽 대의 방위편차가 바닥**이고 바깥으로 갈수록 커집니다 —
           // 곧 "가운데는 밋밋하고 가장자리만 북적인다"가 수치로 나옵니다.
           대별방위: 방위편차.map(v => +v.toFixed(2)),
           대별평균: 대평균.map(v => +v.toFixed(1)) };
}

/** 반경대별로 훑습니다. 천정 코앞일수록 심할 것으로 예상합니다. */
function profile(buf, cx, cy){
  const half = TH/2;
  const bands = [[0.03,0.10],[0.10,0.20],[0.20,0.35],[0.35,0.55],[0.55,0.80]];
  return bands.map(([a,b]) => {
    const g = radialAlign(buf, cx, cy, a*half, b*half);
    return { 대: a.toFixed(2)+'~'+b.toFixed(2), ...(g||{방사정렬:null,표본:0}) };
  });
}

function paint(buf, label){
  const c=document.createElement('canvas'); c.width=TW; c.height=TH;
  c.style.width='260px'; c.style.height='260px';
  const cx=c.getContext('2d');
  const img=cx.createImageData(TW,TH);
  for(let y=0;y<TH;y++){ const s=(TH-1-y)*TW*4, d=y*TW*4;
    for(let i=0;i<TW*4;i++) img.data[d+i]=buf[s+i]; }
  cx.putImageData(img,0,0);
  const t=document.createElement('div'); t.className='cap'; t.textContent=label;
  document.getElementById('shots').appendChild(t);
  document.getElementById('shots').appendChild(c);
}

// ── 경우들 ──────────────────────────────────────────────────────────────
//
// 층을 하나씩만 켜서 어느 층이 수렴을 만드는지 가릅니다. 운량장 균일은
// 후보 (A) 를 끄는 대조입니다 — 운량 텍스처에 방위 구조가 없으면 sqrt
// 사상이 터뜨릴 것도 없습니다.
//
// ⚠ **운량을 실기 캡처값으로 맞춥니다** (저 12% 중 22% 상 14%). 처음엔
//   저 28 중 42 상 30 으로 돌렸는데 하늘이 구름으로 꽉 차 수렴이 통째로
//   가려졌습니다 — 자가 전부 1 언저리를 내서 "결함이 없다"로 읽힐 뻔했습니다.
//   사용자가 보낸 화면도 상층운 6~21% 의 **맑은 하늘**입니다.
const CASES = [
  // ⚠⚠ **가장 중요한 대조 — 구름이 아예 없는 하늘.** 천정을 정면으로 보면
  //   하늘돔 자신의 고도각 밝기 기울기가 화면 정중앙을 중심으로 한 완벽한
  //   회전대칭입니다. 가짜 중심 대조로는 이걸 못 걸러냅니다 — 그 기울기는
  //   **진짜로** 천정 중심이니까요. 이 경우의 값이 곧 자의 바닥이고,
  //   구름 경우가 그 바닥을 못 넘으면 이 자는 구름에 대해 아무 말도
  //   하지 않는 것입니다.
  { key:'구름 없음',      mean:{low:0.00,mid:0.00,high:0.00}, mode:'uniform' },
  { key:'앱 그대로',      mean:{low:0.12,mid:0.22,high:0.14}, mode:'fbm' },
  { key:'상층만',        mean:{low:0.00,mid:0.00,high:0.14}, mode:'fbm' },
  { key:'중층만',        mean:{low:0.00,mid:0.22,high:0.00}, mode:'fbm' },
  { key:'저층만',        mean:{low:0.12,mid:0.00,high:0.00}, mode:'fbm' },
  { key:'운량장 균일',    mean:{low:0.12,mid:0.22,high:0.14}, mode:'uniform' },
  // ⚠ 증폭 대조 — 지상 줄무늬(파장 40km) 운량장. 천정 둘레 몇 km 안에서는
  //   거의 상수라 부챗살이 뜰 이유가 없습니다. 뜨면 사상의 흠입니다.
  { key:'운량장 줄무늬',  mean:{low:0.12,mid:0.22,high:0.14}, mode:'stripe' },
  // ⚠ **천정에 구름이 있어야 잽니다.** 운량 12~22% 로는 천정 모양장이
  //   상수라 백분위 문턱을 못 넘어 천정 둘레가 통째로 맑습니다 — 자가
  //   하늘돔만 재서 모든 경우가 1.009 로 똑같이 나왔습니다.
  { key:'상층 50%',      mean:{low:0.00,mid:0.00,high:0.50}, mode:'fbm' },
  // ⚠ **후보 (C) 대조.** 위와 모든 것이 같고 신뢰도만 1 로 못 박습니다.
  //   신뢰도는 거리와 무관하게 방위로만 갈리므로(측정: d=0.05km 와 100km 가
  //   동일), 천정에서 한 점이 360개 값을 갖습니다. 여기서만 값이 떨어지면
  //   그 모순이 곧 부챗살입니다.
  { key:'상층 50%·신뢰도1', mean:{low:0.00,mid:0.00,high:0.50}, mode:'fbm', flatConf:true },
  // ⚠ **후보 (D) 를 가르는 짝.** billowAmt 는 고도각만의 함수라 천정을
  //   정확히 중심으로 한 회전대칭 봉투입니다. 위쪽 하늘 45°를 가로질러
  //   저층 1.00→0.88, 중층 1.00→0.62, 상층 1.00→0.58 로 떨어집니다.
  //   그러니 (D) 가 맞다면 **고리 세기가 상층 ≳ 중층 ≫ 저층** 이어야
  //   합니다. 순서가 다르면 (D) 는 아닙니다.
  { key:'중층 50%',      mean:{low:0.00,mid:0.50,high:0.00}, mode:'fbm' },
  { key:'저층 50%',      mean:{low:0.50,mid:0.00,high:0.00}, mode:'fbm' },
  // ⚠ **기전을 못 박는 대조 — 장을 평행이동합니다.**
  //   천정에서 지상거리 d = 층높이·cot(고도각) 이 0 으로 모이므로 모양장
  //   좌표 p 도 한 점으로 모입니다. 곧 천정 둘레 전체가 **잡음 한 값**을
  //   나눠 씁니다. 그 한 값이 백분위 문턱을 넘으면 캡 전체가 구름, 못 넘으면
  //   캡 전체가 맨하늘 — 동전 던지기입니다.
  //   driftHours 는 kmN = km + wind·t 라 순수 평행이동이므로, 이 값만
  //   바꾸면 **다른 조건은 하나도 안 건드리고** 그 동전을 다시 던집니다.
  //   캡이 맑음↔흐림으로 뒤집히면 기전이 확정됩니다.
  { key:'저층 50%·이동3', mean:{low:0.50,mid:0.00,high:0.00}, mode:'fbm', drift:3 },
  { key:'저층 50%·이동6', mean:{low:0.50,mid:0.00,high:0.00}, mode:'fbm', drift:6 },
  { key:'저층 50%·이동9', mean:{low:0.50,mid:0.00,high:0.00}, mode:'fbm', drift:9 },
  { key:'저층 50%·이동14', mean:{low:0.50,mid:0.00,high:0.00}, mode:'fbm', drift:14 },
  // ⚠ 이동 대조가 저층을 하나도 못 깨웠습니다. 그러면 "잡음 한 값의 동전
  //   던지기"가 아니라 **계통적으로** 안 그려지는 것입니다. 운량을 끝까지
  //   올려 봅니다 — 0.9 에서도 맨하늘이면 문턱 문제가 아닙니다.
  { key:'저층 90%',      mean:{low:0.90,mid:0.00,high:0.00}, mode:'uniform' },
  { key:'중층 90%',      mean:{low:0.00,mid:0.90,high:0.00}, mode:'uniform' },
  { key:'상층 90%',      mean:{low:0.00,mid:0.00,high:0.90}, mode:'uniform' },
];

const 결과={};
for (const c of CASES){
  const slab = createCloudSlab();
  slab.mesh.renderOrder = 10;
  scene.add(slab.mesh);
  bake(slab, c.mean, c.mode, c.flatConf);
  const buf = shoot(slab, c.drift);
  paint(buf, c.key);
  결과[c.key] = {
    천정: profile(buf, TW/2, TH/2),
    // ⚠ 가짜 중심 — 자가 아무 무늬에나 반응하지 않는지 봅니다.
    가짜중심: profile(buf, TW/2 + TW*0.28, TH/2 - TH*0.22),
    천정고리: ringVsSpoke(buf, TW/2, TH/2, TH*0.46),
    가짜고리: ringVsSpoke(buf, TW/2 + TW*0.28, TH/2 - TH*0.22, TH*0.46),
  };
  scene.remove(slab.mesh);
  slab.dispose?.();
}

document.getElementById('out').innerHTML='<p>'+JSON.stringify(결과)+'</p>';
window.__stats={ glError: gl.getError(), 결과 };
window.__errors=errors;
document.title='DONE::'+(errors.length?'ERR':'OK')+'::'+gl.getError();
</script></body></html>`;

fs.writeFileSync(path.join(PREVIEW, 'zenith-pinch.html'), html);
console.log('생성 완료: zenith-pinch.html');
