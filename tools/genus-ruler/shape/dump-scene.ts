/** 한 시각의 장면 입력을 METAR 포함해 찍습니다(기기 장면 재현). node dump-scene.cjs '{lat,lon,heightM,dateLocal,tzH,hm,az,el,fov,metar:true}' */
import { fetchDayWeatherRing, getInterpolatedWeather } from '../../../src/utils/weather';
import { fetchNearestMetar } from '../../../src/utils/metar';
import { buildLiveScene } from '../../../src/components/VolumetricProbe/liveScene';
const Q = JSON.parse(process.argv[2]) as { lat: number; lon: number; heightM: number; dateLocal: string; tzH: number; hm: string; az: number; el: number; fov: number; metar?: boolean };
(async () => {
  const day = new Date(`${Q.dateLocal}T12:00:00Z`);
  const ring = await fetchDayWeatherRing(Q.lat, Q.lon, day, true);
  const [h, m] = Q.hm.split(':').map(Number);
  const date = new Date(Date.UTC(+Q.dateLocal.slice(0, 4), +Q.dateLocal.slice(5, 7) - 1, +Q.dateLocal.slice(8, 10), h - Q.tzH, m));
  const iw = getInterpolatedWeather(ring, date) as any[];
  const metar = Q.metar ? await fetchNearestMetar(Q.lat, Q.lon) : null;
  console.log('METAR', metar ? `${metar.icao} ${metar.distanceKm.toFixed(1)}km ${new Date(metar.timeMs).toISOString()} ${metar.raw}` : 'none');
  const built = buildLiveScene({ lat: Q.lat, lon: Q.lon, heightM: Q.heightM, date, pathData: ring, interpolatedWeather: iw as any, az: Q.az, el: Q.el, fov: Q.fov, metar });
  console.log('SUMMARY', built.summary);
  if (process.argv[3]) require('fs').writeFileSync(process.argv[3], JSON.stringify({ name: 'scene', input: { ...built.input, date: date.toISOString(), az: Q.az, el: Q.el, fov: Q.fov }, frames: 16, quality: 'low', res: 0.5, out: 'both' }));
  for (const L of built.input.layers as any[]) console.log('LAYER', JSON.stringify({ genus: L.genus, cover: L.cover && +L.cover.toFixed(3), baseKm: L.baseKm && +L.baseKm.toFixed(2), thicknessM: L.thicknessM, band: L.band }));
  const mac: any = (built.input as any).macro;
  if (mac) for (const b of ['low', 'mid', 'high']) { const pts = mac[b]; if (pts) console.log('MACRO', b, pts.length, 'covers', pts.slice(0, 12).map((q: any) => Math.round(q.cover)).join(',')); }
})().catch(e => { console.error(e); process.exit(1); });
