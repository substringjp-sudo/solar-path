/**
 * **예보 운량이 화면 면적으로 얼마나 옮겨지는가 — 층마다, 시선 고도마다.**
 *
 * 실기 보고: "오늘 아침 사진을 찍은건데 하늘이 구름으로 가득 찼는데 너무
 * 텅빈 구름만 있어." 같은 화면의 기상 요약은 "두껍고 짙은 구름층이 하늘을
 * 완전히 덮어 햇빛을 가립니다"(습도 80%)였습니다. 곧 **자료는 꽉 찼다고
 * 하는데 그림은 비었습니다.**
 *
 * ## 왜 이 자가 필요한가
 *
 * 41절의 백분위 문턱은 "문턱이 곧 면적"이 되게 만든 것입니다 —
 * `P(q > 1-cover) = cover` 가 항등식이므로 예보 90% 면 화면 90% 여야
 * 합니다. 그런데 그 항등식은 **모양장이 그 화소에서 실제로 변할 때**만
 * 성립합니다. 지상거리가 층높이·cot(고도각) 이라 천정으로 갈수록 0 으로
 * 모이고, 모양장 좌표도 한 점으로 모입니다. 한 점에서는 분포가 없으니
 * 백분위도 없습니다 — 캡 전체가 한 값을 나눠 쓰고, 그 값이 문턱을 넘느냐로
 * **전부 구름이거나 전부 맨하늘**이 됩니다.
 *
 * 48.4절에서 곁다리로 나온 사실이 그 증상이었습니다: 저층만 켜고 운량 50%
 * 를 줬는데 고도각 49° 위가 8개 반경대 **전부** 맨하늘과 비트 단위로
 * 동일했습니다. 그때는 천정만 봤는데, 이번 보고는 하늘 전체가 비었다는
 * 것이므로 **고도각을 훑어** 어디서부터 무너지는지 봅니다.
 *
 * ## 자 — 구름 없는 같은 장면과의 차이
 *
 * 같은 시각·같은 시선에서 운량만 0 으로 둔 화면을 먼저 찍고, 화소마다
 * 밝기 차의 절댓값을 봅니다.
 *
 *     구름면적 = |Δ| > 3 인 화소 / 전체      (3 = 8비트 양자화 잡음 위)
 *     구름세기 = 그 화소들의 평균 |Δ|
 *
 * 하늘돔·지형은 두 장에서 같으므로 차이는 오직 구름입니다. 운량 0 을
 * 넣으면 면적이 0 이어야 하고(자가 검증), 운량 1.0 이면 하늘 부분이 거의
 * 다 차야 합니다.
 *
 * ⚠ **지평선 아래는 셈에서 뺍니다** — 지형·바다가 화면 아래를 채우면
 * 분모가 커져 "구름이 하늘을 덮은 비율"이 희석됩니다. 여기서는 지형을
 * 아예 안 그리고 하늘돔만 둡니다.
 *
 * 준비: node tools/shader-preview/stage-esm.js
 * 사용: node tools/shader-preview/build-cover-fill.js
 *       node tools/shader-preview/verify-cover-fill.js
 */
const fs = require('fs');
const path = require('path');
const { PREVIEW } = require('./paths');

const TW = 300, TH = 400;          // 손전화 세로 비
const FOV_DEG = 60;
const SUN_ALT = 15, SUN_AZ = 95;   // 실기 캡처값 (기상 리포트 QR: 고도 15° 방위 95°)
// 시선 고도 — 지평선부터 천정까지 훑습니다.
const ELEVS = [10, 30, 50, 70, 85];
// 예보 운량 — 0 은 자가 검증, 0.16 은 실기 HUD 값, 0.9 는 "완전히 덮음".
const COVERS = [0, 0.16, 0.50, 0.90];

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
 body{margin:0;background:#0b0f15;font-family:sans-serif;color:#dde}
 #wrap{padding:12px}
 h3{font-size:13px;margin:6px 0}
 canvas{border:1px solid #345;margin:2px}
 .cap{font:10px monospace;color:#9ab}
</style></head><body>
<div id="wrap"><h3>예보 운량 → 화면 면적</h3>
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
const ELEVS=${JSON.stringify(ELEVS)}, COVERS=${JSON.stringify(COVERS)};

const glCanvas = document.createElement('canvas');
glCanvas.width = TW; glCanvas.height = TH;
const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias:false, alpha:false });
renderer.setPixelRatio(1); renderer.setSize(TW, TH, false);
const gl = renderer.getContext();

const atmosphere = makeAtmosphereParams({
  latitude: 37.5, observerElevM: 30, dayOfYear: 253,
  humidityPct: 80, visibilityM: 18000,
});
const scene = new THREE.Scene();
const skydome = createSkydome();
scene.add(skydome.mesh);

/**
 * 운량장을 **균일하게** 굽습니다.
 *
 * ⚠ 일부러 얼룩을 안 넣습니다. 여기서 묻는 것은 "예보 90% 가 화면 90% 가
 *   되는가" 한 가지이고, 얼룩을 넣으면 화면마다 국소 운량이 달라져 그
 *   물음이 흐려집니다. 얼룩이 있을 때의 그림은 다른 하네스가 봅니다.
 */
function bake(slab, layer, cover, realConf){
  const OFFSETS=[-20,-10,0,10,20], DISTS=[10,30,70,130,200,280,380];
  const v = { low:0, mid:0, high:0 };
  v[layer] = cover * 100;
  const pt = (d, off) => ({ distance:d, azimuthOffset:off,
    low:v.low, mid:v.mid, high:v.high, humidity:80, precipitation:0, visibility:18000 });
  const pts = [pt(0, 0)];
  for (const off of OFFSETS) for (const d of DISTS) pts.push(pt(d, off));
  const fan = new WeatherFan(pts, SUN_AZ);
  bakeCloudSlabCoverage(slab, (azDeg, distKm) => {
    const { data, confidence } = fan.sample(azDeg, distKm);
    if (!data) return { low:0, mid:0, high:0, confidence:1 };
    // ⚠ 신뢰도는 기본으로 1 에 못 박습니다 — 팬 가장자리 쐐기가 면적을 갉으면
    //   "예보가 화면으로 안 옮겨진다"의 원인이 섞입니다. realConf 를 주면
    //   앱이 실제로 쓰는 값을 그대로 넣어 그 몫만 따로 봅니다.
    return { low:data.low/100, mid:data.mid/100, high:data.high/100,
             confidence: realConf ? Math.max(0, Math.min(1, confidence)) : 1 };
  });
}

function shoot(slab, elevDeg, viewAz){
  const cam = new THREE.PerspectiveCamera(FOV_DEG, TW/TH, 0.1, 2000);
  cam.position.set(0,0,0);
  if (elevDeg > 75) cam.up.set(0,0,-1); else cam.up.set(0,1,0);
  const ar=(viewAz===undefined?SUN_AZ:viewAz)*Math.PI/180, er=elevDeg*Math.PI/180;
  cam.lookAt(100*Math.cos(er)*Math.sin(ar), 100*Math.sin(er), -100*Math.cos(er)*Math.cos(ar));
  cam.updateMatrixWorld(true);

  const a=SUN_ALT*Math.PI/180, z=SUN_AZ*Math.PI/180;
  const sunDir=new THREE.Vector3(Math.cos(a)*Math.sin(z), Math.sin(a), -Math.cos(a)*Math.cos(z)).normalize();
  updateSkydome(skydome, SUN_ALT, SUN_AZ, atmosphere);
  const w = { speedKmh: 30, bearingDeg: 250 };
  updateCloudSlab(slab, {
    camera: cam, widthPx: TW, heightPx: TH,
    sunDir, sunAltDeg: SUN_ALT, sunAzDeg: SUN_AZ,
    beamFor: (altKm) => beamAtAltitude(SUN_ALT, altKm, atmosphere),
    atmosphere,
    layerWinds: { low:w, mid:{speedKmh:50,bearingDeg:250}, high:{speedKmh:95,bearingDeg:250} },
    driftHours: 0, visible: true,
  });
  renderer.setRenderTarget(null);
  renderer.setClearColor(0x000000, 1);
  renderer.render(scene, cam);
  const buf=new Uint8Array(4*TW*TH);
  gl.readPixels(0,0,TW,TH,gl.RGBA,gl.UNSIGNED_BYTE,buf);
  return buf;
}

const lum=(b,p)=>0.2126*b[p*4]+0.7152*b[p*4+1]+0.0722*b[p*4+2];

/** 구름 없는 같은 장면과의 차이로 면적·세기를 냅니다. */
function fill(buf, base){
  let n=0, s=0;
  for(let i=0;i<TW*TH;i++){
    const d=Math.abs(lum(buf,i)-lum(base,i));
    if (d > 3) { n++; s+=d; }
  }
  return { 면적:+(n/(TW*TH)).toFixed(4), 세기:+(n?s/n:0).toFixed(1) };
}

function paint(buf, label){
  const c=document.createElement('canvas'); c.width=TW; c.height=TH;
  c.style.width='120px'; c.style.height='160px';
  const cx=c.getContext('2d');
  const img=cx.createImageData(TW,TH);
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
    // 같은 시선의 맨하늘을 먼저 찍어 바탕으로 씁니다.
    let base;
    {
      const s0 = createCloudSlab(); s0.mesh.renderOrder = 10; scene.add(s0.mesh);
      bake(s0, layer, 0);
      base = shoot(s0, elev);
      scene.remove(s0.mesh); s0.dispose?.();
    }
    결과[layer]['고도'+elev] = {};
    for (const cov of COVERS){
      const slab = createCloudSlab(); slab.mesh.renderOrder = 10; scene.add(slab.mesh);
      bake(slab, layer, cov);
      const buf = shoot(slab, elev);
      if (cov === 0.90 && (elev === 10 || elev === 50 || elev === 85))
        paint(buf, layer+' 고도'+elev+' 90%');
      결과[layer]['고도'+elev]['운량'+Math.round(cov*100)] = fill(buf, base);
      scene.remove(slab.mesh); slab.dispose?.();
    }
  }
}

// ── 시선 방위 훑기 — 예보 팬은 **태양 방위 ±20°** 만 덮습니다 ────────────
//
// 실기 화면은 54° NE 를 보고 있었고 태양은 저녁이라 서쪽입니다 — 팬에서
// 200° 나 벗어난 자리입니다. 신뢰도가 방위에만 달렸으므로(48.3절 측정)
// 그 바깥에서 화면이 비면 그게 "하늘이 텅 비었다"의 정체입니다.
const 방위훑기={};
for (const layer of ['low','mid','high']){
  방위훑기[layer]={};
  for (const off of [0, 20, 45, 90, 135, 180]){
    const az = (SUN_AZ + off) % 360;
    let base;
    {
      const s0 = createCloudSlab(); s0.mesh.renderOrder = 10; scene.add(s0.mesh);
      bake(s0, layer, 0, true);
      base = shoot(s0, 40, az);
      scene.remove(s0.mesh); s0.dispose?.();
    }
    const 칸={};
    for (const [키, rc] of [['신뢰도실제', true], ['신뢰도1', false]]){
      const slab = createCloudSlab(); slab.mesh.renderOrder = 10; scene.add(slab.mesh);
      bake(slab, layer, 0.90, rc);
      const buf = shoot(slab, 40, az);
      if (layer === 'mid' && rc && (off === 0 || off === 90 || off === 180))
        paint(buf, '중층 90% 방위+' + off);
      칸[키] = fill(buf, base);
      scene.remove(slab.mesh); slab.dispose?.();
    }
    방위훑기[layer]['태양에서'+off] = 칸;
  }
}

// ── ⚠ 실패한 자 — 배경 둘로 알파 뽑기 (쓰지 마십시오) ────────────────
//
// **이 자는 안 됩니다.** 세 층 · 세 고도 · 두 운량 열여덟 경우가 전부
// 알파 1.000 · 구름화소 1.000 으로 나왔습니다. 곧 검정 배경과 흰 배경의
// 화면이 **완전히 같았다**는 뜻이고, 그럴 수 있는 경우는 하나뿐입니다 —
// CloudSlab 이 알파 합성으로 얹히는 층이 아니라 **화면 전체를 자기 색으로
// 칠하는 판**이라 뒤가 아예 안 비칩니다. 하늘돔을 빼도 clearColor 는
// 보이지 않습니다.
//
// 지우지 않고 남기는 이유: 같은 함정을 다시 파지 않기 위해서입니다.
// 구름의 '몸'을 재려면 배경이 아니라 **셰이더가 내는 광학두께**를 직접
// 꺼내야 합니다(43절 자료 출력 tauAcc 가 그 자리입니다).
//
// ── 아래는 그 실패한 계산 그대로 (수치를 믿지 마십시오) ────────────────
//
// "구름이 텅 비었다"는 면적 이야기일 수도, **몸이 없다**는 이야기일 수도
// 있습니다. 면적은 위에서 쟀으니 여기서는 몸을 잽니다.
//
// 하늘돔을 빼고 구름만 남긴 뒤 배경을 검정·흰색으로 두 번 그리면
//
//     I_black = a·C        I_white = a·C + (1-a)·255
//     a = 1 - (I_white - I_black)/255
//
// 로 화소마다 알파가 **정확히** 나옵니다(근사가 아닙니다). 불투명한 구름은
// a=1, 얇은 베일은 a≈0.2 입니다.
scene.remove(skydome.mesh);
const 불투명도={};
for (const layer of ['low','mid','high']){
  불투명도[layer]={};
  for (const elev of [15, 40, 85]){
    for (const cov of [0.50, 0.90]){
      const slab = createCloudSlab(); slab.mesh.renderOrder = 10; scene.add(slab.mesh);
      bake(slab, layer, cov, false);
      renderer.setClearColor(0x000000, 1);
      const bk = shoot(slab, elev);
      renderer.setClearColor(0xffffff, 1);
      const wh = shoot(slab, elev);
      scene.remove(slab.mesh); slab.dispose?.();

      let n=0, sa=0, opaque=0, half=0;
      for (let i=0;i<TW*TH;i++){
        const a = 1 - (lum(wh,i) - lum(bk,i))/255;
        if (a > 0.02) { n++; sa += a; if (a > 0.9) opaque++; if (a > 0.5) half++; }
      }
      불투명도[layer]['고도'+elev+'_운량'+Math.round(cov*100)] = {
        구름화소: +(n/(TW*TH)).toFixed(3),
        평균알파: +(n?sa/n:0).toFixed(3),
        // 구름으로 친 화소 중 몇 %가 실제로 하늘을 가리는가
        불투명비: +(n?opaque/n:0).toFixed(3),
        반이상비: +(n?half/n:0).toFixed(3),
      };
    }
  }
}
scene.add(skydome.mesh);
renderer.setClearColor(0x000000, 1);

document.getElementById('out').innerHTML='<p>'+JSON.stringify(결과)+'</p>';
window.__stats={ glError: gl.getError(), 결과, 방위훑기, 불투명도 };
window.__errors=errors;
document.title='DONE::'+(errors.length?'ERR':'OK')+'::'+gl.getError();
</script></body></html>`;

fs.writeFileSync(path.join(PREVIEW, 'cover-fill.html'), html);
console.log('생성 완료: cover-fill.html');
