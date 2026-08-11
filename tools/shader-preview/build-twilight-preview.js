/**
 * 일몰 → 박명 시퀀스 미리보기.
 *
 * 태양 고도를 +2°에서 -12°까지 훑어 **해가 진 뒤 얼마나 빨리 어두워지는지**를
 * 눈으로 봅니다. 수치 검증만으로는 이 판단을 할 수 없습니다 —
 * 톤매핑과 눈 순응(ADAPT_*)이 표시 단계에서 밝기를 다시 주무르기 때문에,
 * 선형 복사휘도가 절반이 돼도 화면은 거의 안 바뀔 수 있고 그 반대도 됩니다.
 *
 * 동시에 **TS와 GLSL이 갈라지지 않았는지** 확인합니다. `earthShadowLit`은
 * 두 번 구현돼 있습니다(TS 하나, 셰이더 하나). 렌더된 픽셀을 TS 예측과
 * 비교하면 두 구현이 어긋난 순간 바로 드러납니다.
 *
 * 합격 기준(눈으로):
 *   - 0° → -2° 사이에 화면이 급격히 꺼지지 않을 것 (수정 전 증상)
 *   - -6°(시민박명)에서 서쪽 지평선에 아직 잔광이 남아 있을 것
 *   - -12° 즈음에는 밤으로 보일 것
 */
const fs = require('fs');
const path = require('path');
const SRC = '/home/user/solar-path';
const PREVIEW = '/tmp/claude-0/-home-user-solar-path/eaf4c0af-06ca-5c06-a0d7-588dbfb07373/scratchpad/preview';
global.__DEV__ = false;

const A = require('/tmp/atmbuild/atmosphere.js');

function tpl(file, name) {
  const src = fs.readFileSync(path.join(SRC, file), 'utf8');
  const marker = `const ${name} = \``;
  const start = src.indexOf(marker);
  if (start < 0) throw new Error(`${file}:${name} 없음`);
  const from = start + marker.length;
  return src.slice(from, src.indexOf('\n`;', from));
}
const subst = t => {
  const r = t.replace('${ATMOSPHERE_GLSL}', A.ATMOSPHERE_GLSL);
  if (r.includes('${')) throw new Error('미치환 보간: ' + r.match(/\$\{[^}]*\}/));
  return r;
};
const SKY_V = tpl('src/components/SkyScene3D/Skydome.ts', 'VERT');
const SKY_F = subst(tpl('src/components/SkyScene3D/Skydome.ts', 'FRAG'));
const SUN_V = tpl('src/components/SkyScene3D/SunMesh.ts', 'VERT');
const SUN_F = subst(tpl('src/components/SkyScene3D/SunMesh.ts', 'FRAG'));

const SUN_AZ = 270;
const ALTS = [2, 0, -1, -2, -4, -6, -8, -12];

// TS 쪽 예측을 함께 실어 보내 렌더 결과와 대조합니다.
const p = A.makeAtmosphereParams({
  visibilityM: 30000, humidityPct: 55, latitude: 37.5, dayOfYear: 214,
});
// A/B를 위해 **수정 전 atmosphere.ts로도 돌아가야 합니다.** 그 버전에는
// earthShadowLit이 없으므로, 없으면 0으로 두고 화면 밝기만 비교합니다.
const litOf = a => (typeof A.earthShadowLit === 'function' ? A.earthShadowLit(a) : 0);
const litMSOf = a => (typeof A.earthShadowLitMS === 'function' ? A.earthShadowLitMS(a) : 0);
const shadowOf = a =>
  a < 0 && typeof A.earthShadowHeightKm === 'function' ? A.earthShadowHeightKm(-a) : 0;

const SCENES = ALTS.map(sunAlt => ({
  sunAlt,
  label: `태양 ${sunAlt > 0 ? '+' : ''}${sunAlt}°`,
  lit: litOf(sunAlt),
  litMS: litMSOf(sunAlt),
  shadowKm: shadowOf(sunAlt),
  // TS가 예측한 선형 복사휘도 (셰이더와 비교할 기준값)
  horizonGlow: (c => [c.r, c.g, c.b])(A.skyRadiance(0.5, 5, sunAlt, p)),
  zenithSky: (c => [c.r, c.g, c.b])(A.skyRadiance(88, 90, sunAlt, p)),
}));

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
 body{margin:0;background:#111;font-family:sans-serif}
 #wrap{position:relative;width:1200px}
 .lbl{position:absolute;color:#fff;font-size:12px;font-weight:700;text-shadow:0 1px 3px #000}
</style></head><body>
<div id="wrap"><canvas id="c"></canvas><div id="labels"></div></div>
<script type="module">
globalThis.__DEV__ = false;
import * as THREE from './app/vendor/three.module.js';
import { makeAtmosphereParams } from './app/utils/atmosphere.js';

const SKY_V=${JSON.stringify(SKY_V)},SKY_F=${JSON.stringify(SKY_F)};
const TUNE_UNIFORMS=${JSON.stringify(A.makeTuningUniforms())};
const SUN_V=${JSON.stringify(SUN_V)},SUN_F=${JSON.stringify(SUN_F)};
const SCENES=${JSON.stringify(SCENES)}, SUN_AZ=${SUN_AZ};

const COLS=4,ROWS=2,TW=300,TH=300;
const canvas=document.getElementById('c');
canvas.width=COLS*TW;canvas.height=ROWS*TH;
const renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:false});
renderer.setPixelRatio(1);renderer.setSize(COLS*TW,ROWS*TH,false);
const errors=[];const oe=console.error;console.error=(...a)=>{errors.push(a.join(' '));oe(...a);};

const atmosphere = makeAtmosphereParams({
  visibilityM:30000, humidityPct:55, latitude:37.5, dayOfYear:214 });

const skyMat=new THREE.ShaderMaterial({uniforms:{...TUNE_UNIFORMS,
  uSunDir:{value:new THREE.Vector3()},uSunAltDeg:{value:0},uBeta:{value:atmosphere.betaMie},
  uAngstrom:{value:atmosphere.angstrom},uElevScale:{value:atmosphere.elevScale},
  uOzoneDU:{value:atmosphere.ozoneDU},uSaturation:{value:1},
  uCloudDiffuse:{value:1},uHaloStrength:{value:0}},
  vertexShader:SKY_V,fragmentShader:SKY_F,side:THREE.BackSide,depthWrite:false,depthTest:false});
const scene=new THREE.Scene();
scene.add(new THREE.Mesh(new THREE.SphereGeometry(500,64,32),skyMat));

const sunMat=new THREE.ShaderMaterial({uniforms:{...TUNE_UNIFORMS,
  uColor:{value:new THREE.Color(1,1,1)},uIntensity:{value:16},
  uSunAltDeg:{value:0},uSaturation:{value:1},uOcclusion:{value:1}},
  vertexShader:SUN_V,fragmentShader:SUN_F,transparent:true,depthWrite:false,depthTest:true,side:THREE.DoubleSide});
const sunR=450*Math.tan(1.08*Math.PI/180);
const sunMesh=new THREE.Mesh(new THREE.PlaneGeometry(sunR*2,sunR*2),sunMat);
sunMesh.frustumCulled=false; scene.add(sunMesh);

const cam=new THREE.PerspectiveCamera(70,TW/TH,0.1,1000); cam.position.set(0,0,0);
const labels=document.getElementById('labels');
const stats=[];
const lum=(r,g,b)=>0.2126*r+0.7152*g+0.0722*b;

SCENES.forEach((s,i)=>{
  const col=i%COLS,row=Math.floor(i/COLS),x=col*TW,y=(ROWS-1-row)*TH;
  const aR=s.sunAlt*Math.PI/180,zR=SUN_AZ*Math.PI/180;
  const sunDir=new THREE.Vector3(Math.cos(aR)*Math.sin(zR),Math.sin(aR),-Math.cos(aR)*Math.cos(zR));

  skyMat.uniforms.uSunDir.value.copy(sunDir);
  skyMat.uniforms.uSunAltDeg.value=s.sunAlt;
  sunMesh.position.copy(sunDir).multiplyScalar(450);
  sunMesh.lookAt(0,0,0);
  sunMat.uniforms.uSunAltDeg.value=s.sunAlt;
  sunMesh.visible = s.sunAlt > -0.9;

  // 카메라는 서쪽 지평선 — 잔광이 남는 곳을 봅니다.
  cam.lookAt(100*Math.sin(zR), 100*Math.sin(8*Math.PI/180), -100*Math.cos(zR));
  renderer.setViewport(x,y,TW,TH); renderer.setScissor(x,y,TW,TH); renderer.setScissorTest(true);
  renderer.render(scene,cam);

  // 렌더된 픽셀을 읽어 TS 예측과 대조합니다 (sRGB 화면값이므로 절대 비교는
  // 무의미하고, **컷 사이의 비율**이 TS 예측 비율과 맞는지를 봅니다).
  const buf=new Uint8Array(4*TW*TH);
  const gl=renderer.getContext();
  gl.readPixels(x,y,TW,TH,gl.RGBA,gl.UNSIGNED_BYTE,buf);
  // 지평선 띠(하단 1/3)와 상단 띠의 평균 화면 밝기
  let loSum=0,loN=0,hiSum=0,hiN=0;
  for(let py=0;py<TH;py+=3) for(let px=0;px<TW;px+=3){
    const o=4*(py*TW+px);
    const L=lum(buf[o],buf[o+1],buf[o+2]);
    if(py<TH*0.45){ loSum+=L; loN++; } else { hiSum+=L; hiN++; }
  }
  stats.push({label:s.label, sunAlt:s.sunAlt,
    lit:+s.lit.toFixed(4), litMS:+s.litMS.toFixed(4), shadowKm:+s.shadowKm.toFixed(1),
    tsHorizon:+lum(...s.horizonGlow).toFixed(4),
    tsZenith:+lum(...s.zenithSky).toFixed(4),
    screenLow:+(loSum/loN).toFixed(1), screenHigh:+(hiSum/hiN).toFixed(1)});

  const d=document.createElement('div'); d.className='lbl';
  d.style.left=(x+8)+'px'; d.style.top=(row*TH+8)+'px';
  d.textContent=s.label+'  (lit '+s.lit.toFixed(3)+')';
  labels.appendChild(d);
});
document.title='DONE::'+(errors.length?'SHADER_ERR':'OK')+'::'+renderer.getContext().getError();
window.__errors=errors;
window.__stats=stats;
</script></body></html>`;

fs.writeFileSync(path.join(PREVIEW, 'twilight.html'), html);
console.log('생성 완료: twilight.html');
