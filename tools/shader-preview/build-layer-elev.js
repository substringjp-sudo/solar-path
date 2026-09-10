/**
 * **시선 고도에 따라 층별 구름 면적이 어떻게 변하는가.**
 *
 * 실기 보고: "하늘이 구름으로 가득 찼는데 너무 텅빈 구름만 있어."
 * 51절에서 잰 값이 이렇습니다 (균일 운량 50%):
 *
 *   저층  고도30 0.522 → 고도85 0.578   (안 줄어듦)
 *   중층  고도30 0.776 → 고도85 0.336   (반토막)
 *   상층  고도30 0.499 → 고도85 0.250   (반토막)
 *
 * 위를 볼수록 중·상층이 빕니다. 이 판은 **왜 그런지**를 가릅니다.
 *
 * ## 의심 항 넷 — 전부 고도각에 달렸습니다
 *
 *  - `slant` = (윗면 교점거리 − 밑면 교점거리)/두께. 천정에서 1, 지평선
 *    쪽으로 갈수록 커집니다. 광학두께가 이만큼 곱해지므로 위를 보면 가장
 *    얇습니다. **층마다 tauK 가 달라(저 15 · 중 8 · 상 2.8) 얇아졌을 때
 *    문턱을 못 넘는 정도가 다릅니다** — 저층은 이미 깊어 꿈쩍 안 하고
 *    상층은 바로 사라집니다.
 *  - `det` = 1 − smoothstep(0.45, 2.0, 발자국/셀). 지평선 쪽에서 잔무늬를
 *    끕니다. 위에서는 1 이라 이쪽이 원인이면 방향이 반대여야 합니다.
 *  - `billowAmt` = det·(1 − smoothstep(0.4, 2.0, |km|/셀)). 천정에서 1.
 *  - **모양장 좌표 붕괴** — 지상거리 = 층높이·cot(고도각) 이라 천정에서
 *    0 으로 모입니다. 화면 전체가 좁은 지상 구역을 나눠 쓰므로 모양장의
 *    **화면상 퍼짐**이 줄고, 백분위 문턱(`P(q > 1-cover) = cover`)이 전제한
 *    분포가 무너집니다. 층높이가 클수록(상층 10km) 같은 고도각에서 지상
 *    거리가 크므로 이 항은 **상층에 유리**해야 합니다 — 측정과 반대입니다.
 *
 * ## 자 — **밝기 차가 아니라 광학두께**
 *
 * ⚠ 처음에는 51절과 같은 자(구름 없는 화면과의 밝기 차)를 썼는데 **못
 * 씁니다.** 태양 고도·방위만 바꿔 같은 것을 재니 중층 고도30 이 0.776 에서
 * 0.216 으로 나왔습니다. 그 자는 "구름이 있나"가 아니라 **"하늘과 밝기 차가
 * 나나"** 를 재고 있었습니다 — 구름 색이 하늘 색과 비슷하면 있어도 안
 * 세어집니다. 51절의 고도 표는 그래서 믿을 수 없습니다.
 *
 * 셰이더에 조명과 무관한 출구가 이미 있습니다(43절): `dataOut: 2` 로 두면
 * R 채널이 **시선 광학두께** `min(tauAcc, 40)/40` 입니다. 그걸 직접 읽습니다.
 *
 *     τ = R/255 × 40        (8비트라 눈금은 0.157)
 *     면적(문턱τ) = τ ≥ 문턱 인 화소 비율
 *
 * 운량 0 이면 τ 가 전부 0 이어야 합니다 — 자가 검증입니다.
 *
 * ⚠ 운량장은 **균일**입니다. 얼룩을 넣으면 화면마다 국소 운량이 달라져
 * "고도만 바뀌었는데 면적이 변했다"를 못 말합니다.
 *
 * 준비: node tools/shader-preview/stage-esm.js
 * 사용: node tools/shader-preview/build-layer-elev.js
 *       node tools/shader-preview/verify-layer-elev.js
 */
const fs = require('fs');
const path = require('path');
const { PREVIEW } = require('./paths');

const TW = 260, TH = 340;
const FOV_DEG = 60;
const SUN_ALT = 30, SUN_AZ = 200;
const ELEVS = [15, 30, 45, 60, 75, 85];
const COVER = 0.50;

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
 body{margin:0;background:#0b0f15;font-family:sans-serif;color:#dde}
 #wrap{padding:12px} h3{font-size:13px;margin:6px 0}
 canvas{border:1px solid #345;margin:2px} .cap{font:10px monospace;color:#9ab}
</style></head><body>
<div id="wrap"><h3>시선 고도 × 층별 구름 면적 (균일 운량 50%)</h3>
<div id="shots"></div><div id="out"></div></div>
<script type="module">
import * as THREE from './app/vendor/three.module.js';
import { createSkydome, updateSkydome } from './app/components/SkyScene3D/Skydome.js';
import { createCloudSlab, updateCloudSlab, bakeCloudSlabCoverage }
  from './app/components/SkyScene3D/CloudSlab.js';
import { WeatherFan } from './app/utils/skyColumn.js';
import { makeAtmosphereParams, beamAtAltitude } from './app/utils/atmosphere.js';

const errors = [];
window.addEventListener('error', e => errors.push(String(e.message)));

const TW=${TW}, TH=${TH}, FOV_DEG=${FOV_DEG};
const SUN_ALT=${SUN_ALT}, SUN_AZ=${SUN_AZ};
const ELEVS=${JSON.stringify(ELEVS)}, COVER=${COVER};

const glCanvas = document.createElement('canvas');
glCanvas.width = TW; glCanvas.height = TH;
const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias:false, alpha:false });
renderer.setPixelRatio(1); renderer.setSize(TW, TH, false);
const gl = renderer.getContext();

const atmosphere = makeAtmosphereParams({
  latitude: 37.5, observerElevM: 30, dayOfYear: 250,
  humidityPct: 65, visibilityM: 25000,
});
const scene = new THREE.Scene();
const skydome = createSkydome();
// ⚠ **하늘돔을 장면에 안 넣습니다.** 자료 출구(dataOut 2)는 슬랩의 R 채널에
//   광학두께를 씁니다. 그런데 구름이 없는 화소는 슬랩의 알파가 0 이라 뒤가
//   비치고, 하늘돔이 거기 있으면 **하늘의 빨강을 τ 로 읽습니다.** 처음에
//   그래서 운량 0 대조가 τ 34 를 냈습니다(자가 검증이 잡아 줬습니다).
//   하늘돔은 updateSkydome 을 부르기 위해 만들어만 둡니다.
const SHOW_SKY = false;
if (SHOW_SKY) scene.add(skydome.mesh);

function bake(slab, layer, cover){
  const OFFSETS=[-20,-10,0,10,20], DISTS=[10,30,70,130,200,280,380];
  const v={ low:0, mid:0, high:0 }; v[layer] = cover*100;
  const pt=(d,off)=>({ distance:d, azimuthOffset:off, low:v.low, mid:v.mid, high:v.high,
                       humidity:65, precipitation:0, visibility:25000 });
  const pts=[pt(0,0)];
  for (const off of OFFSETS) for (const d of DISTS) pts.push(pt(d,off));
  const fan = new WeatherFan(pts, SUN_AZ);
  bakeCloudSlabCoverage(slab, (azDeg, distKm) => {
    const { data } = fan.sample(azDeg, distKm);
    if (!data) return { low:0, mid:0, high:0, confidence:1 };
    // 신뢰도는 1 — 팬 쐐기가 면적을 갉으면 고도 효과와 섞입니다.
    return { low:data.low/100, mid:data.mid/100, high:data.high/100, confidence:1 };
  });
}

function shoot(slab, elev){
  const cam = new THREE.PerspectiveCamera(FOV_DEG, TW/TH, 0.1, 2000);
  cam.position.set(0,0,0);
  if (elev > 75) cam.up.set(0,0,-1); else cam.up.set(0,1,0);
  const ar=SUN_AZ*Math.PI/180, er=elev*Math.PI/180;
  cam.lookAt(100*Math.cos(er)*Math.sin(ar), 100*Math.sin(er), -100*Math.cos(er)*Math.cos(ar));
  cam.updateMatrixWorld(true);
  const a=SUN_ALT*Math.PI/180, z=SUN_AZ*Math.PI/180;
  const sunDir=new THREE.Vector3(Math.cos(a)*Math.sin(z), Math.sin(a), -Math.cos(a)*Math.cos(z)).normalize();
  updateSkydome(skydome, SUN_ALT, SUN_AZ, atmosphere);
  const w={ speedKmh:30, bearingDeg:250 };
  updateCloudSlab(slab, {
    camera: cam, widthPx: TW, heightPx: TH,
    sunDir, sunAltDeg: SUN_ALT, sunAzDeg: SUN_AZ,
    beamFor:(altKm)=>beamAtAltitude(SUN_ALT, altKm, atmosphere),
    atmosphere,
    layerWinds:{ low:w, mid:{speedKmh:51,bearingDeg:250}, high:{speedKmh:102,bearingDeg:250} },
    driftHours:0, visible:true,
    // 43절 자료 출구 — R = min(tauAcc,40)/40. 조명과 무관합니다.
    dataOut: 2,
  });
  renderer.setRenderTarget(null);
  renderer.setClearColor(0x000000, 1);
  renderer.render(scene, cam);
  const buf=new Uint8Array(4*TW*TH);
  gl.readPixels(0,0,TW,TH,gl.RGBA,gl.UNSIGNED_BYTE,buf);
  return buf;
}

/** R 채널 = min(tauAcc,40)/40. τ 로 되돌려 문턱별 면적과 평균을 냅니다. */
function tauStat(buf){
  const n = TW*TH;
  let s=0, a016=0, a1=0, a3=0, mx=0;
  for(let i=0;i<n;i++){
    const tau = (buf[i*4] / 255) * 40;
    s += tau; if (tau > mx) mx = tau;
    if (tau >= 0.16) a016++;
    if (tau >= 1.0) a1++;
    if (tau >= 3.0) a3++;
  }
  return { 평균τ:+(s/n).toFixed(3), 최대τ:+mx.toFixed(2),
           면적τ016:+(a016/n).toFixed(4), 면적τ1:+(a1/n).toFixed(4), 면적τ3:+(a3/n).toFixed(4) };
}

function paint(buf, label){
  const c=document.createElement('canvas'); c.width=TW; c.height=TH;
  c.style.width='110px'; c.style.height='144px';
  const cx=c.getContext('2d'); const img=cx.createImageData(TW,TH);
  for(let y=0;y<TH;y++){ const s=(TH-1-y)*TW*4, d=y*TW*4;
    for(let i=0;i<TW*4;i++) img.data[d+i]=buf[s+i]; }
  cx.putImageData(img,0,0);
  const t=document.createElement('span'); t.className='cap'; t.textContent=label+' ';
  document.getElementById('shots').appendChild(t);
  document.getElementById('shots').appendChild(c);
}

const 결과={};
for (const layer of ['low','mid','high']){
  결과[layer]={};
  for (const elev of ELEVS){
    // ⚠ 운량 0 대조 — τ 가 전부 0 이어야 합니다. 자가 스스로를 검증합니다.
    { const s0=createCloudSlab(); s0.mesh.renderOrder=10; scene.add(s0.mesh);
      bake(s0, layer, 0);
      결과[layer]['고도'+elev+'_운량0'] = tauStat(shoot(s0, elev));
      scene.remove(s0.mesh); s0.dispose?.(); }
    const slab=createCloudSlab(); slab.mesh.renderOrder=10; scene.add(slab.mesh);
    bake(slab, layer, COVER);
    const buf = shoot(slab, elev);
    if (elev === 30 || elev === 85) paint(buf, layer+' '+elev+'°');
    결과[layer]['고도'+elev] = tauStat(buf);
    scene.remove(slab.mesh); slab.dispose?.();
  }
}

// ── 운량 → 면적 사상 (고도 45° 고정) ──────────────────────────────────
//
// 41절의 백분위 문턱은 **"문턱이 곧 면적"** 을 약속합니다 —
// P(q > 1-cover) = cover 가 항등식이므로 예보 50% 면 화면 50% 여야 합니다.
// 위 표에서 중층이 운량 50% 인데 면적 0.12~0.27 밖에 안 나와 그 약속을
// 의심하게 됐습니다. 여기서 곧장 확인합니다.
//
// ⚠ 앞의 밝기 차 자로는 이걸 못 봤습니다 — 그 자는 조명에 흔들려 같은
//   경우가 0.776 과 0.216 을 오갔습니다. τ 자는 조명과 무관합니다.
const 사상={};
for (const layer of ['low','mid','high']){
  사상[layer]={};
  for (const cov of [0.10, 0.25, 0.50, 0.75, 0.90]){
    const slab=createCloudSlab(); slab.mesh.renderOrder=10; scene.add(slab.mesh);
    bake(slab, layer, cov);
    사상[layer]['운량'+Math.round(cov*100)] = tauStat(shoot(slab, 45));
    scene.remove(slab.mesh); slab.dispose?.();
  }
}

document.getElementById('out').innerHTML='<p>'+JSON.stringify(결과)+'</p>';
window.__stats={ glError: gl.getError(), 결과, 사상 };
window.__errors=errors;
document.title='DONE::'+(errors.length?'ERR':'OK')+'::'+gl.getError();
</script></body></html>`;

fs.writeFileSync(path.join(PREVIEW, 'layer-elev.html'), html);
console.log('생성 완료: layer-elev.html');
