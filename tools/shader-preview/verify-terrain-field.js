/**
 * **능선 실루엣이 자료와 맞는가** 합격 판정 (docs/COASTLINE_PLAN.md 2단계).
 *
 * 1단계에서 고도값이 맞는 것을 확인했고, 2단계는 그 값이 **기하**가 됩니다.
 * 그러면 물어야 할 것은 하나뿐입니다 — 화면에 그려진 능선 윤곽이 자료가
 * 말하는 윤곽과 같은가.
 *
 * ## 재는 법
 *
 * 30° 씩 12방향으로 한 바퀴를 찍고, 각 **화소 열**에서 하늘이 아닌 맨 위
 * 화소를 찾습니다. 카메라 위 벡터가 월드 위쪽이면 한 열은 방위가 거의 고정된
 * 수직면이라 열 → 방위, 행 → 고도각이 풀립니다. 참조는 같은 식을 CPU 로 다시
 * 푼 값입니다 (`dem-cpu.js` 가 PNG 를 직접 풀고 고리를 훑습니다).
 *
 * ## 대조를 셋 답니다 — 이게 없으면 이 판정은 못 믿습니다
 *
 * ① **평평한 판.** DEM 을 끄면 지면이 발밑 높이로 평평해지고, 그때 실루엣은
 *    손으로 풀립니다: `max over d atan2(−눈높이 − d²/2R, d)` = −0.044°.
 *    읽어내는 사슬(투영·읽기·행→각도) 전체가 여기서 검증됩니다. 실측
 *    −0.0243° — 남는 0.02° 는 화소 양자화(행 한 칸 0.0586°)입니다.
 * ② **열 → 방위 직접 대조.** 카메라에서 뽑은 광선 방위와 Node 가 계산한
 *    방위를 화소 단위로 맞춰 봅니다 (실측 최대 0.054°). 상관으로 어긋남을
 *    **추측하지 않습니다** — 아래 참고.
 * ③ **살 수 훑기.** 살을 128→1024 로 늘리면 최대오차가 줄어야 합니다.
 *    안 줄면 이 측정은 메시가 아니라 딴것을 재고 있는 것입니다.
 *
 * ## 이 판정이 잡은 것
 *
 * **지상 좌표의 남북 부호.** 방위 A(북에서 시계방향)의 지상 좌표는
 * `(동, 남) = (sin A, −cos A)` 인데 참조와 `horizonAngleDeg` 가 `+cos A` 를
 * 썼습니다. 격자 생성기도 같은 실수를 했지만 거기서는 한 바퀴를 반대로 돌
 * 뿐이라 **아무 증상이 없었습니다** — 그래서 놓치기 쉽습니다.
 *
 *     거울상일 때:  중앙 1.339° · 최대 6.537° · 상관 0.883
 *     고친 뒤:      중앙 0.018° · 최대 0.119° · 상관 0.99999
 *
 * ⚠ **상관 이동으로 어긋남을 찾으려 하지 마십시오.** 처음에 그렇게 했다가
 * −19.9° 에서 봉우리가 나왔습니다. 지형 신호에 저주파 성분이 커서 생긴
 * 가짜 봉우리였고, 실제 방위 매핑은 0.054° 로 멀쩡했습니다. 대조 ② 처럼
 * **매핑을 직접** 재야 합니다.
 *
 * ## 문턱은 재서 정했습니다 (살 수 훑기, 고리 128)
 *
 *     살    방위간격   중앙     최대     삼각형
 *     128   2.813°    0.022°   0.240°    32,512
 *     256   1.406°    0.018°   0.119°    65,024   ← 채택
 *     512   0.703°    0.017°   0.085°   130,048
 *     1024  0.352°    0.017°   0.085°   260,096   (수렴)
 *
 * 256 에서 최대 0.119° 는 읽기 해상도(행 0.0586°)의 두 칸입니다. 512 로
 * 가도 0.034° 밖에 못 줄이는데 삼각형은 두 배입니다. 그래서 256 입니다.
 *
 * 반지름 쪽은 고리 128 대 512 를 CPU 로 비교해 중앙 0.010° · 최대 0.222°
 * 였습니다 — 병목이 아닙니다.
 *
 * 준비:
 *   node tools/shader-preview/build-terrain-field.js
 *   node tools/shader-preview/stage-esm.js
 * 사용: node tools/shader-preview/verify-terrain-field.js
 */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const { ORIGIN } = require('./paths');

let pass = 0;
let fail = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log('  PASS: ' + label); }
  else { fail++; console.log('  FAIL: ' + label); }
}

(async () => {
  const b = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
    args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const p = await b.newPage({ viewport: { width: 1220, height: 900 } });
  const pageErrors = [];
  p.on('pageerror', e => pageErrors.push(e.message));
  await p.goto(ORIGIN + '/terrain-field.html', { timeout: 180000 });
  // 이 페이지는 훑기까지 도느라 SwiftShader 에서 1분 넘게 걸립니다. 고정
  // 대기는 느리거나 모자라므로 끝났다는 신호(제목)를 기다립니다.
  await p.waitForFunction(() => /^DONE::/.test(document.title), null,
    { timeout: 180000, polling: 500 }).catch(() => {});

  const title = await p.title();
  const stats = await p.evaluate(() => window.__stats || null);
  const errs = await p.evaluate(() => window.__errors || []);
  await b.close();

  console.log('== 셰이더 · GL ==');
  ok(pageErrors.length === 0,
    `페이지 오류 없음 ${pageErrors.length ? '— ' + pageErrors[0] : ''}`);
  ok(!/ERR/.test(title), `셰이더 컴파일 (${title})`);
  ok(errs.length === 0, `콘솔 오류 없음 (${errs.length}건)`);
  if (!stats || !stats.결과) {
    console.log('\nFAILURES — __stats.결과 가 없습니다.');
    process.exit(1);
  }
  ok(stats.glError === 0, `glGetError == 0 (${stats.glError})`);

  const r = stats.결과;

  console.log('\n== 대조 ① 평평한 판 (손으로 푼 답) ==');
  const f = r.평판;
  console.log(`  이론 ${f.이론}° · 실측 평균 ${f.평균}° · 최대편차 ${f.최대편차}°`);
  ok(f.잡힘 === f.열, `모든 열에서 지면이 잡힘 (${f.잡힘}/${f.열})`);
  // 행 한 칸이 0.0586° 이므로 그 이상 벗어나면 읽기 사슬이 틀린 것입니다.
  ok(f.최대편차 <= 0.06,
    `읽기 사슬이 이론과 화소 한 칸 안 (${f.최대편차}° ≤ 0.06°)`);

  console.log('\n== 대조 ② 열 → 방위 직접 대조 ==');
  const dz = r.매핑.map(m => {
    let d = m.gpu - m.node;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    return Math.abs(d);
  });
  console.log(`  표본 ${dz.length}개 · 최대 ${Math.max(...dz).toFixed(3)}°`);
  ok(Math.max(...dz) <= 0.1,
    `카메라와 참조가 같은 방위를 봄 (${Math.max(...dz).toFixed(3)}° ≤ 0.1°)`);

  console.log('\n== 대조 ③ 살 수에 반응하는가 ==');
  r.살훑기.forEach(s =>
    console.log(`  살 ${String(s.살).padStart(4)} (${s.방위간격}°)  중앙 ${s.중앙}°  최대 ${s.최대}°  삼각형 ${s.삼각형}`));
  const 성긴 = r.살훑기[0], 촘촘 = r.살훑기[r.살훑기.length - 1];
  ok(성긴.최대 > 촘촘.최대,
    `살을 늘리면 최대오차가 줄어듦 — 측정이 메시를 잼 (${성긴.최대}° → ${촘촘.최대}°)`);
  const 채택 = r.살훑기.find(s => s.살 === r.살) ?? 촘촘;
  ok(채택.최대 <= 촘촘.최대 * 1.5 + 0.02,
    `채택한 살 ${r.살} 이 수렴값에 근접 (${채택.최대}° 대 ${촘촘.최대}°)`);

  console.log('\n== 실루엣이 자료와 맞는가 ==');
  console.log(`  고리 ${r.고리} · 살 ${r.살} · 삼각형 ${r.삼각형}`);
  console.log(`  열 ${r.열} (방위 ${r.방위해상도}° 간격, 행 ${r.행해상도}°)`);
  console.log(`  중앙 ${r.중앙오차}° · 최대 ${r.최대오차}° · 상관 ${r.상관} · 치우침 ${r.치우침}°`);
  console.log(`  참조 ${r.참조범위[0]}°~${r.참조범위[1]}° · 화면 ${r.화면범위[0]}°~${r.화면범위[1]}°`);
  ok(r.지형이잡힌열 === r.열, `모든 열에서 지형이 잡힘 (${r.지형이잡힌열}/${r.열})`);
  // 거울상 결함은 상관 0.883 이었습니다. 0.999 면 그 부류는 전부 걸립니다.
  ok(r.상관 >= 0.999, `방위가 맞음 — 상관 ${r.상관} ≥ 0.999`);
  ok(r.중앙오차 <= 0.05, `중앙오차가 읽기 해상도 수준 (${r.중앙오차}° ≤ 0.05°)`);
  ok(r.최대오차 <= 0.25, `최대오차도 화소 몇 칸 (${r.최대오차}° ≤ 0.25°)`);
  ok(Math.abs(r.치우침) <= 0.05, `치우침 없음 (${r.치우침}°)`);
  // 실루엣이 실제로 굴곡져야 합니다 — 평평한 원반이면 이 폭이 0 입니다.
  const 폭 = r.참조범위[1] - r.참조범위[0];
  ok(폭 >= 5, `실루엣이 굴곡짐 (폭 ${폭.toFixed(2)}° ≥ 5°) — 원반이 아님`);

  console.log('\n== 격자 바깥으로 넘겨주기 ==');
  const h = r.넘겨주기;
  console.log(`  수평선 ${h.수평선내려앉음}° · 바다 방위 바깥 고리 ${h.바다바깥고리}° · 틈 ${h.틈}°`);
  // 바깥 고리가 수평선 **위**로 올라오면 격자가 진짜 수평선을 덮어 버립니다.
  // 아래에 있어야 그 위를 4단계의 해수면이 이어받을 수 있습니다.
  ok(h.틈 > 0,
    `바깥 고리가 수평선 아래 — 해수면이 이어받을 자리가 있음 (틈 ${h.틈}°)`);
  ok(h.바다방위수 > 100, `바다 방위 표본이 충분 (${h.바다방위수}개)`);

  console.log(`\n${fail ? 'FAILURES' : '모두 통과'} — pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})();
