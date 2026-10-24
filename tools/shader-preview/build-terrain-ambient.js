/**
 * **DEM 에서 굽는 하늘 보임(AO)이 맞는가** (§157 — `terrainAmbient.ts`).
 *
 * 지형 빛 판의 하늘빛 몫은 화소마다 DEM 을 훑지 않고 **패치가 바뀔 때 한 번 구운 맵**에서 읽습니다. 맵이 틀리면
 * 화면의 형태 단서가 통째로 틀립니다(언덕이 어둡고 골이 밝게). 그래서 맵 화소 몇백 개를 CPU 로 **따로** 구한 값과
 * 견줍니다 — 같은 식(8방위 지평선 앙각 → 평균 cos²)을 Node 가 PNG 를 직접 풀어 구현하므로(dem-cpu.js) 셰이더의
 * 좌표 변환·디코드·방향 규약이 틀리면 여기서 어긋납니다.
 *
 * 표본은 블록 **안쪽**(관측자에서 2.3km 이내)에서만 고릅니다 — 지평선 훑기가 1.5km 까지 뻗으므로 가장자리 근처는
 * 셰이더가 가장자리 값을 늘려 쓰는 반면 CPU 쪽은 자료 밖이라 달라지는 것이 정상입니다.
 *
 * 사용: node tools/shader-preview/build-terrain-ambient.js
 *       node tools/shader-preview/verify-terrain-ambient.js
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const { PREVIEW } = require('./paths');
const D = require('./dem-cpu');

const N = 384, BLOCK = 3, NEAR_R = 3000;
const SITES = [
  // 화산 분석구가 1km 앞에 선 해안 — 사면·골이 많습니다.
  { key: '성산', lat: 33.4580, lon: 126.9300, dir: 'dem-seongsan' },
  // 서해 갯벌과 낮은 구릉 — 평평한 땅이 많습니다(대조).
  { key: '대부도', lat: 37.24102, lon: 126.55969, dir: 'dem' },
];
const SAMPLES = 360;
const REACH = 1500;

const get = (u) => new Promise((res, rej) => {
  https.get(u, r => {
    if (r.statusCode !== 200) { rej(new Error('HTTP ' + r.statusCode)); r.resume(); return; }
    const c = []; r.on('data', d => c.push(d)); r.on('end', () => res(Buffer.concat(c)));
  }).on('error', rej);
});

/** 셰이더(BAKE_FRAG)와 같은 식 — 독립 구현. g = (동, 남) m. */
function cpuAmbient(elev, e, s, swapAxes) {
  const E = (x, y) => (swapAxes ? elev(y, x) : elev(x, y));
  const h0 = E(e, s);
  let sum = 0;
  for (let i = 0; i < 8; i++) {
    const a = (i + 0.5) * Math.PI / 4;
    const de = Math.cos(a), ds = Math.sin(a);
    let best = 0;
    for (let j = 0; j < 11; j++) {
      const t = 15 * Math.pow(REACH / 15, j / 10);
      best = Math.max(best, (E(e + de * t, s + ds * t) - h0) / t);
    }
    sum += 1 / (1 + best * best);
  }
  const m = 0.25 * (E(e + 60, s) + E(e - 60, s) + E(e, s + 60) + E(e, s - 60));
  return { V: sum / 8, convex: Math.min(1, Math.max(0, 0.5 + 0.5 * (h0 - m) / 6)) };
}

(async () => {
  const prepared = [];
  let seed = 12345;
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
    const span = D.tileSpanMetres(zoom, s.lat);
    const obsU = t.x - originX, obsV = t.y - originY;
    const pts = [];
    // 안쪽 반경 2.3km 안에서 무작위(고정 시드) 표본 — 평지·사면이 섞이도록 높이 변화가 있는 곳을 절반 섞습니다.
    while (pts.length < SAMPLES) {
      const i = Math.floor(rnd() * N), j = Math.floor(rnd() * N);
      const e = (((i + 0.5) / N) * BLOCK - obsU) * span, so = (((j + 0.5) / N) * BLOCK - obsV) * span;
      if (Math.hypot(e, so) > 2300) continue;
      const r = cpuAmbient(dem.elevAtGround, e, so, false);
      if (pts.length % 2 === 1 && r.V > 0.995) continue;   // 홀수 번째는 하늘이 가려진 곳으로(자가 평지에만 맞추지 못하게)
      const sw = cpuAmbient(dem.elevAtGround, e, so, true);  // 대조: 동·남을 바꿔 읽은 값
      pts.push({ i, j, V: +r.V.toFixed(5), convex: +r.convex.toFixed(5), swV: +sw.V.toFixed(5) });
    }
    const Vs = pts.map(p => p.V);
    console.log(`${s.key}: 줌 ${zoom} · 표본 ${pts.length} · V 최소 ${Math.min(...Vs).toFixed(3)} · 중앙 ${[...Vs].sort((a, b) => a - b)[Vs.length >> 1].toFixed(3)} · V<0.9 ${Vs.filter(v => v < 0.9).length}개`);
    prepared.push({ ...s, zoom, pts });
  }

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>body{margin:0;background:#0b0f15;color:#dde;font:11px monospace;padding:10px}</style></head><body>
<div id="out">굽는 중…</div>
<script type="module">
import * as THREE from './app/vendor/three.module.js';
import { loadDemPatch, clearDemCache, makeDemUniforms } from './app/utils/demTiles.js';
import { createTerrainAmbientBake, AMBIENT_MAP_SIZE } from './app/components/SkyScene3D/terrainAmbient.js';

const errors=[]; const oe=console.error; console.error=(...a)=>{errors.push(a.join(' ')); oe(...a);};
window.addEventListener('error', e=>errors.push(String(e.message)));
const SITES=${JSON.stringify(prepared)};
const BLOCK=${BLOCK}, NEAR_R=${NEAR_R}, N=${N};

const canvas=document.createElement('canvas'); canvas.width=64; canvas.height=64;
const renderer=new THREE.WebGLRenderer({canvas, antialias:false, alpha:false});
const loadTexture=(u)=>new Promise((res,rej)=>new THREE.TextureLoader().load(u,res,undefined,rej));

const 결과={};
for (const site of SITES) {
  clearDemCache();
  const patch=await loadDemPatch(site.lat, site.lon, NEAR_R, {renderer, loadTexture, block:BLOCK,
    tileUrl:(z,x,y)=>\`./\${site.dir}/\${z}_\${x}_\${y}.png\`});
  if (!patch) { errors.push(site.key+' 패치 없음'); continue; }
  const bake=createTerrainAmbientBake();
  const t0=performance.now();
  const ok=bake.bake(renderer, makeDemUniforms(patch));
  const rt=bake.debugTarget();
  const buf=new Uint8Array(N*N*4);
  renderer.readRenderTargetPixels(rt,0,0,N,N,buf);
  const ms=performance.now()-t0;
  const again=bake.bake(renderer, makeDemUniforms(patch));   // 같은 패치면 다시 굽지 않아야 합니다(텍스처 같음 → true 만 돌려줌)
  const rows=site.pts.map(p=>{ const o=(p.j*N+p.i)*4; return { V:buf[o]/255, convex:buf[o+1]/255, cpuV:p.V, cpuConvex:p.convex, swV:p.swV }; });
  const mean=a=>a.reduce((x,y)=>x+y,0)/a.length;
  const err=rows.map(r=>Math.abs(r.V-r.cpuV)), errC=rows.map(r=>Math.abs(r.convex-r.cpuConvex)), errSw=rows.map(r=>Math.abs(r.V-r.swV));
  결과[site.key]={
    ok, again, size: AMBIENT_MAP_SIZE, 굽기ms:+ms.toFixed(0), 표본:rows.length,
    V평균오차:+mean(err).toFixed(4), V최대오차:+Math.max(...err).toFixed(4),
    볼록평균오차:+mean(errC).toFixed(4), 볼록최대오차:+Math.max(...errC).toFixed(4),
    대조평균오차:+mean(errSw).toFixed(4),
    GPU_V최소:+Math.min(...rows.map(r=>r.V)).toFixed(3), CPU_V최소:+Math.min(...rows.map(r=>r.cpuV)).toFixed(3),
    GPU_V작은개수: rows.filter(r=>r.V<0.9).length, CPU_V작은개수: rows.filter(r=>r.cpuV<0.9).length,
    평지일치: rows.filter(r=>r.cpuV>0.995).every(r=>r.V>0.985),
  };
  bake.dispose();
}
document.getElementById('out').textContent=JSON.stringify(결과);
window.__stats={ glError: renderer.getContext().getError(), 결과 };
window.__errors=errors;
document.title='DONE::'+(errors.length?'ERR':'OK')+'::'+renderer.getContext().getError();
</script></body></html>`;

  fs.mkdirSync(PREVIEW, { recursive: true });
  fs.writeFileSync(path.join(PREVIEW, 'terrain-ambient.html'), html);
  console.log('생성 완료: terrain-ambient.html');
})();
