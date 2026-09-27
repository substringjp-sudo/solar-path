/**
 * **구름 무늬의 늘어남은 바람이 아니라 바람 시어에서** (§109) — 층마다 따로, 천정을 올려다봅니다.
 *
 * 사용자: "바람에 따라 구름을 길게 늘리는 처리를 하는걸로 아는데 이게 너무 과하고 또 고도별로 방향이
 * 다르면 층마다 다른 방향의 구름이 너무 눈에 띄게 차이가 나서 중구난방으로 보이는 것 같아."
 *
 * `verify-layer-grain` 은 세 층에 **같은** 바람을 줘서 시어를 못 봅니다. 여기서는 층별 바람을 다르게
 * 줍니다(단위 km/h, 방위는 앱의 layerWinds 와 같은 규약):
 *   S0 시어 없음  — 세 층 같은 바람 60 @ 260°
 *   S1 보통       — 대용값(22 · 37.4 · 74.8 @ 260°) — 상층 시어 약 1.9 m/s/km
 *   S2 강한 제트  — 22 · 40 · 180 @ 260° — 상층 시어 약 7 m/s/km
 *   S3 도는 바람  — 20@180 · 40@220 · 90@300 — 시어 방향이 상층 바람 방향과 다름
 *   S4 극단 시어(중층) — 10 · 300 · 300 @ 260° — 중층 Ri < 0.25 (양성 대조)
 * 천정(시선 90°, 위 = 북)을 올려다보면 화면 축이 곧 지상 축이라 무늬 방향을 지상 각으로 읽습니다.
 * 자: 구조 텐서의 주방향과 결집도(0 등방, 1 줄무늬) — verify-layer-grain 과 같은 식.
 *
 * 준비: node tools/shader-preview/stage-esm.js
 * 사용: node tools/shader-preview/build-shear-grain.js
 *       node tools/shader-preview/verify-shear-grain.js
 */
const fs = require('fs');
const path = require('path');
const { PREVIEW } = require('./paths');

const TW = 220, TH = 220;
const html = `<!doctype html><html><head><meta charset="utf-8"></head><body><script type="module">
import * as THREE from './app/vendor/three.module.js';
import { createCloudSlab, updateCloudSlab, bakeCloudSlabCoverage } from './app/components/SkyScene3D/CloudSlab.js';
import { makeAtmosphereParams, beamAtAltitude } from './app/utils/atmosphere.js';
const errors=[]; window.addEventListener('error',e=>errors.push(e.message));
try {
const TW=${TW}, TH=${TH}, SUN_ALT=35, SUN_AZ=200;
const atmosphere=makeAtmosphereParams({latitude:37.5,observerElevM:30,dayOfYear:240,humidityPct:62,visibilityM:24000});
const canvas=document.createElement('canvas'); canvas.width=TW; canvas.height=TH;
const r=new THREE.WebGLRenderer({canvas,antialias:false,alpha:false}); r.setPixelRatio(1); r.setSize(TW,TH,false);
const gl=r.getContext();
const W=(s,b)=>({speedKmh:s,bearingDeg:b});
const SC={
  S0:{low:W(60,260),mid:W(60,260),high:W(60,260)},
  S1:{low:W(22,260),mid:W(37.4,260),high:W(74.8,260)},
  S2:{low:W(22,260),mid:W(40,260),high:W(180,260)},
  S3:{low:W(20,180),mid:W(40,220),high:W(90,300)},
  S4:{low:W(10,260),mid:W(300,260),high:W(300,260)},
};
// 앱의 setWind 와 같은 규약의 벡터(동, 남) — 무늬 축 각을 지상에서 셉니다.
const vec=(w)=>{ const a=w.bearingDeg*Math.PI/180; return [w.speedKmh*Math.sin(a), -w.speedKmh*Math.cos(a)]; };
const axisDeg=(v)=>{ let a=Math.atan2(v[1], v[0])*180/Math.PI; a=((a%180)+180)%180; return a; };
const cam=new THREE.PerspectiveCamera(60,1,0.1,2000); cam.up.set(0,0,-1); cam.lookAt(0,100,0); cam.updateMatrixWorld(true);
const lum=(b,p)=>0.2126*b[p*4]+0.7152*b[p*4+1]+0.0722*b[p*4+2];
function grain(buf){
  let jxx=0,jyy=0,jxy=0; const m=Math.round(TH*0.12);
  for(let y=m;y<TH-m;y++) for(let x=m;x<TW-m;x++){ const i=y*TW+x;
    const gx=lum(buf,i+1)-lum(buf,i-1), gy=lum(buf,i+TW)-lum(buf,i-TW); jxx+=gx*gx; jyy+=gy*gy; jxy+=gx*gy; }
  const tr=jxx+jyy, diff=Math.sqrt((jxx-jyy)**2+4*jxy*jxy);
  // 위를 보고 위쪽을 북으로 두면 화면 오른쪽은 **서**(하늘 지도처럼 동이 왼쪽)이고 화면 위는 북입니다.
  // 화면 (x, y) = (−동, −남) — 두 축이 다 뒤집히므로 **축의 각(180° 주기)은 그대로**입니다.
  const gAng=0.5*Math.atan2(2*jxy, jxx-jyy)*180/Math.PI;
  let ang=(gAng+90)%180; if(ang<0) ang+=180;
  return { axis:+ang.toFixed(1), coh:+(tr>1e-6?diff/tr:0).toFixed(4) };
}
const LAYERS=[['high',{low:0,mid:0,high:0.5}],['mid',{low:0,mid:0.5,high:0}],['low',{low:0.5,mid:0,high:0}]];
const out={}, shots=[];
for (const [sk, winds] of Object.entries(SC)) { out[sk]={};
  for (const [lk, mean] of LAYERS) {
    const scene=new THREE.Scene(); const slab=createCloudSlab(); scene.add(slab.mesh);
    bakeCloudSlabCoverage(slab,()=>({...mean, confidence:1, lowGenus:0}));
    const a=SUN_ALT*Math.PI/180, z=SUN_AZ*Math.PI/180;
    updateCloudSlab(slab,{camera:cam,widthPx:TW,heightPx:TH,sunDir:new THREE.Vector3(Math.cos(a)*Math.sin(z),Math.sin(a),-Math.cos(a)*Math.cos(z)),
      sunAltDeg:SUN_ALT,sunAzDeg:SUN_AZ,beamFor:k=>beamAtAltitude(SUN_ALT,k,atmosphere),atmosphere,layerWinds:winds,driftHours:0,visible:true});
    r.setClearColor(0x000000,1); r.render(scene,cam);
    const b=new Uint8Array(TW*TH*4); gl.readPixels(0,0,TW,TH,gl.RGBA,gl.UNSIGNED_BYTE,b);
    out[sk][lk]=grain(b);
    if (sk==='S1' || sk==='S3') { const img=[]; for(let y=TH-1;y>=0;y--) for(let x=0;x<TW;x++){ const i=(y*TW+x)*4; img.push(b[i],b[i+1],b[i+2]); } shots.push({sk,lk,img}); }
    slab.dispose && slab.dispose();
  }
  const vh=vec(winds.high), vm=vec(winds.mid);
  out[sk].shearAxisHigh = axisDeg([vh[0]-vm[0], vh[1]-vm[1]]);
  out[sk].windAxisHigh = axisDeg(vh);
}
window.__stats={out, shots, TW, TH, glError:gl.getError()};
} catch(e){ errors.push('예외: '+(e&&e.stack||e)); }
window.__errors=errors; document.title='DONE::'+(errors.length?'ERR':'OK');
</script></body></html>`;
fs.writeFileSync(path.join(PREVIEW, 'shear-grain.html'), html);
console.log('생성 완료: shear-grain.html');
