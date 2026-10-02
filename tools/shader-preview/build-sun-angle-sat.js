/**
 * **해에서 멀어질수록 하늘 채도가 어떻게 변하는가** (2026-10-02) — 렌더 쪽. `verify-sun-angle-sat.js` 의 짝.
 *
 * 사진 쪽(`tools/photo-ref/measure-sun-angle.js`)과 **같은 방법**으로 잽니다: 화소마다 해와의 각을 내고,
 * 각 구간(3–8 · 8–14 · 14–20 · 20–28 · 28–36 · 36–46°)마다 HSV 채도의 중앙값. 날아간 화소(세 채널 ≥ 245)와
 * 지평선 아래는 뺍니다. 하늘돔만 그립니다(맑은 하늘) — 앱과 같은 셰이더·같은 화면 사상입니다.
 *
 * 장면: 낮(해 35°, 카메라를 해에 맞춤) · 노을(해 1°, 해가 화면 아래쪽에 오게 카메라를 20° 들어 올림 — 사진의
 * 노을 장면처럼 해 위쪽 하늘을 봅니다). 화각 65°(사진 쪽 중앙값과 같은 대역).
 *
 * 준비: node tools/shader-preview/stage-esm.js && node tools/shader-preview/build-sun-angle-sat.js
 */
const fs = require('fs');
const path = require('path');
const { PREVIEW } = require('./paths');

const html = `<!doctype html><html><head><meta charset="utf-8"></head><body><script type="module">
import * as THREE from './app/vendor/three.module.js';
import { createSkydome, updateSkydome } from './app/components/SkyScene3D/Skydome.js';
import { makeAtmosphereParams, applyTuningUniforms } from './app/utils/atmosphere.js';
const errors=[]; window.addEventListener('error',e=>errors.push(String(e.message)));
try {
const W=320, H=240, FOV_H=65, D2R=Math.PI/180, SUN_AZ=250;
const BINS=[[3,8],[8,14],[14,20],[20,28],[28,36],[36,46]];
const dirOf=(alt,az)=>new THREE.Vector3(Math.cos(alt*D2R)*Math.sin(az*D2R),Math.sin(alt*D2R),-Math.cos(alt*D2R)*Math.cos(az*D2R)).normalize();
const canvas=document.createElement('canvas'); canvas.width=W; canvas.height=H;
const r=new THREE.WebGLRenderer({canvas,antialias:false,alpha:false}); r.setPixelRatio(1); r.setSize(W,H,false);
const gl=r.getContext();
const vfov=2*Math.atan(Math.tan(FOV_H/2*D2R)*H/W)/D2R;
const CASES=[{name:'day', sun:35, camEl:35}, {name:'sunset', sun:1, camEl:21}];
const out=[]; const buf=new Uint8Array(W*H*4);
for (const C of CASES) {
  const atm=makeAtmosphereParams({latitude:37.5,observerElevM:30,dayOfYear:250,humidityPct:55,visibilityM:30000});
  const scene=new THREE.Scene(); const sky=createSkydome(); scene.add(sky.mesh);
  updateSkydome(sky, C.sun, SUN_AZ, atm);
  scene.traverse(o=>{ if(o.material&&o.material.uniforms) applyTuningUniforms(o.material.uniforms); });
  const cam=new THREE.PerspectiveCamera(vfov,W/H,0.1,5000); const v=dirOf(C.camEl,SUN_AZ); cam.lookAt(v.x,v.y,v.z); cam.updateMatrixWorld(true); cam.updateProjectionMatrix();
  r.setRenderTarget(null); r.setClearColor(0x000000,1); r.render(scene,cam);
  gl.readPixels(0,0,W,H,gl.RGBA,gl.UNSIGNED_BYTE,buf);
  const sd=dirOf(C.sun,SUN_AZ), p=new THREE.Vector3(); const acc=BINS.map(()=>[]);
  for (let j=0;j<H;j++) for (let i=0;i<W;i++) {
    p.set((i+0.5)/W*2-1,(j+0.5)/H*2-1,0.5).unproject(cam).sub(cam.position).normalize();
    if (p.y<0.01) continue;
    const k=(j*W+i)*4, R=buf[k], G=buf[k+1], B=buf[k+2];
    if (Math.min(R,G,B)>=245 || Math.max(R,G,B)<25) continue;
    const ang=Math.acos(Math.min(1,p.dot(sd)))/D2R; const bi=BINS.findIndex(([a,c])=>ang>=a&&ang<c); if(bi<0) continue;
    const mx=Math.max(R,G,B), mn=Math.min(R,G,B); acc[bi].push(mx>0?(mx-mn)/mx:0);
  }
  const med=a=>{ if(a.length<50) return null; const s=[...a].sort((x,y)=>x-y); return +s[Math.floor(s.length/2)].toFixed(3); };
  out.push({name:C.name, sunAlt:C.sun, prof:acc.map(med), n:acc.map(a=>a.length), img:Array.from(buf)});
}
window.__out=out; window.__glError=gl.getError();
} catch(e){ errors.push('예외: '+(e&&e.stack||e)); }
window.__errors=errors; document.title='DONE::'+(errors.length?'ERR':'OK');
</script></body></html>`;
fs.writeFileSync(path.join(PREVIEW, 'sun-angle-sat.html'), html);
console.log('생성 완료: sun-angle-sat.html');
