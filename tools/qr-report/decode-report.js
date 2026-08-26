#!/usr/bin/env node
/**
 * decode-report.js
 *
 * `SimReportQR`가 화면에 그린 QR을 캡처 이미지에서 되읽습니다.
 * `src/utils/simReport.ts`의 `SimReportPayload`와 같은 스키마입니다 —
 * 스키마가 바뀌면 이 스크립트가 아니라 그 파일이 진실입니다.
 *
 * PNG·JPEG 둘 다 받습니다. 이미지 전체에서 QR을 찾으므로 크롭할 필요가
 * 없습니다 — 캡처 파일 전체를 그대로 넘기면 됩니다.
 *
 * 사용:
 *   node tools/qr-report/decode-report.js <이미지 경로>
 *   node tools/qr-report/decode-report.js <이미지 경로> --json   (원본 JSON만 출력)
 */
const fs = require('fs');
const path = require('path');
const jsQR = require('jsqr');
const { PNG } = require('pngjs');
const jpeg = require('jpeg-js');

function loadRGBA(filePath) {
  const buf = fs.readFileSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const isPng = ext === '.png' || (buf[0] === 0x89 && buf[1] === 0x50);
  if (isPng) {
    const png = PNG.sync.read(buf);
    return { data: png.data, width: png.width, height: png.height };
  }
  const img = jpeg.decode(buf, { useTArray: true });
  return { data: img.data, width: img.width, height: img.height };
}

function main() {
  const args = process.argv.slice(2);
  const imgPath = args.find(a => !a.startsWith('--'));
  const jsonOnly = args.includes('--json');

  if (!imgPath) {
    console.error('사용: node decode-report.js <이미지 경로> [--json]');
    process.exit(2);
  }
  if (!fs.existsSync(imgPath)) {
    console.error('파일을 찾을 수 없습니다:', imgPath);
    process.exit(2);
  }

  let data, width, height;
  try {
    ({ data, width, height } = loadRGBA(imgPath));
  } catch (err) {
    console.error(`이미지를 열지 못했습니다 (PNG·JPEG만 지원): ${err.message}`);
    process.exit(2);
  }
  const result = jsQR(new Uint8ClampedArray(data), width, height);

  if (!result) {
    console.error('QR을 찾지 못했습니다 — SimReportQR 오버레이가 켜져 있었는지,');
    console.error('캡처에 그 부분(화면 왼쪽 아래)이 잘리지 않았는지 확인하세요.');
    process.exit(1);
  }

  let payload;
  try {
    payload = JSON.parse(result.data);
  } catch {
    console.error('QR은 읽었지만 JSON이 아닙니다 (다른 QR을 읽었을 수 있습니다):');
    console.error(result.data);
    process.exit(1);
  }

  if (jsonOnly) {
    console.log(JSON.stringify(payload));
    return;
  }

  console.log('== SimReportQR 디코드 결과 ==');
  console.log(`  버전 v${payload.v}`);
  console.log(`  시각 ${payload.t}`);
  console.log(`  위치 ${payload.lat}, ${payload.lon}  (고도 ${payload.elevM}m)`);
  console.log(`  태양 고도 ${payload.sunAlt}°  방위 ${payload.sunAz}°`);
  console.log('  관측점 예보:');
  const o = payload.obs ?? {};
  console.log(`    운량  저 ${o.low}%  중 ${o.mid}%  상 ${o.high}%`);
  if (o.humidity != null) console.log(`    습도  ${o.humidity}%`);
  if (o.precip != null) console.log(`    강수  ${o.precip} mm/h`);
  if (o.vis != null) console.log(`    시정  ${o.vis} m`);
  if (o.dni != null) console.log(`    DNI   ${o.dni} W/m²`);
  if (o.water != null) console.log(`    수분  ${o.water} kg/m²`);
  if (payload.wind) {
    console.log(
      `  바람  ${payload.wind.kmh} km/h, ${payload.wind.deg}°` +
        (payload.wind.synthetic ? '  ⚠ 실측 아님 — 대용 상수' : '')
    );
  }
  console.log('\n원본 JSON:');
  console.log(JSON.stringify(payload, null, 2));
}

main();
