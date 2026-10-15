/**
 * scene-from-forecast.ts — 기기 캡처를 하네스에서 재현하려고, **앱과 같은 코드**로 예보를 받아(`fetchDayWeatherRing`) 그 시각의
 * 볼륨 장면 입력(`buildLiveScene`)을 만듭니다(§139 형태 단계). 결과는 volsky 잡 JSON.
 *   npx esbuild tools/genus-ruler/shape/scene-from-forecast.ts --bundle --platform=node --format=cjs --define:__DEV__=false --outfile=.harness/shape/sff.cjs \
 *     --alias:@react-native-async-storage/async-storage=./tools/genus-ruler/shape/async-storage-stub.js
 *   node .harness/shape/sff.cjs '<JSON: {lat,lon,heightM,dateLocal:"2026-10-15",tzH:9,shots:[{name,hm:"15:05",az,el,fov}]}>' out.json
 */
import { fetchDayWeatherRing, getInterpolatedWeather } from '../../../src/utils/weather';
import { buildLiveScene } from '../../../src/components/VolumetricProbe/liveScene';

type Shot = { name: string; hm: string; az: number; el: number; fov: number };
const [arg, out] = process.argv.slice(2);
const Q = JSON.parse(arg) as { lat: number; lon: number; heightM: number; dateLocal: string; tzH: number; shots: Shot[] };
(async () => {
  const day = new Date(`${Q.dateLocal}T12:00:00Z`);
  const ring = await fetchDayWeatherRing(Q.lat, Q.lon, day, true);
  const jobs: unknown[] = [];
  const notes: string[] = [];
  for (const s of Q.shots) {
    const [h, m] = s.hm.split(':').map(Number);
    const date = new Date(Date.UTC(+Q.dateLocal.slice(0, 4), +Q.dateLocal.slice(5, 7) - 1, +Q.dateLocal.slice(8, 10), h - Q.tzH, m));
    const iw = getInterpolatedWeather(ring, date) as unknown as never;
    const built = buildLiveScene({ lat: Q.lat, lon: Q.lon, heightM: Q.heightM, date, pathData: ring, interpolatedWeather: iw, az: s.az, el: s.el, fov: s.fov });
    notes.push(`${s.name} ${date.toISOString()} ${built.summary}`);
    jobs.push({ name: s.name, input: { ...built.input, date: date.toISOString(), az: s.az, el: s.el, fov: s.fov }, frames: 32, quality: 'low', res: 0.5, out: 'both' });
  }
  require('fs').writeFileSync(out, JSON.stringify(jobs));
  console.log(notes.join('\n'));
})().catch(e => { console.error(e); process.exit(1); });
