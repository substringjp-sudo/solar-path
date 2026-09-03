/**
 * **사진의 화각을 알아냅니다** — 구름 "크기"를 재려면 반드시 필요합니다.
 *
 * 구름이 크다/작다는 화면에서 몇 화소냐가 아니라 **하늘에서 몇 도냐**입니다.
 * 같은 적운도 광각으로 찍으면 작게, 망원으로 찍으면 크게 찍힙니다. 사진과
 * 렌더를 화소 단위로 비교하면 렌즈를 비교하는 셈이 됩니다.
 *
 * EXIF 의 FocalLengthIn35mmFilm 이 있으면 화각이 바로 나옵니다:
 *   가로 화각 = 2 * atan(36mm / (2 * f35))
 *
 * 순수 stdlib 파서입니다 — 이 환경에 PIL 도 exif 패키지도 없습니다.
 * APP1 세그먼트의 TIFF IFD0 와 Exif SubIFD 만 훑습니다.
 */
const fs = require('fs');

const T_FOCAL35 = 0xA405;
const T_FOCAL   = 0x920A;
const T_EXIFIFD = 0x8769;
const T_MAKE    = 0x010F;
const T_MODEL   = 0x0110;
const TYPE_SIZE = { 1:1, 2:1, 3:2, 4:4, 5:8, 7:1, 9:4, 10:8 };

function readExif(file) {
  const buf = fs.readFileSync(file);
  if (buf[0] !== 0xFF || buf[1] !== 0xD8) return null;   // SOI 아님
  let off = 2, app1 = -1;
  while (off < buf.length - 4) {
    if (buf[off] !== 0xFF) break;
    const marker = buf[off + 1];
    const len = buf.readUInt16BE(off + 2);
    if (marker === 0xE1 && buf.toString('ascii', off + 4, off + 10) === 'Exif\0\0') {
      app1 = off + 10; break;
    }
    if (marker === 0xDA) break;                          // 이미지 데이터 시작
    off += 2 + len;
  }
  if (app1 < 0) return null;

  const tiff = app1;
  const be = buf.toString('ascii', tiff, tiff + 2) === 'MM';
  const u16 = o => be ? buf.readUInt16BE(o) : buf.readUInt16LE(o);
  const u32 = o => be ? buf.readUInt32BE(o) : buf.readUInt32LE(o);
  if (u16(tiff + 2) !== 42) return null;

  const out = {};
  const walk = (ifdOff, depth) => {
    if (depth > 2 || ifdOff <= 0 || tiff + ifdOff + 2 > buf.length) return;
    const base = tiff + ifdOff;
    const n = u16(base);
    if (n > 512) return;
    for (let i = 0; i < n; i++) {
      const e = base + 2 + i * 12;
      if (e + 12 > buf.length) return;
      const tag = u16(e), type = u16(e + 2), count = u32(e + 4);
      const size = (TYPE_SIZE[type] || 0) * count;
      const valOff = size > 4 ? tiff + u32(e + 8) : e + 8;
      if (valOff + size > buf.length || size === 0) continue;
      if (tag === T_EXIFIFD) { walk(u32(e + 8), depth + 1); continue; }
      if (tag === T_FOCAL35 && type === 3) out.focal35 = u16(valOff);
      if (tag === T_FOCAL && type === 5) {
        const num = u32(valOff), den = u32(valOff + 4);
        if (den) out.focal = num / den;
      }
      if ((tag === T_MAKE || tag === T_MODEL) && type === 2)
        out[tag === T_MAKE ? 'make' : 'model'] =
          buf.toString('ascii', valOff, valOff + Math.max(0, count - 1)).trim();
    }
  };
  walk(u32(tiff + 4), 0);
  return Object.keys(out).length ? out : null;
}

/** 35mm 환산 초점거리 → 가로 화각(도). 35mm 판의 가로는 36mm 입니다. */
function fovFromFocal35(f35) {
  return 2 * Math.atan(36 / (2 * f35)) * 180 / Math.PI;
}

module.exports = { readExif, fovFromFocal35 };

if (require.main === module) {
  const path = require('path');
  const dir = path.join(__dirname, '../../.harness/photoref');
  for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.jpg'))) {
    const e = readExif(path.join(dir, f));
    const fov = e && e.focal35 ? fovFromFocal35(e.focal35).toFixed(1) + '°' : '—';
    console.log(`  ${f.padEnd(22)} f35=${String(e && e.focal35 || '—').padStart(4)}  ` +
                `화각 ${fov.padStart(6)}   ${(e && (e.model || e.make)) || ''}`);
  }
}
