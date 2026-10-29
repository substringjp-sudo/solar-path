/**
 * §179 WP2 T_sun 아틀라스 구축기(tsunAtlas.ts LP3) 합격 판정 — 브라우저 없음(GPU·Chromium 안 씀, RULER-grain C0 렌더와 함께 돌아도 됨).
 * esbuild 로 앱의 createVolumetricScene 을 묶어 **가짜 렌더러**로 장면을 걸고(그리지 않음) 구축기·배선을 CPU 에서 봅니다.
 *   node tools/shader-preview/verify-tsun-atlas.js [--work DIR] [--no-bench]
 * 임시 출력은 os.tmpdir()(TMPDIR) 아래 새 폴더(--work 로 바꿈). 고정표(tools/genus-ruler/tsun/fixture/tsun-fixture.{json,bin})는 sha 를 맞춰 읽고,
 * 거시 고리(P3B·RA3·RA5)는 make-jobs-tsun.py 의 생성기를 python -I -B 로 불러 만들어 scenes-tsun.json 의 sha 와 맞춥니다(파일을 고치지 않음).
 *
 *  [wire] 배선: tsun 1 · tsunSync · 고정표면 setScene 이 짓고 검(gTsunOn 1, half float RGBA, n·blocks × n), 같은 시각 setDate 는 다시 짓지 않음,
 *         해가 움직이면 다시 짓고 옛 텍스처 버림, 해 > 12° 면 짓지 않음, 같은 입력 = 같은 sha(다른 장면 객체로도), tsunN 256·archLight 로 다시 지음,
 *         밖 아틀라스(setTsunAtlas) 동안 쉼·null 이면 다시 지음, tsunSync false·고정표 없음이면 짓지 않고 이유, tsun 0 이면 고정표를 줘도 아무것도 안 함.
 *  [law]  고정표 법칙 표(tsunFixtureLaw): 고정표 마디에서 평가기(tsunLambda10·tsunLawTau)와 같음, 마디 사이 G 와 tsunCurveOfGrowth 의 차(보고).
 *  [U2a]  수렴한 기준 구적(tsunReferenceTau, 참 3-D 광선 50 m 중점) 대비 LP3 해 블록: 장면 B(P3B, 거시 1)·장면 A(RA1, 거시 0 스칼라 길),
 *         dT p95 ≤ 0.007 (해 4·8·12°), ≤ 0.01 (해 +1.108·+0.3·−1.0°). 기준 수렴(25 m 대비) 보고.
 *  [U2b]  균일 층 τ vs 구면 닫힌 꼴: 1 km 층 밑에서 +1.108° → 43.89 km ± 0.5 %, e ∈ {−1.5…+1.108}° 에서 5 m 무차별 대비 ≤ 1e-3 상대(U2b′).
 *  [U2c]  균일 층 u_true 조각 보간(셰이더 I-2 의 CPU 거울, f64 텍셀) vs 닫힌 꼴 < 1e-4 상대(관측점 30 km 안 텍셀 중심), half 텍셀 오차 보고.
 *  [U2d]  아치 블록: LP3(옆 흐름 무시) vs 참 3-D 아치 광선 기준, T_g = e^−(own+rest) dT p95 ≤ 0.03 (해 ≤ +1.1°).
 *  [U2e]  등록: 종류 평면 ↔ ECEF ↔ 셰이더 uv(gTsunUvOf 식, 재질 균일변수 값) 왕복 < 1 m, §173 고도 보정 원점 + weatherOffsetKm, 관측점 = 중심,
 *         해 광선의 평면 투영이 줄과 평행, 거시 격자 읽기(이류·채널·mix)가 셰이더 식과 같음, 가장자리 = 부채꼴 평균(≠ 1).
 *  [U2f]  시간 기록(JIT·--jitless, N 128/256 · 레인 2/3 · 아치 0/1 · 해 −1.4/+1.108/+8°) — 판정 없음, WORK/bench-*.json.
 *  [U2g]  (보고) 셰이더 길 τ(half 텍셀 + u_true 보간) vs 참 선 기준 τ, P3B·RA3·RA5 임의 높이 — dT p95.
 */
const path = require('path'); const os = require('os'); const fs = require('fs'); const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..', '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const WORK = arg('--work', null) ? path.resolve(arg('--work')) : fs.mkdtempSync(path.join(os.tmpdir(), 'tsun-atlas-'));
const NO_BENCH = process.argv.includes('--no-bench');
fs.mkdirSync(WORK, { recursive: true });
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS: ' + m); } else { fail++; console.log('  FAIL: ' + m); } };
const info = m => console.log('  INFO: ' + m);
const f4 = x => (x == null ? 'null' : Number(x).toPrecision(4));

const HARNESS = `
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Texture, Vector2, Vector3 } from 'three';
import { Ellipsoid, Geodetic, radians } from '@takram/three-geospatial';
import { getAltitudeCorrectionOffset } from '@takram/three-atmosphere';
import { createVolumetricScene, DEFAULT_VOLUMETRIC_OPTIONS } from '${ROOT}/src/components/VolumetricProbe/volumetricScene';
import * as TA from '${ROOT}/src/components/VolumetricProbe/tsunAtlas';
import * as TF from '${ROOT}/src/components/VolumetricProbe/tsunFixture';
import { TSUN_SLICE_HF, ARCH_GL2 } from '${ROOT}/src/components/VolumetricProbe/cloudTsun';

const cfg = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const OUT = process.argv[3];
const W = 400, H = 300;
const gl = { getContextAttributes: () => ({ alpha: false }), getExtension: () => null, getParameter: () => 0 };
const mkR = (): any => ({ getSize: (v: Vector2) => v.set(W, H), getDrawingBufferSize: (v: Vector2) => v.set(W, H), getPixelRatio: () => 1, getContext: () => gl,
  outputColorSpace: 'srgb-linear', autoClear: true, toneMappingExposure: 1, capabilities: { logarithmicDepthBuffer: false, isWebGL2: true, maxTextures: 16 } });
const quant = (a: number[], q: number) => { if (!a.length) return null; const s = Float64Array.from(a).sort(); return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1) + 0.5))]; };
const now = () => Number(process.hrtime.bigint()) / 1e6;
// 결정적 난수(mulberry32)
const rng = (seed: number) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

function loadFixture() {
  const hdr = JSON.parse(fs.readFileSync(cfg.fixtureJson, 'utf8'));
  const bin = new Uint8Array(fs.readFileSync(cfg.fixtureBin));
  const sha = createHash('sha256').update(bin).digest('hex');
  if (sha !== hdr.binSha256) throw new Error('fixture sha mismatch ' + sha + ' != ' + hdr.binSha256);
  return TF.parseTsunFixture(hdr, bin);
}
const macros = JSON.parse(fs.readFileSync(cfg.macros, 'utf8'));
const sceneInput = (job: any, macroKey: string | null, extra: any = {}) => {
  const inp = { ...job.input, ...extra, date: new Date(extra.date ?? job.input.date) };
  delete inp.macroRef;
  if (macroKey && macros[macroKey]) inp.macro = macros[macroKey];
  return inp;
};
const mkScene = async (job: any, opts: any) => {
  const v: any = await createVolumetricScene(mkR(), W, H, { genus: true, celestial: false, precomputed: {} as never });
  v.setOptions({ ...DEFAULT_VOLUMETRIC_OPTIONS, genus: true, celestial: false, ...job.options, accurateSunBelowDeg: 12, ...opts }, false);
  v.setQuality('low');
  return v;
};
/** 장면 입력을 해 고도 e(아틀라스 중심의 구 연직 기준)·같은 방위로 바꿈 */
const withSun = (bi: any, eDeg: number) => {
  const g = TA.tsunFrameGeom(bi);
  const cx = g.O[0] + bi.centerKm[0], cy = g.O[1] + bi.centerKm[1], cz = Math.sqrt(g.R * g.R - cx * cx - cy * cy);
  const r = Math.hypot(cx, cy, cz), u = [cx / r, cy / r, cz / r];
  const sub = (a: number[], b: number[], s: number) => a.map((x, i) => x - s * b[i]);
  const nrm = (a: number[]) => { const l = Math.hypot(a[0], a[1], a[2]); return a.map(x => x / l); };
  const e1 = nrm(sub([1, 0, 0], u, u[0])), n1 = [u[1] * e1[2] - u[2] * e1[1], u[2] * e1[0] - u[0] * e1[2], u[0] * e1[1] - u[1] * e1[0]];
  const az = (g.phiDeg * Math.PI) / 180, e = (eDeg * Math.PI) / 180;
  const loc = [0, 1, 2].map(i => Math.cos(e) * (Math.sin(az) * e1[i] + Math.cos(az) * n1[i]) + Math.sin(e) * u[i]);
  const s = [0, 1, 2].map(k => loc[0] * g.E[k] + loc[1] * g.N[k] + loc[2] * g.U[k]);
  return { ...bi, sunDir: s };
};
/** 아틀라스 텍셀 중심 점(국소 틀 km) */
const texelPoint = (bi: any, d: any, geom: any, i: number, j: number, h: number) => {
  const [x, y] = TA.tsunTexelPlanar(d, i, j);
  const X = geom.O[0] + x, Y = geom.O[1] + y, r = geom.R + h;
  return [X, Y, Math.sqrt(r * r - X * X - Y * Y)];
};
const archDir = (P: number[], geom: any, g: number) => {
  const r = Math.hypot(P[0], P[1], P[2]), u = P.map(x => x / r), [aE, aN] = geom.a;
  const na = u[0] * aE + u[1] * aN;
  let t = [aE - u[0] * na, aN - u[1] * na, -u[2] * na]; const tl = Math.hypot(t[0], t[1], t[2]); t = t.map(x => x / tl);
  const dip = Math.acos(Math.min(1, geom.R / r)), e = -ARCH_GL2[g] * dip;
  return [0, 1, 2].map(k => Math.cos(e) * t[k] + Math.sin(e) * u[k]);
};

async function main() {
  const fx = loadFixture();
  const res: any = { fixtureSha: fx.header.binSha256 };
  const S = cfg.scenes;
  // ───────── [wire] ─────────
  {
    const w: any = {};
    const A = await mkScene(S.P3B, { tsun: 1, tsunSync: true });
    A.setTsunFixture(fx);
    const inp0 = sceneInput(S.P3B, 'P3B');
    A.setScene(inp0);
    const U = () => A.debug.clouds.cloudsPass.currentMaterial.uniforms;
    const texOf = () => U().gTsunTex?.value;
    const i1 = A.tsunInfo(), t1 = texOf();
    let disp1 = false; t1?.addEventListener?.('dispose', () => { disp1 = true; });
    w.first = { info: i1, on: U().gTsunOn?.value, tex: t1 ? { w: t1.image.width, h: t1.image.height, type: t1.type, data: t1.image.data?.constructor?.name, min: t1.minFilter, mag: t1.magFilter, flipY: t1.flipY, mip: t1.generateMipmaps } : null };
    A.setDate(new Date(inp0.date.getTime()));
    w.sameDate = { builds: A.tsunInfo().builds, sameTex: texOf() === t1 };
    A.setDate(new Date(inp0.date.getTime() + 120e3));
    const i2 = A.tsunInfo();
    w.moved = { builds: i2.builds, sha: i2.atlasMeta?.sha, disp1, valid: i2.atlasValid };
    A.setDate(new Date('2026-10-05T03:30:00Z'));
    const i3 = A.tsunInfo();
    w.high = { builds: i3.builds, injected: i3.injected, autoReason: i3.autoReason, uniforms: Object.keys(U()).filter(k => /^g(Tsun|Arch)/.test(k)) };
    A.setDate(new Date(inp0.date.getTime()));
    const i4 = A.tsunInfo();
    w.back = { builds: i4.builds, sha: i4.atlasMeta?.sha, valid: i4.atlasValid, on: U().gTsunOn?.value };
    A.setOptions({ tsunN: 256 }, false);
    const t256 = texOf();
    w.n256 = { builds: A.tsunInfo().builds, valid: A.tsunInfo().atlasValid, w: t256?.image.width, h: t256?.image.height };
    A.setOptions({ archLight: 1 }, false);
    const ta = texOf();
    w.arch = { builds: A.tsunInfo().builds, valid: A.tsunInfo().atlasValid, w: ta?.image.width, h: ta?.image.height, archU: Object.keys(U()).filter(k => /^gArch/.test(k)) };
    A.setOptions({ archLight: 0, tsunN: 128 }, false);
    w.restore = { builds: A.tsunInfo().builds, valid: A.tsunInfo().atlasValid, sha: A.tsunInfo().atlasMeta?.sha };
    // 밖 아틀라스
    const bi = A.tsunBuildInput();
    const laws = TA.tsunLawsFromFixture(fx, bi);
    const dExt = TA.buildTsunAtlasData(bi, laws.laws, { fixtureSha: fx.header.binSha256 });
    const ext = TA.makeTsunAtlas(dExt, A.tsunSceneSerial());
    let extDisposed = false; ext.texture.addEventListener('dispose', () => { extDisposed = true; });
    const ownBefore = texOf(); let ownDisp = false; ownBefore?.addEventListener?.('dispose', () => { ownDisp = true; });
    const bExt = A.tsunInfo().builds;
    A.setTsunAtlas(ext);
    A.setDate(new Date(inp0.date.getTime() + 60e3));
    w.external = { external: A.tsunInfo().external, builds: A.tsunInfo().builds - bExt, autoReason: A.tsunInfo().autoReason, texIsExt: texOf() === ext.texture, ownDisp, extSha: dExt.sha, autoSha: w.back.sha };
    A.setTsunAtlas(null);
    w.extNull = { external: A.tsunInfo().external, builds: A.tsunInfo().builds - bExt, valid: A.tsunInfo().atlasValid, extDisposed };
    const tBefore = texOf(); let dispScene = false; tBefore?.addEventListener?.('dispose', () => { dispScene = true; });
    const s0 = A.tsunSceneSerial(), b0 = A.tsunInfo().builds;
    A.setScene(inp0);
    w.rescene = { serial: A.tsunSceneSerial() - s0, builds: A.tsunInfo().builds - b0, dispScene, valid: A.tsunInfo().atlasValid, sha: A.tsunInfo().atlasMeta?.sha };
    // 다른 장면 객체 · 같은 입력 → 같은 sha
    const F = await mkScene(S.P3B, { tsun: 1, tsunSync: true }); F.setTsunFixture(fx); F.setScene(sceneInput(S.P3B, 'P3B'));
    w.determinism = { a: i1.atlasMeta?.sha, f: F.tsunInfo().atlasMeta?.sha, back: w.back.sha };
    // tsunSync false · 고정표 없음 · tsun 0
    const B = await mkScene(S.P3B, { tsun: 1, tsunSync: false }); B.setTsunFixture(fx); B.setScene(sceneInput(S.P3B, 'P3B'));
    w.syncOff = { builds: B.tsunInfo().builds, valid: B.tsunInfo().atlasValid, autoReason: B.tsunInfo().autoReason, reason: B.tsunInfo().reason };
    const C = await mkScene(S.P3B, { tsun: 1, tsunSync: true }); C.setScene(sceneInput(S.P3B, 'P3B'));
    w.noFixture = { builds: C.tsunInfo().builds, valid: C.tsunInfo().atlasValid, autoReason: C.tsunInfo().autoReason };
    const texCount = async (withFx: boolean) => {
      const D = await mkScene(S.P3B, {}); if (withFx) D.setTsunFixture(fx);
      const a = new Texture().id; D.setScene(sceneInput(S.P3B, 'P3B')); D.setDate(new Date(inp0.date.getTime() + 60e3)); const b = new Texture().id;
      const u = D.debug.clouds.cloudsPass.currentMaterial.uniforms;
      return { tex: b - a, builds: D.tsunInfo().builds, uni: Object.keys(u).filter(k => /^g(Tsun|Arch)/.test(k)).length, autoReason: D.tsunInfo().autoReason };
    };
    w.off = { withFx: await texCount(true), noFx: await texCount(false) };
    res.wire = w;
    // ───────── [U2e] 등록 ─────────
    const reg = (v: any, inp: any) => {
      const bi = v.tsunBuildInput(); const geom = TA.tsunFrameGeom(bi);
      const pos = new Geodetic(radians(inp.lon), radians(inp.lat), inp.heightM).toECEF();
      const alt = getAltitudeCorrectionOffset(pos, 6360000, Ellipsoid.WGS84, new Vector3());
      const obs = pos.clone().add(alt);
      const obsPl = TA.tsunPlanarOfEcef(bi.frame, [obs.x, obs.y, obs.z]);
      const u = v.debug.clouds.cloudsPass.currentMaterial.uniforms;
      const fr = u.gTsunFrame.value, ep = u.gTsunEpoch.value, org = u.genusOrigin.value, ea = u.genusEast.value, no = u.genusNorth.value, tileM = u.genusTileM.value;
      const n = Math.round((2 * fr.z) / fr.w);
      const d = { centerKm: [ep.x, ep.y], rowAxisEN: [fr.x, fr.y], halfKm: fr.z, n };
      const rr = rng(17);
      let eTex = 0, eH = 0, ePl = 0, eLat = 0, minAlong = Infinity;
      for (let k = 0; k < 400; k++) {
        const i = Math.floor(rr() * n), j = Math.floor(rr() * n), L = bi.lanes[k % 2], h = L.baseKm + TSUN_SLICE_HF[k % 4] * (L.topKm - L.baseKm);
        const [x, y] = TA.tsunTexelPlanar(d as any, i, j);
        const P = TA.tsunEcefOfPlanar(geom, x, y, h);
        // 셰이더 gTsunUvOf(getGlobeUv × genusTileM × 1e-3 − 에포크 → 줄·가로 → 텍셀)
        const dv = [P[0] - org.x, P[1] - org.y, P[2] - org.z];
        const uvx = (dv[0] * ea.x + dv[1] * ea.y + dv[2] * ea.z) / tileM, uvy = (dv[0] * no.x + dv[1] * no.y + dv[2] * no.z) / tileM;
        const km = [uvx * tileM * 1e-3 - ep.x, uvy * tileM * 1e-3 - ep.y];
        const gx = (km[0] * fr.x + km[1] * fr.y + fr.z) / fr.w, gy = (-km[0] * fr.y + km[1] * fr.x + fr.z) / fr.w;
        eTex = Math.max(eTex, Math.hypot(gx - (i + 0.5), gy - (j + 0.5)) * fr.w * 1000);
        eH = Math.max(eH, Math.abs(Math.hypot(P[0], P[1], P[2]) / 1000 - geom.R - h) * 1000);
        const pl = TA.tsunPlanarOfEcef(bi.frame, P);
        ePl = Math.max(ePl, Math.hypot(pl[0] - x, pl[1] - y) * 1000);
        // 해 광선 50 km 앞의 평면 이동이 줄과 평행
        const s = bi.sunDir, P2 = [P[0] + 50e3 * s[0], P[1] + 50e3 * s[1], P[2] + 50e3 * s[2]];
        const pl2 = TA.tsunPlanarOfEcef(bi.frame, P2), dx = pl2[0] - pl[0], dy = pl2[1] - pl[1];
        eLat = Math.max(eLat, Math.abs(-dx * fr.y + dy * fr.x) * 1000); minAlong = Math.min(minAlong, dx * fr.x + dy * fr.y);
      }
      // 거시 격자 읽기: 셰이더 genusMacroCoverAt(km + drift) 를 재질 값으로 따로 계산 vs tsunCoverFn
      let eMac = 0, nMac = 0;
      const lm = u.genusMacroLane.value.elements, du = u.genusMacroDriftU.value, dvv = u.genusMacroDriftV.value;
      const texA = u.genusMacroTexA.value, texB = u.genusMacroTexB.value, mix = u.genusMacroMix.value, ext = u.genusMacroExtentKm.value;
      const geomS = TA.tsunFrameGeom(bi);
      for (let lane = 0; lane < 2; lane++) {
        const L = bi.lanes[lane]; if (!L || !L.macro) continue;
        const ch = [0, 1, 2, 3].find(r => lm[lane * 4 + r] === 1)!;
        const drift = [[du.x, du.y, du.z, du.w][lane], [dvv.x, dvv.y, dvv.z, dvv.w][lane]];
        const cf = TA.tsunCoverFn(L, geomS.phiDeg);
        const nn = texA.image.width;
        const tx = (data: any, ix: number, iy: number) => data[(iy * nn + ix) * 4 + ch] / 255;
        for (let k = 0; k < 64; k++) {
          const x = (rr() - 0.5) * 600, y = (rr() - 0.5) * 600;
          const ux = (x + drift[0]) / ext + 0.5, uy = (y + drift[1]) / ext + 0.5;
          if (ux < 0 || ux > 1 || uy < 0 || uy > 1) continue;
          let fx2 = Math.min(nn - 1, Math.max(0, ux * nn - 0.5)), fy2 = Math.min(nn - 1, Math.max(0, uy * nn - 0.5));
          const i0 = Math.min(nn - 2, Math.floor(fx2)), j0 = Math.min(nn - 2, Math.floor(fy2)), ax = fx2 - i0, ay = fy2 - j0;
          const bil = (data: any) => (tx(data, i0, j0) * (1 - ax) + tx(data, i0 + 1, j0) * ax) * (1 - ay) + (tx(data, i0, j0 + 1) * (1 - ax) + tx(data, i0 + 1, j0 + 1) * ax) * ay;
          const C = bil(texA.image.data) * (1 - mix) + bil(texB.image.data) * mix;
          eMac = Math.max(eMac, Math.abs(Math.min(C, L.tileCover) - cf.at(x, y))); nMac++;
        }
      }
      const edges = bi.lanes.slice(0, 2).map((L: any) => (L && L.macro ? TA.tsunCoverFn(L, geomS.phiDeg).edge : null));
      return { centerErrM: Math.hypot(obsPl[0] - bi.centerKm[0], obsPl[1] - bi.centerKm[1]) * 1000, centerKm: bi.centerKm, altCorrKm: [alt.x / 1000, alt.y / 1000, alt.z / 1000],
        originOffKm: Math.hypot(obs.x - bi.frame.originM[0], obs.y - bi.frame.originM[1], obs.z - bi.frame.originM[2]) / 1000,
        eTexM: eTex, eHm: eH, ePlM: ePl, eLatM: eLat, minAlongKm: minAlong, ortho: geom.orthoErr, eMac, nMac, edges, phi: geom.phiDeg, sunEl: geom.sunElCenterDeg };
    };
    res.u2e = { p3b: reg(A, inp0) };
    const off = sceneInput(S.P3B, 'P3B', { weatherOffsetKm: [3.2, -1.7] });
    const G = await mkScene(S.P3B, { tsun: 1, tsunSync: true }); G.setTsunFixture(fx); G.setScene(off);
    res.u2e.offset = { ...reg(G, off), valid: G.tsunInfo().atlasValid };
    // 구축기 입력 저장(U2f 시간 측정 · U2a 가 다시 씀)
    const toPlain = (bi: any) => ({ ...bi, lanes: bi.lanes.map((L: any) => L && { ...L, macro: L.macro && { ...L.macro, dataA: Array.from(L.macro.dataA), dataB: L.macro.dataB && Array.from(L.macro.dataB) } }) });
    fs.writeFileSync(path.join(OUT, 'input-P3B.json'), JSON.stringify(toPlain(A.tsunBuildInput())));
    res.inputs = { P3B: A.tsunBuildInput() };
  }
  // ───────── RA1(거시 0) · RA3 · RA5 장면 입력 ─────────
  const inputsOf: any = { P3B: res.inputs.P3B };
  for (const [name, key] of [['RA1_s1.1_V1', null], ['RA3_s1.1_V1', 'RA3_s1.1_V1'], ['RA5_s1.1_V1', 'RA5_s1.1_V1']] as [string, string | null][]) {
    const job = S[name];
    const v = await mkScene(job, { tsun: 1, tsunSync: true }); v.setTsunFixture(fx); v.setScene(sceneInput(job, key));
    inputsOf[name] = v.tsunBuildInput();
    res[name + '_info'] = v.tsunInfo();
  }
  delete res.inputs;
  // ───────── [law] ─────────
  {
    const bi = inputsOf.P3B, g = TA.tsunFrameGeom(bi), L = TA.tsunLawsFromFixture(fx, bi);
    const out: any = { warnings: L.warnings, entries: L.entries, nodeErr: 0, nodeN: 0, replicaErr: 0, offG: [] as number[], offLam: [] as number[] };
    const rr = rng(5);
    for (const lane of [0, 1]) {
      const e = L.entries[lane], E = fx.header.entries[e], law = L.laws[lane]!;
      for (const c of E.covers.filter((x: number) => x < fx.header.grids.fullCover)) for (const hf of E.hf ?? fx.header.grids.hf) {
        const lam = TF.tsunLambda10(fx, e, c, hf, g.phiDeg);
        out.nodeErr = Math.max(out.nodeErr, Math.abs(law.lambda(c, hf) - lam) / Math.max(1e-9, lam));
        for (const Lk of [1, 5, 14]) { const t = TF.tsunLawTau(fx, e, Lk, c, hf, g.phiDeg); out.nodeErr = Math.max(out.nodeErr, Math.abs(law.G(lam * Lk, c, hf) - t) / Math.max(1e-3, t)); }
        out.nodeN++;
      }
      for (let k = 0; k < 400; k++) {
        const c = rr(), hf = 0.01 + 0.98 * rr(), Lk = 0.2 + 30 * rr();
        const nv = TA.tsunFixtureNodeValues(fx, e, c, hf, g.phiDeg, Lk);
        out.replicaErr = Math.max(out.replicaErr, Math.abs(nv.lam - TF.tsunLambda10(fx, e, c, hf, g.phiDeg)), Math.abs(nv.tau - TF.tsunLawTau(fx, e, Lk, c, hf, g.phiDeg)));
        const lamE = TF.tsunLambda10(fx, e, c, hf, g.phiDeg);
        if (lamE > 0) {
          const Lam = lamE * Lk, gE = TF.tsunCurveOfGrowth(fx, e, Lam, c, hf, g.phiDeg), gT = law.G(Lam, c, hf);
          if (gE < 8) out.offG.push(Math.abs(Math.exp(-gT) - Math.exp(-gE)));
          out.offLam.push(Math.abs(law.lambda(c, hf) / lamE - 1));
        }
      }
    }
    res.law = { ...out, offG_p95: quant(out.offG, 0.95), offG_max: Math.max(...out.offG), offLam_p95: quant(out.offLam, 0.95), offG: undefined, offLam: undefined };
  }
  // ───────── [U2a] · [U2d] ─────────
  const stride = 8, off0 = 4;
  const compareSun = (bi: any, eDeg: number, dsKm = 0.05) => {
    const b2 = withSun(bi, eDeg), g = TA.tsunFrameGeom(b2), L = TA.tsunLawsFromFixture(fx, b2);
    const t0 = now(); const d = TA.buildTsunAtlasData(b2, L.laws); const ms = now() - t0;
    const dT: number[] = [], dTh: number[] = []; let nG = 0, tmin = Infinity, tmax = 0; const worst: any[] = [];
    const tR0 = now();
    for (let k = 0; k < 4; k++) {
      const lb = b2.lanes[k]; const blk = d.laneBlock[k]; if (blk < 0) continue;
      for (let j = off0; j < d.n; j += stride) for (let i = off0; i < d.n; i += stride) for (let s = 0; s < 4; s++) {
        const h = lb.baseKm + TSUN_SLICE_HF[s] * (lb.topKm - lb.baseKm);
        const P = texelPoint(b2, d, g, i, j, h);
        const ref = TA.tsunReferenceTau(b2, L.laws, g, P, g.sun, { dsKm });
        if (ref.ground) { nG++; continue; }
        const o = (j * d.width + blk * d.n + i) * 4 + s;
        const tl = d.tau[o];
        dT.push(Math.abs(Math.exp(-tl) - Math.exp(-ref.tau)));
        worst.push({ dT: dT[dT.length - 1], lane: k, i, j, s, lp3: tl, ref: ref.tau });
        dTh.push(Math.abs(Math.exp(-TA.tsunAtlasSampleCpu(d, ...TA.tsunTexelPlanar(d, i, j), blk, 0, true)[s]) - Math.exp(-ref.tau)));
        tmin = Math.min(tmin, ref.tau); tmax = Math.max(tmax, ref.tau);
      }
    }
    worst.sort((a, b) => b.dT - a.dT);
    return { e: eDeg, K: d.K, n: dT.length, worst: worst.slice(0, 3), ground: nG, p95: quant(dT, 0.95), max: Math.max(...dT), med: quant(dT, 0.5), p95half: quant(dTh, 0.95), tauRange: [tmin, tmax], buildMs: ms, refMs: now() - tR0, meta: { ...d.meta, laneCond: d.meta.laneCond, warnings: d.meta.warnings } };
  };
  res.u2a = {};
  for (const [sc, key] of [['B', 'P3B'], ['A', 'RA1_s1.1_V1']]) {
    res.u2a[sc] = [];
    for (const e of [12, 8, 4, 1.108, 0.3, -1.0]) res.u2a[sc].push(compareSun(inputsOf[key], e));
  }
  // 기준 수렴: 50 m vs 25 m (P3B +1.108°, 64 광선)
  {
    const b2 = withSun(inputsOf.P3B, 1.108), g = TA.tsunFrameGeom(b2), L = TA.tsunLawsFromFixture(fx, b2);
    const d = { centerKm: b2.centerKm, rowAxisEN: g.a, halfKm: b2.halfKm, n: b2.n };
    const rr = rng(9); let mx = 0;
    for (let k = 0; k < 64; k++) {
      const i = Math.floor(rr() * 128), j = Math.floor(rr() * 128), lb = b2.lanes[k % 2], h = lb.baseKm + TSUN_SLICE_HF[k % 4] * (lb.topKm - lb.baseKm);
      const P = texelPoint(b2, d, g, i, j, h);
      const a = TA.tsunReferenceTau(b2, L.laws, g, P, g.sun, { dsKm: 0.05 }), b = TA.tsunReferenceTau(b2, L.laws, g, P, g.sun, { dsKm: 0.025 });
      mx = Math.max(mx, Math.abs(Math.exp(-a.tau) - Math.exp(-b.tau)));
    }
    res.refConv = { maxdT_50_vs_25m: mx };
  }
  // U2d 아치
  res.u2d = [];
  for (const e of [1.108, 0.3, -1.0]) {
    const b2 = { ...withSun(inputsOf.P3B, e), arch: true }, g = TA.tsunFrameGeom(b2), L = TA.tsunLawsFromFixture(fx, b2);
    const d = TA.buildTsunAtlasData(b2, L.laws);
    const dT: number[] = [], dOwn: number[] = []; const worst: any[] = [];
    for (let k = 0; k < 4; k++) {
      const lb = b2.lanes[k], blk = d.laneBlock[k]; if (blk < 0) continue;
      const law = L.laws[k]!;
      for (let j = off0; j < d.n; j += stride) for (let i = off0; i < d.n; i += stride) for (let sl = 0; sl < 2; sl++) {
        const h = sl === 0 ? lb.baseKm : lb.topKm, P = texelPoint(b2, d, g, i, j, h);
        for (let gg = 0; gg < 2; gg++) {
          const dir = archDir(P, g, gg);
          const ref = TA.tsunReferenceTau(b2, L.laws, g, P, dir, { dsKm: 0.05, own: k, split: law.dlKm });
          const o = (((1 + sl) * d.n + j) * d.width + blk * d.n + i) * 4 + gg * 2;
          dT.push(Math.abs(Math.exp(-(d.tau[o] + d.tau[o + 1])) - Math.exp(-ref.tau)));
          dOwn.push(Math.abs(Math.exp(-d.tau[o]) - Math.exp(-ref.own)));
          worst.push({ dT: dT[dT.length - 1], lane: k, i, j, sl, g: gg, own: d.tau[o], rest: d.tau[o + 1], refOwn: ref.own, refRest: ref.rest });
        }
      }
    }
    worst.sort((a, b) => b.dT - a.dT);
    res.u2d.push({ e, K: d.K, n: dT.length, p95: quant(dT, 0.95), max: Math.max(...dT), ownP95: quant(dOwn, 0.95), worst: worst.slice(0, 3) });
  }
  // ───────── [U2b] · [U2c] 균일 층 ─────────
  const synth = (eDeg: number, lanes: [number, number][], n = 16, halfKm = 20) => {
    const R = 6360, az = (263.37 * Math.PI) / 180, e = (eDeg * Math.PI) / 180;
    return {
      frame: { originM: [0, 0, R * 1000], eastM: [1, 0, 0], northM: [0, 1, 0], tileM: 24000 }, centerKm: [0, 0],
      sunDir: [Math.cos(e) * Math.sin(az), Math.cos(e) * Math.cos(az), Math.sin(e)], bottomRadiusKm: R, n, halfKm, rangeKm: 400, arch: false,
      lanes: [0, 1, 2, 3].map(k => (lanes[k] ? { genus: 'u', tileCover: 1, baseKm: lanes[k][0], topKm: lanes[k][1], macro: null } : null)),
    };
  };
  const brute = (P: number[], d: number[], hb: number, ht: number, R: number, D: number, ds = 0.005) => {
    let L = 0; const N = Math.ceil(D / ds);
    for (let k = 0; k < N; k++) {
      const t = (k + 0.5) * ds, x = P[0] + t * d[0], y = P[1] + t * d[1], z = P[2] + t * d[2], h = Math.hypot(x, y, z) - R;
      if (h < 0) break;
      if (h >= hb && h <= ht) L += ds;
    }
    return L;
  };
  {
    const out: any = { cases: [] };
    const law1 = [TA.tsunUniformLaw(1), null, null, null];
    for (const e of [1.108, 0.3, -0.25, -0.5, -1.0, -1.5]) for (const hf of [0, 0.02, 0.5, 1.0]) {
      const bi: any = synth(e, [[1, 2]]); const g = TA.tsunFrameGeom(bi);
      const h = 1 + hf, line = TA.tsunLineTau(bi, law1, 0, 0, h);
      const P = [g.O[0], g.O[1], Math.sqrt((g.R + h) ** 2 - g.O[0] ** 2 - g.O[1] ** 2)];
      const b = brute(P, g.sun, 1, 2, g.R, 400, 0.001);
      const sinE = (P[0] * g.sun[0] + P[1] * g.sun[1] + P[2] * g.sun[2]) / Math.hypot(...P);
      const cf = TA.tsunPathKm(h, sinE, 1, 2, 400, g.R);
      out.cases.push({ e, hf, lp3: line.tau, brute: b, closed: cf, ground: line.ground, relBrute: b > 0.05 ? Math.abs(line.tau - b) / b : Math.abs(line.tau - b), relClosed: line.ground ? null : (cf > 0.05 ? Math.abs(line.tau - cf) / cf : Math.abs(line.tau - cf)) });
    }
    const c0 = out.cases.find((c: any) => c.e === 1.108 && c.hf === 0);
    out.base1108 = c0.lp3;
    res.u2b = out;
  }
  {
    const out: any = { rows: [] };
    for (const [hb, ht, lam] of [[1, 2, 1], [1.5, 4.5, 0.5]] as [number, number, number][]) for (const e of [1.108, 0.3, -0.5]) {
      const bi: any = synth(e, [[hb, ht]], 32, 40); const g = TA.tsunFrameGeom(bi); const laws = [TA.tsunUniformLaw(lam), null, null, null];
      const d = TA.buildTsunAtlasData(bi, laws);
      const rr = rng(23); let mx = 0, mxH = 0, mxAll = 0, nq = 0, nClamp = 0, mxClamp = 0;
      for (let k = 0; k < 600; k++) {
        const i = Math.floor(rr() * 32), j = Math.floor(rr() * 32), [x, y] = TA.tsunTexelPlanar(d, i, j);
        const he = hb + (ht - hb) * (0.001 + 0.998 * rr());
        const X = g.O[0] + x, Y = g.O[1] + y, Z = Math.sqrt((g.R + he) ** 2 - X * X - Y * Y), P = [X, Y, Z];
        const sinE = (X * g.sun[0] + Y * g.sun[1] + Z * g.sun[2]) / (g.R + he);
        const exact = lam * TA.tsunPathKm(he, sinE, hb, ht, 400, g.R);
        if (!(exact > 0.05)) continue;
        const sh = TA.tsunShaderTauCpu(d, g, P, 0, hb, ht, 0.3, false)!, shH = TA.tsunShaderTauCpu(d, g, P, 0, hb, ht, 0.3, true)!;
        const rel = Math.abs(sh - exact) / exact;
        // 셰이더 보간 계수 s 를 따로 셈 — D8 자름([−1, 2]) 밖이면 균일 층에서도 정확하지 않음(국소 해 < 0 에서 u_true 가 조각 사이에서 꺾임)
        const H = ht - hb, f = (he - hb) / H, S = TSUN_SLICE_HF, kk = f < S[1] ? 0 : f < S[2] ? 1 : 2;
        const u0 = TA.tsunPathKm(hb + S[kk] * H, sinE, hb, ht, 400, g.R), u1 = TA.tsunPathKm(hb + S[kk + 1] * H, sinE, hb, ht, 400, g.R);
        const sRaw = Math.abs(u1 - u0) < 1e-3 ? 0.5 : (TA.tsunPathKm(he, sinE, hb, ht, 400, g.R) - u0) / (u1 - u0);
        if (sRaw < -1 || sRaw > 2) { nClamp++; mxClamp = Math.max(mxClamp, rel); continue; }
        mxAll = Math.max(mxAll, rel);
        if (Math.hypot(x, y) <= 30) { mx = Math.max(mx, rel); nq++; }
        mxH = Math.max(mxH, Math.abs(shH - exact) / exact);
      }
      out.rows.push({ hb, ht, lam, e, nNear: nq, relMaxNear: mx, relMaxAll: mxAll, relMaxHalf: mxH, nClamp, relMaxClamp: mxClamp });
    }
    res.u2c = out;
  }
  // ───────── [U2g] 보고 ─────────
  res.u2g = {};
  for (const key of ['RA1_s1.1_V1', 'P3B', 'RA3_s1.1_V1', 'RA5_s1.1_V1']) {
    const bi = inputsOf[key], g = TA.tsunFrameGeom(bi), L = TA.tsunLawsFromFixture(fx, bi);
    const d = TA.buildTsunAtlasData(bi, L.laws);
    const dz = { ...d, tauCond: d.tauCond.map(() => 0) };
    const rr = rng(31); const dT: number[] = []; let n = 0; const band: number[][] = [[], [], []];
    for (let k = 0; k < 400; k++) {
      const lane = [0, 1, 2, 3].filter(q => d.laneBlock[q] >= 0)[k % d.blocks], lb = bi.lanes[lane];
      const rad = 90 * Math.sqrt(rr()), th = 2 * Math.PI * rr(), x = bi.centerKm[0] + rad * Math.cos(th), y = bi.centerKm[1] + rad * Math.sin(th);
      const he = lb.baseKm + (lb.topKm - lb.baseKm) * rr();
      const X = g.O[0] + x, Y = g.O[1] + y, Z = Math.sqrt((g.R + he) ** 2 - X * X - Y * Y), P = [X, Y, Z];
      const ref = TA.tsunReferenceTau(bi, L.laws, g, P, g.sun, { dsKm: 0.05 });
      if (ref.ground) continue;
      const sh = TA.tsunShaderTauCpu(dz, g, P, lane, lb.baseKm, lb.topKm, 0, true)!;
      dT.push(Math.abs(Math.exp(-sh) - Math.exp(-ref.tau))); n++;
      const hfq = (he - lb.baseKm) / (lb.topKm - lb.baseKm);
      band[hfq < 0.35 ? 0 : hfq < 0.68 ? 1 : 2].push(dT[dT.length - 1]);
    }
    res.u2g[key] = { n, p50: quant(dT, 0.5), p95: quant(dT, 0.95), max: Math.max(...dT), bands: band.map(b => ({ n: b.length, p50: quant(b, 0.5), p95: quant(b, 0.95) })), sunEl: g.sunElCenterDeg, laneCond: d.meta.laneCond, edge: d.meta.edgeCover };
  }
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(res, null, 1));
}

/** U2f 시간 — 저장한 P3B 입력에서(장면 없이). */
async function bench() {
  const fx = loadFixture();
  const base = JSON.parse(fs.readFileSync(path.join(OUT, 'input-P3B.json'), 'utf8'));
  const jit = !process.execArgv.includes('--jitless');
  const ci = { genus: 'ci', tileCover: 0.6, baseKm: 9.0, topKm: 9.8, macro: null, densityScale: 0.003 };
  const rows: any[] = [];
  for (const c of cfg.cases) {
    const lanes = c.lanes === 3 ? [base.lanes[0], base.lanes[1], ci, null] : base.lanes;
    const bi = withSun({ ...base, lanes, n: c.N, arch: !!c.arch }, c.e);
    const t0 = now();
    const L = TA.tsunLawsFromFixture(fx, bi);
    const t1 = now();
    const d = TA.buildTsunAtlasData(bi, L.laws, { now });
    const t2 = now();
    rows.push({ jit, N: c.N, lanes: c.lanes, arch: !!c.arch, e: c.e, msTotal: +(t2 - t0).toFixed(1), msLawTables: +(t1 - t0).toFixed(1), msBuild: +(t2 - t1).toFixed(1),
      msFits: +d.meta.msLaw.toFixed(1), msRows: +d.meta.msRows.toFixed(1), msRays: +d.meta.msRays.toFixed(1), msHalf: +d.meta.msHalf.toFixed(1), msSha: +d.meta.msSha.toFixed(1),
      rays: d.meta.rays, pieces: d.meta.pieces, K: d.K, w: d.width, h: d.height });
    console.log(JSON.stringify(rows[rows.length - 1]));
  }
  fs.writeFileSync(path.join(OUT, 'bench-' + (jit ? 'jit' : 'jitless') + '.json'), JSON.stringify({ load: require('os').loadavg(), rows }, null, 1));
}
(cfg.mode === 'bench' ? bench() : main()).catch(e => { console.error(e); process.exit(2); });
`;

(async () => {
  console.log(`[setup] 작업 폴더 ${WORK}`);
  // 거시 고리(P3B·RA3·RA5) — make-jobs-tsun.py 생성기, scenes-tsun.json 의 sha 와 대조(파일은 고치지 않음, .pyc 안 씀)
  const macros = path.join(WORK, 'macros.json');
  execFileSync('python3', ['-I', '-B', '-c', `
import sys, json, importlib.util
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('mj', ${JSON.stringify(path.join(ROOT, 'tools/genus-ruler/tsun/make-jobs-tsun.py'))})
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
S = json.load(open(${JSON.stringify(path.join(ROOT, 'tools/genus-ruler/tsun/scenes-tsun.json'))}))['scenes']
out = {}
for name, inp in [('P3B', S['P3B']['job']['input'])] + [(u['name'], u['input']) for u in S['RA']['units'] if u['name'] in ('RA3_s1.1_V1', 'RA5_s1.1_V1')]:
    ref = inp['macroRef']
    mac = m.GEN[ref['gen']](ref['params'])
    assert m.sha_obj(mac) == ref['sha256'], name
    out[name] = mac
json.dump(out, open(${JSON.stringify(macros)}, 'w'))
`], { env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' }, stdio: 'inherit' });
  const SC = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/genus-ruler/tsun/scenes-tsun.json'), 'utf8')).scenes;
  const unit = n => SC.RA.units.find(u => u.name === n);
  const ra = n => { const u = unit(n); return { input: u.input, options: u.options }; };
  const scenes = { P3B: { input: SC.P3B.job.input, options: SC.P3B.job.options }, 'RA1_s1.1_V1': ra('RA1_s1.1_V1'), 'RA3_s1.1_V1': ra('RA3_s1.1_V1'), 'RA5_s1.1_V1': ra('RA5_s1.1_V1') };
  const fixtureJson = path.join(ROOT, 'tools/genus-ruler/tsun/fixture/tsun-fixture.json'), fixtureBin = path.join(ROOT, 'tools/genus-ruler/tsun/fixture/tsun-fixture.bin');
  const ts = path.join(WORK, 'harness.ts'), cjs = path.join(WORK, 'harness.cjs');
  fs.writeFileSync(ts, HARNESS);
  execFileSync('npx', ['esbuild', ts, '--bundle', '--format=cjs', '--platform=node', '--define:__DEV__=false', '--define:process.env.EXPO_PUBLIC_VOLUMETRIC_SKY="1"', `--outfile=${cjs}`, '--log-level=error'], { cwd: ROOT, stdio: 'inherit' });
  const cfgMain = path.join(WORK, 'cfg-main.json');
  fs.writeFileSync(cfgMain, JSON.stringify({ mode: 'main', scenes, macros, fixtureJson, fixtureBin }));
  const t0 = Date.now();
  execFileSync('node', [cjs, cfgMain, WORK], { stdio: 'inherit' });
  console.log(`[setup] 주 실행 ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  const R = JSON.parse(fs.readFileSync(path.join(WORK, 'results.json'), 'utf8'));

  console.log('\n[wire] 배선(applyScene·setDate·setOptions·setTsunAtlas — 하네스 동기, 잡마다 한 번)');
  {
    const w = R.wire, f = w.first;
    ok(f.info.atlasValid && f.info.builds === 1 && f.on === 1 && f.info.atlasMeta.builder === 'LP3-fixture-v1' && /^[0-9a-f]{64}$/.test(f.info.atlasMeta.sha) && f.info.atlasMeta.fixtureSha === R.fixtureSha,
      `setScene(P3B, 해 ${f4(f.info.atlasMeta.sunAltDeg)}°) → 지어서 검: gTsunOn 1, 한 번, sha ${f.info.atlasMeta.sha.slice(0, 12)}…, 고정표 sha 기록, ${f.info.atlasMeta.buildMs.toFixed(0)} ms [measured]`);
    ok(f.tex && f.tex.w === 256 && f.tex.h === 128 && f.tex.type === 1016 && f.tex.data === 'Uint16Array' && f.tex.min === 1006 && f.tex.mag === 1006 && f.tex.flipY === false && f.tex.mip === false,
      `텍스처: ${f.tex && f.tex.w}×${f.tex && f.tex.h} = n·블록 2 × n, RGBA16F(HalfFloatType, Uint16), 선형, 밉맵 없음, flipY 없음`);
    ok(w.sameDate.builds === 1 && w.sameDate.sameTex, '같은 시각 setDate → 다시 짓지 않음(열쇠 같음)');
    ok(w.moved.builds === 2 && w.moved.valid && w.moved.sha !== f.info.atlasMeta.sha && w.moved.disp1, '해가 움직이면(+2 분) 다시 짓고 이 장면이 지은 옛 텍스처를 dispose');
    ok(w.high.injected === false && w.high.builds === 2 && /above shadowMinSunDeg/.test(w.high.autoReason || '') && w.high.uniforms.length === 0, `해 > 12° → 글자·균일변수 없음, 짓지 않음 (${w.high.autoReason})`);
    ok(w.back.builds === 3 && w.back.valid && w.back.on === 1 && w.back.sha === f.info.atlasMeta.sha, '12° 아래로 돌아오면 다시 지음 — 같은 장면·같은 해 = 같은 sha(결정적)');
    ok(w.n256.builds === 4 && w.n256.valid && w.n256.w === 512 && w.n256.h === 256, `setOptions({tsunN: 256}) → 다시 지음 ${w.n256.w}×${w.n256.h}`);
    ok(w.arch.builds === 5 && w.arch.valid && w.arch.w === 512 && w.arch.h === 768 && w.arch.archU.length === 2, `archLight 1 → 아치 블록 둘(높이 3n = ${w.arch.h}), gArchW·gArchNoT`);
    ok(w.restore.builds === 6 && w.restore.valid && w.restore.sha === f.info.atlasMeta.sha, 'tsunN 128·archLight 0 으로 되돌리면 다시 지어 처음과 같은 sha');
    ok(w.external.external && w.external.builds === 0 && /external/.test(w.external.autoReason) && w.external.texIsExt && w.external.ownDisp && w.external.extSha === w.external.autoSha,
      '밖 아틀라스(setTsunAtlas): 이 장면 텍스처를 버리고 검, 거는 동안 setDate 가 자동 구축 안 함, 같은 입력의 밖 구축 sha = 자동 구축 sha');
    ok(!w.extNull.external && w.extNull.builds === 1 && w.extNull.valid && !w.extNull.extDisposed, 'setTsunAtlas(null) → 다시 자동 구축, 밖 텍스처는 dispose 하지 않음(부른 쪽 소유)');
    ok(w.rescene.serial === 1 && w.rescene.builds === 1 && w.rescene.dispScene && w.rescene.valid && w.rescene.sha === f.info.atlasMeta.sha, 'setScene 다시 → 장면 번호 +1, 새로 지음, 옛 텍스처 dispose, 같은 sha');
    ok(w.determinism.a === w.determinism.f, `다른 장면 객체·같은 잡 → 같은 아틀라스 sha (${(w.determinism.f || '').slice(0, 12)}…)`);
    ok(w.syncOff.builds === 0 && !w.syncOff.valid && /tsunSync false/.test(w.syncOff.autoReason) && w.syncOff.reason === 'no atlas', 'tsunSync false → 짓지 않음(스케줄러 없음), gTsunOn 0 = C0ps 빛, 이유 기록');
    ok(w.noFixture.builds === 0 && !w.noFixture.valid && /no fixture/.test(w.noFixture.autoReason), '고정표 없음 → 짓지 않음, 이유 "no fixture"');
    ok(w.off.withFx.builds === 0 && w.off.withFx.uni === 0 && w.off.withFx.tex === w.off.noFx.tex && w.off.withFx.autoReason === null,
      `tsun 0 → 고정표를 줘도 짓지 않음·균일변수 없음·텍스처 수 같음(${w.off.withFx.tex} = ${w.off.noFx.tex})`);
  }

  console.log('\n[law] 고정표 법칙 표(tsunFixtureLaw, 결정 A2)');
  {
    const L = R.law;
    ok(L.replicaErr < 1e-12, `옮긴 섞음 규칙 = 평가기(tsunLambda10·tsunLawTau) 임의 800 점 최대 차 ${f4(L.replicaErr)}`);
    ok(L.nodeErr < 1e-9 && L.nodeN > 100, `고정표 마디(${L.nodeN} 점 × L 1/5/14 km): λ·G(λL) = 평가기 λ₁₀·τ(L), 최대 상대 차 ${f4(L.nodeErr)}`);
    info(`마디 사이(임의 c·hf·L): |T_표 − T_평가기(tsunCurveOfGrowth)| p95 ${f4(L.offG_p95)} · 최대 ${f4(L.offG_max)}, λ 상대 차 p95 ${f4(L.offLam_p95)} [computed]`);
    info('경고: ' + JSON.stringify(L.warnings));
  }

  console.log('\n[U2a] LP3 vs 수렴한 기준 구적(같은 법칙, 참 3-D 광선 50 m)');
  for (const sc of ['B', 'A']) for (const r of R.u2a[sc]) {
    const lim = r.e >= 4 ? 0.007 : 0.01;
    ok(r.p95 <= lim && r.n > 500, `장면 ${sc === 'B' ? 'B(P3B, 거시 1)' : 'A(RA1, 거시 0)'} 해 ${r.e}°(K ${r.K}): dT p95 ${f4(r.p95)} ≤ ${lim} · 최대 ${f4(r.max)} · half 텍셀 p95 ${f4(r.p95half)} · ${r.n} 광선(땅 ${r.ground}) · τ ${f4(r.tauRange[0])}…${f4(r.tauRange[1])} · 구축 ${r.buildMs.toFixed(0)} ms`);
    if (r.max > 0.05) info(`  └ 최악 광선: ${JSON.stringify(r.worst.map(w => ({ dT: +w.dT.toFixed(3), lane: w.lane, i: w.i, j: w.j, s: w.s, lp3: +w.lp3.toFixed(3), ref: +w.ref.toFixed(3) })))}`);
  }
  info(`기준 수렴: 50 m vs 25 m 최대 dT ${f4(R.refConv.maxdT_50_vs_25m)} (P3B +1.108°, 64 광선)`);

  console.log('\n[U2b] 균일 층 τ vs 구면 닫힌 꼴');
  {
    const U = R.u2b;
    ok(Math.abs(U.base1108 / 43.89 - 1) <= 0.005, `1 km 층(1~2 km) 밑에서 해 +1.108°: LP3 ${U.base1108.toFixed(3)} km vs 43.89 km ±0.5 % (${((U.base1108 / 43.89 - 1) * 100).toFixed(3)} %)`);
    const worstB = Math.max(...U.cases.map(c => c.relBrute)), worstC = Math.max(...U.cases.filter(c => c.relClosed != null).map(c => c.relClosed));
    ok(worstB <= 1e-3, `U2b′ e ∈ {−1.5…+1.108}° × hf 0/0.02/0.5/1: LP3 vs 1 m 무차별(땅에서 끊음, 설계 5 m 보다 촘촘 — 5 m 는 경계 둘에서 ±10 m 라 10 km 길에서 이미 1e-3) 최대 상대 ${f4(worstB)} ≤ 1e-3 (${U.cases.length} 경우, 땅 닿음 ${U.cases.filter(c => c.ground).length})`);
    ok(worstC <= 1e-3, `땅에 안 닿는 경우 LP3 vs u_true 닫힌 꼴(tsunPathKm = gTsunPath) 최대 상대 ${f4(worstC)} ≤ 1e-3`);
  }

  console.log('\n[U2c] 균일 층 u_true 조각 보간(I-2 CPU 거울)');
  for (const r of R.u2c.rows) {
    ok(r.relMaxNear < 1e-4 && r.nNear > 50, `층 ${r.hb}~${r.ht} km λ ${r.lam} · 해 ${r.e}°: 관측점 30 km 안 텍셀 중심 ${r.nNear} 점(보간 계수가 D8 자름 [−1, 2] 안) 최대 상대 ${f4(r.relMaxNear)} < 1e-4 (아틀라스 전체 ${f4(r.relMaxAll)}, half 텍셀 ${f4(r.relMaxHalf)})`);
    if (r.nClamp) info(`  └ 같은 경우 D8 자름에 걸린 점 ${r.nClamp} — 최대 상대 ${f4(r.relMaxClamp)} (국소 해 < 0: 층 밑 근처에서 u_true 가 조각 0.02·0.35 사이에서 꺾여 s 가 2 를 넘음 — WP4 셰이더 결정 D8 의 대가, 고치지 않음)`);
  }

  console.log('\n[U2d] 아치 블록(LP3 옆 흐름 무시) vs 참 3-D 아치 광선');
  for (const r of R.u2d) {
    ok(r.p95 <= 0.03 && r.n > 500, `P3B 해 ${r.e}°(K ${r.K}): T_g = e^−(own+rest) dT p95 ${f4(r.p95)} ≤ 0.03 · 최대 ${f4(r.max)} · own 만 p95 ${f4(r.ownP95)} (${r.n} 광선; 아치 광선은 해 방위에만 매여 고도와 무관 — K 가 같으면 같은 값)`);
    if (r.max > 0.05) info(`  └ 최악 광선: ${JSON.stringify(r.worst.map(w => ({ dT: +w.dT.toFixed(3), lane: w.lane, i: w.i, j: w.j, sl: w.sl, g: w.g, own: +w.own.toFixed(3), rest: +w.rest.toFixed(3), refOwn: +w.refOwn.toFixed(3), refRest: +w.refRest.toFixed(3) })))}`);
  }

  console.log('\n[U2e] 등록(종류 평면 ↔ ECEF ↔ 셰이더 uv, §173 원점)');
  for (const [k, g] of Object.entries(R.u2e)) {
    ok(g.eTexM < 1 && g.eHm < 1 && g.ePlM < 1, `${k}: 텍셀 → ECEF → 셰이더 uv 왕복 ${f4(g.eTexM)} m · 높이 ${f4(g.eHm)} m · 평면 ${f4(g.ePlM)} m (< 1 m, 400 점)`);
    ok(g.centerErrM < 1, `${k}: 관측점(ECEF + 고도 보정 ${g.altCorrKm.map(x => x.toFixed(2)).join('/')} km) 의 종류 평면 = 아틀라스 중심 ${JSON.stringify(g.centerKm)} — 차 ${f4(g.centerErrM)} m (원점까지 ${f4(g.originOffKm)} km)`);
    ok(g.eLatM < 1e-3 && g.minAlongKm > 0 && g.ortho < 1e-12, `${k}: 해 광선 50 km 의 평면 투영이 줄과 평행(옆 ${f4(g.eLatM)} m, 앞으로 ≥ ${f4(g.minAlongKm)} km), 동·북 직교 ${f4(g.ortho)}`);
    ok(g.nMac > 50 && g.eMac < 1e-9, `${k}: 거시 격자 읽기(이류·채널·mix·선형 필터·min(C, 타일 운량)) = 셰이더 식 ${g.nMac} 점 최대 차 ${f4(g.eMac)}`);
    ok(g.edges.every(x => x == null || (x >= 0 && x < 1)), `${k}: 격자 밖 = 부채꼴 평균(결코 1.0 아님) ${JSON.stringify(g.edges.map(x => x == null ? null : +x.toFixed(4)))}`);
  }
  ok(R.u2e.offset.valid && Math.hypot(R.u2e.offset.centerKm[0] - 3.2, R.u2e.offset.centerKm[1] + 1.7) < 1e-9, 'weatherOffsetKm [3.2, −1.7] → 아틀라스 중심이 그 오프셋(관측점)');

  console.log('\n[U2g] (보고) 셰이더 길 τ(half 텍셀 + u_true 보간, τ_c 뺌) vs 참 선 기준');
  for (const [k, g] of Object.entries(R.u2g)) info(`${k} 해 ${f4(g.sunEl)}°: ${g.n} 점 dT p50 ${f4(g.p50)} · p95 ${f4(g.p95)} · 최대 ${f4(g.max)}; hf 띠 [0, .35)·[.35, .68)·[.68, 1] p95 ${g.bands.map(b => f4(b.p95) + ' (' + b.n + ')').join(' · ')}; τ_c 운량·L ${JSON.stringify(g.laneCond.map(c => ({ lane: c.lane, c: +c.cover.toFixed(3), L: c.L.map(x => +x.toFixed(2)) })))}`);

  if (!NO_BENCH) {
    console.log('\n[U2f] 시간 기록(판정 없음) — node ' + process.version + ', 부하 ' + os.loadavg().map(x => x.toFixed(2)).join('/'));
    const casesJ = [];
    for (const N of [128, 256]) for (const lanes of [2, 3]) for (const arch of [0, 1]) for (const e of [-1.4, 1.108, 8]) casesJ.push({ N, lanes, arch, e });
    const casesL = [{ N: 128, lanes: 2, arch: 0, e: 1.108 }, { N: 128, lanes: 3, arch: 0, e: 1.108 }, { N: 128, lanes: 3, arch: 0, e: -1.4 }, { N: 128, lanes: 3, arch: 1, e: 1.108 }];
    for (const [flag, cases] of [[[], casesJ], [['--jitless'], casesL]]) {
      const c = path.join(WORK, 'cfg-bench.json');
      fs.writeFileSync(c, JSON.stringify({ mode: 'bench', macros, fixtureJson, fixtureBin, cases }));
      execFileSync('node', [...flag, cjs, c, WORK], { stdio: ['ignore', 'pipe', 'inherit'] });
      const B = JSON.parse(fs.readFileSync(path.join(WORK, 'bench-' + (flag.length ? 'jitless' : 'jit') + '.json'), 'utf8'));
      for (const r of B.rows) info(`${r.jit ? 'JIT' : 'jitless'} N ${r.N} 레인 ${r.lanes} 아치 ${+r.arch} 해 ${r.e}° (K ${r.K}, ${r.w}×${r.h}): 합 ${r.msTotal} ms = 법칙 표 ${r.msLawTables} + 맞춤 ${r.msFits} + 줄 누적합 ${r.msRows} + 광선 ${r.msRays} + half ${r.msHalf} + sha ${r.msSha} [measured]`);
    }
  }

  console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'} — ${pass} pass / ${fail} fail (작업 폴더 ${WORK})`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
