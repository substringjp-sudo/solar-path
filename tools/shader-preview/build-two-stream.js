/**
 * **보존산란 2-stream 슬랩 해 A/B** (계획 40절).
 *
 * 사용자 지적: "계속 약간의 수치 변경으로만 고치려고 하는데 색만 조금씩
 * 바뀌고 근본적인 문제는 해결되지 않는다. 빛의 경로와 매질의 흡수와 산란
 * 반사의 구조가 제대로 되고 있는걸까?"
 *
 * 예전 구조는 세 항(직달 lit · 주변 amb · 다중산란 ms)을 각자 다른 바닥
 * 상수로 만들어 더한 것이라 **에너지가 보존되지 않습니다**. 새 구조는
 * 흡수가 없는 평면평행 슬랩의 2-stream 해로, R + Tr = 1 이 항등식으로
 * 성립하고 깊이 프로파일이 닫힌 꼴로 나옵니다.
 *
 * 재는 것:
 *  - 맑은 아침 — 구름밝기비(구름 휘도 ÷ 하늘 휘도). 실사진 1.39~1.57.
 *  - 노을 — 명암폭·세로기울기. verify-sunset-gap 의 두 지표와 같은 식.
 *  - 노을 구름 색 — 구름따뜻함이 하늘보다 커야 "분홍으로 물든" 것.
 *  - 한밤중 — 평균 휘도. 밝아지면 밤에 구름이 빛나는 결함.
 *  - 흐림 — 평균 휘도. 0 에 가까우면 화면이 검어지는 결함.
 *
 * 구름은 분할 규칙을 지어내지 않고 **같은 장면을 운량 0 으로 한 번 더 그려
 * 달라진 화소**로 가릅니다(36·38절과 같은 방법).
 *
 * 사용: node tools/shader-preview/build-two-stream.js
 *       node tools/shader-preview/shoot.js two-stream.html two-stream.png 90000
 *       node tools/shader-preview/verify-two-stream.js
 */
const fs = require('fs');
const path = require('path');
const { PREVIEW } = require('./paths');

const STATS_SRC = fs.readFileSync(
  path.join(__dirname, '../photo-ref/sky-stats.js'), 'utf8')
  .replace(/if \(typeof module[\s\S]*$/, '');

const TW = 300, TH = 300;
const MODELS = ['legacy', 'twoStream'];

/**
 * 장면들. 아침은 QR 실측값(37.47N, 8/24, 79%, 17.96km), 노을은 사용자
 * 화면과 같은 방위, 흐림·한밤중은 전천후 격자에서 문제가 났던 두 칸입니다.
 */
const SCENES = [
  { key: '맑은아침', sunAlt: 12.76, sunAz: 90.35, viewAz: 90.35, viewElev: 10,
    low: 15, mid: 10, high: 0, hum: 79, vis: 17960 },
  { key: '노을0',    sunAlt: 0.0,  sunAz: 263, viewAz: 263, viewElev: 14,
    low: 35, mid: 25, high: 0, hum: 70, vis: 20000 },
  { key: '노을-3',   sunAlt: -3.0, sunAz: 263, viewAz: 263, viewElev: 14,
    low: 35, mid: 25, high: 0, hum: 70, vis: 20000 },
  { key: '흐림낮',   sunAlt: 24.0, sunAz: 180, viewAz: 180, viewElev: 20,
    low: 92, mid: 80, high: 40, hum: 92, vis: 9000 },
  { key: '한밤중',   sunAlt: -42.0, sunAz: 0, viewAz: 180, viewElev: 20,
    low: 45, mid: 30, high: 0, hum: 70, vis: 20000 },
];

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
 body{margin:0;background:#0b0f15;font-family:sans-serif;color:#dde}
 #wrap{position:relative;width:${TW * MODELS.length + 24}px;padding:12px}
 .lbl{position:absolute;color:#fff;font-size:10px;font-family:monospace;
   pointer-events:none;line-height:1.4;background:rgba(6,10,16,.85);
   padding:3px 6px;border-radius:4px}
 h3{font-size:13px;margin:6px 0}
 .sub{font-size:11px;color:#8aa;margin:0 0 8px}
</style></head><body>
<div id="wrap">
<h3>구름 안의 빛 — 예전 삼항 합 vs 보존산란 2-stream</h3>
<p class="sub">가로: 예전 / 2-stream. 세로: 맑은아침 · 노을0° · 노을-3° · 흐림낮 · 한밤중.</p>
<canvas id="c"></canvas><div id="labels"></div></div>
<script type="module">
import * as THREE from './app/vendor/three.module.js';
import { createSkydome, updateSkydome } from './app/components/SkyScene3D/Skydome.js';
import { createTerrainRing, createGroundPlane, updateTerrainColors, updateGroundColors,
         setGroundHorizon } from './app/components/SkyScene3D/TerrainRing.js';
import { createCloudSlab, updateCloudSlab, bakeCloudSlabCoverage }
  from './app/components/SkyScene3D/CloudSlab.js';
import { WeatherFan } from './app/utils/skyColumn.js';
import { makeAtmosphereParams, beamAtAltitude, applyTuningUniforms } from './app/utils/atmosphere.js';

const errors=[]; const oe=console.error; console.error=(...a)=>{errors.push(a.join(' ')); oe(...a);};
${STATS_SRC}

const TW=${TW}, TH=${TH};
const MODELS=${JSON.stringify(MODELS)}, SCENES=${JSON.stringify(SCENES)};

const canvas=document.getElementById('c');
canvas.width=TW*MODELS.length; canvas.height=TH*SCENES.length;
const ctx2d=canvas.getContext('2d');
const glCanvas=document.createElement('canvas'); glCanvas.width=TW; glCanvas.height=TH;
const renderer=new THREE.WebGLRenderer({canvas:glCanvas,antialias:false,alpha:false});
renderer.setPixelRatio(1); renderer.setSize(TW,TH,false);
const gl=renderer.getContext();

const scene=new THREE.Scene();
const skydome=createSkydome(); scene.add(skydome.mesh);
const angles=[]; for(let i=0;i<72;i++) angles.push(0.35+0.5*Math.sin(i*0.21)+0.3*Math.sin(i*0.07+1.3));
const terrain=createTerrainRing(angles); scene.add(terrain);
const ground=createGroundPlane(); setGroundHorizon(ground,24); scene.add(ground);
const slab=createCloudSlab(); slab.mesh.renderOrder=10; scene.add(slab.mesh);
const labels=document.getElementById('labels');

const OFFSETS=[-180,-150,-120,-90,-60,-30,0,30,60,90,120,150,180];
const DISTS=[5,12,30,70,160,360];
const jit=(v,d,a)=>Math.max(0,Math.min(100, v+16*Math.sin(d*0.031+a*0.017)+11*Math.cos(d*0.017-a*0.026)));

function bake(sc){
  const pts=[{distance:0,azimuthOffset:0,low:sc.low,mid:sc.mid,high:sc.high,
              humidity:sc.hum,precipitation:0,visibility:sc.vis}];
  for(const off of OFFSETS) for(const d of DISTS)
    pts.push({distance:d,azimuthOffset:off,low:jit(sc.low,d,off),mid:jit(sc.mid,d,off+40),
              high:sc.high?jit(sc.high,d,off+80):0,humidity:sc.hum,precipitation:0});
  const fan=new WeatherFan(pts,sc.sunAz);
  bakeCloudSlabCoverage(slab,(azDeg,distKm)=>{const {data,confidence}=fan.sample(azDeg,distKm);
    if(!data) return {low:0,mid:0,high:0,confidence:0};
    return {low:data.low/100,mid:data.mid/100,high:data.high/100,
            confidence:Math.max(0,Math.min(1,confidence))};});
}

function shoot(sc, model){
  const atm=makeAtmosphereParams({latitude:37.47,observerElevM:24,dayOfYear:247,
    humidityPct:sc.hum,visibilityM:sc.vis});
  const cam=new THREE.PerspectiveCamera(70,TW/TH,0.1,2000);
  cam.position.set(0,0,0); cam.up.set(0,1,0);
  const az=sc.viewAz*Math.PI/180, er=sc.viewElev*Math.PI/180;
  cam.lookAt(100*Math.cos(er)*Math.sin(az),100*Math.sin(er),-100*Math.cos(er)*Math.cos(az));
  cam.updateMatrixWorld(true);
  const a=sc.sunAlt*Math.PI/180, z=sc.sunAz*Math.PI/180;
  const sunDir=new THREE.Vector3(Math.cos(a)*Math.sin(z),Math.sin(a),-Math.cos(a)*Math.cos(z)).normalize();
  applyTuningUniforms(skydome.mesh.material.uniforms);
  updateSkydome(skydome,sc.sunAlt,sc.sunAz,atm);
  applyTuningUniforms(skydome.mesh.material.uniforms);
  updateTerrainColors(terrain,sc.sunAlt,sc.sunAz,atm);
  updateGroundColors(ground,sc.sunAlt,sc.sunAz,atm);
  updateCloudSlab(slab,{camera:cam,widthPx:TW,heightPx:TH,sunDir,
    sunAltDeg:sc.sunAlt,sunAzDeg:sc.sunAz,cityLight:0,
    beamFor:(altKm)=>beamAtAltitude(sc.sunAlt,altKm,atm),atmosphere:atm,
    layerWinds:{low:{speedKmh:15,bearingDeg:114},mid:{speedKmh:34,bearingDeg:99},
                high:{speedKmh:77,bearingDeg:84}},
    driftHours:0,visible:true,
    moonDir:new THREE.Vector3(0.3,0.6,-0.7).normalize(),moonAltDeg:37,moonIllum:0.6,
    cloudModel:model});
  applyTuningUniforms(slab.mesh.material.uniforms);
  renderer.setRenderTarget(null); renderer.setClearColor(0x000000,1);
  renderer.render(scene,cam);
  const buf=new Uint8Array(4*TW*TH);
  gl.readPixels(0,0,TW,TH,gl.RGBA,gl.UNSIGNED_BYTE,buf);
  const out=new Uint8Array(buf.length);
  for(let r=0;r<TH;r++) out.set(buf.subarray((TH-1-r)*TW*4,(TH-r)*TW*4), r*TW*4);
  return out;
}

const lum=(b,p)=>0.2126*b[p]+0.7152*b[p+1]+0.0722*b[p+2];
const warm=(b,p)=>(b[p]-b[p+2])/Math.max(24,Math.max(b[p],Math.max(b[p+1],b[p+2])));

/** 구름 화소만 갈라 재는 값들. 운량 0 판과의 차이가 24 를 넘으면 구름. */
function cloudVsSky(withC,noC){
  let cw=0,sw=0,cl=0,sl=0,n=0;
  for(let i=0;i<TW*TH;i++){const p=i*4;
    if(Math.abs(withC[p]-noC[p])+Math.abs(withC[p+1]-noC[p+1])+Math.abs(withC[p+2]-noC[p+2])<24) continue;
    cw+=warm(withC,p); sw+=warm(noC,p); cl+=lum(withC,p); sl+=lum(noC,p); n++;}
  if(!n) return {구름화소:0};
  return { 구름화소:n,
           구름따뜻함:+(cw/n).toFixed(3), 하늘따뜻함:+(sw/n).toFixed(3),
           따뜻함차:+((cw-sw)/n).toFixed(3),
           구름휘도:+(cl/n).toFixed(1), 하늘휘도:+(sl/n).toFixed(1),
           구름밝기비:+(cl/Math.max(1,sl)).toFixed(3) };
}

/** 세로기울기 — 천정쪽 띠 ÷ 지평선쪽 띠. verify-sunset-gap 과 같은 뜻. */
function 세로기울기(buf){
  const band=(y0,y1)=>{let s=0,n=0;
    for(let y=y0;y<y1;y++) for(let x=0;x<TW;x++){const p=(y*TW+x)*4; s+=lum(buf,p); n++;}
    return s/Math.max(1,n);};
  const 위=band(0,Math.floor(TH*0.25)), 아래=band(Math.floor(TH*0.55),Math.floor(TH*0.75));
  return +(위/Math.max(1,아래)).toFixed(3);
}

const 결과=[];
SCENES.forEach((sc,row)=>{
  bake(sc);
  MODELS.forEach((model,col)=>{
    const on=shoot(sc,model);
    const savedTex=slab.material.uniforms.uCoverTex.value;
    const blank=new THREE.DataTexture(new Uint8Array(savedTex.image.width*savedTex.image.height*4),
      savedTex.image.width,savedTex.image.height,THREE.RGBAFormat);
    blank.minFilter=THREE.LinearFilter; blank.magFilter=THREE.LinearFilter; blank.needsUpdate=true;
    slab.material.uniforms.uCoverTex.value=blank;
    const bare=shoot(sc,model);
    slab.material.uniforms.uCoverTex.value=savedTex;

    const m=cloudVsSky(on,bare);
    const s=skyStats(on,TW,TH,{});
    const r={장면:sc.key, 모형:model, ...m,
             명암폭:s.밝기폭, 평균휘도:s.평균휘도 ?? null,
             국소대비:s.국소대비, 세로기울기:세로기울기(on)};
    결과.push(r);
    const im=ctx2d.createImageData(TW,TH); im.data.set(on); ctx2d.putImageData(im,col*TW,row*TH);
    const d=document.createElement('div'); d.className='lbl';
    d.style.left=(col*TW+6)+'px'; d.style.top=(row*TH+6)+'px';
    d.innerHTML=sc.key+' · '+model
      +'<br>구름밝기비 <b>'+(m.구름밝기비??'—')+'</b>'
      +'<br>따뜻함차 '+(m.따뜻함차??'—')
      +'<br>명암폭 '+r.명암폭+' · 세로기울기 '+r.세로기울기;
    labels.appendChild(d);
  });
});

window.__stats={glError:gl.getError(), 결과};
window.__errors=errors;
document.title='DONE::'+(errors.length?'SHADER_ERR':'OK')+'::'+gl.getError();
</script></body></html>`;

fs.mkdirSync(PREVIEW, { recursive: true });
fs.writeFileSync(path.join(PREVIEW, 'two-stream.html'), html);
console.log('생성 완료: two-stream.html');
