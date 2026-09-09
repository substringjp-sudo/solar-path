/**
 * **구름 그림자가 땅에 지는가** (실기 보고).
 *
 * "구름의 그림자도 땅에 안보여." 맞습니다. 지금까지 그림자는 **구름끼리**
 * (상층 → 중층)만 있었습니다 — `verify-cloud-shadow.js` 가 재는 것이 그것
 * 입니다. 땅은 구름이 하늘 어디에 있든 늘 같은 직달광을 받았습니다.
 *
 * ## 두 층위를 다 잽니다
 *
 * ① **지도 자체** (`utils/cloudShadowMap.ts`, 순수 JS). 구름 한 덩이를
 *    아는 자리에 놓고, 그늘의 무게중심이 **`H / tan(태양고도)` 만큼 태양
 *    반대쪽으로** 밀려나 있는지 봅니다. 이게 이 기능의 전부인 기하입니다.
 * ② **화면까지 닿는가.** 그 지도를 실제 지면 셰이더에 물려 렌더하고,
 *    땅의 밝기가 실제로 얼룩지는지 봅니다. 지도만 맞고 셰이더에 안 물리면
 *    사용자에게는 여전히 아무 일도 안 일어납니다.
 *
 * ## 대조 — 무엇이 이 지표를 속일 수 있나
 *
 * - **맑은 하늘**: 운량 0 이면 지도가 평평해야 합니다(표준편차 ≈ 0).
 * - **온통 흐림**: 운량이 어디나 같으면 **그것도 평평해야** 합니다. 땅에
 *   지는 것은 구름의 *무늬*이지 양이 아닙니다 — 전체가 어두워지는 몫은
 *   이미 씬이 `1 − overheadOvercast` 로 따로 처리하고 있고, 여기서 또
 *   곱하면 운량을 제곱합니다. 이 대조가 그 이중계산을 잡습니다.
 * - **태양 방위 뒤집기**: 그늘이 반대쪽으로 옮겨가야 합니다.
 * - **태양 고도 낮추기**: 어긋남이 커져야 합니다 (H/tan).
 *
 * 사용: node tools/shader-preview/build-cloud-ground.js
 *       node tools/shader-preview/verify-cloud-ground.js
 */
const fs = require('fs');
/** 화면 시험의 조명 — 앱에서 가져옵니다 (해 45° · 방위 180°). */
const LIGHT = require('./app-lighting').appLighting(45, 180);
const path = require('path');
const { PREVIEW } = require('./paths');

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
 body{margin:0;background:#0b0f15;font-family:sans-serif;color:#dde}
 #wrap{padding:12px;width:900px} h3{font-size:14px;margin:6px 0}
 canvas{border:1px solid #345;margin:3px;image-rendering:pixelated} p{font:11px monospace}
</style></head><body>
<div id="wrap"><h3>구름 그림자가 땅에 지는가</h3>
<div id="shots"></div><div id="out"></div></div>
<script type="module">
import * as THREE from './app/vendor/three.module.js';
import { elevationGrid, LAYER_ALTITUDE_KM } from './app/utils/skyColumn.js';
import { buildCloudShadowTexture, cloudTransmittanceAt, CLOUD_SHADOW_PX, CLOUD_SHADOW_HALF_M }
  from './app/utils/cloudShadowMap.js';
import { createTerrainField, updateTerrainFieldEye } from './app/components/SkyScene3D/TerrainField.js';

const errors=[]; const oe=console.error; console.error=(...a)=>{errors.push(a.join(' ')); oe(...a);};
window.addEventListener('error', e=>errors.push(String(e.message)));

const AZ_STEPS=24;
const ELEVS=elevationGrid();
const LAYERS=['low','mid','high'];

/**
 * 합성 표본 배열. \`coverFn(layer, azDeg, elevDeg)\` 가 운량을 정합니다.
 * ⚠ CloudDeck 의 인덱싱과 **같아야** 합니다: 층별로 방위 major, 고도 minor.
 */
function makeSamples(coverFn){
  const out=[];
  for (const layer of LAYERS)
    for (let a=0;a<AZ_STEPS;a++)
      for (let e=0;e<ELEVS.length;e++){
        const azDeg=(a*360)/AZ_STEPS;
        out.push({layer, azimuthDeg:azDeg, elevationDeg:ELEVS[e], distanceKm:0,
                  cover: coverFn(layer, azDeg, ELEVS[e])});
      }
  return out;
}

const tauFor=(l)=> l==='high' ? 3.0 : (l==='mid' ? 16.0 : 32.0);

/** 지도를 그대로 배열로 (0~4 눈금을 되돌려서). */
function mapValues(samples, sunAltDeg, sunAzDeg){
  const px=CLOUD_SHADOW_PX, half=CLOUD_SHADOW_HALF_M;
  const tex=buildCloudShadowTexture({samples, azSteps:AZ_STEPS, elevs:ELEVS,
    sunAltDeg, sunAzDeg, tauFor}, null, px, half);
  const d=tex.image.data;
  const v=new Float32Array(px*px);
  for(let i=0;i<px*px;i++) v[i]=(d[i*4]/255)*4;
  return {v, px, half, tex};
}

const stats=(v)=>{ let m=0; for(const x of v) m+=x; m/=v.length;
  let s=0; for(const x of v) s+=(x-m)*(x-m); return {평균:+m.toFixed(4), 표준편차:+Math.sqrt(s/v.length).toFixed(4)}; };

/** 어두운 화소(투과율 < 0.7)의 무게중심 (동, 남 m). */
function darkCentroid(m){
  let se=0, ss=0, n=0;
  const step=(2*m.half)/m.px;
  for(let j=0;j<m.px;j++) for(let i=0;i<m.px;i++){
    if (m.v[j*m.px+i] >= 0.7) continue;
    se += -m.half+(i+0.5)*step; ss += -m.half+(j+0.5)*step; n++;
  }
  return n? {동:+(se/n).toFixed(0), 남:+(ss/n).toFixed(0), 화소:n} : {동:0, 남:0, 화소:0};
}

// ── 시험용 하늘 셋 ──────────────────────────────────────────────────────────
const 맑음 = makeSamples(()=>0);
const 온통흐림 = makeSamples((l)=> l==='low' ? 0.9 : 0);
/**
 * **구름 한 덩이.** 저층(1.5km)만, 관측자 바로 위(고도각 큰 쪽) 좁은 자리.
 * 고도각 60° 이상이면 지상 거리 1.5/tan60 = 0.87km 안쪽입니다.
 */
const 한덩이 = makeSamples((l, az, elev)=> (l==='low' && elev>=55) ? 1.0 : 0);

const 결과={};
const SUN_ALT=20, SUN_AZ=180;

{
  const a=mapValues(맑음, SUN_ALT, SUN_AZ);
  const b=mapValues(온통흐림, SUN_ALT, SUN_AZ);
  const c=mapValues(한덩이, SUN_ALT, SUN_AZ);
  결과.지도={ 맑음:stats(a.v), 온통흐림:stats(b.v), 한덩이:stats(c.v),
              한덩이무게중심:darkCentroid(c) };

  // 기하: 저층 1.5km · 해 20° → 어긋남 1500/tan20° = 4121m, 태양 **반대** 쪽.
  const reach = 1500/Math.tan(SUN_ALT*Math.PI/180);
  결과.기하={ 예상어긋남:+reach.toFixed(0),
    예상동:+(-Math.sin(SUN_AZ*Math.PI/180)*reach).toFixed(0),
    예상남:+(Math.cos(SUN_AZ*Math.PI/180)*reach).toFixed(0) };

  // 태양 방위·고도 대조
  const c180=mapValues(한덩이, SUN_ALT, (SUN_AZ+180)%360);
  // ⚠ 해를 더 낮추면 어긋남이 지도 밖(±12km)으로 나갑니다 — 해 8° 면
  //   10.7km 라 아슬아슬하고, 5° 면 17km 로 아예 밖입니다. 잴 수 있는
  //   범위 안에서 고릅니다.
  const cLow=mapValues(한덩이, 12, SUN_AZ);
  결과.방위대조={ 앞:darkCentroid(c), 뒤:darkCentroid(c180) };
  결과.고도대조={ 해20:darkCentroid(c), 해12:darkCentroid(cLow),
    예상20:+reach.toFixed(0), 예상12:+(1500/Math.tan(12*Math.PI/180)).toFixed(0) };
}

// ── 화면까지 닿는가 ─────────────────────────────────────────────────────────
// ── 렌더 시험의 자리 잡기 — 두 번 헛짚고 나서 ──────────────────────────────
//
// ① 해 20° 면 저층 구름의 그늘이 4.1km 밖에 떨어져 **3km 격자 위에 아예
//    없습니다.** 화면 표준편차가 셋 다 0 으로 나왔습니다. → 해를 45° 로
//    올려 어긋남을 1.5km 로 줄입니다. 기하는 위에서 20°·12° 로 따로 쟀습니다.
// ② 그늘은 **태양 반대쪽**에 집니다. 해가 남(180°)이면 그늘은 북쪽이니
//    카메라도 북(0°)을 봐야 합니다. 해 쪽을 보고 있어서 또 0 이 나왔습니다.
// ③ 눈높이 1.6m 로 평평한 판을 보면 **1.5km 앞 땅이 내려본각 0.06°** 입니다 —
//    수평선의 머리카락 한 올이라 그늘이 있어도 화면에 안 걸립니다. 눈을
//    1,000m 로 올립니다(평지 위 1km 탑). 그러면 1.5km 앞이 33.7° 라 넓게
//    보입니다. DEM 은 여전히 없으므로 지형 그림자는 정의상 0 이고, 땅이
//    얼룩진다면 원인은 오직 구름입니다.
const RENDER_SUN_ALT=45, RENDER_EYE_M=1000, RENDER_LOOK_AZ=0;
// ⚠ 조명은 **앱에서 가져옵니다** (아래 IRR/SUNR/EXPO). 예전에는 여기에
//   어림값(하늘 0.11 · 직달 2.4)을 적어 뒀는데, 앱의 실제 값은 그 반대
//   (하늘이 직달보다 큼)입니다. 같은 어림값이 build-relief 에서 판정을
//   통째로 무효로 만든 적이 있습니다.
const IRR=${JSON.stringify(LIGHT.surfaceIrr)}, SUNR=${JSON.stringify(LIGHT.sunRadiance)};
const EXPO=${LIGHT.exposure};
const W=320, H=320, FOV=70, PITCH=-30;
const canvas=document.createElement('canvas'); canvas.width=W; canvas.height=H;
const renderer=new THREE.WebGLRenderer({canvas, antialias:false, alpha:true});
renderer.setPixelRatio(1); renderer.setSize(W,H,false); renderer.setClearColor(0x000000,0);
const rt=new THREE.WebGLRenderTarget(W,H,{format:THREE.RGBAFormat,type:THREE.UnsignedByteType,
  minFilter:THREE.NearestFilter, magFilter:THREE.NearestFilter, depthBuffer:true});
const buf=new Uint8Array(W*H*4);

// ⚠ DEM 없이 — 평판입니다. 그러면 지형 그림자는 정의상 0 이라, 땅이
//   얼룩진다면 원인은 오직 구름 그림자입니다.
const field=createTerrainField({patch:null, observerElevM:0, eyeHeightM:RENDER_EYE_M});
const scene=new THREE.Scene(); scene.add(field.mesh);
const cam=new THREE.PerspectiveCamera(FOV, 1, 0.1, 2000); cam.position.set(0,0,0);
updateTerrainFieldEye(field, cam);
const u=field.material.uniforms;
u.uSurfaceIrr.value.set(IRR[0],IRR[1],IRR[2]);
u.uSunRadiance.value.set(SUNR[0],SUNR[1],SUNR[2]);
u.uExposure.value=EXPO;
u.uAerial.value=0;
u.uSunAltDeg.value=RENDER_SUN_ALT; u.uSunAltRad.value=RENDER_SUN_ALT*Math.PI/180;
u.uSunAzRad.value=SUN_AZ*Math.PI/180;
const pr=PITCH*Math.PI/180, ar=RENDER_LOOK_AZ*Math.PI/180;
cam.up.set(0,1,0);
cam.lookAt(Math.sin(ar)*Math.cos(pr), Math.sin(pr), -Math.cos(ar)*Math.cos(pr));
cam.updateMatrixWorld(true);

function renderWith(tex, label){
  u.uCloudShadowTex.value=tex; u.uCloudShadowHalfM.value=CLOUD_SHADOW_HALF_M;
  u.uCloudShadow.value=1;
  renderer.setRenderTarget(rt); renderer.clear(); renderer.render(scene,cam);
  renderer.readRenderTargetPixels(rt,0,0,W,H,buf); renderer.setRenderTarget(null);
  renderer.render(scene,cam);
  const c=document.createElement('canvas'); c.width=W; c.height=H;
  c.style.width='160px'; c.style.height='160px';
  c.getContext('2d').drawImage(canvas,0,0);
  const d=document.createElement('div'); d.style.font='10px monospace'; d.textContent=label;
  document.getElementById('shots').appendChild(d);
  document.getElementById('shots').appendChild(c);
  const ls=[];
  for(let i=0;i<W*H;i++){ if(buf[i*4+3]<128) continue;
    ls.push(0.2126*buf[i*4]+0.7152*buf[i*4+1]+0.0722*buf[i*4+2]); }
  let m=0; for(const x of ls) m+=x; m/= (ls.length||1);
  let s=0; for(const x of ls) s+=(x-m)*(x-m);
  return {화소:ls.length, 평균:+m.toFixed(2), 표준편차:+Math.sqrt(s/(ls.length||1)).toFixed(3)};
}

결과.화면={
  맑음: renderWith(mapValues(맑음, RENDER_SUN_ALT, SUN_AZ).tex, '맑음'),
  온통흐림: renderWith(mapValues(온통흐림, RENDER_SUN_ALT, SUN_AZ).tex, '온통 흐림'),
  한덩이: renderWith(mapValues(한덩이, RENDER_SUN_ALT, SUN_AZ).tex, '구름 한 덩이 (해 45°)'),
};
// 대조: 지도를 물린 채 uCloudShadow 만 끕니다.
u.uCloudShadowTex.value=mapValues(한덩이, RENDER_SUN_ALT, SUN_AZ).tex;
u.uCloudShadow.value=0;
renderer.setRenderTarget(rt); renderer.clear(); renderer.render(scene,cam);
renderer.readRenderTargetPixels(rt,0,0,W,H,buf); renderer.setRenderTarget(null);
{ const ls=[]; for(let i=0;i<W*H;i++){ if(buf[i*4+3]<128) continue;
    ls.push(0.2126*buf[i*4]+0.7152*buf[i*4+1]+0.0722*buf[i*4+2]); }
  let m=0; for(const x of ls) m+=x; m/=(ls.length||1);
  let s=0; for(const x of ls) s+=(x-m)*(x-m);
  결과.화면.한덩이_끔={화소:ls.length, 평균:+m.toFixed(2), 표준편차:+Math.sqrt(s/(ls.length||1)).toFixed(3)}; }

document.getElementById('out').innerHTML='<p>'+JSON.stringify(결과)+'</p>';
window.__stats={ glError: renderer.getContext().getError(), 결과 };
window.__errors=errors;
document.title='DONE::'+(errors.length?'ERR':'OK')+'::'+renderer.getContext().getError();
</script></body></html>`;

fs.mkdirSync(PREVIEW, { recursive: true });
fs.writeFileSync(path.join(PREVIEW, 'cloud-ground.html'), html);
console.log('생성 완료: cloud-ground.html');
