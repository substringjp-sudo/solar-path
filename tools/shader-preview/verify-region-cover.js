/**
 * **지역별 예보 운량이 화면까지 살아남는가** (사진 대조 2차, 16-B/16-D).
 *
 * ## 왜 따로 재나
 *
 * 운량장에 두 가지를 동시에 요구합니다. 둘은 서로 잡아당깁니다.
 *
 *  1. **지역차** — 서쪽은 텅 비고 동쪽은 꽉 찰 수 있어야 합니다.
 *     각 지역의 예보값이 그 지역의 평균으로 나와야 합니다.
 *  2. **U자 구조** — 한 지역 안에서도 파란 구멍과 짙은 덩어리가 있어야
 *     합니다. 고르게 반쯤 덮인 하늘은 실제로 드뭅니다.
 *
 * 2를 세게 하면 1이 깨집니다. 실제로 그렇게 깨졌습니다: 층 평균 하나로 U자를
 * 만들고 `cover = U자 + (예보 − 층평균)` 으로 옮겼더니 **[0,1] 클램프가 지역
 * 평균을 파괴**해, 예보 5%인 서쪽이 화면에서 **26%** (5배)로 나왔습니다.
 * `verify-overcast`의 운량 보존 검사는 **하늘 전체 평균**만 보므로 이걸
 * 못 잡습니다 — 한쪽이 부풀고 다른 쪽이 눌리면 전체 평균은 멀쩡합니다.
 *
 * ## 어떻게 재나
 *
 * 동쪽 90% / 서쪽 5% / 남북 48% 인 링을 넣고, 방향마다 **입력 예보값과 출력
 * 운량을 직접 짝지어** 입력 구간별 평균을 비교합니다. 섹터 이름으로 묶지
 * 않는 이유: 팬이 인접 레이 사이를 보간하므로 경계 방향은 두 값의 혼합이고,
 * 천정 부근은 거리가 링 안쪽이라 관측점 값으로 수렴합니다. 이름으로 묶으면
 * 그 혼합이 오차로 잡힙니다.
 *
 * U자 구조가 살아 있는지도 함께 봅니다 — 지역 평균만 맞추고 구조를 뭉개면
 * 1번은 통과하지만 2번을 잃습니다.
 *
 * 준비: node tools/shader-preview/stage-node.js
 * 사용: node tools/shader-preview/verify-region-cover.js
 */
global.__DEV__ = false;
const S = require('/tmp/skybuild/skyColumn.js');

let pass = 0;
let fail = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log('  PASS: ' + label); }
  else { fail++; console.log('  FAIL: ' + label); }
}

const AZ = [0, 30, 60, 90, 120, 150, 180, -150, -120, -90, -60, -30];
const D = [10, 30, 70, 130, 200, 280, 380];

function ringWithRegions() {
  const ring = [{ distance: 0, azimuthOffset: 0, low: 5, mid: 48, high: 5 }];
  for (const az of AZ) {
    for (const d of D) {
      const a = (az + 360) % 360;
      const east = a >= 45 && a <= 135;
      const west = a >= 225 && a <= 315;
      ring.push({ distance: d, azimuthOffset: az, low: 5, high: 5,
        mid: east ? 90 : west ? 5 : 48 });
    }
  }
  return ring;
}

const fan = new S.WeatherFan(ringWithRegions(), 0);
const cols = S.buildSkyColumns({
  fan, driftMinutes: 0,
  windSpeedKmh: S.PLACEHOLDER_WIND_SPEED_KMH,
  windBearingDeg: S.PLACEHOLDER_WIND_BEARING_DEG,
});

// 방향마다 입력 예보값을 다시 뽑아 출력과 짝짓습니다.
const rows = [];
for (const c of cols.filter(x => x.layer === 'mid')) {
  const { data } = fan.sample(c.azimuthDeg, c.distanceKm);
  rows.push({ inp: (data ? data.mid : 0) / 100, out: c.cover });
}

console.log('== 지역 예보 → 화면 운량 (중층) ==');
const BUCKETS = [[0, 0.10], [0.10, 0.30], [0.30, 0.60], [0.60, 0.85], [0.85, 1.01]];
let worst = 0;
for (const [lo, hi] of BUCKETS) {
  const v = rows.filter(r => r.inp >= lo && r.inp < hi);
  if (v.length < 5) continue;
  const mi = v.reduce((a, b) => a + b.inp, 0) / v.length;
  const mo = v.reduce((a, b) => a + b.out, 0) / v.length;
  const err = Math.abs(mo - mi);
  worst = Math.max(worst, err);
  console.log(`  입력 ${lo.toFixed(2)}~${hi.toFixed(2)}  n=${String(v.length).padStart(3)}  ` +
    `입력평균 ${mi.toFixed(3)}  출력평균 ${mo.toFixed(3)}  차이 ${(mo - mi >= 0 ? '+' : '')}${(mo - mi).toFixed(3)}`);
  // 예전 방식은 0.00~0.10 구간에서 +0.21 이었습니다 (5% → 26%).
  ok(err < 0.06,
    `  구간 ${lo.toFixed(2)}~${hi.toFixed(2)} 지역 평균 보존 (오차 ${(err * 100).toFixed(1)}%p < 6%p)`);
}

const MI = rows.reduce((a, b) => a + b.inp, 0) / rows.length;
const MO = rows.reduce((a, b) => a + b.out, 0) / rows.length;
console.log(`\n  하늘 전체  입력 ${MI.toFixed(4)}  출력 ${MO.toFixed(4)}`);
ok(Math.abs(MO - MI) < 0.02,
  `하늘 전체 평균도 보존 (오차 ${(Math.abs(MO - MI) * 100).toFixed(2)}%p)`);

// 지역차가 실제로 화면에 크게 나타나는가 (평균만 맞고 대비가 죽으면 무의미).
const dark = rows.filter(r => r.inp > 0.8);
const clearSky = rows.filter(r => r.inp < 0.1);
const contrast =
  dark.reduce((a, b) => a + b.out, 0) / dark.length -
  clearSky.reduce((a, b) => a + b.out, 0) / clearSky.length;
console.log(`  흐린 지역 − 맑은 지역 = ${contrast.toFixed(3)}`);
ok(contrast > 0.6, `지역차가 화면에 뚜렷함 (${contrast.toFixed(3)} > 0.6)`);

console.log('\n== U자 구조가 남아 있는가 ==');
// 지역 평균만 맞추고 한 지역 안을 평평하게 만들면 1번은 통과하지만 2번을
// 잃습니다. 균일 입력에서 분포를 봅니다.
const flatRing = [{ distance: 0, azimuthOffset: 0, low: 5, mid: 50, high: 5 }];
for (const az of AZ) for (const d of D) {
  flatRing.push({ distance: d, azimuthOffset: az, low: 5, mid: 50, high: 5 });
}
const flatCols = S.buildSkyColumns({
  fan: new S.WeatherFan(flatRing, 0), driftMinutes: 0,
  windSpeedKmh: S.PLACEHOLDER_WIND_SPEED_KMH,
  windBearingDeg: S.PLACEHOLDER_WIND_BEARING_DEG,
});
const fv = flatCols.filter(c => c.layer === 'mid').map(c => c.cover);
const fm = fv.reduce((a, b) => a + b, 0) / fv.length;
const fsd = Math.sqrt(fv.reduce((a, b) => a + (b - fm) ** 2, 0) / fv.length);
const clearFrac = fv.filter(v => v < 0.10).length / fv.length;
const solidFrac = fv.filter(v => v > 0.90).length / fv.length;
console.log(`  입력 50% 균일 → 평균 ${fm.toFixed(3)}  표준편차 ${fsd.toFixed(3)}`);
console.log(`  파란 하늘(10% 미만) ${(clearFrac * 100).toFixed(1)}%   꽉 참(90% 초과) ${(solidFrac * 100).toFixed(1)}%`);
// 문턱의 근거.
//
// 예전(좁은 가우시안)은 표준편차 0.127, 양 끝이 0% / 0% 였습니다.
//
// ⚠ 한때 24% / 24.5% 가 나온 적이 있는데 **그건 기준으로 쓸 수 없습니다.**
// 그 버전은 클램프로 지역 평균을 파괴하고 있었습니다 (예보 5%인 지역이
// 26%로). 구조를 예보 정확도를 팔아서 산 값입니다.
//
// 지역 평균 자체는 국소 보정이 어느 설정에서도 지켜 줍니다(1.5~1.9%p).
// 그래서 실제 상충은 지역차가 아니라 다른 데 있습니다.
//
// 구조를 키우려고 노이즈를 잘게 하면 이번엔 **시간 일관성**이
// 깨집니다 — 타임라인 키프레임 5분 사이에 무늬가 통째로 뒤바뀌어 구름이
// 흘러가는 대신 자리에서 명멸합니다. 세 지표를 함께 훑은 경계 (6실현 평균,
// 배율 → 지역오차 / 표준편차 / 키프레임 보간오차):
//
//   ×1.00  11.0km   1.9%p / 0.157 / 1.5%p
//   ×0.50   5.5km   1.8%p / 0.195 / 3.1%p
//   ×0.35   3.8km   1.5%p / 0.226 / 4.4%p   ← 채택
//   ×0.15   1.6km   1.7%p / 0.263 / 7.9%p   구조 최고, 명멸함
//
// 문턱은 그 경계 바로 아래에 둡니다 — 지역 정확도나 시간 일관성을 팔아
// 구조를 늘리는 변경이 들어오면 위쪽 단언이나 verify-timeline이 먼저
// 실패하도록.
ok(fsd > 0.20, `분포가 넓음 (표준편차 ${fsd.toFixed(3)} > 0.20)`);
ok(clearFrac > 0.03, `파란 하늘이 실제로 있음 (${(clearFrac * 100).toFixed(1)}% > 3%)`);
ok(solidFrac > 0.03, `꽉 찬 곳도 있음 (${(solidFrac * 100).toFixed(1)}% > 3%)`);
ok(Math.abs(fm - 0.5) < 0.02, `그러면서 평균은 예보대로 (${fm.toFixed(3)})`);

console.log('\n%s — pass %d / fail %d', fail === 0 ? 'ALL PASS' : 'FAILURES', pass, fail);
process.exit(fail === 0 ? 0 : 1);
