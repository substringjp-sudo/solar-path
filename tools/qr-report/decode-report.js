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
 *
 * 2026-09-27 부터 `view`(3D 시선)·`slab`(구름판이 받은 값)·`gl`(썸네일 밝기)이 붙습니다 — 예보
 * 입력만으로는 기기 화면을 되살리지 못했기 때문입니다. 없는 옛 QR 도 그대로 읽습니다.
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
  if (payload.view) {
    const v = payload.view;
    console.log(`  시선  방위 ${v.az}°  고도 ${v.el}°  기울임 ${v.roll}°  세로 화각 ${v.fov}°  가로/세로 ${v.asp}`);
  }
  if (payload.gl != null) console.log(`  GL 버퍼 밝기 ${payload.gl}`);
  if (payload.slab) {
    const b = payload.slab;
    console.log('  구름판 (셰이더가 받은 값):');
    console.log(`    층 높이  저 ${b.alt[0]} · 중 ${b.alt[1]} · 상 ${b.alt[2]} km   눈높이 ${b.eyeM} m`);
    console.log(`    운해     ${b.deck[1] > 0 ? `${b.deck[0]}~${b.deck[1]} km` : '없음'}`);
    console.log(`    구름 속  ${b.fog[0] > 0 ? `소광 ${b.fog[0]} /km, ${b.fog[1]}~${b.fog[2]} km` : '아님'}`);
    console.log(`    이류 ${b.drift} h · 도시광 ${b.city} · 근거리 볼륨 ${b.nf ? '켬' : '끔'}`);
    console.log(`    바람(동·남 km/h)  저 ${b.wind.slice(0, 2).join(', ')} · 중 ${b.wind.slice(2, 4).join(', ')} · 상 ${b.wind.slice(4, 6).join(', ')}`);
    console.log('    천정 둘레 운량 (북·북동·동·남동·남·남서·서·북서)');
    for (const [k, n] of [['l', '저'], ['m', '중'], ['h', '상']]) {
      // 두 자리씩 이은 문자열입니다(simReport.ts 의 packCover).
      const c = String(b.cov[k] || '').match(/../g) || [];
      console.log(`      ${n}  2km [${c.slice(0, 8).join(' ')}]  10km [${c.slice(8, 16).join(' ')}]`);
    }
  }
  console.log('\n원본 JSON:');
  console.log(JSON.stringify(payload, null, 2));
}

main();
