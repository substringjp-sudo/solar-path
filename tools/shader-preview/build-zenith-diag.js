/**
 * **천정 별똥 무늬**의 출처를 가릅니다 — 운량 텍스처인가, 슬랩 잔무늬인가.
 *
 * 실기기 캡처(FOV 120°, 시선 고도 35°)는 천정을 화면에 담습니다. 거기서
 * 한 점으로 모이는 방사 무늬가 납니다. 후보가 둘이라 하나씩 끕니다:
 *
 *  - 운량장: `slab_coverUv` 의 제곱근 사상 탓에 **고도 90°~45° 가 통틀어
 *    4텍셀**입니다. 그걸 화면 절반에 확대하면 이중선형 구조가 드러납니다.
 *  - 잔무늬: 지상거리가 천정에서 0 으로 수렴하므로 노이즈 좌표도 한 점에
 *    모입니다.
 *
 * 잔무늬는 `heightPx` 를 일부러 작게 넘겨 끕니다 — 화소 각크기가 커지면
 * 셰이더가 스스로 잔무늬를 평균으로 녹이므로(det→0), 셰이더를 고치지 않고
 * 순수하게 분리됩니다.
 *
 * 준비: node tools/shader-preview/stage-esm.js
 * 사용: node tools/shader-preview/build-zenith-diag.js
 */
const fs = require('fs');
const path = require('path');
const { PREVIEW } = require('./paths');

const TW = 420, TH = 420;
const SHOT = { fov: 120, elev: 35, sunAlt: -42.11, sunAz: 348.53,
               low: 42, mid: 72, high: 78, humidity: 88, vis: 7600, driftH: 14.98 };

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
 body{margin:0;background:#0b0f15;font-family:sans-serif;color:#dde}
 #wrap{position:relative;width:${TW * 3 + 24}px;padding:12px}
 .lbl{position:absolute;color:#fff;font-size:11px;font-family:monospace;
   pointer-events:none;line-height:1.4;background:rgba(6,10,16,.75);
   padding:4px 7px;border-radius:4px}
 h3{font-size:13px;margin:6px 0}
 .sub{font-size:11px;color:#8aa;margin:0 0 8px}
</style></head><body>
<div id="wrap">
<h3>천정 별똥 무늬 — 출처 가리기 (FOV 120°, 시선 고도 35°, 천정이 화면 안)</h3>
<p class="sub">가운데 칸에서 무늬가 사라지면 잔무늬 탓, 오른쪽에서 사라지면 운량 텍스처 탓입니다.</p>
<canvas id="c"></canvas><div id="labels"></div></div>
<script type="module">
import * as THREE from './app/vendor/three.module.js';
import { createCloudSlab, updateCloudSlab, bakeCloudSlabCoverage }
  from './app/components/SkyScene3D/CloudSlab.js';
import { WeatherFan } from './app/utils/skyColumn.js';
import { makeAtmosphereParams, beamAtAltitude } from './app/utils/atmosphere.js';

const errors = [];
const oe = console.error;
console.error = (...a) => { errors.push(a.join(' ')); oe(...a); };

const TW=${TW}, TH=${TH};
const S=${JSON.stringify(SHOT)};

const canvas = document.getElementById('c');
canvas.width = TW*3; canvas.height = TH;
const ctx2d = canvas.getContext('2d');
const glCanvas = document.createElement('canvas');
glCanvas.width = TW; glCanvas.height = TH;
const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias:false, alpha:false });
renderer.setPixelRatio(1); renderer.setSize(TW, TH, false);

const scene = new THREE.Scene();
const slab = createCloudSlab();
scene.add(slab.mesh);
const gl = renderer.getContext();
const labels = document.getElementById('labels');

const OFFSETS=[-180,-150,-120,-90,-60,-30,0,30,60,90,120,150,180];
const DISTS=[2,5,12,30,70,160,360];
const jitter=(v,d,a)=>Math.max(0,Math.min(100, v + 18*Math.sin(d*0.031+a*0.017) + 12*Math.cos(d*0.017-a*0.026)));
function bake(varying){
  const pts=[{ distance:0, azimuthOffset:0, low:S.low, mid:S.mid, high:S.high,
               humidity:S.humidity, precipitation:0, visibility:S.vis }];
  for (const off of OFFSETS) for (const d of DISTS){
    pts.push({ distance:d, azimuthOffset:off,
      low: varying?jitter(S.low,d,off):S.low,
      mid: varying?jitter(S.mid,d,off+40):S.mid,
      high:varying?jitter(S.high,d,off+80):S.high,
      humidity:S.humidity, precipitation:0 });
  }
  const fan = new WeatherFan(pts, 0);
  bakeCloudSlabCoverage(slab, (azDeg, distKm) => {
    const { data, confidence } = fan.sample(azDeg, distKm);
    if (!data) return { low:0, mid:0, high:0, confidence:0 };
    return { low:data.low/100, mid:data.mid/100, high:data.high/100,
             confidence: Math.max(0, Math.min(1, confidence)) };
  });
}

const cam = new THREE.PerspectiveCamera(S.fov, TW/TH, 0.1, 2000);
cam.position.set(0,0,0); cam.up.set(0,1,0);
{
  const ar=S.sunAz*Math.PI/180, er=S.elev*Math.PI/180;
  cam.lookAt(100*Math.cos(er)*Math.sin(ar), 100*Math.sin(er), -100*Math.cos(er)*Math.cos(ar));
  cam.updateMatrixWorld(true);
}
const atmosphere = makeAtmosphereParams({
  latitude: 37.48, observerElevM: 34, dayOfYear: 240, humidityPct: S.humidity, visibilityM: S.vis });
const a=S.sunAlt*Math.PI/180, z=S.sunAz*Math.PI/180;
const sunDir=new THREE.Vector3(Math.cos(a)*Math.sin(z), Math.sin(a), -Math.cos(a)*Math.cos(z)).normalize();
const W=(k)=>({ speedKmh:k, bearingDeg:189 });

function shoot(noiseOn){
  updateCloudSlab(slab, {
    camera: cam, widthPx: TW,
    // 잔무늬 끄기: 화소 각크기를 키우면 셰이더가 스스로 평균으로 녹입니다.
    heightPx: noiseOn ? TH : 3,
    sunDir, sunAltDeg: S.sunAlt, sunAzDeg: S.sunAz,
    moonDir: new THREE.Vector3(0.3,0.6,-0.7).normalize(), moonAltDeg: 37, moonIllum: 0.9,
    cityLight: 1.0,
    beamFor: (altKm) => beamAtAltitude(S.sunAlt, altKm, atmosphere),
    atmosphere,
    layerWinds: { low:W(13.9), mid:W(24), high:W(75) },
    driftHours: S.driftH, visible: true,
  });
  renderer.setRenderTarget(null);
  renderer.setClearColor(0x05070c, 1);
  renderer.render(scene, cam);
  const buf=new Uint8Array(4*TW*TH);
  gl.readPixels(0,0,TW,TH,gl.RGBA,gl.UNSIGNED_BYTE,buf);
  return buf;
}
function paint(buf,x){
  const img=ctx2d.createImageData(TW,TH);
  for(let r=0;r<TH;r++){ const s=(TH-1-r)*TW*4, d=r*TW*4;
    for(let i=0;i<TW*4;i++) img.data[d+i]=buf[s+i]; }
  ctx2d.putImageData(img,x,0);
}
const lum=(b,p)=>0.2126*b[p*4]+0.7152*b[p*4+1]+0.0722*b[p*4+2];

/**
 * 천정 방사성 — 천정 화면좌표를 중심으로, 같은 반지름 고리 위 밝기 분산 대비
 * 반지름 방향 밝기 변화. 별똥 무늬가 있으면 방위별 편차가 큽니다.
 */
function zenithSpokes(buf){
  // 천정은 화면 중앙에서 위로 (90-elev)도 만큼. FOV/높이로 화소 환산.
  const pxPerDeg = TH / S.fov;
  const cx = TW/2, cy = TH/2 + (90 - S.elev) * pxPerDeg;
  let tot=0, n=0;
  for (let R=20; R<=90; R+=10){
    const vals=[];
    for (let k=0;k<72;k++){
      const th=k*Math.PI/36;
      const x=Math.round(cx+R*Math.cos(th)), y=Math.round(cy+R*Math.sin(th));
      if (x<1||y<1||x>=TW-1||y>=TH-1) continue;
      vals.push(lum(buf,y*TW+x));
    }
    if (vals.length<24) continue;
    const m=vals.reduce((s,v)=>s+v,0)/vals.length;
    const sd=Math.sqrt(vals.reduce((s,v)=>s+(v-m)*(v-m),0)/vals.length);
    tot+=sd/Math.max(1,m); n++;
  }
  return +(tot/Math.max(1,n)).toFixed(4);
}

const 결과=[];
const cases=[['현재 그대로',true,true],['잔무늬 끔',true,false],['운량 균일',false,true]];
cases.forEach(([tag,varying,noiseOn],i)=>{
  bake(varying);
  const buf=shoot(noiseOn);
  paint(buf,i*TW);
  const sp=zenithSpokes(buf);
  const d=document.createElement('div');
  d.className='lbl'; d.style.left=(i*TW+16)+'px'; d.style.top='52px';
  d.innerHTML=tag+'<br>천정 방사성 '+sp;
  labels.appendChild(d);
  결과.push({ 조건:tag, 천정방사성:sp });
});

window.__stats={ glError:gl.getError(), 결과 };
window.__errors=errors;
document.title='DONE::'+(errors.length?'SHADER_ERR':'OK')+'::'+gl.getError();
</script></body></html>`;

fs.mkdirSync(PREVIEW, { recursive: true });
fs.writeFileSync(path.join(PREVIEW, 'zenith-diag.html'), html);
console.log('생성 완료: zenith-diag.html');
