/**
 * g1-swiftshader.cjs — `node --require` preload for G1(b) renders (opt-in, g1-render --swiftshader-threads N).
 *
 * Why: the takram cloud ray-march takes dFdx/dFdy (getMipLevel) inside `if (!intersectsGround && !intersectsScene)`, i.e. in
 * non-uniform control flow (GLSL undefined behaviour). In 2×2 quads that straddle the horizon SwiftShader fills the derivative
 * from lanes that skipped the branch, whose values are left-overs of whatever that worker thread ran before. With 4 workers the
 * left-overs depend on scheduling, so a few horizon texels of P0_seoul change from run to run (rgb 97b2edf6/a6d7d5c8 control,
 * ee0ad83b/bc8cd61f/520cb701/... G1). With ONE worker the order is fixed and the render is repeatable.
 *
 * How: SwiftShader reads `SwiftShader.ini` ([Processor] ThreadCount) from the directory of the running chrome executable (ANGLE
 * chdir()s there while it loads the SwiftShader ICD). g1-render makes a hard-linked copy of the chromium directory that run.js
 * names (same files, same inodes — same binary, version and flags) plus that ini, and sets G1_SWIFTSHADER_DIR to it. This preload
 * then redirects chromium.launch() of the playwright module that run.js / g1-keys.cjs load to `<dir>/chrome`. Nothing in
 * tools/genus-ruler/volsky or src/ changes; without G1_SWIFTSHADER_DIR this file does nothing.
 */
'use strict';
const dir = process.env.G1_SWIFTSHADER_DIR;
if (dir) {
  const fs = require('fs'), path = require('path');
  const runJs = path.join(__dirname, '../../volsky/run.js');   // tools/genus-ruler/volsky/run.js
  const m = fs.readFileSync(runJs, 'utf8').match(/require\('([^']*playwright)'\)/);
  if (!m) throw new Error('g1-swiftshader: playwright path not found in run.js');
  const exe = path.join(dir, 'chrome');
  if (!fs.existsSync(exe) || !fs.existsSync(path.join(dir, 'SwiftShader.ini'))) throw new Error(`g1-swiftshader: ${dir} is not prepared`);
  const pw = require(m[1]);
  const launch = pw.chromium.launch.bind(pw.chromium);
  pw.chromium.launch = (opts = {}) => launch({ ...opts, executablePath: exe });
}
