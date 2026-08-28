/**
 * **제안 구조의 최소 프로토타입** — "이렇게 하면 대충 이렇게 나온다".
 *
 * `docs/SKY_REBUILD_PLAN.md` 의 3~8절을 하네스에서 가장 작게 구현한 것입니다.
 * 앱 코드는 건드리지 않습니다. 목업이 아니라 **실제로 도는 렌더**라,
 * 안 나오면 안 나오는 대로 보입니다.
 *
 * 들어간 것 (계획의 어느 절인지):
 *  - 5절: 극좌표 격자 없음. 화면 픽셀 → 방향 → 지상거리 → 월드 (x,z).
 *    덱 기하도, 정점 보간도 없는 **전체화면 패스 하나**입니다.
 *  - 4절: 문턱이 아니라 **두께**. 알파는 exp(-τ)에서 나오고, 얇은 곳은
 *    저절로 반투명이라 빛이 투과합니다.
 *  - 4절: 자기그림자 — 태양 쪽으로 두께를 한 번 더 읽습니다.
 *  - 1절: 층마다 다른 빔 색 (`beamAtAltitude`). 높은 층이 늦게까지 붉습니다.
 *  - 8절: **선명도 ∝ 확신도** — 태양 방위에서 멀어질수록 디테일 진폭과
 *    가장자리를 풀어 암시로 남깁니다.
 *
 * 안 들어간 것: 적운 SDF, 실제 예보 격자(합성 운량장으로 대체), 시간 이류.
 *
 * 준비: node tools/shader-preview/stage-esm.js
 * 사용: node tools/shader-preview/build-look-sample.js
 */
const fs = require('fs');
const path = require('path');
const { PREVIEW } = require('./paths');

const TW = 460, TH = 460;
const FOV_DEG = 62;
const VIEW_AZ = 262, VIEW_ELEV = 14;
const SUN_AZ = 268;
// 노을이 만들어지는 구간을 훑습니다.
const PANELS = [8, 2, 0, -3];

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
 body{margin:0;background:#0b0f15;font-family:sans-serif;color:#dde}
 #wrap{position:relative;width:${TW * 4 + 24}px;padding:12px}
 .lbl{position:absolute;color:#fff;font-size:12px;font-family:monospace;
   pointer-events:none;line-height:1.45;background:rgba(6,10,16,.72);
   padding:5px 8px;border-radius:5px}
 h3{font-size:13px;margin:6px 0}
 .sub{font-size:11px;color:#8aa;margin:0 0 8px}
</style></head><body>
<div id="wrap">
<h3>제안 구조 프로토타입 — 두께장 + 고도별 빔 + 확신도 연동 (조각구름 하늘, 태양 고도만 바뀜)</h3>
<p class="sub">문턱 없음 · 극좌표 격자 없음 · 전체화면 패스 하나. 왼쪽이 태양 쪽(확신도 높음), 오른쪽으로 갈수록 추정이라 풀립니다.</p>
<canvas id="c"></canvas><div id="labels"></div></div>
<script type="module">
import * as THREE from './app/vendor/three.module.js';
import { ATMOSPHERE_GLSL, makeTuningUniforms, makeAtmosphereParams,
         beamAtAltitude } from './app/utils/atmosphere.js';

const errors = [];
const oe = console.error;
console.error = (...a) => { errors.push(a.join(' ')); oe(...a); };

const TW=${TW}, TH=${TH}, FOV_DEG=${FOV_DEG};
const VIEW_AZ=${VIEW_AZ}, VIEW_ELEV=${VIEW_ELEV}, SUN_AZ=${SUN_AZ};
const PANELS=${JSON.stringify(PANELS)};

const canvas = document.getElementById('c');
canvas.width = TW*4; canvas.height = TH;
const ctx2d = canvas.getContext('2d');

const glCanvas = document.createElement('canvas');
glCanvas.width = TW; glCanvas.height = TH;
const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias:false, alpha:false });
renderer.setPixelRatio(1);
renderer.setSize(TW, TH, false);

const atmosphere = makeAtmosphereParams({
  latitude: 37.5, observerElevM: 30, dayOfYear: 240,
  humidityPct: 62, visibilityM: 24000,
});

const FRAG = \`
precision highp float;
\${ATMOSPHERE_GLSL}

uniform vec2  uRes;
uniform vec3  uRight, uUp, uFwd;   // 카메라 기저
uniform float uTanHalf;
uniform vec3  uSunDir;
uniform float uSunAltDeg, uSunAzDeg;
uniform vec3  uBeamLow, uBeamMid, uBeamHigh;
uniform float uCoverLow, uCoverMid, uCoverHigh;
uniform float uBeta, uAngstrom, uElevScale, uOzoneDU;

const float R_EARTH = 6371.0;

// ── 값 노이즈 + fbm ────────────────────────────────────────────────────
// 월드 좌표(km)로 읽습니다. 타일이 없으므로 지평선에서 격자가 서지 않습니다.
float hash21(vec2 p){
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f*f*(3.0-2.0*f);
  float a = hash21(i), b = hash21(i+vec2(1,0));
  float c = hash21(i+vec2(0,1)), d = hash21(i+vec2(1,1));
  return mix(mix(a,b,f.x), mix(c,d,f.x), f.y);
}
float fbm(vec2 p, int oct){
  float s = 0.0, a = 0.5, n = 0.0;
  for (int i = 0; i < 6; i++){
    if (i >= oct) break;
    s += a * vnoise(p); n += a; p *= 2.03; p += 7.1; a *= 0.5;
  }
  return s / max(1e-5, n);
}

/** 고도각 → 그 고도 구름층까지의 지상거리 (구면). 천정에서 0으로 선형 수렴. */
float groundDist(float sinE, float cosE, float h){
  float chord = 2.0*R_EARTH*h + h*h;
  float r = chord / (R_EARTH*sinE + sqrt(R_EARTH*R_EARTH*sinE*sinE + chord));
  float theta = asin(clamp(r*cosE/(R_EARTH+h), 0.0, 1.0));
  return (R_EARTH + h) * theta;
}

/**
 * 한 층의 두께장. **문턱이 없습니다** — 운량이 두께를 정하고, 가장자리는
 * 저절로 얇아집니다. 얇으면 빛이 통과해 빛나고, 두꺼우면 막혀 실루엣이
 * 됩니다. 그게 노을 광학의 전부입니다.
 *
 * conf: 확신도(0~1). 낮으면 디테일 진폭을 줄여 **암시로 남깁니다.**
 */
float thicknessAt(vec2 km, float cover, float cellKm, float conf, float seed){
  vec2 p = km / cellKm + seed;
  // 큰 규모 — 예보가 담당할 자리 (여기서는 합성)
  float big = fbm(p * 0.30, 4);
  // 잔 규모 — 확신도에 비례해서만 넣습니다
  float fine = fbm(p * 1.35, 5);
  float m = cover * 1.55 * (big * 0.72 + 0.28) + (fine - 0.5) * 0.42 * conf;
  // 문턱이 아니라 **부드러운 바닥**. 아래는 맑은 하늘, 위는 연속적인 두께.
  return max(0.0, m - 0.40);
}

void main(){
  vec2 ndc = (gl_FragCoord.xy / uRes) * 2.0 - 1.0;
  ndc.x *= uRes.x / uRes.y;
  vec3 dir = normalize(uRight*(ndc.x*uTanHalf) + uUp*(ndc.y*uTanHalf) + uFwd);

  float sinE = dir.y;
  float cosE = max(sqrt(max(0.0, 1.0 - sinE*sinE)), 1e-4);
  float elevDeg = degrees(asin(clamp(sinE, -1.0, 1.0)));
  float cosG = clamp(dot(dir, uSunDir), -1.0, 1.0);

  // ── 하늘 ──────────────────────────────────────────────────────────────
  vec3 col = atm_skyRadiance(elevDeg, cosG, uSunAltDeg,
                             uBeta, uAngstrom, uElevScale, uOzoneDU);

  // ── 지면 ──────────────────────────────────────────────────────────────
  // 하늘만 그리면 아래 절반이 빈 색띠가 되어 그림을 망칩니다. 사람이
  // 하늘을 볼 때는 늘 지평선이 같이 보입니다.
  float azR = atan(dir.x, -dir.z);
  float ridge = (fbm(vec2(azR * 2.7, 4.0), 3) - 0.5) * 2.2;
  if (elevDeg < ridge) {
    float t = clamp((ridge - elevDeg) / 10.0, 0.0, 1.0);
    vec3 far = col * 0.34;                       // 먼 능선은 하늘빛을 받습니다
    col = mix(far, vec3(0.0016, 0.0018, 0.0022), t * t);
    gl_FragColor = vec4(atm_display(col, 1.0, uSunAltDeg), 1.0);
    return;
  }

  if (sinE > 0.004) {
    vec2 dirXZ = normalize(dir.xz + vec2(1e-6));

    // 확신도 — 태양 방위에서 멀수록 낮습니다 (실제 예보 팬의 성질).
    float azHere = degrees(atan(dir.x, -dir.z));
    float dAz = abs(mod(azHere - uSunAzDeg + 540.0, 360.0) - 180.0);
    float conf = 1.0 - 0.78 * smoothstep(18.0, 130.0, dAz);

    vec2 sunXZ = normalize(uSunDir.xz + vec2(1e-6));

    // 뒤(높은 층)부터 앞(낮은 층)으로 얹습니다.
    for (int L = 0; L < 3; L++){
      float h      = L == 0 ? 10.0 : (L == 1 ? 4.5 : 1.5);
      float cover  = L == 0 ? uCoverHigh : (L == 1 ? uCoverMid : uCoverLow);
      vec3  beam   = L == 0 ? uBeamHigh  : (L == 1 ? uBeamMid  : uBeamLow);
      float cellKm = L == 0 ? 9.0 : (L == 1 ? 4.2 : 2.0);
      float tauK   = L == 0 ? 3.2 : (L == 1 ? 9.0 : 13.0);
      float seed   = float(L) * 31.7;

      float d = groundDist(sinE, cosE, h);
      vec2 km = dirXZ * d;

      float thick = thicknessAt(km, cover, cellKm, conf, seed);
      if (thick <= 0.0) continue;

      float tau = thick * tauK;
      float T = exp(-tau);            // 통과율
      float alpha = 1.0 - T;          // 불투명도 — 가장자리는 저절로 낮습니다

      // 자기그림자: 태양 쪽으로 한 걸음 가서 두께를 다시 읽습니다.
      // 그 앞이 두꺼우면 여기는 그늘 → 어두운 실루엣.
      float thickSun = thicknessAt(km + sunXZ * (cellKm * 0.55),
                                   cover, cellKm, conf, seed);
      float reach = exp(-thickSun * tauK * 0.55);

      // 전방산란 — 태양 쪽 가장자리가 더 밝습니다.
      float ph = 0.45 + 0.55 * pow(max(cosG, 0.0), 5.0);

      // ⚠ 핵심: 빔에 **T**를 곱합니다. 얇을수록 빛이 통과해 빛나고,
      // 두꺼울수록 막혀 주변광만 남습니다. 지금 앱은 여기서 빔이
      // 밝기의 1~12%뿐이라 노을이 창백합니다 (계획 4절).
      vec3 lit = beam * reach * ph * (0.20 + 1.15 * T);

      // 주변광 — 그 층 고도에서 본 하늘.
      vec3 ambUp   = atm_skyRadiance(72.0, cosG, uSunAltDeg,
                                     uBeta, uAngstrom, uElevScale, uOzoneDU);
      vec3 ambDown = atm_skyRadiance(12.0, cosG, uSunAltDeg,
                                     uBeta, uAngstrom, uElevScale, uOzoneDU);
      vec3 amb = mix(ambDown, ambUp, 0.35) * (0.26 + 0.30 * T);

      col = mix(col, lit + amb, alpha);
    }
  }

  gl_FragColor = vec4(atm_display(col, 1.0, uSunAltDeg), 1.0);
}
\`;

const uniforms = {
  ...makeTuningUniforms(),
  uRes: { value: new THREE.Vector2(TW, TH) },
  uRight: { value: new THREE.Vector3() },
  uUp: { value: new THREE.Vector3() },
  uFwd: { value: new THREE.Vector3() },
  uTanHalf: { value: Math.tan(FOV_DEG*Math.PI/360) },
  uSunDir: { value: new THREE.Vector3() },
  uSunAltDeg: { value: 0 },
  uSunAzDeg: { value: SUN_AZ },
  uBeamLow: { value: new THREE.Vector3() },
  uBeamMid: { value: new THREE.Vector3() },
  uBeamHigh: { value: new THREE.Vector3() },
  uCoverLow: { value: 0.24 },
  uCoverMid: { value: 0.38 },
  uCoverHigh: { value: 0.30 },
  uBeta: { value: atmosphere.betaMie },
  uAngstrom: { value: atmosphere.angstrom },
  uElevScale: { value: atmosphere.elevScale },
  uOzoneDU: { value: atmosphere.ozoneDU },
};

const mat = new THREE.ShaderMaterial({
  uniforms,
  vertexShader: 'void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: FRAG,
  depthTest: false, depthWrite: false,
});
const quad = new THREE.Mesh(new THREE.PlaneGeometry(2,2), mat);
quad.frustumCulled = false;
const scene = new THREE.Scene(); scene.add(quad);
const cam = new THREE.Camera();

// 카메라 기저 (시선 방위/고도에서).
{
  const ar = VIEW_AZ*Math.PI/180, er = VIEW_ELEV*Math.PI/180;
  const f = new THREE.Vector3(Math.cos(er)*Math.sin(ar), Math.sin(er), -Math.cos(er)*Math.cos(ar));
  const r = new THREE.Vector3().crossVectors(f, new THREE.Vector3(0,1,0)).normalize();
  const u = new THREE.Vector3().crossVectors(r, f).normalize();
  uniforms.uFwd.value.copy(f);
  uniforms.uRight.value.copy(r);
  uniforms.uUp.value.copy(u);
}

const gl = renderer.getContext();
const labels = document.getElementById('labels');

function shoot(sunAlt){
  const a = sunAlt*Math.PI/180, z = SUN_AZ*Math.PI/180;
  uniforms.uSunDir.value.set(Math.cos(a)*Math.sin(z), Math.sin(a), -Math.cos(a)*Math.cos(z)).normalize();
  uniforms.uSunAltDeg.value = sunAlt;
  const bl = beamAtAltitude(sunAlt, 1.5, atmosphere);
  const bm = beamAtAltitude(sunAlt, 4.5, atmosphere);
  const bh = beamAtAltitude(sunAlt, 10.0, atmosphere);
  uniforms.uBeamLow.value.set(bl.r, bl.g, bl.b);
  uniforms.uBeamMid.value.set(bm.r, bm.g, bm.b);
  uniforms.uBeamHigh.value.set(bh.r, bh.g, bh.b);
  renderer.setRenderTarget(null);
  renderer.render(scene, cam);
  const buf = new Uint8Array(4*TW*TH);
  gl.readPixels(0,0,TW,TH,gl.RGBA,gl.UNSIGNED_BYTE,buf);
  return buf;
}

function paint(buf, x){
  const img = ctx2d.createImageData(TW, TH);
  for (let y = 0; y < TH; y++){
    const src = (TH-1-y)*TW*4, dst = y*TW*4;
    for (let i = 0; i < TW*4; i++) img.data[dst+i] = buf[src+i];
  }
  ctx2d.putImageData(img, x, 0);
}

/** 채도 — 계획 4절이 문제 삼은 값입니다. 지금 앱은 태양 0~+2°에서 0.04~0.12. */
function chroma(buf){
  let s = 0, n = 0;
  for (let p = 0; p < TW*TH; p++){
    const r=buf[p*4], g=buf[p*4+1], b=buf[p*4+2];
    const mx=Math.max(r,g,b), mn=Math.min(r,g,b);
    if (mx < 24) continue;             // 밤하늘 바닥은 뺍니다
    s += (mx-mn)/mx; n++;
  }
  return +(s/Math.max(1,n)).toFixed(3);
}
const lum=(b,p)=>0.2126*b[p*4]+0.7152*b[p*4+1]+0.0722*b[p*4+2];
/** 값 대비 — 빛나는 구름과 실루엣이 같이 있으면 커집니다. */
function spread(buf){
  const v=[]; for(let p=0;p<TW*TH;p++) v.push(lum(buf,p));
  v.sort((a,b)=>a-b);
  return +(v[Math.floor(v.length*0.95)] - v[Math.floor(v.length*0.05)]).toFixed(1);
}

const 결과 = PANELS.map((alt, i) => {
  const buf = shoot(alt);
  paint(buf, i*TW);
  const ch = chroma(buf), sp = spread(buf);
  const d = document.createElement('div');
  d.className='lbl'; d.style.left=(i*TW+20)+'px'; d.style.top='58px';
  d.innerHTML = '태양 '+alt+'°<br>채도 '+ch+'<br>명암폭 '+sp;
  labels.appendChild(d);
  return { 태양고도: alt, 채도: ch, 명암폭: sp };
});

window.__stats = { glError: gl.getError(), 결과 };
window.__errors = errors;
document.title = 'DONE::' + (errors.length ? 'SHADER_ERR' : 'OK') + '::' + gl.getError();
</script></body></html>`;

fs.mkdirSync(PREVIEW, { recursive: true });
fs.writeFileSync(path.join(PREVIEW, 'look-sample.html'), html);
console.log('생성 완료: look-sample.html');
