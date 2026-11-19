/**
 * **화면을 눌러 건물을 고르는 일이 맞는가** — 판정. 브라우저·네트워크가 필요 없습니다.
 *
 * `src/utils/buildingPick.ts`(시선과 건물 색인을 직접 맞춤) · `pickTarget.ts`(지형과 건물을 아우른 고르기)를 시험합니다.
 * 자는 따로 짠 느린 정답 — 시선을 1 m 걸음으로 걸으며 "이 점이 어느 건물 기둥(발자국 안, 아랫단~지붕) 안인가"를 직접 묻는 것 — 입니다.
 * 두 쪽이 같은 모형(건물 = 발자국 위에 선 기둥, 지반 = 중심의 높이 표본, 시선 높이 = 눈 + d·tan + 낙차)을 쓰므로, 이 판정이 지키는 것은
 * **교차 계산의 정확함**(고리 교차, 짝홀수, 벽·지붕 가름, 곡률, 오목한 모양)이고 모형 자체가 옳은지는 하네스 화면에서 봅니다.
 *
 * 먼저 정한 줄(실행 전):
 *  1. 무작위 세계(건물 700 채: 직사각·ㄱ자·원형, 높이 8~320 m, 5% 는 공중에 뜬 부분, 지반은 경사지) 에서 무작위 시선 800 개 —
 *     닿음/안 닿음이 **모두** 같고, 닿으면 같은 건물이며 거리 차 2.5 m 안(걸음 1 m 의 몫). 어긋남 0 이어야 합니다.
 *     (건물 두 채가 맞닿은 경계에서 번호만 갈리는 경우는 거리 차 2.5 m 안이면 같은 것으로 셉니다.)
 *  2. 결정적 사례: 벽 · 지붕 위로 지나감 · 내려오는 시선의 지붕 · 땅이 먼저 막음 · ㄱ자 틈 · 공중에 뜬 부분 아래 · 앞뒤 두 채 · 눈 뒤쪽 · 경사지 지반.
 *  3. 지붕 대표점은 늘 고리 **안**이고, 직사각·원은 무게중심과 0.05 m 안.
 *  4. 발자국 크기: 돌린 직사각 60×20 이 2% 안, 24각형(반지름 25)이 50 m ± 1.
 *  5. 색인 잇기: 둘을 이은 것에 쏜 결과가 따로 쏜 둘 중 가까운 쪽과 같다(건물 번호는 b 쪽이 a 개수만큼 밀림).
 *  6. 기하와 색인이 한 반복문에서 나옵니다: `buildMergedBuildingGeometry` 의 `pick.count` 가 `buildingCount`, 지붕 높이가 높이 추정과 같고,
 *     고리가 입력 발자국(미터)과 0.05 m 안, 중심이 `groundPos` 에 들어 있음. 먼 건물 잇기(`concatBuildingMeshData`)도 색인을 잇는다.
 *  7. 고르기 규칙: 건물이 땅보다 앞이면 건물, 먼(400 m 밖) 건물은 꼭대기가 기본 점·가까운 건물은 누른 자리, `snapBuildingTarget` 은 되돌릴 수
 *     있고 점 칸이 일치. 땅이 앞이면 지형(옛 규칙과 같은 수). 손끝 여유: 폭 20 m 건물이 10 km 에 있을 때 0.2° 빗나간 시선은 여유 0 이면 놓치고
 *     0.4° 면 잡음, 누른 곳이 400 m 안의 땅이면 여유가 있어도 지형. 하늘을 눌러도 위로 솟은 탑은 여유로 잡음.
 *  8. 빠르다: 6000 채에서 시선 하나 5 ms 안, 손끝 여유까지 포함한 한 번 고르기 150 ms 안.
 *  9. 잘못된 입력(빈 색인, NaN)에서 죽지 않는다.
 *
 * 사용: node tools/shader-preview/stage-esm.js
 *       node tools/shader-preview/verify-building-pick.js
 */
const path = require('path');
const { PREVIEW } = require('./paths');

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };
const RAD = Math.PI / 180;

// 재현 가능한 난수
let seed = 12345;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const rr = (a, b) => a + (b - a) * rnd();

(async () => {
  const BP = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'buildingPick.js'));
  const DP = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'demPick.js'));
  const PT = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'pickTarget.js'));
  const BT = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'buildingTiles.js'));
  const FL = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'farBuildingsLoad.js'));
  const E = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'earth.js'));
  const drop = E.curvatureDropM;

  // ── 도우미: 모양 만들기 ──
  const rect = (cx, cz, w, d, rotDeg) => {
    const c = Math.cos(rotDeg * RAD), s = Math.sin(rotDeg * RAD);
    return [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].map(([x, z]) => ({ x: cx + x * c - z * s, z: cz + x * s + z * c }));
  };
  const lshape = (cx, cz, a, t, rotDeg) => {   // 한 변 a, 두께 t 인 ㄱ자
    const c = Math.cos(rotDeg * RAD), s = Math.sin(rotDeg * RAD);
    return [[0, 0], [a, 0], [a, t], [t, t], [t, a], [0, a]].map(([x, z]) => ({ x: cx + (x - a / 3) * c - (z - a / 3) * s, z: cz + (x - a / 3) * s + (z - a / 3) * c }));
  };
  const circle = (cx, cz, r, n = 24) => Array.from({ length: n }, (_, i) => ({ x: cx + r * Math.cos((i / n) * 2 * Math.PI), z: cz + r * Math.sin((i / n) * 2 * Math.PI) }));
  const meanOf = (pts) => ({ x: pts.reduce((a, p) => a + p.x, 0) / pts.length, z: pts.reduce((a, p) => a + p.z, 0) / pts.length });

  const build = (list) => {   // list: { pts, topH, botH }
    const b = BP.createPickIndexBuilder();
    for (const it of list) { const m = meanOf(it.pts); b.add(m.x, m.z, it.topH, it.botH, it.pts); }
    return b.finish();
  };
  const flat = () => 0;                       // 평지 해발 0
  const flatS = (e, s) => 0;
  const EYE = 1.6;

  // ── 느린 정답 ──
  // 시선을 0.1 m 걸음으로 걸으며 점이 그 건물 기둥 안인지 직접 묻는다. 후보는 "시선 투영선이 건물의 외접원(정답이 고리 점에서 스스로 잼)
  // 을 지나는 건물"뿐이고, 각 후보는 그 외접원 구간(투영 ± 반지름)만 훑는다. 걸음을 1 m 로 하면 모서리를 스치는 짧은 닿음을 놓칩니다.
  const makeOracle = (idx, sample) => {
    const own = [];   // 정답이 스스로 잰 외접원
    for (let b = 0; b < idx.count; b++) {
      const s0 = idx.ringStart[b], s1 = idx.ringStart[b + 1];
      let mx = 0, mz = 0;
      for (let j = s0; j < s1; j++) { mx += idx.ring[2 * j]; mz += idx.ring[2 * j + 1]; }
      mx /= (s1 - s0); mz /= (s1 - s0);
      let r = 0;
      for (let j = s0; j < s1; j++) r = Math.max(r, Math.hypot(idx.ring[2 * j] - mx, idx.ring[2 * j + 1] - mz));
      own.push({ mx, mz, r });
    }
    const inside = (b, x, z) => {
      const s0 = idx.ringStart[b], s1 = idx.ringStart[b + 1];
      let ins = false;
      for (let j = s0, k = s1 - 1; j < s1; k = j++) {
        const xj = idx.ring[2 * j], zj = idx.ring[2 * j + 1], xk = idx.ring[2 * k], zk = idx.ring[2 * k + 1];
        if ((zj > z) !== (zk > z) && x < ((xk - xj) * (z - zj)) / (zk - zj) + xj) ins = !ins;
      }
      return ins;
    };
    const baseOf = new Map();
    const base = (b) => { if (!baseOf.has(b)) baseOf.set(b, sample(idx.cx[b], idx.cz[b])); return baseOf.get(b); };
    return (eyeM, az, el, maxD = 40000) => {
      const dx = Math.sin(az * RAD), dz = -Math.cos(az * RAD), tan = Math.tan(el * RAD);
      let best = null;
      for (let b = 0; b < idx.count; b++) {
        const o = own[b];
        const along = o.mx * dx + o.mz * dz, perp = Math.abs(o.mx * dz - o.mz * dx);
        if (perp > o.r + 1) continue;
        const t0 = Math.max(3, along - o.r - 1), t1 = Math.min(maxD, along + o.r + 1);
        if (t1 <= t0 || (best && t0 > best.distM)) continue;
        const bs = base(b);
        if (bs == null) continue;
        // 기둥 안으로 "들어오는 순간"의 높이로 상태를 가른다. 공중에 뜬 부분의 바닥은 기하에 없어(그려지지 않음) 밑으로 들어온 시선은 닿지 않고,
        // 지붕 위로 들어온 시선은 안쪽을 지나며 지붕 높이까지 내려오면 지붕에 닿는다.
        const top = bs + idx.topH[b], bot = bs + idx.botH[b];
        let state = 0;   // 0 밖 · 1 지붕 위로 들어옴 · 2 밑으로 들어옴
        for (let d = t0; d <= t1; d += 0.1) {
          if (best && d >= best.distM) break;
          const x = d * dx, z = d * dz;
          if (!inside(b, x, z)) { state = 0; continue; }
          const zr = eyeM + d * tan + drop(d);
          if (state === 0) {
            if (zr > top) state = 1;
            else if (zr < bot) state = 2;
            else { best = { index: b, distM: d, elevM: zr }; break; }
          } else if (state === 1 && zr <= top) { best = { index: b, distM: d, elevM: zr }; break; }
        }
      }
      return best;
    };
  };

  // ── [1] 무작위 세계 ──
  console.log('\n[1] 무작위 세계 · 무작위 시선 — 느린 정답과 견줌');
  {
    const slope = (e, s) => 30 + 0.02 * e + 8 * Math.sin(s / 700);   // 경사지(동으로 오르고 남북으로 물결)
    const list = [];
    for (let i = 0; i < 700; i++) {
      const az = rnd() * 360, dist = Math.exp(rr(Math.log(120), Math.log(12000)));
      const cx = Math.sin(az * RAD) * dist, cz = -Math.cos(az * RAD) * dist;
      const kind = rnd();
      const rot = rnd() * 180;
      const pts = kind < 0.55 ? rect(cx, cz, rr(12, 70), rr(12, 70), rot) : kind < 0.8 ? lshape(cx, cz, rr(30, 90), rr(10, 22), rot) : circle(cx, cz, rr(8, 35), 16);
      const topH = rnd() < 0.15 ? rr(100, 320) : rr(8, 80);
      const floating = rnd() < 0.05;
      list.push({ pts, topH, botH: floating ? Math.min(topH - 3, rr(8, 40)) : -5 });
    }
    const idx = build(list);
    const eye = slope(0, 0) + EYE;
    const oracle = makeOracle(idx, slope);
    let n = 0, mism = 0, hits = 0, bothNull = 0, wall = 0, roof = 0;
    const log = [];
    for (let k = 0; k < 800; k++) {
      let az, el, eyeM = eye;
      const mode = k % 4;
      if (mode === 0) { az = rnd() * 360; el = rnd() < 0.5 ? rr(-2, 30) : rr(30, 85); }   // 아무 데나(절반은 하늘 쪽)
      else {
        const b = Math.floor(rnd() * idx.count);
        const x = idx.cx[b], z = idx.cz[b], d = Math.hypot(x, z);
        az = ((Math.atan2(x, -z) / RAD) + 360) % 360 + rr(-1, 1) * Math.min(3, (idx.rad[b] / d) / RAD * 1.3);
        const bs = slope(x, z);
        if (mode === 1) {                                                    // 높은 눈에서 지붕 쪽으로 내려오는 시선
          eyeM = eye + rr(80, 250);
          const aim = bs + idx.topH[b] + rr(-3, 3);
          el = Math.atan2(aim - eyeM - drop(d), d) / RAD;
        } else {                                                             // 눈높이에서 밑동~지붕 위 25 m 사이
          const lo = Math.atan2(bs - 6 - eye - drop(d), d) / RAD, hi = Math.atan2(bs + idx.topH[b] + 25 - eye - drop(d), d) / RAD;
          el = rr(lo, hi);
        }
      }
      const got = BP.rayHitBuildings(idx, slope, eyeM, az, el);
      const ref = oracle(eyeM, az, el);
      n++;
      if (!got && !ref) { bothNull++; continue; }
      if (got) { hits++; if (got.part === 'wall') wall++; else roof++; }
      let good = false;
      if (got && ref) good = Math.abs(got.distM - ref.distM) <= 0.5;   // 번호가 달라도 거리가 같으면 맞닿은 두 채의 경계
      if (!good) {
        mism++;
        if (log.length < 6) log.push({ k, mode, az: az.toFixed(4), el: el.toFixed(5), eyeM: +eyeM.toFixed(2), got: got && { i: got.index, d: +got.distM.toFixed(2), p: got.part }, ref: ref && { i: ref.index, d: +ref.distM.toFixed(2) } });
      }
    }
    ok(hits >= 250 && bothNull >= 100, `시선 ${n} 개: 닿음 ${hits}(벽 ${wall} · 지붕 ${roof}) · 안 닿음 ${bothNull} — 두 경우가 다 충분히 섞여 있다`);
    ok(roof >= 15 && wall >= 100, `벽 ${wall} · 지붕 ${roof} 모두 나온다(지붕은 높은 눈에서 내려오는 시선으로 15 이상)`);
    ok(mism === 0, `닿음/안 닿음과 거리가 정답과 모두 같다 (거리 0.5 m 안, 어긋남 ${mism} / ${n})${mism ? ' ' + JSON.stringify(log) : ''}`);
  }

  // ── [2] 결정적 사례 ──
  console.log('\n[2] 결정적 사례');
  {
    // a. 평지: 동쪽 500 m, 40×40, 높이 100 m
    const idx = build([{ pts: rect(500, 0, 40, 40, 0), topH: 100, botH: -5 }]);
    const eyeA = EYE;
    const elTo = (zTarget, d) => Math.atan2(zTarget - eyeA - drop(d), d) / RAD;
    let h = BP.rayHitBuildings(idx, flat, eyeA, 90, elTo(50, 480));
    ok(h && h.part === 'wall' && Math.abs(h.distM - 480) < 0.5 && Math.abs(h.elevM - 50) < 0.3, `벽 가운데를 겨누면 벽에 닿는다 (거리 ${h && h.distM.toFixed(1)} 높이 ${h && h.elevM.toFixed(1)})`);
    h = BP.rayHitBuildings(idx, flat, eyeA, 90, elTo(120, 480));
    ok(h === null, '지붕보다 위로 올라가는 시선은 지나친다');
    h = BP.rayHitBuildings(idx, flat, eyeA, 90, elTo(99.5, 480));
    ok(h && h.part === 'wall', '지붕 바로 아래 0.5 m 는 벽');
    // 내려오는 시선: 눈 300 m
    h = BP.rayHitBuildings(idx, flat, 300, 90, Math.atan2(100 - 300, 500) / RAD);
    ok(h && h.part === 'roof' && Math.abs(h.elevM - 100) < 1e-6 && h.distM > 480 && h.distM < 520, `높은 눈에서 내려오는 시선은 지붕에 닿는다 (거리 ${h && h.distM.toFixed(1)})`);
    h = BP.rayHitBuildings(idx, flat, 300, 90, Math.atan2(100 - 300, 530) / RAD);
    ok(h === null, '지붕 뒤쪽 너머로 내려가는 시선(지붕 끝 520 m 를 지나서야 지붕 높이)은 안 닿는다');
    // 옆으로 비킴
    h = BP.rayHitBuildings(idx, flat, eyeA, 90 + 2.5, elTo(50, 480));
    ok(h === null, '발자국 밖으로 2.5° 비껴가면 안 닿는다(500 m 에서 22 m 옆)');
    // 눈 뒤쪽
    h = BP.rayHitBuildings(idx, flat, eyeA, 270, 0);
    ok(h === null, '눈 뒤쪽으로 쏘면 안 닿는다');
    // 땅이 먼저 막음 — 지형 고르기와 합쳐서(pickTargetAt)
    const t = PT.pickTargetAt({ sample: flat, eyeM: eyeA, azDeg: 90, elDeg: -0.2, buildings: idx });
    ok(t && t.kind === 'terrain' && t.distM < 470, `땅을 겨누면 건물이 아니라 지형이 고른다 (kind ${t && t.kind}, 거리 ${t && t.distM.toFixed(0)})`);
  }
  {
    // e. 눈 쪽으로 열린 ㄷ자(C 모양): 바깥 x 600~660 · z −30~30, 안쪽 비움 x 600~640 · z −15~15 (서쪽이 입구)
    const pts = [[600, -30], [660, -30], [660, 30], [600, 30], [600, 15], [640, 15], [640, -15], [600, -15]].map(([x, z]) => ({ x, z }));
    const idx = build([{ pts, topH: 40, botH: -5 }]);
    const az = (x, z) => ((Math.atan2(x, -z) / RAD) + 360) % 360;
    const el = (z, d) => Math.atan2(z - EYE - drop(d), d) / RAD;
    const through = BP.rayHitBuildings(idx, flat, EYE, az(620, 0), el(20, 620));
    ok(through && through.part === 'wall' && Math.abs(through.distM - 640) < 0.6, `ㄷ자 입구로 들어간 시선은 안쪽 뒷벽(640 m)에 닿는다 — 앞 팔(600 m)이 아니다 (거리 ${through && through.distM.toFixed(1)})`);
    const arm = BP.rayHitBuildings(idx, flat, EYE, az(600, -22), el(20, 600));
    ok(arm && Math.abs(arm.distM - 600) < 0.6, `팔(z −22)로 가는 시선은 바깥 앞면(600 m)에 닿는다 (거리 ${arm && arm.distM.toFixed(1)})`);
    const past = BP.rayHitBuildings(idx, flat, EYE, az(600, 40), el(20, 600));
    ok(past === null, '발자국 옆(z 40)으로 지나가는 시선은 안 닿는다');
  }
  {
    // f. 공중에 뜬 부분: 아랫단 30, 지붕 80
    const idx = build([{ pts: rect(800, 0, 50, 50, 0), topH: 80, botH: 30 }]);
    const el = (z, d) => Math.atan2(z - EYE - drop(d), d) / RAD;
    ok(BP.rayHitBuildings(idx, flat, EYE, 90, el(15, 775)) === null, '공중에 뜬 부분 아래(15 m)를 지나는 시선은 안 닿는다');
    const h = BP.rayHitBuildings(idx, flat, EYE, 90, el(50, 775));
    ok(h && h.part === 'wall' && Math.abs(h.elevM - 50) < 0.5, '그 부분의 벽 높이(50 m)는 닿는다');
    const h2 = BP.rayHitBuildings(idx, flat, 300, 90, Math.atan2(80 - 300, 810) / RAD);
    ok(h2 && h2.part === 'roof', '높은 눈에서 내려오면 그 부분의 지붕에 닿는다');
  }
  {
    // g. 앞뒤 두 채: 가까운 쪽이 이긴다
    const idx = build([
      { pts: rect(1200, 0, 40, 40, 0), topH: 200, botH: -5 },   // 뒤
      { pts: rect(700, 0, 40, 40, 0), topH: 90, botH: -5 },     // 앞
    ]);
    let h = BP.rayHitBuildings(idx, flat, EYE, 90, Math.atan2(40 - EYE - drop(680), 680) / RAD);
    ok(h && h.index === 1 && Math.abs(h.distM - 680) < 0.5, `앞 건물이 가려서 앞 건물(번호 1)이 닿는다 (번호 ${h && h.index}, 거리 ${h && h.distM.toFixed(1)})`);
    h = BP.rayHitBuildings(idx, flat, EYE, 90, Math.atan2(190 - EYE - drop(1180), 1180) / RAD);
    ok(h && h.index === 0 && Math.abs(h.elevM - 190) < 0.5, `앞 건물(90 m)의 지붕 위(680 m 에서 약 110 m)로 지나가 뒤 건물(번호 0)의 190 m 자리에 닿는다 (번호 ${h && h.index}, 높이 ${h && h.elevM.toFixed(1)})`);
  }
  {
    // i. 경사지 지반: 높이 표본 = 30 + 0.1·동쪽
    const slope = (e, s) => 30 + 0.1 * e;
    const idx = build([{ pts: rect(500, 0, 40, 40, 0), topH: 100, botH: -5 }]);
    const base = slope(500, 0);
    const eye = slope(0, 0) + EYE;
    const elTop = Math.atan2(base + 60 - eye - drop(480), 480) / RAD;   // 지반 위 60 m 자리를 겨냥
    const h = BP.rayHitBuildings(idx, slope, eye, 90, elTop);
    ok(h && Math.abs(h.baseElevM - base) < 1e-6 && Math.abs(h.topElevM - (base + 100)) < 1e-6 && Math.abs(h.elevM - (base + 60)) < 0.3, `경사지: 지반 ${base} · 지붕 ${base + 100} · 닿은 높이 ${h && h.elevM.toFixed(1)} (지반 중심의 표본 + 상대 높이)`);
    ok(BP.rayHitBuildings(idx, () => null, eye, 90, elTop) === null, '높이 표본이 없는 곳(null)의 건물은 건너뛴다');
  }

  // ── [3] 지붕 대표점 ──
  console.log('\n[3] 지붕 대표점');
  {
    let inside = 0, tot = 0, rectErr = 0, circErr = 0;
    const insideRing = (pts, x, z) => { let ins = false; for (let j = 0, k = pts.length - 1; j < pts.length; k = j++) { const a = pts[j], b = pts[k]; if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) ins = !ins; } return ins; };
    for (let i = 0; i < 300; i++) {
      const kind = i % 3;
      const pts = kind === 0 ? rect(rr(-500, 500), rr(-500, 500), rr(10, 80), rr(10, 80), rnd() * 180) : kind === 1 ? lshape(rr(-500, 500), rr(-500, 500), rr(30, 100), rr(6, 25), rnd() * 360) : circle(rr(-500, 500), rr(-500, 500), rr(8, 40), 24);
      const idx = build([{ pts, topH: 30, botH: -5 }]);
      const c = BP.roofCenter(idx, 0);
      tot++; if (insideRing(pts, c.x, c.z)) inside++;
      if (kind === 0) { const m = meanOf(pts); rectErr = Math.max(rectErr, Math.hypot(c.x - m.x, c.z - m.z)); }
      if (kind === 2) { const m = meanOf(pts); circErr = Math.max(circErr, Math.hypot(c.x - m.x, c.z - m.z)); }
    }
    ok(inside === tot, `지붕 대표점이 모두 고리 안이다 (${inside}/${tot}, ㄱ자 포함)`);
    ok(rectErr < 0.05 && circErr < 0.05, `직사각·원의 대표점은 무게중심과 0.05 m 안 (직사각 최대 ${rectErr.toFixed(4)} · 원 ${circErr.toFixed(4)})`);
  }

  // ── [4] 발자국 크기 ──
  console.log('\n[4] 발자국 크기');
  {
    let worst = 0;
    for (let i = 0; i < 40; i++) {
      const idx = build([{ pts: rect(rr(-300, 300), rr(-300, 300), 60, 20, rnd() * 180), topH: 30, botH: -5 }]);
      const d = BP.footprintDimsM(idx, 0);
      worst = Math.max(worst, Math.abs(d.longM - 60) / 60, Math.abs(d.shortM - 20) / 20);
    }
    ok(worst < 0.02, `돌린 직사각 60×20 의 긴·짧은 변이 2% 안 (최대 오차 ${(worst * 100).toFixed(2)}%)`);
    const idx = build([{ pts: circle(100, 100, 25, 24), topH: 30, botH: -5 }]);
    const d = BP.footprintDimsM(idx, 0);
    ok(Math.abs(d.longM - 50) <= 1 && Math.abs(d.shortM - 50) <= 1, `24각형(반지름 25)은 50 m ± 1 (${d.longM.toFixed(2)} × ${d.shortM.toFixed(2)})`);
  }

  // ── [5] 색인 잇기 ──
  console.log('\n[5] 색인 잇기');
  {
    const mk = (n) => { const l = []; for (let i = 0; i < n; i++) { const az = rnd() * 360, d = rr(200, 6000); l.push({ pts: rect(Math.sin(az * RAD) * d, -Math.cos(az * RAD) * d, rr(15, 50), rr(15, 50), rnd() * 180), topH: rr(10, 150), botH: -5 }); } return build(l); };
    const a = mk(120), b = mk(150), ab = BP.concatPickIndex(a, b);
    ok(ab.count === 270 && ab.ringStart.length === 271 && ab.ringStart[270] === ab.ring.length / 2, `이은 색인: 270 채, 고리 시작표 ${ab.ringStart.length}, 끝이 고리 길이와 같다`);
    let bad = 0, n = 0, fromB = 0;
    for (let k = 0; k < 400; k++) {
      const az = rnd() * 360, el = rr(-1, 4);
      const ha = BP.rayHitBuildings(a, flat, EYE, az, el), hb = BP.rayHitBuildings(b, flat, EYE, az, el), hc = BP.rayHitBuildings(ab, flat, EYE, az, el);
      const best = ha && hb ? (ha.distM <= hb.distM ? { i: ha.index, d: ha.distM } : { i: hb.index + 120, d: hb.distM }) : ha ? { i: ha.index, d: ha.distM } : hb ? { i: hb.index + 120, d: hb.distM } : null;
      n++;
      if (!best && !hc) continue;
      if (hc && hc.index >= 120) fromB++;
      if (!best || !hc || best.i !== hc.index || Math.abs(best.d - hc.distM) > 1e-3) bad++;
    }
    ok(bad === 0 && fromB > 5, `이은 색인에 쏜 결과가 따로 쏜 둘 중 가까운 쪽과 같다 (어긋남 ${bad} / ${n}, b 쪽에서 나온 것 ${fromB})`);
    ok(BP.concatPickIndex(null, b) === b && BP.concatPickIndex(a, undefined) === a && BP.concatPickIndex(null, null) === undefined, '한쪽이 비면 다른 쪽 그대로, 둘 다 비면 undefined');
  }

  // ── [6] 기하와 색인 ──
  console.log('\n[6] 기하와 색인이 한 반복문에서 나온다');
  {
    const lat0 = 37.5, lon0 = 127.0;
    const mLat = 110574.0, mLon = 111320.0 * Math.cos(lat0 * RAD);
    const mkEl = (cxM, czM, w, d, tags) => {
      const pts = rect(cxM, czM, w, d, 0);
      return { tags, geometry: [...pts, pts[0]].map(p => ({ lon: lon0 + p.x / mLon, lat: lat0 - p.z / mLat })), _pts: pts };
    };
    const els = [
      mkEl(300, 200, 30, 20, { height: '60' }),
      mkEl(-400, 100, 25, 25, { 'building:levels': '10' }),
      mkEl(0, -500, 40, 40, { height: '120', min_height: '30' }),
      mkEl(1, 1, 10, 10, { height: '30' }),              // 눈 바로 위(내부 제외)
      mkEl(800, 800, 20, 20, { building: 'apartments' }),
    ];
    const data = BT.buildMergedBuildingGeometry(els, lat0, lon0, 5000);
    ok(data && data.pick && data.pick.count === data.buildingCount && data.buildingCount === 4, `색인 건물 수 ${data && data.pick && data.pick.count} 가 기하 건물 수 ${data && data.buildingCount} 와 같다(눈 바로 위 한 채는 둘 다 뺌)`);
    const expectTop = [60, 32, 120, 24];
    let topOk = true, botOk = true, ringOk = true, ctrOk = true;
    const gnd = new Set(); for (let i = 0; i < data.groundPos.length; i += 2) gnd.add(data.groundPos[i].toFixed(2) + ',' + data.groundPos[i + 1].toFixed(2));
    const srcs = [els[0], els[1], els[2], els[4]];
    for (let i = 0; i < 4; i++) {
      if (Math.abs(data.pick.topH[i] - expectTop[i]) > 1e-3) topOk = false;
      if (Math.abs(data.pick.botH[i] - (i === 2 ? 30 : -BT.SKIRT_DEPTH_M)) > 1e-3) botOk = false;
      const s0 = data.pick.ringStart[i], s1 = data.pick.ringStart[i + 1];
      if (s1 - s0 !== 4) ringOk = false;
      else {
        const want = srcs[i]._pts;
        for (const w of want) { let best = Infinity; for (let j = s0; j < s1; j++) best = Math.min(best, Math.hypot(data.pick.ring[2 * j] - w.x, data.pick.ring[2 * j + 1] - w.z)); if (best > 0.05) ringOk = false; }
      }
      if (!gnd.has(data.pick.cx[i].toFixed(2) + ',' + data.pick.cz[i].toFixed(2))) ctrOk = false;
    }
    ok(topOk, `지붕 높이가 높이 추정과 같다 (${Array.from(data.pick.topH).join(', ')})`);
    ok(botOk, '벽 아랫단: 땅에 닿은 건물은 −치마 깊이, 공중에 뜬 부분은 min_height');
    ok(ringOk, '고리가 입력 발자국(미터)과 0.05 m 안');
    ok(ctrOk, '건물 중심이 기하의 `groundPos` 에 들어 있다(셰이더가 지반을 읽는 자리와 같음)');
    const far = BT.buildMergedBuildingGeometry([mkEl(2000, 1000, 40, 40, { height: '300' })], lat0, lon0, 15000);
    const both = FL.concatBuildingMeshData(data, far);
    ok(both.pick && both.pick.count === 5 && both.buildingCount === 5 && Math.abs(both.pick.topH[4] - 300) < 1e-3, `먼 건물 잇기도 색인을 잇는다 (${both.pick && both.pick.count} 채, 마지막 지붕 높이 ${both.pick && both.pick.topH[4]})`);
    const hit = BP.rayHitBuildings(both.pick, flat, EYE, ((Math.atan2(2000, -1000) / RAD) + 360) % 360, Math.atan2(150 - EYE - drop(Math.hypot(2000, 1000)), Math.hypot(2000, 1000)) / RAD);
    ok(hit && hit.index === 4, '이은 색인으로 먼 건물을 고를 수 있다');
  }

  // ── [7] 고르기 규칙 ──
  console.log('\n[7] 고르기 규칙 (pickTargetAt)');
  {
    // 먼 건물: 동 4 km, 40×40, 높이 200 m 평지
    const far = build([{ pts: rect(4000, 0, 40, 40, 0), topH: 200, botH: -5 }]);
    const elAt = (z, d) => Math.atan2(z - EYE - drop(d), d) / RAD;
    let t = PT.pickTargetAt({ sample: flat, eyeM: EYE, azDeg: 90, elDeg: elAt(80, 3980), buildings: far });
    ok(t && t.kind === 'building' && t.building.snapped === true, '먼 건물: 건물을 고르고 기본은 꼭대기에 붙는다');
    ok(t && Math.abs(t.elevM - 200) < 1e-6 && Math.abs(t.building.topElevM - 200) < 1e-6 && Math.abs(t.building.heightM - 200) < 1e-6, `대상 점 해발이 지붕 해발 ${t && t.elevM} (건물 높이 ${t && t.building.heightM})`);
    ok(t && Math.abs(t.distM - 4000) < 1 && Math.abs(t.elDeg - elAt(200, 4000)) < 1e-6, `꼭대기의 앙각이 겉보기 앙각 식과 같다 (${t && t.elDeg.toFixed(4)}° vs ${elAt(200, 4000).toFixed(4)}°)`);
    ok(t && Math.abs(t.building.hitPoint.elevM - 80) < 0.3 && Math.abs(t.building.hitPoint.distM - 3980) < 0.6, `누른 자리 점도 담는다 (해발 ${t && t.building.hitPoint.elevM.toFixed(1)}, 거리 ${t && t.building.hitPoint.distM.toFixed(1)})`);
    ok(t && Math.abs(t.building.longM - 40) < 1 && Math.abs(t.building.shortM - 40) < 1, '발자국 40×40');
    const toHit = DP.snapBuildingTarget(t, false);
    ok(toHit.building.snapped === false && toHit.distM === t.building.hitPoint.distM && toHit.elDeg === t.building.hitPoint.elDeg && toHit.azDeg === t.building.hitPoint.azDeg && toHit.kind === 'building', '누른 자리로 바꾸면 점 칸이 hitPoint 와 일치');
    const back = DP.snapBuildingTarget(toHit, true);
    ok(back.building.snapped === true && back.elDeg === t.elDeg && back.elevM === t.elevM && DP.snapBuildingTarget(t, true) === t, '꼭대기로 되돌리면 처음과 같고, 이미 그 점이면 같은 객체를 돌려준다');
    // 가까운 건물: 누른 자리 그대로
    const near = build([{ pts: rect(200, 0, 40, 40, 0), topH: 60, botH: -5 }]);
    const tn = PT.pickTargetAt({ sample: flat, eyeM: EYE, azDeg: 90, elDeg: elAt(30, 180), buildings: near });
    ok(tn && tn.kind === 'building' && tn.building.snapped === false && Math.abs(tn.elevM - 30) < 0.3, `가까운 건물(200 m): 누른 자리 그대로 (snapped ${tn && tn.building.snapped}, 해발 ${tn && tn.elevM.toFixed(1)})`);
    // 건물 아닌 대상은 snapBuildingTarget 이 그대로
    const terrain = PT.pickTargetAt({ sample: (e, s) => 40 + 400 * Math.exp(-((e - 6000) ** 2) / (2 * 1200 ** 2)) * Math.exp(-(s ** 2) / (2 * 4000 ** 2)), eyeM: 41.6, azDeg: 90, elDeg: 3.0, buildings: null });
    ok(terrain && terrain.kind === 'terrain' && DP.snapBuildingTarget(terrain, true) === terrain && terrain.building === undefined, '건물이 없으면 지형을 고르고(kind terrain) 전환은 그대로 돌려준다');
    // 지형은 옛 규칙과 같은 수: rayHitTerrain + climbToPeak 로 직접 구한 것과 비교
    {
      const mountain = (e, s) => 40 + 400 * Math.exp(-((e - 6000) ** 2) / (2 * 1200 ** 2)) * Math.exp(-(s ** 2) / (2 * 4000 ** 2));
      const hit = DP.rayHitTerrain(mountain, 41.6, 95, 3.0);
      const pk = DP.climbToPeak(mountain, hit.eastM, hit.southM, { maxR: Math.min(250, hit.distM * 0.05) });
      const want = DP.targetPointAt(mountain, 41.6, pk.eastM, pk.southM, pk.elevM);
      const got = PT.pickTargetAt({ sample: mountain, eyeM: 41.6, azDeg: 95, elDeg: 3.0, buildings: null });
      ok(got && Math.abs(got.azDeg - want.azDeg) < 1e-9 && Math.abs(got.elDeg - want.elDeg) < 1e-9 && Math.abs(got.distM - want.distM) < 1e-9 && got.visible === want.visible, '지형 고르기가 옛 규칙(땅 닿음 → 가까운 봉우리)과 같은 수를 낸다');
    }
    // 손끝 여유: 동 10 km, 폭 20 m, 높이 150 m
    const thin = build([{ pts: rect(10000, 0, 20, 20, 0), topH: 150, botH: -5 }]);
    const d10 = 9990;
    const azOff = 0.2;   // 10 km 에서 35 m 옆
    const elThin = elAt(70, d10);
    const t0 = PT.pickTargetAt({ sample: flat, eyeM: EYE, azDeg: 90 + azOff, elDeg: elThin, buildings: thin, tolDeg: 0 });
    const t4 = PT.pickTargetAt({ sample: flat, eyeM: EYE, azDeg: 90 + azOff, elDeg: elThin, buildings: thin, tolDeg: 0.4 });
    ok(t0 === null || t0.kind !== 'building', `손끝 여유 0: 0.2° 빗나가면 건물을 놓친다 (${t0 ? t0.kind : '아무것도 못 고름'})`);
    ok(t4 && t4.kind === 'building' && Math.abs(t4.distM - 10000) < 15, `손끝 여유 0.4°: 같은 시선이 건물을 잡는다 (${t4 && t4.kind}, 거리 ${t4 && t4.distM.toFixed(0)})`);
    // 하늘을 눌러도: 탑 꼭대기 위쪽 0.15°
    const tSky = PT.pickTargetAt({ sample: flat, eyeM: EYE, azDeg: 90, elDeg: elAt(150, d10) + 0.15, buildings: thin, tolDeg: 0.4 });
    ok(tSky && tSky.kind === 'building', '하늘을 눌러도(지형 닿음 없음) 위로 솟은 탑이 손끝 여유 안이면 잡힌다');
    // 누른 곳이 400 m 안의 땅이면 여유를 안 쓴다
    const tGround = PT.pickTargetAt({ sample: flat, eyeM: EYE, azDeg: 90 + azOff, elDeg: -0.3, buildings: thin, tolDeg: 5 });
    ok(tGround && tGround.kind === 'terrain' && tGround.distM < 400, `발밑(약 ${tGround && tGround.distM.toFixed(0)} m) 땅을 누르면 여유가 커도 지형이다`);
  }

  // ── [8] 빠르다 ──
  console.log('\n[8] 속도');
  {
    const list = [];
    for (let i = 0; i < 6000; i++) {
      const az = rnd() * 360, d = rr(150, 15000);
      list.push({ pts: rect(Math.sin(az * RAD) * d, -Math.cos(az * RAD) * d, rr(15, 60), rr(15, 60), rnd() * 180), topH: rr(8, 250), botH: -5 });
    }
    const big = build(list);
    let t0 = performance.now(), n = 0;
    for (let k = 0; k < 200; k++) { BP.rayHitBuildings(big, flat, EYE, rnd() * 360, rr(-1, 3)); n++; }
    const per = (performance.now() - t0) / n;
    ok(per < 5, `6000 채에서 시선 하나 ${per.toFixed(2)} ms (5 ms 안)`);
    t0 = performance.now();
    const tt = PT.pickTargetAt({ sample: flat, eyeM: EYE, azDeg: 123, elDeg: 0.4, buildings: big, tolDeg: 0.4 });
    const one = performance.now() - t0;
    ok(one < 150, `손끝 여유 25 시선을 다 쏘는 최악의 고르기 한 번 ${one.toFixed(1)} ms (150 ms 안; 결과 ${tt ? tt.kind : '없음'})`);
  }

  // ── [9] 잘못된 입력 ──
  console.log('\n[9] 잘못된 입력');
  {
    const empty = BP.createPickIndexBuilder().finish();
    ok(empty === undefined, '건물이 한 채도 없으면 색인은 undefined');
    const one = build([{ pts: rect(300, 0, 20, 20, 0), topH: 30, botH: -5 }]);
    let threw = false, r1 = null, r2 = null;
    try { r1 = BP.rayHitBuildings(one, flat, EYE, NaN, NaN); r2 = PT.pickTargetAt({ sample: flat, eyeM: EYE, azDeg: NaN, elDeg: 0, buildings: one, tolDeg: 0.4 }); } catch (e) { threw = true; }
    ok(!threw && r1 === null, 'NaN 방향은 던지지 않고 null');
    ok(PT.pickTargetAt({ sample: flat, eyeM: EYE, azDeg: 90, elDeg: 5, buildings: null, tolDeg: 0.4 }) === null, '하늘만 누르고 건물이 없으면 null');
    ok(PT.pickTargetAt({ sample: flat, eyeM: EYE, azDeg: 90, elDeg: 5, buildings: { ...one, count: 0 }, tolDeg: 0.4 }) === null, '건물 수 0 인 색인도 null');
  }

  console.log(`\n${fail === 0 ? '모두 통과' : '실패 있음'} — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
