/**
 * 달(MoonMesh) 위상 방향 · 각반지름 통일(0.259°/0.267°) · AdditiveBlending/Lommel-Seeliger 셰이더 검증.
 * 사용: node tools/shader-preview/verify-moon.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
let pass = 0, fail = 0;
const ok = (cond, msg) => {
  if (cond) { pass++; console.log('  PASS: ' + msg); }
  else { fail++; console.log('  FAIL: ' + msg); }
};

const balancedBraces = (s) => {
  let d = 0;
  for (const ch of s) { if (ch === '{') d++; else if (ch === '}') d--; if (d < 0) return false; }
  return d === 0;
};

(async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'moon-verify-'));
  const entry = path.join(work, 'runner.ts');
  const bundle = path.join(work, 'runner.cjs');
  fs.writeFileSync(entry, `
    import * as THREE from 'three';
    import SunCalc from 'suncalc';
    import { createMoonGroup, updateMoonPosition, computeMoonLocalLightDir, MOON_ANGULAR_RADIUS_DEG } from ${JSON.stringify(path.join(ROOT, 'src/components/SkyScene3D/MoonMesh.ts'))};
    import { createSun, updateSun, sunDisplayScale } from ${JSON.stringify(path.join(ROOT, 'src/components/SkyScene3D/SunMesh.ts'))};
    import { getSunPosition, getMoonPosition } from ${JSON.stringify(path.join(ROOT, 'src/utils/celestial.ts'))};
    import { makeAtmosphereParams } from ${JSON.stringify(path.join(ROOT, 'src/utils/atmosphere.ts'))};
    (globalThis as any).__MOON_MOD = { THREE, SunCalc, createMoonGroup, updateMoonPosition, computeMoonLocalLightDir, MOON_ANGULAR_RADIUS_DEG, createSun, updateSun, sunDisplayScale, getSunPosition, getMoonPosition, makeAtmosphereParams };
  `);
  execFileSync('npx', ['esbuild', entry, '--bundle', '--format=cjs', '--platform=node', `--outfile=${bundle}`, '--log-level=warning'], {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, NODE_PATH: path.join(ROOT, 'node_modules') },
  });
  require(bundle);
  const M = globalThis.__MOON_MOD;

  console.log('\n[1] 해·달 순수 시야각(°) 기준 통일');
  const sLow = M.sunDisplayScale(67.3, 2);
  const sHigh = M.sunDisplayScale(67.3, 45);
  const sWide = M.sunDisplayScale(110, 45);
  ok(sLow.scale === 1 && sHigh.scale === 1 && sWide.scale === 1,
    `sunDisplayScale(FOV/고도 무관 고정 scale=1): ${sLow.scale}/${sHigh.scale}/${sWide.scale}`);
  ok(Math.abs(sLow.radiusDeg - 0.267) < 1e-6 && Math.abs(M.MOON_ANGULAR_RADIUS_DEG - 0.259) < 1e-6,
    `물리 각반지름 통일: 태양=${sLow.radiusDeg}°, 달=${M.MOON_ANGULAR_RADIUS_DEG}°`);

  const moon = M.createMoonGroup();
  M.updateMoonPosition(moon, new Date('2026-11-16T11:19:00Z'), 34.8155, 137.2331, 95);
  ok(moon.group.scale.x === 1 && moon.group.scale.y === 1 && moon.group.scale.z === 1,
    'Moon group scale = 1 (FOV 95°에서도 찌그러지거나 화면비율로 부풀지 않음)');

  console.log('\n[2] 3D 태양→달 벡터 투영 위상 방향 정합성');
  // 2026-11-16 20:19 JST = 11:19Z (Gamagori): 달 SW(227.6°,+21.9°), 해 WNW(277.1°,-43.7°) → 오른쪽(+X) 아래(-Y)
  const dTonight = new Date('2026-11-16T11:19:00Z');
  M.updateMoonPosition(moon, dTonight, 34.8155, 137.2331, { sunAltDeg: -43.7, fovDeg: 67.3 });
  const lTonight = moon.material.uniforms.uLightDir.value;
  ok(lTonight.x > 0.35 && lTonight.y < -0.6 && lTonight.z < 0,
    `오늘 20:19 달 빛 방향=(${lTonight.x.toFixed(3)}, ${lTonight.y.toFixed(3)}, ${lTonight.z.toFixed(3)}) — 오른쪽 아래(+X,-Y) 태양 쪽 정확히 지향`);

  // 반시계 정량 검증: 2026-11월 한 달(초승→상현→보름→하현) 실제 태양 벡터 투영·밝은 비율 일치
  let phaseAligned = true;
  let illumMatch = true;
  for (let day = 10; day <= 30; day++) {
    const d = new Date(`2026-11-${String(day).padStart(2, '0')}T12:00:00Z`);
    const mi = M.SunCalc.getMoonIllumination(d);
    const L = M.computeMoonLocalLightDir(d, 34.8155, 137.2331);
    const fracFromL = (1 + L.z) / 2;
    if (Math.abs(fracFromL - mi.fraction) > 0.025) illumMatch = false;
    // group.lookAt(0,0,0) 의 world matrix 로 역변환한 월드 광원 벡터가 실제 태양 벡터와 일치하는지 확인
    const mp = M.getMoonPosition(d, 34.8155, 137.2331);
    const sp = M.getSunPosition(d, 34.8155, 137.2331);
    const testG = new M.THREE.Group();
    const ma = (mp.altitude * Math.PI) / 180, mz = (mp.azimuth * Math.PI) / 180;
    testG.position.set(Math.cos(ma) * Math.sin(mz), Math.sin(ma), -Math.cos(ma) * Math.cos(mz));
    testG.lookAt(0, 0, 0);
    testG.updateMatrixWorld(true);
    const worldFromLocal = L.clone().applyQuaternion(testG.quaternion).normalize();
    const sa = (sp.altitude * Math.PI) / 180, sz = (sp.azimuth * Math.PI) / 180;
    const sunWorld = new M.THREE.Vector3(Math.cos(sa) * Math.sin(sz), Math.sin(sa), -Math.cos(sa) * Math.cos(sz)).normalize();
    if (worldFromLocal.dot(sunWorld) < 0.995) phaseAligned = false;
  }
  ok(illumMatch, '전 위상(11/10~11/30) L.z 로 복원한 월령 밝기 비율 (1+Lz)/2 ≈ SunCalc fraction (±0.025 이내)');
  ok(phaseAligned, '전 위상(11/10~11/30) Three.js group.lookAt(0,0,0) 쿼터니언 역변환 결과 실제 3D 태양 벡터와 내적 > 0.995');

  // 남반구 시드니 검증
  const dSid = new Date('2026-11-16T11:19:00Z');
  const LSid = M.computeMoonLocalLightDir(dSid, -33.87, 151.21);
  ok(Number.isFinite(LSid.length()) && Math.abs(LSid.length() - 1) < 1e-5,
    `남반구 시드니 단위벡터 정상 (${LSid.x.toFixed(3)}, ${LSid.y.toFixed(3)}, ${LSid.z.toFixed(3)})`);

  console.log('\n[3] 셰이더 · AdditiveBlending · 대기 소광 · 지구반사광 · 하위호환');
  ok(moon.material.blending === M.THREE.AdditiveBlending, 'AdditiveBlending 적용 (어두운 면 불투명 남색 스티커 제거)');
  const frag = moon.material.fragmentShader;
  ok(balancedBraces(moon.material.vertexShader) && balancedBraces(frag), '정점·조각 셰이더 중괄호 균형');
  ok(frag.includes('lunarSurface(normal)') && frag.includes('lommel') && frag.includes('bumpedN'),
    '3D 구면 법선 텍스처 · Lommel-Seeliger 산란 · 터미네이터 법선 요철 포함');

  const atmos = M.makeAtmosphereParams({ latitude: 34.8, observerElevM: 10, betaMie: 0.08, angstrom: 1.3, dayOfYear: 320 });
  // 낮(해 +30°) vs 밤(해 -20°) Earthshine 비교
  M.updateMoonPosition(moon, dTonight, 34.8155, 137.2331, { atmosphere: atmos, sunAltDeg: 30 });
  const esDay = moon.material.uniforms.uEarthshine.value.clone();
  M.updateMoonPosition(moon, dTonight, 34.8155, 137.2331, { atmosphere: atmos, sunAltDeg: -20 });
  const esNight = moon.material.uniforms.uEarthshine.value.clone();
  ok(esDay.r === 0 && esDay.g === 0 && esDay.b === 0, '낮(sunAlt=30°) uEarthshine=0 → 원판 흔적 없음');
  ok(esNight.b > esNight.r && esNight.b > 0.02, `밤(sunAlt=-20°) 은은한 지구반사광 (${esNight.r.toFixed(3)}, ${esNight.g.toFixed(3)}, ${esNight.b.toFixed(3)})`);

  // 하위 호환: 4인자 호출(build-path-fade.js · build-godray-sweep.js)
  const moonCompat = M.createMoonGroup();
  M.updateMoonPosition(moonCompat, new Date('2026-08-26T13:00:00Z'), 37.5, 127.0);
  ok(moonCompat.group.position.length() > 400 && moonCompat.material.uniforms.uColorBright.value.r > 0.1,
    '하위 호환 4인자 호출 updateMoonPosition(moon, date, lat, lng) 정상 작동');

  moon.dispose();
  moonCompat.dispose();
  fs.rmSync(work, { recursive: true, force: true });
  console.log(`\npass ${pass} / fail ${fail}`);
  if (fail > 0) process.exit(1);
})().catch(e => { console.error(e); process.exit(1); });
