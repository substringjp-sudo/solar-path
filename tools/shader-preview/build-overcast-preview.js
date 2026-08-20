/**
 * 흐린 날 미리보기: 운량 × 태양고도 매트릭스.
 *
 * 밤하늘 미리보기와 같은 원칙 — cloudPlacement / cloudAtlas / CloudField 모듈을
 * 그대로 import해서 브라우저에서 돌립니다. 하늘 방향 리샘플링, 운형 판정,
 * 광학두께 계산이 전부 앱과 같은 코드입니다.
 *
 * 합격 기준(눈으로):
 *   - 8/8 · 태양 45°  → 평평한 회색, 태양 원반 소멸, 명암 대비 없음
 *   - 3/8 · 태양  5°  → 개별 적운에 노을이 드는 그림
 *   - 어느 경우에도 천정이 비지 않을 것
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
const SKY_V = tpl('src/components/SkyScene3D/Skydome.ts', 'VERT');
const SKY_F = (t => {
  const r = t.replace('${ATMOSPHERE_GLSL}', A.ATMOSPHERE_GLSL);
  if (r.includes('${')) throw new Error('미치환 보간: ' + r.match(/\$\{[^}]*\}/));
  return r;
})(tpl('src/components/SkyScene3D/Skydome.ts', 'FRAG'));
const SUN_V = tpl('src/components/SkyScene3D/SunMesh.ts', 'VERT');
const SUN_F = (t => {
  const r = t.replace('${ATMOSPHERE_GLSL}', A.ATMOSPHERE_GLSL);
  if (r.includes('${')) throw new Error('미치환 보간: ' + r.match(/\$\{[^}]*\}/));
  return r;
})(tpl('src/components/SkyScene3D/SunMesh.ts', 'FRAG'));

// 운량 × 태양고도 매트릭스. 운량은 저층 %.
const SCENES = [
  { label: '무리 · 권층운 45%',      low: 0,   mid: 0,  high: 45, sunAlt: 45, camElev: 30 },
  { label: '조각 3/8 · 태양 45°',    low: 38,  mid: 10, high: 15, sunAlt: 45, camElev: 30 },
  { label: '많음 6/8 · 태양 45°',    low: 75,  mid: 40, high: 30, sunAlt: 45, camElev: 30 },
  { label: '흐림 8/8 · 태양 45°',    low: 100, mid: 90, high: 70, sunAlt: 45, camElev: 30, precip: 1.2, dniFrac: 0.02 },
  { label: '맑음 0/8 · 태양 5°',     low: 0,   mid: 0,  high: 10, sunAlt: 5,  camElev: 14 },
  { label: '조각 3/8 · 태양 5°',     low: 38,  mid: 10, high: 20, sunAlt: 5,  camElev: 14 },
  { label: '많음 6/8 · 태양 5°',     low: 75,  mid: 40, high: 30, sunAlt: 5,  camElev: 14 },
  { label: '흐림 8/8 · 태양 5°',     low: 100, mid: 90, high: 70, sunAlt: 5,  camElev: 14, precip: 1.2 },
];

const SINGLE = process.argv.includes('--single');
const NODECK = process.argv.includes('--nodeck');
if (SINGLE) {
  SCENES.length = 0;
  SCENES.push({ label: '흐림 8/8 · 태양 45° (확대)', low: 100, mid: 90, high: 70, sunAlt: 45, camElev: 30, precip: 1.2, dniFrac: 0.02 });
}
const SUN_AZ = 270;
const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
 body{margin:0;background:#111;font-family:sans-serif}
 #wrap{position:relative;width:1200px}
 .lbl{position:absolute;color:#fff;font-size:13px;font-weight:700;text-shadow:0 1px 3px #000}
</style></head><body>
<div id="wrap"><canvas id="c"></canvas><div id="labels"></div></div>
<script type="module">
import * as THREE from './app/vendor/three.module.js';
import { bakeCloudAtlas } from './app/components/SkyScene3D/cloudAtlas.js';
import { createCloudField, updateCloudField } from './app/components/SkyScene3D/CloudField.js';
import { buildCloudInstances } from './app/components/SkyScene3D/cloudPlacement.js';
import { createCloudDeck, updateCloudDeck } from './app/components/SkyScene3D/CloudDeck.js';
import { PRESET_OPTICS } from './app/utils/cloudPresets.js';
import { makeAtmosphereParams, skyRadiance, sunDiskColor, clearSkyDNI, beamAtAltitude, applyCloudDimming }
  from './app/utils/atmosphere.js';

const SKY_V=${JSON.stringify(SKY_V)},SKY_F=${JSON.stringify(SKY_F)};
const TUNE_UNIFORMS=${JSON.stringify(A.makeTuningUniforms())};
const SUN_V=${JSON.stringify(SUN_V)},SUN_F=${JSON.stringify(SUN_F)};
const SCENES=${JSON.stringify(SCENES)}, SUN_AZ=${SUN_AZ}, NODECK=${NODECK};

const COLS=${SINGLE?1:4},ROWS=${SINGLE?1:2},TW=${SINGLE?1000:300},TH=${SINGLE?700:380};
const canvas=document.getElementById('c');
canvas.width=COLS*TW;canvas.height=ROWS*TH;
const renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:false});
renderer.setPixelRatio(1);renderer.setSize(COLS*TW,ROWS*TH,false);
const errors=[];const oe=console.error;console.error=(...a)=>{errors.push(a.join(' '));oe(...a);};

// 아틀라스는 실제 굽기 경로를 그대로 씁니다.
const atlas = bakeCloudAtlas(renderer);

const scene=new THREE.Scene();
const skyMat=new THREE.ShaderMaterial({uniforms:{...TUNE_UNIFORMS,
  uSunDir:{value:new THREE.Vector3()},uSunAltDeg:{value:0},uBeta:{value:0.08},
  uAngstrom:{value:1.3},uElevScale:{value:1},uOzoneDU:{value:330},uSaturation:{value:1},uCloudDiffuse:{value:1},uHaloStrength:{value:0}},
  vertexShader:SKY_V,fragmentShader:SKY_F,side:THREE.BackSide,depthWrite:false,depthTest:false});
const skyMesh=new THREE.Mesh(new THREE.SphereGeometry(500,32,16),skyMat);
skyMesh.renderOrder=-1; scene.add(skyMesh);

const sunMat=new THREE.ShaderMaterial({uniforms:{...TUNE_UNIFORMS,
  uColor:{value:new THREE.Color(1,1,1)},uIntensity:{value:16},
  uSunAltDeg:{value:30},uSaturation:{value:1},uOcclusion:{value:1}},
  vertexShader:SUN_V,fragmentShader:SUN_F,transparent:true,depthWrite:false,depthTest:true,side:THREE.DoubleSide});
const sunR=450*Math.tan(1.08*Math.PI/180);
const sunMesh=new THREE.Mesh(new THREE.PlaneGeometry(sunR*2,sunR*2),sunMat);
sunMesh.renderOrder=0.5; sunMesh.frustumCulled=false; scene.add(sunMesh);

const cloudField = createCloudField(atlas, 320);
scene.add(cloudField.mesh);
const cloudDeck = createCloudDeck({
  maxAnisotropy: renderer.capabilities.getMaxAnisotropy(),
});

// 덱의 조각 기하는 **그 층에서 실제로 뽑힌 운형**에서 가져옵니다.
// 광학두께(tauFor)와 같은 출처여야 모양과 광학이 갈라지지 않습니다.
function cellForLayer(instances, layer) {
  const names = instances.filter(c => c.layer === layer)
    .map(c => c.atlasKey.split('#')[0]);
  const count = {};
  for (const n of names) count[n] = (count[n] || 0) + 1;
  const top = Object.keys(count).sort((a, b) => count[b] - count[a])[0];
  const o = PRESET_OPTICS[top] || PRESET_OPTICS.Stratocumulus;
  return { cellSizeKm: o.cellSizeKm, cellStrength: o.cellStrength, cellVariant: o.cellVariant };
}
scene.add(cloudDeck.group);

const cam=new THREE.PerspectiveCamera(72,TW/TH,0.1,1000); cam.position.set(0,0,0);
const labels=document.getElementById('labels');
const stats=[];

// 실측 팬을 흉내낸 CloudData 배열 (앱이 받는 것과 같은 모양)
function makeFan(s){
  const dni = s.dniFrac != null ? clearSkyDNI(s.sunAlt)*s.dniFrac : undefined;
  const base = { low:s.low, mid:s.mid, high:s.high, humidity: s.precip?92:55,
                 visibility: s.precip?9000:32000, precipitation: s.precip??0,
                 directNormalIrradiance: dni };
  const out=[{distance:0,azimuthOffset:0,...base}];
  for(const off of [-20,-10,0,10,20]) for(const d of [10,30,70,130,200,280,380])
    out.push({distance:d,azimuthOffset:off,...base});
  return out;
}

const DATE = new Date(Date.UTC(2026,7,2,9,0));

SCENES.forEach((s,i)=>{
  const col=i%COLS,row=Math.floor(i/COLS),x=col*TW,y=(ROWS-1-row)*TH;
  const aR=s.sunAlt*Math.PI/180,zR=SUN_AZ*Math.PI/180;
  const sunDir=new THREE.Vector3(Math.cos(aR)*Math.sin(zR),Math.sin(aR),-Math.cos(aR)*Math.cos(zR));

  const atmosphere = makeAtmosphereParams({
    visibilityM: s.precip?9000:32000, humidityPct: s.precip?92:55,
    latitude:37.5, dayOfYear:214 });

  skyMat.uniforms.uSunDir.value.copy(sunDir);
  skyMat.uniforms.uSunAltDeg.value=s.sunAlt;
  skyMat.uniforms.uBeta.value=atmosphere.betaMie;
  skyMat.uniforms.uAngstrom.value=atmosphere.angstrom;
  skyMat.uniforms.uElevScale.value=atmosphere.elevScale;
  skyMat.uniforms.uOzoneDU.value=atmosphere.ozoneDU;

  sunMesh.position.set(450*Math.cos(aR)*Math.sin(zR),450*Math.sin(aR),-450*Math.cos(aR)*Math.cos(zR));
  sunMesh.lookAt(0,0,0);
  const sc=sunDiskColor(s.sunAlt,atmosphere);
  sunMat.uniforms.uColor.value.setRGB(sc.r,sc.g,sc.b);
  sunMat.uniforms.uSunAltDeg.value=s.sunAlt;
  sunMesh.visible = s.sunAlt > -0.9;

  const built = buildCloudInstances({
    atlas, currentTime: DATE, sunAltDeg: s.sunAlt, sunAzDeg: SUN_AZ,
    atmosphere, weather: makeFan(s), maxTotal: 320,
  });

  updateCloudField(cloudField, atlas, built.instances, SUN_AZ, s.sunAlt, {
    horizonGlow: skyRadiance(0.5,5,s.sunAlt,atmosphere),
    zenithSky:   skyRadiance(88,90,s.sunAlt,atmosphere),
    betaMie: atmosphere.betaMie, angstrom: atmosphere.angstrom, elevScale: atmosphere.elevScale,
    cloudDiffuse: built.optics.diffuseToGround,
  });

  const byLayer=L=>built.instances.filter(c=>c.layer===L);
  const med=(a,f)=>{ if(!a.length) return f; const q=[...a].sort((x,y)=>x-y); return q[Math.floor(q.length/2)]; };
  sunMat.uniforms.uOcclusion.value = built.optics.sunTransmittance;
  skyMat.uniforms.uCloudDiffuse.value = built.optics.diffuseToGround;
  skyMat.uniforms.uHaloStrength.value = built.halo;
  updateCloudDeck(cloudDeck, {
    samples: built.samples,
    beamFor: alt => {
      const L = alt > 7 ? 'high' : alt > 3 ? 'mid' : 'low';
      const f = built.optics.beamFactor[L];
      const b = beamAtAltitude(s.sunAlt, alt, atmosphere);
      return { r: b.r*f, g: b.g*f, b: b.b*f };
    },
    ambientFor: L => {
      const f = built.optics.diffuseFactor[L];
      return { up: applyCloudDimming(skyRadiance(88,90,s.sunAlt,atmosphere), f),
               down: applyCloudDimming(skyRadiance(20,70,s.sunAlt,atmosphere), f) };
    },
    sunDir, sunAltDeg: s.sunAlt,
    tauFor: L => med(byLayer(L).map(c=>c.tau), 25),
    shadowFor: L => med(byLayer(L).map(c=>c.shadowContrast), 0.5),
    cellFor: L => cellForLayer(built.instances, L),
    pixelAngleRad: (72 * Math.PI / 180) / TH,   // 카메라 화각 72°
    timeSeconds: 0, visible: !NODECK,
  });

  stats.push({label:s.label, n:built.instances.length, diffuseGround:+built.optics.diffuseToGround.toFixed(4), dniTau:built.dniTau, halo:built.halo,
              sunT:built.optics.sunTransmittance, beamLow:built.optics.beamFactor.low,
              decks:cloudDeck.layers.filter(l=>l.mesh.visible).map(l=>l.layer).join('+')||'-',
              types:[...new Set(built.instances.map(c=>c.atlasKey.split('#')[0]))].join(',')});

  const cA=SUN_AZ*Math.PI/180,cE=s.camElev*Math.PI/180;
  cam.lookAt(100*Math.cos(cE)*Math.sin(cA),100*Math.sin(cE),-100*Math.cos(cE)*Math.cos(cA));
  renderer.setViewport(x,y,TW,TH); renderer.setScissor(x,y,TW,TH); renderer.setScissorTest(true);
  renderer.render(scene,cam);

  // 화면에 실제로 나온 밝기 — "흐리게 느껴지는가"의 유일한 근거입니다.
  // **render 뒤에** 읽어야 합니다. 앞에서 읽으면 전부 0이 나옵니다.
  {
    const buf=new Uint8Array(4*TW*TH);
    const g2=renderer.getContext();
    g2.readPixels(x,y,TW,TH,g2.RGBA,g2.UNSIGNED_BYTE,buf);
    let sum=0,n2=0,mn=999,mx=0;
    for(let py=0;py<TH;py+=2) for(let px=0;px<TW;px+=2){
      const o=4*(py*TW+px);
      const L=0.2126*buf[o]+0.7152*buf[o+1]+0.0722*buf[o+2];
      sum+=L;n2++; if(L<mn)mn=L; if(L>mx)mx=L;
    }
    const st=stats[stats.length-1];
    st.screenLum=+(sum/n2).toFixed(1); st.screenMin=+mn.toFixed(0); st.screenMax=+mx.toFixed(0);
  }

  const d=document.createElement('div'); d.className='lbl';
  d.style.left=(x+8)+'px'; d.style.top=(row*TH+8)+'px'; d.textContent=s.label;
  labels.appendChild(d);
});
document.title='DONE::'+(errors.length?'SHADER_ERR':'OK')+'::'+renderer.getContext().getError();
window.__errors=errors;
window.__stats=stats;
</script></body></html>`;

const outName = (SINGLE ? 'overcast-single' : 'overcast') + (NODECK ? '-nodeck' : '') + '.html';
fs.writeFileSync(path.join(PREVIEW, outName), html);
console.log('생성 완료: ' + outName);
