/**
 * 상층 권운(ci) 유체역학 · 베일 연속 전이 검증 (`cloudFlow` + `cloudGenus` + `liveScene`).
 * 사용: node tools/shader-preview/verify-cirrus-veil.js
 *
 * 검사 항목:
 *  [1] cirrusVeilKnobs 연속성 (저운량 가닥 ↔ 고운량/습윤/약시어/약DNI 얇은 베일 ↔ cs 승격)
 *  [2] buildLiveScene 배선 (QR 사례 high 89%·DNI 411 및 상층 bruntN 실측 적용)
 *  [3] 2D 날씨 텍스처(makeGenusWeather): 저층 바람 독립성 · 상층 시어/바람 방향성 · 유효 피복률 · 주기 이음새 · 결정론
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

function makeTempProfile(tempHighC = -42, rhHighPct = 55) {
  // PROFILE_LEVELS = [1000, 975, 950, 925, 900, 850, 800, 750, 700, 600, 500, 400, 300, 250, 200]
  const h = [110, 320, 540, 760, 990, 1460, 1950, 2470, 3010, 4200, 5570, 7180, 9160, 10360, 11780];
  const t = [15, 13.5, 12, 10.5, 9, 6, 3, 0, -3.5, -11, -21, tempHighC + 10, tempHighC, tempHighC - 6, tempHighC - 11];
  // THERMO_RH_LEVELS = [1000, 975, 950, 925, 900, 850, 800, 750, 700, 600, 500, 400, 300]
  const rh = [50, 50, 48, 46, 45, 42, 40, 35, 30, 28, 35, rhHighPct - 8, rhHighPct];
  return { profileHeightM: h, profileTempC: t, profileRhPct: rh };
}

(async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cirrus-veil-'));
  const entry = path.join(outDir, 'entry.ts');
  const bundle = path.join(outDir, 'bundle.mjs');
  fs.writeFileSync(entry, `
    export * from ${JSON.stringify(path.join(ROOT, 'src/components/VolumetricProbe/cloudFlow.ts'))};
    export * from ${JSON.stringify(path.join(ROOT, 'src/components/VolumetricProbe/cloudGenus.ts'))};
    export * from ${JSON.stringify(path.join(ROOT, 'src/components/VolumetricProbe/liveScene.ts'))};
  `);
  execFileSync('npx', ['esbuild', entry, '--bundle', '--format=esm', '--platform=node', `--outfile=${bundle}`, '--log-level=warning'], { cwd: ROOT, stdio: 'inherit' });
  const M = await import('file://' + bundle);

  console.log('\n[1] cirrusVeilKnobs 연속성 · 기상 민감도');
  const lowKnobs = M.cirrusVeilKnobs({ highPct: 30, midPct: 0, lowPct: 0, shearU: 30, shearV: 10, tauDni: 0 });
  ok(lowKnobs.flowVeil === 0 && lowKnobs.flowLaminar === 1, `소운량 30% → flowVeil=${lowKnobs.flowVeil}, flowLaminar=${lowKnobs.flowLaminar}`);
  ok(lowKnobs.flowDPow === 1.6 && lowKnobs.densityScale === 0.003, `소운량 30% → flowDPow=${lowKnobs.flowDPow}, ds=${lowKnobs.densityScale}`);

  const qrKnobs = M.cirrusVeilKnobs({ highPct: 89, midPct: 0, lowPct: 19, shearU: 12, shearV: 4, rhLevels: [{ zM: 9000, rhPct: 68 }], tauDni: 0.17 });
  ok(qrKnobs.flowVeil >= 0.7 && qrKnobs.flowVeil <= 0.9, `QR 89% 베일 → flowVeil=${qrKnobs.flowVeil}`);
  ok(qrKnobs.flowMode === 1 && qrKnobs.flowTop >= 2.0 && qrKnobs.flowDPow <= 1.1, `QR 단면·분포 → mode=${qrKnobs.flowMode}, top=${qrKnobs.flowTop}, dPow=${qrKnobs.flowDPow}`);
  ok(qrKnobs.densityScale > 0.004 && qrKnobs.densityScale < 0.02, `QR 소광 → ds=${qrKnobs.densityScale}`);

  const dryHigh = M.cirrusVeilKnobs({ highPct: 50, rhLevels: [{ zM: 9000, rhPct: 30 }], tauDni: 0 });
  const moistHigh = M.cirrusVeilKnobs({ highPct: 50, rhLevels: [{ zM: 9000, rhPct: 82 }], tauDni: 0 });
  ok(moistHigh.flowVeil > dryHigh.flowVeil, `상층 습도 30%→82% 시 베일 증가 (${dryHigh.flowVeil} → ${moistHigh.flowVeil})`);

  const calmShear = M.cirrusVeilKnobs({ highPct: 70, shearU: 8, shearV: 0, tauDni: 0 });
  const strongShear = M.cirrusVeilKnobs({ highPct: 70, shearU: 58, shearV: 0, tauDni: 0 });
  ok(strongShear.flowVeil < calmShear.flowVeil, `강한 전단(16 m/s)에서 가닥 보존(베일 감소: ${calmShear.flowVeil} → ${strongShear.flowVeil})`);

  const weakTau = M.cirrusVeilKnobs({ highPct: 89, tauDni: 0.2 });
  const midTau = M.cirrusVeilKnobs({ highPct: 89, tauDni: 0.9 });
  ok(midTau.densityScale > weakTau.densityScale && midTau.flowVeil >= weakTau.flowVeil,
    `약한 DNI τ(0.2→0.9)에서 연속 밀도 증가 (${weakTau.densityScale} → ${midTau.densityScale})`);

  console.log('\n[2] buildLiveScene 통합 (QR 실제 조건 + 상층 안정도 N)');
  const date = new Date('2026-11-16T05:41:27.729Z');
  const prof = makeTempProfile(-38, 65);
  const hourly = {
    timeMs: [date.getTime() - 3600000, date.getTime(), date.getTime() + 3600000],
    windULow: [15, 15, 15], windVLow: [-5, -5, -5],
    windUMid: [30, 32, 34], windVMid: [5, 6, 7],
    windUHigh: [50, 52, 54], windVHigh: [12, 13, 14],
  };
  const baseObs = {
    low: 19, mid: 0, high: 89, total: 88, precipitation: 0, humidity: 48, directNormalIrradiance: 411,
    t2mC: 16, td2mC: 5, ...prof,
  };
  const sceneQr = M.buildLiveScene({
    lat: 34.8155, lon: 137.2331, heightM: 4, date, obs: baseObs, hourly,
    camera: { azimuthDeg: 219.4, elevationDeg: 15.2 },
  });
  const hiLayer = sceneQr.input.layers[2];
  ok(hiLayer?.genus === 'ci', `QR 상층 종류 = ${hiLayer?.genus}`);
  ok(hiLayer?.opts?.flowLaminar === 1 && (hiLayer?.opts?.flowVeil ?? 0) >= 0.7 && (hiLayer?.opts?.flowVeil ?? 1) <= 0.9,
    `QR 상층 opts: laminar=${hiLayer?.opts?.flowLaminar}, veil=${hiLayer?.opts?.flowVeil}, dPow=${hiLayer?.opts?.flowDPow}, ds=${hiLayer?.opts?.densityScale}`);
  ok(hiLayer?.opts?.flowN != null && hiLayer.opts.flowN !== 0.012,
    `hasDayWind 여도 상층 실측 bruntN 반영 (flowN=${hiLayer?.opts?.flowN})`);

  const sceneCs = M.buildLiveScene({
    lat: 34.8155, lon: 137.2331, heightM: 4, date,
    obs: { ...baseObs, directNormalIrradiance: 60 }, hourly,
    camera: { azimuthDeg: 219.4, elevationDeg: 15.2 },
  });
  ok(sceneCs.input.layers[2]?.genus === 'cs', `τ >= 1.5 시 cs 승격 (${sceneCs.input.layers[2]?.genus})`);

  console.log('\n[3] 2D 날씨 텍스처(makeGenusWeather) 유체 물성 · 이방성 · 이음새');
  const S = 128, tileKm = 24;
  const statsOf = (u8, ch = 0) => {
    let nz = 0, sum = 0, sum2 = 0, domeSurvive = 0;
    const vals = [];
    for (let i = 0; i < S * S; i++) {
      const d = u8[i * 4 + ch] / 255;
      if (d > 0) {
        nz++; sum += d; sum2 += d * d; vals.push(d);
        if (d > 0.226) domeSurvive++;
      }
    }
    vals.sort((a, b) => a - b);
    const mean = nz ? sum / nz : 0;
    const std = nz ? Math.sqrt(Math.max(0, sum2 / nz - mean * mean)) : 0;
    const med = nz ? vals[Math.floor(vals.length * 0.5)] : 0;
    let gx = 0, gy = 0, seamX = 0, seamY = 0;
    for (let y = 0; y < S; y++) {
      seamX += Math.abs(u8[(y * S + 0) * 4 + ch] - u8[(y * S + (S - 1)) * 4 + ch]);
      for (let x = 0; x < S; x++) {
        const c = u8[(y * S + x) * 4 + ch] / 255;
        const rx = u8[(y * S + ((x + 1) % S)) * 4 + ch] / 255;
        const ry = u8[(((y + 1) % S) * S + x) * 4 + ch] / 255;
        gx += Math.abs(rx - c); gy += Math.abs(ry - c);
      }
    }
    for (let x = 0; x < S; x++) {
      seamY += Math.abs(u8[(0 * S + x) * 4 + ch] - u8[((S - 1) * S + x) * 4 + ch]);
    }
    const meanDx255 = (gx * 255) / (S * S);
    const meanDy255 = (gy * 255) / (S * S);
    return {
      area: nz / (S * S),
      domeArea: domeSurvive / (S * S),
      mean, std, med,
      anisoRatio: gx / Math.max(1e-6, gy),
      seamX: seamX / S, intX: meanDx255,
      seamY: seamY / S, intY: meanDy255,
    };
  };

  // (a) 상층 바람/전단 회전 시 (저층 flowCoreWind 고정해도) 권운 무늬가 90° 회전
  const ciN = M.mergeFlowOpts({
    genus: 'ci', cover: 0.35,
    opts: { windU: 0, windV: 85, shearU: 0, shearV: 55, flowN: 0.012, shearDzKm: 4, flowVeil: 0, flowDPow: 1.6, flowCoreWindU: 0, flowCoreWindV: 20, flowSeed: 101 },
  });
  const ciE = M.mergeFlowOpts({
    genus: 'ci', cover: 0.35,
    opts: { windU: 85, windV: 0, shearU: 55, shearV: 0, flowN: 0.012, shearDzKm: 4, flowVeil: 0, flowDPow: 1.6, flowCoreWindU: 0, flowCoreWindV: 20, flowSeed: 101 },
  });
  const flowDummy = M.planFlowScene([ciN], { n: 64, steps: 20, hours: 0.5, vrms: 2, psiEvery: 2 });
  const texN = M.makeGenusWeather([ciN], S, tileKm, 7, false, flowDummy);
  const texE = M.makeGenusWeather([ciE], S, tileKm, 7, false, flowDummy);
  const stN = statsOf(texN.image.data), stE = statsOf(texE.image.data);
  const rotFlip = stN.anisoRatio / Math.max(1e-6, stE.anisoRatio);
  ok(Math.abs(stN.area - 0.35) < 0.02, `소운량 35% 면적 보존 (실제 ${(stN.area * 100).toFixed(1)}%)`);
  ok(rotFlip > 1.5 && stN.anisoRatio <= 3.0, `저층 바람 고정 시 상층 90° 회전 → 완만한 깃털 이방성 반전 (×${rotFlip.toFixed(2)}, N:${stN.anisoRatio.toFixed(2)} vs E:${stE.anisoRatio.toFixed(2)})`);

  // (b) QR 고운량 베일 (veil 0.9, dPow 0.9): 구멍·직선 줄무늬 없이 전면적 부드러운 확산 + 내부 결 유지
  const ciVeil = M.mergeFlowOpts({
    genus: 'ci', cover: 0.89,
    opts: { windU: 50, windV: 15, shearU: 20, shearV: 5, flowN: 0.012, shearDzKm: 4, ...qrKnobs, flowSeed: 101 },
  });
  const texVeil = M.makeGenusWeather([ciVeil], S, tileKm, 7, false, flowDummy);
  const stV = statsOf(texVeil.image.data);
  ok(Math.abs(stV.area - 0.89) < 0.02, `QR 89% 면적 보존 (실제 ${(stV.area * 100).toFixed(1)}%)`);
  ok(stV.anisoRatio >= 0.7 && stV.anisoRatio <= 1.6, `QR 베일 2D 확산성(직선 궤적 아님): Gx/Gy=${stV.anisoRatio.toFixed(2)}`);
  ok(stV.med >= 0.45 && stV.std >= 0.12 && stV.std <= 0.35,
    `QR 베일 분포: med=${stV.med.toFixed(3)} (기존 0.25 붕괴 해소), std=${stV.std.toFixed(3)} (평면 단색 아님)`);
  ok(stV.seamX < stV.intX * 2.5 && stV.seamY < stV.intY * 2.5,
    `주기 이음새 연속 (X:${stV.seamX.toFixed(1)}/${stV.intX.toFixed(1)}, Y:${stV.seamY.toFixed(1)}/${stV.intY.toFixed(1)})`);

  // (c) 결정론 & flowVeil 민감도
  const texVeil2 = M.makeGenusWeather([ciVeil], S, tileKm, 7, false, flowDummy);
  ok(Buffer.from(texVeil.image.data).equals(Buffer.from(texVeil2.image.data)), '결정론: 동일 입력 → 바이트 완전 일치');
  const texChangedDs = M.makeGenusWeather([M.mergeFlowOpts({ ...ciVeil, opts: { ...ciVeil.opts, densityScale: 0.012 } })], S, tileKm, 7, false, flowDummy);
  ok(Buffer.from(texVeil.image.data).equals(Buffer.from(texChangedDs.image.data)), 'densityScale 만 변경 → 2D 텍스처 바이트 동일(캐시 유효)');

  texN.dispose(); texE.dispose(); texVeil.dispose(); texVeil2.dispose(); texChangedDs.dispose();
  fs.rmSync(outDir, { recursive: true, force: true });
  console.log(`\npass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})();
