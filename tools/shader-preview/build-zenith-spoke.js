/**
 * **천정 부챗살 — 자를 다시 만듭니다.**
 *
 * 실기 화면(2026-09-09 10:47 · 시선 220° SW · 고도 +85°)에 천정으로 빨려드는
 * **부챗살**이 뚜렷합니다. 그런데 48절에서 만든 `build-zenith-pinch.js` 는
 * 그것을 **고리(과녁)** 로 읽었습니다. 자가 결함을 못 보고 있었습니다.
 *
 * ## 왜 못 봤나 — 대조가 원인을 지웠습니다
 *
 * 48.3절에서 후보 (A) 운량 텍스처와 (C) 신뢰도를 "죽였다"고 적었습니다.
 * 그 대조는 **운량장을 균일하게** 주고 **신뢰도를 1 로 못 박은** 것이었습니다.
 * 그런데 부챗살을 만드는 것이 바로 그 **방위 변화**입니다 — 지워 놓고
 * "없다"고 결론지은 셈입니다. 논증을 뒤집습니다.
 *
 * ## 기전은 코드에 그대로 있습니다
 *
 * `bakeCloudSlabCoverage` 는 텍셀마다 이렇게 채웁니다:
 *
 *     r  = |p|                       // p = 텍셀의 정규화 좌표 (-1..1)
 *     d  = R · r²                    // 제곱근 사상의 역
 *     az = atan2(px/r, -py/r)
 *     c  = src(az, d)
 *
 * 128² 텍스처의 **한가운데 네 텍셀**은 r ≈ 0.0055 이므로 d ≈ **11m** —
 * 사실상 같은 점입니다. 그런데 방위는 45°·135°·225°·315° 로 **완전히
 * 다릅니다.** 팬이 방위에 따라 다른 값을 주면(신뢰도는 방위만 봅니다)
 * 머리 위 한 점이 360° 로 펴져 부챗살이 됩니다. 천정 둘레 하늘 전체가
 * 이 몇 텍셀 안에 들어가므로 화면에서는 크게 벌어집니다.
 *
 * ## 새 자 — 고리끼리 방위 무늬가 같은가
 *
 * 중심 둘레를 반경대 × 방위로 극좌표 표본을 뜹니다. 부챗살이면 **반경이
 * 달라도 같은 방위 무늬**가 반복되므로 고리끼리 상관이 높습니다. 얼룩이면
 * 반경이 멀어질수록 상관이 무너집니다. 고리 무늬(과녁)는 방위 편차가 0 에
 * 가까워 상관이 정의되지 않으므로 편차가 바닥인 고리는 셈에서 뺍니다.
 *
 *     부챗살점수 = 평균 corr(I[k1], I[k2])   단 |k1-k2| >= 2
 *
 * ## 자가 스스로를 속이지 않는가 — 대조 넷
 *
 *  ① **가짜 중심** — 천정에서 비켜난 점. 부챗살이 진짜면 여기서 무너집니다.
 *  ② **방위를 지운 팬** — `src` 가 az 를 아예 안 보게 합니다(거리만).
 *     반경 구조는 그대로 두고 방위 변화만 없앱니다. 여기서 점수가 무너지면
 *     원인이 **방위 변화**로 좁혀집니다.
 *  ③ **증폭** — 일부러 방위로 3겹 부챗살을 넣습니다. 자가 반응해야 합니다.
 *     반응 안 하면 자가 눈먼 것입니다.
 *  ④ **구름 없음** — 바닥.
 *
 * ## ⚠⚠ 결과 — **재현 실패. 이 자를 믿지 마십시오.**
 *
 * 돌려 보면 이렇습니다:
 *
 * | 경우 | 천정 | 가짜중심 |
 * |---|---|---|
 * | 앱 그대로(저해상 2배) | 0.193 | 0.174 |
 * | 같은 것·원해상도 | 0.183 | 0.170 |
 * | 방위를 지운 팬 | 0.193 | 0.175 |
 * | **증폭 3겹 부챗살** | 0.204 | **0.298** |
 * | 구름 없음 | **0.991** | 0.978 |
 *
 * **증폭 대조에서 가짜 중심이 더 높습니다.** 일부러 넣은 부챗살에 자가
 * 반응하기는커녕 엉뚱한 점에서 더 높게 나왔습니다. 그리고 구름 없는 하늘이
 * 0.991 로 최고입니다 — 하늘돔의 매끄러운 밝기 기울기는 고리끼리 완벽히
 * 상관되므로, 이 자가 실제로 재고 있던 것은 **하늘의 부드러움**이지
 * 부챗살이 아닙니다. 구름은 그 상관을 깨뜨려 점수를 **낮춥니다.**
 *
 * 그리고 더 큰 문제 — **그림에 부챗살이 아예 안 나옵니다.** 다섯 경우 전부
 * 평범한 구름입니다. 자가 나쁜 것 이전에 **하네스가 결함을 재현하지 못하고
 * 있습니다.**
 *
 * ## 그 과정에서 지운 후보들 (이건 남는 소득입니다)
 *
 *  - **박명광선(godray) 아님.** 화면상 태양으로 수렴하는 방사 블러라 모양이
 *    딱 맞아 보였지만, `RAY_ALT_HIGH_OFF = 12` 라 태양 고도 12° 위에서는
 *    완전히 꺼집니다. 실기 화면의 태양은 **50.4°** 입니다.
 *  - **컴포저의 저해상도 경로 아님.** 앱은 줄어든 버퍼 크기를 화소각으로
 *    올바로 넘깁니다(`slabW = isSoft ? sSize.width : ...`). 하네스에 절반
 *    해상도 + 이중선형 확대를 넣어도 0.183 → 0.193, 그림도 그대로입니다.
 *  - **운량 텍스처의 방위 구조가 화면까지 거의 못 옵니다.** '방위를 지운 팬'이
 *    '앱 그대로'와 사실상 같은 그림·같은 수치입니다. 곧 천정 둘레의 무늬는
 *    운량이 아니라 **모양장(지상 좌표의 fbm)** 이 정합니다.
 *
 * ## 남은 한 가지 구조적 차이 — 다음에 여기부터
 *
 * 앱은 **SceneComposer** 로 그립니다: 하늘과 구름을 레이어로 나눠 각각
 * 저해상도 타겟에 그린 뒤 알파로 합성하고, 그 위에 원해상도 층을 얹습니다.
 * 이 하네스는 슬랩을 화면에 **직접** 그립니다. 그리고 슬랩은 화면 전체를
 * 자기 색으로 칠하는 판이라(51절의 실패한 알파 자로 확인) 합성 경로가
 * 실제로 다릅니다. `SceneComposer.ts` 는 `.ts` 모듈이라 스테이징할 수
 * 있으므로, 다음 시도는 **진짜 컴포저를 태우는 것**입니다.
 *
 * 지우지 않고 남기는 이유: 같은 자를 다시 만들지 않기 위해서입니다.
 *
 * 준비: node tools/shader-preview/stage-esm.js
 * 사용: node tools/shader-preview/build-zenith-spoke.js
 *       node tools/shader-preview/verify-zenith-spoke.js
 */
const fs = require('fs');
const path = require('path');
const { PREVIEW } = require('./paths');

const TW = 420, TH = 420;
const FOV_DEG = 90;              // 화면 반높이가 천정에서 45°
// 실기 화면의 순간 — suncalc 로 구한 값입니다.
const SUN_ALT = 50.40, SUN_AZ = 137.41;
const VIEW_AZ = 220;             // 화면의 220° SW
const VIEW_ELEV = 85;            // 화면의 +85°

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
 body{margin:0;background:#0b0f15;font-family:sans-serif;color:#dde}
 #wrap{padding:12px} h3{font-size:13px;margin:6px 0}
 canvas{border:1px solid #345;margin:2px} .cap{font:10px monospace;color:#9ab}
</style></head><body>
<div id="wrap"><h3>천정 부챗살 — 고리끼리 방위 무늬가 같은가</h3>
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
const VIEW_AZ=${VIEW_AZ}, VIEW_ELEV=${VIEW_ELEV};

const glCanvas = document.createElement('canvas');
glCanvas.width = TW; glCanvas.height = TH;
const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias:false, alpha:false });
renderer.setPixelRatio(1); renderer.setSize(TW, TH, false);
const gl = renderer.getContext();

const atmosphere = makeAtmosphereParams({
  latitude: 37.4863, observerElevM: 0, dayOfYear: 252,
  humidityPct: 70, visibilityM: 20000,
});
const scene = new THREE.Scene();
const skydome = createSkydome();
scene.add(skydome.mesh);

// 실기 화면은 상층운 6% 인데 하늘이 꽉 차 있습니다 — 저층·중층이 높다는 뜻.
const MEAN = { low: 0.55, mid: 0.50, high: 0.06 };

/**
 * 운량장을 굽습니다.
 *
 * mode:
 *  'app'      — 앱 그대로. 진짜 팬 + 진짜 신뢰도(방위에 따라 달라짐).
 *  'noAz'     — **방위를 지웁니다.** src 가 az 를 아예 안 보고 거리만 봅니다.
 *  'spoke3'   — 증폭. 방위로 3겹 부챗살을 일부러 넣습니다.
 *  'none'     — 구름 없음.
 */
function bake(slab, mode){
  const OFFSETS=[-20,-10,0,10,20], DISTS=[10,30,70,130,200,280,380];
  // 거리에 따라 조금씩 다른 값 — 반경 구조는 어느 경우에나 남깁니다.
  const byDist = (d, L) => Math.max(0, Math.min(1,
    MEAN[L] + 0.18 * Math.sin(d / 90 + (L === 'low' ? 0 : L === 'mid' ? 2.1 : 4.2))));
  const pts=[];
  const pt=(d,off)=>({ distance:d, azimuthOffset:off,
    low:byDist(d,'low')*100, mid:byDist(d,'mid')*100, high:byDist(d,'high')*100,
    humidity:70, precipitation:0, visibility:20000 });
  pts.push(pt(0,0));
  for (const off of OFFSETS) for (const d of DISTS) pts.push(pt(d,off));
  const fan = new WeatherFan(pts, SUN_AZ);

  bakeCloudSlabCoverage(slab, (azDeg, distKm) => {
    if (mode === 'none') return { low:0, mid:0, high:0, confidence:1 };
    if (mode === 'noAz') {
      // 방위를 안 봅니다. 거리 구조는 그대로, 신뢰도도 상수.
      return { low: byDist(distKm,'low'), mid: byDist(distKm,'mid'),
               high: byDist(distKm,'high'), confidence: 1 };
    }
    if (mode === 'spoke3') {
      const s = 0.5 + 0.4 * Math.sin(3 * azDeg * Math.PI / 180);
      return { low: s, mid: s, high: 0, confidence: 1 };
    }
    const { data, confidence } = fan.sample(azDeg, distKm);
    if (!data) return { low:0, mid:0, high:0, confidence:0 };
    return { low:data.low/100, mid:data.mid/100, high:data.high/100,
             confidence: Math.max(0, Math.min(1, confidence)) };
  });
}

function shoot(slab, softScale){
  // ⚠ 앱은 컴포저의 **저해상도 경로**로 구름을 그린 뒤 확대합니다
  //   (SceneComposer: DEFAULT_SOFT_SCALE = 2 — 가로세로 절반). 화소각은
  //   그 줄어든 해상도로 올바로 넘기지만, **확대 자체**가 하네스에는
  //   없었습니다. 천정 둘레는 지상 좌표가 모여 화면 주파수가 가장 높은
  //   자리라, 거기서 절반 해상도로 뜨고 늘리면 방사형 앨리어싱이 날 수
  //   있습니다 — CloudSlab 머리말이 "표본이 무늬보다 성글면 앨리어싱이
  //   방사형 줄무늬로 나온다"고 적어 둔 바로 그 병입니다.
  const S = Math.max(1, softScale || 1);
  const RW = Math.max(2, Math.round(TW / S)), RH = Math.max(2, Math.round(TH / S));
  renderer.setSize(RW, RH, false);
  const cam = new THREE.PerspectiveCamera(FOV_DEG, TW/TH, 0.1, 2000);
  cam.position.set(0,0,0);
  // 거의 천정이라 up 을 북으로 둡니다 (0,1,0) 이면 축퇴합니다.
  cam.up.set(0,0,-1);
  const ar=VIEW_AZ*Math.PI/180, er=VIEW_ELEV*Math.PI/180;
  cam.lookAt(100*Math.cos(er)*Math.sin(ar), 100*Math.sin(er), -100*Math.cos(er)*Math.cos(ar));
  cam.updateMatrixWorld(true);

  const a=SUN_ALT*Math.PI/180, z=SUN_AZ*Math.PI/180;
  const sunDir=new THREE.Vector3(Math.cos(a)*Math.sin(z), Math.sin(a), -Math.cos(a)*Math.cos(z)).normalize();
  updateSkydome(skydome, SUN_ALT, SUN_AZ, atmosphere);
  const w={ speedKmh:22, bearingDeg:250 };
  updateCloudSlab(slab, {
    // 앱과 같게 — 실제로 그리는 버퍼 크기를 넘깁니다.
    camera: cam, widthPx: RW, heightPx: RH,
    sunDir, sunAltDeg: SUN_ALT, sunAzDeg: SUN_AZ,
    beamFor:(altKm)=>beamAtAltitude(SUN_ALT, altKm, atmosphere),
    atmosphere,
    layerWinds:{ low:w, mid:{speedKmh:37,bearingDeg:250}, high:{speedKmh:75,bearingDeg:250} },
    driftHours:0, visible:true,
  });
  renderer.setRenderTarget(null);
  renderer.setClearColor(0x000000, 1);
  renderer.render(scene, cam);
  const small=new Uint8Array(4*RW*RH);
  gl.readPixels(0,0,RW,RH,gl.RGBA,gl.UNSIGNED_BYTE,small);
  renderer.setSize(TW, TH, false);
  if (S === 1) return small;
  // 이중선형 확대 — 컴포저의 blit 과 같은 필터입니다.
  const big=new Uint8Array(4*TW*TH);
  for (let y=0;y<TH;y++){
    const fy=(y+0.5)*RH/TH-0.5, y0=Math.max(0,Math.min(RH-1,Math.floor(fy)));
    const y1=Math.min(RH-1,y0+1), ty=Math.max(0,Math.min(1,fy-y0));
    for (let x=0;x<TW;x++){
      const fx=(x+0.5)*RW/TW-0.5, x0=Math.max(0,Math.min(RW-1,Math.floor(fx)));
      const x1=Math.min(RW-1,x0+1), tx=Math.max(0,Math.min(1,fx-x0));
      const o=(y*TW+x)*4;
      for (let c=0;c<4;c++){
        const a=small[(y0*RW+x0)*4+c], b=small[(y0*RW+x1)*4+c];
        const d=small[(y1*RW+x0)*4+c], e=small[(y1*RW+x1)*4+c];
        big[o+c]=(a+(b-a)*tx) + ((d+(e-d)*tx) - (a+(b-a)*tx))*ty;
      }
    }
  }
  return big;
}

const lumAt=(b,x,y)=>{
  const xi=Math.max(0,Math.min(TW-1,Math.round(x))), yi=Math.max(0,Math.min(TH-1,Math.round(y)));
  const p=(yi*TW+xi)*4;
  return 0.2126*b[p]+0.7152*b[p+1]+0.0722*b[p+2];
};

/**
 * 부챗살 점수 — 고리끼리 방위 무늬의 상관.
 *
 * 반경대 K 개 × 방위 J 개로 극좌표 표본을 뜬 뒤, 떨어진 고리끼리
 * (|k1-k2| >= 2) 피어슨 상관을 평균합니다. 부챗살이면 반경이 달라도 같은
 * 방위 무늬라 상관이 높습니다.
 *
 * ⚠ 방위 편차가 바닥인 고리(=고리 무늬)는 상관이 정의되지 않으므로 뺍니다.
 *   그래서 이 자는 **고리에는 반응하지 않고 부챗살에만** 반응합니다 —
 *   48절의 자와 재는 것이 다릅니다.
 */
function spokeScore(buf, cx, cy, rMin, rMax){
  const K=10, J=120;
  const rings=[];
  for (let k=0;k<K;k++){
    const r = rMin + (rMax-rMin)*(k+0.5)/K;
    const v=[];
    for (let j=0;j<J;j++){
      const t = 2*Math.PI*j/J;
      v.push(lumAt(buf, cx + r*Math.cos(t), cy + r*Math.sin(t)));
    }
    const m = v.reduce((a,b)=>a+b,0)/J;
    const sd = Math.sqrt(v.reduce((a,b)=>a+(b-m)*(b-m),0)/J);
    rings.push({ v, m, sd });
  }
  // 방위 편차가 바닥인 고리는 뺍니다 (8비트 양자화 잡음 위).
  const use = rings.filter(r => r.sd > 1.5);
  if (use.length < 4) return { 부챗살점수: null, 쓴고리: use.length };
  let s=0, n=0;
  for (let a=0;a<use.length;a++) for (let b=a+2;b<use.length;b++){
    const A=use[a], B=use[b];
    let c=0;
    for (let j=0;j<A.v.length;j++) c += (A.v[j]-A.m)*(B.v[j]-B.m);
    c /= A.v.length * A.sd * B.sd;
    s+=c; n++;
  }
  if (!n) return { 부챗살점수: null, 쓴고리: use.length };
  return { 부챗살점수:+(s/n).toFixed(3), 쓴고리: use.length,
           방위편차: +(use.reduce((a,r)=>a+r.sd,0)/use.length).toFixed(2) };
}

function paint(buf, label){
  const c=document.createElement('canvas'); c.width=TW; c.height=TH;
  c.style.width='200px'; c.style.height='200px';
  const cx=c.getContext('2d'); const img=cx.createImageData(TW,TH);
  for(let y=0;y<TH;y++){ const s=(TH-1-y)*TW*4, d=y*TW*4;
    for(let i=0;i<TW*4;i++) img.data[d+i]=buf[s+i]; }
  cx.putImageData(img,0,0);
  const t=document.createElement('span'); t.className='cap'; t.textContent=label+' ';
  document.getElementById('shots').appendChild(t);
  document.getElementById('shots').appendChild(c);
  return c.toDataURL('image/png');
}

const CASES = [
  // ⚠ 앱은 softScale 2 로 그립니다. 1 은 그 하나만 다른 대조입니다 —
  //   다른 것을 아무것도 안 바꾸고 해상도만 바꿉니다.
  { key:'앱 그대로(저해상 2배)', mode:'app',    soft:2 },
  { key:'같은 것·원해상도',      mode:'app',    soft:1 },
  { key:'방위를 지운 팬(저해상)', mode:'noAz',   soft:2 },
  { key:'증폭 3겹 부챗살',       mode:'spoke3', soft:2 },
  { key:'구름 없음',            mode:'none',   soft:2 },
];

const 결과={}, 그림={};
const half = TH/2;
for (const c of CASES){
  const slab = createCloudSlab(); slab.mesh.renderOrder = 10; scene.add(slab.mesh);
  bake(slab, c.mode);
  const buf = shoot(slab, c.soft);
  그림[c.key] = paint(buf, c.key);
  결과[c.key] = {
    천정: spokeScore(buf, TW/2, TH/2, half*0.06, half*0.42),
    // ⚠ 가짜 중심 — 진짜 부챗살이면 여기서 무너집니다.
    가짜중심: spokeScore(buf, TW/2 + TW*0.26, TH/2 - TH*0.20, half*0.06, half*0.42),
  };
  scene.remove(slab.mesh); slab.dispose?.();
}

document.getElementById('out').innerHTML='<p>'+JSON.stringify(결과)+'</p>';
window.__stats={ glError: gl.getError(), 결과 };
window.__png=그림;
window.__errors=errors;
document.title='DONE::'+(errors.length?'ERR':'OK')+'::'+gl.getError();
</script></body></html>`;

fs.writeFileSync(path.join(PREVIEW, 'zenith-spoke.html'), html);
console.log('생성 완료: zenith-spoke.html');
