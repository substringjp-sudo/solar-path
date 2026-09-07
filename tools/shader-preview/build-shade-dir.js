/**
 * **그림자의 방향과 색이 맞는가** (계획 46절).
 *
 * 사용자 지적: "그림자가 너무 과하고 그림자가 있는 곳이 맞나 싶은 곳에
 * 있다. 수치 변화가 문제가 아니라 하이라이트와 그림자를 만드는 로직 자체가
 * 문제 같다. 예시 사진과 그림자가 생기는 위치와 방향과 색이 전혀 다르다."
 *
 * 세기가 아니라 **방향과 색**을 잽니다. 둘 다 세기와 무관하게 참·거짓이
 * 갈리는 값이라, 수치를 아무리 돌려도 틀린 건 틀린 채로 남습니다.
 *
 *  ① 조명 방향 — 구름 화소의 휘도 기울기를 모아 평균 방향을 구하고,
 *    **화면에 투영한 태양 방향**과의 각을 냅니다. 제대로 켜져 있으면
 *    태양 쪽으로 갈수록 밝으므로 평균 기울기가 태양을 가리켜 0°에
 *    가깝습니다. 90°를 넘으면 조명이 뒤집힌 것입니다.
 *    렌더는 태양 위치를 정확히 아니까 이건 사진 없이도 참·거짓이 납니다.
 *
 *  ② 그림자 색 — 구름 화소를 휘도로 정렬해 **어두운 1/4 과 밝은 1/4** 의
 *    선형 B/R 을 견줍니다. 진짜 구름 그늘은 따뜻한 직달광이 빠지고 하늘빛만
 *    남으므로 **더 파랗습니다** — 비가 1보다 커야 합니다. 1보다 작으면
 *    그늘이 밝은 곳보다 누렇다는 뜻이고, 그건 직달광을 두고 하늘빛을 깎은
 *    것입니다. 사진에도 같은 잣대를 그대로 댈 수 있습니다(태양 위치 불필요).
 *
 * 사용: node tools/shader-preview/build-shade-dir.js
 *       node tools/shader-preview/shoot.js shade-dir.html shade-dir.png 60000
 */
const fs = require('fs');
const path = require('path');
const { PREVIEW } = require('./paths');

const TW = 300, TH = 300;
const FOV = 66, VIEW_ELEV = 35, VIEW_AZ = 200;
/** 태양을 화면 안 여러 곳에 두고 봅니다 — 한 자리만 맞는 우연을 배제합니다. */
const SUNS = [
  { name: '태양 왼쪽 위',  az: 160, alt: 52 },
  { name: '태양 오른쪽',   az: 250, alt: 40 },
  { name: '태양 뒤',       az: 20,  alt: 45 },
];
const PHOTOS = ['day-cumulus_01.jpg', 'day-cumulus_02.jpg'];

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
 body{margin:0;background:#0b0f15;font-family:sans-serif;color:#dde}
 #wrap{position:relative;width:${TW * 3 + 24}px;padding:12px}
 h3{font-size:14px;margin:6px 0}
 .sub{font-size:11px;color:#8aa;margin:0 0 10px;max-width:880px;line-height:1.5}
 table{border-collapse:collapse;font:11px monospace;margin-top:10px}
 td,th{border:1px solid #345;padding:3px 9px;text-align:right}
 td:first-child{text-align:left}
</style></head><body>
<div id="wrap">
<h3>그림자의 방향과 색</h3>
<p class="sub">① 조명 방향 = 구름 휘도 기울기의 평균과 화면 위 태양 방향의 각.
 제대로면 0°에 가깝고, 90°를 넘으면 뒤집힌 것입니다.<br>
 ② 그림자 색 = 어두운 1/4 의 선형 B/R ÷ 밝은 1/4 의 선형 B/R.
 진짜 그늘은 직달광이 빠져 하늘빛만 남으므로 <b>1보다 커야</b> 합니다.</p>
<canvas id="c"></canvas><div id="tbl"></div></div>
<script type="module">
import * as THREE from './app/vendor/three.module.js';
import { createSkydome, updateSkydome } from './app/components/SkyScene3D/Skydome.js';
import { createCloudSlab, updateCloudSlab, bakeCloudSlabCoverage }
  from './app/components/SkyScene3D/CloudSlab.js';
import { WeatherFan } from './app/utils/skyColumn.js';
import { makeAtmosphereParams, beamAtAltitude, applyTuningUniforms } from './app/utils/atmosphere.js';

const errors=[]; const oe=console.error; console.error=(...a)=>{errors.push(a.join(' ')); oe(...a);};
const TW=${TW}, TH=${TH}, FOV=${FOV}, VIEW_ELEV=${VIEW_ELEV}, VIEW_AZ=${VIEW_AZ};
const SUNS=${JSON.stringify(SUNS)}, PHOTOS=${JSON.stringify(PHOTOS)};

const canvas=document.getElementById('c');
canvas.width=TW*3; canvas.height=TH*2;
const ctx2d=canvas.getContext('2d',{willReadFrequently:true});
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
const W={low:35,mid:8,hum:55,vis:30000};

function bake(sunAz){
  const pts=[{distance:0,azimuthOffset:0,low:W.low,mid:W.mid,high:0,
              humidity:W.hum,precipitation:0,visibility:W.vis}];
  for(const off of OFFSETS) for(const d of DISTS)
    pts.push({distance:d,azimuthOffset:off,low:jit(W.low,d,off,0),
              mid:jit(W.mid,d,off+40,1),high:0,humidity:W.hum,precipitation:0});
  const fan=new WeatherFan(pts,sunAz);
  bakeCloudSlabCoverage(slab,(azDeg,distKm)=>{const {data,confidence}=fan.sample(azDeg,distKm);
    if(!data) return {low:0,mid:0,high:0,confidence:0};
    return {low:data.low/100,mid:data.mid/100,high:0,
            confidence:Math.max(0,Math.min(1,confidence))};});
}

/** 렌더하고, 화면에 투영한 태양 방향(화소 좌표, y는 아래로 증가)도 같이 냅니다. */
function shoot(S){
  const atm=makeAtmosphereParams({latitude:37.5,observerElevM:24,dayOfYear:200,
    humidityPct:W.hum,visibilityM:W.vis});
  const cam=new THREE.PerspectiveCamera(FOV,TW/TH,0.1,2000);
  cam.position.set(0,0,0); cam.up.set(0,1,0);
  const az=VIEW_AZ*Math.PI/180, er=VIEW_ELEV*Math.PI/180;
  cam.lookAt(100*Math.cos(er)*Math.sin(az),100*Math.sin(er),-100*Math.cos(er)*Math.cos(az));
  cam.updateMatrixWorld(true);
  const a=S.alt*Math.PI/180, z=S.az*Math.PI/180;
  const sunDir=new THREE.Vector3(Math.cos(a)*Math.sin(z),Math.sin(a),-Math.cos(a)*Math.cos(z)).normalize();
  applyTuningUniforms(skydome.mesh.material.uniforms);
  updateSkydome(skydome,S.alt,S.az,atm);
  applyTuningUniforms(skydome.mesh.material.uniforms);
  updateCloudSlab(slab,{camera:cam,widthPx:TW,heightPx:TH,sunDir,
    sunAltDeg:S.alt,sunAzDeg:S.az,cityLight:0,
    beamFor:(altKm)=>beamAtAltitude(S.alt,altKm,atm),atmosphere:atm,
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

  // 화면 위 태양 방향.
  //
  // ⚠ project() 를 쓰면 안 됩니다. 태양이 화각 밖이면(여기 세 조건이 전부
  // 그렇습니다 — 40°·50°·180° 대 반화각 33°) 원근 나눗셈이 무의미하고,
  // 카메라 **뒤**면 w<0 이라 부호까지 뒤집힙니다. 그걸 손으로 되뒤집었더니
  // 하늘 대조군이 175.5° 로 나왔습니다 — 하늘은 반드시 태양 쪽이 밝으므로
  // 틀린 것은 렌더가 아니라 투영이었습니다.
  //
  // 카메라 기저에 정사영하면 화각 밖·뒤 어디서나 방위가 그대로 나옵니다.
  const right=new THREE.Vector3(1,0,0).applyQuaternion(cam.quaternion);
  const upv  =new THREE.Vector3(0,1,0).applyQuaternion(cam.quaternion);
  const fwd  =new THREE.Vector3(0,0,-1).applyQuaternion(cam.quaternion);
  const behind = sunDir.dot(fwd) < 0;
  // 화면 화소 좌표는 y 가 아래로 증가합니다.
  let vx=sunDir.dot(right), vy=-sunDir.dot(upv);
  const L=Math.hypot(vx,vy)||1;
  return {img:out, sun:[vx/L, vy/L], behind};
}

const lum=(d,p)=>0.2126*d[p]+0.7152*d[p+1]+0.0722*d[p+2];
const toLin=v=>{v/=255;return v<=0.04045?v/12.92:Math.pow((v+0.055)/1.055,2.4);};

function cloudMask(d,w,h){
  const score=new Float32Array(w*h);
  for(let i=0;i<w*h;i++){
    const p=i*4, R=d[p],G=d[p+1],B=d[p+2];
    const mx=Math.max(R,G,B), mn=Math.min(R,G,B);
    score[i]=lum(d,p)/255*(1-(mx>0?(mx-mn)/mx:0));
  }
  const srt=Float32Array.from(score).sort();
  const thr=0.5*(srt[Math.floor(srt.length*0.5)]+srt[Math.floor(srt.length*0.85)]);
  const m=new Uint8Array(w*h);
  for(let i=0;i<w*h;i++) m[i]=score[i]>thr?1:0;
  return m;
}

/** 대조군용 — 고역통과 없이 그대로 미분합니다. */
function litDirRaw(d,m,w,h){
  let gx=0,gy=0,n=0;
  for(let y=2;y<h-2;y++) for(let x=2;x<w-2;x++){
    if(!m[y*w+x]) continue;
    let all=1;
    for(let j=-2;j<=2&&all;j++) for(let i=-2;i<=2;i++) if(!m[(y+j)*w+x+i]){all=0;break;}
    if(!all) continue;
    gx+=lum(d,(y*w+x+2)*4)-lum(d,(y*w+x-2)*4);
    gy+=lum(d,((y+2)*w+x)*4)-lum(d,((y-2)*w+x)*4);
    n++;
  }
  return n<300?null:{gx:gx/n,gy:gy/n,n};
}

/**
 * ① 구름 안쪽 **국소** 음영의 기울기 평균 방향.
 *
 * ⚠ 원래 휘도를 그대로 미분하면 **전역 세로 기울기**가 다 먹습니다 —
 * 지평선 쪽이 대기원근으로 밝아지고 층도 세로로 쌓이므로, 평균 기울기가
 * 늘 세로를 가리켜 태양이 어디 있든 80~90°가 나옵니다. 처음에 그렇게 재고
 * "조명이 태양과 무관하다"고 읽을 뻔했습니다.
 *
 * 알고 싶은 것은 구름 한 덩이 안의 음영이므로, 31화소 상자평균을 빼
 * 큰 흐름을 걷어낸 뒤 미분합니다.
 */
function litDir(d,m,w,h){
  // 31화소 상자평균 (성글게 표본)
  const R=15, hp=new Float32Array(w*h);
  for(let y=0;y<h;y++) for(let x=0;x<w;x++){
    let a=0,k=0;
    for(let j=-R;j<=R;j+=5) for(let i=-R;i<=R;i+=5){
      const yy=Math.min(h-1,Math.max(0,y+j)), xx=Math.min(w-1,Math.max(0,x+i));
      a+=lum(d,(yy*w+xx)*4); k++;
    }
    hp[y*w+x]=lum(d,(y*w+x)*4)-a/k;
  }
  let gx=0, gy=0, n=0;
  for(let y=2;y<h-2;y++) for(let x=2;x<w-2;x++){
    if(!m[y*w+x]) continue;
    let all=1;
    for(let j=-2;j<=2&&all;j++) for(let i=-2;i<=2;i++) if(!m[(y+j)*w+x+i]){all=0;break;}
    if(!all) continue;
    gx += hp[y*w+x+2] - hp[y*w+x-2];
    gy += hp[(y+2)*w+x] - hp[(y-2)*w+x];
    n++;
  }
  if(n<300) return null;
  return {gx:gx/n, gy:gy/n, n};
}

/** ② 어두운 1/4 대 밝은 1/4 의 선형 B/R */
function shadowHue(d,m,w,h){
  const px=[];
  for(let i=0;i<w*h;i++) if(m[i]) px.push([lum(d,i*4), i]);
  if(px.length<400) return null;
  px.sort((a,b)=>a[0]-b[0]);
  const q=Math.floor(px.length/4);
  const br=(arr)=>{let R=0,B=0;for(const [,i] of arr){R+=toLin(d[i*4]);B+=toLin(d[i*4+2]);}
    return B/Math.max(1e-6,R);};
  const dark=br(px.slice(0,q)), lit=br(px.slice(-q));
  return {어두운쪽BR:+dark.toFixed(3), 밝은쪽BR:+lit.toFixed(3),
          그늘파랑비:+(dark/lit).toFixed(3)};
}

/**
 * ③ **차분 조명 시험** — 기하 편향을 상쇄합니다.
 *
 * ①은 구름 무늬 자체가 화면에서 세로로 눌려 있어(지평선으로 갈수록
 * distRatio 가 커짐) 기울기가 세로로 치우칩니다. 조명이 완벽해도 90° 근처가
 * 나올 수 있습니다.
 *
 * 같은 구름장을 태양 방위 A 와 A+180 으로 두 번 구우면 그 편향은 **양쪽에
 * 똑같이** 들어가므로 차이에서 지워집니다. 남는 것은 순수한 조명 차이이고,
 * 제대로면 A 쪽이 밝아야 하므로 차이의 기울기가 A 를 가리킵니다.
 */
function diffTest(S){
  bake(S.az);                                  // 구름장은 한 번만 굽습니다
  const a=shoot(S);
  const b=shoot({name:S.name, az:(S.az+180)%360, alt:S.alt});
  const m=cloudMask(a.img,TW,TH);
  let gx=0,gy=0,n=0;
  const df=new Float32Array(TW*TH);
  for(let i=0;i<TW*TH;i++) df[i]=lum(a.img,i*4)-lum(b.img,i*4);
  for(let y=2;y<TH-2;y++) for(let x=2;x<TW-2;x++){
    if(!m[y*TW+x]) continue;
    let all=1;
    for(let j=-2;j<=2&&all;j++) for(let i=-2;i<=2;i++) if(!m[(y+j)*TW+x+i]){all=0;break;}
    if(!all) continue;
    gx+=df[y*TW+x+2]-df[y*TW+x-2];
    gy+=df[(y+2)*TW+x]-df[(y-2)*TW+x];
    n++;
  }
  if(n<300) return null;
  gx/=n; gy/=n;
  const l=Math.hypot(gx,gy);
  if(l<1e-5) return null;
  const proj=(gx*a.sun[0]+gy*a.sun[1])/l;
  return {각:+(Math.acos(Math.max(-1,Math.min(1,proj)))*180/Math.PI).toFixed(1),
          세기:+l.toFixed(3)};
}

const rows=[];
SUNS.forEach((S,i)=>{
  bake(S.az);
  const {img,sun,behind}=shoot(S);
  const m=cloudMask(img,TW,TH);
  const g=litDir(img,m,TW,TH);
  // 대조군: **하늘** 화소의 기울기. 하늘은 반드시 태양 쪽이 밝으므로,
  // 여기서 각이 크게 나오면 틀린 것은 렌더가 아니라 내 태양 투영입니다.
  const skyMask=new Uint8Array(TW*TH);
  for(let i=0;i<TW*TH;i++) skyMask[i]=m[i]?0:1;
  const gs=litDirRaw(img,skyMask,TW,TH);
  const hue=shadowHue(img,m,TW,TH);
  let angle=null, proj=null;
  if(g){
    const gl2=Math.hypot(g.gx,g.gy);
    if(gl2>1e-4){
      proj=(g.gx*sun[0]+g.gy*sun[1])/gl2;
      angle=+(Math.acos(Math.max(-1,Math.min(1,proj)))*180/Math.PI).toFixed(1);
    }
  }
  // ⚠ 하늘 대조군은 **가로 성분만** 봅니다. 세로는 지평선으로 갈수록
  // 밝아지는 진짜 기울기가 지배해서 태양과 무관하게 90° 근처를 만듭니다.
  let skyAngle=null;
  if(gs && Math.abs(sun[0])>0.05){
    skyAngle = (gs.gx*sun[0] > 0) ? '맞음' : '뒤집힘';
  }
  const dt=diffTest(S);
  bake(S.az);
  rows.push({이름:S.name+(behind?' (뒤)':''), 하늘대조:skyAngle, 조명각:angle,
             차분각:dt?dt.각:null, 차분세기:dt?dt.세기:null,
             기울기세기:g?+Math.hypot(g.gx,g.gy).toFixed(3):null, ...(hue||{})});
  const im=ctx2d.createImageData(TW,TH); im.data.set(img); ctx2d.putImageData(im,i*TW,0);
  // 태양 방향을 화살표로
  ctx2d.strokeStyle='#ff0'; ctx2d.lineWidth=2; ctx2d.beginPath();
  const cx=i*TW+TW/2, cy=TH/2;
  ctx2d.moveTo(cx,cy); ctx2d.lineTo(cx+sun[0]*60, cy+sun[1]*60); ctx2d.stroke();
  ctx2d.fillStyle='#ff0'; ctx2d.fillRect(cx+sun[0]*60-3, cy+sun[1]*60-3, 6, 6);
});

let col=0;
for(const f of PHOTOS){
  const img=new Image();
  await new Promise(r=>{img.onload=r; img.onerror=r; img.src='../photoref/'+f;});
  if(!img.width) continue;
  const cw=document.createElement('canvas'); cw.width=TW; cw.height=TH;
  const cx2=cw.getContext('2d',{willReadFrequently:true});
  const s=Math.max(TW/img.width, TH/img.height);
  cx2.drawImage(img,(TW-img.width*s)/2,(TH-img.height*s)/2,img.width*s,img.height*s);
  const id=cx2.getImageData(0,0,TW,TH);
  const m=cloudMask(id.data,TW,TH);
  rows.push({이름:'사진 '+f.replace('.jpg',''), 조명각:null, 기울기세기:null,
             ...(shadowHue(id.data,m,TW,TH)||{})});
  ctx2d.putImageData(id, col*TW, TH); col++;
}

document.getElementById('tbl').innerHTML=
  '<table><tr><th>조건</th><th>하늘 대조</th><th>조명각</th><th>기울기</th><th>차분각(0°가 옳음)</th><th>차분세기</th>'
  +'<th>어두운쪽 B/R</th><th>밝은쪽 B/R</th><th>그늘파랑비(&gt;1 이 옳음)</th></tr>'
  +rows.map(r=>'<tr><td>'+r.이름+'</td><td>'+(r.하늘대조??'—')+'</td><td>'+(r.조명각??'—')+'</td><td>'
    +(r.기울기세기??'—')+'</td><td>'+(r.차분각??'—')+'</td><td>'+(r.차분세기??'—')+'</td><td>'+(r.어두운쪽BR??'—')+'</td><td>'
    +(r.밝은쪽BR??'—')+'</td><td>'+(r.그늘파랑비??'—')+'</td></tr>').join('')+'</table>';

window.__stats={glError:gl.getError(), 결과:rows};
window.__errors=errors;
document.title='DONE::'+(errors.length?'SHADER_ERR':'OK')+'::'+gl.getError();
</script></body></html>`;

fs.mkdirSync(PREVIEW, { recursive: true });
fs.writeFileSync(path.join(PREVIEW, 'shade-dir.html'), html);
console.log('생성 완료: shade-dir.html');
