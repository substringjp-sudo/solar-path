/**
 * SkyScene3D 모듈을 브라우저에서 그대로 실행할 수 있게 준비합니다.
 *
 * tsc가 뱉은 ESM은 `from 'three'`, `from './x'` 처럼 브라우저가 해석할 수 없는
 * 지정자를 씁니다. 여기서 vendor 경로와 .js 확장자로만 고쳐서 넣습니다 —
 * **로직은 한 줄도 건드리지 않습니다.** 그래야 미리보기가 앱과 같은 코드가 됩니다.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const SRC = '/home/user/solar-path';
const OUT = '/tmp/esmbuild';
const PREVIEW = '/tmp/claude-0/-home-user-solar-path/eaf4c0af-06ca-5c06-a0d7-588dbfb07373/scratchpad/preview';
const APP = path.join(PREVIEW, 'app');

const ENTRIES = [
  'src/components/SkyScene3D/StarField.ts',
  'src/components/SkyScene3D/MilkyWayBand.ts',
  'src/components/SkyScene3D/CelestialPathMesh.ts',
];

fs.rmSync(OUT, { recursive: true, force: true });
execFileSync('npx', ['tsc', '--module', 'esnext', '--target', 'es2020',
  '--moduleResolution', 'bundler', '--skipLibCheck', '--outDir', OUT, ...ENTRIES],
  { cwd: SRC, stdio: 'inherit' });

for (const d of ['components', 'utils']) fs.rmSync(path.join(APP, d), { recursive: true, force: true });
fs.mkdirSync(path.join(APP, 'vendor'), { recursive: true });
fs.cpSync(OUT, APP, { recursive: true });

const VENDOR = {
  three: 'three.module.js',
  suncalc: 'suncalc.js',
  'date-fns': 'date-fns.js',
};

const walk = d => fs.readdirSync(d, { withFileTypes: true })
  .flatMap(e => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));

const files = walk(APP).filter(f => f.endsWith('.js') && !f.includes(`${path.sep}vendor${path.sep}`));
for (const f of files) {
  const rel = path.relative(path.dirname(f), APP) || '.';
  const vendorDir = (rel === '' ? '.' : rel) + '/vendor';
  let s = fs.readFileSync(f, 'utf8');
  s = s.replace(/from\s+(['"])([^'"]+)\1/g, (m, q, spec) => {
    if (VENDOR[spec]) return `from "${vendorDir}/${VENDOR[spec]}"`;
    if (spec.startsWith('.')) return `from "${spec}.js"`;
    return m;
  });
  fs.writeFileSync(f, s);
}

// vendor: three는 미리 받아둔 것을 쓰고, suncalc은 UMD를 ESM으로 감쌉니다.
for (const f of ['three.module.js', 'three.core.js']) {
  const from = path.join(PREVIEW, f);
  if (fs.existsSync(from)) fs.copyFileSync(from, path.join(APP, 'vendor', f));
}
const sc = fs.readFileSync(path.join(SRC, 'node_modules/suncalc/suncalc.js'), 'utf8');
fs.writeFileSync(path.join(APP, 'vendor', 'suncalc.js'),
  'const module={exports:{}};const exports=module.exports;\n' + sc + '\nexport default module.exports;\n');
fs.writeFileSync(path.join(APP, 'vendor', 'date-fns.js'),
  '// 미리보기 전용 최소 shim — date-fns의 addHours/startOfDay와 동일한 동작\n' +
  'export function addHours(d, n) { return new Date(d.getTime() + n * 3600000); }\n' +
  'export function startOfDay(d) { const x = new Date(d.getTime()); x.setHours(0, 0, 0, 0); return x; }\n');

console.log(`준비 완료: ${files.length}개 모듈 + vendor 4개`);
