/**
 * **전 세계 무작위 지점·날짜·시각의 실제 예보를 그대로 그려서, 화면이 그
 * 예보를 말하고 있는지 잽니다.**
 *
 * > "무작위로 전세계 지역과 날짜, 시간을 찍어서 시뮬레이션을 돌린 뒤에
 * >  실제 해당 지역의 상세일기예보 결과와 비교해보면 어떨까"
 *
 * ⚠ **이 자는 "충실도" 를 잽니다 — "정확도" 가 아닙니다.**
 * 예보와 화면이 맞는지 보는 것이지, 예보가 하늘과 맞는지 보는 게 아닙니다.
 * 예보 자체의 치우침은 §56·§71 에서 따로 쟀습니다. 섞으면 둘 다 못 잽니다.
 *
 * 표본은 `fixtures/world-forecast.json` 에 굳혀 둡니다 — 판정이 네트워크
 * 없이 재현돼야 회귀 자로 쓸 수 있습니다. 새로 뽑으려면:
 *   node tools/weather-truth/sample-world.js 48 <씨앗>
 *
 * ## 재는 것 둘
 *
 * 1. **운량 → 화면 면적.** 층 하나씩 따로 그려 τ≥0.16 면적을 냅니다.
 *    층을 겹쳐 그리면 어느 층이 화면을 채웠는지 못 가립니다.
 *    ⚠ 2026-10-02: 면적은 **하늘 평균**(방위 4 × 흐름 시각 4, 고도 40° 그대로)으로도 냅니다(`면적평균`).
 *    시야 하나(방위 200° · 흐름 0시)는 모양장의 느린 항(군집·굵은 폴백, 수십 km)이 한두 칸만 보여
 *    그 자리 운을 탑니다 — `verify-layer-elev` 를 하늘 평균으로 옮긴 것과 같은 이유입니다. 무늬 크기(2)는
 *    시야 하나 그대로 잽니다.
 * 2. **예보 고도 → 화면 무늬 크기.** 같은 운량이라도 층이 높으면 같은
 *    km 크기의 셀이 **더 큰 각**을 차지합니다. 가로 자기상관이 0.5 로
 *    떨어지는 지연(화소)을 무늬 크기로 씁니다.
 *
 * ⚠ `dataOut: 2` 를 씁니다 — R 채널이 `min(tauAcc,40)/40` 이라 **조명과
 * 무관**합니다. 밝기 차로 재면 구름 색이 하늘 색과 비슷할 때 놓칩니다
 * (`build-layer-elev.js` 머리말).
 *
 * ⚠ 하늘돔을 장면에 안 넣습니다 — 구름 없는 화소는 슬랩 알파가 0 이라
 * 뒤가 비쳐 **하늘의 빨강을 τ 로 읽습니다.**
 *
 * 준비: node tools/shader-preview/stage-esm.js
 * 사용: node tools/shader-preview/build-world-fidelity.js
 *       node tools/shader-preview/verify-world-fidelity.js
 */
const fs = require('fs');
const path = require('path');
const { PREVIEW } = require('./paths');

const FIX = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'world-forecast.json'), 'utf8'));
const TW = 220, TH = 220;
const FOV_DEG = 60;
const ELEV = 40;            // 시선 고도 — 층이 다 보이는 중간 높이
const SUN_ALT = 25, SUN_AZ = 200;

const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>준비중</title><style>
 body{margin:0;background:#0b0f15;font-family:sans-serif;color:#dde}
 #wrap{padding:12px} h3{font-size:13px;margin:6px 0}
 canvas{border:1px solid #345;margin:1px} .cap{font:10px monospace;color:#9ab}
</style></head><body>
<div id="wrap"><h3>전 세계 무작위 예보 → 화면</h3>
<div id="shots"></div><div id="out"></div></div>
<script type="module">
import * as THREE from './app/vendor/three.module.js';
import { createSkydome, updateSkydome } from './app/components/SkyScene3D/Skydome.js';
import { createCloudSlab, updateCloudSlab, bakeCloudSlabCoverage }
  from './app/components/SkyScene3D/CloudSlab.js';
import { WeatherFan } from './app/utils/skyColumn.js';
import { makeAtmosphereParams, beamAtAltitude } from './app/utils/atmosphere.js';
import { extractProfile, layerAltitudes } from './app/utils/cloudProfile.js';

// ⚠ 페이지에서 예외가 나면 제목을 못 세워 판정이 5분을 기다리다 죽습니다.
const errors = [];
window.addEventListener('error', e => errors.push(String(e.message)));

const TW=${TW}, TH=${TH}, FOV_DEG=${FOV_DEG}, ELEV=${ELEV};
const SUN_ALT=${SUN_ALT}, SUN_AZ=${SUN_AZ};
const SAMPLES = ${JSON.stringify(FIX.samples)};

const glCanvas = document.createElement('canvas');
glCanvas.width = TW; glCanvas.height = TH;
const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias:false, alpha:false });
renderer.setPixelRatio(1); renderer.setSize(TW, TH, false);
const gl = renderer.getContext();
const scene = new THREE.Scene();
const skydome = createSkydome();      // 장면에 **안** 넣습니다(위 머리말).

function bake(slab, v){
  const OFFSETS=[-20,-10,0,10,20], DISTS=[10,30,70,130,200,280,380];
  const pt=(d,off)=>({ distance:d, azimuthOffset:off, low:v.low, mid:v.mid, high:v.high,
                       humidity:65, precipitation:0, visibility:25000 });
  const pts=[pt(0,0)];
  for (const off of OFFSETS) for (const d of DISTS) pts.push(pt(d,off));
  const fan = new WeatherFan(pts, SUN_AZ);
  bakeCloudSlabCoverage(slab, (azDeg, distKm) => {
    const { data } = fan.sample(azDeg, distKm);
    if (!data) return { low:0, mid:0, high:0, confidence:1 };
    return { low:data.low/100, mid:data.mid/100, high:data.high/100, confidence:1 };
  });
}

function shoot(slab, atm, viewAz=SUN_AZ, driftH=0){
  const cam = new THREE.PerspectiveCamera(FOV_DEG, TW/TH, 0.1, 2000);
  cam.position.set(0,0,0); cam.up.set(0,1,0);
  const ar=viewAz*Math.PI/180, er=ELEV*Math.PI/180;
  cam.lookAt(100*Math.cos(er)*Math.sin(ar), 100*Math.sin(er), -100*Math.cos(er)*Math.cos(ar));
  cam.updateMatrixWorld(true);
  const a=SUN_ALT*Math.PI/180, z=SUN_AZ*Math.PI/180;
  const sunDir=new THREE.Vector3(Math.cos(a)*Math.sin(z), Math.sin(a), -Math.cos(a)*Math.cos(z)).normalize();
  updateSkydome(skydome, SUN_ALT, SUN_AZ, atm);
  updateCloudSlab(slab, {
    camera: cam, widthPx: TW, heightPx: TH,
    sunDir, sunAltDeg: SUN_ALT, sunAzDeg: SUN_AZ,
    beamFor:(altKm)=>beamAtAltitude(SUN_ALT, altKm, atm),
    atmosphere: atm,
    layerWinds:{ low:{speedKmh:30,bearingDeg:250}, mid:{speedKmh:51,bearingDeg:250},
                 high:{speedKmh:102,bearingDeg:250} },
    driftHours:driftH, visible:true, dataOut:2,
  });
  renderer.setRenderTarget(null);
  renderer.setClearColor(0x000000,1);
  renderer.render(scene, cam);
  const buf=new Uint8Array(4*TW*TH);
  gl.readPixels(0,0,TW,TH,gl.RGBA,gl.UNSIGNED_BYTE,buf);
  return buf;
}

/** τ = R/255×40. 면적과 평균. */
function tauStat(buf){
  const n=TW*TH; let s=0,a016=0,a1=0,mx=0;
  for(let i=0;i<n;i++){ const t=(buf[i*4]/255)*40; s+=t; if(t>mx)mx=t;
    if(t>=0.16)a016++; if(t>=1)a1++; }
  return { 면적:+(a016/n).toFixed(4), 면적τ1:+(a1/n).toFixed(4),
           평균τ:+(s/n).toFixed(3), 최대τ:+mx.toFixed(2) };
}

/**
 * 가로 자기상관이 0.5 로 떨어지는 지연(화소) — **무늬의 각 크기**입니다.
 * 층이 높을수록 같은 km 셀이 큰 각을 차지하므로 이 값이 커져야 합니다.
 */
function corrLen(buf){
  const rows=[];
  for(let y=Math.floor(TH*0.25); y<Math.floor(TH*0.75); y+=3){
    const r=[]; for(let x=0;x<TW;x++) r.push(buf[(y*TW+x)*4]/255);
    rows.push(r);
  }
  const MAXLAG=Math.floor(TW/3);
  const acc=new Array(MAXLAG+1).fill(0); let used=0;
  for(const r of rows){
    const m=r.reduce((a,b)=>a+b,0)/r.length;
    const d=r.map(v=>v-m);
    const c0=d.reduce((a,b)=>a+b*b,0)/d.length;
    if(c0<1e-6) continue;               // 평평한 줄은 무늬가 없습니다
    used++;
    for(let L=0;L<=MAXLAG;L++){
      let s=0; for(let i=0;i+L<d.length;i++) s+=d[i]*d[i+L];
      acc[L]+=(s/(d.length-L))/c0;
    }
  }
  if(!used) return null;
  for(let L=1;L<=MAXLAG;L++){ if(acc[L]/used<0.5) return L; }
  return MAXLAG;
}

function paint(buf,label){
  const c=document.createElement('canvas'); c.width=TW; c.height=TH;
  c.style.width='84px'; c.style.height='84px';
  const cx=c.getContext('2d'); const img=cx.createImageData(TW,TH);
  for(let y=0;y<TH;y++){ const s=(TH-1-y)*TW*4, d=y*TW*4;
    for(let i=0;i<TW*4;i++) img.data[d+i]=buf[s+i]; }
  cx.putImageData(img,0,0);
  const t=document.createElement('span'); t.className='cap'; t.textContent=label+' ';
  document.getElementById('shots').appendChild(t);
  document.getElementById('shots').appendChild(c);
}

try {
  const out=[];
  for (const S of SAMPLES){
    const atm = makeAtmosphereParams({
      latitude: S.lat, observerElevM: Math.max(0, S.elevationM|0),
      dayOfYear: Math.round((Date.parse(S.time+'Z') - Date.UTC(new Date(S.time+'Z').getUTCFullYear(),0,0))/86400000),
      humidityPct: 65, visibilityM: 25000,
    });
    // 예보 단면 → 층 높이. **앱이 쓰는 그 함수 그대로** 씁니다.
    const alt = layerAltitudes(extractProfile(S.profile, 0));

    const slab = createCloudSlab();
    // ⚠ 메시를 장면에 넣어야 합니다. 빠뜨리고 돌렸더니 48표본이 전부 면적 0
    //   으로 나왔고 — 운량 100% 까지 0 이라 바로 들켰습니다.
    slab.mesh.renderOrder = 10; scene.add(slab.mesh);
    slab.setLayerAltitudesKm(alt.lowKm, alt.midKm, alt.highKm);

    const rec = { lat:S.lat, lon:S.lon, time:S.time,
                  예보:{ total:S.total, low:S.low, mid:S.mid, high:S.high },
                  고도:{ low:+alt.lowKm.toFixed(2), mid:+alt.midKm.toFixed(2), high:+alt.highKm.toFixed(2),
                        lowFrom:alt.lowFromProfile, midFrom:alt.midFromProfile, highFrom:alt.highFromProfile },
                  층:{} };

    for (const L of ['low','mid','high']){
      const v={low:0,mid:0,high:0}; v[L]=S[L];
      bake(slab, v);
      const buf=shoot(slab, atm);
      // 하늘 평균 면적(위 머리말 1): 방위 4 × 흐름 시각 4. 고도 40° 시야는 땅이 안 들어옵니다.
      let avg=0, nv=0;
      for (const az of [20,110,200,290]) for (const dh of [0,6,12,18]) { avg+=tauStat(shoot(slab, atm, az, dh)).면적; nv++; }
      rec.층[L]={ 운량:S[L], ...tauStat(buf), 면적평균:+(avg/nv).toFixed(4), 무늬:corrLen(buf) };
    }

    // 운량 0 대조 — 전부 0 이어야 합니다(자가 검증).
    bake(slab,{low:0,mid:0,high:0});
    const z=shoot(slab,atm);
    rec.영대조=tauStat(z);
    if (out.length<6) paint(z, '0');

    // ── ⚠ **대조** — "높은 층이 무늬가 크다" 는 층마다 셰이더 상수가 달라서일
    //    수도 있습니다. 그러면 setLayerAltitudesKm 가 아무 일도 안 해도 통과합니다.
    //    **같은 층·같은 운량**에서 고도만 바꿔 화면이 실제로 반응하는지 봅니다.
    if (rec.고도.highFrom && S.high >= 20 && S.high <= 85) {
      const v={low:0,mid:0,high:S.high};
      const at = km => { slab.setLayerAltitudesKm(alt.lowKm, alt.midKm, km);
                         bake(slab, v); const b=shoot(slab, atm);
                         return { ...tauStat(b), 무늬:corrLen(b) }; };
      rec.고도대조 = { 낮게8: at(8), 같게: at(alt.highKm), 높게14: at(14),
                     원래고도:+alt.highKm.toFixed(2) };
      // 되돌립니다.
      slab.setLayerAltitudesKm(alt.lowKm, alt.midKm, alt.highKm);
    }

    out.push(rec);
    scene.remove(slab.mesh); slab.dispose?.();
  }

  document.getElementById('out').textContent=JSON.stringify(
    { glError: gl.getError(), errors, rows: out }, null, 1);
  document.title = 'done';
} catch (e) {
  document.getElementById('out').textContent = JSON.stringify({ fatal: String(e && e.stack || e), errors });
  document.title = 'done';
}
</script></body></html>`;

fs.writeFileSync(path.join(PREVIEW, 'world-fidelity.html'), html);
console.log('world-fidelity.html 를 썼습니다');
