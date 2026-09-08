/**
 * **DEM 타일이 진짜 고도를 주는가** (docs/COASTLINE_PLAN.md 1단계).
 *
 * AWS Terrain Tiles 를 받아 블록을 합치고, **셰이더의 `dem_elevationAt` 을
 * 그대로 통과시켜** 나온 고도를 참조 **둘**과 견줍니다.
 *
 *  ① **CPU 로 직접 디코드한 같은 타일** — 여기서 Node 가 PNG 를 풀어
 *     경위도→타일화소→쌍선형→Terrarium 을 **독립 구현**합니다. 같은 자료라
 *     맞으면 오차가 0 에 가까워야 합니다. 이게 배치·UV·감마를 잡는 날카로운
 *     시험입니다 (실제로 타일 줄이 뒤집힌 결함을 이걸로 잡았습니다).
 *  ② **Open-Meteo elevation API** — 완전히 다른 DEM. 자료끼리 봉우리에서
 *     20m 씩 어긋나는 게 정상이라 여기선 **상관과 치우침**만 봅니다.
 *     이걸 엄격한 기준으로 쓰면 남의 자료 차이를 우리 결함으로 읽게 됩니다.
 *
 * ⚠ 타일은 **미리 내려받아** preview 아래 둡니다. 브라우저가 S3 를 직접
 * 치게 하면 시험이 망 상태와 CORS 에 휘둘립니다.
 *
 * 사용: node tools/shader-preview/build-dem-check.js
 *       node tools/shader-preview/shoot.js dem-check.html dem-check.png 20000
 *       node tools/shader-preview/verify-dem.js
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const { PNG } = require('pngjs');
const { PREVIEW } = require('./paths');

/** 대부도 앞바다 — 육지와 바다가 같이 들어오는 곳 */
const LAT = 37.25, LON = 126.58;
const RADIUS_M = 3000;      // 이 반경을 덮는 줌을 고릅니다
const BLOCK = 3;            // 블록 한 변의 타일 수 (demTiles 의 기본값)
const N = 8;                // N×N 표본 (Open-Meteo 한 번에 100점 제한)

const EARTH_C = 40075016.686;
const tileSpanM = (z, lat) => (EARTH_C * Math.cos((lat * Math.PI) / 180)) / 2 ** z;
function lonLatToTileFloat(lon, lat, z) {
  const n = 2 ** z, r = (lat * Math.PI) / 180;
  return {
    x: ((lon + 180) / 360) * n,
    y: ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n,
  };
}
// ⚠ demTiles.ts 와 **같은 식** 이어야 합니다. 보장되는 여유는 블록 한 변이
// 아니라 (한 변 − 1) / 2 타일입니다.
function demZoomForRadius(radiusM, lat, block, maxZoom = 14) {
  const margin = (block - 1) / 2;
  for (let z = maxZoom; z >= 4; z--) if (tileSpanM(z, lat) * margin >= radiusM) return z;
  return 4;
}
function pickBlockOrigin(tx, ty, block) {
  const half = (block - 1) / 2;
  return { originX: Math.floor(tx) - half, originY: Math.floor(ty) - half };
}

const get = (url, binary) => new Promise((res, rej) => {
  https.get(url, r => {
    if (r.statusCode !== 200) { rej(new Error(`HTTP ${r.statusCode} ${url}`)); r.resume(); return; }
    const chunks = [];
    r.on('data', c => chunks.push(c));
    r.on('end', () => res(binary ? Buffer.concat(chunks) : Buffer.concat(chunks).toString('utf8')));
  }).on('error', rej);
});

(async () => {
  const zoom = demZoomForRadius(RADIUS_M, LAT, BLOCK);
  const span = tileSpanM(zoom, LAT);
  const t = lonLatToTileFloat(LON, LAT, zoom);
  const { originX, originY } = pickBlockOrigin(t.x, t.y, BLOCK);

  console.log(`줌 ${zoom} · 타일 한 변 ${span.toFixed(0)}m · 원점 타일 ${originX},${originY}`);
  console.log(`블록 ${BLOCK}×${BLOCK} · 관측자 블록 내 좌표 ${(t.x - originX).toFixed(3)}, ${(t.y - originY).toFixed(3)}`);
  console.log(`가장자리까지 여유 ${(((BLOCK - 1) / 2) * span).toFixed(0)}m (표본 반경 ${RADIUS_M}m)`);

  // 1. 타일들을 preview 아래로
  const demDir = path.join(PREVIEW, 'dem');
  fs.mkdirSync(demDir, { recursive: true });
  for (let dy = 0; dy < BLOCK; dy++) for (let dx = 0; dx < BLOCK; dx++) {
    const x = originX + dx, y = originY + dy;
    const buf = await get(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${zoom}/${x}/${y}.png`, true);
    fs.writeFileSync(path.join(demDir, `${zoom}_${x}_${y}.png`), buf);
    console.log(`  타일 ${zoom}/${x}/${y}  ${buf.length} bytes`);
  }

  // 2. 표본점의 경위도 — 씬 규약은 +x 동, +z 남.
  //    ⚠ 여기서 셰이더와 **같은 근사**를 씁니다: 타일 지상거리를 관측자
  //    위도에서 한 번만 구해 블록 전체에 적용합니다. 두 계산이 어긋나면
  //    판정이 근사 오차를 결함으로 잘못 읽습니다.
  const pts = [];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const east = -RADIUS_M + ((i + 0.5) / N) * 2 * RADIUS_M;
    const south = -RADIUS_M + ((j + 0.5) / N) * 2 * RADIUS_M;
    // 지상 m → 소수 타일 → 경위도 (셰이더의 dem_uv 와 같은 경로)
    const tx = t.x + east / span;
    const ty = t.y + south / span;
    const n = 2 ** zoom;
    const lon = (tx / n) * 360 - 180;
    const latRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * ty) / n)));
    pts.push({ east, south, lat: (latRad * 180) / Math.PI, lon });
  }

  // 3a. 같은 타일을 CPU 로 직접 풀어 참조를 만듭니다 (독립 구현).
  //     ⚠ GPU 와 같은 화소를 짚어야 합니다: 합친 텍스처의 texel 좌표는
  //     blockCoord·256 − 0.5 이고, 그건 전역 타일화소 tx·256 − 0.5 와 같습니다.
  const png = {};
  const pixel = (z, px, py) => {
    const tx = Math.floor(px / 256), ty = Math.floor(py / 256);
    const k = `${z}_${tx}_${ty}`;
    if (!png[k]) png[k] = PNG.sync.read(fs.readFileSync(path.join(demDir, k + '.png')));
    const o = ((py - ty * 256) * 256 + (px - tx * 256)) * 4;
    const d = png[k].data;
    return d[o] * 256 + d[o + 1] + d[o + 2] / 256 - 32768;
  };
  const cpuElev = (lon, lat) => {
    const q = lonLatToTileFloat(lon, lat, zoom);
    const gx = q.x * 256 - 0.5, gy = q.y * 256 - 0.5;
    const x0 = Math.floor(gx), y0 = Math.floor(gy);
    const fx = gx - x0, fy = gy - y0;
    return (
      pixel(zoom, x0, y0) * (1 - fx) * (1 - fy) +
      pixel(zoom, x0 + 1, y0) * fx * (1 - fy) +
      pixel(zoom, x0, y0 + 1) * (1 - fx) * fy +
      pixel(zoom, x0 + 1, y0 + 1) * fx * fy
    );
  };
  pts.forEach(p => { p.cpu = +cpuElev(p.lon, p.lat).toFixed(2); });
  console.log(`CPU 디코드 참조 ${pts.length}점  (${Math.min(...pts.map(p => p.cpu)).toFixed(1)} ~ ${Math.max(...pts.map(p => p.cpu)).toFixed(1)} m)`);

  // 3b. Open-Meteo 로 같은 지점의 고도
  const lats = pts.map(p => p.lat.toFixed(5)).join(',');
  const lons = pts.map(p => p.lon.toFixed(5)).join(',');
  const j = JSON.parse(await get(
    `https://api.open-meteo.com/v1/elevation?latitude=${lats}&longitude=${lons}`, false));
  if (!Array.isArray(j.elevation) || j.elevation.length !== pts.length) {
    throw new Error(`Open-Meteo 응답이 이상합니다: ${JSON.stringify(j).slice(0, 200)}`);
  }
  pts.forEach((p, k) => { p.ref = j.elevation[k]; });
  console.log(`Open-Meteo 고도 ${pts.length}점  (${Math.min(...pts.map(p => p.ref))} ~ ${Math.max(...pts.map(p => p.ref))} m)`);

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
 body{margin:0;background:#0b0f15;font-family:sans-serif;color:#dde}
 #wrap{padding:12px;width:900px} h3{font-size:14px;margin:6px 0}
 table{border-collapse:collapse;font:11px monospace;margin-top:10px}
 td,th{border:1px solid #345;padding:3px 8px;text-align:right}
 canvas{image-rendering:pixelated;border:1px solid #345;margin-top:8px}
</style></head><body>
<div id="wrap">
<h3>DEM 타일 — 셰이더가 뽑은 고도 대 Open-Meteo</h3>
<canvas id="c" width="512" height="512" style="width:256px;height:256px"></canvas>
<div id="tbl"></div></div>
<script type="module">
import * as THREE from './app/vendor/three.module.js';
import { DEM_GLSL, loadDemPatch, makeDemUniforms } from './app/utils/demTiles.js';

const errors=[]; const oe=console.error; console.error=(...a)=>{errors.push(a.join(' ')); oe(...a);};
const LAT=${LAT}, LON=${LON}, RADIUS_M=${RADIUS_M}, N=${N}, BLOCK=${BLOCK};
const PTS=${JSON.stringify(pts.map(p => ({ e: +p.east.toFixed(1), s: +p.south.toFixed(1), ref: p.ref, cpu: p.cpu })))};

const canvas=document.getElementById('c');
const renderer=new THREE.WebGLRenderer({canvas, antialias:false, alpha:false});
renderer.setPixelRatio(1); renderer.setSize(512,512,false);

// 미리 내려받은 로컬 타일을 씁니다.
const loadTexture = (url) => new Promise((res, rej) => {
  new THREE.TextureLoader().load(url, res, undefined, rej);
});
const patch = await loadDemPatch(LAT, LON, RADIUS_M, {
  renderer, loadTexture, block: BLOCK,
  tileUrl: (z,x,y) => \`./dem/\${z}_\${x}_\${y}.png\`,
});

let 결과 = null;
if (patch) {
  // 표본 격자를 셰이더로 뽑습니다 — dem_uv + dem_elevation 을 그대로 통과.
  const rt = new THREE.WebGLRenderTarget(N, N, {
    format: THREE.RGBAFormat, type: THREE.UnsignedByteType,
    minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
    depthBuffer: false, stencilBuffer: false,
  });
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...makeDemUniforms(patch), uN: { value: N }, uRadius: { value: RADIUS_M } },
    vertexShader: 'void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: DEM_GLSL + \`
      uniform float uN, uRadius;
      void main(){
        // 화소 → 지상 좌표 (빌드 스크립트의 격자와 같은 식)
        vec2 g = (gl_FragCoord.xy / uN) * 2.0 * uRadius - uRadius;
        float e = dem_elevationAt(g) + 32768.0;
        float hi = floor(e / 256.0);
        float lo = e - hi * 256.0;
        gl_FragColor = vec4(hi / 255.0, floor(lo) / 255.0, fract(lo), 1.0);
      }\`,
    depthTest: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2,2), mat);
  const sc = new THREE.Scene(); sc.add(quad);
  const cam = new THREE.Camera();
  renderer.setRenderTarget(rt); renderer.render(sc, cam);
  const buf = new Uint8Array(N*N*4);
  renderer.readRenderTargetPixels(rt, 0, 0, N, N, buf);
  renderer.setRenderTarget(null);

  // 합친 높이장을 눈으로도 보게 화면에 그립니다.
  const show = new THREE.Mesh(new THREE.PlaneGeometry(2,2),
    new THREE.MeshBasicMaterial({ map: patch.texture, depthTest:false }));
  const sc2 = new THREE.Scene(); sc2.add(show);
  renderer.render(sc2, cam);

  const rows=[];
  for (let k=0;k<PTS.length;k++){
    // readRenderTargetPixels 는 아래에서 위로 옵니다 — 격자 j 와 같은 순서입니다
    // (셰이더도 gl_FragCoord.y 가 아래부터이므로 그대로 맞습니다).
    const o=k*4;
    const got = buf[o]*256 + buf[o+1] + buf[o+2]/255 - 32768;
    rows.push({ e:PTS[k].e, s:PTS[k].s, ref:PTS[k].ref, cpu:PTS[k].cpu,
                got:+got.toFixed(2),
                diff:+(got-PTS[k].ref).toFixed(1),
                cpuDiff:+(got-PTS[k].cpu).toFixed(2) });
  }
  const med=a=>{const t=[...a].sort((x,y)=>x-y);return t[Math.floor(t.length/2)];};
  const mean=a=>a.reduce((x,y)=>x+y,0)/a.length;
  const corr=(a,b)=>{const ma=mean(a),mb=mean(b);
    let n=0,da=0,db=0;
    for(let i=0;i<a.length;i++){n+=(a[i]-ma)*(b[i]-mb);da+=(a[i]-ma)**2;db+=(b[i]-mb)**2;}
    return n/Math.sqrt(da*db);};
  const dRef=rows.map(r=>Math.abs(r.diff));
  const dCpu=rows.map(r=>Math.abs(r.cpuDiff));
  결과 = {
    zoom: patch.zoom, tileSpanM:+patch.tileSpanM.toFixed(1),
    블록: patch.blockTiles, 덮임: patch.coverage,
    관측자U:+patch.observerU.toFixed(4), 관측자V:+patch.observerV.toFixed(4),
    표본: rows.length,
    // ① 같은 자료 — 여기가 파이프라인 판정입니다. 0 에 붙어야 합니다.
    CPU중앙오차: +med(dCpu).toFixed(3),
    CPU최대오차: +Math.max(...dCpu).toFixed(3),
    // ② 다른 자료 — 상관과 치우침만 봅니다.
    참조중앙오차: +med(dRef).toFixed(2),
    참조최대오차: +Math.max(...dRef).toFixed(2),
    참조상관: +corr(rows.map(r=>r.ref), rows.map(r=>r.got)).toFixed(4),
    참조치우침: +mean(rows.map(r=>r.got-r.ref)).toFixed(2),
    참조범위: [Math.min(...rows.map(r=>r.ref)), Math.max(...rows.map(r=>r.ref))],
    화면범위: [+Math.min(...rows.map(r=>r.got)).toFixed(1), +Math.max(...rows.map(r=>r.got)).toFixed(1)],
    // 바다(참조 0m)와 뭍이 실제로 갈리는가 — 해안선의 재료가 있는지
    바다평균: +mean(rows.filter(r=>r.ref===0).map(r=>r.got)).toFixed(2),
    뭍평균: +mean(rows.filter(r=>r.ref>=20).map(r=>r.got)).toFixed(2),
    표: rows,
  };
  document.getElementById('tbl').innerHTML =
    '<table><tr><th>동(m)</th><th>남(m)</th><th>CPU</th><th>셰이더</th><th>CPU차</th>'
    + '<th>Open-Meteo</th><th>차</th></tr>'
    + rows.slice(0,16).map(r=>'<tr><td>'+r.e+'</td><td>'+r.s+'</td><td>'+r.cpu
      +'</td><td>'+r.got+'</td><td>'+r.cpuDiff+'</td><td>'+r.ref+'</td><td>'+r.diff
      +'</td></tr>').join('')
    + '</table><p style="font:11px monospace">전체 '+rows.length+'점 · 같은 자료 중앙오차 '
    + 결과.CPU중앙오차 + 'm (최대 ' + 결과.CPU최대오차 + 'm) · 다른 자료 상관 '
    + 결과.참조상관 + ' 치우침 ' + 결과.참조치우침 + 'm</p>';
}

window.__stats={ glError: renderer.getContext().getError(), 결과 };
window.__errors=errors;
document.title='DONE::'+(errors.length?'ERR':'OK')+'::'+renderer.getContext().getError();
</script></body></html>`;

  fs.mkdirSync(PREVIEW, { recursive: true });
  fs.writeFileSync(path.join(PREVIEW, 'dem-check.html'), html);
  console.log('생성 완료: dem-check.html');
})();
