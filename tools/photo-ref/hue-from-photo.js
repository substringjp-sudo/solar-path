/**
 * **실제 노을 사진에서 목표 색을 뽑습니다.**
 *
 * 렌더가 "노을 같지 않다"는 지적은 취향 논쟁이 되기 쉽습니다. 사진에서
 * 같은 잣대로 숫자를 뽑아 두면 그게 목표가 되고, 렌더의 같은 지표와 바로
 * 비교됩니다 (build-sunset-gap.js 의 litHue 가 이 알고리즘과 같습니다).
 *
 * 잣대: 밝기 상위 30% 화소만(빛 받은 구름 면), 채도 0.05 미만 제외(흰 속살).
 * 건물·나무는 어두워 자동으로 빠집니다.
 *
 * 사용:
 *   node tools/photo-ref/hue-from-photo.js 이름=경로.jpg [이름2=경로2.jpg ...]
 *
 * 서울에서 찍은 노을 사진 셋의 기준값:
 *   적운      평균 색상 30.6도  채도 0.325   주황 60%
 *   흐림노을  평균 색상 12.3도  채도 0.453   빨강 90%
 *   고적운    평균 색상 11.6도  채도 0.160   빨강 39% 주황 32%
 * 셋 다 **연두(70~100도)가 0%** 입니다. 렌더는 태양 0도에서 41.4도 입니다.
 */
const jpeg = require('/home/user/solar-path/tools/qr-report/node_modules/jpeg-js');
const fs = require('fs');

/** RGB → 색상각(0~360), 채도(0~1), 명도(0~1) */
function hsv(r, g, b) {
  r/=255; g/=255; b/=255;
  const mx = Math.max(r,g,b), mn = Math.min(r,g,b), d = mx-mn;
  let h = 0;
  if (d > 1e-6) {
    if (mx === r) h = ((g-b)/d) % 6;
    else if (mx === g) h = (b-r)/d + 2;
    else h = (r-g)/d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  return { h, s: mx > 0 ? d/mx : 0, v: mx };
}
/** 색상각 이름 — 노을 톤을 가르는 데 필요한 만큼만 */
function band(h) {
  if (h < 15 || h >= 345) return '빨강';
  if (h < 40) return '주황';
  if (h < 55) return '노랑주황';
  if (h < 70) return '노랑';
  if (h < 100) return '연두';      // ← 여기 들어가면 초록끼
  if (h < 160) return '초록';
  if (h < 200) return '청록';
  if (h < 250) return '파랑';
  if (h < 290) return '보라';
  return '자홍';
}

for (const [name, path] of process.argv.slice(2).map(a => a.split('='))) {
  const raw = jpeg.decode(fs.readFileSync(path), { useTArray: true });
  const { width: W, height: H, data } = raw;
  // 밝은 쪽 30% 만 — 빛 받은 구름입니다. 건물·나무는 어두워 자동으로 빠집니다.
  const lums = [];
  for (let i = 0; i < W*H; i++) {
    const p = i*4;
    lums.push(0.2126*data[p] + 0.7152*data[p+1] + 0.0722*data[p+2]);
  }
  const sorted = [...lums].sort((a,b)=>a-b);
  const cut = sorted[Math.floor(sorted.length*0.70)];

  const counts = {}; let n = 0, sh = 0, ss = 0, sx = 0, sy = 0;
  let sr=0, sg=0, sb=0;
  for (let i = 0; i < W*H; i++) {
    if (lums[i] < cut) continue;
    const p = i*4;
    const c = hsv(data[p], data[p+1], data[p+2]);
    if (c.s < 0.05) continue;           // 흰 구름 속살은 색이 없으니 뺍니다
    counts[band(c.h)] = (counts[band(c.h)] || 0) + 1;
    const rad = c.h*Math.PI/180; sx += Math.cos(rad); sy += Math.sin(rad);
    ss += c.s; sr += data[p]; sg += data[p+1]; sb += data[p+2]; n++;
  }
  let mh = Math.atan2(sy/n, sx/n)*180/Math.PI; if (mh < 0) mh += 360;
  const top = Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,4)
    .map(([k,v]) => k+' '+(100*v/n).toFixed(0)+'%').join(', ');
  console.log(name.padEnd(10) +
    '평균 색상 ' + mh.toFixed(1).padStart(6) + '°  채도 ' + (ss/n).toFixed(3) +
    '  RGB ' + (sr/n).toFixed(0)+'/'+(sg/n).toFixed(0)+'/'+(sb/n).toFixed(0) +
    '   ' + top);
}
