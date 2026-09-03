/**
 * **근거리 볼륨이 실기기에서 감당되는가** — 비용 비교, 판정 없음.
 *
 * 27절의 원형은 화소마다 48스텝 × (밀도 1 + 그림자 6) = **336번 밀도 평가**를
 * 합니다. 밀도마다 fbm3 두 개(각 5옥타브 × 8해시)를 도니 화소당 해시가 2만
 * 번을 넘습니다. 지금 슬랩은 2D fbm 에 uVolSteps=1 입니다.
 *
 * SwiftShader 는 CPU 래스터라이저라 **절대 시간은 실기기를 예측하지
 * 못합니다.** 그래서 지금 슬랩과 **같은 화면·같은 해상도**에서 나란히 재고
 * **비율**만 읽습니다 (이 저장소가 배율 스윕에서 쓰던 방식과 같습니다).
 *
 * 준비: node tools/shader-preview/stage-esm.js
 * 사용: node tools/shader-preview/build-volume-cost.js
 *       node tools/shader-preview/verify-volume-cost.js
 */
const fs = require('fs');
const path = require('path');
const { PREVIEW } = require('./paths');

const TW = 320, TH = 320;
const SUN_AZ = 268;

// 시선 스텝 × 그림자 스텝. 원형이 48×6 입니다.
const CONFIGS = [
  { view: 48, shadow: 6 },
  { view: 24, shadow: 6 },
  { view: 24, shadow: 3 },
  { view: 12, shadow: 3 },
  { view: 12, shadow: 2 },
  { view:  8, shadow: 2 },
];

const VOL_FRAG = `
precision highp float;
varying vec2 vUv;
uniform vec2  uRes;
uniform vec3  uCamDir;
uniform float uFovDeg;
uniform vec3  uSunDir;
uniform float uCover;
uniform float uSteps;
uniform float uShadowSteps;
uniform float uOct;      // fbm 옥타브 수. 1 이면 텍스처 인출 한 번에 가까운 비용

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
  int OC = int(uOct);
  if (OC <= 0) return 0.5;                 // 잡음 없음 — 비용 바닥
  float s=0.0, a=0.5, n=0.0;
  for(int i=0;i<5;i++){ if(i>=OC) break;
    s+=a*vn3(p); n+=a; p=mod(p*2.03+7.1, 289.0); a*=0.5; }
  return s/max(1e-5,n);
}
float density(vec3 p){
  float b = 1.1, t = 2.6;
  float h = (p.y - b) / t;
  if (h < 0.0 || h > 1.0) return 0.0;
  float prof = smoothstep(0.0, 0.08, h) * (1.0 - smoothstep(0.40, 1.0, h));
  float n = fbm3(p * 0.55);
  float thr = 0.574 - 0.281 * uCover;
  float d = max(0.0, (n - thr) / max(0.08, 1.0 - thr));
  float fine = fbm3(p * 2.75 + 31.7);
  d -= 0.55 * (1.0 - smoothstep(0.0, 0.45, d)) * (1.0 - fine);
  return max(0.0, pow(max(0.0,d), 0.75)) * prof;
}
void main(){
  vec2 ndc = (vUv - 0.5) * 2.0;
  float tanH = tan(radians(uFovDeg) * 0.5);
  vec3 fwd = normalize(uCamDir);
  vec3 ref = abs(fwd.y) > 0.999 ? vec3(0.0,0.0,-1.0) : vec3(0.0,1.0,0.0);
  vec3 right = normalize(cross(fwd, ref));
  vec3 up = cross(right, fwd);
  vec3 dir = normalize(fwd + right*ndc.x*tanH*(uRes.x/uRes.y) + up*ndc.y*tanH);
  vec3 sky = mix(vec3(0.52,0.66,0.82), vec3(0.22,0.42,0.72), clamp(dir.y,0.0,1.0));
  if (dir.y <= 0.01){ gl_FragColor = vec4(sky,1.0); return; }

  float t0 = 1.1/dir.y, t1 = min(3.7/dir.y, 22.0/max(dir.y,0.05));
  if (t1 <= t0){ gl_FragColor = vec4(sky,1.0); return; }
  int N = int(uSteps), SN = int(uShadowSteps);
  float dt = (t1-t0)/float(N);
  float trans = 1.0; vec3 acc = vec3(0.0);
  for (int i=0;i<64;i++){
    if (i>=N) break;
    vec3 p = dir * (t0 + (float(i)+0.5)*dt);
    float d = density(p);
    if (d <= 0.001) continue;
    float shadow = 0.0, ds = 1.8/float(SN);
    for (int j=1;j<=8;j++){
      if (j>SN) break;
      shadow += density(p + uSunDir * (float(j)*ds));
    }
    float sunT = exp(-shadow * ds * 7.0);
    float a = 1.0 - exp(-d * dt * 9.0);
    acc += trans * a * mix(vec3(0.34,0.36,0.42), vec3(1.0,0.97,0.92), sunT);
    trans *= (1.0-a);
    if (trans < 0.01) break;
  }
  gl_FragColor = vec4(acc + sky*trans, 1.0);
}
`;

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
 body{margin:0;background:#0b0f15;font-family:sans-serif;color:#dde}
 #wrap{width:900px;padding:12px} h3{font-size:13px;margin:6px 0}
 pre{font-size:11px;line-height:1.5}
</style></head><body>
<div id="wrap"><h3>근거리 볼륨 대 현행 슬랩 — 같은 해상도에서 시간 비교</h3>
<pre id="out">재는 중…</pre></div>
<script type="module">
import * as THREE from './app/vendor/three.module.js';
import { createCloudSlab, updateCloudSlab, bakeCloudSlabCoverage }
  from './app/components/SkyScene3D/CloudSlab.js';
import { WeatherFan } from './app/utils/skyColumn.js';
import { makeAtmosphereParams, beamAtAltitude } from './app/utils/atmosphere.js';

const errors=[]; const oe=console.error; console.error=(...a)=>{errors.push(a.join(' ')); oe(...a);};
const TW=${TW}, TH=${TH}, SUN_AZ=${SUN_AZ};
const CONFIGS=${JSON.stringify(CONFIGS)};

const gc=document.createElement('canvas'); gc.width=TW; gc.height=TH;
const renderer=new THREE.WebGLRenderer({canvas:gc, antialias:false, alpha:false});
renderer.setPixelRatio(1); renderer.setSize(TW,TH,false);
const gl=renderer.getContext();

// ── 현행 슬랩 ──────────────────────────────────────────────────────────
const slabScene=new THREE.Scene();
const slab=createCloudSlab(); slab.mesh.renderOrder=10; slabScene.add(slab.mesh);
const atmosphere=makeAtmosphereParams({latitude:37.5, observerElevM:30, dayOfYear:245,
  humidityPct:62, visibilityM:24000});
const OFFSETS=[-180,-120,-60,0,60,120,180], DISTS=[5,12,30,70,160,360];
const pts=[{distance:0,azimuthOffset:0,low:40,mid:20,high:15,humidity:62,precipitation:0,visibility:24000}];
for(const off of OFFSETS) for(const d of DISTS)
  pts.push({distance:d,azimuthOffset:off,low:40,mid:20,high:15,humidity:62,precipitation:0});
const fan=new WeatherFan(pts, SUN_AZ);
bakeCloudSlabCoverage(slab,(az,dk)=>{const {data,confidence}=fan.sample(az,dk);
  if(!data) return {low:0,mid:0,high:0,confidence:0};
  return {low:data.low/100,mid:data.mid/100,high:data.high/100,
          confidence:Math.max(0,Math.min(1,confidence))};});

const EL=22*Math.PI/180, AZ=SUN_AZ*Math.PI/180;
const cam=new THREE.PerspectiveCamera(62,TW/TH,0.1,2000);
cam.position.set(0,0,0); cam.up.set(0,1,0);
cam.lookAt(100*Math.cos(EL)*Math.sin(AZ),100*Math.sin(EL),-100*Math.cos(EL)*Math.cos(AZ));
cam.updateMatrixWorld(true);
const sunAlt=14, sa=sunAlt*Math.PI/180;
const sunDir=new THREE.Vector3(Math.cos(sa)*Math.sin(AZ),Math.sin(sa),-Math.cos(sa)*Math.cos(AZ)).normalize();
const W=(k)=>({speedKmh:k,bearingDeg:260});
updateCloudSlab(slab,{camera:cam,widthPx:TW,heightPx:TH,sunDir,sunAltDeg:sunAlt,sunAzDeg:SUN_AZ,
  cityLight:0.2, beamFor:(a)=>beamAtAltitude(sunAlt,a,atmosphere), atmosphere,
  layerWinds:{low:W(22),mid:W(37),high:W(75)}, driftHours:0, visible:true});

// ── 볼륨 원형 ──────────────────────────────────────────────────────────
const volMat=new THREE.ShaderMaterial({
  uniforms:{ uRes:{value:new THREE.Vector2(TW,TH)}, uCamDir:{value:new THREE.Vector3()},
    uFovDeg:{value:62}, uSunDir:{value:sunDir.clone()}, uCover:{value:0.45},
    uSteps:{value:48}, uShadowSteps:{value:6}, uOct:{value:5} },
  vertexShader:'varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.0,1.0); }',
  fragmentShader:${JSON.stringify(VOL_FRAG)},
});
volMat.uniforms.uCamDir.value.set(Math.cos(EL)*Math.sin(AZ),Math.sin(EL),-Math.cos(EL)*Math.cos(AZ)).normalize();
const volScene=new THREE.Scene();
volScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2), volMat));
const volCam=new THREE.OrthographicCamera(-1,1,1,-1,0,1);

// ⚠ **결과를 읽지 않으면 아무것도 안 재집니다.**
// render() 만 부르고 시간을 재면 336번 밀도 평가짜리 레이마치가 0.1ms 로
// 나옵니다 — 아무도 결과를 안 쓰니 작업이 지연되거나 생략되기 때문입니다.
// gl.finish() 도 여기서는 안 막았습니다. 1화소라도 readPixels 하면 파이프
// 라인이 끝날 때까지 기다리게 되고, 전송 비용은 거의 없습니다.
const _px = new Uint8Array(4);
function flush(){ gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,_px); }
function timeIt(fn, n){
  fn(); flush();                            // 예열
  const t0=performance.now();
  for(let i=0;i<n;i++){ fn(); flush(); }
  return (performance.now()-t0)/n;
}
const drawSlab=()=>{ renderer.setRenderTarget(null); renderer.setClearColor(0x000000,1);
  renderer.clear(); renderer.render(slabScene,cam); };
const drawVol=()=>{ renderer.setRenderTarget(null); renderer.render(volScene,volCam); };

const slabMs=timeIt(drawSlab, 8);
const 결과=[];
for(const c of CONFIGS){
  volMat.uniforms.uOct.value=5;
  volMat.uniforms.uSteps.value=c.view;
  volMat.uniforms.uShadowSteps.value=c.shadow;
  const ms=timeIt(drawVol, 4);
  결과.push({ 시선:c.view, 그림자:c.shadow, 옥타브:5, ms:+ms.toFixed(1),
              배:+(ms/slabMs).toFixed(1), 밀도평가:c.view*(1+c.shadow) });
}
// ── 잡음이 비용에서 얼마를 차지하는가 ────────────────────────────────
//
// 스텝을 줄이는 길은 막혔습니다(12스텝에서 밴딩, 흔들면 잡음). 그러면 남은
// 길은 **밀도 함수를 싸게** 만드는 것입니다. 지금 density() 한 번이 fbm3 두
// 개 = 5옥타브 x 8해시 x 2 = 해시 80번입니다. 옥타브를 줄여 그 상한을 잽니다 —
// 옥타브 1 이 3D 텍스처 인출 한 번의 비용에 가깝습니다(WebGL1 이라 2D 아틀라스
// 두 번 인출 + 보간이 됩니다).
const 옥타브=[];
volMat.uniforms.uSteps.value=48; volMat.uniforms.uShadowSteps.value=6;
for(const oc of [5,3,2,1,0]){
  volMat.uniforms.uOct.value=oc;
  const ms=timeIt(drawVol, 4);
  옥타브.push({ 옥타브:oc, ms:+ms.toFixed(1), 배:+(ms/slabMs).toFixed(1) });
}
volMat.uniforms.uOct.value=5;
window.__stats={ glError:gl.getError(), 슬랩ms:+slabMs.toFixed(1), 결과, 옥타브 };
window.__errors=errors;
document.getElementById('out').textContent =
  '슬랩 '+slabMs.toFixed(1)+'ms\\n' +
   결과.map(function(r){ return '볼륨 ' + r.시선 + 'x' + r.그림자 + '  ' + r.ms
     + 'ms  ' + r.배 + '배  밀도평가 ' + r.밀도평가; }).join('\\n');
document.title='DONE::'+(errors.length?'SHADER_ERR':'OK')+'::'+gl.getError();
</script></body></html>`;

fs.mkdirSync(PREVIEW, { recursive: true });
fs.writeFileSync(path.join(PREVIEW, 'volume-cost.html'), html);
console.log('생성 완료: volume-cost.html');
