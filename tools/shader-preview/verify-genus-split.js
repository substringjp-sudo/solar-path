/**
 * **한 화면 안에서 운형이 갈리는가** 합격 판정 (docs/CLOUD_VARIETY_PLAN.md 2단계).
 *
 * 같은 링·같은 카메라·같은 태양으로 두 번 렌더합니다. 차이는 오직
 * 덱이 운형을 **층당 하나**로 받느냐 **방향마다** 받느냐입니다.
 *
 * 두 축으로 봅니다. 하나만 보면 안 됩니다:
 *
 *  - **밝기** — τ가 갈렸는가 (고적운 16 → 고층운 30).
 *  - **중간 알파 비율** — 조각 세기가 갈렸는가. 조각형은 알파가 문턱에
 *    잘려 0/1로 몰리고, 층상형은 운량이 그대로 알파라 전부 중간값입니다.
 *
 * ⚠ 알파의 **표준편차**로는 조각 세기를 못 잽니다. 이항 분포의 분산은
 * 운량 0.5에서 최대라, 운량이 다른 두 영역을 비교하면 순서가 뒤집힙니다
 * (실측: 층상 운량 0.61에서 0.372 > 조각 운량 0.21에서 0.335).
 * 처음에 그걸로 재서 2단계가 아무 일도 안 한 것처럼 보였습니다.
 *
 * 준비:
 *   node tools/shader-preview/stage-esm.js
 *   node tools/shader-preview/build-genus-split-preview.js
 *   (preview 디렉터리에서 python3 -m http.server 8123)
 * 사용: node tools/shader-preview/verify-genus-split.js
 */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');

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
  const p = await b.newPage({ viewport: { width: 1200, height: 520 } });
  const pageErrors = [];
  p.on('pageerror', e => pageErrors.push(e.message));
  await p.goto('http://localhost:8123/genus-split.html');
  await p.waitForTimeout(14000);

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

  console.log('\n== 판정 자체: 192방향이 어떤 운형을 골랐나 ==');
  const D = stats.운형분포;
  console.log(`  ${D.방향수}방향  →  ${JSON.stringify(D.분포)}   τ ${D.τ최소} ~ ${D.τ최대}`);
  const 종수 = Object.keys(D.분포).length;
  ok(종수 >= 2, `한 층 안에서 운형이 갈림 (${종수}종)`);
  // 어느 한쪽이 90%를 넘으면 "갈렸다"고 말할 수 없습니다 — 몇 방향만
  // 예외인 것과 지역이 나뉜 것은 다릅니다.
  const 최대비 = Math.max(...Object.values(D.분포)) / D.방향수;
  ok(최대비 < 0.9,
    `한 운형이 독식하지 않음 (최다 ${(최대비 * 100).toFixed(0)}%)`);
  ok(D.τ최대 / D.τ최소 >= 1.5,
    `τ가 실제로 벌어짐 (${D.τ최소} ~ ${D.τ최대}, ×${(D.τ최대 / D.τ최소).toFixed(2)})`);

  const 이전 = stats.이전, 방향별 = stats.방향별;
  const line = (n, s) =>
    `  ${n}  왼 밝기 ${s.왼쪽.밝기} 중간알파 ${(s.왼쪽.중간알파 * 100).toFixed(1)}%  |  ` +
    `오른 밝기 ${s.오른쪽.밝기} 중간알파 ${(s.오른쪽.중간알파 * 100).toFixed(1)}%`;

  console.log('\n== 화면: 좌우 대비 ==');
  console.log(line('2단계 이전', 이전));
  console.log(line('2단계    ', 방향별));

  // 운량은 두 경로가 같아야 합니다. 달라졌다면 운형을 바꾸면서 **예보를
  // 망가뜨린** 것이고, 그건 이 프로젝트가 반복해서 밟은 지뢰입니다.
  const dL = Math.abs(이전.왼쪽.운량 - 방향별.왼쪽.운량);
  const dR = Math.abs(이전.오른쪽.운량 - 방향별.오른쪽.운량);
  console.log(`  운량 보존 — 왼 ${(dL * 100).toFixed(2)}%p, 오른 ${(dR * 100).toFixed(2)}%p`);
  ok(dL < 0.03 && dR < 0.03,
    `운형을 바꿔도 예보 운량은 그대로 (≤${(Math.max(dL, dR) * 100).toFixed(2)}%p)`);

  const 대비이전 = 이전.왼쪽.밝기 - 이전.오른쪽.밝기;
  const 대비이후 = 방향별.왼쪽.밝기 - 방향별.오른쪽.밝기;
  console.log(`  좌우 밝기차 ${대비이전.toFixed(1)} → ${대비이후.toFixed(1)}`);
  ok(대비이후 > 대비이전 * 1.25,
    `운형이 갈리면서 좌우 밝기 대비가 커짐 (${대비이전.toFixed(1)} → ${대비이후.toFixed(1)})`);

  // 조각 세기 — 이쪽이 본체입니다. 고적운(알갱이)과 고층운(균질한 판)의
  // 차이는 밝기보다 **모양**에서 훨씬 크게 납니다.
  //
  // ⚠ 예전에는 "중간 알파(0.15~0.85)의 비율"로 쟀고, 이 단언이 오래 실패해
  // 있었습니다. **렌더러가 아니라 지표가 틀렸습니다** — 두 가지로요.
  //
  //  1. **운량에 오염됨.** 층상형 쪽 운량이 90% 라 완벽한 균질 판의 알파가
  //     0.90 인데, 그건 (0.15, 0.85) 밴드 **밖**입니다. 잘 그릴수록 지표가
  //     낮아졌습니다. (그 전에 쓰던 표준편차도 같은 병이었고, 중간알파로
  //     옮길 때 정규화를 안 해 병만 옮겨 심었습니다.)
  //  2. **스침각 얼룩에 오염됨.** 화면 아래쪽은 덱을 비스듬히 보는 구간이라
  //     조각이 화소보다 작아지며 얼룩지는데, 운형과 무관한 현상입니다.
  //
  // 지금은 **이항성** = Var(알파) / (p(1-p)) 를 씁니다. 알파가 0/1 로 몰릴수록
  // (조각형) 이항분포의 최대 분산 p(1-p) 에 다가가고, 운량이 그대로 알파면
  // (층상형) 0 에 가깝습니다. p(1-p) 로 나누므로 **운량 의존이 정확히
  // 사라집니다.** 측정 창도 위쪽 55% 로 좁혔습니다.
  //
  // 하늘 전체를 한 운형으로 채워 확인했습니다 — 셰이더는 cellStrength 를
  // 정확히 듣고 있습니다:
  //   전부 고적운(0.95): 왼 0.855 / 오른 0.818   (양쪽 조각)
  //   전부 고층운(0.00): 왼 0.043 / 오른 0.091   (양쪽 판)
  const 결이전 = 이전.왼쪽.이항성 - 이전.오른쪽.이항성;
  const 결이후 = 방향별.왼쪽.이항성 - 방향별.오른쪽.이항성;
  console.log(`  이항성  이전 왼 ${이전.왼쪽.이항성} / 오른 ${이전.오른쪽.이항성}` +
    `   →  방향별 왼 ${방향별.왼쪽.이항성} / 오른 ${방향별.오른쪽.이항성}`);
  console.log(`  좌우 이항성차 ${결이전.toFixed(3)} → ${결이후.toFixed(3)}`);
  ok(Math.abs(결이전) < 0.15,
    `이전에는 좌우 모양이 같았음 (${결이전.toFixed(3)})`);
  ok(결이후 > 0.25,
    `이제 오른쪽이 층상형(균질한 판)으로 갈림 (${결이후.toFixed(3)})`);

  console.log('\n%s — pass %d / fail %d', fail === 0 ? 'ALL PASS' : 'FAILURES', pass, fail);
  process.exit(fail === 0 ? 0 : 1);
})();
