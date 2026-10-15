/**
 * **지구본의 달이 하늘의 달과 같은 자리·같은 위상인가** 합격 판정. 브라우저가 필요 없습니다.
 *
 * `celestial.getSublunarPoint` 는 3D 하늘(SunCalc)과 같은 저정밀 월령식으로 적경·적위를 내고 항성시를 빼
 * 직하점을 냅니다. 순환을 피하려고 여기서는 **SunCalc 의 지평 고도**로 잽니다: 직하점에 선 관측자에게
 * 달은 천정에 있어야 합니다(SunCalc 는 시차를 넣지 않으므로 고도 ≈ 90°). 해 직하점도 같은 방법으로 봅니다.
 * 위상은 달–해 직하점 각거리(이각)에서 기하로 낸 밝은 비율 (1 − cos 이각)/2 와 SunCalc 값을 견줍니다.
 *
 * 사용: node tools/shader-preview/stage-esm.js && node tools/shader-preview/verify-moon-globe.js
 */
const path = require('path');
const { PREVIEW } = require('./paths');
const SunCalc = require('suncalc');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS: ' + m); } else { fail++; console.log('  FAIL: ' + m); } };
const RAD = Math.PI / 180;
const dist = (a, b) => Math.acos(Math.min(1, Math.sin(a.latitude * RAD) * Math.sin(b.latitude * RAD)
  + Math.cos(a.latitude * RAD) * Math.cos(b.latitude * RAD) * Math.cos((a.longitude - b.longitude) * RAD))) / RAD;

(async () => {
  const C = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'celestial.js'));
  let worstMoon = 0, worstSun = 0, worstPhase = 0, worstWax = 0;
  for (let i = 0; i < 400; i++) {
    const d = new Date(Date.UTC(2024, 0, 1) + i * 2.37 * 86400000 + (i % 24) * 3600000);
    const m = C.getSublunarPoint(d), s = C.getSubsolarPoint(d);
    worstMoon = Math.max(worstMoon, 90 - SunCalc.getMoonPosition(d, m.latitude, m.longitude).altitude / RAD);
    worstSun = Math.max(worstSun, 90 - C.getSunPosition(d, s.latitude, s.longitude).altitude);
    const ph = C.getMoonPhase(d);
    const geo = (1 - Math.cos(dist(m, s) * RAD)) / 2;
    worstPhase = Math.max(worstPhase, Math.abs(geo - ph.fraction));
    // 차오를 때(상현 쪽) 달은 해보다 동쪽 — 경도 차(달 − 해)가 0~180°.
    const east = ((m.longitude - s.longitude) % 360 + 360) % 360 < 180;
    if (Math.abs(ph.fraction - 0.5) < 0.45 && east !== ph.waxing) worstWax++;
  }
  console.log('[1] 달 직하점: 그 자리에서 SunCalc 달 고도');
  ok(worstMoon < 1.0, `400 시각 최악 천정 거리 ${worstMoon.toFixed(3)}° < 1°`);
  console.log('[2] 해 직하점: 그 자리에서 앱 태양 고도');
  ok(worstSun < 0.01, `최악 천정 거리 ${worstSun.toFixed(4)}° < 0.01°`);
  console.log('[3] 위상: 직하점 이각으로 낸 밝은 비율 ↔ SunCalc');
  ok(worstPhase < 0.03, `최악 차 ${worstPhase.toFixed(4)} < 0.03`);
  console.log('[4] 차오름: 달이 해보다 동쪽이면 상현 쪽');
  ok(worstWax === 0, `어긋난 시각 ${worstWax} 개`);
  console.log(fail ? `\n실패 ${fail} / 통과 ${pass}` : `\n모두 통과 — pass ${pass} / fail 0`);
  process.exit(fail ? 1 : 0);
})();
