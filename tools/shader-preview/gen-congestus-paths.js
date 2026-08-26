/**
 * **탑형 적운(congestus) 실루엣 생성기** — docs/CLOUD_VARIETY_PLAN.md 5단계.
 *
 * 기존 `CLOUD_TEMPLATES.Cumulus`는 다섯 개 다 **가로가 긴 판**입니다
 * (종횡비 2.3~5.6). 그래서 배치에서 종횡비를 세로로 열어 줘도 넓은
 * 꽃양배추를 가로로 눌러 놓은 모양이 될 뿐, 사진 ②의 솟은 탑이 나오지
 * 않습니다. 세로로 긴 실루엣 자체가 필요합니다.
 *
 * 손으로 베지에를 찍으면 재현이 안 되므로 여기서 만듭니다. 적운의 윤곽은
 * **바깥으로 부푼 혹의 연속**(꽃양배추)이므로, 축을 따라 올라가며 혹을
 * 하나씩 얹는 방식으로 그립니다. 혹 하나는 3차 베지에 한 구간입니다.
 *
 * 출력은 `cloudPresets.ts`에 **정적 문자열로 붙여 넣습니다** — 런타임에
 * 만들면 앱과 하네스가 다른 모양을 그릴 위험이 생깁니다.
 *
 * 사용: node tools/shader-preview/gen-congestus-paths.js
 */

/** 결정적 난수 (같은 씨앗 → 같은 실루엣) */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * 혹 하나 = 3차 베지에 한 구간.
 * (x0,y0) → (x1,y1) 을 잇되 법선 방향으로 `bulge` 만큼 부풀립니다.
 */
function bump(x0, y0, x1, y1, bulge) {
  const dx = x1 - x0, dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  // 진행 방향의 왼쪽 법선. 윤곽을 시계 방향으로 돌면 바깥쪽입니다.
  const nx = dy / len, ny = -dx / len;
  const c1x = x0 + dx * 0.18 + nx * bulge;
  const c1y = y0 + dy * 0.18 + ny * bulge;
  const c2x = x0 + dx * 0.82 + nx * bulge;
  const c2y = y0 + dy * 0.82 + ny * bulge;
  const f = (v) => Math.round(v * 10) / 10;
  return `C ${f(c1x)},${f(c1y)} ${f(c2x)},${f(c2y)} ${f(x1)},${f(y1)}`;
}

/**
 * 탑 하나.
 *
 * 처음 판은 좌우가 정확히 대칭이고 혹 크기가 균일해서 **구슬을 쌓은 기둥**처럼
 * 보였습니다 (렌더로 확인). 실제 congestus는 밑동이 넓고 위로 갈수록 혹이
 * 작아지며, 좌우가 전혀 대칭이 아닙니다. 그래서:
 *
 *  - 좌·우 윤곽에 **서로 다른 난수열**을 씁니다 (대칭 제거)
 *  - 반폭이 높이에 따라 물결칩니다 (혹의 크기 변화)
 *  - 혹의 부푼 정도를 위로 갈수록 줄입니다 (꼭대기의 잔 꽃양배추)
 *  - 축이 곡선으로 기웁니다 (풍속 전단)
 *
 * @param seed      난수 씨앗
 * @param height    전체 높이 (SVG 단위)
 * @param halfWidth 밑동 반폭
 * @param lean      꼭대기가 옆으로 밀린 정도
 */
function tower(seed, height, halfWidth, lean) {
  const rL = rng(seed);
  const rR = rng(seed ^ 0x9e3779b9);
  const rT = rng(seed * 3 + 11);
  const baseY = height;
  const topY = 8;
  const nSide = 5;

  // 축은 위로 갈수록 더 기웁니다 (t² — 전단이 고도에 따라 쌓이므로).
  const axisX = (t) => 50 + lean * t * t;
  /**
   * 반폭.
   *
   * 밑동이 가장 넓은 원뿔이 아닙니다 — 실제 적운은 **중간 높이가 가장 넓고**
   * 밑면은 응결고도에서 갓 시작해 좁습니다. 그 위에 큰 덩어리(turret) 몇 개가
   * 얹히므로 물결의 주기를 길게(≈2주기) 잡고 진폭을 크게 씁니다. 잔 혹은
   * 구간마다 다른 bulge가 냅니다.
   *
   * 처음엔 밑동이 가장 넓은 원뿔 + 짧은 주기 물결 7단이었는데, 렌더에서
   * **구슬을 쌓은 기둥**으로 보였습니다 (혹이 다 같은 크기라서).
   */
  const halfAt = (t, amp, phase) =>
    halfWidth * (0.72 + 0.48 * Math.sin(Math.PI * Math.pow(t, 0.8))) *
    (1 + amp * Math.sin(t * 4.2 + phase));

  const ampL = 0.12 + rL() * 0.13, phL = rL() * 6.28;
  const ampR = 0.12 + rR() * 0.13, phR = rR() * 6.28;
  const f = (v) => Math.round(v * 10) / 10;

  const side = (sign, amp, phase, r) => {
    const pts = [];
    for (let i = 0; i <= nSide; i++) {
      const t = i / nSide;
      pts.push({
        x: axisX(t) + sign * halfAt(t, amp, phase),
        y: baseY + (topY - baseY) * t,
      });
    }
    return pts;
  };

  const L = side(-1, ampL, phL, rL);
  const R = side(+1, ampR, phR, rR);

  // 혹의 부푼 정도. 편차를 크게 둡니다 — 같은 크기 혹이 줄지으면 구슬 기둥이
  // 됩니다. 위로 갈수록 조금 잘아집니다.
  const bulgeAt = (t, r) => 0.30 - 0.08 * t + (r() - 0.5) * 0.24;

  let d = `M ${f(L[0].x)},${baseY} `;
  for (let i = 0; i < nSide; i++) {
    const seg = Math.hypot(L[i + 1].x - L[i].x, L[i + 1].y - L[i].y);
    d += bump(L[i].x, L[i].y, L[i + 1].x, L[i + 1].y, seg * bulgeAt(i / nSide, rL)) + ' ';
  }

  // 꼭대기 — 혹 네 개, 높이가 제각각인 꽃양배추 머리.
  const tx = axisX(1);
  const tw = (R[nSide].x - L[nSide].x) / 2;
  // 꼭대기는 좁은 뿔이 아니라 **넓은 돔**입니다 — congestus의 서명입니다.
  const nCap = 3;
  const cap = [];
  for (let i = 0; i <= nCap; i++) {
    const u = i / nCap;                    // 0(왼) → 1(오른)
    // 가운데가 높지만 정확히 가운데는 아닙니다.
    const rise = Math.sin(u * Math.PI) * tw * (0.30 + rT() * 0.28);
    cap.push({ x: tx + (u - 0.5) * 2 * tw, y: topY - rise });
  }
  // 꼭대기 혹은 몸통 혹과 **비슷한 크기**여야 합니다. 잘게 쪼개면 머리에만
  // 좁쌀이 붙은 모양이 됩니다.
  for (let i = 0; i < nCap; i++) {
    const seg = Math.hypot(cap[i + 1].x - cap[i].x, cap[i + 1].y - cap[i].y);
    d += bump(cap[i].x, cap[i].y, cap[i + 1].x, cap[i + 1].y, seg * (0.40 + rT() * 0.22)) + ' ';
  }

  for (let i = nSide; i > 0; i--) {
    const seg = Math.hypot(R[i - 1].x - R[i].x, R[i - 1].y - R[i].y);
    d += bump(R[i].x, R[i].y, R[i - 1].x, R[i - 1].y, seg * bulgeAt((i - 1) / nSide, rR)) + ' ';
  }

  // 밑면은 평평합니다 — 응결고도가 한 높이라 적운 밑면은 실제로 수평입니다.
  d += `L ${f(L[0].x)},${baseY} Z`;
  return d;
}

const variants = [
  { seed: 20260826, height: 150, halfWidth: 30, lean: 6 },
  { seed: 7717, height: 138, halfWidth: 26, lean: -10 },
  { seed: 99131, height: 160, halfWidth: 34, lean: 14 },
];

console.log('// gen-congestus-paths.js 로 생성 (씨앗 ' +
  variants.map(v => v.seed).join(', ') + ')');
for (const v of variants) {
  const d = tower(v.seed, v.height, v.halfWidth, v.lean);
  // 종횡비 확인 — 세로로 길어야 의미가 있습니다.
  const nums = d.match(/-?\d+\.?\d*/g).map(Number);
  const xs = [], ys = [];
  for (let i = 0; i < nums.length; i += 2) { xs.push(nums[i]); ys.push(nums[i + 1]); }
  const w = Math.max(...xs) - Math.min(...xs);
  const h = Math.max(...ys) - Math.min(...ys);
  console.log(`// 폭 ${w.toFixed(0)} × 높이 ${h.toFixed(0)}  종횡비 ${(w / h).toFixed(2)}`);
  console.log(`    "${d}",`);
}
