/** 한 시각의 관측점 예보 값과 해 쪽 고리 점들을 찍습니다(기기 장면 재현 · 예보 점검). node dump-obs.cjs '{lat,lon,dateLocal,tzH,hm}' */
import { fetchDayWeatherRing, getInterpolatedWeather } from '../../../src/utils/weather';
const Q = JSON.parse(process.argv[2]) as { lat: number; lon: number; dateLocal: string; tzH: number; hm: string };
(async () => {
  const day = new Date(`${Q.dateLocal}T12:00:00Z`);
  const ring = await fetchDayWeatherRing(Q.lat, Q.lon, day, true);
  const [h, m] = Q.hm.split(':').map(Number);
  const date = new Date(Date.UTC(+Q.dateLocal.slice(0, 4), +Q.dateLocal.slice(5, 7) - 1, +Q.dateLocal.slice(8, 10), h - Q.tzH, m));
  const iw = getInterpolatedWeather(ring, date) as any[];
  const f = (o: any) => ({ dist: o.distance, az: o.azimuthOffset, low: o.low, mid: o.mid, high: o.high, total: o.total, rh: o.humidity, vis: o.visibility, precip: o.precipitation, dni: o.directNormalIrradiance, ghi: o.shortwaveRadiation, satGhi: o.satShortwaveRadiation });
  console.log('date', date.toISOString(), 'points', iw.length, 'origin', ring[0]?.origin);
  console.log('OBS', JSON.stringify(f(iw[0])));
  for (const o of iw.slice(1)) console.log('PT', JSON.stringify(f(o)));
})().catch(e => { console.error(e); process.exit(1); });
