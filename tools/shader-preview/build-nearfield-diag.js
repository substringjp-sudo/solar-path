/**
 * **근거리 볼륨 진단** — 회색 도배의 출처가 밀도장인가 조명인가.
 *
 * 33절에서 이걸로 갈렸습니다. 먹구름이 균일한 회색으로 나올 때 원인은 둘
 * 중 하나입니다 — 밀도장에 무늬가 없거나, 무늬는 있는데 조명 항이 그걸
 * 버리거나. 그림만 봐서는 구분이 안 됩니다. 세 칸으로 나눠 봅니다:
 *
 *   1. 수평 밀도 단면   — 덩어리가 실제로 있는가
 *   2. 연직 광학두께 τ  — 밑면 밝기를 정해야 할 정보가 있는가
 *   3. 첫 표본의 sunT   — 정작 쓰는 값에 그 무늬가 남아 있는가
 *
 * 처음 쟀을 때 1은 표준편차 0.155, 2는 0.299 로 멀쩡한데 3에는 무늬가 없고
 * 위아래 그라데이션과 행진 스텝 고리무늬만 있었습니다. 조명 쪽이었습니다.
 *
 * density() 를 여기 다시 쓰지 않고 **build-nearfield-volume.js 에서 잘라옵니다.**
 * 베껴 두면 갈라지고, 갈라진 진단은 없느니만 못합니다.
 *
 * 사용: node tools/shader-preview/build-nearfield-diag.js
 *       node tools/shader-preview/shoot.js nearfield-diag.html nearfield-diag.png 60000
 */
const fs=require('fs'), path=require('path');
const { PREVIEW } = require('./paths');
const src = fs.readFileSync(path.join(__dirname,'build-nearfield-volume.js'),'utf8');
const FRAG = src.split('const FRAG = `')[1].split('\n`;\n')[0];
const PRE = FRAG.split('void main(){')[0];

const TW=320, TH=320;
const FRAG2 = PRE + `
uniform float uMode;   // 0 수평 밀도 단면 · 1 연직 광학두께 · 2 시선이 처음 만나는 표본의 sunT
void main(){
  vec2 uv = vUv;
  if (uMode < 0.5){
    // ±12km 수평 단면, 층 바닥에서 15% 높이.
    vec3 p = vec3((uv.x-0.5)*24.0, baseKm() + 0.15*thickKm(), (uv.y-0.5)*24.0);
    float d = density(p);
    gl_FragColor = vec4(vec3(d), 1.0); return;
  }
  if (uMode < 1.5){
    // 연직 광학두께 — 먹구름 밑면 밝기를 정하는 것이 이것입니다.
    vec2 xz = (uv-0.5)*24.0;
    float t = thickKm(); float tau=0.0;
    for(int i=0;i<24;i++){ float h = (float(i)+0.5)/24.0;
      tau += density(vec3(xz.x, baseKm()+h*t, xz.y)) * (t/24.0) * 14.0; }
    gl_FragColor = vec4(vec3(tau/8.0), 1.0); return;   // 8 로 나눠 화면에 담습니다
  }
  // ── 화소를 실제로 정하는 값 ────────────────────────────────────────
  //
  // ⚠ 처음에는 "밀도를 처음 만나는 표본의 sunT" 를 찍었습니다. 결함의 방향은
  // 그걸로 갈렸지만, **고친 뒤를 재는 자로는 못 씁니다** — 렌더는 표본 하나가
  // 아니라 48개를 알파로 누적하고 그 시작점을 화소마다 흔듭니다. 첫 표본만
  // 보면 흔들기가 빠져 진단 자신의 고리무늬가 남고, 고쳐도 그림이 안 바뀝니다.
  // 화소 색을 정하는 것은 **알파 가중 평균 sunT** 이므로 그걸 그대로 찍습니다.
  vec2 ndc=(uv-0.5)*2.0;
  float tanH=tan(radians(62.0)*0.5), aspect=uRes.x/uRes.y;
  float EL=radians(22.0);
  vec3 fwd=normalize(vec3(0.0,sin(EL),-cos(EL)));
  vec3 right=normalize(cross(fwd,vec3(0.0,1.0,0.0))); vec3 up=cross(right,fwd);
  vec3 dir=normalize(fwd+right*ndc.x*tanH*aspect+up*ndc.y*tanH);
  if(dir.y<=0.01){ gl_FragColor=vec4(0.0,0.0,0.0,1.0); return; }
  float b=baseKm(), t=thickKm();
  float t0=b/dir.y, t1=(b+t)/dir.y;
  float cosE=sqrt(max(0.0,1.0-dir.y*dir.y));
  t1=min(t1, 22.0/max(cosE,1e-3));
  if(t1<=t0){ gl_FragColor=vec4(0.0,0.0,0.0,1.0); return; }
  float dt=(t1-t0)/48.0;
  float jit=fract(sin(dot(gl_FragCoord.xy, vec2(12.9898,78.233)))*43758.5453);
  float trans=1.0, wsum=0.0, sacc=0.0;
  for(int i=0;i<48;i++){
    vec3 p=vec3(0.0)+dir*(t0+jit*dt+float(i)*dt);
    float d=density(p);
    if(d<=0.001) continue;
    float remainKm=max(0.05, baseKm()+thickKm()-p.y);
    float ds=remainKm/6.0;
    float sjit=0.5+0.5*jit;
    float shadow=0.0;
    for(int j=0;j<6;j++) shadow+=density(p+vec3(0.0,1.0,0.0)*((float(j)+sjit)*ds));
    float sunT=exp(-shadow*ds*5.0);
    float a=1.0-exp(-d*dt*14.0);
    float w=trans*a;
    sacc+=w*sunT; wsum+=w; trans*=(1.0-a);
    if(trans<0.01) break;
  }
  if(wsum<=0.0){ gl_FragColor=vec4(0.0,0.0,1.0,1.0); return; }
  gl_FragColor=vec4(vec3(sacc/wsum),1.0); return;
  gl_FragColor=vec4(0.0,0.0,1.0,1.0);   // 파란색 = 밀도를 한 번도 못 만남
}`;

const MODES=[{n:'수평 밀도 단면 (h=0.15)',m:0},{n:'연직 광학두께 τ/8',m:1},{n:'알파 가중 평균 sunT',m:2}];
const html=`<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;background:#0b0f15;color:#dde;font-family:sans-serif}
#wrap{position:relative;width:${TW*MODES.length+24}px;padding:12px}
.lbl{position:absolute;color:#fff;font-size:11px;font-family:monospace;background:rgba(6,10,16,.82);padding:3px 6px;border-radius:4px}
h3{font-size:13px;margin:6px 0}</style></head><body><div id="wrap">
<h3>먹구름 밀도장 진단 — 회색 도배의 출처가 밀도장인가 조명인가</h3>
<canvas id="c"></canvas><div id="labels"></div></div>
<script type="module">
import * as THREE from './app/vendor/three.module.js';
const errors=[]; const oe=console.error; console.error=(...a)=>{errors.push(a.join(' ')); oe(...a);};
const TW=${TW}, TH=${TH}; const MODES=${JSON.stringify(MODES)};
const canvas=document.getElementById('c'); canvas.width=TW*MODES.length; canvas.height=TH;
const ctx2d=canvas.getContext('2d');
const gc=document.createElement('canvas'); gc.width=TW; gc.height=TH;
const renderer=new THREE.WebGLRenderer({canvas:gc,antialias:false,alpha:false});
renderer.setPixelRatio(1); renderer.setSize(TW,TH,false);
const gl=renderer.getContext();
const mat=new THREE.ShaderMaterial({uniforms:{
  uRes:{value:new THREE.Vector2(TW,TH)}, uCamDir:{value:new THREE.Vector3(0,0.37,-0.93)},
  uFovDeg:{value:62}, uSunDir:{value:new THREE.Vector3(-0.62,0.24,-0.74)},
  uCover:{value:0.85}, uGenus:{value:1}, uSteps:{value:48}, uShadowSteps:{value:6},
  uThr:{value:-1}, uPixAng:{value:(62*Math.PI/180)/TH}, uDet:{value:1}, uMode:{value:0}},
  vertexShader:'varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.0,1.0); }',
  fragmentShader:${JSON.stringify(FRAG2)}});
const scene=new THREE.Scene(); scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2),mat));
const cam=new THREE.OrthographicCamera(-1,1,1,-1,0,1);
const labels=document.getElementById('labels');
const 결과=[];
MODES.forEach((M,i)=>{
  mat.uniforms.uMode.value=M.m;
  renderer.setRenderTarget(null); renderer.render(scene,cam);
  const buf=new Uint8Array(4*TW*TH);
  gl.readPixels(0,0,TW,TH,gl.RGBA,gl.UNSIGNED_BYTE,buf);
  const top=new Uint8Array(buf.length);
  for(let r=0;r<TH;r++) top.set(buf.subarray((TH-1-r)*TW*4,(TH-r)*TW*4), r*TW*4);
  const img=ctx2d.createImageData(TW,TH); img.data.set(top); ctx2d.putImageData(img,i*TW,0);
  const v=[]; let blue=0;
  for(let k=0;k<TW*TH;k++){ const p=k*4; v.push(buf[p]/255); if(buf[p+2]>200&&buf[p]<20) blue++; }
  v.sort((a,b)=>a-b);
  const q=f=>+v[Math.floor(f*(v.length-1))].toFixed(3);
  const mean=+(v.reduce((a,b)=>a+b,0)/v.length).toFixed(3);
  const sd=+Math.sqrt(v.reduce((a,b)=>a+(b-mean)*(b-mean),0)/v.length).toFixed(3);
  결과.push({모드:M.n, 평균:mean, 표준편차:sd, p10:q(0.1), p50:q(0.5), p90:q(0.9), 빈광선:+(blue/(TW*TH)).toFixed(3)});
  const d=document.createElement('div'); d.className='lbl'; d.style.left=(i*TW+8)+'px'; d.style.top='40px';
  d.innerHTML=M.n+'<br>평균 '+mean+' 표준편차 '+sd+'<br>p10 '+q(0.1)+' p90 '+q(0.9);
  labels.appendChild(d);
});
window.__stats={glError:gl.getError(), 결과}; window.__errors=errors;
document.title='DONE::'+(errors.length?'SHADER_ERR':'OK');
</script></body></html>`;
fs.writeFileSync(path.join(PREVIEW,'nearfield-diag.html'), html);
console.log('생성 완료: nearfield-diag.html');
