/**
 * 실제 Chrome WebGL2 에서 SceneComposer 장노출 누적 셰이더(ACCUM_BLEND / ACCUM_RESOLVE) ·
 * 고정 궤적(trails) vs 적도의 추적(tracked) · 구름 투과 감쇠 · 지상 고정 합성(tracked_fixed_ground) 검증 (2026-11-17).
 *
 * 사용:
 *   node tools/shader-preview/verify-astro-composer.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { execFileSync, spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');

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

(async () => {
  const chromeBin = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  if (!fs.existsSync(chromeBin)) {
    console.error('Google Chrome not found; cannot run WebGL2 composer verification.');
    process.exit(1);
  }

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'astro-gl-verify-'));
  const entry = path.join(work, 'entry.ts');
  const stub = path.join(work, 'stub.ts');
  const bundle = path.join(work, 'bundle.js');

  fs.writeFileSync(
    stub,
    `
    export const Platform = { OS: 'web' };
    export const Image = {};
    export const TurboModuleRegistry = { get: () => null, getEnforcing: () => null };
    export class NativeEventEmitter {}
    export default {};
    `,
  );

  fs.writeFileSync(
    entry,
    `
    import * as THREE from 'three';
    import { createStarField, updateStarField, computeEquToHorizon } from ${JSON.stringify(path.join(ROOT, 'src/components/SkyScene3D/StarField.ts'))};
    import { createTerrainField, updateTerrainFieldEye } from ${JSON.stringify(path.join(ROOT, 'src/components/SkyScene3D/TerrainField.ts'))};
    import {
      createSceneComposer,
      assignLayer,
      LAYER_MID,
      LAYER_CELESTIAL,
      LAYER_TERRAIN_DIST,
      LAYER_TERRAIN_LIT,
    } from ${JSON.stringify(path.join(ROOT, 'src/components/SkyScene3D/SceneComposer.ts'))};
    import { computeTrackedAttitudeAt } from ${JSON.stringify(path.join(ROOT, 'src/utils/astroStackMath.ts'))};

    (window as any).__runAstroGl = async () => {
      const logs: string[] = [];
      const origErr = console.error;
      const origWarn = console.warn;
      console.error = (...a: any[]) => { logs.push('ERR:' + a.map(String).join(' ')); origErr(...a); };
      console.warn = (...a: any[]) => { const s = a.map(String).join(' '); if (/shader|glsl|webgl|framebuffer/i.test(s)) logs.push('WARN:' + s); origWarn(...a); };

      const W = 160, H = 120;
      const canvas = document.createElement('canvas');
      canvas.width = W; canvas.height = H;
      const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true });
      renderer.setSize(W, H, false);
      const gl = renderer.getContext();

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(62, W / H, 0.2, 1000);
      camera.position.set(0, 1.6, 0);

      const starField = createStarField(0);
      scene.add(starField.points);
      assignLayer(starField.points, LAYER_CELESTIAL);

      const tf = createTerrainField({ rings: 16, spokes: 32, farM: 2000, eyeHeightM: 1.6, observerElevM: 10 });
      scene.add(tf.mesh); assignLayer(tf.mesh, LAYER_MID);
      scene.add(tf.distMesh); assignLayer(tf.distMesh, LAYER_TERRAIN_DIST);
      scene.add(tf.litMesh); assignLayer(tf.litMesh, LAYER_TERRAIN_LIT);
      tf.mesh.visible = true;
      tf.distMesh.visible = true;
      tf.litMesh.visible = false;

      const composer = createSceneComposer(W, H, 1, { strength: 0, threshold: 0.9, knee: 0.2, scale: 4 }, { strength: 0, density: 0, decay: 0, maskInner: 0, maskOuter: 0 }, 0);
      composer.setTerrainDistance(true);

      const clearSkyTex = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1, THREE.RGBAFormat);
      clearSkyTex.needsUpdate = true;
      const cloudySkyTex = new THREE.DataTexture(new Uint8Array([6, 6, 8, 255]), 1, 1, THREE.RGBAFormat);
      cloudySkyTex.needsUpdate = true;

      const lat = 37.5665, lon = 126.978;
      const t0 = new Date(Date.UTC(2026, 10, 16, 15, 0, 0));
      const durationSec = 7200; // 2시간 궤적 대비를 선명하게 측정하기 위함
      const steps = 12;
      const equMat = new THREE.Matrix3();
      const baseView = { yawDeg: 185, pitchDeg: 36, rollDeg: 0 };

      const applyCam = (yawDeg: number, pitchDeg: number, rollDeg: number) => {
        const azRad = (yawDeg * Math.PI) / 180;
        const elRad = (pitchDeg * Math.PI) / 180;
        const fwd = new THREE.Vector3(
          Math.cos(elRad) * Math.sin(azRad),
          Math.sin(elRad),
          -Math.cos(elRad) * Math.cos(azRad),
        ).normalize();
        camera.up.set(0, 1, 0);
        if (Math.abs(rollDeg) > 1e-4) camera.up.applyAxisAngle(fwd, (rollDeg * Math.PI) / 180);
        camera.lookAt(fwd.x * 100, 1.6 + fwd.y * 100, fwd.z * 100);
        camera.updateMatrixWorld(true);
        updateTerrainFieldEye(tf, camera);
      };

      const runMode = (
        mode: 'trails' | 'tracked' | 'tracked_fixed_ground',
        cloudyHalf: boolean,
        exposureGain = 5.5,
      ) => {
        composer.beginAccumulation(renderer);
        for (let k = 0; k < steps; k++) {
          const tk = new Date(t0.getTime() + (k / (steps - 1)) * durationSec * 1000);
          computeEquToHorizon(tk, lat, lon, equMat);
          updateStarField(starField, {
            equToHorizon: equMat,
            sunAltDeg: -40,
            brightness: 2.2,
            magLimit: 5.5,
            pixelRatio: 1,
            showStars: true,
            showPlanets: false,
          });
          if (mode === 'trails') {
            applyCam(baseView.yawDeg, baseView.pitchDeg, 0);
          } else {
            const tr = computeTrackedAttitudeAt(baseView, t0, tk, lat, lon);
            applyCam(tr.yawDeg, tr.pitchDeg, tr.rollDeg);
          }
          const skyTex = (cloudyHalf && k >= steps / 2) ? cloudySkyTex : clearSkyTex;
          composer.setExternalSky(skyTex);
          composer.prepareTerrainDistance(renderer, scene, camera);
          composer.renderAccumStep(renderer, scene, camera, {
            weight: 1,
            captureAsFixedBase: k === 0 && mode === 'tracked_fixed_ground',
          });
        }
        composer.resolveAccumulation(renderer, {
          exposureGain,
          shadowLift: 0.0,
          useFixedGround: mode === 'tracked_fixed_ground',
        });
        const px = new Uint8Array(W * H * 4);
        gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
        const err = gl.getError();
        composer.endAccumulation();

        // 상단 75%(하늘 영역) 밝은 별 화소 수 · 최대 밝기 · 배경 중앙값 · 순수 별 대비 측정
        let litPx = 0;
        let maxVal = 0;
        let skyEnergy = 0;
        const skyStartRow = Math.floor(H * 0.25); // readPixels y=0 is bottom
        const skyVals: number[] = [];
        for (let y = skyStartRow; y < H; y++) {
          for (let x = 0; x < W; x++) {
            const i = (y * W + x) * 4;
            const l = Math.max(px[i], px[i + 1], px[i + 2]);
            skyVals.push(l);
            if (l > 22) litPx++;
            if (l > maxVal) maxVal = l;
            skyEnergy += l;
          }
        }
        skyVals.sort((a, b) => a - b);
        const bgMed = skyVals[skyVals.length >> 1] ?? 0;
        let starAboveBgPx = 0;
        for (let j = 0; j < skyVals.length; j++) {
          if (skyVals[j] > bgMed + 25) starAboveBgPx++;
        }
        return { litPx, maxVal, bgMed, starContrast: maxVal - bgMed, starAboveBgPx, skyEnergy, err };
      };

      const trailsRes = runMode('trails', false, 5.5);
      const trackedRes = runMode('tracked', false, 5.5);
      const trackedMidRes = runMode('tracked', false, 1.4);
      const cloudyRes = runMode('tracked', true, 1.4);
      const fixedGroundRes = runMode('tracked_fixed_ground', false, 5.5);

      composer.dispose();
      starField.dispose();
      tf.dispose();
      clearSkyTex.dispose();
      cloudySkyTex.dispose();
      renderer.dispose();

      return { trailsRes, trackedRes, trackedMidRes, cloudyRes, fixedGroundRes, logs };
    };
    `,
  );

  execFileSync(
    'npx',
    [
      'esbuild',
      entry,
      '--bundle',
      '--format=iife',
      '--platform=browser',
      '--define:__DEV__=false',
      '--loader:.png=empty',
      `--alias:three=${path.join(ROOT, 'node_modules/three')}`,
      `--alias:react-native=${stub}`,
      `--alias:expo-asset=${stub}`,
      `--alias:expo-file-system/legacy=${stub}`,
      `--outfile=${bundle}`,
      '--log-level=error',
    ],
    { cwd: ROOT, stdio: 'inherit', env: { ...process.env, NODE_PATH: path.join(ROOT, 'node_modules') } },
  );

  const html = `<!DOCTYPE html><html><body><script>${fs.readFileSync(bundle, 'utf8')}</script><script>window.__runAstroGl().then(r=>fetch('/done',{method:'POST',body:JSON.stringify(r)})).catch(e=>fetch('/done',{method:'POST',body:JSON.stringify({fatal:String(e)})}));</script></body></html>`;
  let doneRes;
  const donePromise = new Promise((r) => {
    doneRes = r;
  });
  const srv = http.createServer((req, res) => {
    if (req.url === '/done' && req.method === 'POST') {
      let b = '';
      req.on('data', (c) => { b += c; });
      req.on('end', () => { res.end('ok'); doneRes(JSON.parse(b)); });
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const profDir = path.join(work, 'prof');
  fs.mkdirSync(profDir);
  const chrome = spawn(
    chromeBin,
    [
      '--headless',
      `--user-data-dir=${profDir}`,
      '--no-first-run',
      '--disable-background-networking',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--disable-gpu-sandbox',
      `http://127.0.0.1:${srv.address().port}/`,
    ],
    { stdio: 'ignore' },
  );
  const res = await Promise.race([
    donePromise,
    new Promise((r) => setTimeout(() => r({ timeout: true }), 15000)),
  ]);
  chrome.kill('SIGKILL');
  srv.close();
  setTimeout(() => { try { fs.rmSync(work, { recursive: true, force: true }); } catch {} }, 100);

  ok(
    !res.fatal &&
      !res.timeout &&
      res.logs?.length === 0 &&
      res.trailsRes?.err === 0 &&
      res.trackedRes?.err === 0 &&
      res.cloudyRes?.err === 0 &&
      res.fixedGroundRes?.err === 0,
    `WebGL2 누적 셰이더 컴파일/링크·glGetError==0 무오류 (logs=${res.logs?.length ?? -1})`,
  );

  ok(
    res.trailsRes &&
      res.trackedRes &&
      res.trailsRes.litPx > res.trackedRes.litPx * 2.5 &&
      res.trackedRes.maxVal > res.trailsRes.maxVal,
    `고정 궤적(lit=${res.trailsRes?.litPx}px, max=${res.trailsRes?.maxVal}) vs 적도의 추적(lit=${res.trackedRes?.litPx}px, max=${res.trackedRes?.maxVal}) — 추적 시 별이 한 점으로 모이고 궤적 시 호로 퍼짐`,
  );

  ok(
    res.cloudyRes &&
      res.trackedMidRes &&
      res.cloudyRes.starContrast < res.trackedMidRes.starContrast * 0.85 &&
      res.cloudyRes.starAboveBgPx < res.trackedMidRes.starAboveBgPx &&
      res.cloudyRes.bgMed > res.trackedMidRes.bgMed,
    `노출 후반 구름 통과 시 하늘 배경 상승(${res.trackedMidRes?.bgMed}→${res.cloudyRes?.bgMed}) + 별 순수 대비·검출 별 수 감쇠 (contrast ${res.trackedMidRes?.starContrast}→${res.cloudyRes?.starContrast}, starPx ${res.trackedMidRes?.starAboveBgPx}→${res.cloudyRes?.starAboveBgPx})`,
  );

  ok(
    res.fixedGroundRes && res.fixedGroundRes.litPx > 0 && res.fixedGroundRes.maxVal > 100,
    `지상 고정+별 추적 합성(tracked_fixed_ground) 정상 출력 (lit=${res.fixedGroundRes?.litPx}px, max=${res.fixedGroundRes?.maxVal})`,
  );

  console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
  process.exit(fail > 0 ? 1 : 0);
})();
