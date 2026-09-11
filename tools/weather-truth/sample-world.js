/**
 * **전 세계 무작위 지점·날짜·시각의 실제 예보를 붙박이 표본으로 굳힙니다.**
 *
 * > "무작위로 전세계 지역과 날짜, 시간을 찍어서 시뮬레이션을 돌린 뒤에
 * >  실제 해당 지역의 상세일기예보 결과와 비교해보면 어떨까"
 *
 * ⚠ **이 자가 재는 것은 "예보를 화면에 제대로 옮기는가" 입니다.**
 * "하늘과 닮았는가" 가 아닙니다 — 예보 자체가 치우쳐 있다는 것은 §56 에서
 * 이미 쟀습니다. 둘은 다른 자입니다. 이쪽은 **렌더러의 충실도**만 봅니다.
 *
 * 표본을 파일로 굳히는 이유: 판정이 **네트워크 없이 재현**돼야 합니다.
 * 무작위 지점을 매번 새로 받으면 실패가 재현이 안 돼 회귀 자로 못 씁니다.
 * 씨앗을 고정하고, 받은 것을 그대로 저장합니다. 새로 뽑으려면 씨앗을 바꿉니다.
 *
 *   node tools/weather-truth/sample-world.js [표본수] [씨앗]
 */
const fs = require('fs');
const path = require('path');

const N = Number(process.argv[2] || 24);
const SEED = Number(process.argv[3] || 20260911);
const OUT = path.join(__dirname, '..', 'shader-preview', 'fixtures', 'world-forecast.json');

/** mulberry32 — 씨앗이 같으면 늘 같은 표본이 나옵니다. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PROFILE_LEVELS = [1000, 925, 850, 700, 600, 500, 400, 300, 250, 200];
const MODELS = ['ecmwf_ifs025', 'icon_seamless'];   // 앱이 실제로 섞는 둘

(async () => {
  const r = rng(SEED);

  // ── 지점: **구면 위에 고르게** 뽑습니다. 위도를 고르게 뽑으면 극지에
  //    몰립니다(같은 위도 띠의 면적이 cos φ 에 비례하므로).
  const pts = [];
  while (pts.length < N) {
    const lat = Math.asin(2 * r() - 1) * 180 / Math.PI;
    const lon = r() * 360 - 180;
    // 극지는 예보 모델이 층별을 잘 안 줍니다 — ±75° 로 자릅니다.
    if (Math.abs(lat) > 75) continue;
    pts.push({ lat: +lat.toFixed(4), lon: +lon.toFixed(4) });
  }

  // ── 날짜·시각: 지난 10일 ~ 앞으로 3일 안에서 무작위.
  const today = new Date();
  const day0 = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) - 10 * 86400_000);
  const SPAN_DAYS = 14;
  const iso = d => d.toISOString().slice(0, 10);
  const startDate = iso(day0);
  const endDate = iso(new Date(day0.getTime() + (SPAN_DAYS - 1) * 86400_000));

  console.log(`표본 ${N}개 · 씨앗 ${SEED} · ${startDate}~${endDate}`);

  // ── 한 요청에 지점을 전부 싣습니다(쉼표 목록). 요청 수가 아니라
  //    **변수 수 × 날짜 수** 가 비용이라 이렇게 묶는 편이 훨씬 쌉니다.
  const vars = ['cloud_cover', 'cloud_cover_low', 'cloud_cover_mid', 'cloud_cover_high']
    .concat(PROFILE_LEVELS.flatMap(p => [`cloud_cover_${p}hPa`, `geopotential_height_${p}hPa`]));

  const url = `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${pts.map(p => p.lat).join(',')}` +
    `&longitude=${pts.map(p => p.lon).join(',')}` +
    `&hourly=${vars.join(',')}&models=${MODELS.join(',')}` +
    `&start_date=${startDate}&end_date=${endDate}&timezone=UTC`;

  const res = await fetch(url);
  if (!res.ok) { console.error(res.status, (await res.text()).slice(0, 400)); process.exit(1); }
  let body = await res.json();
  if (!Array.isArray(body)) body = [body];     // 지점이 하나면 배열이 아닙니다

  const samples = [];
  for (let i = 0; i < body.length; i++) {
    const h = body[i]?.hourly;
    if (!h?.time?.length) continue;

    // 모델 둘을 평균합니다(앱과 같은 방식). 한쪽이 null 이면 나머지로.
    const blend = base => h.time.map((_, k) => {
      const v = MODELS.map(m => h[`${base}_${m}`]?.[k]).filter(x => x != null);
      return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
    });

    const total = blend('cloud_cover'), low = blend('cloud_cover_low'),
          mid = blend('cloud_cover_mid'), high = blend('cloud_cover_high');

    // 그 지점의 시각 하나를 무작위로. 층별이 다 있는 시각만 씁니다.
    const usable = [];
    for (let k = 0; k < h.time.length; k++) {
      if (low[k] != null && mid[k] != null && high[k] != null && total[k] != null) usable.push(k);
    }
    if (!usable.length) { console.log(`  건너뜀 ${body[i].latitude},${body[i].longitude} — 층별 없음`); continue; }
    const k = usable[Math.floor(r() * usable.length)];

    // 기압면 단면 — cloudProfile.extractProfile 이 읽는 그 모양 그대로.
    const profile = {};
    for (const p of PROFILE_LEVELS) {
      for (const base of ['cloud_cover', 'geopotential_height']) {
        const v = MODELS.map(m => h[`${base}_${p}hPa_${m}`]?.[k]).filter(x => x != null);
        if (v.length) profile[`${base}_${p}hPa`] = [v.reduce((a, b) => a + b, 0) / v.length];
      }
    }

    samples.push({
      lat: body[i].latitude, lon: body[i].longitude,
      elevationM: body[i].elevation,
      time: h.time[k],
      total: +total[k].toFixed(1), low: +low[k].toFixed(1),
      mid: +mid[k].toFixed(1), high: +high[k].toFixed(1),
      profile,
    });
  }

  fs.writeFileSync(OUT, JSON.stringify({ seed: SEED, fetchedAt: new Date().toISOString(),
                                         models: MODELS, samples }, null, 1));
  console.log(`\n표본 ${samples.length}개를 굳혔습니다 → ${path.relative(process.cwd(), OUT)}`);
  const q = a => { const s = [...a].sort((x, y) => x - y); return s; };
  const tt = q(samples.map(s => s.total));
  console.log(`  총운량 분포: 최소 ${tt[0]} · 4분위 ${tt[Math.floor(tt.length*0.25)]} · 중앙 ${tt[Math.floor(tt.length*0.5)]} · 3분위 ${tt[Math.floor(tt.length*0.75)]} · 최대 ${tt[tt.length-1]}`);
})();
