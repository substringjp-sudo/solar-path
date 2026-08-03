/**
 * 강화 구름 격자 A/B 미리보기.
 *
 * 같은 "진짜 하늘"을 두 가지 관측 밀도로 본 결과를 나란히 렌더합니다.
 *   왼쪽 : 기본 팬     — 5레이(±20°) × 7고리
 *   오른쪽: 강화 격자   — 7레이(±30°) × 10고리  (utils/cloudGridAdapter.ts 경유)
 *
 * 진짜 하늘은 **태양 방위 ±22° 밖에서만 흐린** 구조입니다.
 * 기본 팬은 ±20°가 한계라 그 띠를 아예 보지 못하고 가장자리 값을 밖으로
 * 늘려 씁니다. 격자는 ±30°까지 실측하므로 그 띠가 화면에 나타나야 합니다.
 *
 * 합격 기준(눈으로): 오른쪽 화면 좌우 가장자리에 왼쪽에는 없는 구름 벽이 서고,
 * 화면 중앙(태양 쪽)은 양쪽 모두 열려 있을 것.
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

const SCENES = [
  { label: '기본 팬 ±20° · 태양 45°',   mode: 'fan',  sunAlt: 45, camElev: 26 },
  { label: '강화 격자 ±30° · 태양 45°', mode: 'grid', sunAlt: 45, camElev: 26 },
  { label: '기본 팬 ±20° · 태양 6°',    mode: 'fan',  sunAlt: 6,  camElev: 12 },
  { label: '강화 격자 ±30° · 태양 6°',  mode: 'grid', sunAlt: 6,  camElev: 12 },
];
const SUN_AZ = 270;

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
 body{margin:0;background:#111;font-family:sans-serif}
 #wrap{position:relative;width:1200px}
 .lbl{position:absolute;color:#fff;font-size:13px;font-weight:700;text-shadow:0 1px 3px #000}
</style></head><body>
<div id="wrap"><canvas id="c"></canvas><div id="labels"></div></div>
<script type="module">
globalThis.__DEV__ = false;
import * as THREE from './app/vendor/three.module.js';
import { bakeCloudAtlas } from './app/components/SkyScene3D/cloudAtlas.js';
import { createCloudField, updateCloudField } from './app/components/SkyScene3D/CloudField.js';
import { buildCloudInstances } from './app/components/SkyScene3D/cloudPlacement.js';
import { createCloudDeck, updateCloudDeck } from './app/components/SkyScene3D/CloudDeck.js';
import { cloudGridToFan } from './app/utils/cloudGridAdapter.js';
import { makeAtmosphereParams, skyRadiance, sunDiskColor, beamAtAltitude }
  from './app/utils/atmosphere.js';

const SKY_V=${JSON.stringify(SKY_V)},SKY_F=${JSON.stringify(SKY_F)};
const SUN_V=${JSON.stringify(SUN_V)},SUN_F=${JSON.stringify(SUN_F)};
const SCENES=${JSON.stringify(SCENES)}, SUN_AZ=${SUN_AZ};

const COLS=2,ROWS=2,TW=600,TH=420;
const canvas=document.getElementById('c');
canvas.width=COLS*TW;canvas.height=ROWS*TH;
const renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:false});
renderer.setPixelRatio(1);renderer.setSize(COLS*TW,ROWS*TH,false);
const errors=[];const oe=console.error;console.error=(...a)=>{errors.push(a.join(' '));oe(...a);};

const atlas = bakeCloudAtlas(renderer);
const scene=new THREE.Scene();
const skyMat=new THREE.ShaderMaterial({uniforms:{
  uSunDir:{value:new THREE.Vector3()},uSunAltDeg:{value:0},uBeta:{value:0.08},
  uAngstrom:{value:1.3},uElevScale:{value:1},uOzoneDU:{value:330},uSaturation:{value:1},
  uCloudDiffuse:{value:1},uHaloStrength:{value:0}},
  vertexShader:SKY_V,fragmentShader:SKY_F,side:THREE.BackSide,depthWrite:false,depthTest:false});
const skyMesh=new THREE.Mesh(new THREE.SphereGeometry(500,32,16),skyMat);
skyMesh.renderOrder=-1; scene.add(skyMesh);

const sunMat=new THREE.ShaderMaterial({uniforms:{
  uColor:{value:new THREE.Color(1,1,1)},uIntensity:{value:16},
  uSunAltDeg:{value:30},uSaturation:{value:1},uOcclusion:{value:1}},
  vertexShader:SUN_V,fragmentShader:SUN_F,transparent:true,depthWrite:false,depthTest:true,side:THREE.DoubleSide});
const sunR=450*Math.tan(1.08*Math.PI/180);
const sunMesh=new THREE.Mesh(new THREE.PlaneGeometry(sunR*2,sunR*2),sunMat);
sunMesh.renderOrder=0.5; sunMesh.frustumCulled=false; scene.add(sunMesh);

const cloudField = createCloudField(atlas, 320);
scene.add(cloudField.mesh);
const cloudDeck = createCloudDeck();
scene.add(cloudDeck.group);

const cam=new THREE.PerspectiveCamera(72,TW/TH,0.1,1000); cam.position.set(0,0,0);
const labels=document.getElementById('labels');
const stats=[];
const DATE = new Date(Date.UTC(2026,7,2,9,0));

// ── 진짜 하늘 ────────────────────────────────────────────────────────────
//
// 두 가지 구조를 겹칩니다. **둘 다 기본 팬의 격자 간격보다 촘촘합니다** —
// 그게 요점입니다. 관측이 성기면 이런 구조는 존재하지 않는 것이 됩니다.
//
//  ① 40~70km 사이의 **맑은 띠** (그 밖은 두꺼움).
//     기본 팬 고리는 …30, 70, 130… 이라 30과 70을 직선으로 이어 버려
//     한가운데의 맑은 구간이 통째로 사라집니다.
//     격자 고리는 …35, 55, 80… 이라 55가 띠 한복판에 떨어집니다.
//  ② 태양 방위 ±22° 밖의 **두꺼운 벽** — 기본 팬은 ±20°가 한계라 못 봅니다.
function truth(azOffset, dist){
  // ① 거리 방향: 40~70km 가 뚫려 있음
  const slot = dist > 38 && dist < 72 ? 1 : 0;
  // ② 방위 방향: 바깥으로 갈수록 두꺼워짐
  const w = Math.min(1, Math.max(0, (Math.abs(azOffset) - 16) / 10));
  const thick = { low: 20 + 70*w, mid: 30 + 60*w, high: 55 + 40*w };
  return slot
    ? { low: thick.low*0.12, mid: thick.mid*0.10, high: thick.high*0.12 }
    : thick;
}
const OBS = { humidity:58, visibility:30000, precipitation:0, low:20, mid:30, high:55 };

/** 기본 팬 — 진짜 하늘을 5레이 × 7고리로만 관측 */
function sampleAsFan(){
  const out=[{distance:0,azimuthOffset:0,...OBS}];
  for(const off of [-20,-10,0,10,20]) for(const d of [10,30,70,130,200,280,380])
    out.push({distance:d,azimuthOffset:off,...OBS,...truth(off,d)});
  return out;
}

/** 강화 격자 — 같은 하늘을 7레이 × 10고리로 관측한 뒤 어댑터를 통과 */
function sampleAsGrid(){
  const points=[];
  for(const azOffset of [-30,-20,-10,0,10,20,30])
    for(const distance of [10,20,35,55,80,120,170,230,300,380]){
      const t = truth(azOffset, distance);
      points.push({latitude:37.5,longitude:127,distance,
        bearing:(SUN_AZ+azOffset+360)%360, azOffset, low:t.low, mid:t.mid, high:t.high});
    }
  const grid={points,timestamp:Date.now(),azCenter:SUN_AZ,observerLat:37.5,observerLon:127};
  return cloudGridToFan({grid, time:DATE, sunAzimuthDeg:SUN_AZ,
    baseline:[{distance:0,azimuthOffset:0,...OBS}]});
}

SCENES.forEach((s,i)=>{
  const col=i%COLS,row=Math.floor(i/COLS),x=col*TW,y=(ROWS-1-row)*TH;
  const aR=s.sunAlt*Math.PI/180,zR=SUN_AZ*Math.PI/180;
  const sunDir=new THREE.Vector3(Math.cos(aR)*Math.sin(zR),Math.sin(aR),-Math.cos(aR)*Math.cos(zR));

  const atmosphere = makeAtmosphereParams({
    visibilityM:30000, humidityPct:58, latitude:37.5, dayOfYear:214 });

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

  const weather = s.mode==='grid' ? sampleAsGrid() : sampleAsFan();
  const built = buildCloudInstances({
    atlas, currentTime: DATE, sunAltDeg: s.sunAlt, sunAzDeg: SUN_AZ,
    atmosphere, weather, maxTotal: 320,
  });

  updateCloudField(cloudField, atlas, built.instances, SUN_AZ, s.sunAlt, {
    horizonGlow: skyRadiance(0.5,5,s.sunAlt,atmosphere),
    zenithSky:   skyRadiance(88,90,s.sunAlt,atmosphere),
    betaMie: atmosphere.betaMie, angstrom: atmosphere.angstrom, elevScale: atmosphere.elevScale,
    cloudDiffuse: built.optics.diffuseToGround,
  });

  const byLayer=L=>built.instances.filter(c=>c.layer===L);
  const med=(a,f)=>{ if(!a.length) return f; const q=[...a].sort((p,r)=>p-r); return q[Math.floor(q.length/2)]; };
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
    ambientUp: skyRadiance(88,90,s.sunAlt,atmosphere),
    ambientDown: skyRadiance(20,70,s.sunAlt,atmosphere),
    sunDir, sunAltDeg: s.sunAlt,
    tauFor: L => med(byLayer(L).map(c=>c.tau), 25),
    shadowFor: L => med(byLayer(L).map(c=>c.shadowContrast), 0.5),
    timeSeconds: 0, visible: true,
  });

  // 하늘 샘플을 (층 · 거리대 · 방위대)로 잘라 봅니다.
  // 눈으로 본 것과 수치가 맞는지 대조하기 위한 것입니다.
  const band=(layer,pred)=>{
    const sel=built.samples.filter(v=>{
      if(v.layer!==layer) return false;
      const rel=Math.abs(((v.azimuthDeg-SUN_AZ+540)%360)-180);
      return pred(v.distanceKm, rel);
    });
    return sel.length ? +(sel.reduce((a,b)=>a+b.cover,0)/sel.length).toFixed(3) : null;
  };
  stats.push({label:s.label, n:built.instances.length,
    rays:new Set(weather.map(w=>w.azimuthOffset)).size, pts:weather.length,
    // ① 40~70km 맑은 띠 — 상층운이 이 거리를 고도각 8~14°로 봅니다.
    slotHigh: band('high', (d,_r) => d>38 && d<72),
    // 그 바로 안쪽(두꺼워야 함) — 대비가 살아 있는지 확인
    nearHigh: band('high', (d,_r) => d>=20 && d<=38),
    // ② 방위 ±22° 밖의 벽. 방위 격자가 15° 간격이라 이 띠는 rel=30° 고리입니다.
    //    (더 넓게 잡으면 두 팬 모두 관측 밖인 방위가 섞여 차이가 희석됩니다.)
    edgeLow: band('low', (_d,r) => r>=25 && r<38),
    coreLow: band('low', (_d,r) => r<16),
    // 상층은 하늘 footprint가 멀리(고도 10km → 최대 159km)까지 가므로
    // 방위 폭 확대가 실제로 드러나는 층입니다. 저층은 24km 안에 갇힙니다.
    edgeHigh: band('high', (_d,r) => r>=25 && r<38),
    sunT:+built.optics.sunTransmittance.toFixed(3)});

  const cA=SUN_AZ*Math.PI/180,cE=s.camElev*Math.PI/180;
  cam.lookAt(100*Math.cos(cE)*Math.sin(cA),100*Math.sin(cE),-100*Math.cos(cE)*Math.cos(cA));
  renderer.setViewport(x,y,TW,TH); renderer.setScissor(x,y,TW,TH); renderer.setScissorTest(true);
  renderer.render(scene,cam);

  const d=document.createElement('div'); d.className='lbl';
  d.style.left=(x+8)+'px'; d.style.top=(row*TH+8)+'px'; d.textContent=s.label;
  labels.appendChild(d);
});
document.title='DONE::'+(errors.length?'SHADER_ERR':'OK')+'::'+renderer.getContext().getError();
window.__errors=errors;
window.__stats=stats;
</script></body></html>`;

fs.writeFileSync(path.join(PREVIEW, 'grid.html'), html);
console.log('생성 완료: grid.html');
