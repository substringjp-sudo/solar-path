/**
 * **수심이 물가를 만드는가 · 땅색이 판지가 아닌가** (COASTLINE_PLAN 5단계).
 *
 * 4단계에서 땅/물 경계가 자료가 말하는 자리에 있음을 99.23% 로 확인했습니다.
 * 이제 묻는 것은 **색**입니다.
 *
 * ## 재는 법 — 자리는 CPU 가 말하고, 색만 화면에서 잽니다
 *
 * 바다 쪽으로 한 장을 크게 찍고, 각 화소가 무엇인지는 **CPU 광선행진**이
 * 정합니다 (거리 · 종류 · 고도 또는 수심 · 국소 경사). 기하는 이미 4단계에서
 * 검증됐으므로 여기서는 **그 자리의 색**만 봅니다. 색으로 종류를 되짚으면
 * 순환논법이 됩니다.
 *
 * 한 열은 방위가 같으므로 열마다 **한 번만** 행진하면 됩니다.
 *
 * ## 무엇을 보나
 *
 * ① **포말 폭이 지형 경사를 따르는가** — 계획서가 5단계 판정으로 적어 둔
 *    바로 그 질문입니다. 폭을 거리가 아니라 **수심**으로 재면, 완만한
 *    모래밭은 얕은 구간이 길어 띠가 넓고 절벽은 바로 깊어져 좁습니다.
 *    화면에서 잰 포말 폭과 **해안 경사**의 상관을 봅니다.
 * ② **공기원근** — 먼 지형이 하늘빛으로 수렴하는가. 거리대별로 |색 − 하늘빛|
 *    이 단조 감소해야 합니다. `uAerial` 을 끄면 그 경향이 사라져야 합니다
 *    (측정이 정말 그 항을 재고 있다는 대조).
 * ③ **경사 알베도** — 급사면이 암반 쪽(밝고 덜 붉음)으로 가는가. CPU 경사와
 *    화면 색조(파랑/빨강)의 상관. **뒤섞은 경사**와의 상관은 0 이어야
 *    합니다 (귀무 대조).
 * ④ **젖은 모래** — 조간대(고도 < 조간대폭)가 그 위쪽 땅보다 어두운가.
 *
 * 사용: node tools/shader-preview/build-shore.js
 *       node tools/shader-preview/verify-shore.js
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const { PREVIEW } = require('./paths');
const { demZoomForRadius, pickBlockOrigin, lonLatToTileFloat, makeCpuDem } = require('./dem-cpu');

/** 4단계와 같은 자리 — 바다가 실제로 보이는 서안. */
const LAT = 37.24102, LON = 126.55969;
const BLOCK = 3, EYE_M = 1.6;
const FIELD_FAR_M = 3000, RINGS = 152;
const EARTH_R = 6371000;

/**
 * 바다 쪽 한 장.
 *
 * ⚠ 눈높이 2.77m 에서는 **물가부터 수평선까지가 2.93° 밖에 안 됩니다.**
 * 화각 40° 로 찍으면 바다가 화소 몇 줄로 뭉개져 포말 폭을 잴 수가 없습니다
 * (처음에 그렇게 찍었더니 물 화소가 73,728 중 2,311 개뿐이었습니다).
 * 그래서 **좁은 화각으로 물가를 크게** 봅니다. 방위 210° 는 DEM 을 훑어
 * 바다가 가장 넓게 보이는 쪽으로 고른 값입니다.
 */
const CAM_AZ = 210, FOV_DEG = 8, PITCH_DEG = -1.2, W = 192, H = 384;

/**
 * **경사 알베도용 두 번째 시야.**
 *
 * ⚠ 물가 시야(210°, 화각 8°)에는 급사면이 없습니다 — 갯벌 해안이라 그
 * 창 안의 뭍은 거의 평평하고, 경사 상관이 정확히 0 으로 나왔습니다.
 * 이 지점 전체로 보면 뭍 표본의 23.5% 가 경사 0.10 을 넘고 최대 0.36
 * 이므로, 기복이 있는 쪽(74°)을 넓은 화각으로 따로 봅니다.
 */
const REL_AZ = 74, REL_FOV = 30, REL_PITCH = 3;

const FOOT_M = 0.6, HINGE_M = 12, INNER_RINGS = 24;
const logStep = (k, n, a, b) => a * Math.pow(b / a, n <= 1 ? 0 : k / (n - 1));
const ringDist = (k, rings) => {
  const inner = Math.min(INNER_RINGS, Math.max(0, rings - 2));
  return k < inner ? logStep(k, inner + 1, FOOT_M, HINGE_M)
                   : logStep(k - inner, rings - inner, HINGE_M, FIELD_FAR_M);
};
const norm = v => { const L = Math.hypot(...v); return v.map(x => x / L); };
const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];

const get = (url) => new Promise((res, rej) => {
  https.get(url, r => {
    if (r.statusCode !== 200) { rej(new Error(`HTTP ${r.statusCode}`)); r.resume(); return; }
    const c = []; r.on('data', d => c.push(d)); r.on('end', () => res(Buffer.concat(c)));
  }).on('error', rej);
});

(async () => {
  const zoom = demZoomForRadius(FIELD_FAR_M, LAT, BLOCK);
  const t = lonLatToTileFloat(LON, LAT, zoom);
  const { originX, originY } = pickBlockOrigin(t.x, t.y, BLOCK);
  const demDir = path.join(PREVIEW, 'dem');
  fs.mkdirSync(demDir, { recursive: true });
  for (let dy = 0; dy < BLOCK; dy++) for (let dx = 0; dx < BLOCK; dx++) {
    const f = path.join(demDir, `${zoom}_${originX + dx}_${originY + dy}.png`);
    if (!fs.existsSync(f)) fs.writeFileSync(f, await get(
      `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${zoom}/${originX + dx}/${originY + dy}.png`));
  }
  const dem = makeCpuDem({ demDir, zoom, lat: LAT, lon: LON });
  const OBS = dem.elevAtGround(0, 0);
  const eye = OBS + EYE_M;
  console.log(`발밑 ${OBS.toFixed(2)}m · 눈 ${eye.toFixed(2)}m · 방위 ${CAM_AZ}° 화각 ${FOV_DEG}°`);

  const seaAngle = d => Math.atan2(-eye - (d * d) / (2 * EARTH_R), d) * 180 / Math.PI;
  const at = (az, d) => dem.elevAtGround(Math.sin(az) * d, -Math.cos(az) * d);

  /** 한 방위의 보이는 구간 — 4단계와 같은 행진에 표면 정보를 얹습니다. */
  function march(azRad) {
    const out = []; let maxA = -Infinity;
    const push = (o) => { if (o.a <= maxA) return; maxA = o.a; out.push(o); };
    for (let k = 0; k < RINGS; k++) {
      const d = ringDist(k, RINGS);
      const h = at(azRad, d);
      const aS = seaAngle(d);
      if (h === null) { push({ d, a: aS, t: 'sea', depth: 999, elev: 0, slope: 0 }); continue; }
      const aT = Math.atan2(h - eye - (d * d) / (2 * EARTH_R), d) * 180 / Math.PI;
      // 국소 경사 — 셰이더의 유한차분과 같은 간격(거리의 3%, 최소 8m)
      const e = Math.max(8, d * 0.03);
      const hr = at(azRad, d + e), hf = at(azRad, d - e);
      const slope = (hr === null || hf === null) ? 0 : Math.abs(hr - hf) / (2 * e);
      if (aT >= aS) push({ d, a: aT, t: 'land', elev: h, depth: 0, slope });
      else push({ d, a: aS, t: 'sea', depth: Math.max(0, -h), elev: 0, slope });
    }
    for (let i = 1; i <= 192; i++) {
      const d = FIELD_FAR_M * Math.pow(Math.sqrt(2 * EARTH_R * eye) / FIELD_FAR_M, i / 192);
      push({ d, a: seaAngle(d), t: 'sea', depth: 999, elev: 0, slope: 0 });
    }
    return out;
  }

  // ── 열마다 한 번 행진하고, 행마다 그 각의 표면을 집어옵니다 ─────────────
  const tanV = Math.tan((FOV_DEG / 2) * Math.PI / 180);
  const a0 = (CAM_AZ * Math.PI) / 180, p0 = (PITCH_DEG * Math.PI) / 180;
  const F = [Math.cos(p0) * Math.sin(a0), Math.sin(p0), -Math.cos(p0) * Math.cos(a0)];
  const R = [Math.cos(a0), 0, Math.sin(a0)];
  const U = cross(F.map(x => -x), R);
  // ⚠ three 의 PerspectiveCamera(fov, aspect) 에서 fov 는 **세로**입니다.
  //   가로 반각은 tanV · aspect 이고, 여기 aspect 는 W/H 입니다. 이걸
  //   빠뜨리면 열마다 방위가 어긋나 화소가 통째로 엉뚱한 표면에 붙습니다
  //   (2단계에서 배운 등록 오류와 같은 부류입니다).
  const ASPECT = W / H;
  const ray = (nx, ny) => norm([
    nx * tanV * ASPECT * R[0] + ny * tanV * U[0] + F[0],
    nx * tanV * ASPECT * R[1] + ny * tanV * U[1] + F[1],
    nx * tanV * ASPECT * R[2] + ny * tanV * U[2] + F[2]]);

  const px = [];              // 화소마다 CPU 가 말하는 표면
  let 포말폭 = [], 해안경사 = [];
  for (let x = 0; x < W; x++) {
    const nx = ((x + 0.5) / W) * 2 - 1;
    const dm = ray(nx, 0);
    const segs = march(Math.atan2(dm[0], -dm[2]));
    const 맨위 = segs.length ? segs[segs.length - 1].a : -1e9;
    // 각 → 표면: 그 각에 도달하는 첫 구간
    const pick = (th) => {
      if (th > 맨위) return null;
      for (let i = 0; i < segs.length; i++) if (segs[i].a >= th) return segs[i];
      return segs[segs.length - 1];
    };
    let foamRows = 0;
    for (let y = 0; y < H; y++) {
      const d3 = ray(nx, ((y + 0.5) / H) * 2 - 1);
      const th = Math.asin(Math.max(-1, Math.min(1, d3[1]))) * 180 / Math.PI;
      const s = pick(th);
      if (s && s.t === 'sea' && s.depth < 0.5) foamRows++;
      px.push(s === null ? null : {
        x, y, t: s.t, d: +s.d.toFixed(1),
        depth: +Math.min(s.depth, 999).toFixed(3),
        elev: +s.elev.toFixed(2), slope: +s.slope.toFixed(4),
      });
    }
    // 물가의 해저 경사 — 수심 0 을 지나는 구간의 경사
    const shore = segs.filter(s => s.t === 'sea' && s.depth < 2 && s.depth > 0);
    포말폭.push(foamRows);
    해안경사.push(shore.length ? shore.reduce((a, b) => a + b.slope, 0) / shore.length : null);
  }
  // 모형의 해석적 성질: 수심 0.5m 안쪽 띠의 **지상 길이** = 0.5 / 경사.
  // 렌더가 아니라 자료에서 나오는 성질이므로 여기서 확인합니다.
  const 띠 = [], 역경사 = [];
  for (let x = 0; x < W; x++) {
    const nx = ((x + 0.5) / W) * 2 - 1;
    const dm = ray(nx, 0);
    const segs = march(Math.atan2(dm[0], -dm[2]));
    const sh = segs.filter(o => o.t === 'sea' && o.depth < 0.5);
    const sl = segs.filter(o => o.t === 'sea' && o.depth > 0 && o.depth < 2 && o.slope > 1e-5);
    if (sh.length < 2 || !sl.length) continue;
    const w = Math.max(...sh.map(o => o.d)) - Math.min(...sh.map(o => o.d));
    const g = sl.reduce((a, b) => a + b.slope, 0) / sl.length;
    띠.push(w); 역경사.push(1 / g);
  }
  const mean0 = a => a.reduce((x, y) => x + y, 0) / a.length;
  const corr0 = (a, b) => {
    const ma = mean0(a), mb = mean0(b);
    let n = 0, da = 0, db = 0;
    for (let i = 0; i < a.length; i++) { n += (a[i]-ma)*(b[i]-mb); da += (a[i]-ma)**2; db += (b[i]-mb)**2; }
    return (da <= 0 || db <= 0) ? null : n / Math.sqrt(da * db);
  };
  const 띠폭 = {
    열: 띠.length,
    상관_폭대역경사: 띠.length > 2 && corr0(띠, 역경사) !== null ? +corr0(띠, 역경사).toFixed(4) : null,
    평균폭m: 띠.length ? +mean0(띠).toFixed(1) : null,
    폭범위m: 띠.length ? [+Math.min(...띠).toFixed(1), +Math.max(...띠).toFixed(1)] : null,
  };
  console.log(`띠 폭 대 1/경사 상관 ${띠폭.상관_폭대역경사} (열 ${띠폭.열}, 평균 ${띠폭.평균폭m}m)`);

  // ── 두 번째 시야(기복) 의 CPU 화소 지도 ────────────────────────────────
  const tanV2 = Math.tan((REL_FOV / 2) * Math.PI / 180);
  const a2 = (REL_AZ * Math.PI) / 180, p2 = (REL_PITCH * Math.PI) / 180;
  const F2 = [Math.cos(p2) * Math.sin(a2), Math.sin(p2), -Math.cos(p2) * Math.cos(a2)];
  const R2 = [Math.cos(a2), 0, Math.sin(a2)];
  const U2 = cross(F2.map(x => -x), R2);
  const ray2 = (nx, ny) => norm([
    nx * tanV2 * (W / H) * R2[0] + ny * tanV2 * U2[0] + F2[0],
    nx * tanV2 * (W / H) * R2[1] + ny * tanV2 * U2[1] + F2[1],
    nx * tanV2 * (W / H) * R2[2] + ny * tanV2 * U2[2] + F2[2]]);
  const px2 = [];
  for (let x = 0; x < W; x++) {
    const nx = ((x + 0.5) / W) * 2 - 1;
    const dm = ray2(nx, 0);
    const segs = march(Math.atan2(dm[0], -dm[2]));
    const 맨위 = segs.length ? segs[segs.length - 1].a : -1e9;
    const pick = (th) => {
      if (th > 맨위) return null;
      for (let i = 0; i < segs.length; i++) if (segs[i].a >= th) return segs[i];
      return segs[segs.length - 1];
    };
    for (let y = 0; y < H; y++) {
      const d3 = ray2(nx, ((y + 0.5) / H) * 2 - 1);
      const th = Math.asin(Math.max(-1, Math.min(1, d3[1]))) * 180 / Math.PI;
      const sg = pick(th);
      px2.push(sg === null ? null : { t: sg.t, d: +sg.d.toFixed(1),
        elev: +sg.elev.toFixed(2), slope: +sg.slope.toFixed(4) });
    }
  }
  const 경사표본 = px2.filter(o => o && o.t === 'land' && o.elev > 2).map(o => o.slope);
  경사표본.sort((a, b) => a - b);
  console.log(`기복 시야(${REL_AZ}°) 뭍 화소 ${경사표본.length} · 경사 중앙 ${경사표본.length?경사표본[경사표본.length>>1].toFixed(3):'-'} · p90 ${경사표본.length?경사표본[Math.floor(경사표본.length*0.9)].toFixed(3):'-'}`);

  const 유효 = 포말폭.filter((w, i) => w > 0 && 해안경사[i] !== null).length;
  console.log(`화소 ${px.length} · 땅 ${px.filter(p=>p&&p.t==='land').length} · 물 ${px.filter(p=>p&&p.t==='sea').length}`);
  console.log(`포말 열 ${포말폭.filter(w=>w>0).length} · 경사와 함께 쓸 수 있는 열 ${유효}`);

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
 body{margin:0;background:#0b0f15;font-family:sans-serif;color:#dde}
 #wrap{padding:12px;width:900px} h3{font-size:14px;margin:6px 0}
 canvas{border:1px solid #345;margin:4px} p{font:11px monospace}
</style></head><body>
<div id="wrap"><h3>물가와 땅색 — 수심·경사·공기원근</h3>
<div id="shots"></div><div id="out"></div></div>
<script type="module">
import * as THREE from './app/vendor/three.module.js';
import { loadDemPatch } from './app/utils/demTiles.js';
import { createTerrainField, updateTerrainFieldEye } from './app/components/SkyScene3D/TerrainField.js';
import { createSeaPlane, updateSeaPlaneEye } from './app/components/SkyScene3D/SeaPlane.js';

const errors=[]; const oe=console.error; console.error=(...a)=>{errors.push(a.join(' ')); oe(...a);};
window.addEventListener('error', e=>errors.push(String(e.message)));

const LAT=${LAT}, LON=${LON}, BLOCK=${BLOCK}, FAR=${FIELD_FAR_M}, EYE=${EYE_M};
const CAM_AZ=${CAM_AZ}, FOV=${FOV_DEG}, PITCH=${PITCH_DEG}, W=${W}, H=${H};
const PX=${JSON.stringify(px)};
const PX2=${JSON.stringify(px2)};
const REL_AZ=${REL_AZ}, REL_FOV=${REL_FOV}, REL_PITCH=${REL_PITCH};
// ⚠ 공기원근의 끝값은 **지평선 하늘빛**입니다. 처음에 지면과 비슷한
//   (0.05,0.06,0.09) 를 넣었더니 섞어도 색이 안 변해 효과가 0 으로
//   측정됐습니다. 측정이 아니라 장면 설정이 틀렸던 것입니다.
//   지면은 조도의 20% 쯤(알베도)만 되쏘므로 하늘이 몇 배 밝습니다 —
//   먼 지형이 창백해지는 이유가 바로 그 대비입니다.
const HAZE=[1.10,1.25,1.60];

const canvas=document.createElement('canvas'); canvas.width=W; canvas.height=H;
const renderer=new THREE.WebGLRenderer({canvas, antialias:false, alpha:true});
renderer.setPixelRatio(1); renderer.setSize(W,H,false); renderer.setClearColor(0x000000,0);

const loadTexture=(u)=>new Promise((res,rej)=>{ new THREE.TextureLoader().load(u,res,undefined,rej); });
const patch=await loadDemPatch(LAT,LON,FAR,{renderer,loadTexture,block:BLOCK,
  tileUrl:(z,x,y)=>\`./dem/\${z}_\${x}_\${y}.png\`});

let 결과=null;
if (patch){
  const land=createTerrainField({patch, eyeHeightM:EYE});
  const sea=createSeaPlane({patch, eyeHeightM:EYE});
  // 낮 조건. 조도는 하늘 몫만 — 방향 조명을 빼면 색 차이가 알베도에서만 옵니다.
  for (const m of [land.material, sea.material]){
    // ⚠ 조도를 (0.30,0.33,0.40) 으로 뒀다가 **지면이 통째로 표시 하한
    //   (atm_display_ground 의 minGlow) 에 눌렸습니다.** 그러면 경사도
    //   젖은 모래도 전부 같은 색이 되어 상관이 0 이 나옵니다 — 땅이
    //   판지처럼 보이는 바로 그 증상입니다.
    //   맑은 낮 수평면 조도는 그보다 훨씬 큽니다. 방향 조명을 빼고
    //   (알베도만 보려고) 총량을 현실적인 값으로 올립니다.
    m.uniforms.uSurfaceIrr.value.set(1.20,1.26,1.38);
    m.uniforms.uSunAltDeg.value=35;
    m.uniforms.uHazeRadiance.value.set(HAZE[0],HAZE[1],HAZE[2]);
  }
  land.material.uniforms.uSunRadiance.value.set(0,0,0);

  const scene=new THREE.Scene(); scene.add(sea.mesh); scene.add(land.mesh);
  const cam=new THREE.PerspectiveCamera(FOV,W/H,0.1,2000); cam.position.set(0,0,0);
  updateTerrainFieldEye(land,cam); updateSeaPlaneEye(sea,cam);
  const ar=CAM_AZ*Math.PI/180, pr=PITCH*Math.PI/180;
  cam.up.set(0,1,0);
  cam.lookAt(Math.cos(pr)*Math.sin(ar), Math.sin(pr), -Math.cos(pr)*Math.cos(ar));
  cam.updateMatrixWorld(true);
  // ⚠ 세로 화각이 FOV 가 되도록 aspect 를 W/H 로 뒀습니다. CPU 쪽 광선도
  //   같은 규약(tanV 는 세로, 가로는 tanV·aspect)이어야 합니다.
  cam.aspect=W/H; cam.updateProjectionMatrix();

  const rt=new THREE.WebGLRenderTarget(W,H,{format:THREE.RGBAFormat,
    type:THREE.UnsignedByteType,minFilter:THREE.NearestFilter,
    magFilter:THREE.NearestFilter,depthBuffer:true});
  const buf=new Uint8Array(W*H*4);
  const shoot=()=>{ renderer.setRenderTarget(rt); renderer.clear(); renderer.render(scene,cam);
    renderer.readRenderTargetPixels(rt,0,0,W,H,buf); renderer.setRenderTarget(null);
    renderer.render(scene,cam); return buf.slice(); };

  const withAerial=shoot();
  { const c=document.createElement('canvas'); c.width=W;c.height=H;
    c.getContext('2d').drawImage(canvas,0,0); document.getElementById('shots').appendChild(c); }
  land.material.uniforms.uAerial.value=0; sea.material.uniforms.uAerial.value=0;
  const noAerial=shoot();
  { const c=document.createElement('canvas'); c.width=W;c.height=H;
    c.getContext('2d').drawImage(canvas,0,0); document.getElementById('shots').appendChild(c); }
  // 대조: 뿌연 날(β 0.5). 공기원근이 정말 대기 변수에 물려 있으면 여기서
  // 차이가 크게 벌어져야 합니다. 3km 안에서 맑은 날 효과는 원래 몇 % 뿐입니다.
  land.material.uniforms.uAerial.value=1; sea.material.uniforms.uAerial.value=1;
  land.material.uniforms.uBeta.value=0.5; sea.material.uniforms.uBeta.value=0.5;
  const hazy=shoot();
  land.material.uniforms.uBeta.value=0.08; sea.material.uniforms.uBeta.value=0.08;
  land.material.uniforms.uAerial.value=0; sea.material.uniforms.uAerial.value=0;

  const lum=(b,i)=>0.2126*b[i]+0.7152*b[i+1]+0.0722*b[i+2];
  // ⚠ readRenderTargetPixels 는 **아래에서 위로** 옵니다. CPU 격자도 y=0 이
  //   ny=−1, 즉 아래입니다. 그러니 그대로 y*W+x 입니다.
  //   여기를 (H−1−y) 로 뒤집어 두는 바람에 **위아래가 뒤집힌 그림**과
  //   견주고 있었습니다 — 가장 얕은 물(수심 0~0.25m)이 가장 어둡게
  //   나오는 이상한 결과가 그 증상이었습니다.
  const at=(b,x,y)=>{ const i=(y*W+x)*4; return [b[i],b[i+1],b[i+2],b[i+3]]; };
  const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:null;
  const corr=(a,b)=>{ if(a.length<3) return null;
    const ma=mean(a),mb=mean(b); let n=0,da=0,db=0;
    for(let i=0;i<a.length;i++){n+=(a[i]-ma)*(b[i]-mb);da+=(a[i]-ma)**2;db+=(b[i]-mb)**2;}
    return (da<=0||db<=0)?null:n/Math.sqrt(da*db); };

  // ── ① 물빛이 **수심**을 따르는가 ────────────────────────────────────────
  // ⚠ 문턱으로 "포말 화소"를 골라 폭을 재려다 두 번 실패했습니다:
  //    화소로 재면 거리가 1/d² 로 섞이고(경사와 상관이 +0.40 — 물리와 반대
  //    부호), 미터로 고쳐도 문턱이 고르는 등수심선이 제멋대로라 상관이 0 이
  //    됐습니다. 문턱을 아예 쓰지 않는 쪽으로 바꿉니다.
  //
  //    핵심 주장은 "물가의 **모습이 수심의 함수**"입니다. 그러면 수심으로
  //    묶었을 때 밝기가 단조롭게 변하고, **같은 수심 안에서 거리로 묶으면
  //    거의 안 변해야** 합니다. 그게 "거리가 아니라 수심으로 잰다"의 뜻입니다.
  const 수심대=[[0,0.25],[0.25,0.5],[0.5,1],[1,2],[2,5],[5,900],[900,1e9]];
  const 수심응답=수심대.map(([lo,hi])=>{
    const v=[];
    for (let x=0;x<W;x++) for (let y=0;y<H;y++){
      const p=PX[x*H+y]; if(!p||p.t!=='sea'||p.depth<lo||p.depth>=hi) continue;
      const c=at(withAerial,x,y); if(c[3]<=128) continue;
      v.push(0.2126*c[0]+0.7152*c[1]+0.0722*c[2]);
    }
    return {수심:[lo,hi], n:v.length, 밝기:mean(v)===null?null:+mean(v).toFixed(2)};
  });
  // 대조: 수심 0.5~2m 만 골라 **거리**로 묶습니다. 여기서는 거의 평평해야 합니다.
  const 거리대조=[[0,150],[150,400],[400,1000],[1000,3000]].map(([lo,hi])=>{
    const v=[];
    for (let x=0;x<W;x++) for (let y=0;y<H;y++){
      const p=PX[x*H+y];
      if(!p||p.t!=='sea'||p.depth<0.5||p.depth>=2||p.d<lo||p.d>=hi) continue;
      const c=at(withAerial,x,y); if(c[3]<=128) continue;
      v.push(0.2126*c[0]+0.7152*c[1]+0.0722*c[2]);
    }
    return {거리:[lo,hi], n:v.length, 밝기:mean(v)===null?null:+mean(v).toFixed(2)};
  });

  // ── ② 공기원근 ──────────────────────────────────────────────────────────
  // ⚠ 거리대별 "하늘과의 차"를 그냥 재면 안 됩니다 — 거리대마다 **다른 지형**
  //   이라 그 차이가 섞입니다 (실제로 0~200m 42.1 대 600~1500m 59.3 으로
  //   거꾸로 나왔습니다). **같은 화소**에서 켬/끔을 견줘야 합니다.
  const 거리대=[[0,200],[200,600],[600,1500],[1500,3000]];
  const 켬끔차=(bA,bB)=>거리대.map(([lo,hi])=>{
    const v=[];
    for (let x=0;x<W;x++) for (let y=0;y<H;y++){
      const p=PX[x*H+y]; if(!p||p.t!=='land'||p.d<lo||p.d>=hi) continue;
      const ca=at(bA,x,y), cb=at(bB,x,y);
      if(ca[3]<=128||cb[3]<=128) continue;
      v.push(Math.abs(0.2126*(ca[0]-cb[0])+0.7152*(ca[1]-cb[1])+0.0722*(ca[2]-cb[2])));
    }
    return {구간:[lo,hi], n:v.length, 차:mean(v)===null?null:+mean(v).toFixed(3)};
  });

  // ── ③ 경사 알베도: 색조(파랑/빨강) 대 CPU 경사 ─────────────────────────
  // ⚠ 물가 시야에는 급사면이 없어 상관이 0 이 나왔습니다. 기복이 있는 쪽을
  //    따로 찍어 봅니다 (공기원근은 끈 상태 — 색조를 흐리지 않게).
  cam.fov=REL_FOV; cam.updateProjectionMatrix();
  const ar2=REL_AZ*Math.PI/180, pr2=REL_PITCH*Math.PI/180;
  cam.up.set(0,1,0);
  cam.lookAt(Math.cos(pr2)*Math.sin(ar2), Math.sin(pr2), -Math.cos(pr2)*Math.cos(ar2));
  cam.updateMatrixWorld(true);
  const relief=shoot();
  { const c=document.createElement('canvas'); c.width=W;c.height=H;
    c.getContext('2d').drawImage(canvas,0,0); document.getElementById('shots').appendChild(c); }

  const sl=[], hue=[];
  for (let x=0;x<W;x++) for (let y=0;y<H;y++){
    const p=PX2[x*H+y];
    if(!p||p.t!=='land'||p.d>2500||p.elev<=2) continue;   // 조간대는 뺍니다
    const c=at(relief,x,y); if(c[3]<=128||c[0]<6) continue;
    sl.push(p.slope); hue.push(c[2]/Math.max(1,c[0]));
  }
  const 뒤섞음=sl.slice(); for(let i=뒤섞음.length-1;i>0;i--){
    const j=(i*1103515245+12345)%(i+1); const t2=뒤섞음[i];뒤섞음[i]=뒤섞음[j];뒤섞음[j]=t2; }

  // ── ④ 젖은 모래 ─────────────────────────────────────────────────────────
  const 젖음=[], 마름=[];
  for (let x=0;x<W;x++) for (let y=0;y<H;y++){
    const p=PX[x*H+y]; if(!p||p.t!=='land'||p.d>1200) continue;
    const c=at(noAerial,x,y); if(c[3]<=128) continue;
    const L=0.2126*c[0]+0.7152*c[1]+0.0722*c[2];
    if (p.elev>0 && p.elev<1.0) 젖음.push(L);
    else if (p.elev>=2.0 && p.elev<6.0) 마름.push(L);
  }

  // ── 대조 ⓪ 등록: CPU 가 말하는 땅/물과 화면이 맞는가 ────────────────────
  // 이 하네스는 "자리는 CPU, 색은 화면"으로 재므로, 둘이 안 맞으면 나머지가
  // 전부 무의미합니다. 4단계에서 검증된 기하이니 여기서는 **등록**만 봅니다.
  // ⚠ 색으로 종류를 되짚으면 안 됩니다 — 얕은 물은 바닥이 비쳐 모래색이라
  //   "파랑 > 빨강" 같은 판별이 무너집니다(처음에 그렇게 했다가 일치율
  //   0.3585 가 나왔는데, 등록이 아니라 판별식이 틀린 것이었습니다).
  //   색과 무관한 **실루엣**으로 봅니다: 각 열에서 하늘이 끝나는 자리가
  //   CPU 가 말하는 맨 위 표면과 같은가.
  let 등록맞음=0, 등록틀림=0; const 실루엣차=[];
  for (let x=0;x<W;x++){
    let top=-1;
    for (let y=H-1;y>=0;y--){ if (at(noAerial,x,y)[3]>128){ top=y; break; } }
    let ref=-1;
    for (let y=H-1;y>=0;y--){ if (PX[x*H+y]){ ref=y; break; } }
    if (top<0||ref<0) continue;
    실루엣차.push(Math.abs(top-ref));
    if (Math.abs(top-ref)<=2) 등록맞음++; else 등록틀림++;
  }

  결과={
    등록: { 열:등록맞음+등록틀림, 맞음:등록맞음,
      일치율:+(등록맞음/Math.max(1,등록맞음+등록틀림)).toFixed(4),
      실루엣차중앙: 실루엣차.length?실루엣차.sort((a,b)=>a-b)[실루엣차.length>>1]:null,
      실루엣차최대: 실루엣차.length?실루엣차[실루엣차.length-1]:null },
    수심응답, 거리대조,
    띠폭: ${JSON.stringify(띠폭)},
    공기원근: { 맑은날: 켬끔차(withAerial, noAerial), 뿌연날: 켬끔차(hazy, noAerial) },
    경사알베도: { 표본:sl.length,
      경사범위: sl.length?[+Math.min(...sl).toFixed(4),+Math.max(...sl).toFixed(4)]:null,
      색조범위: hue.length?[+Math.min(...hue).toFixed(4),+Math.max(...hue).toFixed(4)]:null,
      색조평균: hue.length?+mean(hue).toFixed(4):null,
      // 경사 상·하위 사분위의 색조 평균 — 상관보다 읽기 쉽습니다.
      색조_완만: (()=>{const i=sl.map((v,k)=>[v,k]).sort((a,b)=>a[0]-b[0]);
        const q=i.slice(0,Math.max(1,i.length>>2)).map(o=>hue[o[1]]);
        return +mean(q).toFixed(4);})(),
      색조_급함: (()=>{const i=sl.map((v,k)=>[v,k]).sort((a,b)=>a[0]-b[0]);
        const q=i.slice(-Math.max(1,i.length>>2)).map(o=>hue[o[1]]);
        return +mean(q).toFixed(4);})(),
      상관: corr(sl,hue)===null?null:+corr(sl,hue).toFixed(4),
      귀무: corr(뒤섞음,hue)===null?null:+corr(뒤섞음,hue).toFixed(4) },
    젖은모래: { 젖음n:젖음.length, 마름n:마름.length,
      젖음:mean(젖음)===null?null:+mean(젖음).toFixed(2),
      마름:mean(마름)===null?null:+mean(마름).toFixed(2) },
  };
  document.getElementById('out').innerHTML='<p>수심 0~0.25m '
    +결과.수심응답[0].밝기+' → 깊은 물 '+결과.수심응답[5].밝기
    +' · 띠폭 대 1/경사 '+결과.띠폭.상관_폭대역경사
    +' · 경사 상관 '+결과.경사알베도.상관+' (귀무 '+결과.경사알베도.귀무+')'
    +' · 젖음 '+결과.젖은모래.젖음+' 대 마름 '+결과.젖은모래.마름+'</p>';
}
window.__stats={ glError: renderer.getContext().getError(), 결과 };
window.__errors=errors;
document.title='DONE::'+(errors.length?'ERR':'OK')+'::'+renderer.getContext().getError();
</script></body></html>`;

  fs.mkdirSync(PREVIEW, { recursive: true });
  fs.writeFileSync(path.join(PREVIEW, 'shore.html'), html);
  console.log('생성 완료: shore.html');
})();
