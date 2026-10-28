/**
 * 당시 앱의 예보 팬(cloudGrid.ts, §166 에서 지움: 방위 ±30° 7줄기 × 거리 10~380km 10링 = 70점)
 * 을 그대로 던져, 실제로 격자 몇 칸으로 뭉치는지 셉니다.
 * Open-Meteo 는 응답에 자기가 쓴 격자점 좌표를 돌려주므로
 * 요청 좌표와 견주면 그 지역의 격자 간격이 그대로 드러납니다.
 */
const AZ_OFFSETS = [-30, -20, -10, 0, 10, 20, 30];
const DIST_RINGS = [10, 20, 35, 55, 80, 120, 170, 230, 300, 380];
const NEAR = new Set([10, 20, 35, 55]);   // 고도각 20° 위를 채우는 링들
const R = 6371;
const rad = (d) => d * Math.PI / 180, deg = (r) => r * 180 / Math.PI;

function dest(lat, lon, bearingDeg, distKm) {
  const b = rad(bearingDeg), d = distKm / R;
  const p1 = rad(lat), l1 = rad(lon);
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1),
                             Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return [deg(p2), deg(l2)];
}
const hav = (a, b, c, d) => {
  const dp = rad(c - a), dl = rad(d - b);
  const x = Math.sin(dp/2)**2 + Math.cos(rad(a))*Math.cos(rad(c))*Math.sin(dl/2)**2;
  return 2 * R * Math.asin(Math.sqrt(x));
};

const PLACES = [
  { name: '서울 도곡동',     lat: 37.4863, lon: 127.0443 },
  { name: '강원 인제(산간)', lat: 38.0695, lon: 128.1704 },
  { name: '제주 서귀포',     lat: 33.2541, lon: 126.5601 },
  { name: '미국 캔자스',     lat: 38.5,    lon: -98.0    },
  { name: '독일 뮌헨',       lat: 48.1372, lon: 11.5756  },
  { name: '몽골 울란바토르', lat: 47.8864, lon: 106.9057 },
  { name: '남태평양(먼바다)',lat: -20.0,   lon: -140.0   },
];
const MODEL = process.argv[2] || '';
const BEARING = 250;

(async () => {
  console.log(`모델: ${MODEL || 'best_match(기본)'}   팬: ${AZ_OFFSETS.length}줄기 × ${DIST_RINGS.length}링 = ${AZ_OFFSETS.length*DIST_RINGS.length}점\n`);
  console.log('  장소                요청 70점→격자칸  뭉침    가까운4링 28점→칸  격자간격  관측점 스냅');
  for (const P of PLACES) {
    const pts = [];
    for (const off of AZ_OFFSETS) for (const d of DIST_RINGS)
      pts.push({ ll: dest(P.lat, P.lon, BEARING + off, d), d });
    const all = [{ ll: [P.lat, P.lon], d: 0 }, ...pts];
    const lats = all.map(p => p.ll[0].toFixed(5)).join(',');
    const lons = all.map(p => p.ll[1].toFixed(5)).join(',');
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}`
      + `&hourly=cloud_cover_mid&forecast_days=1&timezone=auto${MODEL ? '&models=' + MODEL : ''}`;
    let j;
    try { j = await (await fetch(url)).json(); }
    catch (e) { console.log(`  ${P.name.padEnd(18)} 실패: ${e.message}`); continue; }
    const arr = Array.isArray(j) ? j : [j];
    if (arr[0]?.error) { console.log(`  ${P.name.padEnd(18)} ✗ ${String(arr[0].reason).slice(0,60)}`); continue; }
    const key = o => `${o.latitude},${o.longitude}`;
    const fan = arr.slice(1);                       // 관측점 제외한 70점
    const cells = new Set(fan.map(key));
    const nearCells = new Set(fan.filter((_, i) => NEAR.has(all[i+1].d)).map(key));
    const nearN = all.slice(1).filter(p => NEAR.has(p.d)).length;
    const uniqLat = [...new Set(arr.map(o => o.latitude))].sort((a,b)=>a-b);
    const steps = [];
    for (let i = 1; i < uniqLat.length; i++) steps.push((uniqLat[i]-uniqLat[i-1]) * 111.2);
    steps.sort((a,b)=>a-b);
    const med = steps.length ? steps[Math.floor(steps.length/2)] : NaN;
    const snap = hav(P.lat, P.lon, arr[0].latitude, arr[0].longitude);
    console.log(`  ${P.name.padEnd(18)} ${String(cells.size).padStart(9)}칸  ${(fan.length/cells.size).toFixed(1)}배`
      + `  ${String(nearN).padStart(10)}점→${String(nearCells.size).padStart(2)}칸(${(nearN/nearCells.size).toFixed(1)}배)`
      + `  ${med.toFixed(1).padStart(6)}km  ${snap.toFixed(1).padStart(5)}km`);
    await new Promise(r => setTimeout(r, 1200));
  }
})();
