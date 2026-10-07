#!/usr/bin/env node
/**
 * tile-gen.mjs — 앱의 cloudGenus.ts(+cloudFlow.ts)를 esbuild 로 묶어 날씨 타일을 만들고 층마다 d 채널을 8비트 PNG 로 씁니다(§130).
 * GPU 없이 위에서 본 자(tile.py)를 돌리기 위한 것입니다.
 *
 *   node tools/genus-ruler/flow/tile-gen.mjs jobs.json outDir [--seeds 7,1007,2007,3007]
 *
 * jobs.json = [{ name, layers: [{ genus, cover(예보 운량 0~1), opts? } | null …], seed?, options?: { flow, flowDensity, flowN, flowSteps,
 *   flowHours, flowVrms, flowPsiEvery, coverRemap } }]. 운량은 volumetricScene.weatherPlan 과 같은 길(1 % 눈금 → 종류 역표 또는 흐름 역표)을
 *   밟고, 흐름이면 planFlowScene 이 핵 매개변수를 정합니다(같은 함수). --seeds 가 있으면 잡마다 씨앗을 바꿔 여러 장 냅니다.
 * 출력: outDir/<name>[.s<seed>].L<k>.png, outDir/gen.json(areaTop·coverIn·ms).
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const [jobsFile, outDir, ...rest] = process.argv.slice(2);
if (!jobsFile || !outDir) { console.error('usage: tile-gen.mjs jobs.json outDir [--seeds 7,1007]'); process.exit(2); }
const seedsArg = rest.indexOf('--seeds');
const seeds = seedsArg >= 0 ? rest[seedsArg + 1].split(',').map(Number) : null;
fs.mkdirSync(outDir, { recursive: true });
const BUNDLE = path.join(outDir, 'cloudGenus.cjs');
execFileSync('npx', ['esbuild', path.join(ROOT, 'src/components/VolumetricProbe/cloudGenus.ts'), '--bundle', '--format=cjs', '--platform=node',
  '--external:three', `--outfile=${BUNDLE}`, '--log-level=warning'], { cwd: ROOT, stdio: 'inherit' });
// three 의 DataTexture 는 바이트를 담는 상자일 뿐 — node 에서는 가짜로 대신합니다(렌더 없음).
const require = createRequire(import.meta.url);
const Module = require('node:module');
const origLoad = Module._load;
Module._load = function (req, ...a) {
  if (req === 'three') return {
    DataTexture: class { constructor(data, w, h) { this.image = { data, width: w, height: h }; } },
    LinearFilter: 0, LinearMipMapLinearFilter: 0, NoColorSpace: '', RepeatWrapping: 0, RGBAFormat: 0, UnsignedByteType: 0,
    Vector3: class { constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; } set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } copy(v) { return this.set(v.x, v.y, v.z); } normalize() { return this; } },
    Vector4: class { constructor(x = 0, y = 0, z = 0, w = 0) { this.x = x; this.y = y; this.z = z; this.w = w; } set(x, y, z, w) { this.x = x; this.y = y; this.z = z; this.w = w; return this; } },
  };
  return origLoad.call(this, req, ...a);
};
const G = require(BUNDLE);
const { PNG } = require(path.join(ROOT, 'node_modules/pngjs'));
const S = 512, TILE = 24;
const quantCover = c => Math.round(Math.max(0, Math.min(1, c)) * 100) / 100;
const DEF = { flow: false, flowDensity: true, flowN: 64, flowSteps: 20, flowHours: 0.5, flowVrms: 2, flowPsiEvery: 2, coverRemap: true };

function dump(file, bytes, k) {
  const png = new PNG({ width: S, height: S, colorType: 0 });
  for (let i = 0; i < S * S; i++) { const v = bytes[i * 4 + k]; png.data[i * 4] = png.data[i * 4 + 1] = png.data[i * 4 + 2] = v; png.data[i * 4 + 3] = 255; }
  fs.writeFileSync(file, PNG.sync.write(png));
}

const jobs = JSON.parse(fs.readFileSync(jobsFile, 'utf8'));
const res = {};
for (const job of jobs) {
  const opt = { ...DEF, ...(job.options ?? {}) };
  for (const seed of seeds ?? [job.seed ?? 7]) {
    const inputs = (job.layers ?? []).slice(0, 4);
    // volumetricScene.weatherPlan 과 같은 길.
    const gl = inputs.map((L, i) => {
      if (!L || !L.genus || !(L.cover > 0)) return null;
      const qc = quantCover(L.cover);
      if (!opt.flow) return { genus: L.genus, cover: opt.coverRemap ? G.genusCoverIn(L.genus, qc) : qc, opts: L.opts };
      const above = inputs.slice(i + 1).find(o => o && o.baseKm != null && L.baseKm != null && o.baseKm > L.baseKm);
      const shearDzKm = Math.max(0.5, (above?.baseKm ?? (L.baseKm ?? 0) + 3) - (L.baseKm ?? 0));
      return G.mergeFlowOpts({ genus: L.genus, cover: G.flowCoverIn(L.genus, qc), opts: { ...L.opts, shearDzKm, flowSeed: L.opts?.flowSeed ?? seed } });
    });
    const flow = opt.flow ? G.planFlowScene(gl, { n: opt.flowN, steps: opt.flowSteps, hours: opt.flowHours, vrms: opt.flowVrms, psiEvery: opt.flowPsiEvery }) : null;
    const t0 = Date.now();
    const tex = G.makeGenusWeather(gl, S, TILE, seed, [], flow);
    const ms = Date.now() - t0;
    const d = tex.image.data;
    const name = seeds ? `${job.name}.s${seed}` : job.name;
    const row = { ms, flow: !!flow, layers: [] };
    gl.forEach((L, k) => {
      if (!L) return;
      let nz = 0; for (let i = 0; i < S * S; i++) if (d[i * 4 + k] > 0) nz++;
      dump(path.join(outDir, `${name}.L${k}.png`), d, k);
      row.layers.push({ k, genus: L.genus, coverIn: +L.cover.toFixed(4), areaTop: +(nz / (S * S)).toFixed(4) });
    });
    res[name] = row;
    console.log(name, JSON.stringify(row));
  }
}
fs.writeFileSync(path.join(outDir, 'gen.json'), JSON.stringify(res, null, 1));
