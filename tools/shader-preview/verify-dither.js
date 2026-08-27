/**
 * **디더** 합격 판정 (`Skydome.ts` + `SceneComposer.ts`).
 *
 * 밴딩은 넓고 완만한 그라데이션이 8비트로 내려앉을 때 생깁니다. 인접 픽셀의
 * 참값 차가 1/255보다 작으면 여러 픽셀이 한 정수에 뭉쳐 평평한 띠가 됩니다.
 *
 * ⚠ 이 판정이 지키는 것은 "디더가 켜져 있다"가 아니라 **디더가 어디에
 * 있어야 하는가** 입니다. 걸 수 있는 자리가 셋인데 셋이 같은 일을 하지
 * 않습니다.
 *
 *  - **후처리 마지막 패스**: 아무 일도 안 합니다. 중간 렌더 타깃이 8비트라
 *    합성이 읽는 값은 이미 정수입니다. 한 번 짜 넣었다가 재고 뺐습니다.
 *  - **확대 패스만**: 조금 듭니다(30.4 → 22.1). 정보는 이미 잘린 뒤라
 *    보간이 만든 중간값을 흩는 것뿐입니다.
 *  - **스카이돔 셰이더 + 확대 패스**: 30.4 → 2.3. 정보가 **처음 잘리는
 *    곳**에서 흩어야 되살아납니다.
 *
 * 두 번째 칸을 함께 단언하는 이유가 그것입니다. 나중에 누가 "확대 패스에
 * 디더가 있으니 스카이돔 것은 중복"이라며 지우면 여기서 걸립니다.
 *
 * 준비:
 *   node tools/shader-preview/stage-esm.js
 *   node tools/shader-preview/build-dither-study.js
 *   (preview 디렉터리에서 python3 -m http.server 8123)
 * 사용: node tools/shader-preview/verify-dither.js
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
  const p = await b.newPage({ viewport: { width: 1740, height: 920 } });
  const pageErrors = [];
  p.on('pageerror', e => pageErrors.push(e.message));
  await p.goto(`${ORIGIN}/dither-study.html`);
  await p.waitForTimeout(20000);

  const title = await p.title();
  const stats = await p.evaluate(() => window.__stats || null);
  const errs = await p.evaluate(() => window.__errors || []);
  await b.close();

  console.log('== 셰이더 · GL ==');
  ok(pageErrors.length === 0,
    `페이지 오류 없음 ${pageErrors.length ? '— ' + pageErrors[0] : ''}`);
  ok(!/SHADER_ERR/.test(title), `셰이더 컴파일 (${title})`);
  ok(errs.length === 0, `콘솔 오류 없음 (${errs.length}건)`);
  if (!stats) {
    console.log('\nFAILURES — __stats 가 없습니다.');
    process.exit(1);
  }
  ok(stats.glError === 0, `glGetError == 0 (${stats.glError})`);

  const r = stats.결과 || [];
  const [없음, 확대만, 돔1, 돔2] = r;
  if (r.length < 4) {
    console.log('\nFAILURES — 칸이 4개가 아닙니다.');
    process.exit(1);
  }

  console.log('\n== 기준선이 실제로 띠지는가 ==');
  for (const row of r) {
    console.log(`  ${row.이름}: 평균 ${row.평균}  최장 ${row.최장}  잡음 ${row.잡음}`);
  }
  // 밴딩이 없는 화면에서 디더를 재면 아무 말도 못 합니다.
  ok(없음.평균 > 15, `디더 없이는 평탄구간이 길다 (${없음.평균}px)`);
  ok(없음.최장 > 60, `디더 없이는 아주 긴 띠가 있다 (최장 ${없음.최장}px)`);

  console.log('\n== 정보가 잘리기 전에 흩어야 한다 ==');
  const 확대감소 = 없음.평균 / 확대만.평균;
  const 전체감소 = 없음.평균 / 돔2.평균;
  ok(확대감소 < 2, `확대 패스만으로는 크게 못 잡는다 (${확대감소.toFixed(2)}배)`);
  ok(전체감소 > 8, `스카이돔에서 함께 걸면 확 잡힌다 (${전체감소.toFixed(1)}배)`);
  // 이 두 줄이 함께 있어야 "스카이돔 디더는 중복"이라는 오해가 막힙니다.
  ok(돔2.평균 < 확대만.평균 / 5,
    `스카이돔 디더가 확대 패스 디더보다 결정적 (${돔2.평균} vs ${확대만.평균})`);
  ok(돔2.최장 < 없음.최장 / 3, `가장 긴 띠도 줄었다 (${없음.최장} → ${돔2.최장}px)`);
  ok(돔2.평균 < 돔1.평균, `절반 해상도 손실만큼 더 얹는 것이 효과가 있다 (${돔1.평균} → ${돔2.평균})`);

  console.log('\n== 대가 — 잡음이 보이면 안 된다 ==');
  ok(돔2.잡음 < 1, `얹은 잡음이 1단계 미만 (${돔2.잡음})`);
  // 디더는 잡음을 주고 밴딩을 사는 거래입니다. 1단계를 넘으면 밴딩 대신
  // 지글거림이 보이므로 거래가 손해가 됩니다.
  ok(돔2.잡음 > 없음.잡음, `잡음이 실제로 얹혔다 (${없음.잡음} → ${돔2.잡음})`);

  console.log('\n%s — pass %d / fail %d', fail === 0 ? 'ALL PASS' : 'FAILURES', pass, fail);
  process.exit(fail === 0 ? 0 : 1);
})();
