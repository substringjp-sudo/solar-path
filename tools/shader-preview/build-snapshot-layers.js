/**
 * **스냅샷이 왜 검게 나왔나 — 레이어 마스크.**
 *
 * 실기 보고: "3d 시뮬레이션 예측도 여전히 안보이고 검은색으로만 나와."
 * 칸은 보이고 실패 사유도 안 떴으니 스냅샷은 **성공**했고 내용만 비었다는
 * 뜻이었습니다.
 *
 * ## 원인은 스냅샷 경로가 아니라 무엇을 그렸는가입니다
 *
 * `SkyScene3D` 는 장면의 객체를 전부 레이어 1~4 에 배정합니다
 * (`assignLayer`, SceneComposer 의 LAYER_SOFT_SKY 1 · LAYER_MID 2 ·
 * LAYER_SOFT_CLOUD 3 · LAYER_FRONT 4). **레이어 0 에는 아무것도 없습니다.**
 * 그런데 three.js `PerspectiveCamera` 의 기본 레이어 마스크는 **0 하나**만
 * 켭니다. 그러니 컴포저를 거치지 않은 `renderer.render(scene, camera)` 는
 * 아무것도 안 그리고 지우기색(검정)만 남깁니다.
 *
 * 실시간 화면이 멀쩡했던 이유는 루프가 `composer.render(...)` 로 그리기
 * 때문입니다 — 컴포저가 패스마다 `camera.layers.set(...)` 으로 레이어를
 * 켜고, 끝나면 `camera.layers.mask = prevMask` 로 되돌립니다. 되돌린 값이
 * 곧 기본 마스크(레이어 0)이므로, 그 밖에서 직접 그리면 빈 화면입니다.
 *
 * ## 이 판이 재현하는 것
 *
 * 같은 장면·같은 카메라로 두 번 그립니다.
 *
 *  - **직접 그리기** — `renderer.render(scene, camera)`. 검어야 합니다.
 *  - **레이어 다 켜고 직접** — `camera.layers.enableAll()` 뒤 같은 호출.
 *    밝아야 합니다. 이것이 원인을 못 박는 대조입니다 — 레이어 말고는
 *    아무것도 안 바꿨는데 그림이 돌아오면 원인은 레이어입니다.
 *
 * ⚠ 여기서는 SceneComposer 자체를 안 씁니다. 컴포저는 렌더타겟을 여럿
 * 잡아 하네스의 단순한 캔버스와 맞물리기 번거롭고, **가르려는 것은 컴포저의
 * 후처리가 아니라 레이어 마스크 하나**이기 때문입니다. 앱 쪽 고침은
 * 컴포저로 그리게 바꾼 것이고, 그 길이 레이어를 켠다는 것은 SceneComposer
 * 의 `camera.layers.set(...)` 호출로 코드에서 확인됩니다.
 *
 * 준비: node tools/shader-preview/stage-esm.js
 * 사용: node tools/shader-preview/build-snapshot-layers.js
 *       node tools/shader-preview/verify-snapshot-layers.js
 */
const fs = require('fs');
const path = require('path');
const { PREVIEW } = require('./paths');

const TW = 320, TH = 420;

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
 body{margin:0;background:#0b0f15;font-family:sans-serif;color:#dde}
 #wrap{padding:12px} h3{font-size:13px;margin:6px 0}
 canvas{border:1px solid #345;margin:2px} .cap{font:10px monospace;color:#9ab}
</style></head><body>
<div id="wrap"><h3>스냅샷이 검은 이유 — 레이어 마스크</h3>
<div id="shots"></div><div id="out"></div></div>
<script type="module">
import * as THREE from './app/vendor/three.module.js';
import { createSkydome, updateSkydome } from './app/components/SkyScene3D/Skydome.js';
import { createCloudSlab, updateCloudSlab, bakeCloudSlabCoverage }
  from './app/components/SkyScene3D/CloudSlab.js';
import { LAYER_SOFT_SKY, LAYER_SOFT_CLOUD } from './app/components/SkyScene3D/SceneComposer.js';
import { WeatherFan } from './app/utils/skyColumn.js';
import { makeAtmosphereParams, beamAtAltitude } from './app/utils/atmosphere.js';

const errors = [];
window.addEventListener('error', e => errors.push(String(e.message)));

const TW=${TW}, TH=${TH};
const SUN_ALT=15.06, SUN_AZ=95.04;

const glCanvas = document.createElement('canvas');
glCanvas.width = TW; glCanvas.height = TH;
const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias:false, alpha:false });
renderer.setPixelRatio(1); renderer.setSize(TW, TH, false);
const gl = renderer.getContext();

const atmosphere = makeAtmosphereParams({
  latitude: 37.4863, observerElevM: 0, dayOfYear: 253,
  humidityPct: 80, visibilityM: 18980,
});
const scene = new THREE.Scene();
const skydome = createSkydome();
scene.add(skydome.mesh);
const slab = createCloudSlab();
slab.mesh.renderOrder = 10;
scene.add(slab.mesh);

/** 앱의 assignLayer 과 같은 일 — 자신과 자손을 그 레이어 하나에만 둡니다. */
function assignLayer(obj, layer){
  obj.traverse((o) => { o.layers.set(layer); });
}
assignLayer(skydome.mesh, LAYER_SOFT_SKY);
assignLayer(slab.mesh, LAYER_SOFT_CLOUD);

{
  const OFFSETS=[-20,-10,0,10,20], DISTS=[10,30,70,130,200,280,380];
  const pt=(d,off)=>({ distance:d, azimuthOffset:off, low:0, mid:33, high:53,
                       humidity:80, precipitation:0, visibility:18980 });
  const pts=[pt(0,0)];
  for (const off of OFFSETS) for (const d of DISTS) pts.push(pt(d,off));
  const fan = new WeatherFan(pts, SUN_AZ);
  bakeCloudSlabCoverage(slab, (azDeg, distKm) => {
    const { data, confidence } = fan.sample(azDeg, distKm);
    if (!data) return { low:0, mid:0, high:0, confidence:0 };
    return { low:data.low/100, mid:data.mid/100, high:data.high/100,
             confidence: Math.max(0, Math.min(1, confidence)) };
  });
}

const cam = new THREE.PerspectiveCamera(60, TW/TH, 0.1, 2000);
cam.position.set(0,0,0); cam.up.set(0,1,0);
{
  const ar=SUN_AZ*Math.PI/180, er=35*Math.PI/180;
  cam.lookAt(100*Math.cos(er)*Math.sin(ar), 100*Math.sin(er), -100*Math.cos(er)*Math.cos(ar));
  cam.updateMatrixWorld(true);
}

function draw(){
  const a=SUN_ALT*Math.PI/180, z=SUN_AZ*Math.PI/180;
  const sunDir=new THREE.Vector3(Math.cos(a)*Math.sin(z), Math.sin(a), -Math.cos(a)*Math.cos(z)).normalize();
  updateSkydome(skydome, SUN_ALT, SUN_AZ, atmosphere);
  const w={ speedKmh:16.9, bearingDeg:76.5 };
  updateCloudSlab(slab, {
    camera: cam, widthPx: TW, heightPx: TH,
    sunDir, sunAltDeg: SUN_ALT, sunAzDeg: SUN_AZ,
    beamFor:(altKm)=>beamAtAltitude(SUN_ALT, altKm, atmosphere),
    atmosphere,
    layerWinds:{ low:w, mid:{speedKmh:28.7,bearingDeg:76.5}, high:{speedKmh:57.5,bearingDeg:76.5} },
    driftHours:0, visible:true,
  });
  renderer.setRenderTarget(null);
  renderer.setClearColor(0x000000, 1);
  renderer.render(scene, cam);
  const buf=new Uint8Array(4*TW*TH);
  gl.readPixels(0,0,TW,TH,gl.RGBA,gl.UNSIGNED_BYTE,buf);
  return buf;
}

const lum=(b,p)=>0.2126*b[p*4]+0.7152*b[p*4+1]+0.0722*b[p*4+2];
function stat(buf){
  let s=0, black=0;
  for(let i=0;i<TW*TH;i++){ const v=lum(buf,i); s+=v; if (v < 2) black++; }
  return { 평균밝기:+(s/(TW*TH)).toFixed(2), 검은화소비:+(black/(TW*TH)).toFixed(4) };
}
function paint(buf, label){
  const c=document.createElement('canvas'); c.width=TW; c.height=TH;
  c.style.width='160px'; c.style.height='210px';
  const cx=c.getContext('2d'); const img=cx.createImageData(TW,TH);
  for(let y=0;y<TH;y++){ const s=(TH-1-y)*TW*4, d=y*TW*4;
    for(let i=0;i<TW*4;i++) img.data[d+i]=buf[s+i]; }
  cx.putImageData(img,0,0);
  const t=document.createElement('span'); t.className='cap'; t.textContent=label+' ';
  document.getElementById('shots').appendChild(t);
  document.getElementById('shots').appendChild(c);
}

const 결과={};
// ① 앱이 예전에 하던 것 — 기본 마스크 그대로 직접 그리기.
cam.layers.set(0);
{ const b = draw(); paint(b, '직접(기본 마스크)'); 결과['직접_기본마스크'] = stat(b); }
// ② 레이어만 다 켜고 같은 호출 — 이것 말고는 아무것도 안 바꿨습니다.
cam.layers.enableAll();
{ const b = draw(); paint(b, '레이어 다 켬'); 결과['레이어_다켬'] = stat(b); }
// ③ 되돌리면 다시 검어야 합니다 — 대조가 한 방향이 아님을 보입니다.
cam.layers.set(0);
{ const b = draw(); 결과['다시_기본마스크'] = stat(b); }

document.getElementById('out').innerHTML='<p>'+JSON.stringify(결과)+'</p>';
window.__stats={ glError: gl.getError(), 결과 };
window.__errors=errors;
document.title='DONE::'+(errors.length?'ERR':'OK')+'::'+gl.getError();
</script></body></html>`;

fs.writeFileSync(path.join(PREVIEW, 'snapshot-layers.html'), html);
console.log('생성 완료: snapshot-layers.html');
