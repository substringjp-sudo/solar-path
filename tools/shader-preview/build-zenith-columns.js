/**
 * **천정 부챗살 — 앱과 같은 길(기둥 → 운량장)로 재현합니다** (§101).
 *
 * §48·§53 의 자 셋이 실패한 까닭: 그 하네스들은 운량장을 **팬(`WeatherFan`)에서 곧장**
 * 구웠습니다. 팬은 관측점(0km) 표본을 모든 레이에 달아 두어 천정에서 한 값으로 모입니다 —
 * 결함이 날 수가 없었습니다. 앱은 팬 → `buildSkyColumns`(방위 24 × 등입체각 고도 8, 순위
 * 사상으로 U자 구조) → `coverageFromSamples` 를 거칩니다. 기둥의 맨 윗 고도가 69.6° 라
 * 그 안쪽(고도 70° 위)은 거리 클램프로 **방위마다 다른** 맨 안쪽 고리 값을 받았고, 24방위의
 * 값이 천정 한 점으로 모였습니다.
 *
 * 사용자 화면(마쓰모토 2026-09-25 13:08, 시선 276° · +82°, 상층운 84%)과 같은 조건으로
 * 옛 조회(맨 안쪽 고리로 클램프)와 새 조회를 둘 다 굽습니다.
 *  - 운량장 자: 천정 둘레 원(지상 반지름 d)을 따라 상층 운량의 표준편차.
 *  - 화면 자: 천정을 정면으로 보고 광학두께(dataOut 2)를 원(각반지름 1°·8°)을 따라 뜬 표준편차의
 *    비. 매끄러운 장이면 작은 원에서 작아지고(≈ 반지름에 비례), 한 점으로 모이는 장이면 반지름과
 *    무관하게 같습니다. 대조로 천정이 아닌 점(고도 55°)에서도 잽니다.
 *
 * 준비: node tools/shader-preview/stage-esm.js
 * 사용: node tools/shader-preview/build-zenith-columns.js
 *       node tools/shader-preview/verify-zenith-columns.js
 */
const fs = require('fs');
const path = require('path');
const { PREVIEW } = require('./paths');

const html = `<!doctype html><html><head><meta charset="utf-8"></head><body><script type="module">
import * as THREE from './app/vendor/three.module.js';
import { createSkydome, updateSkydome } from './app/components/SkyScene3D/Skydome.js';
import { createCloudSlab, updateCloudSlab, bakeCloudSlabCoverage, coverageFromSamples } from './app/components/SkyScene3D/CloudSlab.js';
import { WeatherFan, buildSkyColumns } from './app/utils/skyColumn.js';
import { makeAtmosphereParams, beamAtAltitude } from './app/utils/atmosphere.js';
const errors=[]; window.addEventListener('error',e=>errors.push(e.message));
try {
const D2R=Math.PI/180;
const SUN_ALT=47.5, SUN_AZ=205;           // 마쓰모토 2026-09-25 13:08 (SunCalc)
const atmosphere=makeAtmosphereParams({latitude:36.3,observerElevM:545,dayOfYear:268,humidityPct:70,visibilityM:20000});
// 팬: 앱의 API 팬 모양(태양 방위 ±20°, 거리 10~380km) — 레이마다 조금씩 다른 예보.
const OFFSETS=[-20,-10,0,10,20], DISTS=[10,30,70,130,200,280,380];
const pts=[];
const pt=(d,off)=>{ const w=Math.sin(d/60+off*0.11), v=Math.cos(d/45-off*0.07);
  return { distance:d, azimuthOffset:off, low:Math.max(0,Math.min(100,25+15*w)), mid:Math.max(0,Math.min(100,35+20*v)),
    high:Math.max(0,Math.min(100,84+12*w*v)), humidity:70, precipitation:0, visibility:20000 }; };
pts.push({...pt(0,0), low:20, mid:30, high:84});
for (const off of OFFSETS) for (const d of DISTS) pts.push(pt(d,off));
const fan=new WeatherFan(pts, SUN_AZ);
const samples=buildSkyColumns({fan, driftMinutes:0, windSpeedKmh:20, windBearingDeg:250});
const srcNew=coverageFromSamples(samples);
const innerKm={}; for (const L of ['low','mid','high']) innerKm[L]=Math.min(...samples.filter(s=>s.layer===L).map(s=>s.distanceKm));
// 옛 조회: 맨 안쪽 고리보다 가까우면 그 방위의 고리 값(거리 클램프). 고리 밖은 새 조회와 같습니다.
const srcOld=(az,d)=>{ const lo=srcNew(az,Math.max(d,innerKm.low)), mi=srcNew(az,Math.max(d,innerKm.mid)), hi=srcNew(az,Math.max(d,innerKm.high));
  return { low:lo.low, mid:mi.mid, high:hi.high, confidence:Math.max(lo.confidence,mi.confidence,hi.confidence), lowGenus:lo.lowGenus }; };
// 운량장 자 — 천정 둘레 원을 따라
const ringStd=(src,L,d)=>{ let a=0,b=0; const n=360; for(let k=0;k<n;k++){ const v=src(k,d)[L]; a+=v; b+=v*v; } a/=n; return Math.sqrt(Math.max(0,b/n-a*a)); };
const field={innerKm, layers:{}};
for (const L of ['low','mid','high']) { const rows=[];
  for (const f of [1,0.5,0.25,0.125,1/32]) { const d=innerKm[L]*f; rows.push({f, d, old:ringStd(srcOld,L,d), neu:ringStd(srcNew,L,d)}); }
  field.layers[L]=rows; }
let outside=0; for (const d of [innerKm.high, innerKm.high*1.5, 20, 80]) for (let az=0;az<360;az+=7){ const a=srcOld(az,d), b=srcNew(az,d); outside=Math.max(outside,Math.abs(a.high-b.high),Math.abs(a.mid-b.mid),Math.abs(a.low-b.low)); }
field.outsideMaxDiff=outside;

// 화면 자
const W=240,H=240;
const canvas=document.createElement('canvas'); canvas.width=W; canvas.height=H;
const r=new THREE.WebGLRenderer({canvas,antialias:false,alpha:false}); r.setPixelRatio(1); r.setSize(W,H,false);
const gl=r.getContext();
const dirOf=(alt,az)=>new THREE.Vector3(Math.cos(alt*D2R)*Math.sin(az*D2R),Math.sin(alt*D2R),-Math.cos(alt*D2R)*Math.cos(az*D2R)).normalize();
const render=(src, view, dataOut, withSky)=>{
  const scene=new THREE.Scene();
  if (withSky){ const sky=createSkydome(); updateSkydome(sky,SUN_ALT,SUN_AZ,atmosphere); scene.add(sky.mesh); }
  const slab=createCloudSlab(); scene.add(slab.mesh); bakeCloudSlabCoverage(slab, src);
  const cam=new THREE.PerspectiveCamera(view.fov,1,0.1,2000); cam.up.set(0,0,-1);
  const v=dirOf(view.elev,view.az); cam.lookAt(v.x,v.y,v.z); cam.updateMatrixWorld(true);
  const w={speedKmh:0,bearingDeg:250};
  updateCloudSlab(slab,{camera:cam,widthPx:W,heightPx:H,sunDir:dirOf(SUN_ALT,SUN_AZ),sunAltDeg:SUN_ALT,sunAzDeg:SUN_AZ,
    beamFor:k=>beamAtAltitude(SUN_ALT,k,atmosphere),atmosphere,layerWinds:{low:w,mid:w,high:w},driftHours:0,visible:true,dataOut});
  r.setClearColor(0x000000,1); r.render(scene,cam);
  const b=new Uint8Array(W*H*4); gl.readPixels(0,0,W,H,gl.RGBA,gl.UNSIGNED_BYTE,b);
  slab.dispose && slab.dispose();
  return {b, cam};
};
// 각도 방향 → 화소(아래가 0행)
const toPx=(cam,dir)=>{ const p=dir.clone().project(cam); return [(p.x*0.5+0.5)*W, (p.y*0.5+0.5)*H]; };
// (alt,az) 둘레 각반지름 rad 원을 따라 R 채널 표준편차
const circleStd=(img,cam,alt,az,radDeg)=>{
  const c=dirOf(alt,az), e=new THREE.Vector3(0,1,0).cross(c); if (e.lengthSq()<1e-9) e.set(1,0,0); e.normalize();
  const n=c.clone().cross(e).normalize(); let a=0,b2=0,m=0;
  for(let k=0;k<180;k++){ const t=k*2*D2R, s=Math.sin(radDeg*D2R), co=Math.cos(radDeg*D2R);
    const d=c.clone().multiplyScalar(co).add(e.clone().multiplyScalar(s*Math.cos(t))).add(n.clone().multiplyScalar(s*Math.sin(t)));
    const [x,y]=toPx(cam,d); const xi=Math.round(x), yi=Math.round(y); if(xi<0||yi<0||xi>=W||yi>=H) continue;
    const v=img[(yi*W+xi)*4]; a+=v; b2+=v*v; m++; }
  a/=m; return Math.sqrt(Math.max(0,b2/m-a*a)); };
const screen={};
// 기준: 운량이 어디서나 같은 장(사용자 화면의 층 운량). 남는 편차는 모양장 자체의 결입니다.
const uniform=()=>({low:0.3,mid:0.35,high:0.84,confidence:1,lowGenus:0});
for (const [key,src] of [['old',srcOld],['new',srcNew],['uniform',uniform]]) {
  const {b,cam}=render(src,{az:0,elev:90,fov:90},2,false);
  const z1=circleStd(b,cam,90,0,1), z8=circleStd(b,cam,90,0,8);
  const c1=circleStd(b,cam,55,200,1), c8=circleStd(b,cam,55,200,8);
  screen[key]={z1,z8,zRatio:z1/Math.max(1e-6,z8),c1,c8,cRatio:c1/Math.max(1e-6,c8)};
}
// 사용자 화면과 같은 시선(276° · +82°, 세로 화각 약 70°)의 그림
const shots=[];
for (const [key,src] of [['old',srcOld],['new',srcNew]]) {
  const {b}=render(src,{az:276,elev:82,fov:70},0,true);
  const img=[]; for(let y=H-1;y>=0;y--) for(let x=0;x<W;x++){ const i=(y*W+x)*4; img.push(b[i],b[i+1],b[i+2]); }
  shots.push({key,img});
}
window.__stats={field,screen,shots,W,H,glError:gl.getError()};
} catch(e){ errors.push('예외: '+(e&&e.stack||e)); }
window.__errors=errors; document.title='DONE::'+(errors.length?'ERR':'OK');
</script></body></html>`;
fs.writeFileSync(path.join(PREVIEW, 'zenith-columns.html'), html);
console.log('생성 완료: zenith-columns.html');
