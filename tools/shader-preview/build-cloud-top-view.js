/**
 * **위에서 본 구름** (§120 B) — 지구본 "시뮬레이션 보기" 층 하네스.
 *
 * 앱 모듈(`CloudTopView`)을 그대로 불러 가짜 고리(예보)로 한 장씩 그립니다.
 * 판정은 verify-cloud-top-view.js 가 합니다.
 *
 * 준비: node tools/shader-preview/stage-esm.js
 * 사용: node tools/shader-preview/build-cloud-top-view.js
 *       node tools/shader-preview/verify-cloud-top-view.js
 */
const fs = require('fs');
const path = require('path');
const { PREVIEW } = require('./paths');

const html = '<!doctype html><html><head><meta charset="utf-8"></head><body><script type="module">\n' +
`import * as THREE from './app/vendor/three.module.js';
import * as TV from './app/components/SkyScene3D/CloudTopView.js';
const errors = [];
window.addEventListener('error', e => errors.push(String(e.message)));
try {
  const N = TV.TOP_VIEW_SIZE;
  const canvas = document.createElement('canvas'); canvas.width = N; canvas.height = N;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true });
  // 역산을 되풀이할 때 쓰는 덮어쓰기 — ?mean=0.6,0.4,0.5&sig=0.65,0.65,0.98
  const qs = new URLSearchParams(location.search);
  const trip = (k) => { const v = qs.get(k); if (!v) return undefined; const [l, m, h] = v.split(',').map(Number); return { low: l, mid: m, high: h }; };
  const tv = TV.createCloudTopView(N, { shapeMean: trip('mean'), shapeSigRatio: trip('sig') });
  const T0 = Date.UTC(2026, 8, 29, 6, 0, 0);
  // 가짜 고리 — 앱이 받는 모양 그대로(cloudRadar 판정의 fakeRing 과 같은 틀). f(층, 거리, 방위) → %.
  function ring(f, wind) {
    const AZ = [0, 30, 60, 90, 120, 150, 180, -150, -120, -90, -60, -30];
    const NEAR = [0, 60, 120, 180, -120, -60];
    const RINGS = [[5, NEAR], [10, AZ], [30, AZ], [70, AZ], [130, AZ], [200, AZ], [280, AZ], [380, AZ]];
    const u = wind ? wind.u : 0, v = wind ? wind.v : 0;
    const mk = (d, az) => {
      const H = { time: [], timeMs: [], low: [], mid: [], high: [], total: [],
        windULow: [], windVLow: [], windUMid: [], windVMid: [], windUHigh: [], windVHigh: [] };
      for (let h = -12; h < 36; h++) {
        H.timeMs.push(T0 + h * 3600e3); H.time.push(new Date(T0 + h * 3600e3).toISOString());
        const lo = f('low', d, az), mi = f('mid', d, az), hi = f('high', d, az);
        H.low.push(lo); H.mid.push(mi); H.high.push(hi); H.total.push(Math.max(lo, mi, hi));
        for (const k of ['Low', 'Mid', 'High']) { H['windU' + k].push(u); H['windV' + k].push(v); }
      }
      return { distance: d, azimuthOffset: az, low: H.low[12], mid: H.mid[12], high: H.high[12],
        latitude: 37.5, longitude: 127, hourly: H };
    };
    const out = [mk(0, 0)];
    for (const [d, azs] of RINGS) for (const az of azs) out.push(mk(d, az));
    return out;
  }
  const shot = (r, tMs) => {
    const inp = TV.buildTopViewInput(r, tMs);
    if (!inp) return null;
    const px = tv.render(renderer, inp);
    // 운량장 자체(셰이더에 들어가는 운량) — 반경 150km 안 평균, 층별(저·중·상).
    const cm = [0, 0, 0]; let cn = 0; const S = 128;
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
      const px2 = ((i + 0.5) / S) * 2 - 1, py2 = ((j + 0.5) / S) * 2 - 1, r = Math.hypot(px2, py2);
      if (r > 1 || 360 * r * r > 150) continue;
      const k = (j * S + i) * 4; cm[0] += inp.cover[k]; cm[1] += inp.cover[k + 1]; cm[2] += inp.cover[k + 2]; cn++;
    }
    const coverMean = cm.map(v => +(v / cn / 255).toFixed(3));
    return { coverMean, alpha: Array.from(px.filter((_, i) => i % 4 === 3)), rgba: Array.from(px), winds: inp.winds, drift: inp.driftHours };
  };
  const R = {};
  // [1] 예보 → 면적: 한 층만, 고른 운량
  R.area = [];
  for (const layer of ['low', 'mid', 'high']) for (const c of [20, 35, 50, 65, 75]) {
    const s = shot(ring((L) => (L === layer ? c : 0)), T0);
    R.area.push({ layer, c, alpha: s.alpha, coverMean: s.coverMean });
  }
  // 대조 — 하늘(45°)의 문턱 그대로 위에서 보면 면적이 어긋나는가(자가 이것을 보는가).
  const tvSky = TV.createCloudTopView(N, { shapeMean: TV.SKY_SHAPE_MEAN, shapeSigRatio: TV.SKY_SHAPE_SIG_RATIO });
  R.areaSky = [];
  for (const layer of ['low', 'mid', 'high']) {
    const inp = TV.buildTopViewInput(ring((L) => (L === layer ? 50 : 0)), T0);
    const px = tvSky.render(renderer, inp);
    R.areaSky.push({ layer, alpha: Array.from(px.filter((_, i) => i % 4 === 3)) });
  }
  // [2] 방향: 동쪽 흐림 · 서쪽 맑음(세 층 같이)
  R.dir = shot(ring((L, d, az) => Math.max(0, Math.min(100, 50 + 45 * Math.sin(az * Math.PI / 180) * Math.min(1, d / 200)))), T0).alpha;
  // [3] 이류: 서풍(동쪽으로) — 한 시간 사이 무늬가 바람만큼 옮는가. 중층만(셀 4.2km, 발자국 안에서 무늬가 삽니다).
  //     기상 관례 u(동쪽 성분) 양수 = 서풍. 대조: 바람 0.
  const flat = (L) => (L === 'mid' ? 55 : 0);
  const windy = ring(flat, { u: 60, v: 0 });
  const calm = ring(flat, { u: 0, v: 0 });
  const a0 = shot(windy, T0), a1 = shot(windy, T0 + 3600e3);
  const c0 = shot(calm, T0), c1 = shot(calm, T0 + 3600e3);
  R.drift = { w0: a0.alpha, w1: a1.alpha, c0: c0.alpha, c1: c1.alpha, winds: a0.winds, drift: [a0.drift, a1.drift] };
  // [4] 방사형 줄 — 고른 50%(세 층). 예보 보간 운량장 대 하늘의 방향 잡음 운량장(대조).
  const even = ring((L) => 50);
  R.spokes = {};
  for (const mode of ['forecast', 'skyColumns']) {
    const inp = TV.buildTopViewInput(even, T0, { coverage: mode });
    R.spokes[mode] = Array.from(tv.render(renderer, inp).filter((_, i) => i % 4 === 3));
  }
  // 보여 주기용 한 장 — 세 층, 동쪽 흐림
  const showRing = ring((L, d, az) => ({ low: 40, mid: 35, high: 30 }[L]) + 30 * Math.sin(az * Math.PI / 180) * Math.min(1, d / 200), { u: 30, v: 10 });
  R.sample = shot(showRing, T0).rgba;
  R.sampleSky = Array.from(tv.render(renderer, TV.buildTopViewInput(showRing, T0, { coverage: 'skyColumns' })));
  window.__stats = { N, rangeKm: tv.rangeKm, R };
} catch (e) { errors.push('예외: ' + (e && e.stack || e)); }
window.__errors = errors;
document.title = 'DONE::' + (errors.length ? 'ERR' : 'OK');
` + '</script></body></html>';
fs.writeFileSync(path.join(PREVIEW, 'cloud-top-view.html'), html);
console.log('생성 완료: cloud-top-view.html');
