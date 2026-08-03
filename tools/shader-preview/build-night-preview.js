/**
 * 밤하늘 미리보기: 하늘 + 별 + 은하수 + 태양/달 궤적 리본.
 *
 * build-preview.js보다 한 걸음 더 나갑니다. 여기서는 셰이더만 추출하는 게 아니라
 * **StarField / MilkyWayBand / CelestialPathMesh 모듈 자체를 그대로 import**해서
 * 브라우저에서 실행합니다. 지오메트리 생성·좌표 변환·행성 계산까지 전부 앱과
 * 같은 코드가 돌기 때문에, 여기서 예쁘면 앱에서도 예쁩니다.
 *
 * 준비 (tools/shader-preview/README.md 참조):
 *   npx tsc --module esnext --target es2020 --moduleResolution bundler \
 *     --skipLibCheck --outDir /tmp/esmbuild \
 *     src/components/SkyScene3D/{StarField,MilkyWayBand,CelestialPathMesh}.ts
 *   그 뒤 이 스크립트가 import 경로를 브라우저용으로 고쳐 preview/app 에 넣습니다.
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

// 서울, 2026-08-02 00:30 KST — 여름 은하수가 남쪽 하늘 높이 올라오는 시각
const PREVIEW_ISO = new Date(Date.UTC(2026, 7, 1, 15, 30)).toISOString();
const LAT = 37.5;
const LON = 127.0;

const WIDE = [
  { label: '천문박명 -14° · 6.5등급', sunAlt: -14, sunAz: 300, camAz: 200, camElev: 34, mag: 6.5, bright: 1.0, fov: 72 },
  { label: '한밤 -30° · 6.5등급 (은하수)', sunAlt: -30, sunAz: 0, camAz: 200, camElev: 34, mag: 6.5, bright: 1.0, fov: 72 },
  { label: '한밤 -30° · 4.0등급 (도시)', sunAlt: -30, sunAz: 0, camAz: 200, camElev: 34, mag: 4.0, bright: 1.0, fov: 72 },
  { label: '시민박명 -5° · 궤적 리본', sunAlt: -5, sunAz: 288, camAz: 268, camElev: 22, mag: 6.5, bright: 1.4, fov: 72, paths: true },
];
/** 별 색·크기·밀도를 눈으로 판단하려면 좁은 화각이 필요합니다 */
const CLOSE = [
  { label: '궁수자리 은하 중심 · FOV 26°', sunAlt: -30, sunAz: 0, camAz: 219, camElev: 30, mag: 6.5, bright: 1.0, fov: 26 },
  { label: '백조자리 천정 부근 · FOV 26°', sunAlt: -30, sunAz: 0, camAz: 340, camElev: 78, mag: 6.5, bright: 1.0, fov: 26 },
  { label: '같은 시야 · 밝기 ×2.0', sunAlt: -30, sunAz: 0, camAz: 219, camElev: 30, mag: 6.5, bright: 2.0, fov: 26 },
  { label: '같은 시야 · 한계 4.0등급', sunAlt: -30, sunAz: 0, camAz: 219, camElev: 30, mag: 4.0, bright: 1.0, fov: 26 },
];
const SCENES = process.argv.includes('--close') ? CLOSE : WIDE;
const OUT_NAME = process.argv.includes('--close') ? 'night-close.html' : 'night.html';
const P = A.makeAtmosphereParams({ visibilityM: 45000, humidityPct: 40 });

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
 body{margin:0;background:#111;font-family:sans-serif}
 #wrap{position:relative;width:1200px}
 .lbl{position:absolute;color:#fff;font-size:13px;font-weight:700;text-shadow:0 1px 3px #000}
</style></head><body>
<div id="wrap"><canvas id="c"></canvas><div id="labels"></div></div>
<script type="module">
import * as THREE from './app/vendor/three.module.js';
import { createStarField, updateStarField, computeEquToHorizon, buildPlanetPoints }
  from './app/components/SkyScene3D/StarField.js';
import { createMilkyWayBand, updateMilkyWay } from './app/components/SkyScene3D/MilkyWayBand.js';
import { createCelestialPathsGroup, updateCelestialPaths }
  from './app/components/SkyScene3D/CelestialPathMesh.js';

const SKY_V=${JSON.stringify(SKY_V)},SKY_F=${JSON.stringify(SKY_F)};
const SCENES=${JSON.stringify(SCENES)},PARAMS=${JSON.stringify(P)};
const DATE=new Date(${JSON.stringify(PREVIEW_ISO)}), LAT=${LAT}, LON=${LON};

const COLS=2,ROWS=2,TW=600,TH=380;
const canvas=document.getElementById('c');
canvas.width=COLS*TW;canvas.height=ROWS*TH;
const renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:false});
renderer.setPixelRatio(1);renderer.setSize(COLS*TW,ROWS*TH,false);renderer.setScissorTest(true);
const errors=[];const oe=console.error;console.error=(...a)=>{errors.push(a.join(' '));oe(...a);};

const scene=new THREE.Scene();

// 하늘 (앱과 같은 셰이더)
const skyMat=new THREE.ShaderMaterial({uniforms:{
  uSunDir:{value:new THREE.Vector3()},uSunAltDeg:{value:0},uBeta:{value:PARAMS.betaMie},
  uAngstrom:{value:PARAMS.angstrom},uElevScale:{value:PARAMS.elevScale},
  uOzoneDU:{value:PARAMS.ozoneDU},uSaturation:{value:1},
  // 스카이돔이 요구하는 uniform은 전부 채워야 합니다. 빠뜨리면 GL 기본값 0이
  // 들어가 uCloudDiffuse=0 → 하늘 전체가 감광·탈색됩니다.
  uCloudDiffuse:{value:1},uHaloStrength:{value:0}},
  vertexShader:SKY_V,fragmentShader:SKY_F,side:THREE.BackSide,depthWrite:false,depthTest:false});
const skyMesh=new THREE.Mesh(new THREE.SphereGeometry(500,32,16),skyMat);
skyMesh.renderOrder=-1; scene.add(skyMesh);

// 여기부터는 전부 앱 모듈이 만든 실제 객체입니다.
const milkyWay=createMilkyWayBand();  scene.add(milkyWay.mesh);
const starField=createStarField(8);   scene.add(starField.points);
const paths=createCelestialPathsGroup(); scene.add(paths.containerGroup);

const equ=new THREE.Matrix3();
computeEquToHorizon(DATE, LAT, LON, equ);
const planets=buildPlanetPoints(DATE);

const cam=new THREE.PerspectiveCamera(72,TW/TH,0.1,1000); cam.position.set(0,0,0);
const labels=document.getElementById('labels');

SCENES.forEach((s,i)=>{
  const col=i%COLS,row=Math.floor(i/COLS),x=col*TW,y=(ROWS-1-row)*TH;
  const aR=s.sunAlt*Math.PI/180,zR=s.sunAz*Math.PI/180;
  skyMat.uniforms.uSunDir.value.set(Math.cos(aR)*Math.sin(zR),Math.sin(aR),-Math.cos(aR)*Math.cos(zR));
  skyMat.uniforms.uSunAltDeg.value=s.sunAlt;

  updateStarField(starField,{equToHorizon:equ,sunAltDeg:s.sunAlt,brightness:s.bright,
    magLimit:s.mag,pixelRatio:1,planets,showStars:true,showPlanets:true});
  updateMilkyWay(milkyWay,equ,s.sunAlt,s.bright,s.mag);
  updateCelestialPaths(paths,DATE,LAT,LON,s.sunAlt,s.sunAz);
  paths.containerGroup.visible = !!s.paths;

  cam.fov=s.fov; cam.updateProjectionMatrix();
  const cA=s.camAz*Math.PI/180,cE=s.camElev*Math.PI/180;
  cam.lookAt(100*Math.cos(cE)*Math.sin(cA),100*Math.sin(cE),-100*Math.cos(cE)*Math.cos(cA));
  renderer.setViewport(x,y,TW,TH); renderer.setScissor(x,y,TW,TH);
  renderer.render(scene,cam);

  const d=document.createElement('div'); d.className='lbl';
  d.style.left=(x+10)+'px'; d.style.top=(row*TH+10)+'px'; d.textContent=s.label;
  labels.appendChild(d);
});
document.title='DONE::'+(errors.length?'SHADER_ERR':'OK')+'::'+renderer.getContext().getError();
window.__errors=errors;
window.__stats={stars:starField.starCount};
</script></body></html>`;

fs.writeFileSync(path.join(PREVIEW, OUT_NAME), html);
console.log('생성 완료: ' + OUT_NAME);
