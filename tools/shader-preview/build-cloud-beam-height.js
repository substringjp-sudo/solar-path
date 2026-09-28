/**
 * **구름이 받는 직달은 구름 높이(해면 기준)에서** (§118) — 관측자 고도가 새는가.
 *
 * 층 높이(`setLayerAltitudesKm`)는 예보 기압면의 지오퍼텐셜 높이, 곧 **해면 기준**입니다(셰이더도
 * 관측자 해발 고도와 같은 틀로 교점을 풉니다). 그런데 직달 표(§105·§106)는 광선 적분을
 * `관측 고도 + 층 높이` 에서 했습니다 — 스와(760m)의 1.2km 구름을 1.96km 에서 비춘 셈입니다.
 * 노을에 그 차이가 큽니다(해 0° 에 1.75배, 해 −1° 에 3.2배, 붉은 정도도 옅어짐).
 *
 * 이 페이지는 앱 모듈(`updateCloudSlab`)을 그대로 불러 직달 표(uBeamLUT)와 안개 직달(uFogBeam)을
 * 관측 고도 0 · 545 · 760 · 1600m 에서 읽습니다. 그리지 않고 표만 읽습니다(GPU 무관).
 *
 * 준비: node tools/shader-preview/stage-esm.js
 * 사용: node tools/shader-preview/build-cloud-beam-height.js
 *       node tools/shader-preview/verify-cloud-beam-height.js
 */
const fs = require('fs');
const path = require('path');
const { PREVIEW } = require('./paths');

const html = `<!doctype html><html><head><meta charset="utf-8"></head><body><script type="module">
import * as THREE from './app/vendor/three.module.js';
import * as CS from './app/components/SkyScene3D/CloudSlab.js';
import { makeAtmosphereParams, beamAtAltitude } from './app/utils/atmosphere.js';
import { beamGrazing } from './app/utils/grazingRay.js';
const errors = [];
window.addEventListener('error', e => errors.push(String(e.message)));
try {
  const LAYERS = [1.2, 2.5, 7.5];          // 해면 기준 km (저·중·상)
  const OBS = [0, 545, 760, 1600];        // 관측자 해발 m
  const SUNS = [30, 5, 0, -1];
  const N = CS.BEAM_LUT_N, SPAN = CS.BEAM_LUT_SPAN;
  const atmOf = (obsM) => makeAtmosphereParams({ latitude: 36.0, observerElevM: obsM, dayOfYear: 290, humidityPct: 65, visibilityM: 25000 });
  const cam = new THREE.PerspectiveCamera(60, 1, 0.1, 2000);
  cam.lookAt(0, 0.3, -1); cam.updateMatrixWorld(true);
  const enc = (v) => (v < 2 ** -16 ? 0 : Math.max(1, Math.min(255, Math.round((Math.log2(v) + 16) / 16 * 255))));
  const lum = (b) => 0.2126 * b.r + 0.7152 * b.g + 0.0722 * b.b;

  /** 표 세 줄(0 상층 · 1 중층 · 2 저층)과 안개 직달, 표 이득을 읽습니다. */
  function read(obsM, sunAlt, layers = LAYERS) {
    const atm = atmOf(obsM);
    const slab = CS.createCloudSlab();
    slab.setLayerAltitudesKm(layers[0], layers[1], layers[2]);
    // 관측자가 구름 속이게 — 안개 직달(uFogBeam)을 셈하게 합니다.
    slab.setInCloud({ cover: 0.8, baseKm: obsM / 1000 - 0.2, topKm: obsM / 1000 + 0.2 });
    const a = sunAlt * Math.PI / 180, z = 200 * Math.PI / 180;
    const sunDir = new THREE.Vector3(Math.cos(a) * Math.sin(z), Math.sin(a), -Math.cos(a) * Math.cos(z)).normalize();
    const wd = { speedKmh: 0, bearingDeg: 0 };
    CS.updateCloudSlab(slab, { camera: cam, widthPx: 64, heightPx: 64, sunDir, sunAltDeg: sunAlt, sunAzDeg: 200,
      beamFor: (k) => beamAtAltitude(sunAlt, k, atm), atmosphere: atm,
      layerWinds: { low: wd, mid: wd, high: wd }, driftHours: 0, visible: true });
    const U = slab.material.uniforms;
    const d = U.uBeamLUT.value.image.data;
    const rows = [0, 1, 2].map(r => Array.from(d.slice(r * N * 4, (r + 1) * N * 4)));
    const fog = U.uFogBeam.value;
    const out = { rows, fog: { r: fog.x, g: fog.y, b: fog.z }, gain: U.uBeamLUTGain.value,
      fogOn: U.uFogBeta.value > 0 };
    slab.dispose?.();
    return out;
  }

  const R = { cases: [], effect: [], control: null };
  for (const sun of SUNS) {
    const base = read(0, sun);
    // 기대값 — 층 높이(해면 기준)에서 광선 적분. 표는 이득 없이 투과율을 담습니다.
    const expect = LAYERS.slice().reverse().map(km => {          // 행 0 상층 · 1 중층 · 2 저층
      const row = [];
      for (let i = 0; i < N; i++) {
        const dDeg = -SPAN + (2 * SPAN * i) / (N - 1);
        const b = beamGrazing(sun + dDeg, km, atmOf(0));
        row.push(enc(b.r), enc(b.g), enc(b.b), Math.max(0, Math.min(255, Math.round(b.refrDeg / 2 * 255))));
      }
      return row;
    });
    for (const obsM of OBS) {
      const got = obsM === 0 ? base : read(obsM, sun);
      const atm = atmOf(obsM);
      const b0 = beamAtAltitude(sun, 0, atm);                     // 관측자 자리의 직달
      const fogWant = { r: b0.r * got.gain, g: b0.g * got.gain, b: b0.b * got.gain };
      const rowDiff = got.rows.map((row, r) => Math.max(...row.map((v, i) => Math.abs(v - base.rows[r][i]))));
      const anchorDiff = got.rows.map((row, r) => Math.max(...row.map((v, i) => Math.abs(v - expect[r][i]))));
      const fogRel = lum(fogWant) > 1e-9 ? Math.abs(lum(got.fog) - lum(fogWant)) / lum(fogWant) : Math.abs(lum(got.fog));
      R.cases.push({ sun, obsM, rowDiff, anchorDiff, fogOn: got.fogOn, fogRel: +fogRel.toExponential(2) });
    }
  }
  // 효과 크기 — 예전 셈(관측 고도 + 층 높이) 대 층 높이. 참고용.
  for (const obsM of [545, 760, 1600]) for (const km of [1.2, 2.5]) for (const sun of [5, 0, -1]) {
    const a0 = atmOf(obsM);
    const right = beamGrazing(sun, km, a0), old = beamGrazing(sun, obsM / 1000 + km, a0);
    R.effect.push({ obsM, km, sun, ratio: lum(right) > 0 ? +(lum(old) / lum(right)).toFixed(2) : null,
      rbRight: right.b > 0 ? +(right.r / right.b).toFixed(1) : null, rbOld: old.b > 0 ? +(old.r / old.b).toFixed(1) : null });
  }
  // 대조 — 이 자가 층 높이 0.76km 차이를 볼 수 있는가(해 0°, 관측자 해면).
  { const a = read(0, 0), b = read(0, 0, [1.2 + 0.76, 2.5 + 0.76, 7.5 + 0.76]);
    R.control = a.rows.map((row, r) => Math.max(...row.map((v, i) => Math.abs(v - b.rows[r][i])))); }
  window.__stats = { R, N, SPAN };
} catch (e) { errors.push('예외: ' + (e && e.stack || e)); }
window.__errors = errors;
document.title = 'DONE::' + (errors.length ? 'ERR' : 'OK');
</script></body></html>`;

fs.writeFileSync(path.join(PREVIEW, 'cloud-beam-height.html'), html);
console.log('생성 완료: cloud-beam-height.html');
