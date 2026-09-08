/**
 * **능선 실루엣이 자료와 맞는가** (docs/COASTLINE_PLAN.md 2단계).
 *
 * 1단계에서 고도값이 맞는 것을 확인했습니다. 이제 그 값이 **기하**가 됩니다.
 * 그러면 물어야 할 것은 하나입니다 — **화면에 보이는 능선 윤곽이 자료가
 * 말하는 윤곽과 같은가.**
 *
 * ## 재는 법
 *
 * 12방향으로 30° 씩 나눠 한 바퀴를 찍고, 각 **화소 열**에서 하늘이 아닌
 * 맨 위 화소를 찾습니다. 그게 그 방위의 지평선입니다. 카메라가 수평이고
 * 위 벡터가 월드 위쪽이면 **한 열은 방위가 고정된 수직면**이라, 열 → 방위와
 * 행 → 고도각이 정확히 풀립니다.
 *
 * 참조는 같은 식을 **CPU 로** 다시 푼 값입니다 (`dem-cpu.js` 가 PNG 를 직접
 * 풀고, `TerrainField.horizonAngleDeg` 가 고리를 훑습니다):
 *
 *     낙차   = d² / 2R
 *     고도각 = max over d  atan2(고도 − 눈높이 − 낙차, d)
 *
 * ⚠ 참조는 셰이더와 **같은 고리 거리**를 씁니다. 다른 간격으로 훑으면
 * 표본 차이를 결함으로 잘못 읽습니다. 대신 촘촘하게 훑은 값도 같이 내서
 * **고리 수가 모자란지**를 따로 봅니다.
 *
 * ⚠ 가장자리 페이드는 꺼 둡니다(`uFarM` 을 크게). 페이드가 걸리면 바깥
 * 고리가 알파로 사라져 실루엣이 앞 고리에서 잡히는데, 그건 실루엣 결함이
 * 아니라 넘겨주기 방식입니다. 페이드는 따로 봅니다.
 *
 * 사용: node tools/shader-preview/build-terrain-field.js
 *       node tools/shader-preview/verify-terrain-field.js
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const { PREVIEW } = require('./paths');
const { demZoomForRadius, pickBlockOrigin, tileSpanMetres,
        lonLatToTileFloat, makeCpuDem } = require('./dem-cpu');

/** 1단계와 같은 자리 — 대부도 앞바다. 육지와 바다가 같이 들어옵니다. */
const LAT = 37.25, LON = 126.58;
const BLOCK = 3;
// ⚠ 관측자 발밑 고도는 **DEM 이 정합니다** (아래에서 읽습니다). 바깥 자료를
//    믿었다가 이 지점의 실제 42m 에 눈이 파묻혀 지평선각이 72° 로 나왔습니다.
const EYE_M = 1.6;

/** TerrainField.ts 와 같은 값이어야 합니다. */
const FIELD_NEAR_M = 12, FIELD_FAR_M = 3000, RINGS = 128;
const ringDist = (k, rings) =>
  FIELD_NEAR_M * Math.pow(FIELD_FAR_M / FIELD_NEAR_M, rings <= 1 ? 0 : k / (rings - 1));

/** 12장 × 30° = 한 바퀴. 열 128개면 방위 0.234° 간격입니다. */
const VIEWS = 12, FOV_DEG = 30, W = 128, H = 512;
const PITCH_DEG = 5;       // 지형각이 −10°~+20° 에 들어오게

const EARTH_R = 6371000;

const get = (url) => new Promise((res, rej) => {
  https.get(url, r => {
    if (r.statusCode !== 200) { rej(new Error(`HTTP ${r.statusCode} ${url}`)); r.resume(); return; }
    const c = []; r.on('data', d => c.push(d)); r.on('end', () => res(Buffer.concat(c)));
  }).on('error', rej);
});

(async () => {
  const zoom = demZoomForRadius(FIELD_FAR_M, LAT, BLOCK);
  const span = tileSpanMetres(zoom, LAT);
  const t = lonLatToTileFloat(LON, LAT, zoom);
  const { originX, originY } = pickBlockOrigin(t.x, t.y, BLOCK);
  console.log(`줌 ${zoom} · 타일 한 변 ${span.toFixed(0)}m · 여유 ${(((BLOCK-1)/2)*span).toFixed(0)}m (격자 ${FIELD_FAR_M}m)`);

  const demDir = path.join(PREVIEW, 'dem');
  fs.mkdirSync(demDir, { recursive: true });
  let fetched = 0;
  for (let dy = 0; dy < BLOCK; dy++) for (let dx = 0; dx < BLOCK; dx++) {
    const x = originX + dx, y = originY + dy;
    const f = path.join(demDir, `${zoom}_${x}_${y}.png`);
    if (fs.existsSync(f)) continue;
    fs.writeFileSync(f, await get(
      `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${zoom}/${x}/${y}.png`));
    fetched++;
  }
  console.log(`타일 ${BLOCK * BLOCK}장 준비 (새로 받은 것 ${fetched})`);

  const dem = makeCpuDem({ demDir, zoom, lat: LAT, lon: LON });
  const OBS_ELEV_M = dem.elevAtGround(0, 0);
  console.log(`관측자 발밑 고도 (DEM) ${OBS_ELEV_M.toFixed(2)}m · 눈 ${(OBS_ELEV_M + EYE_M).toFixed(2)}m`);

  // ── 열 → 방위, 그리고 그 방위의 CPU 참조 지평선각 ─────────────────────
  // 카메라: 수평 오른쪽 R, 월드 위 U, 앞 F. 열 x 의 수평 방향은
  //   hdir = ndcX·tanH·R + F   (세로 성분은 방위에 안 섞입니다)
  const tanV = Math.tan((FOV_DEG / 2) * Math.PI / 180);
  const tanH = tanV;                     // aspect = W/H 가 아니라 정사각 화각
  const horizonAngle = (azRad, rings) => {
    const eye = OBS_ELEV_M + EYE_M;
    let best = -Infinity, missing = false;
    for (let k = 0; k < rings; k++) {
      const d = ringDist(k, rings);
      // 방위 A(북에서 시계방향) → 지상 (동, 남) = (sin A, −cos A)
      const h = dem.elevAtGround(Math.sin(azRad) * d, -Math.cos(azRad) * d);
      if (h === null) { missing = true; continue; }
      const a = Math.atan2(h - eye - (d * d) / (2 * EARTH_R), d);
      if (a > best) best = a;
    }
    return { deg: (best * 180) / Math.PI, missing };
  };

  const cols = [];
  for (let v = 0; v < VIEWS; v++) {
    const camAz = (v / VIEWS) * 360;
    const camAzRad = (camAz * Math.PI) / 180;
    // +x 동, −z 북. 방위는 북에서 시계방향.
    const F = [Math.sin(camAzRad), 0, -Math.cos(camAzRad)];
    const R = [Math.cos(camAzRad), 0, Math.sin(camAzRad)];
    for (let x = 0; x < W; x++) {
      const ndcX = ((x + 0.5) / W) * 2 - 1;
      const hx = ndcX * tanH * R[0] + F[0];
      const hz = ndcX * tanH * R[2] + F[2];
      const az = Math.atan2(hx, -hz);
      const ref = horizonAngle(az, RINGS);
      const dense = horizonAngle(az, RINGS * 4);
      cols.push({
        v, x,
        az: +((az * 180) / Math.PI + 360).toFixed(3) % 360,
        // 열 안에서 행 → 고도각을 풀 때 쓰는 수평 성분 길이
        hlen: +Math.hypot(hx, hz).toFixed(6),
        ref: +ref.deg.toFixed(4),
        dense: +dense.deg.toFixed(4),
        missing: ref.missing || dense.missing,
      });
    }
  }
  // ── 넘겨주기 틈 ─────────────────────────────────────────────────────
  // 격자는 3km 에서 끝납니다. 바다 방위에서 바깥 고리의 각도는 진짜 수평선
  // (내려앉음 = acos(R/(R+눈높이)))보다 **아래**에 있어야 합니다. 위에 있으면
  // 격자 끝과 그 너머 사이에 하늘이 새는 구멍이 남습니다. 44절에서 지면과
  // 구름이 서로 다른 지평선을 써서 0.79° 짜리 띠가 벌어진 적이 있습니다.
  const eyeM = OBS_ELEV_M + EYE_M;
  const dipDeg = (Math.acos(EARTH_R / (EARTH_R + eyeM)) * 180) / Math.PI;
  const farAngles = [];
  for (let i = 0; i < 720; i++) {
    const a = (i / 720) * Math.PI * 2;
    const h = dem.elevAtGround(Math.sin(a) * FIELD_FAR_M, -Math.cos(a) * FIELD_FAR_M);
    if (h === null) continue;
    farAngles.push({
      az: +((a * 180) / Math.PI).toFixed(2), h,
      deg: (Math.atan2(h - eyeM - (FIELD_FAR_M ** 2) / (2 * EARTH_R), FIELD_FAR_M) * 180) / Math.PI,
    });
  }
  const sea = farAngles.filter(f => Math.abs(f.h) < 1);
  const 넘겨주기 = {
    수평선내려앉음: +(-dipDeg).toFixed(4),
    바깥고리최고: +Math.max(...farAngles.map(f => f.deg)).toFixed(4),
    바다바깥고리: sea.length ? +(sea.reduce((a, b) => a + b.deg, 0) / sea.length).toFixed(4) : null,
    바다방위수: sea.length,
  };
  넘겨주기.틈 = +(-dipDeg - (넘겨주기.바다바깥고리 ?? 0)).toFixed(4);
  console.log(`수평선 ${넘겨주기.수평선내려앉음}° · 격자 바깥 고리(바다) ${넘겨주기.바다바깥고리}° · 틈 ${넘겨주기.틈}°`);

  const refs = cols.map(c => c.ref);
  console.log(`CPU 참조 ${cols.length}열 · 지평선각 ${Math.min(...refs).toFixed(2)}° ~ ${Math.max(...refs).toFixed(2)}°`);
  const dd = cols.map(c => Math.abs(c.dense - c.ref));
  console.log(`고리 ${RINGS} 대 ${RINGS * 4} 차이: 중앙 ${dd.slice().sort((a,b)=>a-b)[dd.length>>1].toFixed(3)}° · 최대 ${Math.max(...dd).toFixed(3)}°`);
  console.log(`블록 밖 표본이 있는 열 ${cols.filter(c => c.missing).length}개`);

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
 body{margin:0;background:#0b0f15;font-family:sans-serif;color:#dde}
 #wrap{padding:12px;width:1100px} h3{font-size:14px;margin:6px 0}
 canvas{border:1px solid #345;margin:4px 2px 0 0}
 p{font:11px monospace}
</style></head><body>
<div id="wrap">
<h3>지형 높이장 — 그려진 실루엣 대 자료가 말하는 실루엣</h3>
<div id="shots"></div><div id="out"></div></div>
<script type="module">
import * as THREE from './app/vendor/three.module.js';
import { loadDemPatch } from './app/utils/demTiles.js';
import { createTerrainField, updateTerrainFieldEye, FIELD_RINGS, FIELD_SPOKES }
  from './app/components/SkyScene3D/TerrainField.js';

const errors=[]; const oe=console.error; console.error=(...a)=>{errors.push(a.join(' ')); oe(...a);};
window.addEventListener('error', e => errors.push(String(e.message)));

const LAT=${LAT}, LON=${LON}, BLOCK=${BLOCK}, FAR=${FIELD_FAR_M};
const VIEWS=${VIEWS}, FOV=${FOV_DEG}, W=${W}, H=${H}, PITCH=${PITCH_DEG};
const OBS=${OBS_ELEV_M.toFixed(3)}, EYE=${EYE_M};
const COLS=${JSON.stringify(cols)};
const 넘겨주기=${JSON.stringify(넘겨주기)};

const canvas=document.createElement('canvas'); canvas.width=W; canvas.height=H;
const renderer=new THREE.WebGLRenderer({canvas, antialias:false, alpha:true});
renderer.setPixelRatio(1); renderer.setSize(W,H,false);
renderer.setClearColor(0x000000, 0);

const loadTexture=(url)=>new Promise((res,rej)=>{ new THREE.TextureLoader().load(url,res,undefined,rej); });
const patch = await loadDemPatch(LAT, LON, FAR, {
  renderer, loadTexture, block: BLOCK,
  tileUrl:(z,x,y)=>\`./dem/\${z}_\${x}_\${y}.png\`,
});

let 결과=null;
if (patch) {
  // ── 대조: 평평한 판 ──────────────────────────────────────────────────
  // DEM 을 끄면(uDemValid=0) 지면이 발밑 높이로 평평해지고, 그때 실루엣은
  // 손으로 풀립니다: max over d  atan2(−눈높이 − d²/2R, d) — 가장 먼 고리에서
  // 최대이고 값은 −0.044° 입니다. 읽어내는 사슬 전체를 이걸로 검증합니다.
  let 평판=null;
  {
    const f0=createTerrainField({ eyeHeightM:EYE, observerElevM:0 });
    f0.material.uniforms.uDemValid.value=0;
    f0.material.uniforms.uFarM.value=1e9;
    f0.material.uniforms.uSurfaceIrr.value.set(0.5,0.5,0.5);
    f0.material.uniforms.uSunRadiance.value.set(0,0,0);
    const sc=new THREE.Scene(); sc.add(f0.mesh);
    const c0=new THREE.PerspectiveCamera(FOV,1,0.1,2000); c0.position.set(0,0,0);
    updateTerrainFieldEye(f0,c0);
    const rt0=new THREE.WebGLRenderTarget(W,H,{format:THREE.RGBAFormat,
      type:THREE.UnsignedByteType,minFilter:THREE.NearestFilter,
      magFilter:THREE.NearestFilter,depthBuffer:true});
    const b0=new Uint8Array(W*H*4); const tv=Math.tan((FOV/2)*Math.PI/180);
    const gs=[];
    for(let v=0;v<VIEWS;v++){
      const ar=(v/VIEWS)*360*Math.PI/180, pr=PITCH*Math.PI/180;
      c0.up.set(0,1,0);
      c0.lookAt(Math.cos(pr)*Math.sin(ar),Math.sin(pr),-Math.cos(pr)*Math.cos(ar));
      c0.updateMatrixWorld(true);
      renderer.setRenderTarget(rt0); renderer.clear(); renderer.render(sc,c0);
      renderer.readRenderTargetPixels(rt0,0,0,W,H,b0); renderer.setRenderTarget(null);
      for(let x=0;x<W;x++){
        let top=-1; for(let y=H-1;y>=0;y--){ if(b0[(y*W+x)*4+3]>128){top=y;break;} }
        if(top<0){ gs.push(null); continue; }
        const dc=new THREE.Vector3((((x+0.5)/W)*2-1)*tv,(((top+1)/H)*2-1)*tv,-1)
          .normalize().applyQuaternion(c0.quaternion);
        gs.push(Math.asin(Math.max(-1,Math.min(1,dc.y)))*180/Math.PI);
      }
    }
    const ok=gs.filter(g=>g!==null);
    const 이론=Math.atan2(-EYE-(FAR*FAR)/(2*6371000), FAR)*180/Math.PI;
    평판={ 이론:+이론.toFixed(4), 열:gs.length, 잡힘:ok.length,
      최소:+Math.min(...ok).toFixed(4), 최대:+Math.max(...ok).toFixed(4),
      평균:+(ok.reduce((a,b)=>a+b,0)/ok.length).toFixed(4),
      최대편차:+Math.max(...ok.map(g=>Math.abs(g-이론))).toFixed(4) };
    rt0.dispose(); f0.dispose();
  }

  const SPOKE_SWEEP=[128,256,512,1024];
  const 살훑기=[];
  for (const sp of SPOKE_SWEEP){
    const f2=createTerrainField({patch, eyeHeightM:EYE, spokes:sp});
    f2.material.uniforms.uFarM.value=1e9;
    f2.material.uniforms.uSurfaceIrr.value.set(0.5,0.5,0.5);
    f2.material.uniforms.uSunRadiance.value.set(0,0,0);
    const sc=new THREE.Scene(); sc.add(f2.mesh);
    const c2=new THREE.PerspectiveCamera(FOV,1,0.1,2000); c2.position.set(0,0,0);
    updateTerrainFieldEye(f2,c2);
    const rt2=new THREE.WebGLRenderTarget(W,H,{format:THREE.RGBAFormat,
      type:THREE.UnsignedByteType,minFilter:THREE.NearestFilter,
      magFilter:THREE.NearestFilter,depthBuffer:true});
    const b2=new Uint8Array(W*H*4); const tv=Math.tan((FOV/2)*Math.PI/180);
    const ds=[];
    for(let v=0;v<VIEWS;v++){
      const ar=(v/VIEWS)*360*Math.PI/180, pr=PITCH*Math.PI/180;
      c2.up.set(0,1,0);
      c2.lookAt(Math.cos(pr)*Math.sin(ar),Math.sin(pr),-Math.cos(pr)*Math.cos(ar));
      c2.updateMatrixWorld(true);
      renderer.setRenderTarget(rt2); renderer.clear(); renderer.render(sc,c2);
      renderer.readRenderTargetPixels(rt2,0,0,W,H,b2); renderer.setRenderTarget(null);
      for(let x=0;x<W;x++){
        let top=-1; for(let y=H-1;y>=0;y--){ if(b2[(y*W+x)*4+3]>128){top=y;break;} }
        if(top<0) continue;
        const dc=new THREE.Vector3((((x+0.5)/W)*2-1)*tv, (((top+1)/H)*2-1)*tv, -1)
          .normalize().applyQuaternion(c2.quaternion);
        const g=Math.asin(Math.max(-1,Math.min(1,dc.y)))*180/Math.PI;
        ds.push(Math.abs(g-COLS[v*W+x].ref));
      }
    }
    ds.sort((a,b)=>a-b);
    살훑기.push({살:sp, 삼각형:(FIELD_RINGS-1)*sp*2, 방위간격:+(360/sp).toFixed(3),
                중앙:+ds[ds.length>>1].toFixed(3), 최대:+ds[ds.length-1].toFixed(3),
                p90:+ds[Math.floor(ds.length*0.9)].toFixed(3)});
    rt2.dispose(); f2.dispose();
  }

  const field = createTerrainField({ patch, eyeHeightM: EYE });
  // ⚠ 가장자리 페이드를 꺼서 실루엣만 봅니다 (윗주석 참고).
  field.material.uniforms.uFarM.value = 1e9;
  // 실루엣만 보면 되므로 칠은 확실히 구분되게 둡니다.
  field.material.uniforms.uSurfaceIrr.value.set(0.5,0.5,0.5);
  field.material.uniforms.uSunRadiance.value.set(0,0,0);

  const scene=new THREE.Scene(); scene.add(field.mesh);
  const cam=new THREE.PerspectiveCamera(FOV, 1, 0.1, 2000);
  cam.position.set(0,0,0);
  updateTerrainFieldEye(field, cam);

  const rt=new THREE.WebGLRenderTarget(W,H,{
    format:THREE.RGBAFormat, type:THREE.UnsignedByteType,
    minFilter:THREE.NearestFilter, magFilter:THREE.NearestFilter, depthBuffer:true });
  const buf=new Uint8Array(W*H*4);
  const tanV=Math.tan((FOV/2)*Math.PI/180);

  const rows=[], 매핑=[];
  for (let v=0; v<VIEWS; v++){
    const azDeg=(v/VIEWS)*360, azRad=azDeg*Math.PI/180;
    const pit=PITCH*Math.PI/180;
    cam.up.set(0,1,0);
    cam.lookAt(Math.cos(pit)*Math.sin(azRad), Math.sin(pit), -Math.cos(pit)*Math.cos(azRad));
    cam.updateMatrixWorld(true);
    renderer.setRenderTarget(rt); renderer.clear(); renderer.render(scene,cam);
    renderer.readRenderTargetPixels(rt,0,0,W,H,buf);
    renderer.setRenderTarget(null); renderer.render(scene,cam);

    // 눈으로도 볼 수 있게 한 장 남깁니다.
    if (v===0 || v===3){
      const c=document.createElement('canvas'); c.width=W; c.height=H;
      c.style.width=W+'px'; c.style.height=(H/2)+'px';
      c.getContext('2d').drawImage(canvas,0,0);
      document.getElementById('shots').appendChild(c);
    }

    for (let x=0; x<W; x++){
      // readRenderTargetPixels 는 아래에서 위로 옵니다. 맨 위 지형 화소 =
      // 알파가 있는 가장 큰 y.
      let top=-1;
      for (let y=H-1; y>=0; y--){ if (buf[(y*W+x)*4+3] > 128){ top=y; break; } }
      const col=COLS[v*W+x];
      let got=null;
      if (top>=0){
        // 화소 위쪽 경계를 씁니다 — 실루엣은 그 화소의 윗변이니까요.
        const ndcY = ((top+1)/H)*2 - 1;
        // 카메라가 pitch 만큼 기울어 있으므로 카메라 기준 방향을 월드로 돌립니다.
        const dirCam = new THREE.Vector3(
          (((x+0.5)/W)*2-1)*tanV, ndcY*tanV, -1).normalize();
        const dirW = dirCam.applyQuaternion(cam.quaternion);
        got = Math.asin(Math.max(-1,Math.min(1,dirW.y)))*180/Math.PI;
      }
      // 직접 대조: 이 열의 실제 광선 방위 (카메라에서 뽑은 것) 대 Node 가
      // 계산한 방위. 상관으로 어긋남을 추측하지 말고 매핑 자체를 봅니다.
      if (x===0 || x===(W>>1) || x===W-1){
        const dc=new THREE.Vector3((((x+0.5)/W)*2-1)*tanV, 0, -1).normalize()
          .applyQuaternion(cam.quaternion);
        let a=Math.atan2(dc.x,-dc.z)*180/Math.PI; if(a<0)a+=360;
        매핑.push({v,x,node:col.az,gpu:+a.toFixed(3)});
      }
      rows.push({ v, x, az: col.az, ref: col.ref, dense: col.dense,
                  got: got===null?null:+got.toFixed(4),
                  diff: got===null?null:+(got-col.ref).toFixed(4) });
    }
  }

  const hit=rows.filter(r=>r.got!==null);
  const d=hit.map(r=>Math.abs(r.diff)).sort((a,b)=>a-b);
  const mean=a=>a.reduce((x,y)=>x+y,0)/a.length;
  const corr=(a,b)=>{const ma=mean(a),mb=mean(b);let n=0,da=0,db=0;
    for(let i=0;i<a.length;i++){n+=(a[i]-ma)*(b[i]-mb);da+=(a[i]-ma)**2;db+=(b[i]-mb)**2;}
    return n/Math.sqrt(da*db);};
  결과={
    삼각형: (FIELD_RINGS-1)*FIELD_SPOKES*2,
    고리: FIELD_RINGS, 살: FIELD_SPOKES,
    방위해상도: +(360/(VIEWS*W)).toFixed(4),
    행해상도: +(FOV/H).toFixed(4),
    열: rows.length, 지형이잡힌열: hit.length,
    중앙오차: +d[d.length>>1].toFixed(4),
    최대오차: +d[d.length-1].toFixed(4),
    상관: +corr(hit.map(r=>r.ref), hit.map(r=>r.got)).toFixed(5),
    치우침: +mean(hit.map(r=>r.diff)).toFixed(4),
    참조범위: [+Math.min(...hit.map(r=>r.ref)).toFixed(3), +Math.max(...hit.map(r=>r.ref)).toFixed(3)],
    화면범위: [+Math.min(...hit.map(r=>r.got)).toFixed(3), +Math.max(...hit.map(r=>r.got)).toFixed(3)],
    매핑, 살훑기, 평판, 넘겨주기,
    표: rows,
  };
  document.getElementById('out').innerHTML =
    '<p>열 '+rows.length+' · 지형 잡힘 '+hit.length+' · 중앙 '+결과.중앙오차
    +'° · 최대 '+결과.최대오차+'° · 상관 '+결과.상관+' · 치우침 '+결과.치우침+'°</p>';
}

window.__stats={ glError: renderer.getContext().getError(), 결과 };
window.__errors=errors;
document.title='DONE::'+(errors.length?'ERR':'OK')+'::'+renderer.getContext().getError();
</script></body></html>`;

  fs.mkdirSync(PREVIEW, { recursive: true });
  fs.writeFileSync(path.join(PREVIEW, 'terrain-field.html'), html);
  console.log('생성 완료: terrain-field.html');
})();
