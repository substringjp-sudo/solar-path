/**
 * g1-png.mjs — G1(b) 렌더 PNG 를 풀어 두 장의 차이를 화소로 재는 조각(S3-design.md G1 build note 19, fix G1-REC).
 *
 * decodePng: 비월 아님(interlace 0), 비트 깊이 8·16, 색 꼴 0(회색)·2(RGB)·4(회색+알파)·6(RGBA)만(run.js 의 PNG 는 8 비트 RGBA).
 *   거르개 0~4 를 풀어 표본 배열(Uint8Array·Uint16Array, 행 우선, 화소마다 채널 차례)로 돌려줌. 다른 꼴은 throw.
 * pngDiff: 같은 크기·꼴의 두 그림에서 다른 화소 수, 둘레 상자(row 0 = 위, col 0 = 왼쪽, 양 끝 포함), 가장 큰 단계 차이,
 *   달라진 채널(이름)과 채널마다 다른 화소 수. 크기·꼴이 다르면 {comparable: false, reason}.
 * encodePng: 시험용(8 비트, 거르개를 줄마다 차례로 0~4 로 돌려 써서 풀기의 다섯 거르개를 모두 지나게 함).
 * mismatchSummary: b.json 의 mismatches 한 칸을 한 줄로(g1-baseline status·render-attempts.jsonl 에 씀).
 */
import zlib from 'node:zlib';

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
export const CHANNEL_NAMES = { 0: ['y'], 2: ['r', 'g', 'b'], 4: ['y', 'a'], 6: ['r', 'g', 'b', 'a'] };

export function decodePng(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 8 || !buf.subarray(0, 8).equals(SIG)) throw new Error('not a PNG');
  let off = 8, ihdr = null;
  const idat = [];
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off), type = buf.toString('latin1', off + 4, off + 8);
    if (off + 12 + len > buf.length) throw new Error(`truncated ${type} chunk`);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') ihdr = { width: data.readUInt32BE(0), height: data.readUInt32BE(4), bitDepth: data[8], colorType: data[9], interlace: data[12] };
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (!ihdr) throw new Error('no IHDR');
  const { width, height, bitDepth, colorType, interlace } = ihdr;
  const names = CHANNEL_NAMES[colorType];
  if (!names || (bitDepth !== 8 && bitDepth !== 16) || interlace !== 0) throw new Error(`unsupported PNG (colorType ${colorType}, bitDepth ${bitDepth}, interlace ${interlace})`);
  const bps = bitDepth / 8, bpp = names.length * bps, stride = width * bpp;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  if (raw.length !== height * (stride + 1)) throw new Error(`IDAT size ${raw.length} != ${height * (stride + 1)}`);
  const out = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride, up = dst - stride;
    for (let i = 0; i < stride; i++) {
      const x = raw[src + i], a = i >= bpp ? out[dst + i - bpp] : 0, b = y > 0 ? out[up + i] : 0, c = (i >= bpp && y > 0) ? out[up + i - bpp] : 0;
      let v;
      if (f === 0) v = x;
      else if (f === 1) v = x + a;
      else if (f === 2) v = x + b;
      else if (f === 3) v = x + ((a + b) >> 1);
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); }
      else throw new Error(`bad filter ${f} in row ${y}`);
      out[dst + i] = v & 0xff;
    }
  }
  let samples;
  if (bitDepth === 8) samples = new Uint8Array(out.buffer, out.byteOffset, out.length);
  else { samples = new Uint16Array(out.length / 2); for (let i = 0; i < samples.length; i++) samples[i] = out.readUInt16BE(i * 2); }
  return { width, height, bitDepth, colorType, channels: names, samples };
}

export function pngDiff(A, B) {
  if (A.width !== B.width || A.height !== B.height || A.colorType !== B.colorType || A.bitDepth !== B.bitDepth) {
    return { comparable: false, reason: `size or format differs (${A.width}x${A.height} type ${A.colorType}/${A.bitDepth} vs ${B.width}x${B.height} type ${B.colorType}/${B.bitDepth})` };
  }
  const nc = A.channels.length, per = new Array(nc).fill(0);
  let pixels = 0, maxLevel = 0, r0 = Infinity, r1 = -1, c0 = Infinity, c1 = -1;
  for (let y = 0; y < A.height; y++) for (let x = 0; x < A.width; x++) {
    const i = (y * A.width + x) * nc;
    let any = false;
    for (let k = 0; k < nc; k++) {
      const d = Math.abs(A.samples[i + k] - B.samples[i + k]);
      if (d) { any = true; per[k]++; if (d > maxLevel) maxLevel = d; }
    }
    if (any) { pixels++; if (y < r0) r0 = y; if (y > r1) r1 = y; if (x < c0) c0 = x; if (x > c1) c1 = x; }
  }
  const channelPixels = {};
  A.channels.forEach((n, k) => { if (per[k]) channelPixels[n] = per[k]; });
  return {
    comparable: true, width: A.width, height: A.height, pixels, maxLevel,
    bbox: pixels ? { row: [r0, r1], col: [c0, c1] } : null,
    channels: A.channels.filter((n, k) => per[k] > 0), channelPixels,
  };
}

/** 시험용 8 비트 PNG(거르개 = 줄 번호 mod 5). samples 는 width*height*channels 개. */
export function encodePng(width, height, colorType, samples) {
  const nc = CHANNEL_NAMES[colorType].length, stride = width * nc;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    const f = y % 5, dst = y * (stride + 1);
    raw[dst] = f;
    for (let i = 0; i < stride; i++) {
      const x = samples[y * stride + i], a = i >= nc ? samples[y * stride + i - nc] : 0, b = y > 0 ? samples[(y - 1) * stride + i] : 0,
        c = (i >= nc && y > 0) ? samples[(y - 1) * stride + i - nc] : 0;
      let pred = 0;
      if (f === 1) pred = a; else if (f === 2) pred = b; else if (f === 3) pred = (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      raw[dst + 1 + i] = (x - pred) & 0xff;
    }
  }
  const chunk = (type, data) => {
    const t = Buffer.from(type, 'latin1'), len = Buffer.alloc(4), crc = Buffer.alloc(4);
    len.writeUInt32BE(data.length); crc.writeUInt32BE(zlib.crc32(Buffer.concat([t, data])) >>> 0);
    return Buffer.concat([len, t, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = colorType; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([SIG, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/** b.json mismatches 한 칸 → 한 줄. 예: `aa P0_seoul.rgb run1/run2 1 px rows 553-553 cols 271-271 max 1 ch b`. */
export function mismatchSummary(m) {
  const head = `${m.kind} ${m.job}.${m.channel} ${m.a.source}/${m.b.source}`;
  if (!m.decoded) return `${head} undecoded: ${m.reason}`;
  const bb = m.bbox ? ` rows ${m.bbox.row[0]}-${m.bbox.row[1]} cols ${m.bbox.col[0]}-${m.bbox.col[1]}` : '';
  return `${head} ${m.pixels} px${bb} max ${m.maxLevel} ch ${m.channels.join('') || '-'}`;
}
/** mismatches 한 칸이 갖춰야 할 마당(g1-baseline·g1-test 가 봄). */
export const MISMATCH_FIELDS = ['kind', 'job', 'channel', 'a', 'b', 'decoded', 'reason', 'width', 'height', 'pixels', 'bbox', 'maxLevel', 'channels', 'channelPixels'];
export const MISMATCH_KINDS = ['aa', 'keys', 'control'];
export function validMismatch(m) {
  if (!m || typeof m !== 'object' || !MISMATCH_FIELDS.every(k => Object.prototype.hasOwnProperty.call(m, k))) return false;
  if (!MISMATCH_KINDS.includes(m.kind) || !['rgb', 'alpha'].includes(m.channel) || typeof m.job !== 'string') return false;
  if (!m.a || !m.b || typeof m.a.source !== 'string' || typeof m.b.source !== 'string') return false;
  if (m.decoded !== true) return m.decoded === false && typeof m.reason === 'string';
  if (!Number.isInteger(m.width) || !Number.isInteger(m.height) || !Number.isInteger(m.pixels) || !Number.isInteger(m.maxLevel) || !Array.isArray(m.channels)) return false;
  // md5 만 다르고 화소는 같을 수 있음(PNG 압축만 다름): pixels 0, bbox null
  if (m.pixels === 0) return m.bbox === null && m.maxLevel === 0 && m.channels.length === 0;
  return m.maxLevel > 0 && m.channels.length > 0 && !!m.bbox && Array.isArray(m.bbox.row) && Array.isArray(m.bbox.col);
}
