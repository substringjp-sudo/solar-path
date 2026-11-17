/**
 * 천체 카메라 UI 계산 · 흔들림 경보 · 야간 암적응 팔레트 · 노출 비례 시뮬 스케일 검증 (2026-11-17).
 *
 * 사용:
 *   node tools/shader-preview/stage-esm.js
 *   node tools/shader-preview/verify-astro-camera-ui.js
 */
const fs = require('fs');
const path = require('path');
const { PREVIEW } = require('./paths');

let pass = 0;
let fail = 0;
const ok = (cond, label) => {
  if (cond) {
    pass++;
    console.log('  PASS: ' + label);
  } else {
    fail++;
    console.log('  FAIL: ' + label);
  }
};

function parseHexRgb(hex) {
  const clean = hex.replace('#', '');
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16),
  };
}

(async () => {
  const UI = await import('file://' + path.join(PREVIEW, 'app/utils/astroCameraUi.js'));

  console.log('\n[1] 노출시간 · ISO 비례 3D 장노출 시뮬레이션 게인/별 증폭 증가 확인');
  {
    const s1 = UI.computeAstroSimExposureParams(60, 1600);
    const s4 = UI.computeAstroSimExposureParams(240, 1600);
    const s10 = UI.computeAstroSimExposureParams(600, 1600);
    const s10HiIso = UI.computeAstroSimExposureParams(600, 3200);
    ok(
      s1.exposureGain < s4.exposureGain && s4.exposureGain < s10.exposureGain,
      `노출시간 증가 시 시뮬 gain 증가 (${s1.exposureGain} < ${s4.exposureGain} < ${s10.exposureGain})`,
    );
    ok(
      s1.starBoost < s4.starBoost && s4.starBoost < s10.starBoost,
      `노출시간 증가 시 별 증폭 증가 (${s1.starBoost} < ${s4.starBoost} < ${s10.starBoost})`,
    );
    ok(
      s10HiIso.exposureGain > s10.exposureGain && s10HiIso.starBoost > s10.starBoost,
      `ISO 상승(1600→3200) 시 시뮬 밝기/별 증폭 추가 반영 (${s10.exposureGain}→${s10HiIso.exposureGain})`,
    );
  }

  console.log('\n[2] 기기 한계 및 천체 지향(NPF) 서브셔터 · 프레임 수 계산');
  {
    const defaults = UI.createDefaultAstroSettings();
    const caps = {
      available: true,
      cameraId: '0',
      hardwareLevel: 3,
      rawSupported: true,
      manualSensorSupported: true,
      minExposureMs: 100,
      maxExposureMs: 12000,
      minIso: 100,
      maxIso: 3200,
      focalLengthMm: 5.5,
      focal35mm: 24,
      hfovDeg: 68,
      sensorOrientation: 90,
      supportsFocusDistance: true,
      rawWidth: 4000,
      rawHeight: 3000,
      yuvWidth: 2560,
      yuvHeight: 1920,
    };

    const sumEq = UI.planAstroShotSummary({
      settings: { ...defaults, durationSec: 300, iso: 6400 },
      caps,
      latitudeDeg: 37.5,
      azDeg: 180,
      elDeg: 40,
    });
    const sumPole = UI.planAstroShotSummary({
      settings: { ...defaults, durationSec: 300, iso: 1600 },
      caps,
      latitudeDeg: 37.5,
      azDeg: 0,
      elDeg: 38,
    });

    ok(sumEq.clampedIso === 3200, `요청 ISO 6400 → 기기 최대(3200) 클램프 (${sumEq.clampedIso})`);
    ok(sumEq.subExposureSecUsed <= 12 && sumPole.subExposureSecUsed > sumEq.subExposureSecUsed,
       `북극 방향(${sumPole.subExposureSecUsed}s) > 남쪽 적도 방향(${sumEq.subExposureSecUsed}s) NPF 서브셔터 허용`);
    ok(sumEq.totalFrames === Math.round(300 / sumEq.subExposureSecUsed),
       `5분 노출 분할 장수 계산 (${sumEq.subExposureSecUsed}s × ${sumEq.totalFrames}장)`);
    ok(sumEq.rawActive === true, 'RAW 지원 기기에서 RAW 16bit 활성화');
  }

  console.log('\n[3] 촬영 중 흔들림(자이로·자세 이동·별 정합 오차) 경고 분류 & 별 미검출 오경보 방지');
  {
    const calm = UI.assessCaptureShake({
      frameIndex: 3,
      gyroPeakDegPerSec: 0.9,
      attitudeDeltaDeg: 0.12,
      alignmentErrorPx: 0.7,
      matchedStars: 10,
      qualityReason: 'ok',
    });
    const lowStarNoFalseAlarm = UI.assessCaptureShake({
      frameIndex: 4,
      gyroPeakDegPerSec: 0.2,
      attitudeDeltaDeg: 0.05,
      alignmentErrorPx: 12.0,
      matchedStars: 0,
      qualityReason: 'too_few_stars',
    });
    const mild = UI.assessCaptureShake({
      frameIndex: 5,
      gyroPeakDegPerSec: 1.5,
      attitudeDeltaDeg: 0.1,
      alignmentErrorPx: 1.4,
      matchedStars: 8,
      qualityReason: 'ok',
    });
    const severeBump = UI.assessCaptureShake({
      frameIndex: 6,
      gyroPeakDegPerSec: 3.1,
      attitudeDeltaDeg: 0.2,
      alignmentErrorPx: 2.0,
      matchedStars: 8,
      qualityReason: 'ok',
    });
    const severeShift = UI.assessCaptureShake({
      frameIndex: 7,
      gyroPeakDegPerSec: 0.2,
      attitudeDeltaDeg: 1.0,
      alignmentErrorPx: 1.0,
      matchedStars: 8,
      qualityReason: 'ok',
    });
    const severeStarErr = UI.assessCaptureShake({
      frameIndex: 8,
      gyroPeakDegPerSec: 0.1,
      attitudeDeltaDeg: 0.05,
      alignmentErrorPx: 5.4,
      matchedStars: 6,
      qualityReason: 'excess_drift',
    });

    ok(calm.severity === 'none' && calm.reason === 'ok', '삼각대 정지 노이즈(0.9°/s, 0.12°) 오경보 없음');
    ok(lowStarNoFalseAlarm.severity === 'none', '별 미검출(matchedStars=0) 시 기본 검색반경(12px) 오경보 차단');
    ok(mild.severity === 'mild' && mild.reason === 'vibration', '바람 진동(1.5°/s) 주의 경보 분류');
    ok(severeBump.severity === 'severe' && severeBump.reason === 'vibration', '큰 충격(3.1°/s) 중대 흔들림 경고');
    ok(severeShift.severity === 'severe' && severeShift.reason === 'tripod_shift', '서브프레임 중 큰 자세 이동(1.0°) 경고');
    ok(severeStarErr.severity === 'severe' && severeStarErr.reason === 'excess_motion', '별 정합 오차(5.4px, 6별 매칭) 과이동 경고');
  }

  console.log('\n[3b] 목표 방향 구면 각거리 · 히스테리시스 진동 가이드 검증');
  {
    const target = { azDeg: 180, elDeg: 30 };
    const far = UI.evaluateDirectionGuide({
      currentAzDeg: 160,
      currentElDeg: 20,
      target,
      wasOnTarget: false,
    });
    const near = UI.evaluateDirectionGuide({
      currentAzDeg: 174,
      currentElDeg: 28,
      target,
      wasOnTarget: false,
    });
    const locked = UI.evaluateDirectionGuide({
      currentAzDeg: 178.5,
      currentElDeg: 29,
      target,
      wasOnTarget: false,
    });
    const hystKeep = UI.evaluateDirectionGuide({
      currentAzDeg: 176.8,
      currentElDeg: 29.5,
      target,
      wasOnTarget: true,
    });
    const zenithErr = UI.sphericalAngularDistanceDeg(10, 85, 190, 85);

    ok(!far.onTarget && far.pulseMs > near.pulseMs && far.intervalMs < near.intervalMs,
       `원거리(${far.errorDeg}°→${far.pulseMs}ms/${far.intervalMs}ms)가 근접(${near.errorDeg}°→${near.pulseMs}ms/${near.intervalMs}ms)보다 빠른 진동`);
    ok(locked.onTarget && locked.pulseMs === 0 && locked.intervalMs === 0,
       `허용 오차 이내(${locked.errorDeg}° ≤ 2.5°) 진입 시 진동 완전 정지`);
    ok(hystKeep.onTarget && hystKeep.pulseMs === 0,
       `경계 히스테리시스(${hystKeep.errorDeg}° ≤ 3.5°)로 미세 떨림 재진동 방지`);
    ok(zenithErr < 10.5, `고고도 천정(el=85°) 180° 방위 반전도 실제 구면각(10°, 계측 ${zenithErr}°)으로 계산`);
  }

  console.log('\n[4] 야간 촬영 화면 순수 검정/적색 암적응 팔레트 & 카운트다운 포맷');
  {
    ok(UI.ASTRO_NIGHT_PALETTE.bg === '#000000', '야간 촬영 배경은 순수 OLED 검정(#000000)');
    const paletteEntries = Object.entries(UI.ASTRO_NIGHT_PALETTE);
    const allPureRedOrBlack = paletteEntries.every(([, hex]) => {
      const { r, g, b } = parseHexRgb(hex);
      return r >= g && r >= b && g <= 32 && b <= 32;
    });
    ok(allPureRedOrBlack, '야간 촬영 UI 모든 색상이 G/B 방출 억제된 순수 적색·검정 계열');
    ok(UI.formatCountdownMMSS(299.1) === '05:00' && UI.formatCountdownMMSS(0) === '00:00', 'MM:SS 카운트다운 포맷 정확성');

    const repoRoot = path.resolve(__dirname, '../..');
    const ktMod = fs.readFileSync(
      path.join(repoRoot, 'modules/astro-camera/android/src/main/java/com/pplaner/astrocamera/AstroCameraModule.kt'),
      'utf8',
    );
    const ktAcc = fs.readFileSync(
      path.join(repoRoot, 'modules/astro-camera/android/src/main/java/com/pplaner/astrocamera/AstroStackAccumulator.kt'),
      'utf8',
    );
    ok(ktMod.includes('renderStackPreviewAsync') && ktAcc.includes('monochromeRed'),
       '네이티브 모듈에 비파괴 중간 미리보기(적색 암적응 지원) 포함');
  }

  console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
  process.exit(fail > 0 ? 1 : 0);
})();
