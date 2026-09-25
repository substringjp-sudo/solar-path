/**
 * 예보를 **며칠 전에** 봤을 때 얼마나 맞나 — 운량 예보의 선행시간별 오차.
 *
 * > "우리 앱이 생각보다 여행에 큰 도움이 됐어. … 내가 이따가 갈 곳의 날씨도 미리 파악이
 * >  되더라구. 정확도만 더 높이면 큰 도움이 될거같아."
 *
 * `verify-cloud-forecast.js` 는 Open-Meteo 예보 API 에 **지난 날짜**를 물어, 그날 가장 최근
 * 모델 실행(선행 0~24시간)으로 이어 붙인 값만 봅니다. 여행 계획은 하루~사흘 전에 봅니다.
 * 여기서는 이전 실행 API(`previous-runs-api`)의 `cloud_cover_previous_dayN` — **N일 전 실행이
 * 같은 시각에 내놓았던 값** — 을 같은 위성 자로 잽니다.
 *
 * 자는 `verify-cloud-forecast.js` 와 같습니다(README):
 *  - 관측: `satellite_radiation_seamless` 시간별 일사 / Haurwitz 맑은하늘 → τ.
 *  - 지역 배율: 모든 모델이 당일 실행에서 맑다(≤20%)고 한 시각의 τ 평균(8개 미만이면 τ 상위 5%).
 *  - 모델 운량은 τ = 1 − 0.75·(N/100)^3.4 로 바꿔 τ 끼리 뺍니다.
 *  - 태양고도 15° 이상만. ⚠ 일몰 순간 자체는 이 자로 못 잽니다(README "못 재는 것").
 *
 * 사용:
 *   node tools/weather-truth/verify-lead-time.js [일수=30] [모델들]
 *   node tools/weather-truth/verify-lead-time.js 30 ecmwf_ifs025,icon_seamless,jma_seamless,gfs_seamless
 *
 * 판정이 아니라 **재는 자**입니다 — 종료 코드는 자료를 못 받았을 때만 1 입니다.
 */
const DAYS = Number(process.argv[2] || 30);
const MODELS = (process.argv[3] || 'ecmwf_ifs025,icon_seamless,jma_seamless,gfs_seamless').split(',');
/** 앱이 지금 섞는 둘(`src/utils/modelBlend.ts`). */
const APP_MODELS = ['ecmwf_ifs025', 'icon_seamless'];
const LEADS = [0, 1, 2, 3];
const PLACES = [
  { name: '서울 도곡동', lat: 37.4863, lon: 127.0443 },
  { name: '강원 인제', lat: 38.0695, lon: 128.1704 },
  { name: '제주 서귀포', lat: 33.2541, lon: 126.5601 },
  { name: '일본 요네자와', lat: 37.9222, lon: 140.1168 },
  { name: '일본 도쿄', lat: 35.6812, lon: 139.7671 },
  { name: '독일 뮌헨', lat: 48.1372, lon: 11.5756 },
  { name: '영국 런던', lat: 51.5072, lon: -0.1276 },
  { name: '스페인 세비야', lat: 37.3891, lon: -5.9845 },
  { name: '몽골 울란바토르', lat: 47.8864, lon: 106.9057 },
  { name: '케냐 나이로비', lat: -1.2921, lon: 36.8219 },
  { name: '호주 시드니', lat: -33.8688, lon: 151.2093 },
];

const rad = d => d * Math.PI / 180;
function cosZenith(d, lat, lon) {
  const jd = d.getTime() / 86400000 + 2440587.5, n = jd - 2451545.0;
  const L = (280.460 + 0.9856474 * n) % 360, g = rad((357.528 + 0.9856003 * n) % 360);
  const lam = rad(L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)), eps = rad(23.439 - 0.0000004 * n);
  const dec = Math.asin(Math.sin(eps) * Math.sin(lam));
  const gmst = (18.697374558 + 24.06570982441908 * n) % 24;
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam));
  const ha = rad(gmst * 15 + lon) - ra;
  return Math.sin(rad(lat)) * Math.sin(dec) + Math.cos(rad(lat)) * Math.cos(dec) * Math.cos(ha);
}
// ⚠ 일사는 직전 한 시간 평균이라 맑은하늘도 같은 창에서 평균합니다(앱 fetchSatelliteBias 와 같음).
const haurwitz = cz => cz <= 0 ? 0 : 1098 * cz * Math.exp(-0.059 / cz);
function clearSkyHour(endUtc, lat, lon) {
  let s = 0;
  for (let k = 0; k < 6; k++) s += haurwitz(cosZenith(new Date(endUtc.getTime() - (k + 0.5) * 600e3), lat, lon));
  return s / 6;
}
const tauOf = pct => 1 - 0.75 * Math.pow(Math.min(100, Math.max(0, pct)) / 100, 3.4);
const iso = d => d.toISOString().slice(0, 10);
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
const short = m => m.replace('_seamless', '').replace('_ifs025', '');
const varOf = (lead, m) => lead === 0 ? `cloud_cover_${m}` : `cloud_cover_previous_day${lead}_${m}`;

async function getJson(url) {
  for (let t = 0; t < 4; t++) {
    try {
      const r = await fetch(url);
      if (r.ok) return await r.json();
      if (r.status === 429) { await new Promise(res => setTimeout(res, 5000 * (t + 1))); continue; }
      return null;
    } catch { await new Promise(res => setTimeout(res, 2000 * (t + 1))); }
  }
  return null;
}

(async () => {
  // 위성은 몇 시간 늦게 올라오므로 어제까지만.
  const end = new Date(Date.now() - 24 * 3600e3), start = new Date(end.getTime() - (DAYS - 1) * 86400e3);
  console.log(`관측 ${iso(start)} ~ ${iso(end)} (${DAYS}일), 태양고도 15° 이상 시각만`);
  console.log(`견줌: 투과율 τ (1=맑음, 0=완전차단). 수치는 τ 평균절대오차 ×100 (낮을수록 좋음)`);
  console.log(`선행 N일 = N일 전 모델 실행이 그 시각에 내놓았던 값 (0 = 당일 실행)\n`);

  const COMBOS = [...MODELS.map(m => [m]), APP_MODELS.filter(m => MODELS.includes(m))];
  if (MODELS.includes('jma_seamless')) COMBOS.push([...APP_MODELS, 'jma_seamless'].filter(m => MODELS.includes(m)));
  COMBOS.push(MODELS);
  const uniq = new Map(COMBOS.filter(c => c.length).map(c => [c.join('+'), c]));
  const combos = [...uniq.values()];
  const cname = c => c.map(short).join('+');

  const all = [];            // {place, tObs, v: {lead: {model: pct}}}
  const perPlace = [];
  for (const P of PLACES) {
    const vars = LEADS.map(l => l === 0 ? 'cloud_cover' : `cloud_cover_previous_day${l}`).join(',');
    const sat = await getJson(`https://satellite-api.open-meteo.com/v1/archive?latitude=${P.lat}&longitude=${P.lon}` +
      `&hourly=shortwave_radiation&models=satellite_radiation_seamless&start_date=${iso(start)}&end_date=${iso(end)}&timezone=UTC`);
    const fc = await getJson(`https://previous-runs-api.open-meteo.com/v1/forecast?latitude=${P.lat}&longitude=${P.lon}` +
      `&hourly=${vars}&models=${MODELS.join(',')}&start_date=${iso(start)}&end_date=${iso(end)}&timezone=UTC`);
    if (!sat?.hourly || !fc?.hourly) { console.log(`  ${P.name.padEnd(12)} 자료 없음(위성 범위 밖이거나 요청 실패)`); continue; }
    const st = sat.hourly.time, sv = sat.hourly.shortwave_radiation;
    const idx = new Map(fc.hourly.time.map((t, i) => [t, i]));
    const samples = [], clearTaus = [];
    for (let i = 0; i < st.length; i++) {
      if (sv[i] == null) continue;
      const tEnd = new Date(st[i] + 'Z');
      const cz = cosZenith(new Date(tEnd.getTime() - 1800e3), P.lat, P.lon);
      if (cz < Math.sin(rad(15))) continue;
      const cs = clearSkyHour(tEnd, P.lat, P.lon); if (cs < 80) continue;
      const fi = idx.get(st[i]); if (fi === undefined) continue;
      const v = {};
      let okAll = true;
      for (const l of LEADS) {
        v[l] = {};
        for (const m of MODELS) {
          const x = fc.hourly[varOf(l, m)]?.[fi];
          if (x == null) { okAll = false; break; }
          v[l][m] = x;
        }
        if (!okAll) break;
      }
      // 같은 시각을 모든 선행·모든 모델이 다 가진 것만 — 그래야 선행끼리 같은 표본을 견줍니다.
      if (!okAll) continue;
      const tauRaw = sv[i] / cs;
      samples.push({ tauRaw, v });
      if (Math.max(...MODELS.map(m => v[0][m])) <= 20) clearTaus.push(tauRaw);
    }
    if (samples.length < 50) { console.log(`  ${P.name.padEnd(12)} 표본 부족 (${samples.length})`); continue; }
    let scale, src;
    if (clearTaus.length >= 8) { scale = mean(clearTaus); src = '합의'; }
    else { const s2 = samples.map(x => x.tauRaw).sort((a, b) => a - b); scale = s2[Math.floor(0.95 * (s2.length - 1))]; src = '상위5%'; }
    const rows = samples.map(s => ({ place: P.name, tObs: Math.min(1, Math.max(0, s.tauRaw / scale)), v: s.v }));
    all.push(...rows);
    perPlace.push({ name: P.name, n: rows.length, scale, src, rows });
    await new Promise(r => setTimeout(r, 900));
  }
  if (!all.length) { console.log('자료를 하나도 못 받았습니다'); process.exit(1); }

  const tauCombo = (s, l, c) => mean(c.map(m => tauOf(s.v[l][m])));
  const pad = (s, n) => String(s).padStart(n);
  const stat = (rows, l, c) => {
    let ae = 0, dAe = 0, dB = 0, dn = 0, hit = 0;
    for (const s of rows) {
      const t = tauCombo(s, l, c), e = t - s.tObs;
      ae += Math.abs(e);
      if (s.tObs < 0.45) { dAe += Math.abs(e); dB += e; dn++; }
      // 여행자가 묻는 것: "맑을까, 흐릴까" — τ 0.7 을 경계로 둘로 나눠 맞힘률.
      if ((t >= 0.7) === (s.tObs >= 0.7)) hit++;
    }
    return { mae: ae / rows.length * 100, dMae: dn ? dAe / dn * 100 : NaN, dBias: dn ? dB / dn * 100 : NaN, hit: hit / rows.length * 100, dn };
  };

  console.log(`  장소별 표본 (맑음 배율 · 출처)`);
  for (const p of perPlace) console.log(`   ${p.name.padEnd(12)} ${pad(p.n, 5)}  ${p.scale.toFixed(2)} (${p.src})`);

  console.log(`\n  전체 n=${all.length} — τ 오차 ×100, 선행 0 · 1 · 2 · 3일`);
  console.log('   조합                          ' + LEADS.map(l => pad(`${l}일`, 7)).join(''));
  for (const c of combos) console.log(`   ${cname(c).padEnd(30)}` + LEADS.map(l => pad(stat(all, l, c).mae.toFixed(1), 7)).join(''));

  console.log(`\n  "맑음(τ≥0.7) / 아님" 맞힘률 %`);
  for (const c of combos) console.log(`   ${cname(c).padEnd(30)}` + LEADS.map(l => pad(stat(all, l, c).hit.toFixed(1), 7)).join(''));

  const dn = stat(all, 0, combos[0]).dn;
  console.log(`\n  짙은 흐림(τ<0.45, n=${dn})에서의 편향 (+ 는 예보가 실제보다 맑다고 함)`);
  for (const c of combos) console.log(`   ${cname(c).padEnd(30)}` + LEADS.map(l => { const b = stat(all, l, c).dBias; return pad((b >= 0 ? '+' : '') + b.toFixed(1), 7); }).join(''));

  console.log(`\n  장소별 — 선행 1일 τ 오차 ×100`);
  console.log('   장소         ' + combos.map(c => pad(cname(c), Math.max(8, cname(c).length + 2))).join(''));
  for (const p of perPlace) console.log(`   ${p.name.padEnd(12)}` + combos.map(c => pad(stat(p.rows, 1, c).mae.toFixed(1), Math.max(8, cname(c).length + 2))).join(''));

  // 모델이 갈리는 폭이 그 예보를 얼마나 믿을지 알려 주나 — 앱이 "신뢰도" 로 보여 줄 수 있는지.
  console.log(`\n  앱 조합(${cname(APP_MODELS)})의 두 모델이 갈리는 폭 → 오차 (선행 1일)`);
  const bins = [[], [], [], []];
  for (const s of all) {
    const a = APP_MODELS.map(m => s.v[1][m]);
    const sp = Math.max(...a) - Math.min(...a);
    bins[Math.min(3, Math.floor(sp / 25))].push(Math.abs(tauCombo(s, 1, APP_MODELS) - s.tObs) * 100);
  }
  ['0-25%p', '25-50%p', '50-75%p', '75-100%p'].forEach((l, i) =>
    console.log(`   갈림 ${l.padEnd(9)} n=${pad(bins[i].length, 5)}  τ오차 ${bins[i].length ? mean(bins[i]).toFixed(1) : '-'}`));
})();
