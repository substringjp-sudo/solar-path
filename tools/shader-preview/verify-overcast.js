global.__DEV__=false;
const S = require('/tmp/skybuild/skyColumn.js');
const A = require('/tmp/skybuild/atmosphere.js');
let pass=0, fail=0;
const ok=(c,m)=>{ if(c) pass++; else { fail++; console.log('  FAIL:', m); } };

// 실측 팬을 흉내낸 CloudData 배열
function makeFan(low, mid, high, opts={}) {
  const out=[{ distance:0, azimuthOffset:0, low, mid, high, ...opts }];
  for (const off of [-20,-10,0,10,20])
    for (const d of [10,30,70,130,200,280,380])
      out.push({ distance:d, azimuthOffset:off, low, mid, high, ...opts });
  return out;
}
const build = (low,mid,high,opts) => S.buildSkyColumns({
  fan: new S.WeatherFan(makeFan(low,mid,high,opts), 270),
  driftMinutes: 0, windSpeedKmh: 20, windBearingDeg: 260,
});

console.log('== 등입체각 격자 ==');
const g = S.elevationGrid(8);
console.log('  고도각:', g.map(v=>v.toFixed(1)+'°').join(' '));
// 각 구간이 담당하는 입체각이 같아야 함 → sin(ε) 이 등간격
const sins = g.map(e=>Math.sin(e*Math.PI/180));
const diffs = []; for(let i=1;i<sins.length;i++) diffs.push(sins[i]-sins[i-1]);
const spread = Math.max(...diffs)-Math.min(...diffs);
ok(spread < 1e-9, `sin(ε) 등간격 (편차 ${spread.toExponential(2)})`);
// 등입체각 띠의 '중심'이므로 최상단은 90°가 아니라 그 띠의 대표각입니다.
// 최상단 띠는 sin 7/8~1, 즉 고도각 61°~90°를 대표합니다.
ok(g[0] < 5, `최하단 띠 중심 ${g[0].toFixed(1)}° (지평선 부근)`);
ok(g[g.length-1] > 60, `최상단 띠 중심 ${g[g.length-1].toFixed(1)}° (61~90° 띠를 대표)`);
const topBandFrac = 1 - Math.sin(61*Math.PI/180);
ok(Math.abs(topBandFrac - 1/8) < 0.02, `최상단 띠가 하늘의 ${(topBandFrac*100).toFixed(1)}% (= 1/8)`);

console.log('\n== 고도각 → 지상거리 역산 ==');
for (const [alt, e, expect] of [[1.5,45,1.5],[1.5,10,8.5],[10,5,114],[10,45,10]]) {
  const d = S.elevationToDistanceKm(e, alt);
  ok(Math.abs(d-expect)/expect < 0.05, `h=${alt}km ε=${e}° → ${d.toFixed(1)}km (기대 ~${expect})`);
}
// 지평선에서 곡률 한계로 잘리는가
const dh = S.elevationToDistanceKm(0.01, 1.5);
ok(dh < 200 && dh > 100, `지평선 발산 방지: h=1.5km → ${dh.toFixed(0)}km (곡률한계 √(2Rh)=${Math.sqrt(2*6371*1.5).toFixed(0)})`);

console.log('\n== 운량 보존 (핵심) ==');
for (const cover of [0, 12, 35, 50, 75, 100]) {
  const s = build(cover, 0, 0);
  const m = S.layerMeanCover(s, 'low');
  const err = Math.abs(m - cover/100);
  ok(err < 0.05, `입력 ${String(cover).padStart(3)}% → 하늘 평균 ${(m*100).toFixed(1)}% (오차 ${(err*100).toFixed(1)}%p)`);
}
// 극단은 완전히 수렴해야 함
const s0 = build(0,0,0), s100 = build(100,0,0);
ok(S.layerMeanCover(s0,'low') < 0.03, `0% 입력 → ${(S.layerMeanCover(s0,'low')*100).toFixed(1)}% (완전히 맑음)`);
ok(S.layerMeanCover(s100,'low') > 0.97, `100% 입력 → ${(S.layerMeanCover(s100,'low')*100).toFixed(1)}% (빈틈 없음)`);

console.log('\n== 천정 커버리지 (이전 구현이 실패하던 지점) ==');
const s8 = build(100, 0, 0);
const hi = s8.filter(x=>x.layer==='low' && x.elevationDeg > 45);
const hiMean = hi.reduce((a,b)=>a+b.cover,0)/hi.length;
ok(hi.length > 0, `고도각 45° 이상 샘플 ${hi.length}개 존재`);
ok(hiMean > 0.95, `8/8일 때 천정 부근 평균 운량 ${(hiMean*100).toFixed(1)}%`);
// 고도각 13° 위쪽 샘플 비율 = 하늘의 77.6%를 담당해야
const above13 = s8.filter(x=>x.layer==='low' && x.elevationDeg>13).length;
const tot = s8.filter(x=>x.layer==='low').length;
ok(Math.abs(above13/tot - 0.776) < 0.06, `13° 위쪽 샘플 비율 ${(above13/tot*100).toFixed(1)}% (입체각 77.6%와 일치)`);

console.log('\n== 층 독립성 ==');
const sL = build(90, 0, 0);
ok(S.layerMeanCover(sL,'low')>0.85 && S.layerMeanCover(sL,'mid')<0.03 && S.layerMeanCover(sL,'high')<0.03,
   `저층만 90% → low ${(S.layerMeanCover(sL,'low')*100).toFixed(0)}% mid ${(S.layerMeanCover(sL,'mid')*100).toFixed(0)}% high ${(S.layerMeanCover(sL,'high')*100).toFixed(0)}%`);

console.log('\n== 팬 밖 신뢰도 감쇠 ==');
const fan = new S.WeatherFan(makeFan(60,0,0), 270);
for (const [az, expectConf] of [[270,1],[280,1],[290,1],[300,'<1'],[90,0]]) {
  const r = fan.sample(az, 30);
  const c = r.confidence;
  if (expectConf === 1) ok(c > 0.99, `방위 ${az}° (팬 안) 신뢰도 ${c.toFixed(2)}`);
  else if (expectConf === 0) ok(c < 0.01, `방위 ${az}° (정반대) 신뢰도 ${c.toFixed(2)}`);
  else ok(c > 0 && c < 1, `방위 ${az}° (팬 밖) 신뢰도 ${c.toFixed(2)}`);
}

console.log('\n== DNI → 광학두께 역산 ==');
for (const alt of [30, 50]) {
  const clear = A.clearSkyDNI(alt);
  ok(clear > 600 && clear < 1050, `맑은 하늘 DNI(${alt}°) = ${clear.toFixed(0)} W/m²`);
  // 왕복: tau 로 만든 T 가 입력 DNI 비율과 맞는가
  for (const frac of [0.9, 0.5, 0.2, 0.02]) {
    const r = A.cloudTauFromDNI(clear*frac, alt);
    const back = Math.exp(-r.tauVert / Math.sin(alt*Math.PI/180));
    ok(!r.saturated, `  DNI ${(frac*100).toFixed(0)}% 는 포화 아님`);
    ok(Math.abs(back - frac)/frac < 0.02, `  DNI ${(frac*100).toFixed(0)}% → τ=${r.tauVert.toFixed(2)} → 복원 ${(back*100).toFixed(1)}%`);
  }
}
ok(A.cloudTauFromDNI(undefined, 30) === null, 'DNI 없으면 null (도감 폴백)');
ok(A.cloudTauFromDNI(500, 2) === null, '태양 2°면 null (잡음 지배)');
const tClear = A.cloudTauFromDNI(A.clearSkyDNI(40), 40);
ok(tClear.tauVert === 0 && !tClear.saturated, `완전 맑음 → τ=${tClear.tauVert}`);
// 두꺼운 구름은 DNI로 분해되지 않습니다 — 포화 플래그로 알려야 합니다.
const tThick = A.cloudTauFromDNI(A.clearSkyDNI(45)*1e-6, 45);
ok(tThick.saturated, `난층운급 차폐 → saturated=${tThick.saturated} (도감 τ로 폴백)`);
const tThin = A.cloudTauFromDNI(A.clearSkyDNI(45)*0.35, 45);
ok(!tThin.saturated, `엷은 구름 → saturated=${tThin.saturated} (관측 신뢰)`);

console.log(`\n총 ${pass+fail}개 중 통과 ${pass}, 실패 ${fail}`);
process.exit(fail?1:0);
