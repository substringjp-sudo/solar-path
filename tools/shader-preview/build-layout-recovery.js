/**
 * **배치를 얼마나 되찾을 수 있는가** — 1·2단계를 한 번에 잽니다.
 *
 * `build-look-sample.js` 는 합성 운량장으로 그린 것이라 "예뻐 보이는가"
 * 까지만 답했습니다. 신뢰도를 결정하는 것은 **배치**입니다 — 비었는데
 * 찼다고 하면 그 앱은 못 믿습니다.
 *
 * 그래서 순서를 뒤집어 봅니다.
 *
 *   1. **진짜 하늘**을 하나 정합니다 (알려진 운량장).
 *   2. 그것을 **예보 팬 기하로 표본**합니다 — 현재 기하와 제안 기하 각각.
 *   3. 그 표본만으로 하늘을 **재구성**해 그립니다.
 *   4. 진짜와 얼마나 닮았는지 **흐린눈으로** 잽니다 (48×48로 줄여서).
 *
 * 이러면 사진 없이도 "그 기하로 무엇을 되찾을 수 있는가"의 상한이
 * 나옵니다. 사진이 오면 같은 지표를 실제 하늘에 그대로 씁니다.
 *
 * ⚠ 이것은 렌더러 비교가 아닙니다. 세 칸 모두 **같은 셰이더**로 그립니다.
 * 다른 것은 운량장을 어떻게 표본했는가 하나뿐입니다.
 *
 * 준비: node tools/shader-preview/stage-esm.js
 * 사용: node tools/shader-preview/build-layout-recovery.js
 */
const fs = require('fs');
const path = require('path');
const { PREVIEW } = require('./paths');

const TW = 460, TH = 460;
const FOV_DEG = 78;
const VIEW_AZ = 268, VIEW_ELEV = 14;
const SUN_AZ = 268;
const SUN_ALT = 0;
const RANGE_KM = 140;   // 운량장 텍스처가 덮는 반경
const TEX = 256;

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
 body{margin:0;background:#0b0f15;font-family:sans-serif;color:#dde}
 #wrap{position:relative;width:${TW * 3 + 24}px;padding:12px}
 .lbl{position:absolute;color:#fff;font-size:12px;font-family:monospace;
   pointer-events:none;line-height:1.45;background:rgba(6,10,16,.72);
   padding:5px 8px;border-radius:5px}
 h3{font-size:13px;margin:6px 0}
 .sub{font-size:11px;color:#8aa;margin:0 0 8px}
</style></head><body>
<div id="wrap">
<h3>같은 하늘, 같은 셰이더 — 예보 팬 기하만 다릅니다 (태양 ${SUN_ALT}°)</h3>
<p class="sub">FOV 78° — 가운데 절반만 현재 팬(태양±20°)이 덮고 좌우는 추정입니다. 1칸이 정답. 2·3칸은 그 하늘을 각 기하로 표본해 재구성한 것. 흐린눈 오차 = 48×48로 줄여 정답과 비교한 평균 밝기차(/255).</p>
<canvas id="c"></canvas><div id="labels"></div></div>
<script type="module">
import * as THREE from './app/vendor/three.module.js';
import { ATMOSPHERE_GLSL, makeTuningUniforms, makeAtmosphereParams,
         beamAtAltitude } from './app/utils/atmosphere.js';
import { WeatherFan } from './app/utils/skyColumn.js';

const errors = [];
const oe = console.error;
console.error = (...a) => { errors.push(a.join(' ')); oe(...a); };

const TW=${TW}, TH=${TH}, FOV_DEG=${FOV_DEG};
const VIEW_AZ=${VIEW_AZ}, VIEW_ELEV=${VIEW_ELEV}, SUN_AZ=${SUN_AZ}, SUN_ALT=${SUN_ALT};
const RANGE_KM=${RANGE_KM}, TEX=${TEX};

// ── 진짜 하늘 ───────────────────────────────────────────────────────────
// 예보가 원리적으로 담을 수 있는 규모(수십 km)로 만듭니다. 그보다 잔
// 구조를 넣으면 "못 맞춘다"가 당연해져서 실험이 의미를 잃습니다.
function h21(x,y){ let s=Math.sin(x*127.1+y*311.7)*43758.5453; return s-Math.floor(s); }
function vn(x,y){
  const ix=Math.floor(x), iy=Math.floor(y);
  let fx=x-ix, fy=y-iy; fx=fx*fx*(3-2*fx); fy=fy*fy*(3-2*fy);
  const a=h21(ix,iy), b=h21(ix+1,iy), c=h21(ix,iy+1), d=h21(ix+1,iy+1);
  return (a+(b-a)*fx) + ((c+(d-c)*fx)-(a+(b-a)*fx))*fy;
}
function fbmJS(x,y,oct){
  let s=0,a=0.5,n=0;
  for(let i=0;i<oct;i++){ s+=a*vn(x,y); n+=a; x=x*2.03+7.1; y=y*2.03+3.7; a*=0.5; }
  return s/n;
}
const TRUTH_KM = { low: 26, mid: 42, high: 72 };
const TRUTH_MEAN = { low: 0.30, mid: 0.44, high: 0.32 };
const TRUTH_OFF = { low: 0, mid: 51.3, high: 97.7 };
function truthCover(layer, xKm, zKm){
  const s = TRUTH_KM[layer], o = TRUTH_OFF[layer];
  const n = fbmJS(xKm/s + o, zKm/s + o, 4);
  // 평균을 예보값에 맞추고 U자로 살짝 밀어 맑은 구멍과 덩어리를 만듭니다.
  const v = TRUTH_MEAN[layer] + (n - 0.5) * 2.6;
  return Math.max(0, Math.min(1, v));
}

// ── 두 팬 기하 ──────────────────────────────────────────────────────────
const GEOM = {
  현재: { offsets: [-20,-10,0,10,20],
          dists: [10,30,70,130,200,280,380] },
  제안: { offsets: [-180,-150,-120,-90,-60,-30,0,30,60,90,120,150,180],
          dists: [2,4,8,16,32,64,128] },
};

function buildFan(g){
  const out = [{ distance:0, azimuthOffset:0,
                 low: truthCover('low',0,0)*100, mid: truthCover('mid',0,0)*100,
                 high: truthCover('high',0,0)*100, humidity:62, precipitation:0,
                 visibility:24000 }];
  for (const off of g.offsets){
    for (const d of g.dists){
      const azR = (SUN_AZ + off) * Math.PI/180;
      const x = d*Math.sin(azR), z = -d*Math.cos(azR);
      out.push({ distance:d, azimuthOffset:off,
        low: truthCover('low',x,z)*100, mid: truthCover('mid',x,z)*100,
        high: truthCover('high',x,z)*100, humidity:62, precipitation:0 });
    }
  }
  return new WeatherFan(out, SUN_AZ);
}

/** 운량장을 **지상 2D 텍스처**로 굽습니다 (계획 5절). RGB=저중상, A=확신도. */
function bakeCover(sampler){
  const data = new Uint8Array(TEX*TEX*4);
  for (let j=0;j<TEX;j++){
    for (let i=0;i<TEX;i++){
      const x = ((i+0.5)/TEX*2-1)*RANGE_KM;
      const z = ((j+0.5)/TEX*2-1)*RANGE_KM;
      const c = sampler(x,z);
      const k=(j*TEX+i)*4;
      data[k]=c.low*255; data[k+1]=c.mid*255; data[k+2]=c.high*255; data[k+3]=c.conf*255;
    }
  }
  const t = new THREE.DataTexture(data, TEX, TEX, THREE.RGBAFormat);
  t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.needsUpdate = true;
  return t;
}

const truthTex = bakeCover((x,z)=>({
  low: truthCover('low',x,z), mid: truthCover('mid',x,z),
  high: truthCover('high',x,z), conf: 1 }));

function fanSampler(fan){
  return (x,z)=>{
    const d = Math.hypot(x,z);
    const az = (Math.atan2(x,-z)*180/Math.PI + 360) % 360;
    const { data, confidence } = fan.sample(az, d);
    if (!data) return { low:0, mid:0, high:0, conf:0 };
    return { low:data.low/100, mid:data.mid/100, high:data.high/100,
             conf: Math.max(0, Math.min(1, confidence)) };
  };
}

const texes = {
  '정답 (진짜 하늘)': truthTex,
  '현재 기하 (태양±20°, 10~380km)': bakeCover(fanSampler(buildFan(GEOM.현재))),
  '제안 기하 (360°, 2~128km)': bakeCover(fanSampler(buildFan(GEOM.제안))),
};

// ── 렌더 ────────────────────────────────────────────────────────────────
const canvas = document.getElementById('c');
canvas.width = TW*3; canvas.height = TH;
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
uniform float uBeta, uAngstrom, uElevScale, uOzoneDU;
uniform sampler2D uCoverTex;
uniform float uRangeKm;
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
vec4 coverAt(vec2 km){ return texture2D(uCoverTex, km/(2.0*uRangeKm)+0.5); }

/** 문턱 없음 — 운량이 두께를 정하고 가장자리는 저절로 얇아집니다. */
float thicknessAt(vec2 km, float cover, float cellKm, float conf, float seed){
  vec2 p = km/cellKm + seed;
  float form = fbm(p*0.55, 4);           // 예보가 못 담는 잔여 형태
  float fine = fbm(p*1.60, 4);
  float m = cover*1.75*(0.62+0.38*form) + (fine-0.5)*0.34*conf;
  return max(0.0, m - 0.42);
}

void main(){
  vec2 ndc = (gl_FragCoord.xy/uRes)*2.0-1.0;
  ndc.x *= uRes.x/uRes.y;
  vec3 dir = normalize(uRight*(ndc.x*uTanHalf) + uUp*(ndc.y*uTanHalf) + uFwd);
  float sinE = dir.y;
  float cosE = max(sqrt(max(0.0,1.0-sinE*sinE)),1e-4);
  float elevDeg = degrees(asin(clamp(sinE,-1.0,1.0)));
  float cosG = clamp(dot(dir,uSunDir),-1.0,1.0);

  vec3 col = atm_skyRadiance(elevDeg, cosG, uSunAltDeg, uBeta, uAngstrom, uElevScale, uOzoneDU);

  float azR = atan(dir.x, -dir.z);
  float ridge = (fbm(vec2(azR*2.7,4.0),3)-0.5)*2.2;
  if (elevDeg < ridge){
    float t = clamp((ridge-elevDeg)/10.0,0.0,1.0);
    col = mix(col*0.34, vec3(0.0016,0.0018,0.0022), t*t);
    gl_FragColor = vec4(atm_display(col,1.0,uSunAltDeg),1.0);
    return;
  }

  if (sinE > 0.004){
    vec2 dirXZ = normalize(dir.xz + vec2(1e-6));
    vec2 sunXZ = normalize(uSunDir.xz + vec2(1e-6));
    for (int L=0; L<3; L++){
      float h      = L==0 ? 10.0 : (L==1 ? 4.5 : 1.5);
      vec3  beam   = L==0 ? uBeamHigh : (L==1 ? uBeamMid : uBeamLow);
      float cellKm = L==0 ? 9.0 : (L==1 ? 4.2 : 2.0);
      float tauK   = L==0 ? 3.2 : (L==1 ? 9.0 : 13.0);
      float seed   = float(L)*31.7;

      float d = groundDist(sinE, cosE, h);
      vec2 km = dirXZ*d;
      vec4 cv = coverAt(km);
      float cover = L==0 ? cv.b : (L==1 ? cv.g : cv.r);
      float conf  = cv.a;

      float thick = thicknessAt(km, cover, cellKm, conf, seed);
      if (thick <= 0.0) continue;

      float tau = thick*tauK;
      float T = exp(-tau);
      float alpha = 1.0 - T;
      float thickSun = thicknessAt(km + sunXZ*(cellKm*0.55), cover, cellKm, conf, seed);
      float reach = exp(-thickSun*tauK*0.55);
      float ph = 0.45 + 0.55*pow(max(cosG,0.0),5.0);
      vec3 lit = beam*reach*ph*(0.20+1.15*T);
      vec3 ambUp   = atm_skyRadiance(72.0,cosG,uSunAltDeg,uBeta,uAngstrom,uElevScale,uOzoneDU);
      vec3 ambDown = atm_skyRadiance(12.0,cosG,uSunAltDeg,uBeta,uAngstrom,uElevScale,uOzoneDU);
      vec3 amb = mix(ambDown,ambUp,0.35)*(0.26+0.30*T);
      col = mix(col, lit+amb, alpha);
    }
  }
  gl_FragColor = vec4(atm_display(col,1.0,uSunAltDeg),1.0);
}
\`;

const uniforms = {
  ...makeTuningUniforms(),
  uRes:{value:new THREE.Vector2(TW,TH)},
  uRight:{value:new THREE.Vector3()}, uUp:{value:new THREE.Vector3()}, uFwd:{value:new THREE.Vector3()},
  uTanHalf:{value:Math.tan(FOV_DEG*Math.PI/360)},
  uSunDir:{value:new THREE.Vector3()}, uSunAltDeg:{value:SUN_ALT}, uSunAzDeg:{value:SUN_AZ},
  uBeamLow:{value:new THREE.Vector3()}, uBeamMid:{value:new THREE.Vector3()}, uBeamHigh:{value:new THREE.Vector3()},
  uBeta:{value:atmosphere.betaMie}, uAngstrom:{value:atmosphere.angstrom},
  uElevScale:{value:atmosphere.elevScale}, uOzoneDU:{value:atmosphere.ozoneDU},
  uCoverTex:{value:null}, uRangeKm:{value:RANGE_KM},
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

function shoot(tex){
  uniforms.uCoverTex.value = tex;
  mat.needsUpdate = true;
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

/**
 * **흐린눈** — 48×48로 줄이는 것이 곧 안경을 벗는 것입니다.
 * 계획 1단계의 지표이고, 사진이 오면 여기 정답 자리에 사진이 들어갑니다.
 */
const SQ = 48;
function squint(buf){
  const out = new Float32Array(SQ*SQ*3);
  const bw = TW/SQ, bh = TH/SQ;
  for(let j=0;j<SQ;j++) for(let i=0;i<SQ;i++){
    let r=0,g=0,b=0,n=0;
    for(let y=Math.floor(j*bh); y<Math.floor((j+1)*bh); y++)
      for(let x=Math.floor(i*bw); x<Math.floor((i+1)*bw); x++){
        const p=(y*TW+x)*4; r+=buf[p]; g+=buf[p+1]; b+=buf[p+2]; n++;
      }
    const k=(j*SQ+i)*3; out[k]=r/n; out[k+1]=g/n; out[k+2]=b/n;
  }
  return out;
}
const LW=[0.2126,0.7152,0.0722];
function squintErr(a,b){
  let s=0;
  for(let p=0;p<SQ*SQ;p++){
    const la=LW[0]*a[p*3]+LW[1]*a[p*3+1]+LW[2]*a[p*3+2];
    const lb=LW[0]*b[p*3]+LW[1]*b[p*3+1]+LW[2]*b[p*3+2];
    s+=Math.abs(la-lb);
  }
  return +(s/(SQ*SQ)).toFixed(2);
}
/** 황금비 3구역(왼/가운데/오른쪽)으로 나눠서도 봅니다 — 구도 단위의 오차. */
function regionErr(a,b){
  const cuts=[0, Math.round(SQ*0.382), Math.round(SQ*0.618), SQ];
  const out=[];
  for(let r=0;r<3;r++){
    let s=0,n=0;
    for(let j=0;j<SQ;j++) for(let i=cuts[r];i<cuts[r+1];i++){
      const p=j*SQ+i;
      const la=LW[0]*a[p*3]+LW[1]*a[p*3+1]+LW[2]*a[p*3+2];
      const lb=LW[0]*b[p*3]+LW[1]*b[p*3+1]+LW[2]*b[p*3+2];
      s+=Math.abs(la-lb); n++;
    }
    out.push(+(s/n).toFixed(1));
  }
  return out;
}

const names = Object.keys(texes);
const bufs = names.map(n => shoot(texes[n]));
bufs.forEach((b,i)=>paint(b,i*TW));
const sq = bufs.map(squint);

const 결과 = names.map((n,i)=>{
  const err = i===0 ? 0 : squintErr(sq[0], sq[i]);
  const reg = i===0 ? [0,0,0] : regionErr(sq[0], sq[i]);
  const d=document.createElement('div');
  d.className='lbl'; d.style.left=(i*TW+20)+'px'; d.style.top='58px';
  d.innerHTML = n + (i===0 ? '' :
    '<br>흐린눈 오차 ' + err + '/255' +
    '<br>구역별 ' + reg.join(' / '));
  labels.appendChild(d);
  return { 이름:n, 흐린눈오차:err, 구역별:reg };
});

window.__stats = { glError: gl.getError(), 결과 };
window.__errors = errors;
document.title = 'DONE::' + (errors.length ? 'SHADER_ERR' : 'OK') + '::' + gl.getError();
</script></body></html>`;

fs.mkdirSync(PREVIEW, { recursive: true });
fs.writeFileSync(path.join(PREVIEW, 'layout-recovery.html'), html);
console.log('생성 완료: layout-recovery.html');
