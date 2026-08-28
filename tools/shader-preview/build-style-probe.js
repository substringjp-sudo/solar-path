/**
 * **스타일 probe** — 같은 하늘, 같은 물리, 표현만 다릅니다.
 *
 * `docs/SKY_REBUILD_PLAN.md` 7절: 인상주의·임파스토·오린 한지는 **이미지
 * 필터가 아닙니다.** 셋 다 렌더러가 버리는 정보를 요구합니다 (흐름장,
 * 두께, 층 분리). 그래서 후처리로 얹지 않고 **셰이더 안에서** 만듭니다 —
 * 그게 그 주장의 실물 증명이기도 합니다.
 *
 *  0 실사   — 기준. 지금 프로토타입 그대로.
 *  1 인상주의 — 붓 하나가 **장면을 한 번 표본하는 것**입니다. 붓 셀마다
 *              광선을 조금 틀어 다시 쏘고, 셀마다 따뜻/차가운 쪽으로
 *              색을 나눕니다. 이미지를 문지르는 것과 다릅니다.
 *  2 임파스토 — 두께를 **물감 높이**로 읽어 비스듬한 빛으로 음영을 냅니다.
 *              두께장이 이미 있으니 공짜로 나오는 표현입니다.
 *  3 오린 한지 — 층별 알파를 몇 단으로 끊어 **오린 종이**로 만들고 섬유
 *              결을 얹습니다. 층이 분리돼 있어야 가능합니다.
 *
 * 준비: node tools/shader-preview/stage-esm.js
 * 사용: node tools/shader-preview/build-style-probe.js
 */
const fs = require('fs');
const path = require('path');
const { PREVIEW } = require('./paths');

const TW = 460, TH = 460;
const FOV_DEG = 62;
const VIEW_AZ = 262, VIEW_ELEV = 14;
const SUN_AZ = 268, SUN_ALT = 0;
const STYLES = [['실사', 0], ['인상주의', 1], ['임파스토', 2], ['오린 한지', 3]];

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
<h3>스타일 probe — 같은 하늘·같은 물리, 표현만 다름 (태양 ${SUN_ALT}°)</h3>
<p class="sub">후처리 필터가 아니라 셰이더 안에서 만듭니다. 셋 다 렌더러의 두께·흐름·층 분리를 씁니다.</p>
<canvas id="c"></canvas><div id="labels"></div></div>
<script type="module">
import * as THREE from './app/vendor/three.module.js';
import { ATMOSPHERE_GLSL, makeTuningUniforms, makeAtmosphereParams,
         beamAtAltitude } from './app/utils/atmosphere.js';

const errors = [];
const oe = console.error;
console.error = (...a) => { errors.push(a.join(' ')); oe(...a); };

const TW=${TW}, TH=${TH}, FOV_DEG=${FOV_DEG};
const VIEW_AZ=${VIEW_AZ}, VIEW_ELEV=${VIEW_ELEV}, SUN_AZ=${SUN_AZ}, SUN_ALT=${SUN_ALT};
const STYLES=${JSON.stringify(STYLES)};

const canvas = document.getElementById('c');
canvas.width = TW*4; canvas.height = TH;
const ctx2d = canvas.getContext('2d');
const glCanvas = document.createElement('canvas');
glCanvas.width = TW; glCanvas.height = TH;
const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias:false, alpha:false });
renderer.setPixelRatio(1); renderer.setSize(TW, TH, false);

const atmosphere = makeAtmosphereParams({
  latitude: 37.5, observerElevM: 30, dayOfYear: 240,
  humidityPct: 62, visibilityM: 24000,
});

const FRAG = \`
precision highp float;
\${ATMOSPHERE_GLSL}
uniform vec2 uRes;
uniform vec3 uRight, uUp, uFwd;
uniform float uTanHalf;
uniform vec3 uSunDir;
uniform float uSunAltDeg, uSunAzDeg;
uniform vec3 uBeamLow, uBeamMid, uBeamHigh;
uniform float uCoverLow, uCoverMid, uCoverHigh;
uniform float uBeta, uAngstrom, uElevScale, uOzoneDU;
uniform int uStyle;
const float R_EARTH = 6371.0;

float hash21(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
float vnoise(vec2 p){
  vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(hash21(i),hash21(i+vec2(1,0)),f.x),
             mix(hash21(i+vec2(0,1)),hash21(i+vec2(1,1)),f.x), f.y);
}
float fbm(vec2 p, int oct){
  float s=0.0,a=0.5,n=0.0;
  for(int i=0;i<6;i++){ if(i>=oct) break; s+=a*vnoise(p); n+=a; p=p*2.03+7.1; a*=0.5; }
  return s/max(1e-5,n);
}
float groundDist(float sinE, float cosE, float h){
  float chord = 2.0*R_EARTH*h + h*h;
  float r = chord/(R_EARTH*sinE + sqrt(R_EARTH*R_EARTH*sinE*sinE + chord));
  return (R_EARTH+h)*asin(clamp(r*cosE/(R_EARTH+h),0.0,1.0));
}
float thicknessAt(vec2 km, float cover, float cellKm, float conf, float seed){
  vec2 p = km/cellKm + seed;
  float form = fbm(p*0.55, 4);
  float fine = fbm(p*1.60, 4);
  float m = cover*1.75*(0.50+0.50*form) + (fine-0.5)*0.34*conf;
  return max(0.0, m - 0.42);
}

/**
 * 하늘 한 점을 그립니다. 스타일이 **표본 위치를 바꿔야** 하므로
 * (인상주의의 붓 = 한 번의 표본) 방향을 인자로 받습니다.
 * outThick 으로 누적 두께를 돌려줍니다 — 임파스토의 물감 높이입니다.
 */
vec3 shadeSky(vec3 dir, out float outThick, out float outTopAlpha){
  outThick = 0.0; outTopAlpha = 0.0;
  float sinE = dir.y;
  float cosE = max(sqrt(max(0.0,1.0-sinE*sinE)),1e-4);
  float elevDeg = degrees(asin(clamp(sinE,-1.0,1.0)));
  float cosG = clamp(dot(dir,uSunDir),-1.0,1.0);
  vec3 col = atm_skyRadiance(elevDeg, cosG, uSunAltDeg, uBeta, uAngstrom, uElevScale, uOzoneDU);

  float azR = atan(dir.x, -dir.z);
  float ridge = (fbm(vec2(azR*2.7,4.0),3)-0.5)*2.2;
  if (elevDeg < ridge){
    float t = clamp((ridge-elevDeg)/10.0,0.0,1.0);
    return mix(col*0.34, vec3(0.0016,0.0018,0.0022), t*t);
  }
  if (sinE <= 0.004) return col;

  vec2 dirXZ = normalize(dir.xz + vec2(1e-6));
  vec2 sunXZ = normalize(uSunDir.xz + vec2(1e-6));
  float azHere = degrees(azR);
  float dAz = abs(mod(azHere - uSunAzDeg + 540.0, 360.0) - 180.0);
  float conf = 1.0 - 0.78*smoothstep(18.0, 130.0, dAz);

  for (int L=0; L<3; L++){
    float h      = L==0 ? 10.0 : (L==1 ? 4.5 : 1.5);
    float cover  = L==0 ? uCoverHigh : (L==1 ? uCoverMid : uCoverLow);
    vec3  beam   = L==0 ? uBeamHigh : (L==1 ? uBeamMid : uBeamLow);
    float cellKm = L==0 ? 9.0 : (L==1 ? 4.2 : 2.0);
    float tauK   = L==0 ? 3.2 : (L==1 ? 9.0 : 13.0);
    float seed   = float(L)*31.7;

    float d = groundDist(sinE, cosE, h);
    vec2 km = dirXZ*d;
    float thick = thicknessAt(km, cover, cellKm, conf, seed);
    if (thick <= 0.0) continue;

    float tau = thick*tauK;
    float T = exp(-tau);
    float alpha = 1.0 - T;

    // ── 오린 한지: 알파를 몇 단으로 끊습니다. 층이 분리돼 있어야 됩니다.
    if (uStyle == 3){
      float fiber = fbm(gl_FragCoord.xy*0.055 + float(L)*13.0, 3);
      alpha = clamp(alpha*1.15 + (fiber-0.5)*0.16, 0.0, 1.0);
      alpha = floor(alpha*4.0 + 0.5)/4.0;     // 4단 — 오려낸 가장자리
    }

    float thickSun = thicknessAt(km + sunXZ*(cellKm*0.55), cover, cellKm, conf, seed);
    float reach = exp(-thickSun*tauK*0.55);
    float ph = 0.45 + 0.55*pow(max(cosG,0.0),5.0);
    vec3 lit = beam*reach*ph*(0.20+1.15*T);
    vec3 ambUp   = atm_skyRadiance(72.0,cosG,uSunAltDeg,uBeta,uAngstrom,uElevScale,uOzoneDU);
    vec3 ambDown = atm_skyRadiance(12.0,cosG,uSunAltDeg,uBeta,uAngstrom,uElevScale,uOzoneDU);
    vec3 cc = lit + mix(ambDown,ambUp,0.35)*(0.26+0.30*T);

    // 한지: 종이마다 살짝 다른 색을 먹입니다 (닥종이 염색).
    if (uStyle == 3){
      vec3 tint = L==0 ? vec3(1.05,1.00,0.96) : (L==1 ? vec3(1.00,0.99,1.03) : vec3(0.98,1.00,1.04));
      cc *= tint;
    }

    col = mix(col, cc, alpha);
    outThick += thick*alpha;
    outTopAlpha = max(outTopAlpha, alpha);
  }
  return col;
}

void main(){
  vec2 ndc = (gl_FragCoord.xy/uRes)*2.0-1.0;
  ndc.x *= uRes.x/uRes.y;
  vec3 dir = normalize(uRight*(ndc.x*uTanHalf) + uUp*(ndc.y*uTanHalf) + uFwd);

  // ── 인상주의: 붓 하나 = 장면을 한 번 표본. 붓 셀마다 광선을 틀어 다시 쏩니다.
  vec2 strokeCell = vec2(0.0);
  if (uStyle == 1){
    // 흐름장 — 저주파 잡음의 기울기를 90° 돌려 유기적인 결을 만듭니다.
    vec2 q = gl_FragCoord.xy*0.006;
    float e = 1.0;
    float gx = fbm(q+vec2(e,0.0),3) - fbm(q-vec2(e,0.0),3);
    float gy = fbm(q+vec2(0.0,e),3) - fbm(q-vec2(0.0,e),3);
    vec2 flow = normalize(vec2(-gy, gx) + vec2(1e-5));
    // 붓 셀 — 흐름 방향으로 길게 늘어난 격자
    vec2 loc = vec2(dot(gl_FragCoord.xy, flow), dot(gl_FragCoord.xy, vec2(-flow.y, flow.x)));
    strokeCell = floor(loc / vec2(14.0, 5.0));
    float j1 = hash21(strokeCell) - 0.5;
    float j2 = hash21(strokeCell + 71.3) - 0.5;
    // 방향을 붓 하나만큼 틀어 다시 표본합니다 (문지르는 것이 아닙니다).
    dir = normalize(dir + (uRight*j1 + uUp*j2) * 0.020);
  }

  float thick, topA;
  vec3 col = shadeSky(dir, thick, topA);

  if (uStyle == 1){
    // 붓마다 따뜻/차가운 쪽으로 색을 나눕니다 — 분할묘법.
    float w = hash21(strokeCell + 19.7) - 0.5;
    col *= vec3(1.0 + w*0.20, 1.0 + w*0.03, 1.0 - w*0.20);
    // 붓 자국 안에서 밝기를 살짝 흔들어 물감이 얹힌 느낌을 남깁니다.
    col *= 1.0 + (hash21(strokeCell + 3.1) - 0.5) * 0.14;
  }

  if (uStyle == 2){
    // ── 임파스토: 두께가 곧 물감 높이. 비스듬한 빛으로 음영을 냅니다.
    // 이웃 화소의 두께를 실제로 다시 계산합니다 (화면 필터가 아닙니다).
    float t1, t2, a0;
    vec2 px = vec2(1.6, 0.0), py = vec2(0.0, 1.6);
    vec3 dx = normalize(dir + uRight*0.0022);
    vec3 dy = normalize(dir + uUp*0.0022);
    shadeSky(dx, t1, a0);
    shadeSky(dy, t2, a0);
    float dhdx = (t1 - thick) * 26.0;
    float dhdy = (t2 - thick) * 26.0;
    vec3 n = normalize(vec3(-dhdx, -dhdy, 1.0));
    // 왼쪽 위에서 비스듬히 드는 화실 조명
    vec3 rake = normalize(vec3(-0.55, 0.62, 0.56));
    float relief = dot(n, rake);
    col *= 0.80 + 0.55 * clamp(relief, -1.0, 1.0);
    // 물감이 두꺼운 곳은 채도가 올라갑니다 (안료가 쌓임)
    float l = dot(col, vec3(0.2126,0.7152,0.0722));
    col = mix(vec3(l), col, 1.0 + clamp(thick,0.0,1.0)*0.35);
  }

  gl_FragColor = vec4(atm_display(col, 1.0, uSunAltDeg), 1.0);
}
\`;

const uniforms = {
  ...makeTuningUniforms(),
  uRes:{value:new THREE.Vector2(TW,TH)},
  uRight:{value:new THREE.Vector3()}, uUp:{value:new THREE.Vector3()}, uFwd:{value:new THREE.Vector3()},
  uTanHalf:{value:Math.tan(FOV_DEG*Math.PI/360)},
  uSunDir:{value:new THREE.Vector3()}, uSunAltDeg:{value:SUN_ALT}, uSunAzDeg:{value:SUN_AZ},
  uBeamLow:{value:new THREE.Vector3()}, uBeamMid:{value:new THREE.Vector3()}, uBeamHigh:{value:new THREE.Vector3()},
  uCoverLow:{value:0.24}, uCoverMid:{value:0.38}, uCoverHigh:{value:0.30},
  uBeta:{value:atmosphere.betaMie}, uAngstrom:{value:atmosphere.angstrom},
  uElevScale:{value:atmosphere.elevScale}, uOzoneDU:{value:atmosphere.ozoneDU},
  uStyle:{value:0},
};
const mat = new THREE.ShaderMaterial({ uniforms,
  vertexShader:'void main(){ gl_Position = vec4(position.xy,0.0,1.0); }',
  fragmentShader:FRAG, depthTest:false, depthWrite:false });
const quad = new THREE.Mesh(new THREE.PlaneGeometry(2,2), mat);
quad.frustumCulled=false;
const scene=new THREE.Scene(); scene.add(quad);
const cam=new THREE.Camera();
{
  const ar=VIEW_AZ*Math.PI/180, er=VIEW_ELEV*Math.PI/180;
  const f=new THREE.Vector3(Math.cos(er)*Math.sin(ar),Math.sin(er),-Math.cos(er)*Math.cos(ar));
  const r=new THREE.Vector3().crossVectors(f,new THREE.Vector3(0,1,0)).normalize();
  const u=new THREE.Vector3().crossVectors(r,f).normalize();
  uniforms.uFwd.value.copy(f); uniforms.uRight.value.copy(r); uniforms.uUp.value.copy(u);
}
{
  const a=SUN_ALT*Math.PI/180, z=SUN_AZ*Math.PI/180;
  uniforms.uSunDir.value.set(Math.cos(a)*Math.sin(z),Math.sin(a),-Math.cos(a)*Math.cos(z)).normalize();
  const bl=beamAtAltitude(SUN_ALT,1.5,atmosphere), bm=beamAtAltitude(SUN_ALT,4.5,atmosphere),
        bh=beamAtAltitude(SUN_ALT,10,atmosphere);
  uniforms.uBeamLow.value.set(bl.r,bl.g,bl.b);
  uniforms.uBeamMid.value.set(bm.r,bm.g,bm.b);
  uniforms.uBeamHigh.value.set(bh.r,bh.g,bh.b);
}

const gl = renderer.getContext();
const labels = document.getElementById('labels');
function shoot(style){
  uniforms.uStyle.value = style;
  renderer.setRenderTarget(null);
  renderer.render(scene, cam);
  const buf = new Uint8Array(4*TW*TH);
  gl.readPixels(0,0,TW,TH,gl.RGBA,gl.UNSIGNED_BYTE,buf);
  return buf;
}
function paint(buf,x){
  const img=ctx2d.createImageData(TW,TH);
  for(let y=0;y<TH;y++){ const s=(TH-1-y)*TW*4, d=y*TW*4;
    for(let i=0;i<TW*4;i++) img.data[d+i]=buf[s+i]; }
  ctx2d.putImageData(img,x,0);
}
const lum=(b,p)=>0.2126*b[p*4]+0.7152*b[p*4+1]+0.0722*b[p*4+2];

/**
 * ⚠ 스타일이 **흐린눈 테스트를 통과하는지** 함께 봅니다. 표현이 저주파
 * 구조를 바꿔 버리면 예보로서의 값이 사라집니다. 48×48로 줄여 실사와
 * 비교한 평균 밝기차가 그 값입니다 — 작아야 좋습니다.
 */
const SQ=48;
function squint(buf){
  const out=new Float32Array(SQ*SQ); const bw=TW/SQ, bh=TH/SQ;
  for(let j=0;j<SQ;j++) for(let i=0;i<SQ;i++){
    let s=0,n=0;
    for(let y=Math.floor(j*bh);y<Math.floor((j+1)*bh);y++)
      for(let x=Math.floor(i*bw);x<Math.floor((i+1)*bw);x++){ s+=lum(buf,y*TW+x); n++; }
    out[j*SQ+i]=s/n;
  }
  return out;
}
function squintErr(a,b){ let s=0; for(let p=0;p<SQ*SQ;p++) s+=Math.abs(a[p]-b[p]); return +(s/(SQ*SQ)).toFixed(2); }
/** 국소 대비 — 붓자국·결·오림이 얼마나 강한가 (표현의 세기). */
function localVar(buf){
  let s=0,n=0;
  for(let y=1;y<TH-1;y++) for(let x=1;x<TW-1;x++){
    const i=y*TW+x, L=lum(buf,i);
    s+=Math.abs(L-lum(buf,i+1))+Math.abs(L-lum(buf,i+TW)); n+=2;
  }
  return +(s/n).toFixed(2);
}

const bufs = STYLES.map(([,v])=>shoot(v));
bufs.forEach((b,i)=>paint(b,i*TW));
const sq = bufs.map(squint);
const 결과 = STYLES.map(([name],i)=>{
  const err = i===0 ? 0 : squintErr(sq[0], sq[i]);
  const lv = localVar(bufs[i]);
  const d=document.createElement('div');
  d.className='lbl'; d.style.left=(i*TW+20)+'px'; d.style.top='58px';
  d.innerHTML = name + (i===0 ? '<br>(기준)' : '<br>흐린눈 이탈 '+err) + '<br>국소대비 '+lv;
  labels.appendChild(d);
  return { 이름:name, 흐린눈이탈:err, 국소대비:lv };
});

window.__stats = { glError: gl.getError(), 결과 };
window.__errors = errors;
document.title = 'DONE::' + (errors.length ? 'SHADER_ERR' : 'OK') + '::' + gl.getError();
</script></body></html>`;

fs.mkdirSync(PREVIEW, { recursive: true });
fs.writeFileSync(path.join(PREVIEW, 'style-probe.html'), html);
console.log('생성 완료: style-probe.html');
