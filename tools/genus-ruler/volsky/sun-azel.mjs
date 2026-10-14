#!/usr/bin/env node
/**
 * sun-azel.mjs — 하네스(volumetricScene.sunAltAt)와 **같은 함수**로 해의 방위·고도를 냅니다(suncalc 와 최대 0.2° 정도 다를 수 있음 —
 * 해 둘레 무리를 재는 장면은 시선이 해 중심에 정확히 맞아야 하므로 엔진 값을 씁니다).
 *   node tools/genus-ruler/volsky/sun-azel.mjs lat lon heightM ISO [ISO …]    → 줄마다 {iso, az, el}(방위 0 = 북, 90 = 동)
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const OUT = path.join(ROOT, '.harness/sun');
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'entry.ts'), `
import { Matrix4, Vector3 } from 'three';
import { getSunDirectionECEF } from '@takram/three-atmosphere';
import { Ellipsoid, Geodetic, radians } from '@takram/three-geospatial';
const [lat, lon, h, ...isos] = process.argv.slice(2);
const pos = new Geodetic(radians(+lon), radians(+lat), +h).toECEF();
const nue = Ellipsoid.WGS84.getNorthUpEastFrame(pos, new Matrix4());
const inv = nue.clone().invert();
for (const iso of isos) {
  const sun = getSunDirectionECEF(new Date(iso), new Vector3());
  const l = sun.clone().transformDirection(inv);   // x = 북, y = 위, z = 동 (placeCamera 와 같은 장면 좌표)
  const az = (Math.atan2(l.z, l.x) * 180 / Math.PI + 360) % 360, el = Math.asin(Math.max(-1, Math.min(1, l.y))) * 180 / Math.PI;
  console.log(JSON.stringify({ iso, az: +az.toFixed(3), el: +el.toFixed(3) }));
}
`);
execFileSync('npx', ['esbuild', path.join(OUT, 'entry.ts'), '--bundle', '--format=cjs', '--platform=node', '--define:__DEV__=false', `--outfile=${path.join(OUT, 'out.cjs')}`, '--log-level=error'], { cwd: ROOT, stdio: 'inherit' });
execFileSync('node', [path.join(OUT, 'out.cjs'), ...process.argv.slice(2)], { stdio: 'inherit' });
