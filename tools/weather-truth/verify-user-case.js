/**
 * 사용자가 **눈으로 보고 보고한 사건** 하나를 그 날짜·시각의 자료로 되짚는 자.
 *
 * 지금까지의 위성 판정(§70)은 전부 **위성 τ 를 정답으로 놓고** 잰 것입니다.
 * 위성이 틀리면 자도 같이 틀립니다. 이 자는 다릅니다 — 정답이 **사용자의 눈**
 * 입니다:
 *
 *   "네번째 사진은 세번째 사진과 같은 시간에 찍은건데 (…) 실제 사진은 구름 한 점
 *    없는 맑은 날인데 시뮬레이션은 구름이 꽤 많아."   — 2026-09-11 07:30 KST
 *
 * 날짜는 위성을 **안 쓰고** 못 박았습니다(순환논증을 피하려고):
 *   PR #23 머지 2026-09-11 06:51 KST  ← "main 브랜치로 확인해봤고" 의 하한
 *   첫 결함 커밋 2026-09-11 07:51 KST ← 상한
 *
 * 앱이 쓰는 모듈을 **그대로** 태웁니다(`satelliteBias` · `celestial`).
 * 다시 구현하지 않습니다 — 다시 구현하면 앱이 아니라 자를 재게 됩니다.
 *
 *   node tools/shader-preview/stage-esm.js && node tools/weather-truth/verify-user-case.js
 */
const APP = '../../.harness/preview/app/utils/';

const LAT = 37.4863, LON = 127.0443;   // 도곡동 — 사용자 QR 이 준 좌표(§51.1)
const APP_MODELS = 'ecmwf_ifs025,icon_seamless';

/** 사건과 대조. `truth` 는 **자료가 아니라 사람 또는 독립 계측**에서 옵니다. */
const CASES = [
  { id:'사건',  date:'2026-09-11', hour:'07:00', label:'사용자 결함 4번 (맑다고 보고)',
    truthClear:true,  src:'사용자 눈' },
  { id:'대조',  date:'2026-09-10', hour:'07:00', label:'하루 전 같은 시각',
    truthClear:false, src:'독립 대조 — 같은 자리·같은 시각·다른 하늘' },
];

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  PASS: ${m}`); } else { fail++; console.log(`  FAIL: ${m}`); } };
const j = async u => { const r = await fetch(u); if (!r.ok) throw new Error(`${r.status} ${u}`); return r.json(); };

(async () => {
  const S = await import(APP + 'satelliteBias.js');
  const C = await import(APP + 'celestial.js');
  const { clearSkyGHI, clearSkyGHIMean, tauFromCover, coverFromTau, estimateBias, applyBias,
          MIN_CLEAR_GHI, MAX_LEAD_HOURS, LOOKBACK_HOURS } = S;
  const { getSunPosition } = C;
  const cosZAt = ms => Math.sin(getSunPosition(new Date(ms), LAT, LON).altitude * Math.PI / 180);

  console.log(`앱 모듈을 그대로 씁니다 — MIN_CLEAR_GHI=${MIN_CLEAR_GHI} · LOOKBACK=${LOOKBACK_HOURS}h · MAX_LEAD=${MAX_LEAD_HOURS}h\n`);

  const results = {};

  for (const c of CASES) {
    console.log(`──── ${c.id}: ${c.date} ${c.hour} KST — ${c.label}`);

    // 1) 예보 — 앱이 섞는 그 둘.
    const fc = await j(`https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}` +
      `&hourly=cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high` +
      `&models=${APP_MODELS}&start_date=${c.date}&end_date=${c.date}&timezone=auto`);

    const ft = fc.hourly.time;
    const blend = (base) => ft.map((_, i) => {
      const v = Object.keys(fc.hourly)
        .filter(k => k.startsWith(base + '_') && /_(ifs025|seamless)$/.test(k))
        .map(k => fc.hourly[k][i]).filter(x => x != null);
      return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
    });
    const total = blend('cloud_cover'), low = blend('cloud_cover_low'),
          mid = blend('cloud_cover_mid'), high = blend('cloud_cover_high');

    // 2) 위성 — 앱과 같은 요청(8일, 관측점 1점, 변수 하나).
    const start = new Date(Date.parse(c.date + 'T00:00:00Z') - 7 * 86400_000).toISOString().slice(0, 10);
    const sat = await j(`https://satellite-api.open-meteo.com/v1/archive?latitude=${LAT}&longitude=${LON}` +
      `&hourly=shortwave_radiation&models=satellite_radiation_seamless` +
      `&start_date=${start}&end_date=${c.date}&timezone=auto`);
    const offMs = (sat.utc_offset_seconds ?? 0) * 1000;
    const trueMs = s => Date.parse(s + 'Z') - offMs;

    // 3) 맑은하늘 배율 — weather.ts 와 같은 절차(τ 상위 5%).
    const obs = [];
    for (let i = 0; i < sat.hourly.time.length; i++) {
      const sw = sat.hourly.shortwave_radiation[i];
      if (sw == null) continue;
      const d = new Date(trueMs(sat.hourly.time[i]));
      // ⚠ Open-Meteo 일사는 **직전 한 시간 평균**이므로 분모도 같은 창에서
      //   평균합니다. 순간값으로 나누면 아침은 1.53배 흐리게, 일몰은 0.49배
      //   맑게 읽힙니다.
      const cs = clearSkyGHIMean(d.getTime(), cosZAt);
      if (cs < MIN_CLEAR_GHI) continue;
      obs.push({ local: sat.hourly.time[i], raw: sw / cs, sw, cs });
    }
    const raws = obs.map(o => o.raw).sort((a, b) => a - b);
    const scale = raws[Math.floor(0.95 * (raws.length - 1))];
    console.log(`  맑은하늘 배율 ${scale.toFixed(3)} (표본 ${raws.length})`);

    // 4) 사용자가 본 그 시각.
    const key = `${c.date}T${c.hour}`;
    const fi = ft.indexOf(key);
    const sunAt = new Date(trueMs(key));
    const elev = getSunPosition(sunAt, LAT, LON).altitude;
    const csAt = clearSkyGHIMean(trueMs(key), cosZAt);
    const si = sat.hourly.time.indexOf(key);
    const swAt = si >= 0 ? sat.hourly.shortwave_radiation[si] : null;

    console.log(`  예보 총운량 ${total[fi]?.toFixed(0)}%  (저 ${low[fi]?.toFixed(0)} · 중 ${mid[fi]?.toFixed(0)} · 상 ${high[fi]?.toFixed(0)})`);
    console.log(`  태양고도 ${elev.toFixed(1)}° · 맑은하늘 ${csAt.toFixed(0)} W/m² · 위성 일사 ${swAt} W/m²`);
    console.log(`  ⚠ 맑은하늘 ${csAt.toFixed(0)} < 문턱 ${MIN_CLEAR_GHI} → 앱은 이 시각 표본을 ${csAt < MIN_CLEAR_GHI ? '**버립니다**' : '씁니다'}`);

    // 5) 그 시각을 못 쓰니, 위성이 그 아침을 뭐라 했는지는 **처음 쓸 수 있는 시각**으로 봅니다.
    // ⚠ **τ 공간에서** 견줍니다. 운량(%) 으로 되돌리면 안 됩니다 — Kasten-Czeplak
    //   의 지수 3.4 때문에 맑은 쪽에서 거의 수직이라, 일사 몇 % 차이가 운량
    //   수십 %p 로 부풀어 **자가 제 잡음을 잽니다**(`verify-cloud-forecast.js` 머리말).
    const morn = obs.filter(o => o.local.startsWith(c.date) && o.local < `${c.date}T12:00`);
    const firstUsable = morn[0];
    if (firstUsable) {
      const satTau = Math.min(1, firstUsable.raw / scale);
      const fj = ft.indexOf(firstUsable.local);
      const fcTau = tauFromCover(total[fj]);
      console.log(`  첫 유효 시각 ${firstUsable.local}`);
      console.log(`    위성 τ ${satTau.toFixed(3)}   ← 실제로 본 하늘`);
      console.log(`    예보 τ ${fcTau.toFixed(3)}   (총운량 ${total[fj]?.toFixed(0)}%)`);
      console.log(`    차이  ${(fcTau - satTau >= 0 ? '+' : '') + (fcTau - satTau).toFixed(3)}  ${fcTau < satTau ? '← 예보가 실제보다 **흐리다**' : '← 예보가 실제보다 맑다'}`);
      console.log(`    같은 시각 예보 층별: 저 ${low[fj]?.toFixed(0)} · 중 ${mid[fj]?.toFixed(0)} · **상 ${high[fj]?.toFixed(0)}**`);
      results[c.id] = { satTau, fcTau, fcCover: total[fj], at: firstUsable.local, scale,
                        high: high[fj],低: low[fj], mid: mid[fj] };
    }

    // 6) 보정이 그 시각에 실제로 걸리는가 — 앱의 진짜 절차로.
    const before = obs.filter(o => trueMs(o.local) <= trueMs(key));
    const last = before[before.length - 1];
    if (last) {
      const leadH = (trueMs(key) - trueMs(last.local)) / 3600_000;
      const fj = ft.indexOf(last.local);
      const samples = (fj >= 0 && total[fj] != null)
        ? [{ forecastCoverPct: total[fj], observedGHI: last.sw, clearSkyGHI: last.cs }] : [];
      const bias = samples.length ? estimateBias(samples, scale) : null;
      const after = bias != null ? applyBias(total[fi], bias, leadH) : total[fi];
      console.log(`  마지막 유효 관측 ${last.local} → 앞선 시간 ${leadH.toFixed(0)}h (한계 ${MAX_LEAD_HOURS}h)`);
      console.log(`  보정: ${total[fi]?.toFixed(0)}% → ${after?.toFixed(1)}%  ${leadH > MAX_LEAD_HOURS ? '← 한계를 넘어 **안 걸립니다**' : ''}`);
      results[c.id].leadH = leadH; results[c.id].after = after; results[c.id].bias = bias;
      results[c.id].targetCover = total[fi];
    }
    console.log('');
  }

  // ─── 판정 ───────────────────────────────────────────────
  console.log('──── 판정');
  const A = results['사건'], B = results['대조'];
  const CLEAR = 0.85;   // "맑다" 의 한 줄. 양쪽에 **같은 줄**을 씁니다.

  // 1) 위성이 사용자 눈과 같은 말을 하는가 — 그리고 늘 그러지는 않는가(양방향).
  ok(A.satTau > CLEAR,
     `사건: 위성이 사용자와 같이 **맑다**고 한다 — τ ${A.satTau.toFixed(3)} > ${CLEAR}`);
  ok(B.satTau < CLEAR,
     `대조: 하루 전 같은 시각엔 **같은 줄**로 맑지 않다고 한다 — τ ${B.satTau.toFixed(3)} < ${CLEAR}`);
  ok(A.satTau - B.satTau > 0.25,
     `대조: 두 아침을 위성이 실제로 가른다 (τ ${A.satTau.toFixed(3)} vs ${B.satTau.toFixed(3)})`);

  // 2) ⚠ 음성 결과 — 이 불만은 위성 보정의 **사정거리 밖**입니다.
  ok(Math.abs(A.fcTau - A.satTau) < 0.05,
     `사건: 예보 τ 가 이미 거의 맞았다 — |${A.fcTau.toFixed(3)} − ${A.satTau.toFixed(3)}| = ${Math.abs(A.fcTau - A.satTau).toFixed(3)} < 0.05 → **보정할 것이 없었다**`);
  ok(A.high >= 40 && A.satTau > 0.95,
     `사건: 그런데 예보는 **상층운 ${A.high?.toFixed(0)}%** 라 했고 위성 τ 는 ${A.satTau.toFixed(3)} — **τ 는 얇은 상층운을 못 봅니다**`);

  // 3) 그리고 그 시각엔 애초에 안 걸립니다 — 태양이 낮아 그 아침 관측이 하나도 없습니다.
  ok(A.leadH > MAX_LEAD_HOURS,
     `사건 시각에는 보정이 **안 걸린다** — 앞선 시간 ${A.leadH.toFixed(0)}h > 한계 ${MAX_LEAD_HOURS}h`);
  ok(Math.abs(A.after - A.targetCover) < 0.5,
     `그래서 그 시각 운량이 안 바뀐다 (${A.targetCover.toFixed(0)}% → ${A.after.toFixed(1)}%)`);

  console.log(`
  결론: 사용자 결함 4번은 **위성 보정으로 안 고쳐집니다.** 이유가 둘입니다.
    (a) 07:30 은 태양고도 9° 라 그 아침 관측을 하나도 못 씁니다 → 앞선 시간 ${A.leadH.toFixed(0)}h.
    (b) 걸렸더라도 그 시각 예보 τ 오차가 ${Math.abs(A.fcTau - A.satTau).toFixed(3)} 뿐입니다. 불만의 정체는
        **상층운 ${A.high?.toFixed(0)}%** 인데, 얇은 상층운은 일사를 거의 안 깎아 위성이 못 봅니다.
    → 남은 것은 예보의 상층운 자체이거나, 상층운 %를 화면에 옮기는 쪽입니다.`);

  console.log(`\n${fail ? 'FAILURES' : 'ALL PASS'} — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e); process.exit(1); });
