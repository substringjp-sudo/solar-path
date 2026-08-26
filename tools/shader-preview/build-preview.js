/**
 * 전체 씬 미리보기: 하늘 + 태양 + 구름.
 * 세 셰이더 모두 소스에서 그대로 추출해 렌더하므로 앱과 동일합니다.
 * 구름 배치는 별도 검증되어 있으므로, 여기서는 대표 구름 몇 개를 직접 배치해
 * 셰이더의 겉모습만 판단합니다.
 */
const fs = require('fs');
const path = require('path');
const SRC = '/home/user/solar-path';
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
const sub = t => {
  const r = t.replace('${ATMOSPHERE_GLSL}', A.ATMOSPHERE_GLSL);
  if (r.includes('${')) throw new Error('미치환 보간: ' + r.match(/\$\{[^}]*\}/));
  return r;
};

const SKY_V = tpl('src/components/SkyScene3D/Skydome.ts', 'VERT');
const SKY_F = sub(tpl('src/components/SkyScene3D/Skydome.ts', 'FRAG'));
const SUN_V = tpl('src/components/SkyScene3D/SunMesh.ts', 'VERT');
const SUN_F = sub(tpl('src/components/SkyScene3D/SunMesh.ts', 'FRAG'));
const CLD_V = sub(tpl('src/components/SkyScene3D/CloudField.ts', 'VERT'));
const CLD_F = sub(tpl('src/components/SkyScene3D/CloudField.ts', 'FRAG'));

// 구름 도감 값
const DB = {
  Cirrus:        { scattering: 0.95, shadow: 0.05, rim: 0.15, alt: 11.0, opacity: 0.15 },
  Altocumulus:   { scattering: 0.70, shadow: 0.40, rim: 0.60, alt: 4.5,  opacity: 0.45 },
  Cumulus:       { scattering: 0.45, shadow: 0.72, rim: 0.82, alt: 1.5,  opacity: 0.65 },
  Cumulonimbus:  { scattering: 0.20, shadow: 0.98, rim: 0.90, alt: 3.0,  opacity: 0.92 },
  Stratocumulus: { scattering: 0.40, shadow: 0.82, rim: 0.75, alt: 1.8,  opacity: 0.75 },
};

const SCENES = [
  { label: '정오 60°',  sunAlt: 60,  sunAz: 180, camAz: 180, cond: 'clean' },
  { label: '저녁 6°',   sunAlt: 6,   sunAz: 262, camAz: 262, cond: 'clean' },
  { label: '일몰 1°',   sunAlt: 1,   sunAz: 268, camAz: 268, cond: 'clean' },
  { label: '직후 -3°',  sunAlt: -3,  sunAz: 273, camAz: 273, cond: 'clean' },
];
const CONDITIONS = {
  clean: A.makeAtmosphereParams({ visibilityM: 45000, humidityPct: 40 }),
};

// 각 씬마다 구름 인스턴스를 물리 모델로 계산 (cloudPlacement와 같은 방식)
function buildClouds(sunAlt, sunAz, p) {
  const list = [];
  const layout = [
    ['Cirrus',        11.0, 150, [-55, -20, 15, 50]],
    ['Altocumulus',    4.5,  80, [-40,  -5, 30]],
    ['Cumulus',        1.5,  30, [-30,   0, 25]],
    ['Stratocumulus',  1.8,  60, [-15,  20]],
    ['Cumulonimbus',   3.0, 110, [ 40]],
  ];
  for (const [name, altKm, distKm, offsets] of layout) {
    const d = DB[name];
    for (const off of offsets) {
      const az = (sunAz + off + 360) % 360;
      const elev = Math.atan2(altKm, distKm) * 180 / Math.PI;
      const beam = A.beamAtAltitude(sunAlt, altKm, p);
      const azDiff = ((sunAz - az + 540) % 360) - 180;
      const cg = Math.sin(elev*Math.PI/180)*Math.sin(sunAlt*Math.PI/180)
               + Math.cos(elev*Math.PI/180)*Math.cos(sunAlt*Math.PI/180)*Math.cos(azDiff*Math.PI/180);
      const gamma = Math.acos(Math.max(-1, Math.min(1, cg))) * 180/Math.PI;
      const ambient = A.skyRadiance(elev, gamma, sunAlt, p);
      const tau = A.cloudOpticalDepthFromDb(d.scattering, 0.85);
      const sx = Math.sin(azDiff*Math.PI/180);
      const sy = Math.sin((sunAlt - elev)*Math.PI/180);
      const len = Math.hypot(sx, sy) || 1;
      const angular = (name === 'Cirrus' ? 26 : name === 'Altocumulus' ? 20 : 15);
      const sizeY = 430 * Math.tan(angular*Math.PI/360) * 2;
      list.push({
        az, elev, distKm, altKm, tau,
        beam: [beam.r, beam.g, beam.b],
        ambient: [ambient.r, ambient.g, ambient.b],
        sizeY, aspect: 3.2,
        opacity: Math.min(1, d.opacity + 0.35),
        shadowContrast: d.shadow, rimSharpness: d.rim,
        sunDir: [sx/len, sy/len],
      });
    }
  }
  return list.sort((a, b) => b.distKm - a.distKm);
}

const SCENE_DATA = SCENES.map(s => {
  const p = CONDITIONS[s.cond];
  return {
    ...s, params: p,
    clouds: buildClouds(s.sunAlt, s.sunAz, p),
    sunColor: (c => [c.r, c.g, c.b])(A.sunDiskColor(s.sunAlt, p)),
    horizonGlow: (c => [c.r, c.g, c.b])(A.skyRadiance(0.5, 5, s.sunAlt, p)),
    zenithSky: (c => [c.r, c.g, c.b])(A.skyRadiance(88, 90, s.sunAlt, p)),
  };
});

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
 body{margin:0;background:#111;font-family:sans-serif}
 #wrap{position:relative;width:1200px}
 .lbl{position:absolute;color:#fff;font-size:13px;font-weight:700;text-shadow:0 1px 3px #000}
</style></head><body>
<div id="wrap"><canvas id="c"></canvas><div id="labels"></div></div>
<script type="module">
import * as THREE from './app/vendor/three.module.js';
const SKY_V=${JSON.stringify(SKY_V)}, SKY_F=${JSON.stringify(SKY_F)};
const TUNE_UNIFORMS=${JSON.stringify(A.makeTuningUniforms())};
const SUN_V=${JSON.stringify(SUN_V)}, SUN_F=${JSON.stringify(SUN_F)};
const CLD_V=${JSON.stringify(CLD_V)}, CLD_F=${JSON.stringify(CLD_F)};
const SCENES=${JSON.stringify(SCENE_DATA)};

const COLS=2, ROWS=2, TW=600, TH=380;
const canvas=document.getElementById('c');
canvas.width=COLS*TW; canvas.height=ROWS*TH;
const renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:false});
renderer.setPixelRatio(1); renderer.setSize(COLS*TW,ROWS*TH,false); renderer.setScissorTest(true);

const errors=[]; const oe=console.error; console.error=(...a)=>{errors.push(a.join(' ')); oe(...a);};

// ── 구름 아틀라스: 부드러운 알파 원반 (실제 아틀라스 굽기는 별도 검증됨) ──
function makeAtlas(){
  const N=256, data=new Uint8Array(N*N*4);
  for(let y=0;y<N;y++)for(let x=0;x<N;x++){
    const i=(y*N+x)*4;
    // 뭉게구름 실루엣: 여러 원의 합 + 부드러운 가장자리
    const u=x/N, v=y/N;
    let f=0;
    const blobs=[[0.30,0.42,0.20],[0.48,0.52,0.24],[0.66,0.44,0.19],[0.80,0.38,0.13],[0.18,0.38,0.13]];
    for(const [bx,by,br] of blobs){
      const d=Math.hypot(u-bx,(v-by)*1.9)/br;
      f=Math.max(f,1-Math.min(1,d*d));
    }
    // 아래를 평평하게 (구름 밑면)
    if(v<0.34) f*=Math.max(0,(v-0.22)/0.12);
    const a=Math.max(0,Math.min(1,f*1.4));
    data[i]=255;data[i+1]=255;data[i+2]=255;data[i+3]=Math.round(a*255);
  }
  const t=new THREE.DataTexture(data,N,N,THREE.RGBAFormat);
  t.minFilter=THREE.LinearFilter; t.magFilter=THREE.LinearFilter; t.needsUpdate=true;
  return t;
}
const atlas=makeAtlas();

const scene=new THREE.Scene();
const skyMat=new THREE.ShaderMaterial({uniforms:{...TUNE_UNIFORMS,
  uSunDir:{value:new THREE.Vector3()},uSunAltDeg:{value:0},uBeta:{value:0.08},
  uAngstrom:{value:1.3},uElevScale:{value:1},uOzoneDU:{value:330},uSaturation:{value:1}},
  vertexShader:SKY_V,fragmentShader:SKY_F,side:THREE.BackSide,depthWrite:false,depthTest:false});
scene.add(new THREE.Mesh(new THREE.SphereGeometry(500,32,16),skyMat));

const sunMat=new THREE.ShaderMaterial({uniforms:{...TUNE_UNIFORMS,uColor:{value:new THREE.Color(1,1,1)},uIntensity:{value:14}},
  vertexShader:SUN_V,fragmentShader:SUN_F,transparent:true,depthWrite:false,depthTest:false,side:THREE.DoubleSide});
const sunR=450*Math.tan(0.267*Math.PI/180)*2.4;
const sunMesh=new THREE.Mesh(new THREE.PlaneGeometry(sunR*2,sunR*2),sunMat);
sunMesh.renderOrder=0; sunMesh.frustumCulled=false; scene.add(sunMesh);

const CAP=32;
const cg=new THREE.PlaneGeometry(1,1); cg.deleteAttribute('normal');
const mk=(n,sz)=>{const a=new THREE.InstancedBufferAttribute(new Float32Array(CAP*sz),sz);
  a.setUsage(THREE.DynamicDrawUsage); cg.setAttribute(n,a); return a;};
const aUv=mk('aUvRect',4),aBeam=mk('aBeam',3),aAmb=mk('aAmbient',3),
      aGeom=mk('aGeom',4),aOpt=mk('aOptics',4),aDb=mk('aCloudDb',3);
const cldMat=new THREE.ShaderMaterial({uniforms:{...TUNE_UNIFORMS,
  uAtlas:{value:atlas},uSunDir:{value:new THREE.Vector3()},uShadeContrast:{value:1.35},
  uHorizonGlow:{value:new THREE.Vector3()},uZenithSky:{value:new THREE.Vector3()},
  uBeta:{value:0.08},uAngstrom:{value:1.3},uElevScale:{value:1}},
  vertexShader:CLD_V,fragmentShader:CLD_F,transparent:true,depthWrite:false,
  depthTest:true,side:THREE.DoubleSide,blending:THREE.NormalBlending});
const cloudMesh=new THREE.InstancedMesh(cg,cldMat,CAP);
cloudMesh.count=0; cloudMesh.frustumCulled=false; cloudMesh.renderOrder=1;
cloudMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(cloudMesh);

const cam=new THREE.PerspectiveCamera(72,TW/TH,0.1,1000); cam.position.set(0,0,0);
const R=430, M=new THREE.Matrix4();
const labels=document.getElementById('labels');

SCENES.forEach((s,i)=>{
  const col=i%COLS,row=Math.floor(i/COLS),x=col*TW,y=(ROWS-1-row)*TH;
  const aR=s.sunAlt*Math.PI/180,zR=s.sunAz*Math.PI/180;
  const sunDir=new THREE.Vector3(Math.cos(aR)*Math.sin(zR),Math.sin(aR),-Math.cos(aR)*Math.cos(zR));

  skyMat.uniforms.uSunDir.value.copy(sunDir);
  skyMat.uniforms.uSunAltDeg.value=s.sunAlt;
  skyMat.uniforms.uBeta.value=s.params.betaMie;
  skyMat.uniforms.uAngstrom.value=s.params.angstrom;
  skyMat.uniforms.uElevScale.value=s.params.elevScale;
  skyMat.uniforms.uOzoneDU.value=s.params.ozoneDU;

  sunMesh.position.set(450*Math.cos(aR)*Math.sin(zR),450*Math.sin(aR),-450*Math.cos(aR)*Math.cos(zR));
  sunMesh.lookAt(0,0,0);
  sunMat.uniforms.uColor.value.setRGB(...s.sunColor);
  sunMesh.visible = s.sunAlt > -0.9;

  cldMat.uniforms.uSunDir.value.copy(sunDir);
  cldMat.uniforms.uHorizonGlow.value.set(...s.horizonGlow);
  cldMat.uniforms.uZenithSky.value.set(...s.zenithSky);
  cldMat.uniforms.uBeta.value=s.params.betaMie;
  cldMat.uniforms.uAngstrom.value=s.params.angstrom;
  cldMat.uniforms.uElevScale.value=s.params.elevScale;

  s.clouds.slice(0,CAP).forEach((c,j)=>{
    const eR=c.elev*Math.PI/180,azR2=c.az*Math.PI/180;
    M.makeTranslation(R*Math.cos(eR)*Math.sin(azR2),R*Math.sin(eR),-R*Math.cos(eR)*Math.cos(azR2));
    cloudMesh.setMatrixAt(j,M);
    aUv.setXYZW(j,0,0,1,1);
    aBeam.setXYZ(j,...c.beam);
    aAmb.setXYZ(j,...c.ambient);
    aGeom.setXYZW(j,c.sizeY*c.aspect,c.sizeY,c.sunDir[0],c.sunDir[1]);
    aOpt.setXYZW(j,c.opacity,0,c.tau,c.distKm);
    aDb.setXYZ(j,c.shadowContrast,c.rimSharpness,c.altKm);
  });
  cloudMesh.count=Math.min(CAP,s.clouds.length);
  [cloudMesh.instanceMatrix,aUv,aBeam,aAmb,aGeom,aOpt,aDb].forEach(a=>a.needsUpdate=true);

  const cA=s.camAz*Math.PI/180,cE=9*Math.PI/180;
  cam.lookAt(100*Math.cos(cE)*Math.sin(cA),100*Math.sin(cE),-100*Math.cos(cE)*Math.cos(cA));
  renderer.setViewport(x,y,TW,TH); renderer.setScissor(x,y,TW,TH);
  renderer.render(scene,cam);

  const d=document.createElement('div'); d.className='lbl';
  d.style.left=(x+10)+'px'; d.style.top=(row*TH+10)+'px'; d.textContent=s.label;
  labels.appendChild(d);
});
document.title='DONE::'+(errors.length?'SHADER_ERR':'OK')+'::'+renderer.getContext().getError();
window.__errors=errors;
</script></body></html>`;

const dir = '/tmp/claude-0/-home-user-solar-path/eaf4c0af-06ca-5c06-a0d7-588dbfb07373/scratchpad/preview';
fs.writeFileSync(path.join(dir, 'full.html'), html);
console.log('생성 완료');
