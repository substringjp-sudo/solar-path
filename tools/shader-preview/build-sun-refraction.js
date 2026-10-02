/**
 * **해가 바다 수평선에 숨는 순간이 앱이 알리는 일몰과 같은가** (2026-10-02) — `verify-sun-refraction.js` 의 짝.
 *
 * 앱이 알리는 일몰은 해 중심의 **기하 고도 −0.833°**(굴절 34′ + 시반경 16′ 의 관례)입니다
 * (`solarPosition.sunTimes`). 그런데 3D 해는 기하 고도에 그려져, 원반이 그보다 2~3분 먼저 수평선 아래로
 * 숨었습니다 — 후쿠이 17:31 에서는 실제로 반쯤 보이던 해(겉보기 1.0°)가 능선 1.25° 뒤에 일찍 숨는 식입니다.
 * 이제 원반은 겉보기 고도(`getApparentAltitude`, Sæmundsson)에 놓입니다(SkyScene3D).
 *
 * 장면: 해면 관측자(눈 1.6m), DEM 없는 평평한 바다(SeaPlane), 해 원반(SunMesh). 카메라는 해 방위를 세로 4° 로.
 * 일몰 5분 전 ~ 3분 뒤를 5초 간격으로 훑어, 해를 껐다 켜서 한 채널이라도 8 넘게 바뀌는 화소가 남는 마지막
 * 시각을 찾습니다. 같은 일을 기하 고도로 놓고 한 번 더 합니다(대조).
 *
 * 준비: node tools/shader-preview/stage-esm.js && node tools/shader-preview/build-sun-refraction.js
 */
const fs = require('fs');
const path = require('path');
const { PREVIEW } = require('./paths');

/** 바닷가 두 곳 · 두 계절 — 해가 비스듬히 지는 정도가 다릅니다. */
const CASES = [
  { name: '후쿠이 10월', lat: 36.10, lon: 136.10, date: '2026-10-02' },
  { name: '제주 6월', lat: 33.25, lon: 126.30, date: '2026-06-21' },
  { name: '뮌헨 위도 12월', lat: 54.0, lon: 8.0, date: '2026-12-21' },
];

const html = `<!doctype html><html><head><meta charset="utf-8"></head><body><script type="module">
import * as THREE from './app/vendor/three.module.js';
import { createSeaPlane, updateSeaPlaneEye } from './app/components/SkyScene3D/SeaPlane.js';
import { createSun, updateSun } from './app/components/SkyScene3D/SunMesh.js';
import { sunPosition, sunTimes } from './app/utils/solarPosition.js';
import { getApparentAltitude } from './app/utils/sunsetPhysics.js';
import { makeAtmosphereParams, applyTuningUniforms } from './app/utils/atmosphere.js';
const errors=[]; window.addEventListener('error',e=>errors.push(String(e.message)));
try {
const CASES=${JSON.stringify(CASES)};
const W=200,H=200,FOV=4,D=Math.PI/180;
const canvas=document.createElement('canvas'); canvas.width=W; canvas.height=H;
const renderer=new THREE.WebGLRenderer({canvas,antialias:false,alpha:false}); renderer.setPixelRatio(1); renderer.setSize(W,H,false);
const gl=renderer.getContext();
const out=[];
for (const C of CASES) {
  const atm=makeAtmosphereParams({latitude:C.lat,observerElevM:0,dayOfYear:200,humidityPct:60,visibilityM:30000});
  const scene=new THREE.Scene();
  const sea=createSeaPlane({patch:null,maskPatch:null,observerElevM:0,eyeHeightM:1.6}); scene.add(sea.mesh);
  const su=sea.material.uniforms; su.uSurfaceIrr.value.set(0.02,0.02,0.03); su.uHazeRadiance.value.set(0.02,0.02,0.03); su.uAerial.value=0;
  const sun=createSun(); scene.add(sun.mesh);
  scene.traverse(o=>{ if(o.material&&o.material.uniforms) applyTuningUniforms(o.material.uniforms); });
  const noon=new Date(C.date+'T12:00:00Z');
  // 그 지방 날짜의 일몰: 경도로 낮 12시(현지)를 어림한 날에서 고릅니다.
  const localNoon=new Date(noon.getTime()-C.lon/15*3600e3);
  const st=sunTimes(localNoon,C.lat,C.lon);
  const sunset=st.sunset; const az0=sunPosition(sunset,C.lat,C.lon).azimuth*180/Math.PI+180;
  const cam=new THREE.PerspectiveCamera(FOV,1,0.1,200000); cam.position.set(0,0,0);
  cam.lookAt(Math.sin(az0*D),0,-Math.cos(az0*D)); cam.updateMatrixWorld(true);
  updateSeaPlaneEye(sea,cam);
  const b0=new Uint8Array(W*H*4), b1=new Uint8Array(W*H*4);
  function lit(t, apparent){
    const p=sunPosition(t,C.lat,C.lon); const alt=p.altitude*180/Math.PI, az=p.azimuth*180/Math.PI+180;
    updateSun(sun, alt, az, atm, 1, apparent?getApparentAltitude(alt):alt);
    const vis=sun.mesh.visible;
    sun.mesh.visible=false; renderer.render(scene,cam); gl.readPixels(0,0,W,H,gl.RGBA,gl.UNSIGNED_BYTE,b0);
    sun.mesh.visible=vis; renderer.render(scene,cam); gl.readPixels(0,0,W,H,gl.RGBA,gl.UNSIGNED_BYTE,b1);
    let n=0; for(let i=0;i<b0.length;i+=4) if(Math.max(Math.abs(b0[i]-b1[i]),Math.abs(b0[i+1]-b1[i+1]),Math.abs(b0[i+2]-b1[i+2]))>8) n++;
    return n;
  }
  const res={name:C.name, sunset:sunset.toISOString()};
  for (const [key,apparent] of [['겉보기',true],['기하',false]]) {
    let last=null, firstPx=null;
    for (let dt=-300; dt<=180; dt+=5) { const t=new Date(sunset.getTime()+dt*1000); const n=lit(t,apparent); if(dt===-300) firstPx=n; if(n>0) last=dt; }
    res[key]={마지막보임초:last, 시작화소:firstPx};
  }
  out.push(res);
}
window.__stats={glError:gl.getError(), out};
} catch(e){ errors.push('예외: '+(e&&e.stack||e)); }
window.__errors=errors; document.title='DONE::'+(errors.length?'ERR':'OK');
</script></body></html>`;
fs.mkdirSync(PREVIEW, { recursive: true });
fs.writeFileSync(path.join(PREVIEW, 'sun-refraction.html'), html);
console.log('생성 완료: sun-refraction.html');
