/**
 * **예보 운량이 화면 면적이 되는가 — 하늘 평균으로** (2026-10-01). `verify-cover-area-avg.js` 의 짝.
 *
 * 왜: `verify-layer-elev.js` 는 한 방향(방위 200° · 고도 45° · 흐름 0시)에서만 "예보 = 면적" 을 봅니다.
 * 모양장에는 수십 km 규모의 느린 항이 있어 한 자리는 그 자리 운에 달립니다. 하늘 전체(방위 8 · 고도 3 ·
 * 흐름 시각 여럿)로 평균하니 예보 25% 가 중층 0.61 · 저층 0.15 · 상층 0.15 였습니다 — `SHAPE_MEAN` 이 그 한
 * 자리에 맞춰져 있었습니다. 도코나메 밤(중층 20%)이 화면 50~90% 구름이 된 원인입니다.
 *
 * 쪽 주소 인자: ?drifts=0,12&covers=0.1,0.5&mean=low:0.6,mid:0.4,high:0.5&sig=low:0.65,mid:0.65,high:0.99
 * 결과: window.__out = [{layer, cover, area016, area1, n}] (방위·고도·흐름 평균).
 *
 * 준비: node tools/shader-preview/stage-esm.js && node tools/shader-preview/build-cover-area-avg.js
 */
const fs = require('fs');
const path = require('path');
const { PREVIEW } = require('./paths');

const html = `<!doctype html><html><head><meta charset="utf-8"></head><body><script type="module">
import * as THREE from './app/vendor/three.module.js';
import { createCloudSlab, updateCloudSlab, bakeCloudSlabCoverage } from './app/components/SkyScene3D/CloudSlab.js';
import { makeAtmosphereParams, beamAtAltitude, applyTuningUniforms } from './app/utils/atmosphere.js';
const errors=[]; window.addEventListener('error',e=>errors.push(String(e.message)));
try {
const Q=new URLSearchParams(location.search);
const list=(k,d)=>(Q.get(k)||d).split(',').map(Number);
const kv=(k)=>{ const o={}; (Q.get(k)||'').split(',').filter(Boolean).forEach(s=>{ const [a,b]=s.split(':'); o[a]=Number(b); }); return o; };
const DRIFTS=list('drifts','0,12'), COVERS=list('covers','0.1,0.25,0.5,0.75,0.9');
const LAYERS=(Q.get('layers')||'low,mid,high').split(',');
const AZS=[0,45,90,135,180,225,270,315], ELS=[20,45,70];
const W=60,H=80,D2R=Math.PI/180;
const dirOf=(alt,az)=>new THREE.Vector3(Math.cos(alt*D2R)*Math.sin(az*D2R),Math.sin(alt*D2R),-Math.cos(alt*D2R)*Math.cos(az*D2R)).normalize();
const canvas=document.createElement('canvas'); canvas.width=W; canvas.height=H;
const r=new THREE.WebGLRenderer({canvas,antialias:false,alpha:false}); r.setPixelRatio(1); r.setSize(W,H,false);
const gl=r.getContext();
const atm=makeAtmosphereParams({latitude:37.5,observerElevM:30,dayOfYear:250,humidityPct:65,visibilityM:25000});
// verify-layer-elev 와 같은 층별 바람(그쪽 판과 같은 조건에서 평균만 넓힙니다)
const WIND={low:{speedKmh:30,bearingDeg:250},mid:{speedKmh:51,bearingDeg:250},high:{speedKmh:102,bearingDeg:250}};
const slab=createCloudSlab({shapeMean:kv('mean'), shapeSigRatio:kv('sig')});
const scene=new THREE.Scene(); scene.add(slab.mesh);
scene.traverse(o=>{ if(o.material&&o.material.uniforms) applyTuningUniforms(o.material.uniforms); });
const buf=new Uint8Array(W*H*4); const out=[];
for (const L of LAYERS) for (const cv of COVERS) {
  bakeCloudSlabCoverage(slab,()=>({low:L==='low'?cv:0, mid:L==='mid'?cv:0, high:L==='high'?cv:0, confidence:1}));
  let a016=0,a1=0,n=0;
  for (const dh of DRIFTS) for (const az of AZS) for (const el of ELS) {
    const cam=new THREE.PerspectiveCamera(60,W/H,0.1,2000); const v=dirOf(el,az); cam.lookAt(v.x,v.y,v.z); cam.updateMatrixWorld(true);
    updateCloudSlab(slab,{camera:cam,widthPx:W,heightPx:H,sunDir:dirOf(30,200),sunAltDeg:30,sunAzDeg:200,
      beamFor:k=>beamAtAltitude(30,k,atm),atmosphere:atm,layerWinds:WIND,driftHours:dh,visible:true,dataOut:2});
    r.setRenderTarget(null); r.setClearColor(0x000000,1); r.render(scene,cam);
    gl.readPixels(0,0,W,H,gl.RGBA,gl.UNSIGNED_BYTE,buf);
    let s016=0,s1=0; for(let i=0;i<W*H;i++){ const t=buf[i*4]/255*40; if(t>=0.16)s016++; if(t>=1)s1++; }
    a016+=s016/(W*H); a1+=s1/(W*H); n++;
  }
  out.push({layer:L, cover:cv, area016:a016/n, area1:a1/n, n});
}
window.__out=out; window.__glError=gl.getError();
} catch(e){ errors.push('예외: '+(e&&e.stack||e)); }
window.__errors=errors; document.title='DONE::'+(errors.length?'ERR':'OK');
</script></body></html>`;
fs.writeFileSync(path.join(PREVIEW, 'cover-area-avg.html'), html);
console.log('생성 완료: cover-area-avg.html');
