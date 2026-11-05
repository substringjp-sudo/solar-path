/**
 * g1-swiftshader.cjs — `node --require` preload for G1(b) renders (opt-in, g1-render --swiftshader-threads N).
 *
 * Why (scratchpad g1det): with a bit-identical WebGL command stream and bit-identical inputs, SwiftShader's multi-worker execution
 * of ONE draw — the takram cloud ray-march (quarter-resolution CloudsPass current target) — now and then writes 1–2 horizon texels
 * (quarter-res row 3) ~1 half-float ulp differently, in single frames at certain temporal-jitter phases. The 16-frame temporal
 * upscale carries it to the output, so P0_seoul's rgb lands on one of a few discrete states (control 97b2edf6/a6d7d5c8, G1
 * ee0ad83b/bc8cd61f/520cb701/771abaab/...). Not the CPU/GL side, not GPU command timing (gl.finish after every draw keeps it), not
 * ANGLE async GC / command-buffer reset, not the FP mode (all workers FTZ|DAZ). Two shader candidates were tested and did NOT remove it
 * (marchOpticalDepth's unwritten out param; getMipLevel's dFdx/dFdy in non-uniform control flow) — the instruction-level cause
 * inside SwiftShader is not isolated. With ONE SwiftShader worker the render is repeatable (on a different, equally valid state).
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
