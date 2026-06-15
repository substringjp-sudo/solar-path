const fs = require('fs');
const path = require('path');
const exifr = require('exifr');
const https = require('https');

const PHOTOS_DIR = path.join(__dirname, '../assets/photos');
const OUTPUT_DIR = path.join(__dirname, '../assets/photos_clean');
const METADATA_FILE = path.join(__dirname, '../src/config/photoMetadata.json');

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// Nominatim API를 통해 역지오코딩 수행
function reverseGeocode(lat, lon) {
  return new Promise((resolve) => {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=10&addressdetails=1`;
    const options = {
      headers: {
        'User-Agent': 'BeforeGlowPhotoSanitizer/1.0 (yunhyeongseob@dev.solar-path)'
      }
    };
    https.get(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed && parsed.address) {
            const addr = parsed.address;
            const city = addr.city || addr.town || addr.village || addr.county || addr.suburb || '';
            const country = addr.country || '';
            if (city && country) {
              resolve(`${city}, ${country}`);
            } else if (country) {
              resolve(country);
            } else {
              resolve(parsed.display_name || 'Unknown Location');
            }
          } else {
            resolve('Unknown Location');
          }
        } catch (e) {
          resolve('Unknown Location');
        }
      });
    }).on('error', () => {
      resolve('Unknown Location');
    });
  });
}

// JPEG APP1(EXIF) 세그먼트 제거 함수
function stripExifJpeg(buffer) {
  if (buffer[0] !== 0xFF || buffer[1] !== 0xD8) {
    // JPEG이 아님
    return buffer;
  }
  
  let i = 2;
  const chunks = [buffer.subarray(0, 2)]; // SOI 보존
  
  while (i < buffer.length) {
    if (buffer[i] === 0xFF) {
      const marker = buffer[i + 1];
      if (marker === 0xD9) {
        // EOI
        chunks.push(buffer.subarray(i));
        break;
      }
      
      // RST 마커 (0xD0 ~ 0xD7) 나 0x00 은 길이 바이트가 없음
      if ((marker >= 0xD0 && marker <= 0xD7) || marker === 0x00 || marker === 0xD8) {
        chunks.push(buffer.subarray(i, i + 2));
        i += 2;
        continue;
      }
      
      // 그 외 마커는 뒤에 2바이트 길이 정보가 있음
      const length = buffer.readUInt16BE(i + 2);
      
      if (marker === 0xE1) {
        // APP1 (EXIF 영역) -> 건너뜀
        console.log(`  [Strip] Skipping APP1 marker (length: ${length + 2} bytes)`);
        i += 2 + length;
      } else {
        // 복사
        chunks.push(buffer.subarray(i, i + 2 + length));
        i += 2 + length;
      }
    } else {
      // 비정상적인 데이터 흐름 대응
      chunks.push(buffer.subarray(i, i + 1));
      i += 1;
    }
  }
  
  return Buffer.concat(chunks);
}

async function processPhotos() {
  const files = fs.readdirSync(PHOTOS_DIR);
  const metadata = {};
  
  console.log(`Found ${files.length} files in assets/photos.`);
  
  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    if (ext !== '.jpg' && ext !== '.jpeg') {
      continue;
    }
    
    const filePath = path.join(PHOTOS_DIR, file);
    const outPath = path.join(OUTPUT_DIR, file);
    console.log(`\nProcessing ${file}...`);
    
    try {
      const buffer = fs.readFileSync(filePath);
      let gps = null;
      try {
        gps = await exifr.gps(buffer);
      } catch (err) {
        // GPS 정보 없음
      }
      
      let locationName = 'Unknown Location';
      if (gps && gps.latitude && gps.longitude) {
        console.log(`  GPS Found: ${gps.latitude.toFixed(4)}, ${gps.longitude.toFixed(4)}`);
        // API 호출 가이드라인 준수 (1초 대기)
        await new Promise(r => setTimeout(r, 1000));
        locationName = await reverseGeocode(gps.latitude, gps.longitude);
        console.log(`  Resolved Location: ${locationName}`);
      } else {
        console.log(`  No GPS data in ${file}`);
      }
      
      // 메타데이터 제거
      const cleanBuffer = stripExifJpeg(buffer);
      fs.writeFileSync(outPath, cleanBuffer);
      
      metadata[file] = {
        location: locationName,
        latitude: gps ? gps.latitude : null,
        longitude: gps ? gps.longitude : null,
        cleaned: true
      };
      
    } catch (error) {
      console.error(`Error processing ${file}:`, error);
    }
  }
  
  // JSON 파일로 저장
  const configDir = path.dirname(METADATA_FILE);
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
  fs.writeFileSync(METADATA_FILE, JSON.stringify(metadata, null, 2));
  console.log(`\nSaved metadata mapping to ${METADATA_FILE}`);
}

processPhotos();
