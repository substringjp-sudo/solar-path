/**
 * **얇은 중층운은 정말 얇은가** — 위성 일사로 잽니다 (2026-10-01).
 *
 * 사용자(도코나메 밤하늘): "구름이 꽤 보이게 그렸는데 뿌옇게 보이는걸 빼면 구름이 눈에는 거의 안보여."
 * 그 시각 예보는 중층 20% 였지만 기압면 단면으로는 600hPa 한 면(13%, 습도 78%)뿐이었습니다. 앱은 중층
 * 20% 를 고적운 τ 16 으로 그립니다(`cloudPresets.PRESET_OPTICS`). 이 자는 **단면이 얇은 중층운이
 * 실제로 빛을 덜 막는가**를 낮 시간 위성 일사로 봅니다.
 *
 * 먼저 정한 것(재기 전):
 *  - 표본: 위성이 보는 지역(MSG·IODC·Himawari)의 16곳 · 지난 60일 · 태양고도 25° 이상 ·
 *    **중층만 있는 시각**(앱 모델 평균으로 저층 < 5%, 상층 < 5%, 중층 5~70%).
 *  - 두께 지표: 단면(best_match)에서 높이 2~7km 사이 기압면 중 운량 ≥ 10% 인 면의 수 n.
 *    n = 0 · 1 · 2 이상 세 묶음.
 *  - 그림 모형: 투과율 T = (1 − f) + f·t(τ), t(τ) = 1 / (1 + 0.75·(1 − g)·τ), g = 0.85.
 *    f 는 앱 중층 운량. T_obs 는 위성 일사 ÷ (그 지역 맑은하늘 배율 × Haurwitz).
 *  - 묶음마다 T 오차를 가장 줄이는 τ 를 찾습니다(0.25~40). 날짜 홀짝으로 나눠 **홀수 날로 맞추고 짝수 날로
 *    확인**합니다. 판단: n = 1 의 τ 가 n ≥ 2 보다 확실히 작고(절반 이하), 짝수 날에서도 τ 16 보다 오차가
 *    줄면 "얇은 단면 → 얇게" 를 넣는다. 아니면 넣지 않는다.
 *
 * 사용: node tools/weather-truth/measure-thin-layer.js [일수=60] > out.json
 */
const DAYS = Number(process.argv[2] || 60);
const PLACES = [
  ['서울', 37.4863, 127.0443], ['부산', 35.18, 129.08], ['도쿄', 35.68, 139.77], ['나고야', 35.18, 136.91],
  ['삿포로', 43.06, 141.35], ['타이베이', 25.03, 121.56], ['상하이', 31.23, 121.47], ['뮌헨', 48.14, 11.58],
  ['런던', 51.51, -0.13], ['마드리드', 40.42, -3.7], ['로마', 41.9, 12.5], ['바르샤바', 52.23, 21.01],
  ['나이로비', -1.29, 36.82], ['요하네스버그', -26.2, 28.05], ['시드니', -33.87, 151.21], ['퍼스', -31.95, 115.86],
  // 2차(같은 자, 표본 늘리기 — 1차에서 n ≥ 2 가 5개뿐이었습니다)
  ['파리', 48.86, 2.35], ['빈', 48.21, 16.37], ['아테네', 37.98, 23.73], ['이스탄불', 41.01, 28.98],
  ['모스크바', 55.76, 37.62], ['스톡홀름', 59.33, 18.07], ['더블린', 53.35, -6.26], ['리스본', 38.72, -9.14],
  ['방콕', 13.76, 100.5], ['싱가포르', 1.35, 103.82], ['델리', 28.61, 77.21], ['멜버른', -37.81, 144.96],
  ['브리즈번', -27.47, 153.03], ['케이프타운', -33.92, 18.42], ['라고스', 6.52, 3.38], ['후쿠오카', 33.59, 130.4],
];
const LEVELS = [1000, 975, 950, 925, 900, 850, 800, 750, 700, 600, 500, 400, 300, 250, 200];
const APP_MODELS = ['ecmwf_ifs025', 'icon_seamless'];
const G = 0.85;
const tCloud = (tau) => 1 / (1 + 0.75 * (1 - G) * tau);
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
// 위성 일사는 앞 1시간 평균이라 그 1시간의 맑은하늘 평균으로 나눕니다(satelliteBias.clearSkyGHIMean 과 같은 이유).
const haurwitz = cz => cz <= 0 ? 0 : 1098 * cz * Math.exp(-0.059 / cz);
const clearMean = (end, lat, lon) => { let s = 0; for (let k = 0; k < 6; k++) s += haurwitz(cosZenith(new Date(end.getTime() - (k + 0.5) * 600e3), lat, lon)); return s / 6; };
const iso = d => d.toISOString().slice(0, 10);
const getJson = async (u) => { for (let a = 0; a < 4; a++) { try { const r = await fetch(u); const j = await r.json(); if (j.error) throw new Error(j.reason); return j; } catch (e) { if (a === 3) throw e; await new Promise(r => setTimeout(r, 2000 * (a + 1))); } } };

(async () => {
  const end = new Date(Date.now() - 2 * 86400e3), start = new Date(end.getTime() - (DAYS - 1) * 86400e3);
  const rows = [];
  for (const [name, lat, lon] of PLACES) {
    const base = `latitude=${lat}&longitude=${lon}&start_date=${iso(start)}&end_date=${iso(end)}&timezone=UTC`;
    let sat, lay, prof;
    try {
      sat = await getJson(`https://satellite-api.open-meteo.com/v1/archive?${base}&hourly=shortwave_radiation&models=satellite_radiation_seamless`);
      lay = await getJson(`https://api.open-meteo.com/v1/forecast?${base}&hourly=cloud_cover_low,cloud_cover_mid,cloud_cover_high&models=${APP_MODELS.join(',')}`);
      prof = await getJson(`https://api.open-meteo.com/v1/forecast?${base}&hourly=${LEVELS.flatMap(p => [`cloud_cover_${p}hPa`, `geopotential_height_${p}hPa`]).join(',')}`);
    } catch (e) { console.error(name, '받기 실패', e.message); continue; }
    if (!sat?.hourly?.shortwave_radiation) { console.error(name, '위성 없음'); continue; }
    const si = new Map(sat.hourly.time.map((t, i) => [t, i]));
    const pi = new Map(prof.hourly.time.map((t, i) => [t, i]));
    const avg = (k, i) => { const v = APP_MODELS.map(m => lay.hourly[`${k}_${m}`]?.[i]).filter(x => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
    // 그 지역 맑은하늘 배율: 앱 모델이 모두 거의 맑다(세 층 합 < 10%)고 한 시각의 T 중앙값
    const cand = [];
    lay.hourly.time.forEach((t, i) => {
      const end = new Date(t + 'Z'); const cz = cosZenith(new Date(end.getTime() - 1800e3), lat, lon);
      if (cz < Math.sin(rad(25))) return;
      const j = si.get(t); if (j == null) return; const ghi = sat.hourly.shortwave_radiation[j]; if (ghi == null) return;
      const L = avg('cloud_cover_low', i), M = avg('cloud_cover_mid', i), H = avg('cloud_cover_high', i);
      if (L == null || M == null || H == null) return;
      cand.push({ t, i, T: ghi / clearMean(end, lat, lon), L, M, H });
    });
    const clearT = cand.filter(c => c.L + c.M + c.H < 10).map(c => c.T).sort((a, b) => a - b);
    if (clearT.length < 15) { console.error(name, '맑은 시각 부족', clearT.length); continue; }
    const k = clearT[Math.floor(clearT.length / 2)];
    for (const c of cand) {
      if (!(c.L < 5 && c.H < 5 && c.M >= 5 && c.M <= 70)) continue;
      const p = pi.get(c.t); if (p == null) continue;
      let n = 0, maxCov = 0;
      for (const lv of LEVELS) {
        const h = prof.hourly[`geopotential_height_${lv}hPa`]?.[p], cv = prof.hourly[`cloud_cover_${lv}hPa`]?.[p];
        if (h == null || cv == null || h < 2000 || h > 7000) continue;
        if (cv >= 10) n++;
        maxCov = Math.max(maxCov, cv);
      }
      rows.push({ place: name, t: c.t, day: Number(c.t.slice(8, 10)), f: c.M / 100, n, maxCov, T: Math.min(1.2, c.T / k) });
    }
    console.error(name, '중층만 있는 시각', rows.filter(r => r.place === name).length, '맑은하늘 배율', k.toFixed(3));
  }

  const fit = (rs) => {
    let best = null;
    for (let tau = 0.25; tau <= 40; tau += 0.25) {
      const e = rs.reduce((s, r) => s + Math.abs((1 - r.f) + r.f * tCloud(tau) - r.T), 0) / rs.length;
      if (!best || e < best.e) best = { tau, e };
    }
    return best;
  };
  const err = (rs, tau) => rs.reduce((s, r) => s + Math.abs((1 - r.f) + r.f * tCloud(tau) - r.T), 0) / rs.length;
  const bins = { 'n=0': r => r.n === 0, 'n=1': r => r.n === 1, 'n>=2': r => r.n >= 2 };
  const out = { days: DAYS, samples: rows.length, bins: {} };
  for (const [b, sel] of Object.entries(bins)) {
    const odd = rows.filter(r => sel(r) && r.day % 2 === 1), even = rows.filter(r => sel(r) && r.day % 2 === 0);
    if (odd.length < 10 || even.length < 10) { out.bins[b] = { odd: odd.length, even: even.length, note: '표본 부족' }; continue; }
    const f = fit(odd);
    out.bins[b] = {
      odd: odd.length, even: even.length, meanF: +(odd.reduce((s, r) => s + r.f, 0) / odd.length).toFixed(3),
      meanTobs: +(odd.reduce((s, r) => s + r.T, 0) / odd.length).toFixed(3),
      tauFitOdd: f.tau, errEvenAtFit: +err(even, f.tau).toFixed(4), errEvenAtTau16: +err(even, 16).toFixed(4),
      tauFitEven: fit(even).tau,
    };
  }
  console.log(JSON.stringify(out, null, 1));
})();
