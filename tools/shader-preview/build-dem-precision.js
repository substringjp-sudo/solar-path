/**
 * **휴대폰 GPU 의 표본 정밀도에서도 해안선이 깨끗한가** (실기 2026-10-15).
 *
 * > 해안가 특히 지형이 복잡한 곳을 가면 바닷가에 이렇게 뾰족한게 마구 생기는데
 * > 이걸 고치고 깔끔한 해안선만 남는 방법을 찾아줘
 *
 * ## 무엇이 원인이었나
 *
 * Terrarium 은 고도를 `R·256 + G + B/256 − 32768` 로 세 채널에 쪼개 담습니다.
 * 식이 채널에 대해 선형이라 **수학으로는** 하드웨어 쌍선형과 디코드가
 * 교환되고, 이 하네스(SwiftShader — 32비트로 거릅니다)에서도 오차가 0 입니다.
 * 그런데 휴대폰 GPU 는 8비트 텍스처를 거른 값을 **fp16**(유효숫자 11비트)으로
 * 돌려줍니다. R 은 256m 짜리 자리라 이웃 화소의 R 이 다르면 섞인 R 의 반올림
 * 오차가 256배로 불어 **최대 ±16m** 가 됩니다. 0m 가 바로 R 이 127 → 128 로
 * 넘어가는 자리라, 이 오차는 **물가에만** 몰립니다. 발밑 수십 m 앞에서 16m 는
 * 고도각 수십 도 — 사진의 가시 울타리입니다.
 *
 * ## 재는 법
 *
 * 하네스 GPU 는 fp16 이 아니므로 **휴대폰의 표본을 흉내 냅니다.** 셰이더 문자열의
 * 표본 줄을 `packHalf2x16` 왕복으로 감쌉니다 — 앱 코드는 그대로 두고 하네스에서만
 * 바꿉니다. 세 갈래를 같은 자리·같은 패치로 그립니다.
 *
 *  · **기준** — 앱 코드 그대로 (하네스 GPU 는 정확합니다).
 *  · **지금 + fp16** — 앱 코드에 휴대폰 표본을 씌운 것. 고침이 맞으면 기준과 같아야 합니다.
 *  · **옛길 + fp16** — 하드웨어가 채널을 섞고 그 값을 fp16 으로 돌려주던 옛 디코드.
 *    이게 가시를 **실제로 세우지 못하면** 이 판정은 눈먼 것입니다(대조).
 *
 * 두 층에서 잽니다.
 *  ① **고도 표본** — 물가를 낀 3km 안 격자점에서 `dem_elevationAt` 을 CPU 참조(dem-cpu.js,
 *     독립 구현)와 견줍니다.
 *  ② **화면** — 앱과 같은 지형 격자(근거리 + 먼 지형 한 장)를 발밑에서 360° 돌려 찍고,
 *     기준에 없는 지형 화소(솟은 가시)와 기준에만 있는 화소(파인 자리)를 셉니다.
 *
 * 사용: node tools/shader-preview/build-dem-precision.js
 *       node tools/shader-preview/verify-dem-precision.js
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const { PREVIEW } = require('./paths');
const D = require('./dem-cpu');

const NEAR_R = 3000, MASK_R = 60000, BLOCK = 3, EYE_M = 1.6;
// 물가가 복잡한 두 곳 — 서해 갯벌(대부도)과 화산섬 해안(성산).
const SITES = [
  { key: '대부도', lat: 37.24102, lon: 126.55969, near: 'dem', wide: 'wide-daebu' },
  { key: '성산', lat: 33.4580, lon: 126.9300, near: 'dem-seongsan', wide: 'wide-seongsan' },
];
/** ① 고도 표본 격자 한 변 (±NEAR_R 을 덮습니다). */
const GRID = 192;

const get = (u) => new Promise((res, rej) => {
  https.get(u, r => {
    if (r.statusCode !== 200) { rej(new Error('HTTP ' + r.statusCode)); r.resume(); return; }
    const c = []; r.on('data', d => c.push(d)); r.on('end', () => res(Buffer.concat(c)));
  }).on('error', rej);
});

async function fetchBlock(lat, lon, zoom, block, dir) {
  const t = D.lonLatToTileFloat(lon, lat, zoom);
  const { originX, originY } = D.pickBlockOrigin(t.x, t.y, block);
  const demDir = path.join(PREVIEW, dir);
  fs.mkdirSync(demDir, { recursive: true });
  for (let dy = 0; dy < block; dy++) for (let dx = 0; dx < block; dx++) {
    const f = path.join(demDir, `${zoom}_${originX + dx}_${originY + dy}.png`);
    if (fs.existsSync(f)) continue;
    fs.writeFileSync(f, await get(
      `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${zoom}/${originX + dx}/${originY + dy}.png`));
  }
  return demDir;
}

(async () => {
  const prepared = [];
  for (const s of SITES) {
    const nearZoom = D.demZoomForRadius(NEAR_R, s.lat, BLOCK);
    const wideZoom = D.demZoomForRadius(MASK_R, s.lat, BLOCK);
    const nearDir = await fetchBlock(s.lat, s.lon, nearZoom, BLOCK, s.near);
    await fetchBlock(s.lat, s.lon, wideZoom, BLOCK, s.wide);
    const near = D.makeCpuDem({ demDir: nearDir, zoom: nearZoom, lat: s.lat, lon: s.lon });
    // CPU 참조 — 셰이더가 뽑을 격자점과 **같은 식**의 지상 좌표.
    const ref = [];
    for (let j = 0; j < GRID; j++) for (let i = 0; i < GRID; i++) {
      const e = ((i + 0.5) / GRID) * 2 * NEAR_R - NEAR_R;
      const so = ((j + 0.5) / GRID) * 2 * NEAR_R - NEAR_R;
      const h = near.elevAtGround(e, so);
      ref.push(h === null ? null : +h.toFixed(4));
    }
    const sea = ref.filter((h) => h !== null && h <= 0).length / ref.length;
    console.log(`${s.key}: 줌 ${nearZoom}/${wideZoom} · 발밑 ${near.elevAtGround(0, 0).toFixed(1)}m · 바다 ${(sea * 100).toFixed(1)}%`);
    prepared.push({ ...s, nearZoom, wideZoom, ref });
  }

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
 body{margin:0;background:#0b0f15;font-family:sans-serif;color:#dde}
 #wrap{padding:12px;width:1140px} canvas{border:1px solid #345;margin:2px} p,div.t{font:11px monospace}
</style></head><body>
<div id="wrap"><h3>휴대폰 표본 정밀도(fp16)에서 해안선 — 옛길 · 지금 · 기준</h3>
<div id="shots"></div><div id="out"></div></div>
<script type="module">
import * as THREE from './app/vendor/three.module.js';
import { loadDemPatch, clearDemCache, DEM_GLSL, makeDemUniforms } from './app/utils/demTiles.js';
import { createTerrainField, updateTerrainFieldEye, FIELD_RINGS, FAR_FIELD_RINGS, FAR_FIELD_FAR_M }
  from './app/components/SkyScene3D/TerrainField.js';

const errors=[]; const oe=console.error; console.error=(...a)=>{errors.push(a.join(' ')); oe(...a);};
window.addEventListener('error', e=>errors.push(String(e.message)));

const SITES=${JSON.stringify(prepared)};
const NEAR_R=${NEAR_R}, MASK_R=${MASK_R}, BLOCK=${BLOCK}, EYE=${EYE_M}, GRID=${GRID};

// ── 휴대폰 표본 흉내 ──────────────────────────────────────────────────────────
// fp16 왕복. GLSL ES 3.00 의 packHalf2x16 — three 는 WebGL2 에서 ShaderMaterial 을 300 es 로 엮습니다.
const F16 = \`
vec3 pp_f16(vec3 v) { return vec3(unpackHalf2x16(packHalf2x16(v.xy)), unpackHalf2x16(packHalf2x16(vec2(v.z, 0.0))).x); }
vec4 pp_f16(vec4 v) { return vec4(unpackHalf2x16(packHalf2x16(v.xy)), unpackHalf2x16(packHalf2x16(v.zw))); }
\`;
/**
 * 셰이더 문자열을 갈래에 맞게 고칩니다. 앱 코드의 **글자 그대로**를 찾아 바꾸므로, 앱이 그
 * 줄을 고치면 여기서 바뀐 개수가 0 이 되고 판정이 그걸 잡습니다(조용히 흉내를 놓치지 않게).
 *  · 'now'    — 화소 하나를 읽는 줄에 fp16 을 씌웁니다. 나머지는 앱 그대로.
 *  · 'legacy' — 옛 디코드: 하드웨어가 채널을 섞고(쌍선형) fp16 으로 돌려준 값을 반올림 없이 풉니다.
 */
function patchGlsl(src, mode) {
  let n = 0;
  let out = src.replace('precision highp float;', (m) => m + '\\n' + F16);
  if (mode === 'now') {
    out = out.replace(/texture2D\\((u\\w+Tex), \\(tc \\+ 0\\.5\\) \\/ n\\)/g,
      (_m, tex) => { n++; return 'pp_f16(texture2D(' + tex + ', (tc + 0.5) / n))'; });
  } else if (mode === 'legacy') {
    // 화소 하나 — 옛 코드도 같은 표본을 읽었지만 채널을 반올림하지 않았습니다.
    out = out.replace(/vec3 c = floor\\(texture2D\\((u\\w+Tex), \\(tc \\+ 0\\.5\\) \\/ n\\)\\.rgb \\* 255\\.0 \\+ 0\\.5\\);/g,
      (_m, tex) => { n++; return 'vec3 c = pp_f16(texture2D(' + tex + ', (tc + 0.5) / n).rgb) * 255.0;'; });
    // 쌍선형 — 디코드한 값이 아니라 **채널을** 섞고, 그 결과를 fp16 으로.
    out = out.replace(/float (\\w+)_elevation\\(vec2 uv\\) \\{[\\s\\S]*?\\n\\}/g, (_m, p) => {
      n++;
      const U = p.charAt(0).toUpperCase() + p.slice(1);
      const at = (o) => 'texture2D(u' + U + 'Tex, (clamp(k.xy + vec2' + o + ', vec2(0.0), vec2(nn - 1.0)) + 0.5) / nn).rgb';
      return 'float ' + p + '_elevation(vec2 uv) {\\n'
        + '  float nn = u' + U + 'Block * 256.0;\\n'
        + '  vec4 k = ' + p + '_cell(uv);\\n'
        + '  vec3 t = mix(mix(' + at('(0.0, 0.0)') + ', ' + at('(1.0, 0.0)') + ', k.z),\\n'
        + '               mix(' + at('(0.0, 1.0)') + ', ' + at('(1.0, 1.0)') + ', k.z), k.w);\\n'
        + '  t = pp_f16(t) * 255.0;\\n'
        + '  return t.r * 256.0 + t.g + t.b / 256.0 - 32768.0;\\n}';
    });
  }
  return { src: out, n };
}

const loadTexture=(u)=>new Promise((res,rej)=>{ new THREE.TextureLoader().load(u,res,undefined,rej); });
const canvas=document.createElement('canvas');
const renderer=new THREE.WebGLRenderer({canvas, antialias:false, alpha:true});
renderer.setPixelRatio(1); renderer.setClearColor(0x000000,0);

// ── ① 고도 표본 ───────────────────────────────────────────────────────────────
function sampleElev(patch, mode) {
  const rt=new THREE.WebGLRenderTarget(GRID, GRID, {format:THREE.RGBAFormat, type:THREE.FloatType,
    minFilter:THREE.NearestFilter, magFilter:THREE.NearestFilter, depthBuffer:false});
  const fs = patchGlsl('precision highp float;\\n' + DEM_GLSL + \`
    uniform float uN, uR;
    void main(){
      vec2 g = (gl_FragCoord.xy / uN) * 2.0 * uR - uR;
      gl_FragColor = vec4(dem_elevationAt(g), 0.0, 0.0, 1.0);
    }\`, mode);
  const mat=new THREE.ShaderMaterial({
    uniforms:{ ...makeDemUniforms(patch), uN:{value:GRID}, uR:{value:NEAR_R} },
    vertexShader:'void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: fs.src, depthTest:false,
  });
  const sc=new THREE.Scene(); sc.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2), mat));
  renderer.setRenderTarget(rt); renderer.render(sc, new THREE.Camera());
  const buf=new Float32Array(GRID*GRID*4);
  renderer.readRenderTargetPixels(rt,0,0,GRID,GRID,buf); renderer.setRenderTarget(null);
  mat.dispose(); rt.dispose();
  return { h: Array.from({length:GRID*GRID}, (_,k)=>buf[k*4]), n: fs.n };
}
function elevStats(got, ref) {
  let max=0, maxNear0=0, over1=0, cnt=0, near0=0;
  for (let k=0;k<ref.length;k++){
    if (ref[k]===null) continue;
    const e=Math.abs(got[k]-ref[k]); cnt++;
    max=Math.max(max,e);
    if (Math.abs(ref[k])<10){ near0++; maxNear0=Math.max(maxNear0,e); if(e>1) over1++; }
  }
  return { 표본:cnt, 물가표본:near0, 최대오차:+max.toFixed(3), 물가최대오차:+maxNear0.toFixed(3), 물가1m넘음:over1 };
}

// ── ② 화면 ────────────────────────────────────────────────────────────────────
const W=360, H=300, FOV=40, SHOTS=12;   // 세로 화각 40°, 가로 약 47° × 12장 = 한 바퀴(겹침)
renderer.setSize(W,H,false);
const rt=new THREE.WebGLRenderTarget(W,H,{format:THREE.RGBAFormat,type:THREE.UnsignedByteType,
  minFilter:THREE.NearestFilter, magFilter:THREE.NearestFilter, depthBuffer:true});
const masks=(n)=>new Uint8Array(W*H*4);

function makeField(nearPatch, widePatch, mode) {
  // 앱과 같은 격자: 근거리 + 먼 지형 한 장(SkyScene3D 의 createTerrainField 와 같은 인자).
  const f=createTerrainField({ eyeHeightM:EYE, farM:FAR_FIELD_FAR_M, rings:FIELD_RINGS + FAR_FIELD_RINGS });
  f.setPatch(nearPatch, nearPatch, widePatch);
  let n=0;
  if (mode!=='ref') {
    const v=patchGlsl(f.material.vertexShader, mode), fr=patchGlsl(f.material.fragmentShader, mode);
    f.material.vertexShader=v.src; f.material.fragmentShader=fr.src; f.material.needsUpdate=true; n=v.n;
  }
  const u=f.material.uniforms;
  u.uSurfaceIrr.value.set(0.30,0.34,0.44); u.uSunAltDeg.value=20; u.uSunAltRad.value=20*Math.PI/180;
  u.uSunRadiance.value.set(1.2,1.1,0.9); u.uAerial.value=0; u.uShadow.value=0;
  return { f, n };
}

const 결과={};
for (const site of SITES) {
  clearDemCache();
  const nearPatch=await loadDemPatch(site.lat, site.lon, NEAR_R, {renderer, loadTexture, block:BLOCK,
    tileUrl:(z,x,y)=>\`./\${site.near}/\${z}_\${x}_\${y}.png\`});
  const widePatch=await loadDemPatch(site.lat, site.lon, MASK_R, {renderer, loadTexture, block:BLOCK,
    tileUrl:(z,x,y)=>\`./\${site.wide}/\${z}_\${x}_\${y}.png\`});
  if(!nearPatch||!widePatch){ errors.push(site.key+' 패치 없음'); continue; }

  const 표본={};
  for (const mode of ['ref','now','legacy']) {
    const s=sampleElev(nearPatch, mode);
    표본[mode]={ ...elevStats(s.h, site.ref), 바꾼줄:s.n };
  }

  const cam=new THREE.PerspectiveCamera(FOV, W/H, 0.1, 2000); cam.position.set(0,0,0);
  const fields={}; const 바꾼줄={};
  for (const mode of ['ref','now','legacy']) { const m=makeField(nearPatch, widePatch, mode); fields[mode]=m.f; 바꾼줄[mode]=m.n; }
  const tot={ now:{솟음:0, 파임:0}, legacy:{솟음:0, 파임:0} };
  let worst={ az:0, 솟음:-1 };
  const buf={ ref:masks(), now:masks(), legacy:masks() };
  // 가장 아래 줄은 발밑(−20° 언저리)이라 근거리 물가가 다 들어옵니다.
  const PITCH=-6*Math.PI/180;
  for (let i=0;i<SHOTS;i++){
    const az=i*360/SHOTS, ar=az*Math.PI/180;
    cam.up.set(0,1,0);
    cam.lookAt(Math.sin(ar)*Math.cos(PITCH), Math.sin(PITCH), -Math.cos(ar)*Math.cos(PITCH));
    cam.updateMatrixWorld(true);
    for (const mode of ['ref','now','legacy']) {
      const sc=new THREE.Scene(); sc.add(fields[mode].mesh); updateTerrainFieldEye(fields[mode], cam);
      renderer.setRenderTarget(rt); renderer.clear(); renderer.render(sc,cam);
      renderer.readRenderTargetPixels(rt,0,0,W,H,buf[mode]); renderer.setRenderTarget(null);
      sc.remove(fields[mode].mesh);
    }
    for (const mode of ['now','legacy']) {
      let up=0, dn=0;
      for (let k=0;k<W*H;k++){
        const a=buf.ref[k*4+3]>128, b=buf[mode][k*4+3]>128;
        if (b && !a) up++; else if (a && !b) dn++;
      }
      tot[mode].솟음+=up; tot[mode].파임+=dn;
      if (mode==='legacy' && up>worst.솟음) worst={ az, 솟음:up };
    }
  }
  // 옛길이 가장 많이 솟은 방위를 셋 나란히 남깁니다(눈으로 보는 용).
  {
    const ar=worst.az*Math.PI/180;
    cam.lookAt(Math.sin(ar)*Math.cos(PITCH), Math.sin(PITCH), -Math.cos(ar)*Math.cos(PITCH)); cam.updateMatrixWorld(true);
    const row=document.createElement('div');
    for (const [mode,label] of [['legacy','옛길 + fp16'],['now','지금 + fp16'],['ref','기준']]) {
      const sc=new THREE.Scene(); sc.background=new THREE.Color(0x6f93c4); sc.add(fields[mode].mesh);
      updateTerrainFieldEye(fields[mode], cam); renderer.render(sc,cam); sc.remove(fields[mode].mesh);
      const c=document.createElement('canvas'); c.width=W; c.height=H; c.getContext('2d').drawImage(canvas,0,0);
      const box=document.createElement('div'); box.style.display='inline-block';
      const t=document.createElement('div'); t.className='t'; t.textContent=site.key+' · '+label+' · 방위 '+worst.az+'°';
      box.appendChild(t); box.appendChild(c); row.appendChild(box);
    }
    document.getElementById('shots').appendChild(row);
  }
  for (const m of Object.values(fields)) m.dispose();
  결과[site.key]={ 표본, 화면:{ 화소:W*H*SHOTS, ...tot, 옛길최악방위:worst.az }, 바꾼줄 };
}

document.getElementById('out').innerHTML='<p>'+JSON.stringify(결과)+'</p>';
window.__stats={ glError: renderer.getContext().getError(), 결과 };
window.__errors=errors;
document.title='DONE::'+(errors.length?'ERR':'OK')+'::'+renderer.getContext().getError();
</script></body></html>`;

  fs.mkdirSync(PREVIEW, { recursive: true });
  fs.writeFileSync(path.join(PREVIEW, 'dem-precision.html'), html);
  console.log('생성 완료: dem-precision.html');
})();
