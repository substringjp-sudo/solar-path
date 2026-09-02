/**
 * **근거리 볼륨 구름 원형** — 모양만. 색은 아직 안 맞춥니다.
 *
 * 왜 따로 만드는가 (계획 23절):
 *   구름 하나 안에서 가까운 쪽과 먼 쪽의 시선거리 비(깊이비)가 1.2 를 넘으면
 *   구름 안에 원근이 생깁니다. 저층 뭉게구름은 5km 에서 1.37, 20km 에서 1.10
 *   이라 **고도각 6° 만 넘으면 전부 근거리**입니다. 지금 슬랩은 껍질을
 *   적분하므로 그 안쪽 구조가 없고, 입체감을 릴리프 노멀로 흉내 냅니다.
 *
 * 그래서 이 원형은 **세계좌표 3D 밀도장**을 시선따라 적분하고, 표본마다
 * 태양 쪽으로 짧게 한 번 더 행진해 **자기그림자**를 만듭니다. 사용자가
 * 말한 "그 부피감 안에서 그림자와 빛들이 복잡하게 산란하고 가려지는 것"이
 * 그 두 번째 행진에서 나옵니다.
 *
 * 앱 모듈을 안 씁니다 — 모양을 보는 단계라 대기 색을 끌어올 이유가 없고,
 * 독립이라야 빨리 돌립니다.
 *
 * 사용: node tools/shader-preview/build-nearfield-volume.js
 *       node tools/shader-preview/shoot.js nearfield-volume.html nearfield.png 40
 */
const fs = require('fs');
const path = require('path');
const { PREVIEW } = require('./paths');

const TW = 400, TH = 330;

// 가로: 운량 · 세로: 운형(적운 / 먹구름)
const CASES = [
  { name: '적운 운량 30%',  genus: 0, cover: 0.30 },
  { name: '적운 운량 55%',  genus: 0, cover: 0.55 },
  { name: '먹구름 운량 85%', genus: 1, cover: 0.85 },
];

const FRAG = `
precision highp float;
varying vec2 vUv;
uniform vec2  uRes;
uniform vec3  uCamDir;
uniform float uFovDeg;
uniform vec3  uSunDir;
uniform float uCover;
uniform float uGenus;      // 0 적운, 1 먹구름
uniform float uSteps;
uniform float uThr;      // <0 이면 uCover 에서 유도, 아니면 직접 지정

// ── 3D 값잡음 + fbm ────────────────────────────────────────────────────
// 슬랩과 같은 이유로 격자를 접습니다 — fract(곱셈) 해시는 좌표가 커지면
// 무너집니다(계획: 실기기 결함 1번).
float h31(vec3 p){
  p = mod(p, 289.0);
  return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
}
float vn3(vec3 p){
  vec3 i = floor(p), f = fract(p);
  f = f*f*(3.0-2.0*f);
  float n000=h31(i), n100=h31(i+vec3(1,0,0)), n010=h31(i+vec3(0,1,0)), n110=h31(i+vec3(1,1,0));
  float n001=h31(i+vec3(0,0,1)), n101=h31(i+vec3(1,0,1)), n011=h31(i+vec3(0,1,1)), n111=h31(i+vec3(1,1,1));
  float x00=mix(n000,n100,f.x), x10=mix(n010,n110,f.x);
  float x01=mix(n001,n101,f.x), x11=mix(n011,n111,f.x);
  return mix(mix(x00,x10,f.y), mix(x01,x11,f.y), f.z);
}
float fbm3(vec3 p){
  float s=0.0, a=0.5, n=0.0;
  for(int i=0;i<5;i++){ s+=a*vn3(p); n+=a; p=mod(p*2.03+7.1, 289.0); a*=0.5; }
  return s/max(1e-5,n);
}

// ── 밀도장 ─────────────────────────────────────────────────────────────
//
// 층의 바닥·두께와 **높이 프로파일**이 운형을 만듭니다:
//   적운   — 바닥이 평평하고 위로 부풀며, 덩어리가 드문드문 (문턱이 높음)
//   먹구름 — 얇고 넓게 깔리며 거의 다 채움 (문턱이 낮고 두께가 작음)
//
// 이게 사용자가 말한 "중층과 바로 위에 뭉게구름이냐 먹구름이냐만 있으면
// 될 것 같다" 의 두 종류입니다.
float baseKm(){ return uGenus < 0.5 ? 1.1 : 0.7; }
float thickKm(){ return uGenus < 0.5 ? 2.6 : 1.6; }

float density(vec3 p){
  float b = baseKm(), t = thickKm();
  float h = (p.y - b) / t;
  if (h < 0.0 || h > 1.0) return 0.0;

  // 높이 프로파일. 적운은 바닥이 평평하고 가운데가 굵으며 위가 좁아집니다.
  // 먹구름(층적운·난층운 계열)은 넓고 고르게 깔립니다.
  float prof = uGenus < 0.5
    ? smoothstep(0.0, 0.08, h) * (1.0 - smoothstep(0.40, 1.0, h))
    : smoothstep(0.0, 0.10, h) * (1.0 - smoothstep(0.75, 1.0, h));

  // 큰 규모: 어디에 덩어리가 있는가. 적운이 더 잘게 끊깁니다.
  float scale = uGenus < 0.5 ? 0.55 : 0.30;
  float n = fbm3(p * scale);

  // 운량 → 문턱. fbm 은 0.5 언저리에 몰려 있으므로 그 폭에 맞춰 폅니다.
  // 운량 → 문턱. **손으로 고른 값이 아니라 역으로 푼 값입니다.**
  // 목표 운량을 주고 천정에서 본 덮임이 그 값이 되는 문턱을 이분 탐색으로
  // 찾아(보정 곡선), 그 결과를 직선으로 맞췄습니다:
  //   적운   20%→0.518  45%→0.454  70%→0.391  90%→0.321
  //   먹구름 20%→0.391  45%→0.363  70%→0.314  90%→0.243
  // 곡선이 살짝 볼록해 직선 근사의 오차는 문턱 0.03 (덮임 몇 %p) 안입니다.
  float thrAuto = uGenus < 0.5
    ? 0.574 - 0.281 * uCover
    : 0.433 - 0.211 * uCover;
  float thr = uThr >= 0.0 ? uThr : thrAuto;
  float d = (n - thr) / max(0.08, 1.0 - thr);
  d = max(0.0, d);

  // ── 가장자리 침식 ──────────────────────────────────────────────────
  //
  // 문턱만 걸면 경계가 매끈한 젤리가 됩니다. 적운의 뭉게뭉게한 윤곽은
  // **가장자리에서만** 잔 무늬로 깎아 내야 나옵니다 — 안쪽까지 깎으면
  // 덩어리가 부서집니다. d 가 작을수록(가장자리) 세게 겁니다.
  float erodeAmt = uGenus < 0.5 ? 0.55 : 0.25;
  float fine = fbm3(p * (scale * 5.0) + 31.7);
  d -= erodeAmt * (1.0 - smoothstep(0.0, 0.45, d)) * (1.0 - fine);
  d = max(0.0, d);

  // 적운은 위로 갈수록 부풀어 오르는 느낌을 위해 살짝 더 단단하게.
  if (uGenus < 0.5) d = pow(d, 0.75);

  return d * prof;
}

void main(){
  vec2 ndc = (vUv - 0.5) * 2.0;
  float aspect = uRes.x / uRes.y;
  float tanH = tan(radians(uFovDeg) * 0.5);
  vec3 fwd = normalize(uCamDir);
  // ⚠ 정확히 위를 보면 cross(fwd, (0,1,0)) 가 영벡터라 기저가 NaN 이 됩니다.
  // 천정 보정을 재려다 덮임이 전부 0% 로 나와서 잡았습니다.
  vec3 ref = abs(fwd.y) > 0.999 ? vec3(0.0,0.0,-1.0) : vec3(0.0,1.0,0.0);
  vec3 right = normalize(cross(fwd, ref));
  vec3 up = cross(right, fwd);
  vec3 dir = normalize(fwd + right*ndc.x*tanH*aspect + up*ndc.y*tanH);

  vec3 sky = mix(vec3(0.52,0.66,0.82), vec3(0.22,0.42,0.72), clamp(dir.y,0.0,1.0));
  if (dir.y <= 0.01){ gl_FragColor = vec4(vec3(0.25,0.28,0.32), 1.0); return; }

  // 층을 관통하는 구간만 행진합니다 — 평면 두 장과의 교점.
  float b = baseKm(), t = thickKm();
  float t0 = b / dir.y, t1 = (b + t) / dir.y;
  // 근거리만 담당합니다. 그 밖은 지금의 슬랩 몫입니다(계획 23절).
  const float NEAR_KM = 22.0;
  t1 = min(t1, NEAR_KM / max(dir.y, 0.05));
  if (t1 <= t0){ gl_FragColor = vec4(sky, 1.0); return; }

  int N = int(uSteps);
  float dt = (t1 - t0) / float(N);
  float trans = 1.0;
  vec3 acc = vec3(0.0);

  for (int i = 0; i < 64; i++){
    if (i >= N) break;
    float s = t0 + (float(i) + 0.5) * dt;
    vec3 p = vec3(0.0, 0.0, 0.0) + dir * s;
    float d = density(p);
    if (d <= 0.001) continue;

    // ── 자기그림자: 태양 쪽으로 짧게 한 번 더 ──────────────────────────
    //
    // 부피감의 정체가 이것입니다. 표본이 구름 덩어리 **안쪽**에 있으면
    // 태양까지 가는 길에 밀도가 쌓여 어두워지고, 태양을 향한 바깥면은
    // 거의 안 가려져 밝습니다. 껍질 적분으로는 이 차이가 안 나옵니다.
    float shadow = 0.0;
    float ds = 0.30;                      // km
    for (int j = 1; j <= 6; j++){
      vec3 q = p + uSunDir * (float(j) * ds);
      shadow += density(q);
    }
    float sunT = exp(-shadow * ds * (uGenus < 0.5 ? 7.0 : 11.0));

    float aTau = d * dt * (uGenus < 0.5 ? 9.0 : 14.0);
    float a = 1.0 - exp(-aTau);
    // 색은 아직 안 맞춥니다 — 밝은 면/그늘 면이 보이기만 하면 됩니다.
    vec3 lit = mix(vec3(0.34,0.36,0.42), vec3(1.0,0.97,0.92), sunT);
    acc += trans * a * lit;
    trans *= (1.0 - a);
    if (trans < 0.01) break;
  }

  gl_FragColor = vec4(acc + sky * trans, 1.0);
}
`;

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
 body{margin:0;background:#0b0f15;font-family:sans-serif;color:#dde}
 #wrap{position:relative;width:${TW * CASES.length + 24}px;padding:12px}
 .lbl{position:absolute;color:#fff;font-size:11px;font-family:monospace;
   pointer-events:none;background:rgba(6,10,16,.82);padding:3px 6px;border-radius:4px}
 h3{font-size:13px;margin:6px 0}
 .sub{font-size:11px;color:#8aa;margin:0 0 8px}
</style></head><body>
<div id="wrap">
<h3>근거리 볼륨 구름 원형 — 모양만 (색은 아직)</h3>
<p class="sub">3D 밀도장을 시선따라 적분하고, 표본마다 태양 쪽으로 6번 더 행진해 자기그림자를 만듭니다.</p>
<canvas id="c"></canvas><div id="labels"></div></div>
<script type="module">
import * as THREE from './app/vendor/three.module.js';
const errors=[]; const oe=console.error; console.error=(...a)=>{errors.push(a.join(' ')); oe(...a);};

const TW=${TW}, TH=${TH};
const CASES=${JSON.stringify(CASES)};
const canvas=document.getElementById('c');
canvas.width=TW*CASES.length; canvas.height=TH;
const ctx2d=canvas.getContext('2d');
const gc=document.createElement('canvas'); gc.width=TW; gc.height=TH;
const renderer=new THREE.WebGLRenderer({canvas:gc, antialias:false, alpha:false});
renderer.setPixelRatio(1); renderer.setSize(TW,TH,false);
const gl=renderer.getContext();

const mat=new THREE.ShaderMaterial({
  uniforms:{
    uRes:{value:new THREE.Vector2(TW,TH)},
    uCamDir:{value:new THREE.Vector3()},
    uFovDeg:{value:62},
    uSunDir:{value:new THREE.Vector3()},
    uCover:{value:0.5}, uGenus:{value:0}, uSteps:{value:48}, uThr:{value:-1},
  },
  vertexShader:'varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.0,1.0); }',
  fragmentShader:${JSON.stringify(FRAG)},
});
const scene=new THREE.Scene();
scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2), mat));
const cam=new THREE.OrthographicCamera(-1,1,1,-1,0,1);

// 시선 고도 22°, 태양 고도 14° 를 시선의 왼쪽 40° 에.
const EL=22*Math.PI/180;
mat.uniforms.uCamDir.value.set(Math.sin(0)*Math.cos(EL), Math.sin(EL), -Math.cos(0)*Math.cos(EL)).normalize();
{
  const sa=14*Math.PI/180, saz=-40*Math.PI/180;
  mat.uniforms.uSunDir.value.set(Math.sin(saz)*Math.cos(sa), Math.sin(sa), -Math.cos(saz)*Math.cos(sa)).normalize();
}

const labels=document.getElementById('labels');

// 하늘만 그린 기준판 — 덮임을 재는 데 씁니다.
mat.uniforms.uCover.value = 0.0;
renderer.setRenderTarget(null); renderer.render(scene,cam);
const skyRaw=new Uint8Array(4*TW*TH);
gl.readPixels(0,0,TW,TH,gl.RGBA,gl.UNSIGNED_BYTE,skyRaw);
const skyBuf=new Uint8Array(skyRaw.length);
for(let r=0;r<TH;r++) skyBuf.set(skyRaw.subarray((TH-1-r)*TW*4,(TH-r)*TW*4), r*TW*4);

// ── 예보 운량이 지켜지는가 ────────────────────────────────────────────
//
// 화면 덮임은 **시선 고도에 따라 달라집니다.** 고도 22° 에서 두께 2.6km 층을
// 보면 광로가 길어 30% 운량도 화면 70% 를 덮습니다 — 그건 틀린 게 아니라
// 기하입니다. 예보와 짝이 맞는 것은 **천정에서 본 수직 투영**이므로,
// 보정은 거기서 재야 합니다.
function zenithCover(cover, genus){
  const savedDir = mat.uniforms.uCamDir.value.clone();
  const savedFov = mat.uniforms.uFovDeg.value;
  mat.uniforms.uCamDir.value.set(0, 1, 0);
  mat.uniforms.uFovDeg.value = 70;
  mat.uniforms.uCover.value = 0; mat.uniforms.uGenus.value = genus;
  renderer.render(scene, cam);
  const sky = new Uint8Array(4*TW*TH);
  gl.readPixels(0,0,TW,TH,gl.RGBA,gl.UNSIGNED_BYTE,sky);
  mat.uniforms.uCover.value = cover;
  renderer.render(scene, cam);
  const buf = new Uint8Array(4*TW*TH);
  gl.readPixels(0,0,TW,TH,gl.RGBA,gl.UNSIGNED_BYTE,buf);
  let c=0, n=0;
  for(let i=0;i<TW*TH;i++){
    const p=i*4; n++;
    if (Math.abs(buf[p]-sky[p])+Math.abs(buf[p+1]-sky[p+1])+Math.abs(buf[p+2]-sky[p+2]) > 18) c++;
  }
  mat.uniforms.uCamDir.value.copy(savedDir);
  mat.uniforms.uFovDeg.value = savedFov;
  return c/n;
}

// ── 보정 곡선 — 목표 운량을 주고 문턱을 역으로 풉니다 ──────────────────
//
// 손으로 맞춘 매핑(mix(0.62, 0.30, cover))은 30% 에서 18%, 85% 에서 52% 로
// 어긋났습니다. 문턱↔덮임은 단조라 이분 탐색으로 풀립니다. 여기서 나온
// 곡선을 코드에 박으면 예보 운량이 지켜집니다.
let _skyRef = null;
function coverAtThr(thr, genus){
  mat.uniforms.uGenus.value = genus;
  mat.uniforms.uThr.value = thr;
  renderer.render(scene, cam);
  const buf=new Uint8Array(4*TW*TH);
  gl.readPixels(0,0,TW,TH,gl.RGBA,gl.UNSIGNED_BYTE,buf);
  let c=0;
  for(let i=0;i<TW*TH;i+=3){ const q=i*4;
    if (Math.abs(buf[q]-_skyRef[q])+Math.abs(buf[q+1]-_skyRef[q+1])+Math.abs(buf[q+2]-_skyRef[q+2]) > 18) c+=3; }
  return c/(TW*TH);
}
function solveThr(target, genus){
  let lo=0.05, hi=0.95;
  for(let it=0; it<7; it++){
    const mid=(lo+hi)/2;
    if (coverAtThr(mid, genus) > target) lo=mid; else hi=mid;
  }
  const thr=(lo+hi)/2;
  return { thr:+thr.toFixed(3), got:+coverAtThr(thr, genus).toFixed(3) };
}
// 보정 탐색은 한 번 재서 값을 박으면 끝이라, 평소에는 건너뜁니다
// (216번 레이마치라 SwiftShader 에서 2분 넘게 걸립니다).
// 다시 재려면 주소에 ?calib 를 붙이세요.
const 보정=[];
if (location.search.indexOf('calib') >= 0) {
  const savedDir=mat.uniforms.uCamDir.value.clone(), savedFov=mat.uniforms.uFovDeg.value;
  mat.uniforms.uCamDir.value.set(0,1,0); mat.uniforms.uFovDeg.value=70;
  mat.uniforms.uSteps.value = 24;             // 보정 중에는 가볍게
  for (const genus of [0,1]) {
    // 하늘 기준판은 운형마다 한 번만.
    mat.uniforms.uGenus.value = genus; mat.uniforms.uThr.value = 1.0;
    renderer.render(scene, cam);
    _skyRef = new Uint8Array(4*TW*TH);
    gl.readPixels(0,0,TW,TH,gl.RGBA,gl.UNSIGNED_BYTE,_skyRef);
    for (const tgt of [0.20,0.45,0.70,0.90]) {
      const r=solveThr(tgt, genus);
      보정.push({ 운형: genus===0?'적운':'먹구름', 목표:tgt, 문턱:r.thr, 실제:r.got });
    }
  }
  mat.uniforms.uSteps.value = 48;
  mat.uniforms.uCamDir.value.copy(savedDir); mat.uniforms.uFovDeg.value=savedFov;
  mat.uniforms.uThr.value=-1;
}

const 결과=[];
CASES.forEach((c,i)=>{
  const 천정덮임 = zenithCover(c.cover, c.genus);
  mat.uniforms.uCover.value=c.cover;
  mat.uniforms.uGenus.value=c.genus;
  renderer.setRenderTarget(null); renderer.render(scene,cam);
  const buf=new Uint8Array(4*TW*TH);
  gl.readPixels(0,0,TW,TH,gl.RGBA,gl.UNSIGNED_BYTE,buf);
  const top=new Uint8Array(buf.length);
  for(let r=0;r<TH;r++) top.set(buf.subarray((TH-1-r)*TW*4,(TH-r)*TW*4), r*TW*4);
  const img=ctx2d.createImageData(TW,TH); img.data.set(top); ctx2d.putImageData(img, i*TW, 0);
  // 화면 덮임 — **하늘만 그린 판과 비교**합니다.
  //
  // 처음에는 "붉은 채널이 파란 채널보다 크면 구름"으로 셌는데, 회색 먹구름은
  // 회색빛 하늘과 그 관계가 같아서 85% 운량이 2% 로 나왔습니다. 지표가
  // 재려는 것을 재는지 먼저 봐야 한다는 걸 또 밟았습니다.
  let cloud=0, n=0;
  for(let y=0;y<Math.floor(TH*0.9);y++) for(let x=0;x<TW;x++){
    const p=(y*TW+x)*4; n++;
    const dr=Math.abs(top[p]-skyBuf[p]), dg=Math.abs(top[p+1]-skyBuf[p+1]), db=Math.abs(top[p+2]-skyBuf[p+2]);
    if (dr+dg+db > 18) cloud++;
  }
  결과.push({ 이름:c.name, 운량:c.cover, 화면덮임:+(cloud/n).toFixed(3),
              천정덮임:+천정덮임.toFixed(3) });
  const d=document.createElement('div');
  d.className='lbl'; d.style.left=(i*TW+10)+'px'; d.style.top='62px';
  d.innerHTML=c.name+'<br>화면덮임 '+(cloud/n*100).toFixed(0)+'%'
    +'<br>천정덮임 '+(천정덮임*100).toFixed(0)+'% (예보 '+(c.cover*100).toFixed(0)+'%)';
  labels.appendChild(d);
});

window.__stats={ glError:gl.getError(), 결과, 보정 };
window.__errors=errors;
document.title='DONE::'+(errors.length?'SHADER_ERR':'OK')+'::'+gl.getError();
</script></body></html>`;

fs.mkdirSync(PREVIEW, { recursive: true });
fs.writeFileSync(path.join(PREVIEW, 'nearfield-volume.html'), html);
console.log('생성 완료: nearfield-volume.html');
