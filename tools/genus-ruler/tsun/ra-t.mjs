/**
 * §179 R-A_T(아틀라스만 재는 R-A — design v2.1 §5.4, ruler-delta D2·D3) 창 통계 — **보고만, 판정 아님**(게이트·ε·허용폭은 사용자 결정 U1).
 * tsun_photo.py 의 `ra_t` 명령(동결 때 더함, ruler-delta B3)과 같은 정의를 node 로 미리 둠 — tsun_photo.py 는 동결 후보라 고치지 않음.
 *
 * 입력: 진단 잡(tsunDebug 1, frames 4) PNG 둘(후보·REF_v2 — entry-tsun `<잡>.debug.png`: R = round(255·√T), G = round(255·min(1, Σw)),
 *       B = 255 값 있음) + 두 팔의 **그림 잡** 알파 PNG(`<잡>.alpha.png`).
 *  - 창: 400×300 위 고정 4×4 격자(100×75 화소) — 다른 크기면 W/4 × H/4(나머지 화소는 마지막 창에).
 *  - 구름 화소 = 두 팔 그림 α ≥ 0.5 이고 두 팔 진단 값 있음(B ≥ 128 = 빛 받는 무게 Σw > 0 — 결정 RT1: Σw = 0 이면 T 가 정의되지 않아 뺌).
 *    §179 검토 반영(하네스 11): 처음 판은 'g > 0' 도 요구해 0 < Σw < 1/510(8비트 G 가 0 으로 반올림)인 빛 받는 화소를 뺐음 — 깊은 박명 단위의
 *    앞 표본이 거의 지구 그림자인 화소. 이제 B 만 봄. 더 낫게는 PNG 대신 <잡>.debug.f16(T·Σw 반정밀도, 구름 격자)을 읽음(--cand-f16/--ref-f16 +
 *    --cand-meta/--ref-meta 의 debug.grid) — √T 8비트는 T ≈ 0.001 에서 한 칸이 상대 25 % 라 거침. f16 이면 창마다 빛 받는 표본의 평균 mip(채널 2)도
 *    냄(§179 검토 물리 5 — REF 너머 행진은 mip 0, 가까운 행진은 표본 mip).
 *  - 창은 구름 화소 ≥ 400 이어야 하고, max(T̄_c, T̄_r) ≥ 0.01 이면 정보 창. T̄ = 창 안 구름 화소 T 의 면적 평균.
 *  - 단위: d_w = ln((T̄_c + ε)/(T̄_r + ε)), e_T = 중앙 |d_w|, b_T = 중앙 d_w, p75_T = 75 분위 |d_w|, n_inf. n_inf < 4 → '아틀라스에 대해 퇴화'.
 *  - Floor_T = 바닥 단위(REF-debug A/A·REF100-debug)의 지표마다 최댓값.
 *  - D3 보고 열: 면적 평균 ln Y(Σ Yc / Σ Yr, 구름 화소) · 'REF 해 줄 T < 0.01 인 구름 화소 ≥ 90 %' 표지.
 * ε 은 정해지지 않음(U1b) — 0.01 · 0.03 · 0.1 셋을 모두 냄(설계 예측이 이 셋으로 적혀 있음, design v2.1 §6).
 *
 *   node tools/genus-ruler/tsun/ra-t.mjs unit --cand-debug A.debug.png --ref-debug R.debug.png --cand-alpha A.alpha.png --ref-alpha R.alpha.png [--eps 0.01,0.03,0.1]
 *   node tools/genus-ruler/tsun/ra-t.mjs unit --cand-f16 A.debug.f16 --ref-f16 R.debug.f16 --cand-meta A.meta.json --ref-meta R.meta.json --cand-alpha … --ref-alpha …
 *   node tools/genus-ruler/tsun/ra-t.mjs selftest
 */
export const RA_T = { grid: [4, 4], minPx: 400, informT: 0.01, alphaMin: 0.5, minInformative: 4, eps: [0.01, 0.03, 0.1], refDegT: 0.01, refDegFrac: 0.9 };

/** 진단 PNG RGBA(위가 0) → T(NaN = 값 없음). */
export function decodeDebugRgba(rgba, W, H) {
  const T = new Float64Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const r = rgba[i * 4], b = rgba[i * 4 + 2];
    T[i] = b >= 128 ? (r / 255) ** 2 : NaN;   // 하네스 11: Σw > 0 이면 B = 255(G 는 Σw 가 1/510 아래면 0 일 수 있음)
  }
  return T;
}
/**
 * 진단 f16(entry-tsun <잡>.debug.f16: 구름 격자 cw×ch, 위가 0, 텍셀마다 T · Σw · 평균 mip · 그린 횟수, 반정밀도) → 캔버스 W×H 화소마다 T·mip
 * (가장 가까운 텍셀 — debugPngRgba 와 같은 대응). Σw ≤ 0 이거나 T 가 NaN 이면 NaN.
 */
export function decodeDebugF16(bytes, cw, ch, W, H) {
  const u16 = new Uint16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
  if (u16.length !== cw * ch * 4) throw new Error(`debug.f16 has ${u16.length / 4} texels, meta grid ${cw}×${ch}`);
  const half = h => { const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 0x1f, f = h & 0x3ff; return e === 0 ? s * f * 2 ** -24 : e === 31 ? (f ? NaN : s * Infinity) : s * (1 + f / 1024) * 2 ** (e - 15); };
  const T = new Float64Array(W * H), mip = new Float64Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const tx = Math.min(cw - 1, Math.floor(((x + 0.5) * cw) / W)), ty = Math.min(ch - 1, Math.floor(((y + 0.5) * ch) / H)), j = (ty * cw + tx) * 4;
    const t = half(u16[j]), w = half(u16[j + 1]), m = half(u16[j + 2]);
    const ok = Number.isFinite(t) && w > 0;
    T[y * W + x] = ok ? Math.min(1, Math.max(0, t)) : NaN;
    mip[y * W + x] = ok && Number.isFinite(m) ? m : NaN;
  }
  return { T, mip };
}
/** 창마다 빛 받는 구름 화소의 평균 mip(값 없는 화소 뺌) — R-A_T 기록(검토 물리 5). */
export function windowMeanMip(mip, alpha, W, H, o = RA_T) {
  return windowsOf(W, H, o.grid).map(w => {
    let n = 0, s = 0;
    for (let y = w.y0; y < w.y1; y++) for (let x = w.x0; x < w.x1; x++) { const k = y * W + x; if (alpha[k] >= o.alphaMin && Number.isFinite(mip[k])) { n++; s += mip[k]; } }
    return n ? s / n : null;
  });
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
  // §179 하네스 11: Σw 가 1/510 아래라 G 가 0 이어도 B = 255 이면 값 있음
  const g0 = new Uint8ClampedArray([Math.round(255 * Math.sqrt(0.3)), 0, 255, 255]);
  ok(Math.abs(decodeDebugRgba(g0, 1, 1)[0] - 0.3) < 0.003, 'G 0(Σw < 1/510) · B 255 → 값 있음(처음 판은 뺐음)');
  // f16: 2×1 격자 → 4×2 캔버스, Σw 0 텍셀은 NaN, mip 채널
  const h = x => { const b = new Float32Array([x]), u = new Uint32Array(b.buffer)[0]; const s = (u >>> 16) & 0x8000, e = ((u >>> 23) & 0xff) - 127 + 15, m = (u >>> 13) & 0x3ff; return x === 0 ? 0 : s | (e << 10) | m; };
  const f16 = new Uint16Array([h(0.5), h(0.2), h(1.5), h(4), h(0.7), 0, h(0), h(4)]);
  const df = decodeDebugF16(new Uint8Array(f16.buffer), 2, 1, 4, 2);
  ok(Math.abs(df.T[0] - 0.5) < 1e-3 && Math.abs(df.mip[0] - 1.5) < 1e-3 && Number.isNaN(df.T[3]) && Number.isNaN(df.T[7]), `f16 해독: T ${df.T[0].toFixed(4)} · mip ${df.mip[0].toFixed(3)} · Σw 0 → NaN`);
  ok(windowMeanMip(field(() => 1.25), ones, W, H).every(v => Math.abs(v - 1.25) < 1e-12), '창마다 평균 mip');
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
    const fs = (await import('node:fs')).default;
    const [ca, ra] = await Promise.all(['--cand-alpha', '--ref-alpha'].map(k => { const f = get(k); if (!f) throw new Error('missing ' + k); return readPngRgba(f); }));
    const { W, H } = ca;
    if (ra.W !== W || ra.H !== H) throw new Error('size mismatch');
    const eps = (get('--eps') || RA_T.eps.join(',')).split(',').map(Number);
    const o = { ...RA_T, eps };
    const alphaC = decodeAlphaRgba(ca.rgba, W, H), alphaR = decodeAlphaRgba(ra.rgba, W, H);
    let Tc, Tr, mipC = null, mipR = null, source;
    if (get('--cand-f16') && get('--ref-f16')) {
      // 하네스 11: f16(반정밀도 T·Σw)이 있으면 그것 — 격자는 meta.debug.grid
      const gridOf = k => { const f = get(k); if (!f) throw new Error('missing ' + k + ' (needed with f16 input)'); const m = JSON.parse(fs.readFileSync(f, 'utf8')); const g = m.debug && m.debug.grid; if (!g) throw new Error(f + ' has no debug.grid'); return g; };
      const [gc, gr] = [gridOf('--cand-meta'), gridOf('--ref-meta')];
      const dc = decodeDebugF16(new Uint8Array(fs.readFileSync(get('--cand-f16'))), gc[0], gc[1], W, H), dr = decodeDebugF16(new Uint8Array(fs.readFileSync(get('--ref-f16'))), gr[0], gr[1], W, H);
      Tc = dc.T; Tr = dr.T; mipC = dc.mip; mipR = dr.mip; source = 'f16';
    } else {
      const [cd, rd] = await Promise.all(['--cand-debug', '--ref-debug'].map(k => { const f = get(k); if (!f) throw new Error('missing ' + k + ' (or --cand-f16/--ref-f16)'); return readPngRgba(f); }));
      if ([cd, rd].some(x => x.W !== W || x.H !== H)) throw new Error('size mismatch');
      Tc = decodeDebugRgba(cd.rgba, W, H); Tr = decodeDebugRgba(rd.rgba, W, H); source = 'png';
    }
    const u = raTUnit({ Tc, Tr, alphaC, alphaR, W, H }, o);
    for (const k of Object.keys(u.byEps)) delete u.byEps[k].d;
    const mip = mipC ? { cand: windowMeanMip(mipC, alphaC, W, H, o), ref: windowMeanMip(mipR, alphaR, W, H, o) } : null;
    console.log(JSON.stringify({ ...u, source, windowMeanMip: mip, refFlag: refDegenerateFlag(Tr, alphaR, o), note: 'R-A_T 보고(게이트 아님, U1)' }));
    return;
  }
  console.error('usage: ra-t.mjs unit (--cand-debug A --ref-debug R | --cand-f16 A.debug.f16 --ref-f16 R.debug.f16 --cand-meta A.meta.json --ref-meta R.meta.json) --cand-alpha A --ref-alpha R [--eps 0.01,0.03,0.1] | selftest');
  process.exit(2);
}
if (typeof process !== 'undefined' && process.argv[1] && import.meta.url === new URL('file://' + process.argv[1]).href) main(process.argv.slice(2)).catch(e => { console.error(e); process.exit(1); });
