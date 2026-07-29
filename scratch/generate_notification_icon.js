const fs = require('fs');
const path = require('path');
const { deflateSync } = require('zlib');

function createCutoutSunsetNotificationPng(size = 512) {
  const buffer = Buffer.alloc(size * size * 4, 0);

  function setPixel(x, y, val = 255) {
    if (x < 0 || x >= size || y < 0 || y >= size) return;
    const idx = (Math.floor(y) * size + Math.floor(x)) * 4;
    buffer[idx] = 255;
    buffer[idx + 1] = 255;
    buffer[idx + 2] = 255;
    buffer[idx + 3] = val;
  }

  function getPixelAlpha(x, y) {
    if (x < 0 || x >= size || y < 0 || y >= size) return 0;
    const idx = (Math.floor(y) * size + Math.floor(x)) * 4;
    return buffer[idx + 3];
  }

  // 1. 산맥 다각형 (Mountain Polygon) - 맨 앞 레이어
  const mountainPoints = [
    { x: 0, y: size * 0.88 },
    { x: size * 0.22, y: size * 0.62 },
    { x: size * 0.38, y: size * 0.72 },
    { x: size * 0.54, y: size * 0.52 }, // 웅장한 중앙 봉우리
    { x: size * 0.72, y: size * 0.68 },
    { x: size * 0.88, y: size * 0.58 },
    { x: size * 1.00, y: size * 0.76 },
    { x: size * 1.00, y: size },
    { x: 0, y: size }
  ];

  // 산맥 버퍼 (Mountain Mask)
  const mountainMask = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let inside = false;
      for (let i = 0, j = mountainPoints.length - 1; i < mountainPoints.length; j = i++) {
        const xi = mountainPoints[i].x, yi = mountainPoints[i].y;
        const xj = mountainPoints[j].x, yj = mountainPoints[j].y;
        const intersect = ((yi > y) !== (yj > y)) &&
          (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
      }
      if (inside) mountainMask[y * size + x] = 255;
    }
  }

  // 산맥 외곽 확장 마스크 (산 테두리를 따라 태양을 잘라내기 위한 Cutout Margin: 12px)
  const mountainCutoutMask = new Uint8Array(size * size);
  const mMargin = Math.floor(size * 0.024); // 약 12px
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (mountainMask[y * size + x] > 0) {
        mountainCutoutMask[y * size + x] = 255;
        continue;
      }
      // Check surrounding pixels for distance
      let near = false;
      for (let dy = -mMargin; dy <= mMargin && !near; dy++) {
        for (let dx = -mMargin; dx <= mMargin && !near; dx++) {
          if (dx * dx + dy * dy <= mMargin * mMargin) {
            const nx = x + dx, ny = y + dy;
            if (nx >= 0 && nx < size && ny >= 0 && ny < size) {
              if (mountainMask[ny * size + nx] > 0) near = true;
            }
          }
        }
      }
      if (near) mountainCutoutMask[y * size + x] = 255;
    }
  }

  // 2. 태양 (Sun Circle) - 산 뒤에 겹쳐지나, 산 테두리 컷아웃 적용
  const sunCX = size * 0.54;
  const sunCY = size * 0.48;
  const sunR = size * 0.22; // 큼직한 태양

  const sunMask = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - sunCX;
      const dy = y - sunCY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= sunR) {
        sunMask[y * size + x] = 255;
      }
    }
  }

  // 태양 외곽 확장 마스크 (태양 테두리를 따라 구름을 잘라내기 위한 Cutout Margin: 12px)
  const sunCutoutMask = new Uint8Array(size * size);
  const sMargin = Math.floor(size * 0.024); // 약 12px
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (sunMask[y * size + x] > 0) {
        sunCutoutMask[y * size + x] = 255;
        continue;
      }
      let near = false;
      for (let dy = -sMargin; dy <= sMargin && !near; dy++) {
        for (let dx = -sMargin; dx <= sMargin && !near; dx++) {
          if (dx * dx + dy * dy <= sMargin * sMargin) {
            const nx = x + dx, ny = y + dy;
            if (nx >= 0 && nx < size && ny >= 0 && ny < size) {
              if (sunMask[ny * size + nx] > 0) near = true;
            }
          }
        }
      }
      if (near) sunCutoutMask[y * size + x] = 255;
    }
  }

  // 3. 구름 (Cloud Shape) - 태양 및 산 상단에 자연스럽게 걸쳐지나 태양/산 테두리를 오려냄
  const cloudCircles = [
    { cx: size * 0.26, cy: size * 0.36, r: size * 0.10 },
    { cx: size * 0.38, cy: size * 0.28, r: size * 0.13 },
    { cx: size * 0.54, cy: size * 0.30, r: size * 0.11 },
    { cx: size * 0.68, cy: size * 0.34, r: size * 0.09 },
  ];

  const cloudMask = new Uint8Array(size * size);
  for (const c of cloudCircles) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = x - c.cx;
        const dy = y - c.cy;
        if (Math.sqrt(dx * dx + dy * dy) <= c.r) {
          cloudMask[y * size + x] = 255;
        }
      }
    }
  }
  // 구름 밑면 베이스 바
  for (let y = Math.floor(size * 0.33); y < Math.floor(size * 0.42); y++) {
    for (let x = Math.floor(size * 0.20); x < Math.floor(size * 0.74); x++) {
      cloudMask[y * size + x] = 255;
    }
  }

  // 4. 최종 합성 (Subtractive Combination with Border Cutouts)
  // 레이어 결합 순서:
  // A. 구름: cloudMask 중 sunCutoutMask 및 mountainCutoutMask에 걸치지 않는 영역만 렌더링
  // B. 태양: sunMask 중 mountainCutoutMask에 걸치지 않는 영역만 렌더링
  // C. 산맥: mountainMask 영역 100% 렌더링 (맨 위)

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = y * size + x;

      // C. 산맥 (맨 앞)
      if (mountainMask[idx] > 0) {
        setPixel(x, y, 255);
        continue;
      }

      // B. 태양 (산맥 테두리 컷아웃 파여진 태양)
      if (sunMask[idx] > 0 && mountainCutoutMask[idx] === 0) {
        setPixel(x, y, 255);
        continue;
      }

      // A. 구름 (태양 테두리 & 산맥 테두리가 컷아웃 파여진 구름)
      if (cloudMask[idx] > 0 && sunCutoutMask[idx] === 0 && mountainCutoutMask[idx] === 0) {
        setPixel(x, y, 255);
        continue;
      }
    }
  }

  return encodePng(buffer, size, size);
}

function encodePng(rgbaBuffer, width, height) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const ihdrChunk = createChunk('IHDR', ihdr);

  const rowSize = width * 4 + 1;
  const scanlines = Buffer.alloc(rowSize * height);
  for (let y = 0; y < height; y++) {
    scanlines[y * rowSize] = 0;
    rgbaBuffer.copy(scanlines, y * rowSize + 1, y * width * 4, (y + 1) * width * 4);
  }
  const compressed = deflateSync(scanlines);
  const idatChunk = createChunk('IDAT', compressed);

  const iendChunk = createChunk('IEND', Buffer.alloc(0));
  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

function createChunk(type, data) {
  const len = data.length;
  const buf = Buffer.alloc(8 + len + 4);
  buf.writeUInt32BE(len, 0);
  buf.write(type, 4, 4, 'ascii');
  data.copy(buf, 8);

  const crc = crc32(buf.slice(4, 8 + len));
  buf.writeUInt32BE(crc, 8 + len);
  return buf;
}

const crcTable = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  }
  crcTable[n] = c;
}

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc = crcTable[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// Generate & write files
const icon512 = createCutoutSunsetNotificationPng(512);
fs.writeFileSync(path.join(__dirname, '../assets/notification_icon.png'), icon512);
console.log('Successfully generated subtractive border cutout sunset notification_icon.png (512x512)');

// Copy to native android res folders
const resDrawableDirs = [
  '../android/app/src/main/res/drawable',
  '../android/app/src/main/res/drawable-hdpi',
  '../android/app/src/main/res/drawable-mdpi',
  '../android/app/src/main/res/drawable-xhdpi',
  '../android/app/src/main/res/drawable-xxhdpi',
  '../android/app/src/main/res/drawable-xxxhdpi'
];

resDrawableDirs.forEach(dir => {
  const fullPath = path.join(__dirname, dir);
  if (fs.existsSync(fullPath)) {
    fs.writeFileSync(path.join(fullPath, 'notification_icon.png'), icon512);
    fs.writeFileSync(path.join(fullPath, 'shell_notification_icon.png'), icon512);
  }
});
console.log('Successfully updated Android native drawable notification icons with cutout stroke offsets!');
