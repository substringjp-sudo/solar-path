import * as d3 from 'd3-geo';
import type { IsochronePoint } from '../../utils/celestial';
import { getGMSTDeg } from '../../utils/celestialCoords';
import { MILKY_WAY_EQUATOR_NODES } from '../../utils/celestialMilkyWayData';
import { morphRaw, morphClipAngle } from '../../utils/globeMorph';
import { getStarCatalog, bvToLinearRGB } from '../../utils/starCatalog';

export interface MilkyWayPatchNode {
  raDeg: number;
  sinDec: number;
  cosDec: number;
  angRad: number;
  coreWeight: number;
  isCore: boolean;
  hasDust: boolean;
}

let cachedMwNodes: MilkyWayPatchNode[] | null = null;
export function getSpaceMilkyWayNodes(): MilkyWayPatchNode[] {
  if (cachedMwNodes) return cachedMwNodes;
  const RAD = Math.PI / 180;
  const n = MILKY_WAY_EQUATOR_NODES.length;
  const vecs = MILKY_WAY_EQUATOR_NODES.map((pt) => {
    const ra = pt.raHours * 15 * RAD;
    const dec = pt.decDeg * RAD;
    const cd = Math.cos(dec);
    return { x: cd * Math.cos(ra), y: cd * Math.sin(ra), z: Math.sin(dec), lDeg: pt.lDeg };
  });
  const out: MilkyWayPatchNode[] = [];
  for (let i = 0; i < n; i++) {
    const a = vecs[i];
    const b = vecs[(i + 1) % n];
    for (let s = 0; s < 2; s++) {
      const t = s * 0.5;
      let vx = a.x * (1 - t) + b.x * t;
      let vy = a.y * (1 - t) + b.y * t;
      let vz = a.z * (1 - t) + b.z * t;
      const len = Math.hypot(vx, vy, vz) || 1;
      vx /= len; vy /= len; vz /= len;
      const lDeg = (a.lDeg + t * 15) % 360;
      const coreWeight = Math.pow(Math.max(0, Math.cos(lDeg * RAD)), 2.2);
      out.push({
        raDeg: Math.atan2(vy, vx) / RAD,
        sinDec: vz,
        cosDec: Math.hypot(vx, vy),
        angRad: 0.145 + 0.085 * coreWeight,
        coreWeight,
        isCore: coreWeight > 0.32,
        hasDust: coreWeight > 0.22 && s === 0,
      });
    }
  }
  cachedMwNodes = out;
  return out;
}

export interface SpaceStarEntry {
  raDeg: number;
  sinDec: number;
  cosDec: number;
  r: number;
  op: number;
  color: string;
  halo: boolean;
}

let cachedSpaceStars: SpaceStarEntry[] | null = null;
export function getSpaceStars(): SpaceStarEntry[] {
  if (cachedSpaceStars) return cachedSpaceStars;
  const cat = getStarCatalog();
  const RAD = Math.PI / 180;
  const list: SpaceStarEntry[] = [];
  for (let i = 0; i < cat.count; i++) {
    const mag = cat.magnitude[i];
    if (mag > 4.1) continue;
    const decRad = cat.decDeg[i] * RAD;
    const [lr, lg, lb] = bvToLinearRGB(cat.colorIndex[i]);
    const toSrgb = (c: number) => Math.round(Math.pow(Math.max(0, Math.min(1, c)), 1 / 2.2) * 255);
    const cr = toSrgb(lr * 0.72 + 0.28);
    const cg = toSrgb(lg * 0.72 + 0.28);
    const cb = toSrgb(lb * 0.72 + 0.28);
    list.push({
      raDeg: cat.raHours[i] * 15,
      sinDec: Math.sin(decRad),
      cosDec: Math.cos(decRad),
      r: Math.max(0.45, Math.min(1.85, 1.55 - mag * 0.27)),
      op: Math.max(0.28, Math.min(0.95, 0.92 - (mag + 1.5) * 0.11)),
      color: `rgb(${cr},${cg},${cb})`,
      halo: mag < 1.1,
    });
  }
  cachedSpaceStars = list;
  return list;
}

/**
 * 날짜변경선에서 잘린 조각을 다시 잇습니다. 평면 지도용으로 ±180° 에서 끊어 둔
 * 선이라, 구에서는 그 자리에 틈이 생깁니다. 끝과 시작이 5° 안이면 한 선입니다.
 * 공간 격자(6° 버킷)로 후보를 좁혀 최악 O(N^3) 병합을 O(N) 으로 처리합니다.
 */
export const joinOnSphere = (segments: IsochronePoint[][]): [number, number][][] => {
  const pts: [number, number][][] = [];
  for (let s = 0; s < segments.length; s++) {
    if (segments[s].length >= 2) {
      pts.push(segments[s].map(p => [p.longitude, p.latitude] as [number, number]));
    }
  }
  const n = pts.length;
  if (n <= 1) return pts;

  const THRESH_RAD = (5 * Math.PI) / 180;
  const CELL_DEG = 6;
  const LON_BINS = 60; // 360 / 6
  const LAT_BINS = 30; // 180 / 6
  const binOf = (lon: number, lat: number): [number, number] => {
    const lb = (((Math.floor((lon + 180) / CELL_DEG)) % LON_BINS) + LON_BINS) % LON_BINS;
    const bb = Math.max(0, Math.min(LAT_BINS - 1, Math.floor((lat + 90) / CELL_DEG)));
    return [lb, bb];
  };

  const buckets = new Map<number, number[]>();
  for (let j = 0; j < n; j++) {
    const [lb, bb] = binOf(pts[j][0][0], pts[j][0][1]);
    const key = bb * LON_BINS + lb;
    let arr = buckets.get(key);
    if (!arr) { arr = []; buckets.set(key, arr); }
    arr.push(j);
  }

  const nextSeg = new Int32Array(n).fill(-1);
  const hasPrev = new Uint8Array(n);
  const tailOf = Int32Array.from({ length: n }, (_, i) => i);
  const DEG_TO_RAD = Math.PI / 180;

  for (let i = 0; i < n; i++) {
    if (hasPrev[i]) continue;
    let tail = tailOf[i];
    while (true) {
      const endPt = pts[tail][pts[tail].length - 1];
      const [lb, bb] = binOf(endPt[0], endPt[1]);
      const cosLat = Math.max(0.05, Math.cos(endPt[1] * DEG_TO_RAD));
      const dLon = Math.min(LON_BINS >> 1, Math.ceil(5 / (CELL_DEG * cosLat)));
      let match = -1;
      for (let db = -1; db <= 1; db++) {
        const cb = bb + db;
        if (cb < 0 || cb >= LAT_BINS) continue;
        for (let dl = -dLon; dl <= dLon; dl++) {
          const cl = (((lb + dl) % LON_BINS) + LON_BINS) % LON_BINS;
          const cand = buckets.get(cb * LON_BINS + cl);
          if (!cand) continue;
          for (let k = 0; k < cand.length; k++) {
            const j = cand[k];
            if (hasPrev[j] || j === i) continue;
            if (d3.geoDistance(endPt, pts[j][0]) < THRESH_RAD && (match < 0 || j < match)) {
              match = j;
            }
          }
        }
      }
      if (match < 0) break;
      nextSeg[tail] = match;
      hasPrev[match] = 1;
      const newTail = tailOf[match];
      tailOf[i] = newTail;
      tail = newTail;
    }
  }

  const out: [number, number][][] = [];
  for (let i = 0; i < n; i++) {
    if (hasPrev[i]) continue;
    if (nextSeg[i] < 0) { out.push(pts[i]); continue; }
    const merged: [number, number][] = [];
    for (let cur = i; cur >= 0; cur = nextSeg[cur]) {
      const seg = pts[cur];
      for (let k = 0; k < seg.length; k++) merged.push(seg[k]);
    }
    out.push(merged);
  }
  return out;
};

/**
 * 형태 `morph` 의 투영. 1 이면 d3 정사영 그대로, 그 밖이면 메르카토르와 섞은 raw(§153, `globeMorph.ts`).
 * 구는 보이는 반구로, 섞인 형태는 극 바로 앞에서 자릅니다(`morphClipAngle`).
 */
export function makeProjection(morph: number, rotate: [number, number], radius: number, cx: number, cy: number) {
  const base = morph >= 1 ? d3.geoOrthographic() : d3.geoProjection(morphRaw(morph, -rotate[1]) as any);
  return base.scale(radius).translate([cx, cy]).rotate(rotate).clipAngle(morphClipAngle(morph, -rotate[1]));
}

export function geoPathFor(projection: d3.GeoProjection) {
  return d3.geoPath().projection(projection);
}

/** 적도(위도 0°)에 가장 인접한 좌표 선택 */
export function findEquatorPoint(segment: IsochronePoint[]): IsochronePoint | null {
  if (segment.length === 0) return null;
  let best = segment[0];
  let minDiff = Math.abs(best.latitude);
  for (const pt of segment) {
    const diff = Math.abs(pt.latitude);
    if (diff < minDiff) {
      minDiff = diff;
      best = pt;
    }
  }
  return best;
}

/** 메인 일출/일몰선 시간 라벨 위치 — 우주모드에서는 대기 광채 가장자리를 피해 지구 안쪽에 놓습니다. */
export function pickTerminatorMainLabelPt(
  segments: IsochronePoint[][],
  projection: d3.GeoProjection,
  rotate: [number, number],
  morph: number,
  radius: number,
  cx: number,
  cy: number,
): { x: number; y: number } | null {
  if (!segments || segments.length === 0) return null;
  const allPts = segments.reduce((acc: IsochronePoint[], val) => acc.concat(val), []);
  if (allPts.length === 0) return null;
  if (morph >= 0.9 && radius > 1) {
    let bestPos: { x: number; y: number } | null = null;
    let bestAbsLat = Infinity;
    const maxInnerR = radius * 0.84;
    for (let i = 0; i < allPts.length; i++) {
      const pt = allPts[i];
      const dist = d3.geoDistance([pt.longitude, pt.latitude], [-rotate[0], -rotate[1]]);
      if (dist >= Math.PI / 2 * 0.92) continue;
      const pos = projection([pt.longitude, pt.latitude]);
      if (!pos) continue;
      if (Math.hypot(pos[0] - cx, pos[1] - cy) > maxInnerR) continue;
      const aLat = Math.abs(pt.latitude);
      if (aLat < bestAbsLat) {
        bestAbsLat = aLat;
        bestPos = { x: pos[0], y: pos[1] };
      }
    }
    if (bestPos) return bestPos;
  }
  const eqPt = findEquatorPoint(allPts);
  if (eqPt) {
    const dist = d3.geoDistance([eqPt.longitude, eqPt.latitude], [-rotate[0], -rotate[1]]);
    if (dist < Math.PI / 2) {
      const pos = projection([eqPt.longitude, eqPt.latitude]);
      if (pos) return { x: pos[0], y: pos[1] };
    }
  }
  return null;
}

export interface SubTerminatorPathItem {
  sunrise: string | null;
  sunset: string | null;
  sunriseLabelPt: { x: number; y: number } | null;
  sunsetLabelPt: { x: number; y: number } | null;
  label: string;
  key: string;
}

export function buildSubTerminatorPaths(args: {
  allTerminators?: Array<{ time: Date; sunrise: IsochronePoint[][]; sunset: IsochronePoint[][] }>;
  showSubTerminators: boolean;
  makeTerminatorPath: (segs: IsochronePoint[][]) => string | null;
  rotate: [number, number];
  projection: d3.GeoProjection;
  formatTime: (d: Date) => string;
  mainSunriseLabelPt: { x: number; y: number } | null;
  mainSunsetLabelPt: { x: number; y: number } | null;
  morph: number;
  cx: number;
  cy: number;
  radius: number;
}): SubTerminatorPathItem[] {
  const {
    allTerminators, showSubTerminators, makeTerminatorPath, rotate, projection,
    formatTime, mainSunriseLabelPt, mainSunsetLabelPt, morph, cx, cy, radius,
  } = args;
  if (!allTerminators || !showSubTerminators) return [];

  const placed: Array<{ x: number; y: number; w: number; h: number }> = [];
  const mainW = morph >= 0.9 ? 48 : 28;
  if (mainSunriseLabelPt) placed.push({ x: mainSunriseLabelPt.x, y: mainSunriseLabelPt.y, w: mainW, h: 16 });
  if (mainSunsetLabelPt) placed.push({ x: mainSunsetLabelPt.x, y: mainSunsetLabelPt.y, w: mainW, h: 16 });

  const canPlace = (x: number, y: number, w: number, h: number) => {
    if (morph >= 0.92 && Math.hypot(x - cx, y - cy) > radius * 0.84) return false;
    for (let i = 0; i < placed.length; i++) {
      const b = placed[i];
      if (Math.abs(x - b.x) < (w + b.w) * 0.5 + 3 && Math.abs(y - b.y) < (h + b.h) * 0.5 + 2) {
        return false;
      }
    }
    return true;
  };

  const candLats = [0, 14, -14, 26, -26];
  const pickLabelPt = (segs: IsochronePoint[][]): { x: number; y: number } | null => {
    if (!segs || segs.length === 0) return null;
    const allPts = segs.reduce((acc: IsochronePoint[], val) => acc.concat(val), []);
    if (allPts.length === 0) return null;
    for (let c = 0; c < candLats.length; c++) {
      const targetLat = candLats[c];
      let best: IsochronePoint | null = null;
      let minDiff = 6.5;
      for (let i = 0; i < allPts.length; i++) {
        const diff = Math.abs(allPts[i].latitude - targetLat);
        if (diff < minDiff) {
          minDiff = diff;
          best = allPts[i];
        }
      }
      if (!best) continue;
      const dist = d3.geoDistance([best.longitude, best.latitude], [-rotate[0], -rotate[1]]);
      if (dist >= Math.PI / 2 * 0.95) continue;
      const pos = projection([best.longitude, best.latitude]);
      if (!pos) continue;
      if (canPlace(pos[0], pos[1], 24, 11)) {
        placed.push({ x: pos[0], y: pos[1], w: 24, h: 11 });
        return { x: pos[0], y: pos[1] };
      }
    }
    return null;
  };

  return allTerminators.map((term, idx) => ({
    sunrise: makeTerminatorPath(term.sunrise),
    sunset: makeTerminatorPath(term.sunset),
    sunriseLabelPt: pickLabelPt(term.sunrise),
    sunsetLabelPt: pickLabelPt(term.sunset),
    label: formatTime(term.time),
    key: `sub-term-paths-${idx}`,
  }));
}

export interface ProjectedBody {
  sx: number;
  sy: number;
  sr: number;
  inFront: boolean;
  px: number;
  py: number;
  pz: number;
}

export interface SpaceBodiesState {
  sun: ProjectedBody | null;
  moon: (ProjectedBody & { litFrac: number; angleDeg: number; shadowPath: string | 'full' | null }) | null;
}

export function computeSpaceBodies(args: {
  morph: number;
  radius: number;
  rotate: [number, number];
  width: number;
  height: number;
  cx: number;
  cy: number;
  subsolar: IsochronePoint;
  sublunar?: IsochronePoint | null;
}): SpaceBodiesState | null {
  const { morph, radius, rotate, width, height, cx, cy, subsolar, sublunar } = args;
  if (morph < 0.9 || radius <= 1) return null;
  const cLat = -rotate[1];
  const cLon = -rotate[0];
  const RAD = Math.PI / 180;
  const f = Math.max(width, height) * 0.9;
  const camZ = f / radius;

  const projectBody = (lat: number, lon: number, distR: number, radR: number): ProjectedBody | null => {
    const dLon = (lon - cLon) * RAD;
    const cosLat = Math.cos(lat * RAD), sinLat = Math.sin(lat * RAD);
    const cosCLat = Math.cos(cLat * RAD), sinCLat = Math.sin(cLat * RAD);
    const x = cosLat * Math.sin(dLon);
    const y = cosCLat * sinLat - sinCLat * cosLat * Math.cos(dLon);
    const z = sinCLat * sinLat + cosCLat * cosLat * Math.cos(dLon);
    const cz = camZ - z * distR;
    if (cz <= 0.1) return null;
    const sx = cx + ((x * distR) / cz) * f;
    const sy = cy - ((y * distR) / cz) * f;
    const sr = Math.max(1.5, (radR / cz) * f);
    if (sx < -sr - 50 || sx > width + sr + 50 || sy < -sr - 50 || sy > height + sr + 50) return null;
    return { sx, sy, sr, inFront: z >= 0, px: x * distR, py: y * distR, pz: z * distR };
  };

  const sun = projectBody(subsolar.latitude, subsolar.longitude, 23480, 109.2);
  const moonRaw = sublunar ? projectBody(sublunar.latitude, sublunar.longitude, 60.3, 0.2725) : null;
  let moon: SpaceBodiesState['moon'] = null;
  if (moonRaw) {
    const sLonR = (subsolar.longitude - cLon) * RAD;
    const sLatR = subsolar.latitude * RAD;
    const cLatR = cLat * RAD;
    const sx3 = Math.cos(sLatR) * Math.sin(sLonR) * 23480;
    const sy3 = (Math.cos(cLatR) * Math.sin(sLatR) - Math.sin(cLatR) * Math.cos(sLatR) * Math.cos(sLonR)) * 23480;
    const sz3 = (Math.sin(cLatR) * Math.sin(sLatR) + Math.cos(cLatR) * Math.cos(sLatR) * Math.cos(sLonR)) * 23480;
    let lx = sx3 - moonRaw.px, ly = sy3 - moonRaw.py, lz = sz3 - moonRaw.pz;
    const lLen = Math.hypot(lx, ly, lz) || 1;
    lx /= lLen; ly /= lLen; lz /= lLen;

    let vx = -moonRaw.px, vy = -moonRaw.py, vz = camZ - moonRaw.pz;
    const vLen = Math.hypot(vx, vy, vz) || 1;
    vx /= vLen; vy /= vLen; vz /= vLen;

    const litFrac = Math.max(0, Math.min(1, (1 + (lx * vx + ly * vy + lz * vz)) * 0.5));
    const upX = Math.abs(vy) > 0.99 ? 0 : 0, upY = Math.abs(vy) > 0.99 ? 0 : 1, upZ = Math.abs(vy) > 0.99 ? -1 : 0;
    let ux = upY * vz - upZ * vy, uy = upZ * vx - upX * vz, uz = upX * vy - upY * vx;
    const uLen = Math.hypot(ux, uy, uz) || 1;
    ux /= uLen; uy /= uLen; uz /= uLen;
    const wx = vy * uz - vz * uy, wy = vz * ux - vx * uz, wz = vx * uy - vy * ux;
    const lu = lx * ux + ly * uy + lz * uz;
    const lw = lx * wx + ly * wy + lz * wz;
    const angleDeg = (Math.atan2(-lw, lu) * 180) / Math.PI;

    const r = moonRaw.sr;
    const rx = Math.abs(2 * litFrac - 1) * r;
    const shadowPath = litFrac > 0.995
      ? null
      : litFrac < 0.005
        ? 'full'
        : `M0 ${r} A${r} ${r} 0 0 1 0 ${-r} A${rx} ${r} 0 0 ${litFrac > 0.5 ? 0 : 1} 0 ${r} Z`;
    moon = { ...moonRaw, litFrac, angleDeg, shadowPath };
  }
  return { sun, moon };
}

export function projectSpaceStars(args: {
  morph: number;
  radius: number;
  rotate: [number, number];
  width: number;
  height: number;
  cx: number;
  cy: number;
  gmstMin: number;
  spaceBodies: SpaceBodiesState | null;
}) {
  const { morph, radius, rotate, width, height, cx, cy, gmstMin, spaceBodies } = args;
  if (morph < 0.9 || radius <= 1) return null;
  const morphFade = Math.min(1, (morph - 0.9) / 0.1);
  const stars = getSpaceStars();
  const gmstDeg = getGMSTDeg(new Date(gmstMin * 60000));
  const cLat = -rotate[1];
  const cLon = -rotate[0];
  const RAD = Math.PI / 180;
  const cosCLat = Math.cos(cLat * RAD);
  const sinCLat = Math.sin(cLat * RAD);
  const f = Math.max(width, height) * 0.9;
  const earthOccR2 = morph >= 0.999 ? (radius - 1.5) * (radius - 1.5) : 0;
  const sun = spaceBodies?.sun;
  const out: Array<{ sx: number; sy: number; r: number; op: number; color: string; halo: boolean }> = [];
  for (let i = 0; i < stars.length; i++) {
    const st = stars[i];
    const dLon = (st.raDeg - gmstDeg - cLon) * RAD;
    const cosDLon = Math.cos(dLon);
    const x = st.cosDec * Math.sin(dLon);
    const y = cosCLat * st.sinDec - sinCLat * st.cosDec * cosDLon;
    const z = sinCLat * st.sinDec + cosCLat * st.cosDec * cosDLon;
    if (z >= -0.08) continue;
    const invZ = 1 / -z;
    const sx = cx + x * invZ * f;
    const sy = cy - y * invZ * f;
    if (sx < -4 || sx > width + 4 || sy < -4 || sy > height + 4) continue;
    if (earthOccR2 > 0) {
      const dxE = sx - cx;
      const dyE = sy - cy;
      if (dxE * dxE + dyE * dyE < earthOccR2) continue;
    }
    let glareFade = 1;
    if (sun) {
      const dSun = Math.hypot(sx - sun.sx, sy - sun.sy);
      if (dSun < sun.sr * 7) {
        glareFade = Math.max(0.08, (dSun - sun.sr * 1.2) / (sun.sr * 5.8));
      }
    }
    out.push({ sx, sy, r: st.r, op: st.op * morphFade * glareFade, color: st.color, halo: st.halo });
  }
  return out;
}

export function projectSpaceMilkyWay(args: {
  morph: number;
  radius: number;
  rotate: [number, number];
  width: number;
  height: number;
  cx: number;
  cy: number;
  gmstMin: number;
  spaceBodies: SpaceBodiesState | null;
}) {
  const { morph, radius, rotate, width, height, cx, cy, gmstMin, spaceBodies } = args;
  if (morph < 0.9 || radius <= 1) return null;
  const morphFade = Math.min(1, (morph - 0.9) / 0.1);
  const nodes = getSpaceMilkyWayNodes();
  const gmstDeg = getGMSTDeg(new Date(gmstMin * 60000));
  const cLat = -rotate[1];
  const cLon = -rotate[0];
  const RAD = Math.PI / 180;
  const cosCLat = Math.cos(cLat * RAD);
  const sinCLat = Math.sin(cLat * RAD);
  const f = Math.max(width, height) * 0.9;
  const sun = spaceBodies?.sun;
  const out: Array<{ sx: number; sy: number; r: number; op: number; isCore: boolean; hasDust: boolean }> = [];
  for (let i = 0; i < nodes.length; i++) {
    const nd = nodes[i];
    const dLon = (nd.raDeg - gmstDeg - cLon) * RAD;
    const cosDLon = Math.cos(dLon);
    const x = nd.cosDec * Math.sin(dLon);
    const y = cosCLat * nd.sinDec - sinCLat * nd.cosDec * cosDLon;
    const z = sinCLat * nd.sinDec + cosCLat * nd.cosDec * cosDLon;
    if (z >= -0.08) continue;
    const invZ = 1 / -z;
    const sx = cx + x * invZ * f;
    const sy = cy - y * invZ * f;
    const r = nd.angRad * invZ * f;
    if (sx < -r || sx > width + r || sy < -r || sy > height + r) continue;
    let earthFade = 1;
    if (morph >= 0.999) {
      const edgeDist = Math.hypot(sx - cx, sy - cy) - radius;
      if (edgeDist < -r * 0.2) continue;
      if (edgeDist < r * 0.55) earthFade = Math.max(0, (edgeDist + r * 0.2) / (r * 0.75));
    }
    let glareFade = 1;
    if (sun) {
      const dSun = Math.hypot(sx - sun.sx, sy - sun.sy);
      if (dSun < sun.sr * 9) {
        glareFade = Math.max(0.15, dSun / (sun.sr * 9));
      }
    }
    const op = (0.34 + 0.56 * nd.coreWeight) * morphFade * glareFade * earthFade;
    out.push({ sx, sy, r, op, isCore: nd.isCore, hasDust: nd.hasDust });
  }
  return out;
}

export function computeSpaceAtmosphere(args: {
  morph: number;
  radius: number;
  rotate: [number, number];
  subsolar: IsochronePoint;
}) {
  const { morph, radius, rotate, subsolar } = args;
  if (morph < 0.5 || radius <= 1) return null;
  const op = Math.min(1, (morph - 0.5) / 0.45);
  const RAD = Math.PI / 180;
  const dLon = (subsolar.longitude - (-rotate[0])) * RAD;
  const sLatR = subsolar.latitude * RAD;
  const cLatR = (-rotate[1]) * RAD;
  const sx = Math.cos(sLatR) * Math.sin(dLon);
  const sy = -(Math.cos(cLatR) * Math.sin(sLatR) - Math.sin(cLatR) * Math.cos(sLatR) * Math.cos(dLon));
  const sz = Math.sin(cLatR) * Math.sin(sLatR) + Math.cos(cLatR) * Math.cos(sLatR) * Math.cos(dLon);
  const len = Math.hypot(sx, sy) || 1;
  const hx = sx;
  const hy = sy;
  const hz = sz + 1;
  const hLen = Math.hypot(hx, hy, hz) || 1;
  const glintCxPct = `${(50 + (hx / hLen) * 50).toFixed(1)}%`;
  const glintCyPct = `${(50 + (hy / hLen) * 50).toFixed(1)}%`;
  const glintOp = sz > -0.25 ? Math.max(0, Math.min(1, (sz + 0.25) / 1.15)) : 0;
  return {
    op,
    cxPct: `${(50 + (sx / len) * 16).toFixed(1)}%`,
    cyPct: `${(50 + (sy / len) * 16).toFixed(1)}%`,
    sunDirX: sx / len,
    sunDirY: sy / len,
    glintCxPct,
    glintCyPct,
    glintOp,
  };
}

export function computeOrbitalSunrise(args: {
  morph: number;
  radius: number;
  cx: number;
  cy: number;
  spaceBodies: SpaceBodiesState | null;
}) {
  const { morph, radius, cx, cy, spaceBodies } = args;
  if (morph < 0.9 || radius <= 1 || !spaceBodies?.sun || spaceBodies.sun.inFront) return null;
  const sun = spaceBodies.sun;
  const dx = sun.sx - cx;
  const dy = sun.sy - cy;
  const d = Math.hypot(dx, dy);
  const limbGap = d - radius;
  if (limbGap < -sun.sr * 2.6 || limbGap > sun.sr * 3.6) return null;
  const rawArc = limbGap < 0
    ? Math.max(0, 1 + limbGap / (sun.sr * 2.6))
    : Math.max(0, 1 - limbGap / (sun.sr * 2.8));
  const arcStrength = rawArc * rawArc * (3 - 2 * rawArc);
  const rawFlare = limbGap < sun.sr * 0.2
    ? Math.max(0, (limbGap + sun.sr * 1.1) / (sun.sr * 1.3))
    : Math.max(0, 1 - (limbGap - sun.sr * 0.2) / (sun.sr * 3.0));
  const flareStrength = rawFlare * rawFlare * (3 - 2 * rawFlare);
  const angRad = Math.atan2(dy, dx);
  const angDeg = (angRad * 180) / Math.PI;
  const lx = cx + radius * Math.cos(angRad);
  const ly = cy + radius * Math.sin(angRad);
  const makeArc = (rad: number, halfSpanDeg: number) => {
    const span = (halfSpanDeg * Math.PI) / 180;
    const a1 = angRad - span;
    const a2 = angRad + span;
    return `M ${(cx + rad * Math.cos(a1)).toFixed(2)} ${(cy + rad * Math.sin(a1)).toFixed(2)} A ${rad.toFixed(2)} ${rad.toFixed(2)} 0 0 1 ${(cx + rad * Math.cos(a2)).toFixed(2)} ${(cy + rad * Math.sin(a2)).toFixed(2)}`;
  };
  return {
    arcStrength,
    flareStrength,
    angDeg,
    lx,
    ly,
    flareR: Math.max(22, sun.sr * 4.6),
    rayTangential: Math.max(26, sun.sr * 6.5),
    rayNormal: Math.max(18, sun.sr * 4.0),
    blueArc: makeArc(radius + 1.6, 22),
    amberArc: makeArc(radius + 0.7, 17),
    redArc: makeArc(radius + 0.1, 12),
  };
}
