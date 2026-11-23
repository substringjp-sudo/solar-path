/**
 * **해 쪽 빛 통로 옆모습(해 방향 거리별 구름)이 링 자료와 맞는가** — 판정. 브라우저·네트워크가 필요 없습니다.
 *
 * `calcSteps.ts` 의 `sunLineProfile`(링에서 해 방향 점을 거리순으로 뽑아 층을 합친 운량)과 `sunLineGap`(해 쪽 빛이 구름 밑으로 들어올 틈)이
 * 화면(SkyMapView 아래 옆모습 띠)이 그릴 값입니다. 화면이 그린 구름과 틈이 자료와 갈라지면 읽는 법 그림이 거짓말을 합니다.
 *
 * 먼저 정한 줄:
 *  1. 프로필 — 해 방향(azimuthOffset 0)이고 distance > 0 인 점만, 거리 오름차순. 운량 = 1 − (1−낮)(1−중)(1−높) (0~1).
 *     손으로 푼 값: (낮 50, 중 0, 높 0) = 0.5, (20, 30, 40) = 1 − .8·.7·.6 = .664, (0, 0, 0) = 0.
 *  2. 다른 방위의 점은 들어가지 않는다. 점이 하나도 없으면 빈 배열.
 *  3. 틈 — 운량 0.3 미만인 연속 구간이, 그보다 가까운 곳에 운량 0.6 이상 점이 있을 때만 틈이다(빛이 틈으로 들어와 가까운 구름 밑을 비춘다).
 *     돌려주는 값은 그런 첫 구간 {fromKm, toKm}(구간 첫 점 · 끝 점의 거리). 가까운 곳이 모두 맑거나 먼 곳이 모두 두꺼우면 null.
 *     예: 거리 30·60·100·200 의 운량 .9 .9 .2 .1 → {100, 200}. .1 .1 .1 .1 → null(가려질 구름이 없다). .9 .9 .9 .9 → null.
 *  4. 연결 — SkyMap 에 sunLine 이 실리고(buildSunsetScoreCards), SkyMapView 가 옆모습 띠를 그리며 읽는 법 글을 단다.
 */
const path = require('path');
const fs = require('fs');
const { PREVIEW, REPO_ROOT } = require('./paths');
let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS: ' + l); } else { fail++; console.log('  FAIL: ' + l); } };
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;
(async () => {
  const C = await import('file://' + path.join(PREVIEW, 'app', 'utils', 'calcSteps.js'));
  const pt = (d, off, low, mid, high) => ({ distance: d, azimuthOffset: off, low, mid, high });
  console.log('\n[1][2] 프로필');
  const ring = [pt(0, 0, 90, 90, 90), pt(100, 0, 20, 30, 40), pt(30, 0, 50, 0, 0), pt(60, 90, 100, 100, 100), pt(200, 0, 0, 0, 0), pt(60, 180, 99, 99, 99)];
  const p = C.sunLineProfile(ring);
  ok(p.map(x => x.distKm).join() === '30,100,200', `해 방향만 거리 오름차순 (${p.map(x => x.distKm)})`);
  ok(near(p[0].cover, 0.5) && near(p[1].cover, 0.664) && near(p[2].cover, 0), `손으로 푼 운량 .5 .664 0 (${p.map(x => x.cover)})`);
  ok(C.sunLineProfile([pt(50, 90, 10, 10, 10)]).length === 0 && C.sunLineProfile([]).length === 0, '해 방향 점이 없으면 빈 배열');
  console.log('\n[3] 틈');
  const mk = (...v) => [30, 60, 100, 200].slice(0, v.length).map((d, i) => ({ distKm: d, cover: v[i] }));
  const g = C.sunLineGap(mk(0.9, 0.9, 0.2, 0.1));
  ok(g && g.fromKm === 100 && g.toKm === 200, `가까운 곳이 두껍고 먼 곳이 트이면 {100, 200} (${JSON.stringify(g)})`);
  ok(C.sunLineGap(mk(0.1, 0.1, 0.1, 0.1)) === null, '모두 맑으면 null');
  ok(C.sunLineGap(mk(0.9, 0.9, 0.9, 0.9)) === null, '모두 두꺼우면 null');
  ok(C.sunLineGap(mk(0.2, 0.2, 0.9, 0.9)) === null, '맑은 구간이 두꺼운 구름보다 안쪽(가까운 쪽)에만 있으면 null(그 틈을 지난 빛이 비출 구름이 없다)');
  { const g2 = C.sunLineGap(mk(0.2, 0.9, 0.9, 0.2)); ok(g2 && g2.fromKm === 200 && g2.toKm === 200, `두꺼운 구름 너머 먼 맑은 점은 {200, 200} (${JSON.stringify(g2)})`); }
  ok(C.sunLineGap([]) === null, '빈 프로필이면 null');
  console.log('\n[4] 연결');
  const steps = fs.readFileSync(path.join(REPO_ROOT, 'src/utils/calcSteps.ts'), 'utf8');
  const cards = fs.readFileSync(path.join(REPO_ROOT, 'src/components/CalcSteps/StepCards.tsx'), 'utf8');
  ok(/sunLine: sunLineProfile\(/.test(steps) && /sunLine\?:/.test(steps), 'buildSunsetScoreCards 가 SkyMap 에 sunLine 을 싣는다');
  ok(/<SunLineStrip/.test(cards) && /sunLineGap\(/.test(cards), 'SkyMapView 아래 옆모습 띠(SunLineStrip)가 틈을 그린다');
  console.log(fail ? `\n실패 ${fail} / 통과 ${pass}` : `\n모두 통과 — pass ${pass} / fail 0`);
  process.exit(fail ? 1 : 0);
})();
