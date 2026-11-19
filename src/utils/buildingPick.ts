/**
 * 건물 고르기 (2026-11-19, docs/SANDBOX_MODE_PLAN.md 3.2 "3D 화면 누르기: 누른 방향으로 선을 쏴 처음 닿는 지형이나 건물,
 * 꼭대기를 원하면 그 건물의 가장 높은 점으로 붙임").
 *
 * 건물 기하(`BuildingMeshData`)는 삼각형을 한 덩어리로 합친 것이라 "어느 건물인가"를 알 수 없습니다. 그래서 기하를 만들 때
 * 건물마다 **발자국 고리·지붕 높이·벽 아랫단**을 같이 적어 둔 색인(`BuildingPickIndex`)을 만들고, 시선과 색인을 직접 맞춥니다.
 *
 * 좌표는 눈 기준 지상 미터(x = 동, z = 남)이고 높이는 건물 지반 중심의 해발에서 잰 상대값입니다. 지반 해발은 렌더링과 같이
 * 지반 중심에서 높이 표본(`HeightSampler`)을 읽습니다(건물 셰이더 `bf_groundElev(aGroundPos)` 와 같은 자리).
 *
 * 시선의 높이는 `rayHitTerrain` 과 같은 식입니다: 눈에서 지상 거리 d 에서 시선 높이 z(d) = 눈 + d·tan(앙각) + 낙차(d).
 * 눈에서 본 겉보기 앙각이 같은 점들이 한 시선 위에 있다는 뜻이라 지형 고르기와 같은 화면 규약입니다.
 */
import { curvatureDropM } from './earth';
import type { HeightSampler } from './demPick';

const RAD = Math.PI / 180;

/** 건물마다 한 줄(구조 배열). `ring` 은 (x, z) 쌍을 이어 붙인 것, 건물 i 의 고리는 [ringStart[i], ringStart[i+1]) 쌍. */
export interface BuildingPickIndex {
  count: number;
  /** 지반 중심(동, 남) */
  cx: Float32Array;
  cz: Float32Array;
  /** 지반 위 지붕 높이(m) */
  topH: Float32Array;
  /** 지반 위 벽 아랫단(m). 땅에 닿은 건물은 음수(땅속 치마), 공중에 뜬 부분은 양수. */
  botH: Float32Array;
  /** 중심에서 가장 먼 고리 점까지(m) — 빠른 제외용 */
  rad: Float32Array;
  ringStart: Uint32Array;
  ring: Float32Array;
}

export interface PickIndexBuilder {
  add: (cx: number, cz: number, topH: number, botH: number, pts: { x: number; z: number }[]) => void;
  /** 한 채도 없으면 undefined */
  finish: () => BuildingPickIndex | undefined;
}

/** 건물 기하를 만드는 반복문 옆에서 한 채씩 적어 넣는 도우미. */
export function createPickIndexBuilder(): PickIndexBuilder {
  const cx: number[] = [], cz: number[] = [], topH: number[] = [], botH: number[] = [], rad: number[] = [];
  const ringStart: number[] = [0];
  const ring: number[] = [];
  return {
    add(centerX, centerZ, top, bot, pts) {
      let r2 = 0;
      for (const p of pts) {
        ring.push(p.x, p.z);
        const d2 = (p.x - centerX) * (p.x - centerX) + (p.z - centerZ) * (p.z - centerZ);
        if (d2 > r2) r2 = d2;
      }
      cx.push(centerX); cz.push(centerZ); topH.push(top); botH.push(bot); rad.push(Math.sqrt(r2));
      ringStart.push(ring.length / 2);
    },
    finish() {
      if (cx.length === 0) return undefined;
      return {
        count: cx.length,
        cx: new Float32Array(cx), cz: new Float32Array(cz),
        topH: new Float32Array(topH), botH: new Float32Array(botH), rad: new Float32Array(rad),
        ringStart: new Uint32Array(ringStart), ring: new Float32Array(ring),
      };
    },
  };
}

/** 두 색인을 하나로 잇습니다(건물 번호는 a 다음에 b). 한쪽이 비면 다른 쪽을 그대로. */
export function concatPickIndex(a?: BuildingPickIndex | null, b?: BuildingPickIndex | null): BuildingPickIndex | undefined {
  if (!a || a.count === 0) return b ?? undefined;
  if (!b || b.count === 0) return a;
  const cat = <T extends Float32Array | Uint32Array>(x: T, y: T, Ctor: { new (n: number): T }): T => { const o = new Ctor(x.length + y.length); o.set(x, 0); o.set(y, x.length); return o; };
  const ringShift = a.ring.length / 2;
  const rs = new Uint32Array(a.count + b.count + 1);
  rs.set(a.ringStart, 0);
  for (let i = 1; i <= b.count; i++) rs[a.count + i] = b.ringStart[i] + ringShift;
  return {
    count: a.count + b.count,
    cx: cat(a.cx, b.cx, Float32Array), cz: cat(a.cz, b.cz, Float32Array),
    topH: cat(a.topH, b.topH, Float32Array), botH: cat(a.botH, b.botH, Float32Array), rad: cat(a.rad, b.rad, Float32Array),
    ringStart: rs, ring: cat(a.ring, b.ring, Float32Array),
  };
}

export interface BuildingHit {
  /** 색인 안의 건물 번호 */
  index: number;
  /** 눈에서 지상 거리(m)와 닿은 점(동, 남, 해발) */
  distM: number;
  eastM: number;
  southM: number;
  elevM: number;
  /** 벽에 닿았는가, 지붕에 닿았는가 */
  part: 'wall' | 'roof';
  /** 그 건물 지반 중심의 해발과 지붕 해발 */
  baseElevM: number;
  topElevM: number;
}

/**
 * 눈(해발 eyeM)에서 방위 azDeg·앙각 elDeg 로 쏜 시선이 처음 닿는 건물. 닿는 건물이 없으면 null.
 * 건물을 "발자국 위에 선 기둥(아랫단~지붕)"으로 봅니다. 시선의 지상 투영선이 발자국 고리를 드나드는 거리 구간마다 시선 높이를 대어
 * 들어오는 곳이 벽 높이 안이면 벽, 지붕보다 위에서 들어와 내려오다 지붕 높이를 만나면 지붕입니다. 아랫단보다 아래로 들어오면
 * (땅속이거나 공중에 뜬 부분 밑) 안 닿은 것으로 봅니다. 땅이 먼저 막는 경우는 부르는 쪽이 `maxDistM` 로 거릅니다.
 */
export function rayHitBuildings(
  idx: BuildingPickIndex,
  sample: HeightSampler,
  eyeM: number,
  azDeg: number,
  elDeg: number,
  opts: { maxDistM?: number; minDistM?: number } = {},
): BuildingHit | null {
  const maxD = opts.maxDistM ?? 40000;
  const minD = opts.minDistM ?? 3;
  const dx = Math.sin(azDeg * RAD), dz = -Math.cos(azDeg * RAD);
  const tan = Math.tan(elDeg * RAD);
  const rayZ = (t: number) => eyeM + t * tan + curvatureDropM(t);
  let best: BuildingHit | null = null;
  let bestT = maxD;
  const ts: number[] = [];
  for (let i = 0; i < idx.count; i++) {
    const cx = idx.cx[i], cz = idx.cz[i], rad = idx.rad[i];
    const along = cx * dx + cz * dz;
    if (along + rad < minD || along - rad > bestT) continue;
    if (Math.abs(cx * dz - cz * dx) > rad) continue;   // 시선의 지상 투영선이 이 건물 반지름 밖
    // 고리 교차 거리들
    ts.length = 0;
    const s0 = idx.ringStart[i], s1 = idx.ringStart[i + 1];
    for (let j = s0; j < s1; j++) {
      const k = j + 1 < s1 ? j + 1 : s0;
      const ax = idx.ring[2 * j], az = idx.ring[2 * j + 1];
      const sx = idx.ring[2 * k] - ax, sz = idx.ring[2 * k + 1] - az;
      const den = dx * sz - dz * sx;
      if (Math.abs(den) < 1e-9) continue;
      const t = (ax * sz - az * sx) / den;
      const u = (ax * dz - az * dx) / den;
      if (t > 0 && u >= 0 && u < 1) ts.push(t);
    }
    if (ts.length < 2) continue;
    ts.sort((p, q) => p - q);
    let base: number | null | undefined;   // 지연 계산: 시선이 이 건물의 발자국을 지날 때만 표본을 읽습니다
    for (let p = 0; p + 1 < ts.length; p += 2) {
      const tIn = ts[p], tOut = ts[p + 1];
      if (tOut < minD) continue;
      if (tIn >= bestT) break;
      if (base === undefined) base = sample(cx, cz);
      if (base == null) break;
      const top = base + idx.topH[i];
      const bot = base + idx.botH[i];
      const zIn = rayZ(tIn);
      let t: number, z: number, part: 'wall' | 'roof';
      if (zIn < bot) continue;
      if (zIn <= top) { t = tIn; z = zIn; part = 'wall'; }
      else if (tan < 0 && rayZ(tOut) <= top) {
        let lo = tIn, hi = tOut;
        for (let it = 0; it < 30; it++) { const mid = (lo + hi) / 2; if (rayZ(mid) > top) lo = mid; else hi = mid; }
        t = hi; z = top; part = 'roof';
      } else continue;
      if (t < bestT && t >= minD) {
        bestT = t;
        best = { index: i, distM: t, eastM: t * dx, southM: t * dz, elevM: z, part, baseElevM: base, topElevM: top };
      }
      break;   // 이 건물의 가장 가까운 닿음만
    }
  }
  return best;
}

/** 점이 고리 안인가(짝홀수 규칙). 고리는 [s0, s1) 쌍. */
function insideRing(ring: Float32Array, s0: number, s1: number, x: number, z: number): boolean {
  let inside = false;
  for (let j = s0, k = s1 - 1; j < s1; k = j++) {
    const xj = ring[2 * j], zj = ring[2 * j + 1], xk = ring[2 * k], zk = ring[2 * k + 1];
    if ((zj > z) !== (zk > z) && x < ((xk - xj) * (z - zj)) / (zk - zj) + xj) inside = !inside;
  }
  return inside;
}

/** 점에서 고리(경계)까지 가장 가까운 거리(m). */
function distToRing(ring: Float32Array, s0: number, s1: number, x: number, z: number): number {
  let best = Infinity;
  for (let j = s0; j < s1; j++) {
    const k = j + 1 < s1 ? j + 1 : s0;
    const ax = ring[2 * j], az = ring[2 * j + 1];
    const sx = ring[2 * k] - ax, sz = ring[2 * k + 1] - az;
    const len2 = sx * sx + sz * sz;
    const u = len2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * sx + (z - az) * sz) / len2)) : 0;
    const d = Math.hypot(x - (ax + u * sx), z - (az + u * sz));
    if (d < best) best = d;
  }
  return best;
}

/**
 * 지붕의 대표점("꼭대기에 붙임"에 쓰는 자리). 넓이 무게중심이 고리 안이고 가장자리에서 충분히 떨어져 있으면 그것, 아니면(ㄱ자·ㄷ자)
 * 고리 안에서 가장자리와 가장 먼 점(격자로 찾음).
 */
export function roofCenter(idx: BuildingPickIndex, i: number): { x: number; z: number } {
  const s0 = idx.ringStart[i], s1 = idx.ringStart[i + 1];
  const ring = idx.ring;
  // 넓이 무게중심(신발끈)
  let a2 = 0, gx = 0, gz = 0;
  for (let j = s0; j < s1; j++) {
    const k = j + 1 < s1 ? j + 1 : s0;
    const x0 = ring[2 * j], z0 = ring[2 * j + 1], x1 = ring[2 * k], z1 = ring[2 * k + 1];
    const cr = x0 * z1 - x1 * z0;
    a2 += cr; gx += (x0 + x1) * cr; gz += (z0 + z1) * cr;
  }
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let j = s0; j < s1; j++) {
    const x = ring[2 * j], z = ring[2 * j + 1];
    if (x < minX) minX = x; if (x > maxX) maxX = x; if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  // 가장자리에서 가장 먼 안쪽 점(13×13 격자)
  let bestD = -1, bx = idx.cx[i], bz = idx.cz[i];
  const N = 13;
  for (let p = 0; p < N; p++) {
    for (let q = 0; q < N; q++) {
      const x = minX + ((p + 0.5) / N) * (maxX - minX), z = minZ + ((q + 0.5) / N) * (maxZ - minZ);
      if (!insideRing(ring, s0, s1, x, z)) continue;
      const d = distToRing(ring, s0, s1, x, z);
      if (d > bestD) { bestD = d; bx = x; bz = z; }
    }
  }
  if (Math.abs(a2) > 1e-6) {
    const x = gx / (3 * a2), z = gz / (3 * a2);
    if (insideRing(ring, s0, s1, x, z) && distToRing(ring, s0, s1, x, z) >= 0.5 * Math.max(bestD, 0)) return { x, z };
  }
  return { x: bx, z: bz };
}

/** 발자국의 긴 변·짧은 변(m): 고리를 돌려 가며 잰 가장 작은 외접 사각형. 5° 걸음으로 찾은 뒤 0.5° 로 다듬음. */
export function footprintDimsM(idx: BuildingPickIndex, i: number): { longM: number; shortM: number } {
  const s0 = idx.ringStart[i], s1 = idx.ringStart[i + 1];
  const ring = idx.ring;
  const measure = (deg: number): [number, number] => {
    const c = Math.cos(deg * RAD), s = Math.sin(deg * RAD);
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (let j = s0; j < s1; j++) {
      const x = ring[2 * j], z = ring[2 * j + 1];
      const u = x * c + z * s, v = -x * s + z * c;
      if (u < u0) u0 = u; if (u > u1) u1 = u; if (v < v0) v0 = v; if (v > v1) v1 = v;
    }
    return [u1 - u0, v1 - v0];
  };
  let bestDeg = 0, bestArea = Infinity;
  for (let d = 0; d < 90; d += 5) { const [w, h] = measure(d); if (w * h < bestArea) { bestArea = w * h; bestDeg = d; } }
  let bw = 0, bh = 0;
  bestArea = Infinity;
  for (let d = bestDeg - 5; d <= bestDeg + 5.0001; d += 0.5) { const [w, h] = measure(d); if (w * h < bestArea) { bestArea = w * h; bw = w; bh = h; } }
  return { longM: Math.max(bw, bh), shortM: Math.min(bw, bh) };
}
