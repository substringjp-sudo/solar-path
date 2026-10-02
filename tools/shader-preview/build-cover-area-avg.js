/**
 * **예보 운량이 화면 면적이 되는가 — 하늘 평균으로** (2026-10-01). `verify-cover-area-avg.js` 의 짝.
 *
 * 왜: `verify-layer-elev.js` 는 한 방향(방위 200° · 고도 45° · 흐름 0시)에서만 "예보 = 면적" 을 봅니다.
 * 모양장에는 수십 km 규모의 느린 항이 있어 한 자리는 그 자리 운에 달립니다. 하늘 전체(방위 8 · 고도 3 ·
 * 흐름 시각 여럿)로 평균하니 예보 25% 가 중층 0.61 · 저층 0.15 · 상층 0.15 였습니다 — `SHAPE_MEAN` 이 그 한
 * 자리에 맞춰져 있었습니다. 도코나메 밤(중층 20%)이 화면 50~90% 구름이 된 원인입니다.
 *
 * 쪽 주소 인자: ?drifts=0,12&azs=0,90,180,270&covers=0.1,0.5&mean=low:0.6,mid:0.4,high:0.5&sig=low:0.65,mid:0.65,high:0.99
 *   &pos=96&set=even|odd  (drifts 대신 — 자리마다 흐름·바람 방위를 함께 바꿉니다, 아래 SAMPLES)
 *   &els=20,45,70  (시야 고도)
 *   &clusterAmt=0.7 (군집 세기 덮어쓰기 — 진단용)
 *   &remap=identity  또는  &remap=low:v0|v1|…;mid:…;high:…  (CloudSlab COVER_KNOTS 마디마다 값 — 예보 운량 역표)
 * 결과: window.__out = [{layer, cover, area016, area1, n, skyPx, drift}] — 모든 시야의 **하늘 화소**(지평선 위)를
 * 모아 그중 구름 화소의 비율입니다. drift 는 흐름 시각마다 따로 낸 같은 비율(시각 순서대로)입니다.
 *
 * ⚠ 2026-10-02 고침: 처음에는 화면 전체 화소로 나눴습니다. 고도 20° 시야(세로 화각 60°)는 아래 1/6 쯤이
 *   지평선 밑이라 구름이 생길 수 없는데도 분모에 들어가, 운량 0.95·0.99 가 세 층 모두 **똑같이 0.938** 에서
 *   멈췄습니다(= 하늘 화소 비율). 예보 운량은 하늘의 몇 할이므로 분모는 하늘 화소입니다.
 *
 * 준비: node tools/shader-preview/stage-esm.js && node tools/shader-preview/build-cover-area-avg.js
 */
const fs = require('fs');
const path = require('path');
const { PREVIEW } = require('./paths');

const html = `<!doctype html><html><head><meta charset="utf-8"></head><body><script type="module">
import * as THREE from './app/vendor/three.module.js';
import { createCloudSlab, updateCloudSlab, bakeCloudSlabCoverage, IDENTITY_COVER_REMAP } from './app/components/SkyScene3D/CloudSlab.js';
import { makeAtmosphereParams, beamAtAltitude, applyTuningUniforms } from './app/utils/atmosphere.js';
const errors=[]; window.addEventListener('error',e=>errors.push(String(e.message)));
try {
const Q=new URLSearchParams(location.search);
const list=(k,d)=>(Q.get(k)||d).split(',').map(Number);
const kv=(k)=>{ const o={}; (Q.get(k)||'').split(',').filter(Boolean).forEach(s=>{ const [a,b]=s.split(':'); o[a]=Number(b); }); return o; };
const COVERS=list('covers','0.1,0.25,0.5,0.75,0.9');
// 표본 자리. pos=K&set=even|odd 면 자리 k(0..K-1)마다 흐름 k 시간 · 바람 방위 250°+k·137.5°(황금각)로
// 서로 다른 땅을 봅니다 — 흐름 시각만 바꾸면 바람 한 줄 위의 자리라, 잡음 격자의 주기(해시가 x 50칸)와
// 겹쳐 서로 독립이 아니었습니다. 없으면 예전처럼 drifts 목록(바람 250°).
const POSN=Number(Q.get('pos')||0), PSET=Q.get('set')||'all';
const SAMPLES = POSN>0
  ? Array.from({length:POSN},(_,k)=>k).filter(k=>PSET==='all'||(PSET==='even'?k%2===0:k%2===1)).map(k=>({dh:k, brg:(250+k*137.508)%360}))
  : list('drifts','0,12').map(dh=>({dh, brg:250}));
const LAYERS=(Q.get('layers')||'low,mid,high').split(',');
const AZS=list('azs','0,45,90,135,180,225,270,315'), ELS=list('els','20,45,70');
const W=60,H=80,D2R=Math.PI/180;
const dirOf=(alt,az)=>new THREE.Vector3(Math.cos(alt*D2R)*Math.sin(az*D2R),Math.sin(alt*D2R),-Math.cos(alt*D2R)*Math.cos(az*D2R)).normalize();
const canvas=document.createElement('canvas'); canvas.width=W; canvas.height=H;
const r=new THREE.WebGLRenderer({canvas,antialias:false,alpha:false}); r.setPixelRatio(1); r.setSize(W,H,false);
const gl=r.getContext();
const atm=makeAtmosphereParams({latitude:37.5,observerElevM:30,dayOfYear:250,humidityPct:65,visibilityM:25000});
// verify-layer-elev 와 같은 층별 바람(그쪽 판과 같은 조건에서 평균만 넓힙니다)
const windAt=(brg)=>({low:{speedKmh:30,bearingDeg:brg},mid:{speedKmh:51,bearingDeg:brg},high:{speedKmh:102,bearingDeg:brg}});
const remapQ=Q.get('remap'); let coverRemap;
if (remapQ==='identity') coverRemap=IDENTITY_COVER_REMAP;
else if (remapQ) { coverRemap={}; remapQ.split(';').filter(Boolean).forEach(s=>{ const [k,v]=s.split(':'); coverRemap[k]=v.split('|').map(Number); }); }
const slab=createCloudSlab({shapeMean:kv('mean'), shapeSigRatio:kv('sig'), coverRemap});
const scene=new THREE.Scene(); scene.add(slab.mesh);
scene.traverse(o=>{ if(o.material&&o.material.uniforms) applyTuningUniforms(o.material.uniforms); });
const buf=new Uint8Array(W*H*4); const out=[];
// 시야마다 하늘 화소(시선이 지평선 위) 표시. readPixels 는 아래 줄부터입니다.
const camOf=(el,az)=>{ const cam=new THREE.PerspectiveCamera(60,W/H,0.1,2000); const v=dirOf(el,az); cam.lookAt(v.x,v.y,v.z); cam.updateMatrixWorld(true); cam.updateProjectionMatrix(); return cam; };
const skyMask={};
for (const az of AZS) for (const el of ELS) {
  const cam=camOf(el,az), m=new Uint8Array(W*H), p=new THREE.Vector3();
  for (let j=0;j<H;j++) for (let i=0;i<W;i++) {
    p.set((i+0.5)/W*2-1,(j+0.5)/H*2-1,0.5).unproject(cam).sub(cam.position);
    m[j*W+i]=p.y>0?1:0;
  }
  skyMask[az+'_'+el]=m;
}
for (const L of LAYERS) for (const cv of COVERS) {
  bakeCloudSlabCoverage(slab,()=>({low:L==='low'?cv:0, mid:L==='mid'?cv:0, high:L==='high'?cv:0, confidence:1}));
  let s016=0,s1=0,sky=0,n=0; const byDrift={};
  for (const {dh,brg} of SAMPLES) for (const az of AZS) for (const el of ELS) {
    const bd=byDrift[dh]||(byDrift[dh]={c:0,s:0});
    const cam=camOf(el,az), m=skyMask[az+'_'+el];
    updateCloudSlab(slab,{camera:cam,widthPx:W,heightPx:H,sunDir:dirOf(30,200),sunAltDeg:30,sunAzDeg:200,
      beamFor:k=>beamAtAltitude(30,k,atm),atmosphere:atm,layerWinds:windAt(brg),driftHours:dh,visible:true,dataOut:2,
      ...(Q.get('clusterAmt')!=null?{clusterAmt:Number(Q.get('clusterAmt'))}:{})});
    r.setRenderTarget(null); r.setClearColor(0x000000,1); r.render(scene,cam);
    gl.readPixels(0,0,W,H,gl.RGBA,gl.UNSIGNED_BYTE,buf);
    for(let i=0;i<W*H;i++){ if(!m[i]) continue; sky++; bd.s++; const t=buf[i*4]/255*40; if(t>=0.16){s016++; bd.c++;} if(t>=1)s1++; }
    n++;
  }
  // 흐름 시각마다의 하늘 평균 면적 — 시각에 따라 얼마나 흔들리는가를 봅니다.
  const drift=SAMPLES.map(({dh})=>+(byDrift[dh].c/byDrift[dh].s).toFixed(4));
  out.push({layer:L, cover:cv, area016:s016/sky, area1:s1/sky, n, skyPx:sky, drift});
}
window.__out=out; window.__glError=gl.getError();
} catch(e){ errors.push('예외: '+(e&&e.stack||e)); }
window.__errors=errors; document.title='DONE::'+(errors.length?'ERR':'OK');
</script></body></html>`;
fs.writeFileSync(path.join(PREVIEW, 'cover-area-avg.html'), html);
console.log('생성 완료: cover-area-avg.html');
