/**
 * **층마다 무늬 방향이 얼마나 다른가 — 그리고 그 방향이 바람을 따르는가.**
 *
 * 실기 보고: "낮은 층의 구름 방향이랑 높은 층의 구름 방향이 너무 눈에 띄게
 * 차이가 나. 현실은 이정도는 아니었거든."
 *
 * ## 코드를 읽으면 층마다 방향 단서의 성격이 아예 다릅니다
 *
 * `CloudSlab.ts: slab_layer_thickness` 에서
 *
 *  - 상층(권운) — 지상 좌표를 **바람 축으로 회전**한 뒤 축마다 다른 배율
 *    (바람 0.28 · 가로 1.6). 종횡비 5.71:1 의 뚜렷한 필라멘트.
 *  - 중층(고적운) — `sin(p.x*1.8 + p.y*1.2)` 물결. **바람을 전혀 안 씁니다.**
 *    p 는 월드 XZ 라, 물결은 바람이 어디로 불든 **늘 같은 나침반 방향**
 *    (약 33.7°) 으로 눕습니다.
 *  - 저층(적운) — 등방. 방향 단서가 없습니다.
 *
 * 그러니 화면에는 "바람 따라 눕는 상층"과 "바람과 무관하게 고정된 중층"이
 * 동시에 나옵니다. 둘이 어긋나는 각은 바람에 따라 아무 값이나 됩니다.
 *
 * ## 자 — 구조 텐서
 *
 * 화소 기울기로 2×2 구조 텐서를 쌓아 주방향과 결집도를 냅니다.
 *
 *     J = [[Σgx², Σgxgy], [Σgxgy, Σgy²]]
 *     주방향(무늬가 눕는 각) = 0.5·atan2(2Σgxgy, Σgx²−Σgy²) + 90°
 *     결집도 = (λ1−λ2)/(λ1+λ2)      0 = 등방, 1 = 완전한 줄무늬
 *
 * ## 무엇을 확인하나
 *
 *  ① **바람을 돌리면 그 층의 무늬도 같이 도는가.** 바람 방위를 0·45·90°로
 *     주고 층별 주방향이 따라 도는지 봅니다. 안 돌면 그 층은 바람과 무관한
 *     고정 방향을 그리고 있다는 뜻입니다 — 중층이 그렇습니다.
 *  ② **층 사이 방향 차가 얼마나 벌어지는가.** 결집도가 낮은 층의 주방향은
 *     뜻이 없으므로, 결집도가 뚜렷한 층끼리만 견줍니다.
 *
 * 준비: node tools/shader-preview/stage-esm.js
 * 사용: node tools/shader-preview/build-layer-grain.js
 *       node tools/shader-preview/verify-layer-grain.js
 */
const fs = require('fs');
const path = require('path');
const { PREVIEW } = require('./paths');

const TW = 380, TH = 380;
// 위쪽 하늘을 넓게 봅니다 — 지평선 쪽은 원근이 무늬를 눌러 방향을 왜곡합니다.
const FOV_DEG = 55, VIEW_ELEV = 42, VIEW_AZ = 200;
const SUN_ALT = 34, SUN_AZ = 262;
// 바람 방위 셋. 층 무늬가 바람을 따라 도는지 보는 데 씁니다.
const WINDS = [0, 45, 90];

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
 body{margin:0;background:#0b0f15;font-family:sans-serif;color:#dde}
 #wrap{padding:12px;width:${TW * 3 + 40}px}
 h3{font-size:13px;margin:6px 0}
 .sub{font-size:11px;color:#8aa;margin:0 0 8px}
 canvas{border:1px solid #345;margin:2px}
 .cap{font:10px monospace;color:#9ab;margin:0 0 4px}
</style></head><body>
<div id="wrap">
<h3>층별 무늬 방향 — 바람을 돌리면 따라 도는가</h3>
<p class="sub">주방향은 무늬가 눕는 각(도, 화면 기준). 결집도 0 = 등방이라 주방향에 뜻이 없음.</p>
<div id="shots"></div><div id="out"></div></div>
<script type="module">
import * as THREE from './app/vendor/three.module.js';
import { createSkydome, updateSkydome } from './app/components/SkyScene3D/Skydome.js';
import { createCloudSlab, updateCloudSlab, bakeCloudSlabCoverage }
  from './app/components/SkyScene3D/CloudSlab.js';
import { WeatherFan } from './app/utils/skyColumn.js';
import { makeAtmosphereParams, beamAtAltitude } from './app/utils/atmosphere.js';

const errors = [];
const oe = console.error;
console.error = (...a) => { errors.push(a.join(' ')); oe(...a); };
window.addEventListener('error', e => errors.push(String(e.message)));

const TW=${TW}, TH=${TH}, FOV_DEG=${FOV_DEG};
const VIEW_ELEV=${VIEW_ELEV}, VIEW_AZ=${VIEW_AZ};
const SUN_ALT=${SUN_ALT}, SUN_AZ=${SUN_AZ};
const WINDS=${JSON.stringify(WINDS)};

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

// 운량장은 **방향에 따라 흔들리지 않게** 균일하게 굽습니다. 무늬 방향만
// 보려는 것이라, 운량장이 만든 큰 얼룩이 섞이면 주방향이 그쪽으로 끌립니다.
function bake(slab, MEAN){
  const OFFSETS=[-20,-10,0,10,20], DISTS=[10,30,70,130,200,280,380];
  const pts=[{ distance:0, azimuthOffset:0, low:MEAN.low*100, mid:MEAN.mid*100,
               high:MEAN.high*100, humidity:62, precipitation:0, visibility:24000 }];
  for (const off of OFFSETS) for (const d of DISTS)
    pts.push({ distance:d, azimuthOffset:off, low:MEAN.low*100, mid:MEAN.mid*100,
               high:MEAN.high*100, humidity:62, precipitation:0 });
  const fan = new WeatherFan(pts, SUN_AZ);
  bakeCloudSlabCoverage(slab, (azDeg, distKm) => {
    const { data } = fan.sample(azDeg, distKm);
    if (!data) return { low:0, mid:0, high:0, confidence:1 };
    return { low:data.low/100, mid:data.mid/100, high:data.high/100, confidence:1 };
  });
}

const cam = new THREE.PerspectiveCamera(FOV_DEG, TW/TH, 0.1, 2000);
cam.position.set(0,0,0); cam.up.set(0,1,0);
{
  const ar=VIEW_AZ*Math.PI/180, er=VIEW_ELEV*Math.PI/180;
  cam.lookAt(100*Math.cos(er)*Math.sin(ar), 100*Math.sin(er), -100*Math.cos(er)*Math.cos(ar));
  cam.updateMatrixWorld(true);
}

function shoot(slab, windDeg){
  const a=SUN_ALT*Math.PI/180, z=SUN_AZ*Math.PI/180;
  const sunDir=new THREE.Vector3(Math.cos(a)*Math.sin(z), Math.sin(a), -Math.cos(a)*Math.cos(z)).normalize();
  updateSkydome(skydome, SUN_ALT, SUN_AZ, atmosphere);
  // 세 층에 **같은** 바람을 줍니다 — 층 사이 차이가 남으면 그건 바람 탓이
  // 아니라 코드가 층마다 다른 규약을 쓰기 때문입니다.
  const w = { speedKmh: 40, bearingDeg: windDeg };
  updateCloudSlab(slab, {
    camera: cam, widthPx: TW, heightPx: TH,
    sunDir, sunAltDeg: SUN_ALT, sunAzDeg: SUN_AZ,
    beamFor: (altKm) => beamAtAltitude(SUN_ALT, altKm, atmosphere),
    atmosphere,
    layerWinds: { low:w, mid:w, high:w }, driftHours: 0,
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

/** 구조 텐서 → 주방향(무늬가 눕는 각, 0~180°)과 결집도(0~1). */
function grain(buf){
  let jxx=0, jyy=0, jxy=0;
  const m=Math.round(TH*0.12);
  for(let y=m;y<TH-m;y++) for(let x=m;x<TW-m;x++){
    const i=y*TW+x;
    const gx=lum(buf,i+1)-lum(buf,i-1);
    const gy=lum(buf,i+TW)-lum(buf,i-TW);
    jxx+=gx*gx; jyy+=gy*gy; jxy+=gx*gy;
  }
  const tr=jxx+jyy;
  const diff=Math.sqrt((jxx-jyy)*(jxx-jyy)+4*jxy*jxy);
  // 주 기울기 방향. 무늬가 눕는 각은 그와 수직입니다.
  const gAng=0.5*Math.atan2(2*jxy, jxx-jyy)*180/Math.PI;
  let ang=(gAng+90)%180; if(ang<0) ang+=180;
  return { 주방향:+ang.toFixed(1), 결집도:+(tr>1e-6?diff/tr:0).toFixed(4) };
}

function paint(buf, label){
  const c=document.createElement('canvas'); c.width=TW; c.height=TH;
  c.style.width='240px'; c.style.height='240px';
  const cx=c.getContext('2d');
  const img=cx.createImageData(TW,TH);
  for(let y=0;y<TH;y++){ const s=(TH-1-y)*TW*4, d=y*TW*4;
    for(let i=0;i<TW*4;i++) img.data[d+i]=buf[s+i]; }
  cx.putImageData(img,0,0);
  const t=document.createElement('div'); t.className='cap'; t.textContent=label;
  document.getElementById('shots').appendChild(t);
  document.getElementById('shots').appendChild(c);
}

// 층을 하나씩만 켭니다. 운량은 그 층이 화면을 충분히 덮도록 잡습니다.
const LAYERS = [
  { key:'상층', mean:{low:0, mid:0,   high:0.5} },
  { key:'중층', mean:{low:0, mid:0.5, high:0}   },
  { key:'저층', mean:{low:0.5, mid:0, high:0}   },
];

const 결과={};
for (const L of LAYERS){
  결과[L.key]={};
  for (const wd of WINDS){
    const slab = createCloudSlab();
    slab.mesh.renderOrder = 10;
    scene.add(slab.mesh);
    bake(slab, L.mean);
    const buf = shoot(slab, wd);
    paint(buf, L.key+' · 바람 '+wd+'°');
    결과[L.key]['바람'+wd] = grain(buf);
    scene.remove(slab.mesh);
    slab.dispose?.();
  }
}

document.getElementById('out').innerHTML='<p>'+JSON.stringify(결과)+'</p>';
window.__stats={ glError: gl.getError(), 결과 };
window.__errors=errors;
document.title='DONE::'+(errors.length?'ERR':'OK')+'::'+gl.getError();
</script></body></html>`;

fs.writeFileSync(path.join(PREVIEW, 'layer-grain.html'), html);
console.log('생성 완료: layer-grain.html');
