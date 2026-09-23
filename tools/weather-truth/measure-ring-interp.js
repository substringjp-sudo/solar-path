/**
 * **고리 사이를 선형 보간하는 것이 맞는가** — 실측.
 *
 * ## 무엇을 묻는 것인가
 *
 * 구름 고리는 **5 · 10 · 30 · 70 · 130 · 200 · 280 · 380km** 에서만 받습니다.
 * 바깥으로 갈수록 간격이 벌어져 280→380 은 **100km** 가 빕니다.
 * `skyColumn.WeatherFan.alongRay` 는 그 사이를 **선형 보간**합니다.
 *
 * > 그 빈 자리를 두 값의 중간으로 채우는 게 맞나? 아니면 안쪽 값을 그대로
 * > 끌고 가는(계단) 편이 나은가?
 *
 * 이 자가 **촘촘한 참값**을 따로 받아 견줍니다. 10km 마다 받아서, 고리 표본만
 * 쓴 추정과 실제 값의 차이를 구간별로 냅니다.
 *
 * ## ⚠ 여기서 "참값" 은 **모델이 말하는 값**입니다
 *
 * 하늘의 진짜 구름이 아니라 같은 예보 모델을 촘촘히 물어본 것입니다. 그래서
 * 이 자가 답하는 질문은 **"모델이 아는 것을 우리가 얼마나 잃는가"** 이지
 * "현실을 얼마나 맞히는가" 가 아닙니다. 후자는 §71~72 의 몫입니다.
 *
 * ## ⚠ 예보 격자가 이 판정을 흔듭니다
 *
 * ECMWF IFS025 는 약 25km, ICON 은 약 11km 격자입니다. 두 고리가 **같은 칸**에
 * 들어가면 모델 값이 글자 그대로 같아서:
 *
 * ```
 *   계단   → 오차 0      (같은 칸이니 당연히 맞다)
 *   보간   → 오차 > 0    (없는 기울기를 만들어 낸다)
 * ```
 *
 * 곧 **가까운 구간에서는 계단이 이길 수 있습니다.** 그게 보간이 틀렸다는
 * 뜻은 아닙니다 — 모델 해상도가 거기서 바닥났다는 뜻입니다. 그래서 이 자는
 * 구간별로 따로 내고, 어느 구간이 "한 칸 안" 이었는지도 찍습니다.
 *
 * 사용: node tools/weather-truth/measure-ring-interp.js
 */
const https = require('https');

/** 앱이 실제로 받는 고리 거리(5km 는 관측점에 너무 가까워 뺍니다). */
const RINGS = [10, 30, 70, 130, 200, 280, 380];
/** 참값을 이만큼 촘촘히 받습니다. */
const DIST = Array.from({ length: 38 }, (_, i) => (i + 1) * 10);
/** 기후대를 흩어 놓습니다 — 한 곳만 보면 그날 그 하늘의 성질을 일반화합니다. */
const LOCS = [
  ['일본 후쿠이', 35.3606, 136.1875],
  ['서울', 37.5665, 126.9780],
  ['세비야', 37.3891, -5.9845],
];
const AZ = 270;

const dest = (la, lo, d, az) => {
  const R = 6371, br = az * Math.PI / 180, dr = d / R;
  const a = la * Math.PI / 180, b = lo * Math.PI / 180;
  const a2 = Math.asin(Math.sin(a) * Math.cos(dr) + Math.cos(a) * Math.sin(dr) * Math.cos(br));
  const b2 = b + Math.atan2(Math.sin(br) * Math.sin(dr) * Math.cos(a),
                            Math.cos(dr) - Math.sin(a) * Math.sin(a2));
  return [+(a2 * 180 / Math.PI).toFixed(5), +(b2 * 180 / Math.PI).toFixed(5)];
};
const get = url => new Promise((res, rej) => {
  https.get(url, r => { let s = ''; r.on('data', c => s += c); r.on('end', () => res(s)); }).on('error', rej);
});
const rms = a => Math.sqrt(a.reduce((s, x) => s + x * x, 0) / a.length);

/** 고리 표본만으로 거리 d 를 **선형 보간**. */
const interp = (rv, d) => {
  if (d <= RINGS[0]) return rv[RINGS[0]];
  if (d >= RINGS[RINGS.length - 1]) return rv[RINGS[RINGS.length - 1]];
  for (let i = 0; i < RINGS.length - 1; i++) {
    const a = RINGS[i], b = RINGS[i + 1];
    if (d >= a && d <= b) return rv[a] + (rv[b] - rv[a]) * (d - a) / (b - a);
  }
};
/** 안쪽 고리 값을 그대로 끌고 가기(계단). */
const hold = (rv, d) => {
  const inner = RINGS.filter(r => r <= d);
  return rv[inner.length ? inner[inner.length - 1] : RINGS[0]];
};

(async () => {
  const pts = [];
  for (const [name, la, lo] of LOCS) for (const d of DIST) pts.push([name, d, ...dest(la, lo, d, AZ)]);
  console.log(`장소 ${LOCS.length} × 거리 ${DIST.length} = 점 ${pts.length}개 · 방위 ${AZ}°`);

  const today = new Date().toISOString().slice(0, 10);
  const url = 'https://api.open-meteo.com/v1/forecast'
    + `?latitude=${pts.map(p => p[2]).join(',')}`
    + `&longitude=${pts.map(p => p[3]).join(',')}`
    + '&hourly=cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high'
    + `&start_date=${today}&end_date=${today}&timezone=auto`
    + '&models=ecmwf_ifs025,icon_seamless';

  let arr;
  try {
    arr = JSON.parse(await get(url));
  } catch {
    console.log('응답을 못 읽었습니다.'); process.exit(2);
  }
  if (!Array.isArray(arr)) {
    console.log(`\nAPI 오류: ${arr?.reason ?? '알 수 없음'}`);
    if (String(arr?.reason || '').includes('limit')) console.log('→ 하루 한도입니다. 내일 다시 돌리세요.');
    process.exit(2);
  }

  // 모델을 둘 요청하면 변수 이름에 접미사가 붙습니다.
  const pick = (h, base) => {
    for (const k of Object.keys(h)) if (k.startsWith(base) && k !== 'time') return h[k];
    return null;
  };
  const V = {};
  pts.forEach(([name, d], i) => {
    (V[name] ??= {})[d] = {
      total: pick(arr[i].hourly, 'cloud_cover_e') ?? pick(arr[i].hourly, 'cloud_cover'),
      low: pick(arr[i].hourly, 'cloud_cover_low'),
      mid: pick(arr[i].hourly, 'cloud_cover_mid'),
      high: pick(arr[i].hourly, 'cloud_cover_high'),
    };
  });

  let interpWins = 0, holdWins = 0, ties = 0, sameCellGaps = 0, comparisons = 0;
  const allI = [], allH = [];

  for (const varName of ['total', 'low', 'mid', 'high']) {
    console.log(`\n══ ${varName} ══`);
    console.log(`${'장소'.padStart(10)} ${'구간'.padStart(10)} ${'보간'.padStart(7)} ${'계단'.padStart(7)}  판정`);
    for (const [name] of LOCS) {
      for (let i = 0; i < RINGS.length - 1; i++) {
        const a = RINGS[i], b = RINGS[i + 1];
        const ei = [], eh = [];
        let sameCell = true;
        for (let hh = 0; hh < 24; hh++) {
          const rv = {};
          let ok = true;
          for (const r of RINGS) {
            const v = V[name][r][varName]?.[hh];
            if (v == null) { ok = false; break; }
            rv[r] = v;
          }
          if (!ok) continue;
          if (rv[a] !== rv[b]) sameCell = false;
          for (const d of DIST) {
            if (d <= a || d >= b) continue;
            const t = V[name][d][varName]?.[hh];
            if (t == null) continue;
            ei.push(Math.abs(interp(rv, d) - t));
            eh.push(Math.abs(hold(rv, d) - t));
          }
        }
        if (!ei.length) continue;
        const ri = rms(ei), rh = rms(eh);
        allI.push(...ei); allH.push(...eh);
        comparisons++;
        if (sameCell) sameCellGaps++;
        let verdict;
        if (ri < rh - 0.05) { verdict = '보간'; interpWins++; }
        else if (rh < ri - 0.05) { verdict = '계단'; holdWins++; }
        else { verdict = '무승부'; ties++; }
        console.log(`${name.padStart(10)} ${`${a}-${b}`.padStart(10)} ${ri.toFixed(1).padStart(7)} ${rh.toFixed(1).padStart(7)}`
          + `  ${verdict}${sameCell ? '  (두 고리가 같은 칸)' : ''}`);
      }
    }
  }

  const RI = rms(allI), RH = rms(allH);
  console.log('\n══ 전체 ══');
  console.log(`  보간 RMS ${RI.toFixed(1)}%p · 계단 RMS ${RH.toFixed(1)}%p`
    + `  → 보간이 ${((1 - RI / RH) * 100).toFixed(0)}% 낮음`);
  console.log(`  구간별 승부: 보간 ${interpWins} · 계단 ${holdWins} · 무승부 ${ties}`);

  /* ⚠ **자가 공허하지 않은지 확인합니다.**
   *
   * 두 고리가 같은 격자 칸이면 계단이 자동으로 맞습니다. 그런 구간만 모여
   * 있으면 이 판정은 보간을 시험한 적이 없는 셈입니다.
   */
  console.log('\n자 자체 점검');
  console.log(`  견준 구간 ${comparisons}개 중 **두 고리가 같은 칸**이던 구간: ${sameCellGaps}개`);
  if (sameCellGaps === comparisons) {
    console.log('  ⚠ 전부 같은 칸이었습니다 — 보간이 **시험되지 않았습니다.** 이 결과는 뜻이 없습니다.');
    process.exit(2);
  }
  console.log(`  → 값이 실제로 달랐던 구간 ${comparisons - sameCellGaps}개에서 판정됐습니다.`);
  if (allI.length < 100) {
    console.log(`  ⚠ 표본이 ${allI.length}개뿐입니다 — 너무 적습니다.`);
    process.exit(2);
  }
  console.log(`  표본 ${allI.length}개.`);
  console.log('\n⚠ 참값은 **모델이 말하는 값**입니다 — 현실이 아니라 "모델이 아는 것을 얼마나 잃는가" 입니다.');
  console.log('⚠ 하루치 · 방위 하나입니다. 날을 바꿔 여러 번 돌려야 일반화됩니다.');
  process.exit(RI < RH ? 0 : 1);
})();
