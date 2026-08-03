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


// ── 수직 광학 스택 (6단계) ────────────────────────────────────────────────
console.log('\n== 층 합성 (adding) ==');
{
  const rt = S.cloudRT;
  const l1 = rt(20), l2 = rt(50);
  const c = S.addLayers(l1.R, l1.T, l2.R, l2.T);
  ok(c.T > l1.T * l2.T, `합성 T=${c.T.toFixed(3)} > 단순곱 ${(l1.T*l2.T).toFixed(3)} (층간 다중반사)`);
  ok(c.T < Math.min(l1.T, l2.T), `합성 T < 얇은 쪽 ${Math.min(l1.T,l2.T).toFixed(3)}`);
  ok(c.R > Math.max(l1.R, l2.R), `합성 R=${c.R.toFixed(3)} > 각 층 최대 ${Math.max(l1.R,l2.R).toFixed(3)}`);
  const none = S.addLayers(0, 1, rt(30).R, rt(30).T);
  ok(Math.abs(none.T - rt(30).T) < 1e-9, '맑은 층과 합성하면 원래 값 그대로');
}

console.log('\n== 태양 방향 기둥 ==');
{
  const tauOf = L => (L === 'low' ? 110 : L === 'mid' ? 30 : 5);
  const mk = (l, m, h) => S.buildSkyColumns({
    fan: new S.WeatherFan(makeFan(l, m, h), 270),
    driftMinutes: 0, windSpeedKmh: 20, windBearingDeg: 260,
  });

  const clear = S.solveColumnOptics(mk(0,0,0), 270, 45, tauOf);
  ok(clear.sunTransmittance > 0.98, `맑음 → 태양 투과 ${(clear.sunTransmittance*100).toFixed(1)}%`);
  ok(clear.beamFactor.low > 0.98, `맑음 → 저층 평행광 ${(clear.beamFactor.low*100).toFixed(1)}%`);

  const ovc = S.solveColumnOptics(mk(100,90,70), 270, 45, tauOf);
  ok(ovc.sunTransmittance < 0.01, `8/8 → 태양 투과 ${(ovc.sunTransmittance*100).toFixed(3)}% (원반 소멸)`);
  ok(ovc.beamFactor.low < 0.1, `8/8 → 저층 평행광 ${(ovc.beamFactor.low*100).toFixed(1)}% (명암 대비 소멸)`);
  // 평행광이 죽어도 확산광은 남아야 합니다 — 흐린 날은 캄캄하지 않습니다.
  ok(ovc.diffuseToGround > 0.03, `8/8 → 지상 확산광 ${(ovc.diffuseToGround*100).toFixed(1)}% (새까맣지 않음)`);
  ok(ovc.diffuseFactor.low > ovc.beamFactor.low,
     `확산 ${(ovc.diffuseFactor.low*100).toFixed(0)}% > 평행 ${(ovc.beamFactor.low*100).toFixed(0)}% (2-stream T ≠ Beer-Lambert)`);

  // 상층만 덮여도 저층 평행광이 줄어야 합니다 (핵심 인과)
  const highOnly = S.solveColumnOptics(mk(0,90,70), 270, 45, tauOf);
  ok(highOnly.beamFactor.low < 0.35,
     `상층만 덮임 → 저층 평행광 ${(highOnly.beamFactor.low*100).toFixed(0)}% (위층이 아래를 그늘지게 함)`);
  ok(highOnly.beamFactor.high === 1, '최상층은 항상 직달광 100%');

  // 태양이 낮으면 경사 경로가 길어져 더 많이 막힙니다
  const lowSun = S.solveColumnOptics(mk(60,0,0), 270, 8, tauOf);
  const highSun = S.solveColumnOptics(mk(60,0,0), 270, 60, tauOf);
  ok(lowSun.sunTransmittance <= highSun.sunTransmittance,
     `태양 8° 투과 ${(lowSun.sunTransmittance*100).toFixed(1)}% ≤ 60° ${(highSun.sunTransmittance*100).toFixed(1)}% (경사 경로)`);

  // 단조성: 운량이 늘수록 투과가 준다
  let mono = true, prev = 2;
  for (const c of [0, 25, 50, 75, 100]) {
    const t = S.solveColumnOptics(mk(c,0,0), 270, 45, tauOf).sunTransmittance;
    if (t > prev + 1e-6) mono = false;
    prev = t;
  }
  ok(mono, '운량 증가 → 태양 투과 단조 감소');
}

console.log('\n== 구름 아래 하늘빛 감광 ==');
{
  const sunset = { r: 10.65, g: 4.90, b: 1.53 };  // 태양 5° 지평선 노을
  const clear = A.applyCloudDimming(sunset, 1.0);
  ok(Math.abs(clear.r - sunset.r) < 1e-9, '맑으면 그대로 통과');

  const under = A.applyCloudDimming(sunset, 0.05);
  const rbBefore = sunset.r / sunset.b, rbAfter = under.r / under.b;
  ok(rbAfter < rbBefore * 0.35, `8/8 아래 R/B ${rbBefore.toFixed(1)} → ${rbAfter.toFixed(2)} (탈색)`);
  ok(under.r < sunset.r * 0.4, `밝기도 감소 (${sunset.r.toFixed(1)} → ${under.r.toFixed(2)})`);
  // 단조성
  let m2 = true, p2 = 1e9;
  for (const d of [1, 0.75, 0.5, 0.25, 0]) {
    const v = A.applyCloudDimming(sunset, d).r;
    if (v > p2 + 1e-9) m2 = false;
    p2 = v;
  }
  ok(m2, '확산 투과율이 낮을수록 단조 감소');
}

console.log('\n== 22° 무리 조건 ==');
{
  const h = S.haloStrength;
  ok(h(0.45, 0, 0, 45) > 0.5, `얇은 권층운 45% → ${h(0.45,0,0,45).toFixed(2)} (보임)`);
  ok(h(0.0, 0, 0, 45) < 0.01, `상층 없음 → ${h(0,0,0,45).toFixed(2)} (얼음 결정 없음)`);
  ok(h(1.0, 0, 0, 45) < 0.15, `상층 100% → ${h(1,0,0,45).toFixed(2)} (너무 두꺼워 다중산란)`);
  ok(h(0.45, 0.9, 0, 45) < 0.05, `저층이 가림 → ${h(0.45,0.9,0,45).toFixed(2)}`);
  ok(h(0.45, 0, 0.9, 45) < 0.05, `중층이 가림 → ${h(0.45,0,0.9,45).toFixed(2)}`);
  ok(h(0.45, 0, 0, 3) < 0.05, `태양 3° → ${h(0.45,0,0,3).toFixed(2)} (고리 아래가 잘림)`);
  ok(h(0.45, 0, 0, 45) > h(0.45, 0, 0, 12), '태양이 높을수록 잘 보임');
  let inRange = true;
  for (let hi=0; hi<=1; hi+=0.05) for (let lo=0; lo<=1; lo+=0.25)
    { const v=h(hi,lo,0,40); if (v<0||v>1||!isFinite(v)) inRange=false; }
  ok(inRange, '전 구간에서 0~1 범위 유지');
}

console.log(`\n[6~7단계 포함] 총 ${pass+fail}개 중 통과 ${pass}, 실패 ${fail}`);
process.exit(fail ? 1 : 0);
