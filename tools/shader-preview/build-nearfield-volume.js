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

const STATS_SRC = fs.readFileSync(
  path.join(__dirname, '../photo-ref/sky-stats.js'), 'utf8')
  .replace(/if \(typeof module[\s\S]*$/, '');   // 브라우저에는 export 가 없습니다

// 적운과 먹구름을 나란히 두고, 같은 먹구름을 스침각에서 한 번 더 봅니다.
// 먹구름이 회색 도배가 아니라 **천장**으로 읽히는가가 이 판의 질문입니다.
// 3~4칸이 스침각 검증입니다. 고도 8° 로는 안 됩니다 — 상한이 걸리는 것은
// 7° 아래, 표본이 모자라는 것은 3° 아래라 8° 에서는 예전 코드와 결과가
// **한 화소도 다르지 않습니다**. 2° 에서 갈립니다(광로 45.8km→2.0km).
const CASES = [
  { name: '적운 45%',            genus: 0, cover: 0.45, elev: 22 },
  { name: '적운 45% 안흔듦',      genus: 0, cover: 0.45, elev: 22, sjit: 0 },
  { name: '먹구름 85%',          genus: 1, cover: 0.85, elev: 22 },
  { name: '먹구름 2° 예전 상한',  genus: 1, cover: 0.85, elev:  2, oldCap: 1 },
  { name: '먹구름 2° 새 상한',    genus: 1, cover: 0.85, elev:  2, oldCap: 0 },
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
uniform float uShadowSteps;
uniform float uThr;      // <0 이면 uCover 에서 유도, 아니면 직접 지정
uniform float uSJit;     // 그림자 행진을 화소마다 흔들까 (1 흔듦 / 0 고정)
uniform float uOldCap;   // 1 이면 예전(슬랜트) 근거리 상한 — 스침각 얼룩 비교용

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
  // 먹구름은 **바닥이 날카로워야 천장으로 읽힙니다.** 0.10 은 아래가 흐물해
  // 안개 덩어리처럼 보였습니다. 0.03 으로 좁혀 밑면을 평면에 가깝게 세웁니다.
  float prof = uGenus < 0.5
    ? smoothstep(0.0, 0.08, h) * (1.0 - smoothstep(0.40, 1.0, h))
    : smoothstep(0.0, 0.03, h) * (1.0 - smoothstep(0.80, 1.0, h));

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
  //
  // ⚠ 여기에 화소 발자국 LOD 를 달았다가 **뺐습니다.** 재 보니 못 씁니다:
  // 잔무늬 셀은 적운 0.36km · 먹구름 0.67km 인데 화소 발자국이 거기 닿는
  // 거리는 50km / 91km 입니다. 근거리 상한이 22km 라 **한 번도 안 걸립니다**
  // (LOD 끔/켬 두 판이 화소까지 똑같이 나와서 잡았습니다). 발자국 LOD 가
  // 필요한 곳은 수백 km 를 보는 원거리 슬랩이고, 거기엔 이미 있습니다.
  float fine = fbm3(p * (scale * 5.0) + 31.7);
  d -= (uGenus < 0.5 ? 0.55 : 0.25) * (1.0 - smoothstep(0.0, 0.45, d)) * (1.0 - fine);
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
  //
  // ⚠ 예전에는 NEAR_KM / max(dir.y, 0.05) 였는데 이건 수평 22km 가 아니라
  // **슬랜트 440km** 입니다(dir.y=0.05 에서). 저각에서 근거리 경계가 사실상
  // 안 걸려 광로가 수백 km 가 됐고, dt 가 거대해져 지평선이 얼룩졌습니다.
  // 수평 거리는 슬랜트 x cos(고도각) 이므로 그쪽으로 잘라야 맞습니다.
  const float NEAR_KM = 22.0;
  float cosE = sqrt(max(0.0, 1.0 - dir.y * dir.y));
  float capNew = NEAR_KM / max(cosE, 1e-3);
  float capOld = NEAR_KM / max(dir.y, 0.05);      // 예전 것 — 비교용으로 남깁니다
  t1 = min(t1, mix(capNew, capOld, uOldCap));
  if (t1 <= t0){ gl_FragColor = vec4(sky, 1.0); return; }

  int N = int(uSteps);
  float dt = (t1 - t0) / float(N);

  // ── 스텝 밴딩을 흔들어 없앱니다 ────────────────────────────────────
  //
  // 스텝을 줄이면 구름이 가로로 저며진 것처럼 갈라집니다 — 모든 화소가
  // **같은 자리**에서 표본을 뜨기 때문입니다. 시작점을 화소마다 한 스텝
  // 안에서 흔들면 그 줄무늬가 잡음으로 바뀝니다. 잡음은 훨씬 덜 거슬리고,
  // 앱은 절반 해상도로 그린 뒤 Catmull-Rom 으로 올리므로 더 뭉개집니다.
  // 해시 한 번이라 비용은 사실상 0 입니다.
  float jit = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  float tStart = t0 + jit * dt;
  float trans = 1.0;
  vec3 acc = vec3(0.0);

  for (int i = 0; i < 64; i++){
    if (i >= N) break;
    float s = tStart + float(i) * dt;
    vec3 p = vec3(0.0, 0.0, 0.0) + dir * s;
    float d = density(p);
    if (d <= 0.001) continue;

    // ── 자기그림자: 태양 쪽으로 짧게 한 번 더 ──────────────────────────
    //
    // 부피감의 정체가 이것입니다. 표본이 구름 덩어리 **안쪽**에 있으면
    // 태양까지 가는 길에 밀도가 쌓여 어두워지고, 태양을 향한 바깥면은
    // 거의 안 가려져 밝습니다. 껍질 적분으로는 이 차이가 안 나옵니다.
    // ── 빛이 오는 방향은 운형마다 다릅니다 ──────────────────────────
    //
    // 적운: 직달광이 지배합니다. 태양 쪽으로 행진해 **자기그림자**를 만듭니다.
    //
    // 먹구름: 직달광이 밑면까지 못 옵니다. 밑면 밝기는 그 기둥을 **연직으로**
    //   뚫고 내려온 확산광이 정하므로, 얇은 기둥이 밝게 뜹니다.
    //
    // ⚠ 여기서 **고정 길이로 행진하면 안 됩니다.** 태양 쪽으로 1.8km 를 걷던
    //   것을 위쪽으로 1.6km 걷는 것으로만 바꿨더니 회색 도배가 그대로였습니다.
    //   진단(nearfield-diag)에서 갈렸습니다 — 기둥의 연직 광학두께는 표준편차
    //   0.299 로 무늬가 충분한데, 정작 쓰는 sunT 에는 그 무늬가 없고 **위아래
    //   그라데이션과 행진 스텝의 고리무늬**만 남았습니다. 고정 ds 로 걸으면
    //   표본 높이에 따라 마지막 걸음이 판을 넘거나 못 미쳐, 밝기가 기둥이
    //   아니라 **시선 고도**의 함수가 됩니다.
    //
    //   표본 위로 **남은 두께를 SN 등분**하면 어느 높이에서 출발하든 적분이
    //   판 꼭대기에서 정확히 끝납니다. 그러면 sunT 가 그 기둥의 연직 광학두께
    //   그 자체가 되고, 고리무늬도 같이 사라집니다.
    vec3 lightDir = uGenus < 0.5 ? uSunDir : vec3(0.0, 1.0, 0.0);
    float shadow = 0.0;
    int SN = int(uShadowSteps);
    float remainKm = max(0.05, baseKm() + thickKm() - p.y);
    float ds = uGenus < 0.5 ? (1.8 / float(SN)) : (remainKm / float(SN));
    // 시선과 같은 이유로 그림자 행진도 흔듭니다 — 스텝이 6개뿐이라
    // 안 흔들면 등고선이 보입니다.
    float sjit = mix(0.5, 0.5 + 0.5 * jit, uSJit);
    for (int j = 0; j < 8; j++){
      if (j >= SN) break;
      shadow += density(p + lightDir * ((float(j) + sjit) * ds));
    }
    float sunT = exp(-shadow * ds * (uGenus < 0.5 ? 7.0 : 5.0));

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
<h3>근거리 볼륨 — 먹구름이 천장으로 읽히는가, 스침각이 얼룩지는가</h3>
<p class="sub">1~2칸 그림자 행진 흔들기 A/B · 3칸 먹구름 연직 광학두께 조명 · 4~5칸 근거리 상한 예전(슬랜트) 대 새것(수평), 고도 2°.</p>
<canvas id="c"></canvas><div id="labels"></div></div>
<script type="module">
import * as THREE from './app/vendor/three.module.js';
const errors=[]; const oe=console.error; console.error=(...a)=>{errors.push(a.join(' ')); oe(...a);};

// ── tools/photo-ref/sky-stats.js 를 그대로 삽입 ─────────────────────
// 사진과 렌더를 **같은 함수**로 재기 위해서입니다. 복사해 두면 갈라집니다.
${STATS_SRC}

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
    uCover:{value:0.5}, uGenus:{value:0}, uSteps:{value:48}, uShadowSteps:{value:6}, uThr:{value:-1}, uSJit:{value:1}, uOldCap:{value:0},
  },
  vertexShader:'varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.0,1.0); }',
  fragmentShader:${JSON.stringify(FRAG)},
});
const scene=new THREE.Scene();
scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2), mat));
const cam=new THREE.OrthographicCamera(-1,1,1,-1,0,1);

// 태양 고도 14° 를 시선의 왼쪽 40° 에. 시선 고도는 칸마다 다릅니다.
function setElev(deg){
  const EL=deg*Math.PI/180;
  mat.uniforms.uCamDir.value.set(0, Math.sin(EL), -Math.cos(EL)).normalize();
}
setElev(22);
{
  const sa=14*Math.PI/180, saz=-40*Math.PI/180;
  mat.uniforms.uSunDir.value.set(Math.sin(saz)*Math.cos(sa), Math.sin(sa), -Math.cos(saz)*Math.cos(sa)).normalize();
}

const labels=document.getElementById('labels');

// 하늘만 그린 기준판 — 덮임을 재는 데 씁니다.
// ⚠ 칸마다 시선 고도가 다르면 하늘 그라데이션도 다릅니다. 22° 기준판 하나로
// 8° 칸을 재면 하늘까지 "구름"으로 세어 덮임이 부풀어요. 고도별로 뜹니다.
const skyRefs={};
function skyRefFor(elev){
  const k=String(elev);
  if (skyRefs[k]) return skyRefs[k];
  const savedCover=mat.uniforms.uCover.value;
  setElev(elev);
  mat.uniforms.uCover.value = 0.0;
  renderer.setRenderTarget(null); renderer.render(scene,cam);
  const raw=new Uint8Array(4*TW*TH);
  gl.readPixels(0,0,TW,TH,gl.RGBA,gl.UNSIGNED_BYTE,raw);
  const buf=new Uint8Array(raw.length);
  for(let r=0;r<TH;r++) buf.set(raw.subarray((TH-1-r)*TW*4,(TH-r)*TW*4), r*TW*4);
  mat.uniforms.uCover.value = savedCover;
  skyRefs[k]=buf;
  return buf;
}

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
  const skyBuf = skyRefFor(c.elev);
  setElev(c.elev);
  mat.uniforms.uCover.value=c.cover;
  mat.uniforms.uGenus.value=c.genus;
  mat.uniforms.uSJit.value=(c.sjit===undefined?1:c.sjit);
  mat.uniforms.uOldCap.value=(c.oldCap||0);
  mat.uniforms.uSteps.value=48;
  mat.uniforms.uShadowSteps.value=6;
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
  // ── 사진과 같은 자로 잽니다 ────────────────────────────────────────
  //
  // 눈으로 "회색 도배 같다 / 얼룩진다" 를 판정하면 또 틀립니다. 사진 129장에서
  // 뽑은 표적(무늬기울기 2.03~3.47, 국소대비 0.014~0.049)에 대고 봅니다.
  // 하늘 그라데이션까지 같이 재면 구름 무늬가 묻히므로 위쪽 60% 만 씁니다.
  const s = skyStats(top, TW, TH, { skyFrac: 0.6 });
  const sp = angularSpectrum(top, TW, TH, { skyFrac: 0.6, fovDeg: 62 }) || {};
  // ── 국소대비는 **띠별로** 봐야 합니다 ──────────────────────────────
  //
  // 저층 판을 바로 위에서 보면 밑면까지 0.7km 라 화면에 담기는 수평 폭이
  // 0.5km 뿐인데, 구름 덩어리는 3.3km 입니다. 한 셀의 1/6 도 안 보이니
  // **천정 쪽이 매끄러운 것은 기하이지 결함이 아닙니다.** 실제 흐린 날
  // 사진도 머리 위는 밋밋하고 지평선 쪽이 얼룩덜룩합니다. 위 60% 만 재면
  // 매끄러워야 할 곳을 재고 "회색 도배"라고 판정하게 됩니다.
  // ── 화소잡음 — 얼룩을 재는 유일한 자 ───────────────────────────────
  //
  // ⚠ 국소대비로는 스침각 얼룩이 **안 잡힙니다.** skyStats 는 비교 가능하게
  // 하려고 폭을 320 으로 줄이는데, 그 평균내기가 한 화소짜리 얼룩을 그대로
  // 지웁니다(예전/새 상한이 0.017 대 0.015 로 거의 같게 나왔습니다). 얼룩은
  // 원본 해상도에서 **이웃 화소 차이**로 재야 합니다.
  const 화소잡음 = (()=>{
    let s=0, n=0;
    for(let y=Math.floor(TH*0.35); y<Math.floor(TH*0.75); y++)
      for(let x=0;x<TW-1;x++){
        const p=(y*TW+x)*4, q=p+4;
        const a=0.2126*top[p]+0.7152*top[p+1]+0.0722*top[p+2];
        const b=0.2126*top[q]+0.7152*top[q+1]+0.0722*top[q+2];
        s+=Math.abs(b-a); n++;
      }
    return +(s/n/255).toFixed(4);
  })();
  const 띠 = ['상','중','하'].map((nm,bi)=>{
    const y0=Math.floor(TH*bi/3), y1=Math.floor(TH*(bi+1)/3), bh=y1-y0;
    const band=new Uint8Array(TW*bh*4);
    band.set(top.subarray(y0*TW*4, y1*TW*4));
    return [nm, skyStats(band, TW, bh, {}).국소대비];
  });
  // 밝기폭 — 먹구름이 "천장" 으로 읽히려면 두께 변화가 명암으로 남아야 합니다.
  // 균일한 회색 도배면 이 값이 0 에 붙습니다.
  결과.push({ 이름:c.name, 운량:c.cover, 화면덮임:+(cloud/n).toFixed(3),
              국소대비:s.국소대비, 무늬기울기:sp.무늬기울기 ?? null,
              구름각크기:sp.구름각크기 ?? null, 밝기폭:s.밝기폭,
              화소잡음, 띠국소대비:Object.fromEntries(띠) });
  const d=document.createElement('div');
  d.className='lbl'; d.style.left=(i*TW+10)+'px'; d.style.top='62px';
  d.innerHTML=c.name+'<br>화면덮임 '+(cloud/n*100).toFixed(0)+'%'
    +'<br>국소대비 '+s.국소대비+'<br>무늬기울기 '+(sp.무늬기울기 ?? '—')
    +'<br>화소잡음 '+화소잡음
    +'<br>띠 '+띠.map(b=>b[0]+' '+b[1]).join(' / ');
  labels.appendChild(d);
});

window.__stats={ glError:gl.getError(), 결과, 보정 };
window.__errors=errors;
document.title='DONE::'+(errors.length?'SHADER_ERR':'OK')+'::'+gl.getError();
</script></body></html>`;

fs.mkdirSync(PREVIEW, { recursive: true });
fs.writeFileSync(path.join(PREVIEW, 'nearfield-volume.html'), html);
console.log('생성 완료: nearfield-volume.html');
