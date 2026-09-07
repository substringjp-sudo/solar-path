/**
 * **테두리와 그림자가 매끈한 플라스틱인가, 솜인가** (계획 45절).
 *
 * 사용자 지적: "구름의 그림자와 테두리 경계가 너무 매끈하고 마치 매끈한
 * 플라스틱을 보는 느낌이야. 구름이 경계가 뚜렷한 느낌이 나더라도 마치
 * 솜같은 느낌이고, 그림자 경계도 솜털처럼 거친 면이 있거나 아니면
 * 뿌옇거나 흐리거나 하는데."
 *
 * 두 가지를 **사진과 같은 잣대로** 잽니다.
 *
 *  ① 테두리 거칠기 — Richardson 식 다중척도 둘레. 같은 모양을 1화소
 *    자로 잰 둘레 P1 과 4화소 자로 잰 둘레 4·P4 의 비입니다. 매끈한
 *    타원이면 1.0 이고, 경계가 프랙탈일수록 커집니다. 솜은 잔 요철이
 *    많아 1화소 자로 재면 훨씬 길어집니다.
 *
 *  ② 음영 잔결 — 구름 **안쪽**(경계에서 3화소 이상)의 잔 규모 휘도
 *    표준편차를 안쪽 평균으로 나눈 값. 플라스틱은 0 에 가깝습니다.
 *    그림자 경계가 솜털처럼 거친지가 여기 들어옵니다.
 *
 * ⚠ 각해상도를 맞춰야 비교가 성립합니다. 사진은 우리보다 훨씬 촘촘하므로
 * 사진 쪽을 우리 화각·화소수에 맞춰 줄여서 잽니다 — 안 그러면 사진이
 * 언제나 거칠게 나옵니다(자를 더 잘게 대는 것이니까).
 *
 * 사용: node tools/shader-preview/build-edge-rough.js
 *       node tools/shader-preview/shoot.js edge-rough.html edge-rough.png 60000
 */
const fs = require('fs');
const path = require('path');
const { PREVIEW } = require('./paths');

const TW = 300, TH = 300;
/** 사진 쪽 day-cumulus 의 화각(65~67°)과 같은 대역으로 맞춥니다. */
const FOV = 66, VIEW_ELEV = 35, VIEW_AZ = 200, SUN_AZ = 250, SUN_ALT = 48;
/** 견줄 사진 — 테두리가 뚜렷한 적운 위주 */
const PHOTOS = ['day-cumulus_01.jpg', 'day-cumulus_02.jpg', 'day-zenith_04.jpg'];

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
 body{margin:0;background:#0b0f15;font-family:sans-serif;color:#dde}
 #wrap{position:relative;width:${TW * 4 + 24}px;padding:12px}
 h3{font-size:14px;margin:6px 0}
 .sub{font-size:11px;color:#8aa;margin:0 0 10px;max-width:900px;line-height:1.5}
 table{border-collapse:collapse;font:11px monospace;margin-top:10px}
 td,th{border:1px solid #345;padding:3px 9px;text-align:right}
 td:first-child,th:first-child{text-align:left}
</style></head><body>
<div id="wrap">
<h3>테두리 거칠기 · 음영 잔결 — 사진과 같은 각해상도로</h3>
<p class="sub">① 테두리 거칠기 = 1화소 자 둘레 / 4화소 자 둘레. 매끈한 타원 1.0, 프랙탈일수록 큼.
 ② 음영 잔결 = 구름 안쪽 잔 규모 휘도 표준편차 / 안쪽 평균. 플라스틱은 0 근처.
 위 줄이 우리 렌더, 아래가 사진(우리 각해상도로 줄여서 잼).</p>
<canvas id="c"></canvas><div id="tbl"></div></div>
<script type="module">
import * as THREE from './app/vendor/three.module.js';
import { createSkydome, updateSkydome } from './app/components/SkyScene3D/Skydome.js';
import { createCloudSlab, updateCloudSlab, bakeCloudSlabCoverage }
  from './app/components/SkyScene3D/CloudSlab.js';
import { WeatherFan } from './app/utils/skyColumn.js';
import { makeAtmosphereParams, beamAtAltitude, applyTuningUniforms } from './app/utils/atmosphere.js';

const errors=[]; const oe=console.error; console.error=(...a)=>{errors.push(a.join(' ')); oe(...a);};
const TW=${TW}, TH=${TH}, FOV=${FOV};
const VIEW_ELEV=${VIEW_ELEV}, VIEW_AZ=${VIEW_AZ}, SUN_AZ=${SUN_AZ}, SUN_ALT=${SUN_ALT};
const PHOTOS=${JSON.stringify(PHOTOS)};

const canvas=document.getElementById('c');
canvas.width=TW*4; canvas.height=TH*2;
const ctx2d=canvas.getContext('2d', {willReadFrequently:true});
const glCanvas=document.createElement('canvas'); glCanvas.width=TW; glCanvas.height=TH;
const renderer=new THREE.WebGLRenderer({canvas:glCanvas,antialias:false,alpha:false});
renderer.setPixelRatio(1); renderer.setSize(TW,TH,false);
const gl=renderer.getContext();
const scene=new THREE.Scene();
const skydome=createSkydome(); scene.add(skydome.mesh);
const slab=createCloudSlab(); slab.mesh.renderOrder=10; scene.add(slab.mesh);

const OFFSETS=[-180,-150,-120,-90,-60,-30,0,30,60,90,120,150,180];
const DISTS=[5,12,30,70,160,360];
const jit=(v,d,a,k)=>Math.max(0,Math.min(100, v+18*Math.sin(d*0.031+a*0.017+k)+12*Math.cos(d*0.017-a*0.026+k)));
const W={low:35,mid:8,high:0,hum:55,vis:30000};
{
  const pts=[{distance:0,azimuthOffset:0,low:W.low,mid:W.mid,high:W.high,
              humidity:W.hum,precipitation:0,visibility:W.vis}];
  for(const off of OFFSETS) for(const d of DISTS)
    pts.push({distance:d,azimuthOffset:off,low:jit(W.low,d,off,0),
              mid:jit(W.mid,d,off+40,1),high:0,humidity:W.hum,precipitation:0});
  const fan=new WeatherFan(pts,SUN_AZ);
  bakeCloudSlabCoverage(slab,(azDeg,distKm)=>{const {data,confidence}=fan.sample(azDeg,distKm);
    if(!data) return {low:0,mid:0,high:0,confidence:0};
    return {low:data.low/100,mid:data.mid/100,high:0,
            confidence:Math.max(0,Math.min(1,confidence))};});
}

function shoot(){
  const atm=makeAtmosphereParams({latitude:37.5,observerElevM:24,dayOfYear:200,
    humidityPct:W.hum,visibilityM:W.vis});
  const cam=new THREE.PerspectiveCamera(FOV,TW/TH,0.1,2000);
  cam.position.set(0,0,0); cam.up.set(0,1,0);
  const az=VIEW_AZ*Math.PI/180, er=VIEW_ELEV*Math.PI/180;
  cam.lookAt(100*Math.cos(er)*Math.sin(az),100*Math.sin(er),-100*Math.cos(er)*Math.cos(az));
  cam.updateMatrixWorld(true);
  const a=SUN_ALT*Math.PI/180, z=SUN_AZ*Math.PI/180;
  const sunDir=new THREE.Vector3(Math.cos(a)*Math.sin(z),Math.sin(a),-Math.cos(a)*Math.cos(z)).normalize();
  applyTuningUniforms(skydome.mesh.material.uniforms);
  updateSkydome(skydome,SUN_ALT,SUN_AZ,atm);
  applyTuningUniforms(skydome.mesh.material.uniforms);
  updateCloudSlab(slab,{camera:cam,widthPx:TW,heightPx:TH,sunDir,
    sunAltDeg:SUN_ALT,sunAzDeg:SUN_AZ,cityLight:0,
    beamFor:(altKm)=>beamAtAltitude(SUN_ALT,altKm,atm),atmosphere:atm,
    layerWinds:{low:{speedKmh:16,bearingDeg:250},mid:{speedKmh:30,bearingDeg:235},
                high:{speedKmh:70,bearingDeg:220}},
    driftHours:0,visible:true});
  applyTuningUniforms(slab.mesh.material.uniforms);
  renderer.setRenderTarget(null); renderer.setClearColor(0x000000,1);
  renderer.render(scene,cam);
  const buf=new Uint8Array(4*TW*TH);
  gl.readPixels(0,0,TW,TH,gl.RGBA,gl.UNSIGNED_BYTE,buf);
  const out=new Uint8Array(buf.length);
  for(let r=0;r<TH;r++) out.set(buf.subarray((TH-1-r)*TW*4,(TH-r)*TW*4), r*TW*4);
  return out;
}

const lum=(d,p)=>0.2126*d[p]+0.7152*d[p+1]+0.0722*d[p+2];

/**
 * 구름 마스크 — 구름은 밝고 채도가 낮고, 하늘은 파랗습니다.
 * 문턱은 그 그림 자체의 분포에서 뽑아 사진·렌더에 같은 규칙을 씁니다.
 */
function cloudMask(d,w,h){
  const score=new Float32Array(w*h);
  for(let i=0;i<w*h;i++){
    const p=i*4, R=d[p], G=d[p+1], B=d[p+2];
    const mx=Math.max(R,G,B), mn=Math.min(R,G,B);
    const sat=mx>0?(mx-mn)/mx:0;
    // 밝을수록·채도가 낮을수록 구름
    score[i]=lum(d,p)/255*(1-sat);
  }
  const srt=Float32Array.from(score).sort();
  // 중앙값과 상위 15% 의 중간을 문턱으로 — 한쪽으로 치우친 그림에도 견딤
  const thr=0.5*(srt[Math.floor(srt.length*0.5)]+srt[Math.floor(srt.length*0.85)]);
  const m=new Uint8Array(w*h);
  for(let i=0;i<w*h;i++) m[i]=score[i]>thr?1:0;
  return m;
}

/** 4이웃 둘레 — 마스크 경계를 지나는 변의 수 */
function perimeter(m,w,h){
  let p=0;
  for(let y=0;y<h;y++) for(let x=0;x<w;x++){
    const v=m[y*w+x];
    if(x+1<w && m[y*w+x+1]!==v) p++;
    if(y+1<h && m[(y+1)*w+x]!==v) p++;
  }
  return p;
}
/** s배 축소 — 다수결 */
function shrink(m,w,h,s){
  const W2=Math.floor(w/s), H2=Math.floor(h/s), o=new Uint8Array(W2*H2);
  for(let y=0;y<H2;y++) for(let x=0;x<W2;x++){
    let c=0; for(let j=0;j<s;j++) for(let i=0;i<s;i++) c+=m[(y*s+j)*w+x*s+i];
    o[y*W2+x]=c*2>s*s?1:0;
  }
  return {m:o,w:W2,h:H2};
}

/**
 * 구름 **안쪽**의 음영 모델링을 여러 척도로 잽니다.
 *
 * 처음에는 5화소 고주파 하나만 봤는데, 그건 잔결이지 모델링이 아닙니다.
 * 사진의 적운을 플라스틱과 가르는 것은 화소 단위 오돌토돌함이 아니라
 * **흰 꼭대기에서 회색 밑동까지의 큰 명암**입니다. 그래서 세 척도로
 * 나눠 잽니다 — 각 척도의 고주파 성분 표준편차를 안쪽 평균으로 나눈 값.
 */
function innerGrain(d,m,w,h){
  const inner=new Uint8Array(w*h);
  for(let y=3;y<h-3;y++) for(let x=3;x<w-3;x++){
    if(!m[y*w+x]) continue;
    let all=1;
    for(let j=-3;j<=3&&all;j++) for(let i=-3;i<=3;i++) if(!m[(y+j)*w+x+i]){all=0;break;}
    inner[y*w+x]=all;
  }
  let mean=0,n=0;
  for(let i=0;i<w*h;i++) if(inner[i]){ mean+=lum(d,i*4); n++; }
  if(n<200) return null;
  mean/=n;
  // 척도별: 반경 r 상자평균을 뺀 나머지의 표준편차
  const out={};
  for(const r of [2,7,20]){
    let s=0,q=0,c=0;
    for(let y=r;y<h-r;y++) for(let x=r;x<w-r;x++){
      if(!inner[y*w+x]) continue;
      let a=0,k=0;
      for(let j=-r;j<=r;j+=Math.max(1,Math.floor(r/3))) for(let i=-r;i<=r;i+=Math.max(1,Math.floor(r/3))){
        a+=lum(d,((y+j)*w+x+i)*4); k++;
      }
      const hi=lum(d,(y*w+x)*4)-a/k;
      s+=hi; q+=hi*hi; c++;
    }
    if(c>100){ const sd=Math.sqrt(Math.max(0,q/c-(s/c)*(s/c))); out['모델링_'+(2*r+1)+'px']=+(sd/mean).toFixed(4); }
  }
  out.안쪽화소=n;
  return out;
}

function measure(d,w,h){
  const m=cloudMask(d,w,h);
  const P1=perimeter(m,w,h);
  const s4=shrink(m,w,h,4);
  const P4=perimeter(s4.m,s4.w,s4.h)*4;
  let area=0; for(let i=0;i<w*h;i++) area+=m[i];
  const g=innerGrain(d,m,w,h)||{};
  return { 테두리거칠기: P4>0?+(P1/P4).toFixed(3):null,
           구름면적: +(area/(w*h)).toFixed(3), ...g };
}

/** 사진을 우리 각해상도로 줄여 같은 크기 캔버스에 담습니다. */
function photoAt(img, fovDeg){
  const cw=document.createElement('canvas'); cw.width=TW; cw.height=TH;
  const cx=cw.getContext('2d',{willReadFrequently:true});
  // 사진의 화각이 우리와 달라도, 화면을 꽉 채워 그리면 deg/px 가 같아집니다
  // (둘 다 '화각 전체를 TW 화소로'). 세로는 비율 유지로 잘라 냅니다.
  const s=Math.max(TW/img.width, TH/img.height);
  const dw=img.width*s, dh=img.height*s;
  cx.drawImage(img,(TW-dw)/2,(TH-dh)/2,dw,dh);
  return cx.getImageData(0,0,TW,TH);
}

const rows=[];
const ours=shoot();
rows.push({이름:'우리 렌더', ...measure(ours,TW,TH)});
{ const im=ctx2d.createImageData(TW,TH); im.data.set(ours); ctx2d.putImageData(im,0,0); }

let col=1;
for(const f of PHOTOS){
  const img=new Image();
  await new Promise(r=>{img.onload=r; img.onerror=r; img.src='../photoref/'+f;});
  if(!img.width){ rows.push({이름:f+' (못 읽음)'}); continue; }
  const id=photoAt(img);
  rows.push({이름:'사진 '+f.replace('.jpg',''), ...measure(id.data,TW,TH)});
  ctx2d.putImageData(id, col*TW, 0); col++;
}

document.getElementById('tbl').innerHTML=
  '<table><tr><th>대상</th><th>테두리 거칠기</th><th>모델링 5px</th><th>모델링 15px</th><th>모델링 41px</th><th>면적</th></tr>'
  +rows.map(r=>'<tr><td>'+r.이름+'</td><td>'+(r.테두리거칠기??'—')+'</td><td>'
    +(r.모델링_5px??'—')+'</td><td>'+(r.모델링_15px??'—')+'</td><td>'
    +(r.모델링_41px??'—')+'</td><td>'+(r.구름면적??'—')+'</td></tr>').join('')+'</table>';

window.__stats={glError:gl.getError(), 결과:rows};
window.__errors=errors;
document.title='DONE::'+(errors.length?'SHADER_ERR':'OK')+'::'+gl.getError();
</script></body></html>`;

fs.mkdirSync(PREVIEW, { recursive: true });
fs.writeFileSync(path.join(PREVIEW, 'edge-rough.html'), html);
console.log('생성 완료: edge-rough.html');
