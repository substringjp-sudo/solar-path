/**
 * png.ts — RGBA 화소를 PNG data URI 로 (§120 B).
 *
 * 지구본(react-native-svg)에 GPU 로 그린 한 장을 얹으려면 그림 파일이 필요합니다. RN 에는
 * 캔버스가 없어 직접 만듭니다: PNG 는 IHDR · IDAT(zlib) · IEND 세 덩이면 됩니다. 압축은 이미
 * 의존성에 있는 fflate 로 합니다.
 */
import { zlibSync } from 'fflate';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

const crc32 = (bytes: Uint8Array, start: number, end: number): number => {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
/** base64 — Hermes 의 btoa 유무에 기대지 않습니다. */
export const toBase64 = (bytes: Uint8Array): string => {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i] << 16;
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + '==';
  } else if (rest === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + '=';
  }
  return out;
};

/**
 * RGBA(맨 윗줄 먼저, 곧은 알파) → PNG 바이트.
 * @param level zlib 압축 수준. 자동재생 중에도 부르므로 기본은 빠른 쪽(1)입니다.
 */
export function encodePngRgba(rgba: Uint8Array, width: number, height: number, level = 1): Uint8Array {
  // 줄마다 필터 바이트 0(없음)을 앞에 붙입니다.
  const raw = new Uint8Array(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  }
  const idat = zlibSync(raw, { level: level as any });
  const chunks: [string, Uint8Array][] = [
    ['IHDR', (() => {
      const h = new Uint8Array(13);
      const dv = new DataView(h.buffer);
      dv.setUint32(0, width);
      dv.setUint32(4, height);
      h[8] = 8;   // 비트 깊이
      h[9] = 6;   // RGBA
      h[10] = 0; h[11] = 0; h[12] = 0;
      return h;
    })()],
    ['IDAT', idat],
    ['IEND', new Uint8Array(0)],
  ];
  const total = 8 + chunks.reduce((a, [, d]) => a + 12 + d.length, 0);
  const out = new Uint8Array(total);
  out.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  let o = 8;
  const dv = new DataView(out.buffer);
  for (const [type, data] of chunks) {
    dv.setUint32(o, data.length);
    for (let k = 0; k < 4; k++) out[o + 4 + k] = type.charCodeAt(k);
    out.set(data, o + 8);
    dv.setUint32(o + 8 + data.length, crc32(out, o + 4, o + 8 + data.length));
    o += 12 + data.length;
  }
  return out;
}

export const pngDataUri = (rgba: Uint8Array, width: number, height: number): string =>
  'data:image/png;base64,' + toBase64(encodePngRgba(rgba, width, height));
