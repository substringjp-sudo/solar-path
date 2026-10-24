/**
 * **물가 근처를 칠하는 값(`dem_shoreField`)이 맞는가** (§156 — `src/utils/demTiles.ts`).
 *
 * 지형·해수면은 젖은 띠·수심·바닥 기울기(포말 폭)를 정점 보간이 아니라 화소마다 자료에서 읽은 **흐린 고도**(열여섯 화소의
 * 3차 B-스플라인)와 그 기울기로 칠합니다. 값이 틀리면 갯벌의 젖은 띠·포말이 엉뚱한 자리에 서고(좌표·방향 규약, 스플라인
 * 가중치), 눈으로는 못 잡습니다 — 갯벌은 어떤 모양이어도 "그럴듯"합니다. 그래서 GPU 값을 Node 가 PNG 를 직접 풀어
 * **따로** 구현한 참조(dem-cpu.js)와 견줍니다.
 *
 * 표본의 절반은 **해안선 근처**(참조의 흐린 고도가 −0.3~0.6m)에서 뽑습니다 — 평지에서는 방향·가중치가 틀려도 안 보입니다.
 *
 * 대조: 같은 참조를 동·남을 바꿔 읽으면 크게 어긋나야 합니다(어긋나지 않으면 이 자가 방향에 눈먼 것).
 *
 * 사용: node tools/shader-preview/build-shore-frag.js
 *       node tools/shader-preview/stage-esm.js
 *       node tools/shader-preview/verify-shore-frag.js
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const { PREVIEW } = require('./paths');
const D = require('./dem-cpu');

const BLOCK = 3, NEAR_R = 3000, MAP_N = 512, HALF_M = 1400;
const SITES = [
  // 서해 갯벌과 물길 — 고도 0 근처의 잔 값(±0.01m)이 있는 평탄한 물가(화소 분류가 하는 일을 본다).
  { key: '대부도', lat: 37.24102, lon: 126.55969, dir: 'dem' },
  // 만 안쪽 갯벌·갈대밭 — 줄무늬 잡음이 가장 센 곳.
  { key: '순천만', lat: 34.87776, lon: 127.51041, dir: 'dem-suncheon' },
];
const SAMPLES = 400;

const get = (u) => new Promise((res, rej) => {
  https.get(u, r => {
    if (r.statusCode !== 200) { rej(new Error('HTTP ' + r.statusCode)); r.resume(); return; }
    const c = []; r.on('data', d => c.push(d)); r.on('end', () => res(Buffer.concat(c)));
  }).on('error', rej);
});

/** 셰이더(dem_shoreField)와 같은 식 — 독립 구현. 반환 { hs, hb, gx, gy }. */
function cpuShore(dem, e, s, swapAxes) {
  const [E, S] = swapAxes ? [s, e] : [e, s];
  const c = dem.cell(E, S);
  const v = [];
  for (let dy = -1; dy <= 2; dy++) for (let dx = -1; dx <= 2; dx++) v.push(dem.texel(c.x0 + dx, c.y0 + dy));
  if (v.some(x => x === null)) return null;
  const at = (dx, dy) => v[(dy + 1) * 4 + (dx + 1)];
  const hb = at(0, 0) * (1 - c.ax) * (1 - c.ay) + at(1, 0) * c.ax * (1 - c.ay) + at(0, 1) * (1 - c.ax) * c.ay + at(1, 1) * c.ax * c.ay;
  const bs = (t) => {
    const t2 = t * t, t3 = t2 * t;
    return [(1 - 3 * t + 3 * t2 - t3) / 6, (4 - 6 * t2 + 3 * t3) / 6, (1 + 3 * t + 3 * t2 - 3 * t3) / 6, t3 / 6];
  };
  const dbs = (t) => {
    const t2 = t * t;
    return [(-3 + 6 * t - 3 * t2) / 6, (-12 * t + 9 * t2) / 6, (3 + 6 * t - 9 * t2) / 6, (3 * t2) / 6];
  };
  const wx = bs(c.ax), wy = bs(c.ay), dwx = dbs(c.ax), dwy = dbs(c.ay);
  let hs = 0, gx = 0, gy = 0;
  for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
    const h = at(i - 1, j - 1);
    hs += wy[j] * wx[i] * h;
    gx += wy[j] * dwx[i] * h;
    gy += dwy[j] * wx[i] * h;
  }
  const texelM = dem.tileSpanM / 256;
  return { hs, hb, gx: gx / texelM, gy: gy / texelM };
}

(async () => {
  const prepared = [];
  let seed = 424242;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (const s of SITES) {
    const zoom = D.demZoomForRadius(NEAR_R, s.lat, BLOCK);
    const t = D.lonLatToTileFloat(s.lon, s.lat, zoom);
    const { originX, originY } = D.pickBlockOrigin(t.x, t.y, BLOCK);
    const demDir = path.join(PREVIEW, s.dir);
    fs.mkdirSync(demDir, { recursive: true });
    for (let dy = 0; dy < BLOCK; dy++) for (let dx = 0; dx < BLOCK; dx++) {
      const f = path.join(demDir, `${zoom}_${originX + dx}_${originY + dy}.png`);
      if (!fs.existsSync(f)) fs.writeFileSync(f, await get(
        `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${zoom}/${originX + dx}/${originY + dy}.png`));
    }
    const dem = D.makeCpuDem({ demDir, zoom, lat: s.lat, lon: s.lon });
    const pts = [];
    let tries = 0;
    while (pts.length < SAMPLES && tries++ < 400000) {
      const i = Math.floor(rnd() * MAP_N), j = Math.floor(rnd() * MAP_N);
      const e = ((i + 0.5) / MAP_N - 0.5) * 2 * HALF_M, so = ((j + 0.5) / MAP_N - 0.5) * 2 * HALF_M;
      const r = cpuShore(dem, e, so, false);
      if (!r) continue;
      const nearShore = r.hs > -0.3 && r.hs < 0.6;
      if (pts.length % 2 === 0 && !nearShore) continue;   // 짝수 번째는 해안선 근처만
      const sw = cpuShore(dem, e, so, true);
      pts.push({ i, j, hs: +r.hs.toFixed(6), hb: +r.hb.toFixed(6), gx: +r.gx.toFixed(7), gy: +r.gy.toFixed(7),
        swHs: sw ? +sw.hs.toFixed(6) : r.hs });
    }
    if (pts.length < SAMPLES) throw new Error(s.key + ': 표본 모자람 ' + pts.length);
    const nearN = pts.filter(p => p.hs > -0.3 && p.hs < 0.6).length;
    console.log(`${s.key}: 줌 ${zoom} · 표본 ${pts.length} · 해안선 근처 ${nearN} · 흐린 고도와 쌍선형 고도의 차 최대 ${Math.max(...pts.map(p => Math.abs(p.hs - p.hb))).toFixed(3)}m`);
    prepared.push({ ...s, zoom, pts });
  }

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>body{margin:0;background:#0b0f15;color:#dde;font:11px monospace;padding:10px}</style></head><body>
<div id="out">재는 중…</div>
<script type="module">
import * as THREE from './app/vendor/three.module.js';
import { loadDemPatch, clearDemCache, makeDemUniforms, DEM_GLSL } from './app/utils/demTiles.js';

const errors=[]; const oe=console.error; console.error=(...a)=>{errors.push(a.join(' ')); oe(...a);};
window.addEventListener('error', e=>errors.push(String(e.message)));
const SITES=${JSON.stringify(prepared)};
const BLOCK=${BLOCK}, NEAR_R=${NEAR_R}, N=${MAP_N}, HALF=${HALF_M};

const canvas=document.createElement('canvas'); canvas.width=64; canvas.height=64;
const renderer=new THREE.WebGLRenderer({canvas, antialias:false, alpha:false});
const loadTexture=(u)=>new Promise((res,rej)=>new THREE.TextureLoader().load(u,res,undefined,rej));

const FRAG=\`
precision highp float;
\${DEM_GLSL}
uniform float uMapN; uniform float uHalf;
void main() {
  vec2 g = (gl_FragCoord.xy / uMapN - 0.5) * 2.0 * uHalf;
  float hb; vec2 gr;
  float hs = dem_shoreField(g, hb, gr);
  gl_FragColor = vec4(hs, hb, gr.x, gr.y);
}\`;

const 결과={};
for (const site of SITES) {
  clearDemCache();
  const patch=await loadDemPatch(site.lat, site.lon, NEAR_R, {renderer, loadTexture, block:BLOCK,
    tileUrl:(z,x,y)=>\`./\${site.dir}/\${z}_\${x}_\${y}.png\`});
  if (!patch) { errors.push(site.key+' 패치 없음'); continue; }
  const mat=new THREE.ShaderMaterial({
    uniforms:{...makeDemUniforms(patch), uMapN:{value:N}, uHalf:{value:HALF}},
    vertexShader:'void main(){ gl_Position=vec4(position.xy,0.0,1.0); }', fragmentShader:FRAG,
    depthTest:false, depthWrite:false, blending:THREE.NoBlending });
  const rt=new THREE.WebGLRenderTarget(N,N,{format:THREE.RGBAFormat,type:THREE.FloatType,minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter,depthBuffer:false});
  const scene=new THREE.Scene(); const quad=new THREE.Mesh(new THREE.PlaneGeometry(2,2),mat); quad.frustumCulled=false; scene.add(quad);
  const cam=new THREE.OrthographicCamera(-1,1,1,-1,0,1);
  const t0=performance.now();
  renderer.setRenderTarget(rt); renderer.render(scene,cam); renderer.setRenderTarget(null);
  const buf=new Float32Array(N*N*4); renderer.readRenderTargetPixels(rt,0,0,N,N,buf);
  const ms=performance.now()-t0;
  const rows=site.pts.map(p=>{ const o=(p.j*N+p.i)*4; return { hs:buf[o], hb:buf[o+1], gx:buf[o+2], gy:buf[o+3], c:p }; });
  const mean=a=>a.reduce((x,y)=>x+y,0)/a.length;
  const eS=rows.map(r=>Math.abs(r.hs-r.c.hs)), eB=rows.map(r=>Math.abs(r.hb-r.c.hb));
  const eG=rows.map(r=>Math.max(Math.abs(r.gx-r.c.gx),Math.abs(r.gy-r.c.gy)));
  const eW=rows.map(r=>Math.abs(r.hs-r.c.swHs));
  const near=rows.filter(r=>r.c.hs>-0.3&&r.c.hs<0.6);
  결과[site.key]={
    표본:rows.length, 해안선근처:near.length, ms:+ms.toFixed(0),
    흐린고도평균오차:+mean(eS).toFixed(5), 흐린고도최대오차:+Math.max(...eS).toFixed(5),
    쌍선형평균오차:+mean(eB).toFixed(5), 쌍선형최대오차:+Math.max(...eB).toFixed(5),
    기울기평균오차:+mean(eG).toFixed(6), 기울기최대오차:+Math.max(...eG).toFixed(6),
    대조평균오차:+mean(eW).toFixed(5),
    // 흐리기가 실제로 일하는지 — 참조의 흐린 고도와 쌍선형 고도가 얼마나 다른가(m)
    흐림차최대:+Math.max(...site.pts.map(p=>Math.abs(p.hs-p.hb))).toFixed(4),
  };
  rt.dispose(); mat.dispose(); quad.geometry.dispose();
}
document.getElementById('out').textContent=JSON.stringify(결과);
window.__stats={ glError: renderer.getContext().getError(), 결과 };
window.__errors=errors;
document.title='DONE::'+(errors.length?'ERR':'OK')+'::'+renderer.getContext().getError();
</script></body></html>`;

  fs.mkdirSync(PREVIEW, { recursive: true });
  fs.writeFileSync(path.join(PREVIEW, 'shore-frag.html'), html);
  console.log('생성 완료: shore-frag.html');
})();
