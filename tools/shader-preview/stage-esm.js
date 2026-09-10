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
const { PREVIEW } = require('./paths');
const APP = path.join(PREVIEW, 'app');

const ENTRIES = [
  'src/components/SkyScene3D/StarField.ts',
  'src/components/SkyScene3D/MilkyWayBand.ts',
  'src/components/SkyScene3D/CelestialPathMesh.ts',
  'src/components/SkyScene3D/cloudPlacement.ts',
  'src/components/SkyScene3D/cloudAtlas.ts',
  'src/components/SkyScene3D/CloudField.ts',
  'src/components/SkyScene3D/CloudDeck.ts',
  'src/components/SkyScene3D/SceneComposer.ts',
  'src/components/SkyScene3D/CloudSlab.ts',
  // A/B 습작이 씁니다 — PR #14 시점 슬랩의 사본입니다. 앱은 임포트하지
  // 않습니다(번들에 안 들어갑니다). 지금 셰이더와 그때 셰이더를 **같은
  // 페이지에서 같은 입력**으로 나란히 그리려면 둘 다 있어야 합니다.
  'src/components/SkyScene3D/CloudSlabPrev.ts',
  'src/components/SkyScene3D/cloudCellTexture.ts',
  'src/components/SkyScene3D/Skydome.ts',
  'src/components/SkyScene3D/TerrainRing.ts',
  'src/components/SkyScene3D/groundProjection.ts',
  'src/components/SkyScene3D/TerrainField.ts',
  'src/components/SkyScene3D/SeaPlane.ts',
  // 박명광선 습작이 씁니다 — 광선의 원천(태양 원반)과, 끌려오면 안 되는
  // 밝은 것(달)이 화면에 없으면 무엇을 재는지 알 수 없습니다.
  'src/components/SkyScene3D/SunMesh.ts',
  'src/components/SkyScene3D/MoonMesh.ts',
  'src/utils/cloudGridAdapter.ts',
  // 2D 수역 마스크. main 이 지면 셰이더를 uWaterTex2D 로 바꾸면서 필요해졌는데
  // 여기 목록에 안 들어와 있었습니다 — 그래서 물 하네스가 낡은 1D 텍스처를
  // 계속 쓰고 있었습니다.
  'src/utils/waterMask.ts',
  // DEM 타일 (해안선 계획 1단계)
  'src/utils/demTiles.ts',
  // AR 방위각 ↔ 화소 사상. 나침반 눈금자와 시뮬레이터가 **같은 함수**를
  // 쓰게 하려고 뽑아낸 것이라, 하네스도 베끼지 말고 이것을 임포트합니다.
  'src/utils/arProjection.ts',
  'src/utils/modelBlend.ts',
  'src/utils/localDate.ts',
  'src/utils/devicePose.ts',
  // 자이로·자기 방위 융합. 화면·센서에서 떼어낸 순수 논리라 가짜 센서 열로
  // 판정할 수 있습니다 (verify-heading-fusion.js).
  'src/utils/headingFusion.ts',
];

fs.rmSync(OUT, { recursive: true, force: true });
// tsc는 타입 오류가 있어도 emit합니다. 리포에는 이 작업과 무관한 기존 오류
// (sunsetPhysics의 CloudData 유니온, weather.ts의 __DEV__ 전역)가 있으므로
// 종료 코드로 실패시키지 않고, **출력이 실제로 나왔는지**로 판단합니다.
try {
  execFileSync('npx', ['tsc', '--module', 'esnext', '--target', 'es2020',
    '--moduleResolution', 'bundler', '--skipLibCheck', '--outDir', OUT, ...ENTRIES],
    { cwd: SRC, stdio: 'pipe' });
} catch (e) {
  // 무시 — 아래에서 산출물 존재로 검증합니다.
}
for (const entry of ENTRIES) {
  const emitted = path.join(OUT, entry.replace(/^src\//, '').replace(/\.ts$/, '.js'));
  if (!fs.existsSync(emitted)) {
    throw new Error(`tsc가 ${entry} 를 emit하지 못했습니다 (${emitted} 없음)`);
  }
}

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

// vendor: three는 **node_modules에서** 가져옵니다. 예전에는 PREVIEW에 미리
// 받아둔 사본을 `if (exists)`로 복사했는데, /tmp가 비워지거나 사본이 사라지면
// 조용히 건너뛰고 브라우저에서만 404가 나 "__stats가 없습니다"로 나타났습니다
// (원인을 찾는 데 한참 걸립니다). 앱이 실제로 쓰는 버전과 같아야 하기도 하고요.
// three.module.js는 three.core.js를 import하므로 둘 다 필요합니다.
{
  const buildDir = path.join(SRC, 'node_modules/three/build');
  for (const f of ['three.module.js', 'three.core.js']) {
    const from = path.join(buildDir, f);
    if (!fs.existsSync(from)) {
      throw new Error(`${from} 가 없습니다 — npm install 이 필요합니다`);
    }
    fs.copyFileSync(from, path.join(APP, 'vendor', f));
  }
}
// sunsetPhysics는 sky_weights_v2.json을 import합니다. 브라우저는 JSON 모듈을
// import attribute 없이 못 읽으므로, ESM 래퍼로 감싸 같은 경로에 둡니다.
// (상대 import에 .js를 붙이는 규칙과 맞물려 './sky_weights_v2.json.js'가 됩니다.)
{
  const weightsSrc = path.join(SRC, 'src/utils/sky_weights_v2.json');
  if (fs.existsSync(weightsSrc)) {
    fs.mkdirSync(path.join(APP, 'utils'), { recursive: true });
    fs.writeFileSync(
      path.join(APP, 'utils', 'sky_weights_v2.json.js'),
      'export default ' + fs.readFileSync(weightsSrc, 'utf8') + ';\n'
    );
  }
}

const sc = fs.readFileSync(path.join(SRC, 'node_modules/suncalc/suncalc.js'), 'utf8');
fs.writeFileSync(path.join(APP, 'vendor', 'suncalc.js'),
  'const module={exports:{}};const exports=module.exports;\n' + sc + '\nexport default module.exports;\n');
fs.writeFileSync(path.join(APP, 'vendor', 'date-fns.js'),
  '// 미리보기 전용 최소 shim — date-fns의 addHours/startOfDay와 동일한 동작\n' +
  'export function addHours(d, n) { return new Date(d.getTime() + n * 3600000); }\n' +
  'export function startOfDay(d) { const x = new Date(d.getTime()); x.setHours(0, 0, 0, 0); return x; }\n');

console.log(`준비 완료: ${files.length}개 모듈 + vendor 4개`);
