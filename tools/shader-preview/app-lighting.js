/**
 * **하네스가 지형 셰이더에 넣을 조명 한 벌을 앱에서 가져옵니다.**
 *
 * ## 왜 필요한가 — 손으로 적은 조도가 세 번 판정을 망쳤습니다
 *
 * - `build-relief.js` 는 처음에 "하늘 0.11 · 직달 2.4" 를 어림으로 적었습니다.
 *   앱의 실제 값은 하늘 1.03 · 직달 0.66 — **하늘이 직달보다 큽니다.** 하늘을
 *   열 배 작게 잡은 탓에 표시의 최소 밝기 바닥이 신호를 통째로 삼켰고, 무엇을
 *   껐다 켜도 σ 가 안 움직이는 자가 됐습니다.
 * - `build-tessellation.js` 는 "물리 비율" 을 7.56 으로 박아 뒀습니다. 그 값이
 *   앱에 들어간 뒤로는 그것이 옛 값이 되어 판정이 거꾸로 뒤집혔습니다.
 * - `build-cloud-ground.js` 도 같은 어림값(0.11 / 2.4)을 쓰고 있었습니다.
 *
 * 공통 원인은 하나입니다 — **하네스가 조명을 스스로 지어냈습니다.** 앱이 쓰는
 * 것과 다르면, 재고 있는 것은 앱이 아니라 하네스입니다.
 *
 * 여기서는 앱과 **같은 코드**를 부릅니다: 하늘 평균은 `SkyScene3D` 와 같은
 * 코사인 가중 적분(고도 4곳 × 방위 6곳), 직달은 `beamAtAltitude`, 그리고 그
 * 둘을 `groundLighting` 에 넘겨 수평면 조도 · 직달 복사휘도 · 노출 보정을
 * 받습니다.
 *
 * ⚠ `/tmp/skybuild` 산출물이 있어야 합니다 — `stage-node.js` 가 만듭니다.
 */
const ATM = require('/tmp/skybuild/atmosphere.js');

/** 기본 대기 — 맑은 여름 한낮의 서울 언저리. */
const DEFAULT_ATMOS = {
  observerElevM: 0,
  latitude: 37.5,
  betaMie: 0.08,
  angstrom: 1.3,
  dayOfYear: 200,
  ozoneDU: 330,
  elevScale: 1.0,
};

const D2R = Math.PI / 180;

/** 두 방향 사이의 각거리 (도). */
function separationDeg(az1, el1, az2, el2) {
  const c = Math.sin(el1 * D2R) * Math.sin(el2 * D2R)
          + Math.cos(el1 * D2R) * Math.cos(el2 * D2R) * Math.cos((az1 - az2) * D2R);
  return Math.acos(Math.max(-1, Math.min(1, c))) / D2R;
}

/**
 * 수평면이 받는 하늘 조도 / π.
 *
 * ⚠ **코사인 가중이 핵심입니다** — 수평면이 받는 조도는 ∫L·cosθ dΩ 이라
 * 천정 쪽이 크게, 지평선 쪽이 작게 기여합니다. 균등 평균으로 내면 지평선의
 * 노을빛을 과대 반영해 지면이 실제보다 따뜻해집니다. `SkyScene3D` 가 쓰는
 * 표본(고도 10·30·50·75 × 방위 6곳)을 그대로 씁니다.
 */
function skyMeanRGB(sunAltDeg, sunAzDeg, atmos) {
  let sr = 0, sg = 0, sb = 0, sw = 0;
  for (const elev of [10, 30, 50, 75]) {
    const w = Math.sin(elev * D2R);
    for (let a = 0; a < 6; a++) {
      const az = (a * 360) / 6;
      const gamma = separationDeg(az, elev, sunAzDeg, sunAltDeg);
      const L = ATM.skyRadiance(elev, gamma, sunAltDeg, atmos);
      sr += L.r * w; sg += L.g * w; sb += L.b * w; sw += w;
    }
  }
  return { r: sr / sw, g: sg / sw, b: sb / sw };
}

/**
 * 앱이 지형 셰이더에 넣는 조명 한 벌.
 *
 * @returns {{surfaceIrr:number[], sunRadiance:number[], exposure:number,
 *            skyMean:{r:number,g:number,b:number}, beam:{r:number,g:number,b:number},
 *            old:{surfaceIrr:number[], sunRadiance:number[], exposure:number}}}
 *   `old` 는 **직달 눈금만 1 로 되돌린 대조군**입니다 — 두 벌의 차이가
 *   `SOLAR_BEAM_SCALE` 하나뿐이라, A/B 로 그 상수의 몫만 떼어 볼 수 있습니다.
 */
function appLighting(sunAltDeg, sunAzDeg = 180, opts = {}) {
  const atmos = { ...DEFAULT_ATMOS, ...(opts.atmos || {}) };
  const sunT = opts.sunTransmittance == null ? 1 : opts.sunTransmittance;
  const skyMean = skyMeanRGB(sunAltDeg, sunAzDeg, atmos);
  const beam = ATM.beamAtAltitude(sunAltDeg, 0, atmos);
  const lit = ATM.groundLighting(sunAltDeg, skyMean, beam, sunT);

  const direct = (Math.max(0, Math.sin(sunAltDeg * D2R)) * sunT) / Math.PI;
  return {
    surfaceIrr: [lit.surfaceIrr.r, lit.surfaceIrr.g, lit.surfaceIrr.b],
    sunRadiance: [lit.sunRadiance.r, lit.sunRadiance.g, lit.sunRadiance.b],
    exposure: lit.exposure,
    skyMean,
    beam,
    old: {
      surfaceIrr: [skyMean.r + beam.r * direct, skyMean.g + beam.g * direct,
                   skyMean.b + beam.b * direct],
      sunRadiance: [beam.r * sunT, beam.g * sunT, beam.b * sunT],
      exposure: 1,
    },
  };
}

module.exports = { appLighting, skyMeanRGB, DEFAULT_ATMOS };
