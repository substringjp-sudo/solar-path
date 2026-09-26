/**
 * **앱을 내렸다 올리거나 오래 쓰면 지형이 사라지던 것** — DEM 캐시와 GL 컨텍스트.
 *
 * DEM 패치는 렌더 타깃입니다 — 화소가 **그걸 만든 GL 컨텍스트 안에만** 있습니다. 예전 캐시는
 * 모듈 하나를 모든 씬이 나눠 써서:
 *  (1) 두 번째 씬(카메라 화면, 또는 컨텍스트를 새로 받은 같은 씬)이 첫 씬의 패치를 그대로
 *      돌려받았고 — 그 컨텍스트에서는 빈 높이장입니다.
 *  (2) 한 씬이 내려가며 `clearDemCache()` 를 부르면 다른 씬이 쓰던 패치까지 지웠습니다.
 *
 * 두 캔버스(= 두 GL 컨텍스트)로 앱의 두 씬을 흉내 내고, 패치를 **각 렌더러로 읽어 봅니다.**
 * 타일은 합성 고도(테라리움 부호화)라 망이 필요 없습니다.
 *
 * 준비: node tools/shader-preview/stage-esm.js
 * 사용: node tools/shader-preview/build-dem-context.js
 *       node tools/shader-preview/verify-dem-context.js
 */
const fs = require('fs');
const path = require('path');
const { PREVIEW } = require('./paths');

const html = `<!doctype html><html><head><meta charset="utf-8"></head><body><script type="module">
import * as THREE from './app/vendor/three.module.js';
import { loadDemPatch, clearDemCache } from './app/utils/demTiles.js';
const errors=[]; window.addEventListener('error',e=>errors.push(e.message));
window.addEventListener('unhandledrejection', e=>errors.push(String(e.reason&&e.reason.message||e.reason)));
try {
const mk=()=>{ const c=document.createElement('canvas'); c.width=64; c.height=64;
  const r=new THREE.WebGLRenderer({canvas:c,antialias:false}); r.setPixelRatio(1); r.setSize(64,64,false); return r; };
const A=mk(), B=mk();   // A = 하늘 탭의 씬, B = 카메라 화면의 씬(또는 새 컨텍스트)
// 합성 타일: 고도 ≈ 500m 근처의 완만한 기울기(테라리움 v = R*256 + G + B/256 - 32768).
const loadTexture=async()=>{ const n=256, d=new Uint8Array(n*n*4);
  for(let y=0;y<n;y++) for(let x=0;x<n;x++){ const h=500+x+y, v=h+32768, i=(y*n+x)*4;
    d[i]=Math.floor(v/256); d[i+1]=Math.floor(v)%256; d[i+2]=0; d[i+3]=255; }
  const t=new THREE.DataTexture(d,n,n,THREE.RGBAFormat); t.needsUpdate=true; return t; };
const opts=(r)=>({renderer:r, loadTexture, block:3});
// 패치 텍스처를 렌더러 r 로 그려 읽은 평균 R (0 이면 빈 높이장).
const probe=(r, tex)=>{ const rt=new THREE.WebGLRenderTarget(16,16); const s=new THREE.Scene();
  s.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2), new THREE.MeshBasicMaterial({map:tex})));
  const cam=new THREE.OrthographicCamera(-1,1,1,-1,-1,1);
  r.setRenderTarget(rt); r.setClearColor(0x000000,1); r.clear(); r.render(s,cam); r.setRenderTarget(null);
  const px=new Uint8Array(16*16*4); r.readRenderTargetPixels(rt,0,0,16,16,px);
  let m=0; for(let i=0;i<px.length;i+=4) m+=px[i]; rt.dispose(); return m/256; };
const LAT=36.3, LON=137.9, R=3000;
const out={};
const pA=await loadDemPatch(LAT,LON,R,opts(A));
out.aInA=probe(A,pA.texture);
const pB=await loadDemPatch(LAT,LON,R,opts(B));
out.sameObject = pA===pB;
out.bInB=probe(B,pB.texture);
out.aInB=probe(B,pA.texture);          // 대조: 남의 컨텍스트 패치는 빈 높이장
// 카메라 화면(B)이 내려감 — 이제는 B 몫만 버립니다.
clearDemCache(B);
out.aAfterClearB=probe(A,pA.texture);
const pA2=await loadDemPatch(LAT,LON,R,opts(A));
out.aCacheKept = pA2===pA;
// 대조: 예전처럼 전부 버리면 A 가 쓰던 패치가 사라집니다.
clearDemCache();
out.aAfterClearAll=probe(A,pA.texture);
// 컨텍스트를 새로 받은 뒤(= 새 렌더러) 다시 받으면 새 패치이고 읽힙니다.
const C=mk();
const pC=await loadDemPatch(LAT,LON,R,opts(C));
out.cFresh = pC!==pA && pC!==pB;
out.cInC=probe(C,pC.texture);
window.__stats={out, glError:A.getContext().getError()};
} catch(e){ errors.push('예외: '+(e&&e.stack||e)); }
window.__errors=errors; document.title='DONE::'+(errors.length?'ERR':'OK');
</script></body></html>`;
fs.writeFileSync(path.join(PREVIEW, 'dem-context.html'), html);
console.log('생성 완료: dem-context.html');
