/**
 * §179 R-A_T(아틀라스만 재는 R-A — design v2.1 §5.4, ruler-delta D2·D3) 창 통계 — **보고만, 판정 아님**(게이트·ε·허용폭은 사용자 결정 U1).
 * tsun_photo.py 의 `ra_t` 명령(동결 때 더함, ruler-delta B3)과 같은 정의를 node 로 미리 둠 — tsun_photo.py 는 동결 후보라 고치지 않음.
 *
 * 입력: 진단 잡(tsunDebug 1, frames 4) PNG 둘(후보·REF_v2 — entry-tsun `<잡>.debug.png`: R = round(255·√T), G = round(255·min(1, Σw)),
 *       B = 255 값 있음) + 두 팔의 **그림 잡** 알파 PNG(`<잡>.alpha.png`).
 *  - 창: 400×300 위 고정 4×4 격자(100×75 화소) — 다른 크기면 W/4 × H/4(나머지 화소는 마지막 창에).
 *  - 구름 화소 = 두 팔 그림 α ≥ 0.5 이고 두 팔 진단 값 있음(B ≥ 128, 빛 받는 무게 Σw > 0 — 결정 RT1: Σw = 0 이면 T 가 정의되지 않아 뺌).
 *  - 창은 구름 화소 ≥ 400 이어야 하고, max(T̄_c, T̄_r) ≥ 0.01 이면 정보 창. T̄ = 창 안 구름 화소 T 의 면적 평균.
 *  - 단위: d_w = ln((T̄_c + ε)/(T̄_r + ε)), e_T = 중앙 |d_w|, b_T = 중앙 d_w, p75_T = 75 분위 |d_w|, n_inf. n_inf < 4 → '아틀라스에 대해 퇴화'.
 *  - Floor_T = 바닥 단위(REF-debug A/A·REF100-debug)의 지표마다 최댓값.
 *  - D3 보고 열: 면적 평균 ln Y(Σ Yc / Σ Yr, 구름 화소) · 'REF 해 줄 T < 0.01 인 구름 화소 ≥ 90 %' 표지.
 * ε 은 정해지지 않음(U1b) — 0.01 · 0.03 · 0.1 셋을 모두 냄(설계 예측이 이 셋으로 적혀 있음, design v2.1 §6).
 *
 *   node tools/genus-ruler/tsun/ra-t.mjs unit --cand-debug A.debug.png --ref-debug R.debug.png --cand-alpha A.alpha.png --ref-alpha R.alpha.png [--eps 0.01,0.03,0.1]
 *   node tools/genus-ruler/tsun/ra-t.mjs selftest
 */
export const RA_T = { grid: [4, 4], minPx: 400, informT: 0.01, alphaMin: 0.5, minInformative: 4, eps: [0.01, 0.03, 0.1], refDegT: 0.01, refDegFrac: 0.9 };

/** 진단 PNG RGBA(위가 0) → T(NaN = 값 없음). */
export function decodeDebugRgba(rgba, W, H) {
  const T = new Float64Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2];
    T[i] = b >= 128 && g > 0 ? (r / 255) ** 2 : NaN;
  }
  return T;
}
/** 알파 PNG(회색, R 채널) → α ∈ [0, 1]. */
export function decodeAlphaRgba(rgba, W, H) {
  const a = new Float64Array(W * H);
  for (let i = 0; i < W * H; i++) a[i] = rgba[i * 4] / 255;
  return a;
}
const median = xs => { const s = [...xs].sort((a, b) => a - b), n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : 0.5 * (s[n / 2 - 1] + s[n / 2])) : NaN; };
/** numpy percentile(선형)과 같은 정의. */
const pct = (xs, q) => { const s = [...xs].sort((a, b) => a - b), n = s.length; if (!n) return NaN; const k = (n - 1) * q / 100, f = Math.floor(k), c = Math.min(n - 1, f + 1); return s[f] + (s[c] - s[f]) * (k - f); };

/** 창 목록(고정 격자). */
export function windowsOf(W, H, grid = RA_T.grid) {
  const [gx, gy] = grid, ww = Math.floor(W / gx), wh = Math.floor(H / gy), out = [];
  for (let j = 0; j < gy; j++) for (let i = 0; i < gx; i++) out.push({ i, j, x0: i * ww, x1: i === gx - 1 ? W : (i + 1) * ww, y0: j * wh, y1: j === gy - 1 ? H : (j + 1) * wh });
  return out;
}
/** 창마다 구름 화소 수·T̄_c·T̄_r. */
export function raTWindows({ Tc, Tr, alphaC, alphaR, W, H }, o = RA_T) {
  return windowsOf(W, H, o.grid).map(w => {
    let n = 0, sc = 0, sr = 0;
    for (let y = w.y0; y < w.y1; y++) for (let x = w.x0; x < w.x1; x++) {
      const k = y * W + x;
      if (!(alphaC[k] >= o.alphaMin && alphaR[k] >= o.alphaMin)) continue;
      if (!Number.isFinite(Tc[k]) || !Number.isFinite(Tr[k])) continue;
      n++; sc += Tc[k]; sr += Tr[k];
    }
    const ok = n >= o.minPx, Tcm = n ? sc / n : NaN, Trm = n ? sr / n : NaN;
    return { ...w, n, Tc: Tcm, Tr: Trm, valid: ok, informative: ok && Math.max(Tcm, Trm) >= o.informT };
  });
}
/** 단위 통계(ε 마다). */
export function raTUnit(input, o = RA_T) {
  const wins = raTWindows(input, o), inf = wins.filter(w => w.informative);
  const byEps = {};
  for (const eps of o.eps) {
    const d = inf.map(w => Math.log((w.Tc + eps) / (w.Tr + eps))), ad = d.map(Math.abs);
    byEps[String(eps)] = { e_T: median(ad), b_T: median(d), p75_T: pct(ad, 75), d };
  }
  return { n_inf: inf.length, n_valid: wins.filter(w => w.valid).length, degenerate: inf.length < o.minInformative, byEps, windows: wins.map(({ i, j, n, Tc, Tr, valid, informative }) => ({ i, j, n, Tc, Tr, valid, informative })) };
}
/** 바닥: 단위 목록의 지표마다 최댓값(ε 마다). */
export function floorT(units, o = RA_T) {
  const out = {};
  for (const eps of o.eps) {
    const k = String(eps), us = units.filter(u => !u.degenerate);
    out[k] = Object.fromEntries(['e_T', 'b_T', 'p75_T'].map(m => [m, us.length ? Math.max(...us.map(u => Math.abs(u.byEps[k][m]))) : NaN]));
  }
  return out;
}
/** D3 보고 열: 면적 평균 ln Y = ln(Σ Yc / Σ Yr)(마스크 화소). */
export function areaMeanLnY(Yc, Yr, mask) {
  let a = 0, b = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i]) { a += Yc[i]; b += Yr[i]; }
  return a > 0 && b > 0 ? Math.log(a / b) : NaN;
}
/** D3 표지: REF 진단에서 구름 화소의 ≥ 90 % 가 T < 0.01 이면 참(U2 의 '퇴화' 후보 — 정보 단위 규칙을 바꾸는지는 사용자 결정). */
export function refDegenerateFlag(Tr, alphaR, o = RA_T) {
  let n = 0, low = 0;
  for (let i = 0; i < Tr.length; i++) { if (!(alphaR[i] >= o.alphaMin) || !Number.isFinite(Tr[i])) continue; n++; if (Tr[i] < o.refDegT) low++; }
  return { n, frac: n ? low / n : NaN, flag: n > 0 && low / n >= o.refDegFrac };
}

// ───── 합성 시험(ruler-delta B3 'window grid, degenerate rule, two-sided') ─────
export function selftest() {
  const W = 400, H = 300, N = W * H, res = [];
  const ok = (c, m) => res.push({ ok: !!c, m });
  const field = f => { const a = new Float64Array(N); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) a[y * W + x] = f(x, y); return a; };
  const ones = field(() => 1);
  // 1) 격자: 16 창, 100×75, 모두 덮음
  const w = windowsOf(W, H);
  ok(w.length === 16 && w.every(q => q.x1 - q.x0 === 100 && q.y1 - q.y0 === 75), '창 4×4 = 100×75 화소');
  // 2) 같은 장 → d = 0, 퇴화 아님
  const Tr = field((x, y) => 0.05 + 0.4 * (x / W) * (y / H));
  const u0 = raTUnit({ Tc: Tr, Tr, alphaC: ones, alphaR: ones, W, H });
  ok(u0.n_inf === 16 && !u0.degenerate && u0.byEps['0.01'].e_T === 0 && u0.byEps['0.01'].b_T === 0, '같은 장: e_T = b_T = 0, 정보 창 16');
  // 3) 양쪽: 후보 = REF × 2 → b_T > 0, × 0.5 → b_T < 0, 크기 같은 쪽으로 ln 2 근처(ε 작을수록)
  const up = raTUnit({ Tc: field((x, y) => Math.min(1, 2 * Tr[y * W + x])), Tr, alphaC: ones, alphaR: ones, W, H });
  const dn = raTUnit({ Tc: field((x, y) => 0.5 * Tr[y * W + x]), Tr, alphaC: ones, alphaR: ones, W, H });
  ok(up.byEps['0.01'].b_T > 0.5 && dn.byEps['0.01'].b_T < -0.5 && Math.abs(dn.byEps['0.01'].b_T + Math.LN2) < 0.12 && up.byEps['0.1'].b_T < up.byEps['0.01'].b_T, `양쪽: ×2 → b_T ${up.byEps['0.01'].b_T.toFixed(3)} · ×0.5 → ${dn.byEps['0.01'].b_T.toFixed(3)}, ε 0.1 이 덜 민감`);
  // 4) 퇴화: 두 팔 모두 T < 0.01 → 정보 창 0 → 퇴화
  const dark = field(() => 0.004);
  const ud = raTUnit({ Tc: dark, Tr: dark, alphaC: ones, alphaR: ones, W, H });
  ok(ud.n_inf === 0 && ud.degenerate, '두 팔 T < 0.01: 정보 창 0 → 퇴화');
  // 5) 정보 창 3 개(< 4) → 퇴화; 4 개 → 아님
  const k3 = field((x, y) => (y < 75 && x < 300 ? 0.2 : 0.004)), k4 = field((x, y) => (y < 75 ? 0.2 : 0.004));
  ok(raTUnit({ Tc: k3, Tr: k3, alphaC: ones, alphaR: ones, W, H }).degenerate && !raTUnit({ Tc: k4, Tr: k4, alphaC: ones, alphaR: ones, W, H }).degenerate, '정보 창 3 → 퇴화, 4 → 아님');
  // 6) 구름 화소 < 400 인 창은 무효: 알파 0.5 미만이 창의 대부분
  const sparse = field((x, y) => ((x % 100) < 5 && (y % 75) < 75 ? 1 : 0));   // 창마다 5×75 = 375 화소
  const us = raTUnit({ Tc: Tr, Tr, alphaC: sparse, alphaR: ones, W, H });
  ok(us.n_valid === 0 && us.degenerate, '창마다 375 화소(< 400) → 모두 무효');
  // 7) 한 팔만 α ≥ 0.5 인 화소는 빠짐 · 값 없는(NaN) 화소도 빠짐
  const halfA = field(x => (x < 200 ? 1 : 0.3));
  const uh = raTUnit({ Tc: Tr, Tr, alphaC: halfA, alphaR: ones, W, H });
  ok(uh.n_valid === 8, '한 팔 α < 0.5 인 반쪽 → 창 8 개만 유효');
  const nanT = field((x, y) => (y < 150 ? NaN : Tr[y * W + x]));
  ok(raTUnit({ Tc: nanT, Tr, alphaC: ones, alphaR: ones, W, H }).n_valid === 8, '값 없는 화소(NaN) → 위 절반 창 무효');
  // 8) 부호화 되돌림: √T 8비트 → T, B < 128 → NaN
  const rgba = new Uint8ClampedArray(4 * 4); const tv = [0.01, 0.25, 1, 0.5];
  tv.forEach((t, i) => { rgba[i * 4] = Math.round(255 * Math.sqrt(t)); rgba[i * 4 + 1] = 200; rgba[i * 4 + 2] = i === 3 ? 0 : 255; rgba[i * 4 + 3] = 255; });
  const dec = decodeDebugRgba(rgba, 4, 1);
  ok(Math.abs(dec[0] - 0.01) < 0.0012 && Math.abs(dec[1] - 0.25) < 0.003 && dec[2] === 1 && Number.isNaN(dec[3]), `부호화: T 0.01 → ${dec[0].toFixed(5)}(8비트 해상도 2√T/255 = 0.0008), B 0 → NaN`);
  // 9) 바닥·D3 열
  const fl = floorT([u0, up, dn]);
  ok(Math.abs(fl['0.01'].b_T - Math.max(Math.abs(up.byEps['0.01'].b_T), Math.abs(dn.byEps['0.01'].b_T))) < 1e-12, 'Floor_T = 지표마다 |값| 최댓값');
  const mask = field(() => 1), Y2 = field(() => 2);
  ok(Math.abs(areaMeanLnY(Y2, ones, mask) - Math.LN2) < 1e-12, '면적 평균 ln Y = ln(ΣYc/ΣYr)');
  ok(refDegenerateFlag(dark, ones).flag && !refDegenerateFlag(Tr, ones).flag, 'REF 해 줄 T < 0.01 ≥ 90 % 표지');
  return res;
}

// ───── 명령 줄 ─────
async function readPngRgba(f) {
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const { PNG } = require('pngjs');
  const fs = require('fs');
  const p = PNG.sync.read(fs.readFileSync(f));
  return { rgba: p.data, W: p.width, H: p.height };
}
async function main(argv) {
  const cmd = argv[0];
  const get = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
  if (cmd === 'selftest') {
    const r = selftest();
    for (const x of r) console.log((x.ok ? '  PASS: ' : '  FAIL: ') + x.m);
    const nf = r.filter(x => !x.ok).length;
    console.log(nf ? `FAILURES ${nf}` : `ALL PASS ${r.length}`);
    process.exit(nf ? 1 : 0);
  }
  if (cmd === 'unit') {
    const [cd, rd, ca, ra] = await Promise.all(['--cand-debug', '--ref-debug', '--cand-alpha', '--ref-alpha'].map(k => { const f = get(k); if (!f) throw new Error('missing ' + k); return readPngRgba(f); }));
    const { W, H } = cd;
    if ([rd, ca, ra].some(x => x.W !== W || x.H !== H)) throw new Error('size mismatch');
    const eps = (get('--eps') || RA_T.eps.join(',')).split(',').map(Number);
    const o = { ...RA_T, eps };
    const Tc = decodeDebugRgba(cd.rgba, W, H), Tr = decodeDebugRgba(rd.rgba, W, H), alphaC = decodeAlphaRgba(ca.rgba, W, H), alphaR = decodeAlphaRgba(ra.rgba, W, H);
    const u = raTUnit({ Tc, Tr, alphaC, alphaR, W, H }, o);
    for (const k of Object.keys(u.byEps)) delete u.byEps[k].d;
    console.log(JSON.stringify({ ...u, refFlag: refDegenerateFlag(Tr, alphaR, o), note: 'R-A_T 보고(게이트 아님, U1)' }));
    return;
  }
  console.error('usage: ra-t.mjs unit --cand-debug A --ref-debug R --cand-alpha A --ref-alpha R [--eps 0.01,0.03,0.1] | selftest');
  process.exit(2);
}
if (typeof process !== 'undefined' && process.argv[1] && import.meta.url === new URL('file://' + process.argv[1]).href) main(process.argv.slice(2)).catch(e => { console.error(e); process.exit(1); });
