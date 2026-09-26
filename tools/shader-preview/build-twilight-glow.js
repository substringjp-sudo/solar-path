/**
 * **노을 무렵, 해쪽 먼 구름이 낮은 햇빛을 가리는가** (§103) — 앱이 그리는 CloudSlab 으로.
 *
 * 사용자 제안: "태양이 있는 방향에서 낮은 구름에 해당하는 먼 거리에 구름이 있으면 어둡게,
 * 없으면 밝게."
 *
 * 두 시선으로 봅니다(판정은 side):
 *  - side: 해쪽 지평선 가까이(시선 7°, 고도 4° 위 화소 = 저층 21km 안). 가까운 30km 안은 같은
 *    저층(운량 0.6), 달라지는 것은 **30km 밖**뿐 — 노을에 구름 옆면이 타오르는지를 보는 자리.
 *  - up(참고): 해쪽 35° 로 밑면을 올려다봄(6km 안이 구름). ⚠ 처음엔 이 시선으로 판정했는데,
 *    밑면은 해가 떠 있어도 직달 몫이 3~4% 뿐이라(자료 2 로 잼) 먼 구름이 직달을 92% 막아도
 *    밝기는 7% 만 줄었습니다. 재는 자리가 틀렸던 것이라 side 로 옮기고 문턱은 그대로 뒀습니다.
 * 두 경우는
 *   A 해쪽 먼 곳이 맑음   B 해쪽 먼 곳도 구름(0.6)
 * 가까운 구름은 두 경우 화소 하나까지 같은 장이므로, 밝기 차는 먼 구름이 가린 햇빛뿐입니다.
 * 태양 −1°(관측자에겐 졌지만 1.5km 저층에는 아직 +0.25° 로 떠 있는 노을 빛), +5°(대조 —
 * 광선이 몇 km 안에 층을 벗어남), −9°(참고 — 저층도 지구 그림자)에서 찍습니다.
 * ⚠ verify-twilight-layers 는 앱이 숨긴 CloudDeck 을 재므로 이 효과를 못 봅니다.
 *
 * 준비: node tools/shader-preview/stage-esm.js
 * 사용: node tools/shader-preview/build-twilight-glow.js
 *       node tools/shader-preview/verify-twilight-glow.js
 */
const fs = require('fs');
const path = require('path');
const { PREVIEW } = require('./paths');

const html = `<!doctype html><html><head><meta charset="utf-8"></head><body><script type="module">
import * as THREE from './app/vendor/three.module.js';
import { createCloudSlab, updateCloudSlab, bakeCloudSlabCoverage } from './app/components/SkyScene3D/CloudSlab.js';
import { makeAtmosphereParams, beamAtAltitude } from './app/utils/atmosphere.js';
const errors=[]; window.addEventListener('error',e=>errors.push(e.message));
try {
const D2R=Math.PI/180, W=200, H=200, SUN_AZ=270;
const atmosphere=makeAtmosphereParams({latitude:37.5,observerElevM:30,dayOfYear:200,humidityPct:60,visibilityM:20000});
const canvas=document.createElement('canvas'); canvas.width=W; canvas.height=H;
const r=new THREE.WebGLRenderer({canvas,antialias:false,alpha:false}); r.setPixelRatio(1); r.setSize(W,H,false);
const gl=r.getContext();
const dirOf=(alt,az)=>new THREE.Vector3(Math.cos(alt*D2R)*Math.sin(az*D2R),Math.sin(alt*D2R),-Math.cos(alt*D2R)*Math.cos(az*D2R)).normalize();
// view: 'up' = 해쪽 35° 로 올려다봄(밑면, 관측자 둘레 6km 안이 구름) · 'side' = 해쪽 지평선 가까이
// (시선 7°, 고도 4° 위 화소만 셈 → 저층 1.5km 까지 21km 안). side 에서 A/B 가 다른 것은 **30km 밖**뿐.
const shoot=(sunAlt, farCloudy, dataOut, view)=>{
  const scene=new THREE.Scene();
  const slab=createCloudSlab(); scene.add(slab.mesh);
  const nearKm = view==='up' ? 6 : 30;
  bakeCloudSlabCoverage(slab,(az,d)=>({low: d<nearKm ? 0.6 : (farCloudy ? 0.6 : 0), mid:0, high:0, confidence:1, lowGenus:0}));
  const cam=new THREE.PerspectiveCamera(view==='up'?30:20,1,0.1,2000); cam.up.set(0,1,0);
  const v=dirOf(view==='up'?35:7,SUN_AZ); cam.lookAt(v.x,v.y,v.z); cam.updateMatrixWorld(true);
  const w={speedKmh:0,bearingDeg:0};
  updateCloudSlab(slab,{camera:cam,widthPx:W,heightPx:H,sunDir:dirOf(sunAlt,SUN_AZ),sunAltDeg:sunAlt,sunAzDeg:SUN_AZ,
    beamFor:k=>beamAtAltitude(sunAlt,k,atmosphere),atmosphere,layerWinds:{low:w,mid:w,high:w},driftHours:0,visible:true,dataOut});
  r.setClearColor(0x000000,1); r.render(scene,cam);
  const b=new Uint8Array(W*H*4); gl.readPixels(0,0,W,H,gl.RGBA,gl.UNSIGNED_BYTE,b);
  slab.dispose && slab.dispose(); return {b, cam}; };
const elevOfRow=(cam,y)=>{ const p=new THREE.Vector3(0,(y+0.5)/H*2-1,0.5).unproject(cam).normalize(); return Math.asin(p.y)/D2R; };
const out={};
for (const view of ['side','up']) { out[view]={};
for (const sunAlt of [-1,5,-9]) {
  // 구름 화소: 두 경우 모두 알파가 있는 곳(자료 1 = 미합성 표시색 · 알파). 자료 2 의 B = 직달 몫.
  const A=shoot(sunAlt,false,1,view), B=shoot(sunAlt,true,1,view);
  const A2=shoot(sunAlt,false,2,view), B2=shoot(sunAlt,true,2,view);
  const a=A.b, b=B.b;
  let la=0, lb=0, sa=0, sb=0, n=0;
  for(let y=0;y<H;y++){ if (view==='side' && elevOfRow(A.cam,y) < 4) continue;
   for(let x=0;x<W;x++){ const k=(y*W+x)*4; if (a[k+3] < 128 || b[k+3] < 128) continue;
    la+=0.2126*a[k]+0.7152*a[k+1]+0.0722*a[k+2]; lb+=0.2126*b[k]+0.7152*b[k+1]+0.0722*b[k+2];
    sa+=A2.b[k+2]/255; sb+=B2.b[k+2]/255; n++; } }
  out[view][sunAlt]={clearFar:la/Math.max(1,n), cloudyFar:lb/Math.max(1,n), sunFracClear:sa/Math.max(1,n), sunFracCloudy:sb/Math.max(1,n), n};
} }
window.__stats={out, glError:gl.getError()};
} catch(e){ errors.push('예외: '+(e&&e.stack||e)); }
window.__errors=errors; document.title='DONE::'+(errors.length?'ERR':'OK');
</script></body></html>`;
fs.writeFileSync(path.join(PREVIEW, 'twilight-glow.html'), html);
console.log('생성 완료: twilight-glow.html');
