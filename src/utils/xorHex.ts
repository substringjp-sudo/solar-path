/**
 * xorHex.ts — `security.ts` 의 "XOR + 16진수" 변환의 **빠른 구현**. 출력은 옛 글자별 구현과 한 글자도 다르지 않습니다(판정 `verify-startup-trim.js` E).
 *
 * 옛 구현은 글자 하나마다 `+=` 로 문자열을 이어 붙이고(encode: 2 번, decode: 2 번), 16진수 쪽은 글자마다 `parseInt`/`substring` 을 불렀습니다.
 * 날씨 링 한 칸이 100~200 KB 라, 켤 때 캐시 파일을 읽을 때마다 JS 스레드를 오래 붙잡았습니다. 여기서는 바이트 배열 한 번 · 조각 단위 `fromCharCode` 로 처리합니다.
 * (암호 강도는 그대로입니다 — 키가 앱 안에 있는 난독화 수준. 로컬 저장소에 위치가 평문으로 남지 않게 하는 용도.)
 */
const HEX = '0123456789abcdef';
const CHUNK = 8192;

export function xorHexEncode(text: string, salt: string): string {
  if (!text) return '';
  const u = encodeURIComponent(text);               // 순수 ASCII
  const n = u.length, sl = salt.length;
  let out = '';
  const parts: string[] = [];
  for (let i = 0; i < n; i++) {
    const c = u.charCodeAt(i) ^ salt.charCodeAt(i % sl);
    out += HEX[(c >> 4) & 15] + HEX[c & 15];
    if (out.length >= CHUNK * 2) { parts.push(out); out = ''; }
  }
  parts.push(out);
  return parts.join('');
}

const nib = (c: number): number => (c <= 57 ? c - 48 : c <= 70 ? c - 55 : c - 87);   // '0'-'9' · 'A'-'F' · 'a'-'f'

export function xorHexDecode(hex: string, salt: string): string {
  if (!hex) return '';
  const n = hex.length >> 1, sl = salt.length;
  const parts: string[] = [];
  let buf: number[] = [];
  for (let i = 0; i < n; i++) {
    const b = (nib(hex.charCodeAt(2 * i)) << 4) | nib(hex.charCodeAt(2 * i + 1));
    buf.push(b ^ salt.charCodeAt(i % sl));
    if (buf.length >= CHUNK) { parts.push(String.fromCharCode.apply(null, buf as any)); buf = []; }
  }
  if (buf.length) parts.push(String.fromCharCode.apply(null, buf as any));
  return decodeURIComponent(parts.join(''));
}
