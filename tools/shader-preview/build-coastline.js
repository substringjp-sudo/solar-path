/**
 * **해안선이 마스크가 아니라 기하인가** (docs/COASTLINE_PLAN.md 4단계).
 *
 * 땅과 물을 각각 진짜 면으로 두면 해안선은 **두 면의 교선**입니다. 따로
 * 그리지 않아도 만·곶·섬이 제 모양으로 나오고, 방위 해상도 12° 라는 한계
 * 자체가 사라집니다. 그게 정말 그런지 재는 판정입니다.
 *
 * ## 재는 법
 *
 * 땅을 빨강, 물을 파랑으로 칠해 12방향 × 30° 로 한 바퀴를 찍습니다. 각 화소
 * 열에서 위에서 아래로 훑어 **땅↔물 구간**을 뽑습니다. 참조는 같은 방위로
 * CPU 광선행진을 한 결과입니다:
 *
 *     바다각(d) = atan2(0 − 눈높이 − d²/2R, d)        ← 어디에나 있음
 *     지면각(d) = atan2(고도(d) − 눈높이 − d²/2R, d)  ← 격자 안에만
 *     보이는각(d) = max(둘),  종류 = 큰 쪽
 *     d 를 키우며 보이는각이 지금까지의 최대를 넘을 때만 보입니다
 *
 * 이 행진은 **가림까지** 포함합니다 — 3km 앞 산이 20km 뒤 바다를 가리는 것이
 * 저절로 나옵니다. 마스크로는 이 구조가 안 나옵니다.
 *
 * ## 대조
 *
 * ① **수평선 (손으로 푼 답).** 땅이 하나도 안 걸리는 방위에서 맨 위 물의
 *    각은 정확히 −dip 여야 합니다 (dip = acos(R/(R+눈높이))).
 * ② **전환 수.** 한 광선에서 땅↔물이 여러 번 바뀌는 방위가 있어야 합니다
 *    (섬·만). 방위 31개짜리 마스크로는 못 만드는 구조입니다.
 * ③ **방위 세밀도.** "이 방위에 물 위로 땅이 보이는가"가 한 바퀴 도는 동안
 *    몇 번 바뀌는지 셉니다. 31표본 마스크의 상한과 견줍니다.
 *
 * 사용: node tools/shader-preview/build-coastline.js
 *       node tools/shader-preview/verify-coastline.js
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const { PREVIEW } = require('./paths');
const { demZoomForRadius, pickBlockOrigin, tileSpanMetres,
        lonLatToTileFloat, makeCpuDem } = require('./dem-cpu');

/**
 * 대부도 서안 — **바다가 실제로 보이는** 자리입니다.
 *
 * ⚠ 처음에 1·2단계와 같은 점(37.25, 126.58)을 썼다가 판정이 통째로 헛돌았습니다.
 * 그 자리는 고도 42m 인데 사방이 더 높아, 어느 방위로도 물이 안 보입니다
 * (1km 앞 지면이 45.2m 로 눈보다 1.6m 높아 그 너머를 다 가립니다).
 * 그러면 "해안선이 교선인가"를 물을 대상 자체가 없습니다.
 *
 * 그래서 DEM 을 훑어 **고도 1~30m 이면서 바다와 뭍이 같이 보이는** 점을
 * 골랐습니다: 72방위 중 47방위에서 바다와 뭍이 둘 다 보이고, 그 47방위
 * 전부가 한 광선에서 **2회 이상** 땅↔물을 오갑니다 (섬·만).
 */
const LAT = 37.24102, LON = 126.55969;
const BLOCK = 3;
const EYE_M = 1.6;
const FIELD_FAR_M = 3000, RINGS = 152;  // 발밑 24 + 바깥 128
const EARTH_R = 6371000;

const VIEWS = 12, FOV_DEG = 30, W = 128, H = 512, PITCH_DEG = 5;

// ⚠ groundProjection.ts 의 ringDistanceM 과 **같은 식** 이어야 합니다.
//    (참조가 메시와 다른 거리를 훑으면 표본 차이를 결함으로 잘못 읽습니다.)
const FOOT_M = 0.6, HINGE_M = 12, INNER_RINGS = 24;
const logStep = (k, n, a, b) => a * Math.pow(b / a, n <= 1 ? 0 : k / (n - 1));
const ringDist = (k, rings) => {
  const inner = Math.min(INNER_RINGS, Math.max(0, rings - 2));
  return k < inner ? logStep(k, inner + 1, FOOT_M, HINGE_M)
                   : logStep(k - inner, rings - inner, HINGE_M, FIELD_FAR_M);
};

const get = (url) => new Promise((res, rej) => {
  https.get(url, r => {
    if (r.statusCode !== 200) { rej(new Error(`HTTP ${r.statusCode} ${url}`)); r.resume(); return; }
    const c = []; r.on('data', d => c.push(d)); r.on('end', () => res(Buffer.concat(c)));
  }).on('error', rej);
});

const norm = v => { const L = Math.hypot(...v); return v.map(x => x / L); };
const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];

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
  const dipDeg = (Math.acos(EARTH_R / (EARTH_R + eye)) * 180) / Math.PI;
  const dHor = Math.sqrt(2 * EARTH_R * eye);
  console.log(`줌 ${zoom} · 발밑 ${OBS.toFixed(2)}m · 눈 ${eye.toFixed(2)}m`);
  console.log(`수평선 ${(-dipDeg).toFixed(4)}° · 수평선 거리 ${(dHor/1000).toFixed(2)}km · 격자 ${FIELD_FAR_M/1000}km`);

  const seaAngle = d => (Math.atan2(-eye - (d * d) / (2 * EARTH_R), d) * 180) / Math.PI;

  /** 한 방위의 **보이는 구간**을 d 오름차순(= 각 오름차순)으로 냅니다. */
  function march(azRad) {
    const out = [];
    let maxA = -Infinity;
    const push = (d, a, type) => {
      if (a <= maxA) return;
      maxA = a;
      out.push({ d, a, type });
    };
    // 격자 안: 땅과 물 중 높은 쪽
    for (let k = 0; k < RINGS; k++) {
      const d = ringDist(k, RINGS);
      const h = dem.elevAtGround(Math.sin(azRad) * d, -Math.cos(azRad) * d);
      const aS = seaAngle(d);
      const aT = h === null ? -Infinity
        : (Math.atan2(h - eye - (d * d) / (2 * EARTH_R), d) * 180) / Math.PI;
      if (aT >= aS) push(d, aT, 'land'); else push(d, aS, 'sea');
    }
    // 격자 밖: 바다뿐. 수평선까지 로그 간격으로.
    const outerN = 256;
    for (let i = 1; i <= outerN; i++) {
      const d = FIELD_FAR_M * Math.pow(dHor / FIELD_FAR_M, i / outerN);
      push(d, seaAngle(d), 'sea');
    }
    return out;
  }

  // ── 열 → 방위 · 화면 세로창 · 참조 구간 ──────────────────────────────
  const tanV = Math.tan((FOV_DEG / 2) * Math.PI / 180);
  const cols = [];
  for (let v = 0; v < VIEWS; v++) {
    const a = (v / VIEWS) * 2 * Math.PI, p = (PITCH_DEG * Math.PI) / 180;
    const F = [Math.cos(p) * Math.sin(a), Math.sin(p), -Math.cos(p) * Math.cos(a)];
    const R = [Math.cos(a), 0, Math.sin(a)];
    const U = cross(F.map(x => -x), R);
    for (let x = 0; x < W; x++) {
      const nx = ((x + 0.5) / W) * 2 - 1;
      const ray = ny => {
        const d = norm([
          nx * tanV * R[0] + ny * tanV * U[0] + F[0],
          nx * tanV * R[1] + ny * tanV * U[1] + F[1],
          nx * tanV * R[2] + ny * tanV * U[2] + F[2]]);
        return { az: Math.atan2(d[0], -d[2]), el: (Math.asin(d[1]) * 180) / Math.PI };
      };
      const top = ray(1), bot = ray(-1), mid = ray(0);
      const segs = march(mid.az).filter(s => s.a >= bot.el && s.a <= top.el);
      let 전환 = 0;
      for (let i = 1; i < segs.length; i++) if (segs[i].type !== segs[i - 1].type) 전환++;
      const seaSegs = segs.filter(s => s.type === 'sea');
      const landSegs = segs.filter(s => s.type === 'land');
      // 화소 단위로 견주려고 **경계만** 넘깁니다 (고리 전체는 3MB 가 됩니다).
      // 첫 항목이 가장 낮은 보이는 표본이고, 이후는 종류가 바뀌는 자리입니다.
      const 경계 = [];
      segs.forEach((s2, i) => {
        if (i === 0 || s2.type !== segs[i - 1].type) {
          경계.push([+s2.a.toFixed(4), s2.type === 'land' ? 1 : 0]);
        }
      });
      const dbg = (v === 0 && (x === 32 || x === 64)) ? segs.map(s2 => ({
        d: +s2.d.toFixed(0), a: +s2.a.toFixed(3), t: s2.type })) : undefined;
      cols.push({
        dbg, 경계,
        // ⚠ 경계 목록의 마지막은 마지막 **종류 변화**이지 맨 위가 아닙니다.
        //   하늘 시작점은 따로 넘겨야 합니다 (여기를 헷갈려 하늘 일치율이
        //   0.77 로 나왔습니다 — 측정 잘못이지 렌더 잘못이 아니었습니다).
        맨위: segs.length ? +segs[segs.length - 1].a.toFixed(4) : null,
        v, x,
        az: +(((mid.az * 180) / Math.PI + 360) % 360).toFixed(3),
        창: [+bot.el.toFixed(3), +top.el.toFixed(3)],
        바다맨위: seaSegs.length ? +seaSegs[seaSegs.length - 1].a.toFixed(4) : null,
        땅맨위: landSegs.length ? +landSegs[landSegs.length - 1].a.toFixed(4) : null,
        전환,
        // ⚠ "땅이 보이는가"는 쓸모가 없습니다 — 발밑이 늘 땅이라 항상 참입니다.
        //   쓸 만한 신호는 **그 방위에서 맨 위에 있는 것이 물인가** 입니다.
        //   물이 맨 위면 그 위를 가리는 것이 없다는 뜻이고, 바다는 수평선까지
        //   이어지므로 그 각은 정확히 −dip 이어야 합니다 (대조 ①).
        바다최상단: (seaSegs.length && (!landSegs.length ||
          seaSegs[seaSegs.length - 1].a > landSegs[landSegs.length - 1].a)) ? 1 : 0,
      });
    }
  }

  const 바다맨위열 = cols.filter(c => c.바다최상단).length;
  let 방위전환 = 0;
  for (let i = 0; i < cols.length; i++) {
    const j = (i + 1) % cols.length;
    if (cols[i].바다최상단 !== cols[j].바다최상단) 방위전환++;
  }
  const 다중 = cols.filter(c => c.전환 >= 2).length;
  let 전환변화 = 0;
  for (let i = 0; i < cols.length; i++) {
    if (cols[i].전환 !== cols[(i + 1) % cols.length].전환) 전환변화++;
  }
  console.log(`전환 수가 방위를 따라 바뀌는 횟수 ${전환변화}회`);
  console.log(`열 ${cols.length} · 맨 위가 물인 열 ${바다맨위열}`);
  console.log(`한 바퀴 도는 동안 수평선 종류가 바뀌는 횟수 ${방위전환}회 (31방위 마스크 상한 31회)`);
  console.log(`한 광선에서 2회 이상 땅↔물을 오가는 열 ${다중}개`);
  const 열린각 = cols.filter(c => c.바다최상단).map(c => c.바다맨위);
  if (열린각.length) {
    console.log(`  그 열들의 물 맨위 ${Math.min(...열린각).toFixed(4)}° ~ ${Math.max(...열린각).toFixed(4)}° (이론 ${(-dipDeg).toFixed(4)}°)`);
  }

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
 body{margin:0;background:#0b0f15;font-family:sans-serif;color:#dde}
 #wrap{padding:12px;width:1100px} h3{font-size:14px;margin:6px 0}
 canvas{border:1px solid #345;margin:4px 2px 0 0} p{font:11px monospace}
</style></head><body>
<div id="wrap">
<h3>해안선 — 땅(빨강)과 물(파랑)이 만나는 자리</h3>
<div id="shots"></div><div id="out"></div></div>
<script type="module">
import * as THREE from './app/vendor/three.module.js';
import { loadDemPatch } from './app/utils/demTiles.js';
import { createTerrainField, updateTerrainFieldEye }
  from './app/components/SkyScene3D/TerrainField.js';
import { createSeaPlane, updateSeaPlaneEye }
  from './app/components/SkyScene3D/SeaPlane.js';

const errors=[]; const oe=console.error; console.error=(...a)=>{errors.push(a.join(' ')); oe(...a);};
window.addEventListener('error', e=>errors.push(String(e.message)));

const LAT=${LAT}, LON=${LON}, BLOCK=${BLOCK}, FAR=${FIELD_FAR_M}, EYE=${EYE_M};
const VIEWS=${VIEWS}, FOV=${FOV_DEG}, W=${W}, H=${H}, PITCH=${PITCH_DEG};
const COLS=${JSON.stringify(cols)};
const 참조={다중전환열:${다중}, 전환변화:${전환변화}, 방위전환:${방위전환}, 맨위가물인열:${바다맨위열}};

const canvas=document.createElement('canvas'); canvas.width=W; canvas.height=H;
const renderer=new THREE.WebGLRenderer({canvas, antialias:false, alpha:true});
renderer.setPixelRatio(1); renderer.setSize(W,H,false);
renderer.setClearColor(0x000000, 0);

const loadTexture=(url)=>new Promise((res,rej)=>{ new THREE.TextureLoader().load(url,res,undefined,rej); });
const patch = await loadDemPatch(LAT, LON, FAR, {
  renderer, loadTexture, block: BLOCK, tileUrl:(z,x,y)=>\`./dem/\${z}_\${x}_\${y}.png\`,
});

let 결과=null;
if (patch) {
  // 땅은 빨강, 물은 파랑 — 화소로 종류를 가르려고 알베도만 바꿉니다.
  const land = createTerrainField({ patch, eyeHeightM: EYE, albedo:{r:1,g:0,b:0} });
  land.material.uniforms.uSurfaceIrr.value.set(1,1,1);
  land.material.uniforms.uSunRadiance.value.set(0,0,0);
  const sea = createSeaPlane({ patch, eyeHeightM: EYE, waterAlbedo:{r:0,g:0,b:1} });
  sea.material.uniforms.uSurfaceIrr.value.set(1,1,1);

  const scene=new THREE.Scene(); scene.add(sea.mesh); scene.add(land.mesh);
  const cam=new THREE.PerspectiveCamera(FOV,1,0.1,2000); cam.position.set(0,0,0);
  updateTerrainFieldEye(land, cam); updateSeaPlaneEye(sea, cam);

  const rt=new THREE.WebGLRenderTarget(W,H,{format:THREE.RGBAFormat,
    type:THREE.UnsignedByteType, minFilter:THREE.NearestFilter,
    magFilter:THREE.NearestFilter, depthBuffer:true});
  const buf=new Uint8Array(W*H*4); const tanV=Math.tan((FOV/2)*Math.PI/180);

  const rows=[]; let 미분류=0, 빈화소=0;
  for (let v=0; v<VIEWS; v++){
    const ar=(v/VIEWS)*2*Math.PI, pr=PITCH*Math.PI/180;
    cam.up.set(0,1,0);
    cam.lookAt(Math.cos(pr)*Math.sin(ar), Math.sin(pr), -Math.cos(pr)*Math.cos(ar));
    cam.updateMatrixWorld(true);
    renderer.setRenderTarget(rt); renderer.clear(); renderer.render(scene,cam);
    renderer.readRenderTargetPixels(rt,0,0,W,H,buf);
    renderer.setRenderTarget(null); renderer.render(scene,cam);
    if (v===8||v===9){ const c=document.createElement('canvas'); c.width=W; c.height=H;
      c.style.width=W+'px'; c.style.height=(H/2)+'px';
      c.getContext('2d').drawImage(canvas,0,0);
      document.getElementById('shots').appendChild(c); }

    const angleOf=(x,y)=>{
      const d=new THREE.Vector3((((x+0.5)/W)*2-1)*tanV, ((y/H)*2-1)*tanV, -1)
        .normalize().applyQuaternion(cam.quaternion);
      return Math.asin(Math.max(-1,Math.min(1,d.y)))*180/Math.PI;
    };
    for (let x=0;x<W;x++){
      // 위에서 아래로 훑어 구간을 뽑습니다.
      const runs=[]; let 바다맨위=null, 땅맨위=null;
      const dbg=(v===0&&(x===32||x===64))?[]:null;
      const B=COLS[v*W+x].경계;
      // 각 θ 에서 참조가 말하는 종류 (마지막 경계의 종류). B 는 각 오름차순.
      const 참조종류=(th)=>{ let t=null; for(let i=0;i<B.length;i++){
        if(B[i][0]<=th) t=B[i][1]; else break; } return t; };
      let 맞음=0, 틀림=0, 하늘맞음=0, 하늘틀림=0;
      const 참조맨위 = COLS[v*W+x].맨위===null ? -1e9 : COLS[v*W+x].맨위;
      for (let y=H-1;y>=0;y--){
        const o=(y*W+x)*4, a=buf[o+3], r=buf[o], bl=buf[o+2];
        let k;
        if (a<=128) { 빈화소++; k=null; }
        else if (r>128 && r>=bl) k='land';
        else if (bl>128) k='sea';
        else { 미분류++; k=null; }
        // 화소 단위 대조 — 화소 가운데 각으로 봅니다.
        {
          const th=angleOf(x,y+0.5);
          const ref=참조종류(th);
          if (th>참조맨위+0.06){ if(k===null)하늘맞음++; else 하늘틀림++; }
          else if (ref!==null && k!==null){ if((k==='land')===(ref===1))맞음++; else 틀림++; }
        }
        if (k===null) continue;
        if (k==='sea' && 바다맨위===null) 바다맨위=angleOf(x,y+1);
        if (k==='land' && 땅맨위===null) 땅맨위=angleOf(x,y+1);
        if (!runs.length || runs[runs.length-1]!==k) {
          runs.push(k);
          if (dbg) dbg.push({ a:+angleOf(x,y+1).toFixed(3), t:k });
        }
      }
      const col=COLS[v*W+x];
      rows.push({ v, x, az:col.az,
        바다맨위참조:col.바다맨위, 바다맨위:바다맨위===null?null:+바다맨위.toFixed(4),
        땅맨위참조:col.땅맨위, 땅맨위:땅맨위===null?null:+땅맨위.toFixed(4),
        전환참조:col.전환, 전환:Math.max(0,runs.length-1), 바다최상단:col.바다최상단,
        맞음, 틀림, 하늘맞음, 하늘틀림,
        dbg: dbg||undefined, dbg참조: col.dbg });
    }
  }

  const num=a=>a.filter(x=>x!==null&&Number.isFinite(x));
  const med=a=>{const s=[...a].sort((x,y)=>x-y);return s.length?s[s.length>>1]:null;};
  const 바다차=num(rows.map(r=>(r.바다맨위!==null&&r.바다맨위참조!==null)?Math.abs(r.바다맨위-r.바다맨위참조):null));
  const 땅차=num(rows.map(r=>(r.땅맨위!==null&&r.땅맨위참조!==null)?Math.abs(r.땅맨위-r.땅맨위참조):null));
  const 전환일치=rows.filter(r=>r.전환===r.전환참조).length;
  // 대조 ①: 땅이 안 걸리는 방위의 맨 위 물 = −dip
  const 열린=rows.filter(r=>r.바다최상단 && r.바다맨위!==null).map(r=>r.바다맨위);
  결과={
    열: rows.length, 미분류, 빈화소,
    바다맨위중앙: med(바다차)===null?null:+med(바다차).toFixed(4),
    바다맨위최대: 바다차.length?+Math.max(...바다차).toFixed(4):null,
    땅맨위중앙: med(땅차)===null?null:+med(땅차).toFixed(4),
    땅맨위최대: 땅차.length?+Math.max(...땅차).toFixed(4):null,
    전환일치: 전환일치, 전환열: rows.length,
    화소맞음: rows.reduce((a,r)=>a+r.맞음,0),
    화소틀림: rows.reduce((a,r)=>a+r.틀림,0),
    하늘맞음: rows.reduce((a,r)=>a+r.하늘맞음,0),
    하늘틀림: rows.reduce((a,r)=>a+r.하늘틀림,0),
    다중전환열: rows.filter(r=>r.전환>=2).length,
    방위전환: (()=>{let n=0;for(let i=0;i<rows.length;i++){
      const j=(i+1)%rows.length; if(rows[i].바다최상단!==rows[j].바다최상단)n++;} return n;})(),
    열린바다열: 열린.length,
    열린바다맨위: 열린.length?+ (열린.reduce((a,b)=>a+b,0)/열린.length).toFixed(4):null,
    열린바다폭: 열린.length?+(Math.max(...열린)-Math.min(...열린)).toFixed(4):null,
    수평선이론: ${(-dipDeg).toFixed(4)},
    수평선거리km: ${(dHor/1000).toFixed(2)},
    참조,
    표: rows,
  };
  결과.화소일치율=+(결과.화소맞음/(결과.화소맞음+결과.화소틀림)).toFixed(5);
  결과.하늘일치율=+(결과.하늘맞음/(결과.하늘맞음+결과.하늘틀림)).toFixed(5);
  document.getElementById('out').innerHTML='<p>화소일치 '+(결과.화소일치율*100).toFixed(2)+'% · 열 '+rows.length
    +' · 물맨위 중앙 '+결과.바다맨위중앙+'° · 땅맨위 중앙 '+결과.땅맨위중앙
    +'° · 전환 일치 '+전환일치+'/'+rows.length
    +' · 열린바다 맨위 '+결과.열린바다맨위+'° (이론 '+결과.수평선이론+'°)</p>';
}

window.__stats={ glError: renderer.getContext().getError(), 결과 };
window.__errors=errors;
document.title='DONE::'+(errors.length?'ERR':'OK')+'::'+renderer.getContext().getError();
</script></body></html>`;

  fs.mkdirSync(PREVIEW, { recursive: true });
  fs.writeFileSync(path.join(PREVIEW, 'coastline.html'), html);
  console.log('생성 완료: coastline.html');
})();
