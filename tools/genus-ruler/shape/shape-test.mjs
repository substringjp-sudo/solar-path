#!/usr/bin/env node
/**
 * shape-test.mjs — §139 구름 뼈대(`src/components/VolumetricProbe/cloudSkeleton.ts`) 단위 테스트. three.js 없이 묶어 돌립니다.
 *   node tools/genus-ruler/shape/shape-test.mjs
 * 검사(RULER-shape §7): LCL 125 m/K·클램프, 간격 2√2·min(pbl, LCL), 폭 중앙값 0.6 z, 절단 파레토 b 복원, Σ면적 = 운량 ± 3 %, 깊이 상한·종 r,
 * 역전 우선순위 4 단계, 롤/구름 거리 축(동풍 → x 로 늘어섬), 전단 식·상한·단위, 대용값, 결정적 시드·해시.
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const OUT = process.argv.find(a => a.startsWith('--out='))?.slice(6) ?? path.join(ROOT, '.harness/shape-test');
fs.mkdirSync(OUT, { recursive: true });
const BUNDLE = path.join(OUT, 'cloudSkeleton.cjs');
execFileSync('npx', ['esbuild', path.join(ROOT, 'src/components/VolumetricProbe/cloudSkeleton.ts'), '--bundle', '--format=cjs', '--platform=node', `--outfile=${BUNDLE}`, '--log-level=error'], { cwd: ROOT, stdio: 'inherit' });
if (/require\(["']three["']\)/.test(fs.readFileSync(BUNDLE, 'utf8'))) throw new Error('cloudSkeleton.ts must stay pure (no three.js)');
const require = createRequire(import.meta.url);
const S = require(BUNDLE);

let pass = 0, fail = 0;
const t = (name, ok, info = '') => { if (ok) pass++; else fail++; console.log((ok ? 'ok  ' : 'FAIL') + ' ' + name + (info ? '  ' + info : '')); };
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// 서울 10월 단면(기기 재현 S2)
const LV = [[166.71, 11.7, 1000], [382.46, 13.6, 975], [598.21, 12.1, 950], [823.76, 10.5, 925], [1049.31, 8.8, 900], [1520.03, 4.9, 850], [2010.36, 0.6, 800], [2529, -1.5, 750], [3079.29, -1.5, 700], [4295.31, -7.9, 600]]
  .map(([zM, tC, pHPa]) => ({ zM, tC, pHPa }));
const TH = { groundM: 40, t2mC: 20, td2mC: 12, levels: LV, pblM: 1100, capeJkg: 300, freezingLevelM: 3200, windLowMps: [6, 0], windMidMps: [12, 3] };
const TILE = 24;

// 1. LCL
t('LCL 125 m/K', near(S.lclAglM({ t2mC: 20, td2mC: 12 }), 1000, 1e-9));
t('LCL 하한 150', S.lclAglM({ t2mC: 10, td2mC: 9.5 }) === 150);
t('LCL 상한 3500', S.lclAglM({ t2mC: 40, td2mC: 0 }) === 3500);
t('LCL 없음 → null', S.lclAglM({ t2mC: 20 }) === null);
t('이슬점 Magnus 역산: RH 100 → T, RH 50 @20°C ≈ 9.3', near(S.dewPointC(20, 100), 20, 1e-6) && near(S.dewPointC(20, 50), 9.3, 0.3), S.dewPointC(20, 50).toFixed(2));
{
  // 혼합층 LCL: 지상 (T−Td) 2 K · 면 200 m (T−Td) 6 K · 면 500 m (T−Td) 6 K → z0 = 233, dep = 4.67 → 816 m (지상만이면 250)
  const th = { groundM: 100, t2mC: 15, td2mC: 13, levels: [{ zM: 300, tC: 14, pHPa: 990 }, { zM: 600, tC: 12, pHPa: 960 }, { zM: 1200, tC: 8, pHPa: 900 }],
    rhLevels: [{ zM: 300, rhPct: 100 * 6.112 * Math.exp((17.62 * 8) / (243.12 + 8)) / (6.112 * Math.exp((17.62 * 14) / (243.12 + 14))) }, { zM: 600, rhPct: 67 }, { zM: 1200, rhPct: 95 }] };
  const ml = S.lclAglM(th);
  t('혼합층 LCL: 지면 위 600 m 안 면들의 평균 (T−Td) 로', ml > 600 && ml < 1000, ml.toFixed(0));
  t('지상만(면 없음)이면 Espy 그대로', S.lclAglM({ groundM: 100, t2mC: 15, td2mC: 13 }) === 250);
}
{
  const k = S.skeletonOf({ genus: 'cu', cover: 0.2 }, { groundM: 0, t2mC: 20, td2mC: 12, pblM: 60 }, 24, 1);
  t('pblM 이 LCL 의 절반 아래(안정 시각 값)면 λ 척도는 LCL', near(k.lambdaKm, 2.828, 0.01), k.lambdaKm.toFixed(3));
}

// 2. 간격·폭
const cu = S.skeletonOf({ genus: 'cu', cover: 0.25 }, TH, TILE, 11);
t('간격 λ = 2√2·min(pbl, LCL) (1000 m → 2.83 km)', near(cu.lambdaKm, 2.828, 0.01), cu.lambdaKm.toFixed(3));
const cuPbl = S.skeletonOf({ genus: 'cu', cover: 0.25 }, { ...TH, pblM: 600 }, TILE, 11);
t('pblM 이 LCL 보다 낮으면 λ 는 pblM 척도', near(cuPbl.lambdaKm, 2.828 * 0.6, 0.01), cuPbl.lambdaKm.toFixed(3));
t('폭 중앙값 0.6 z_LCL', near(cu.w50Km, 0.6, 1e-9));
t('밑면 = 지면 + LCL (해발)', near(cu.baseM, 1040, 1e-6), String(cu.baseM));
{
  // 폭 배율이 안 걸리는 아주 낮은 운량에서만 표본 중앙값 = w50 (λ 2.83 z·w 0.6 z 의 자연 채움은 ~5 % — 그 위는 운량이 폭을 정함, RULER-shape §1.1)
  const low = S.skeletonOf({ genus: 'cu', cover: 0.03 }, TH, TILE, 11);
  const ws = low.cells.map(c => c.wKm).sort((a, b) => a - b);
  const med = ws[Math.floor(ws.length / 2)];
  t('표본 폭 중앙값 ≈ w50 (±25 %, 운량 0.03)', low.widthScale === 1 && near(med, low.w50Km, 0.25 * low.w50Km), `${med.toFixed(3)} scale ${low.widthScale}`);
  t('폭 상한 0.6 λ', cu.cells.every(c => c.wKm <= 0.6 * cu.lambdaKm + 1e-9));
  t('운량 0.25 는 폭 배율 체제(자연 채움 < 0.25)', cu.widthScale > 1, cu.widthScale.toFixed(2));
}

// 3. 절단 파레토 b 복원(MLE, 큰 표본)
{
  const aMin = 1e-4, aMax = 1e4, n = 20000, rng = S.skRng(5);   // 절단이 무시되는 범위
  let sum = 0;
  for (let i = 0; i < n; i++) sum += Math.log(S.paretoArea(rng(), aMin, aMax) / aMin);
  const bHat = 1 + n / sum;
  t('파레토 지수 b ≈ 1.7 (MLE, 절단 무시 범위)', near(bHat, 1.7, 0.03), bHat.toFixed(3));
  // 절단: 누적분포 P(a ≤ q) 가 해석식과 같음
  const q = 0.5, k = 0.7, cdf = (1 - Math.pow(0.1 / q, k)) / (1 - Math.pow(0.1 / 2, k));
  t('절단 파레토 역누적 ↔ 누적 일치', near(S.paretoArea(cdf, 0.1, 2), q, 1e-9));
  const am = S.aMinForMedian(0.283, 1.0);
  t('aMinForMedian: 중앙값이 목표와 같음', near(S.paretoArea(0.5, am, 1.0), 0.283, 1e-6));
  t('목표 ≥ aMax 면 aMin = aMax', S.aMinForMedian(2, 1) === 1);
}

// 4. 면적 = 운량
for (const cover of [0.1, 0.25, 0.5]) {
  const k = S.skeletonOf({ genus: 'cu', cover }, TH, TILE, 3);
  const area = k.cells.filter(c => c.on).reduce((s, c) => s + (Math.PI / 4) * c.wKm * c.wKm, 0) / (TILE * TILE);
  t(`Σ켜진 면적 ≈ cover ${cover} (±3 % 또는 스커트)`, k.skirt || near(area, cover, 0.03), `area ${area.toFixed(3)} widthScale ${k.widthScale.toFixed(2)} skirt ${k.skirt}`);
  t(`areaOn 기록 일치 (${cover})`, near(k.areaOn, area, 1e-6));
}
{
  const k = S.skeletonOf({ genus: 'cu', cover: 0.9 }, TH, TILE, 3);
  t('운량 0.9: 폭 배율 > 1 (합쳐지는 체제)', k.widthScale > 1, k.widthScale.toFixed(2));
  t('운량 0.9: 모든 자리 켜짐', k.cells.every(c => c.on));
}

// 5. 깊이·종
{
  t('cu 깊이 ≤ D_max', cu.cells.every(c => c.dM <= cu.dMaxM + 1e-9));
  t('cu D_max = 역전(pbl 1100) − LCL(1000) 가 아니라 ≥ 150 클램프 … (100 m → 150)', near(cu.dMaxM, 150, 1e-9), String(cu.dMaxM));
  const cu2 = S.skeletonOf({ genus: 'cu', cover: 0.3 }, { ...TH, pblM: 1900 }, TILE, 3);
  t('cu D_max = 역전 − LCL (1900 − 1000)', near(cu2.dMaxM, 900, 1e-9), String(cu2.dMaxM));
  t('cu r50 = clamp(D_max/z, 0.4, 1.2) → 0.9', near(cu2.r50, 0.9, 1e-9));
  t('층 높이 = 켜진 열기둥 최대 깊이 ≤ D_max', cu2.heightM <= cu2.dMaxM && cu2.heightM > 0);
  const big = cu2.cells.reduce((m, c) => (c.wKm > m.wKm ? c : m));
  const small = cu2.cells.reduce((m, c) => (c.wKm < m.wKm ? c : m));
  t('큰 열기둥이 더 깊음', big.dM >= small.dM);
  const cg = S.skeletonOf({ genus: 'cg', cover: 0.4 }, TH, TILE, 3);
  t('cg D_max = 영하고도 − 지면 − LCL (3200 − 40 − 1000 = 2160 → ≥ 2500)', near(cg.dMaxM, 2500, 1e-9), String(cg.dMaxM));
  t('cg r50 ∈ [1.2, 2]', cg.r50 >= 1.2 && cg.r50 <= 2, cg.r50.toFixed(2));
  const deck = S.skeletonOf({ genus: 'cu', cover: 0.3, thicknessM: 700 }, TH, TILE, 3);
  t('예보 덱 두께가 있으면 D_max 그대로', deck.dMaxM === 700);
  t('cg w_up = max(3, 0.3√(2·300)) = 7.35', near(cg.wUpMps, 0.3 * Math.sqrt(600), 1e-9));
  t('cu w_up = 2', cu.wUpMps === 2);
}

// 6. 역전 우선순위
{
  const base = 1000;
  t('(1) pblM', S.inversionAglM(TH, base).source === 'pbl');
  const rh = { groundM: 40, levels: LV, rhLevels: [[1049.31, 92], [1520.03, 90], [2010.36, 40], [2529, 30]].map(([zM, rhPct]) => ({ zM, rhPct })) };
  const r = S.inversionAglM(rh, base);
  t('(2) RH ≥ 85 % 연속면 꼭대기 (1480 ~ 1970 의 가운데)', r.source === 'rh' && near(r.zM, (1480.03 + 1970.36) / 2, 1), `${r.source} ${r.zM.toFixed(0)}`);
  const th = { groundM: 40, levels: [[200, 15, 1000], [700, 11, 950], [1200, 8, 900], [1700, 9, 850], [2200, 7, 800], [3200, 1, 700]].map(([zM, tC, pHPa]) => ({ zM, tC, pHPa })) };
  const q = S.inversionAglM(th, 500);
  t('(3) dθ/dz 최대 면(1160 m 의 역전, ≥ 4 K/km)', q.source === 'theta' && near(q.zM, 1160, 1), `${q.source} ${q.zM.toFixed(0)}`);
  const f = S.inversionAglM({ groundM: 0, levels: LV }, 2800);
  t('(4) 대용 +600', f.source === 'fallback' && f.zM === 3400);
  t('pblM 이 밑면 아래면 다음 출처', S.inversionAglM({ ...TH, pblM: 900, rhLevels: [] }, base).source !== 'pbl');
}

// 7. 층적운
{
  const sc = S.skeletonOf({ genus: 'sc', cover: 0.4, baseKm: 1.2 }, { ...TH, pblM: 1900 }, TILE, 9);
  t('sc 밑면 = 예보 덱', near(sc.baseM, 1200, 1e-6));
  t('sc 두께 = 역전 − 밑면 (1900 − 1160 = 740)', near(sc.heightM, 740, 1e-6), String(sc.heightM));
  t('sc 뚜껑 모드 3', sc.mode === 3);
  t('sc 열린 세포(운량 0.4)', sc.open === true);
  t('sc 요소 간격 2.5 h (h = 1.9 km)', near(sc.elKm, 2.5 * 1.9, 1e-6), sc.elKm.toFixed(2));
  t('sc 중규모 35 h', near(sc.mesoKm, 35 * 1.9, 1e-6));
  const sc85 = S.skeletonOf({ genus: 'sc', cover: 0.85, baseKm: 1.2 }, { ...TH, pblM: 1900 }, TILE, 9);
  t('sc 닫힌 세포(운량 0.85)', sc85.open === false);
  const scP = S.skeletonOf({ genus: 'sc', cover: 0.85, baseKm: 1.2 }, { ...TH, pblM: 1900, precipMm: 0.5 }, TILE, 9);
  t('강수 있으면 열린 세포', scP.open === true);
  t('sc 롤 방향 = 바람(동 90°) − 15° = 75°', sc.rollDeg === 75, String(sc.rollDeg));
  const calm = S.skeletonOf({ genus: 'sc', cover: 0.4, baseKm: 1.2 }, { ...TH, windLowMps: [2, 2] }, TILE, 9);
  t('바람 < 5 m/s 면 등방(rollDeg null)', calm.rollDeg === null);
  const thick = S.skeletonOf({ genus: 'sc', cover: 0.5, baseKm: 0.5 }, { groundM: 0, pblM: 3000 }, TILE, 1);
  t('sc 두께 상한 1200', thick.heightM === 1200);
}

// 8. 구름 거리 축: 동풍(바람이 동으로 붊) → 열이 x(동) 방향으로 늘어섬 — 가로(y) 지터가 작음
{
  const st = S.skeletonOf({ genus: 'cu', cover: 0.25 }, { ...TH, windLowMps: [8, 0], windMidMps: [8, 0] }, TILE, 2);
  t('구름 거리 방향 75° (동 − 15°)', st.rollDeg === 75);
  const n = Math.round(TILE / st.lambdaKm);
  // 같은 행(j)의 열기둥 y 분산이 열(i) 의 x 분산보다 작음 (방향 75° ≈ 동)
  let sy = 0, sx = 0;
  for (let j = 0; j < n; j++) {
    const row = st.cells.slice(j * n, (j + 1) * n);
    const my = row.reduce((s, c) => s + c.y, 0) / n;
    sy += row.reduce((s, c) => s + (c.y - my) ** 2, 0) / n;
    const col = Array.from({ length: n }, (_, i) => st.cells[i * n + j]);
    const mx = col.reduce((s, c) => s + c.x, 0) / n;
    sx += col.reduce((s, c) => s + (c.x - mx) ** 2, 0) / n;
  }
  t('동풍 구름 거리: 행 안 y 흩어짐 < 열 안 x 흩어짐', sy < sx, `sy ${sy.toExponential(2)} sx ${sx.toExponential(2)}`);
}

// 9. 전단
{
  const tl = S.shearTilt({ windLowMps: [0, 0], windMidMps: [5.4, 0] }, 1000, 2);   // S = 5.4/2700 = 0.002 /s → 밀림 = 0.002·1e6/4 = 500 m → tilt 0.5
  t('전단 밀림 S·D²/(2 w_up) → tilt 0.5 (동)', near(tl[0], 0.5, 1e-9) && near(tl[1], 0, 1e-9), tl.map(v => v.toFixed(3)).join(','));
  const cap = S.shearTilt({ windLowMps: [0, 0], windMidMps: [0, 54] }, 3000, 2);   // 0.02/s·9e6/4 = 45 km → 상한 1.5 D
  t('전단 상한 1.5 D (북)', near(cap[1], 1.5, 1e-9) && near(cap[0], 0, 1e-9));
  t('바람 없음 → 0', S.shearTilt({}, 1000, 2).every(v => v === 0));
  t('cu 뼈대 tilt 는 heightM·w_up 2 로', cu.tilt.every(Number.isFinite));
}

// 10. 대용값·결정성·해시
{
  const none = S.skeletonOf({ genus: 'cu', cover: 0.3 }, null, TILE, 4);
  t('열역학 없음: 밑면 1000 m, λ 2.83, D_max 0.7 z = 700', near(none.baseM, 1000, 1e-9) && near(none.lambdaKm, 2.828, 0.01) && none.dMaxM === 700, `${none.baseM} ${none.lambdaKm.toFixed(2)} ${none.dMaxM}`);
  t('열역학 없음: 등방·전단 0', none.rollDeg === null && none.tilt.every(v => v === 0));
  const deckOnly = S.skeletonOf({ genus: 'cu', cover: 0.3, baseKm: 1.5 }, { groundM: 100 }, TILE, 4);
  t('이슬점 없음 → 밑면 = 예보 덱, z = 덱 − 지면', near(deckOnly.baseM, 1500, 1e-6) && near(deckOnly.lambdaKm, 2.828 * 1.4, 0.01));
  const a = S.skeletonOf({ genus: 'cu', cover: 0.3 }, TH, TILE, 7), b = S.skeletonOf({ genus: 'cu', cover: 0.3 }, TH, TILE, 7), c = S.skeletonOf({ genus: 'cu', cover: 0.3 }, TH, TILE, 8);
  t('같은 입력 → 같은 해시', a.hash === b.hash && JSON.stringify(a.cells) === JSON.stringify(b.cells));
  t('다른 시드 → 다른 해시', a.hash !== c.hash);
  const d = S.skeletonOf({ genus: 'cu', cover: 0.3 }, { ...TH, pblM: 800 }, TILE, 7);
  t('다른 열역학 → 다른 해시', a.hash !== d.hash);
  t('자리는 [0,1) 안', cu.cells.every(cc => cc.x >= 0 && cc.x < 1 && cc.y >= 0 && cc.y < 1));
}

// 11. K3 열기둥별 변이(vary)
{
  const th3 = { ...TH, pblM: 1900 };
  const k1 = S.skeletonOf({ genus: 'cu', cover: 0.3 }, th3, TILE, 21), k3 = S.skeletonOf({ genus: 'cu', cover: 0.3 }, th3, TILE, 21, { vary: true });
  const d1 = k1.cells.map(c => c.dM), d3 = k3.cells.map(c => c.dM);
  const cv = a => { const m = a.reduce((s, v) => s + v, 0) / a.length; return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length) / m; };
  t('K3: 깊이 변동계수가 K1 보다 큼', cv(d3) > cv(d1) + 0.1, `K1 ${cv(d1).toFixed(2)} K3 ${cv(d3).toFixed(2)}`);
  const top3 = d3.filter(d => d >= 0.999 * k3.dMaxM).length / d3.length;
  t('K3: D_max 에 닿는 열기둥은 소수(≤ 40 %)', top3 <= 0.4, top3.toFixed(2));
  t('K3: 깊이 하한 0.25·min(r w, D_max)·(소멸 ½)', d3.every(d => d >= 0.25 * 0.5 * 150 - 1e-9));
  const stages = [0, 1, 2].map(s => k3.cells.filter(c => c.stage === s).length / k3.cells.length);
  t('K3: 생애 단계 비율 ≈ 0.4/0.35/0.25 (±0.15)', Math.abs(stages[0] - 0.4) < 0.15 && Math.abs(stages[1] - 0.35) < 0.15 && Math.abs(stages[2] - 0.25) < 0.15, stages.map(v => v.toFixed(2)).join('/'));
  t('K3: 성숙 단계 캡 지수 < 성장 단계(평평한 꼭대기)', k3.cells.filter(c => c.stage === 1).every(c => c.p < 0.5 / S.VARY.R_MIN) && k3.cells.some(c => c.stage === 1 && c.p < k3.cells.find(x => x.stage === 0).p + 1));
  t('K3: 소멸 단계 capW 0.4', k3.cells.filter(c => c.stage === 2).every(c => c.capW === 0.4));
  t('K3: 비대칭 방향 = 바람 단위벡터(동풍 → [1,0])', k3.cells.every(c => Math.abs(c.dir[0] - 1) < 1e-9 && Math.abs(c.dir[1]) < 1e-9) && k3.cells.every(c => c.off === 0.15 && c.ax === 0.8));
  t('K3: 스커트 없음', k3.skirt === false);
  t('K3: K1 과 해시 다름 · 자리는 같음', k1.hash !== k3.hash && k1.cells.every((c, i) => c.x === k3.cells[i].x && c.y === k3.cells[i].y));
  t('K3: 결정적', S.skeletonOf({ genus: 'cu', cover: 0.3 }, th3, TILE, 21, { vary: true }).hash === k3.hash);
  t('K1(vary 없음) 셀에 변이 필드 없음', k1.cells.every(c => c.p === undefined && c.stage === undefined));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
