/**
 * **촬영 화면 전체 화면** — 미리보기 화각과 해 경로 투영(`src/utils/cameraOverlay.ts`).
 *
 * ## ⚠ 재기 전에 정한 문턱 (2026-10-25)
 *
 * - **C1 cover**: 390×692 화면, 센서 짧은 변 53° → 세로 화각 = 센서 긴 변 화각(차 < 1e-9), 가로 화각은 53° 보다
 *   좁고 tan 비가 화면 비와 같다.
 * - **C2 배율**: 2배면 세로 반각의 tan 이 절반.
 * - **C3 가운데**: 카메라가 보는 방향은 화면 한가운데(차 < 1e-6).
 * - **C4 가장자리**: 기울기 0 · 앙각 0 에서 방위 + 가로화각/2 인 지평선 점은 화면 오른쪽 끝(차 < 1e-6).
 * - **C5 기울기**: 폰을 10° 기울이면 지평선 두 점(±10°)을 이은 선이 10° 기운다(차 < 0.5°).
 * - **C6 하루 경로**: 37.28N 2026-10-25 정오 최고 고도 = 90 − 위도 + 적위(약 −12.2°) ± 0.6°.
 * - **C7 다음 출몰**: 현지 15시 → 그날 일몰, 20시 → 다음 날 일출.
 * - **C8 뒤쪽**: 해 반대쪽을 보면 경로가 화면에 그려지지 않는다(선분 0).
 *
 *   node tools/shader-preview/stage-esm.js && node tools/shader-preview/verify-camera-overlay.js
 */
process.env.TZ = 'Asia/Seoul';
const path = require('path');
const { PREVIEW } = require('./paths');
globalThis.__DEV__ = false;
let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };

(async () => {
  const U = (m) => import('file://' + path.join(PREVIEW, 'app', 'utils', m));
  const C = await U('cameraOverlay.js');
  const R = Math.PI / 180;
  const W = 390, H = 692;

  const o = C.previewOptics(W, H, 53, 1);
  const vWant = 2 * Math.atan(Math.tan(26.5 * R) / 0.75) / R;
  const ratio = Math.tan(o.hFovDeg / 2 * R) / Math.tan(o.vFovDeg / 2 * R);
  ok(Math.abs(o.vFovDeg - vWant) < 1e-9 && o.hFovDeg < 53 && Math.abs(ratio - W / H) < 1e-9,
     `C1 cover — 세로 ${o.vFovDeg.toFixed(2)}° (센서 긴 변 ${vWant.toFixed(2)}°) · 가로 ${o.hFovDeg.toFixed(2)}° < 53° · tan 비 ${ratio.toFixed(4)} = 화면 비 ${(W / H).toFixed(4)}`);
  console.log(`     기본 센서 짧은 변(26mm 환산) ${C.DEFAULT_SENSOR_SHORT_FOV_DEG.toFixed(2)}°`);

  const o2 = C.previewOptics(W, H, 53, 2);
  ok(Math.abs(Math.tan(o2.vFovDeg / 2 * R) - Math.tan(o.vFovDeg / 2 * R) / 2) < 1e-12, `C2 2배 — 세로 ${o2.vFovDeg.toFixed(2)}°, tan 반각 절반`);

  const att = { yawDeg: 243, pitchDeg: 4, rollDeg: 0 };
  const c = C.projectAzAlt(243, 4, att, o.k);
  ok(c && Math.abs(c.x - W / 2) < 1e-6 && Math.abs(c.y - H / 2) < 1e-6, `C3 보는 방향 = 화면 가운데 (${c?.x.toFixed(6)}, ${c?.y.toFixed(6)})`);

  const flat = { yawDeg: 243, pitchDeg: 0, rollDeg: 0 };
  const e = C.projectAzAlt(243 + o.hFovDeg / 2, 0, flat, o.k);
  ok(e && Math.abs(e.x - W) < 1e-6 && Math.abs(e.y - H / 2) < 1e-6, `C4 방위 + ${(o.hFovDeg / 2).toFixed(2)}° 지평선 점 = 오른쪽 끝 x ${e?.x.toFixed(6)}`);

  const tilt = { yawDeg: 243, pitchDeg: 0, rollDeg: 10 };
  const a = C.projectAzAlt(233, 0, tilt, o.k), b = C.projectAzAlt(253, 0, tilt, o.k);
  const ang = Math.atan2(-(b.y - a.y), b.x - a.x) / R;
  ok(Math.abs(Math.abs(ang) - 10) < 0.5, `C5 10° 기울임 — 지평선 ${ang.toFixed(2)}°`);

  const day = C.sunDayPath(new Date('2026-10-25T12:00:00+09:00'), 37.28, 126.57, 5);
  const maxAlt = Math.max(...day.map(p => p.alt));
  const want = 90 - 37.28 - 12.2;
  ok(Math.abs(maxAlt - want) < 0.6, `C6 정오 최고 고도 ${maxAlt.toFixed(2)}° (어림 ${want.toFixed(2)}°) · 점 ${day.length}개`);

  const n15 = C.nextSunEvent(new Date('2026-10-25T15:00:00+09:00'), 37.28, 126.57);
  const n20 = C.nextSunEvent(new Date('2026-10-25T20:00:00+09:00'), 37.28, 126.57);
  ok(n15?.type === 'sunset' && n15.at.getDate() === 25 && n20?.type === 'sunrise' && n20.at.getDate() === 26,
     `C7 15시 → ${n15?.type} ${n15?.at.toTimeString().slice(0, 5)} · 20시 → ${n20?.type} ${n20?.at.getDate()}일 ${n20?.at.toTimeString().slice(0, 5)}`);

  const segsFront = C.projectPath(day, { yawDeg: 225, pitchDeg: 10, rollDeg: 0 }, o.k);
  const segsBack = C.projectPath(day, { yawDeg: 20, pitchDeg: 10, rollDeg: 0 }, o.k);
  ok(segsFront.length > 0 && segsBack.length === 0, `C8 해 쪽(225°) 선분 ${segsFront.length}개 · 반대쪽(20°) ${segsBack.length}개`);

  console.log(`\n${fail ? 'FAILURES' : 'ALL PASS'} — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e); process.exit(1); });
