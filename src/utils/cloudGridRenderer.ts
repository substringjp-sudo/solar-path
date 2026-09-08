/**
 * Cloud Grid Renderer — converts a CloudDensityGrid into
 * simplified SVG-compatible cloud polygon data for the Visualizer.
 *
 * Pipeline:  CloudDensityGrid  →  threshold filter  →  cluster grouping  →  hull/polygon  →  SVG path strings
 *
 * All pure JS — no native modules, no image decoding.
 * ~70 points processes in < 10ms on modern devices.
 */

import { CloudDensityGrid, CloudGridPoint } from './cloudGrid';
import { getApparentAltitude } from './sunsetPhysics';
import { EARTH_RADIUS_KM } from './earth';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GridCloudShape {
  id: string;
  type: 'high' | 'mid' | 'low';
  /** SVG path string (in polar-grid local coordinates — mapped to screen by Visualizer) */
  pathStr: string;
  /** Average density of the cluster (0-100) */
  density: number;
  /** Center azimuth offset from sun direction (degrees) */
  centerAzOffset: number;
  /** Center distance from observer (km) */
  centerDist: number;
  /** Apparent elevation angle from observer (degrees) */
  apparentElevation: number;
  /** Cloud color hint (base color, will be modified by sun proximity in Visualizer) */
  baseColor: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DENSITY_THRESHOLD = 15; // Minimum cloud cover % to include

/** Typical cloud altitudes in km by layer */
const LAYER_ALTITUDES: Record<string, number> = {
  high: 9.5,
  mid: 4.5,
  low: 1.5,
};

const EARTH_RADIUS = EARTH_RADIUS_KM; // km

// ---------------------------------------------------------------------------
// Helper: cluster adjacent points
// ---------------------------------------------------------------------------

/**
 * Groups grid points that are "adjacent" in the polar grid (similar azimuth offset + distance ring).
 * Uses a simple greedy flood-fill approach over the grid indices.
 */
function clusterPoints(
  points: CloudGridPoint[],
  layerKey: 'low' | 'mid' | 'high',
): CloudGridPoint[][] {
  // Filter to points above threshold
  const active = points.filter(p => p[layerKey] >= DENSITY_THRESHOLD);
  if (active.length === 0) return [];

  // Build adjacency: two points are neighbors if azOffset diff <= 15° AND distance ratio <= 2.5
  const visited = new Set<number>();
  const clusters: CloudGridPoint[][] = [];

  for (let i = 0; i < active.length; i++) {
    if (visited.has(i)) continue;

    const cluster: CloudGridPoint[] = [];
    const queue = [i];
    visited.add(i);

    while (queue.length > 0) {
      const ci = queue.shift()!;
      cluster.push(active[ci]);

      for (let j = 0; j < active.length; j++) {
        if (visited.has(j)) continue;

        const azDiff = Math.abs(active[ci].azOffset - active[j].azOffset);
        const distRatio = Math.max(active[ci].distance, active[j].distance) /
                          Math.max(1, Math.min(active[ci].distance, active[j].distance));

        if (azDiff <= 15 && distRatio <= 2.5) {
          visited.add(j);
          queue.push(j);
        }
      }
    }

    if (cluster.length >= 1) {
      clusters.push(cluster);
    }
  }

  return clusters;
}

// ---------------------------------------------------------------------------
// Helper: build a smooth bounding polygon around a cluster
// ---------------------------------------------------------------------------

/**
 * Creates a simplified convex-hull-like outline path string for a cluster.
 * Uses polar coordinates (azOffset, distance) then maps to a visual bounding shape.
 */
function buildClusterPath(
  cluster: CloudGridPoint[],
  _layerKey: 'low' | 'mid' | 'high',
): string {
  if (cluster.length === 1) {
    // Single point → small ellipse-like diamond
    const p = cluster[0];
    const cx = p.azOffset;
    const cy = p.distance;
    const rx = 8; // azimuth spread in degrees
    const ry = p.distance * 0.3; // distance spread in km
    return `M ${cx - rx},${cy} Q ${cx},${cy - ry} ${cx + rx},${cy} Q ${cx},${cy + ry} ${cx - rx},${cy} Z`;
  }

  // Sort points by angle around the centroid to form convex-ish hull
  const centroidAz = cluster.reduce((s, p) => s + p.azOffset, 0) / cluster.length;
  const centroidDist = cluster.reduce((s, p) => s + p.distance, 0) / cluster.length;

  const sorted = [...cluster].sort((a, b) => {
    const angA = Math.atan2(a.distance - centroidDist, a.azOffset - centroidAz);
    const angB = Math.atan2(b.distance - centroidDist, b.azOffset - centroidAz);
    return angA - angB;
  });

  // Build path with quadratic bezier curves for smoother outline
  const pts = sorted.map(p => ({
    x: p.azOffset,
    y: p.distance,
  }));

  // Expand each point outward from centroid to give the cloud some padding
  const expanded = pts.map(p => {
    const dx = p.x - centroidAz;
    const dy = p.y - centroidDist;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const padAz = 6; // degree padding
    const padDist = Math.max(15, centroidDist * 0.2); // km padding
    return {
      x: p.x + (dx / dist) * padAz,
      y: p.y + (dy / dist) * padDist,
    };
  });

  if (expanded.length < 2) {
    return `M ${expanded[0].x},${expanded[0].y} Z`;
  }

  // Smooth closed path using cubic bezier
  let path = `M ${expanded[0].x.toFixed(1)},${expanded[0].y.toFixed(1)}`;
  for (let i = 0; i < expanded.length; i++) {
    const curr = expanded[i];
    const next = expanded[(i + 1) % expanded.length];
    const mx = (curr.x + next.x) / 2;
    const my = (curr.y + next.y) / 2;
    path += ` Q ${curr.x.toFixed(1)},${curr.y.toFixed(1)} ${mx.toFixed(1)},${my.toFixed(1)}`;
  }
  path += ' Z';
  return path;
}

// ---------------------------------------------------------------------------
// Main conversion
// ---------------------------------------------------------------------------

/**
 * Converts a CloudDensityGrid into renderable cloud shapes.
 *
 * @param grid - The fetched cloud density grid
 * @param observerElevationM - Observer elevation in meters (for earth curvature projection)
 * @returns Array of GridCloudShape, sorted by distance (farthest first for proper z-ordering)
 */
export function convertGridToClouds(
  grid: CloudDensityGrid,
  observerElevationM: number = 50,
): GridCloudShape[] {
  const shapes: GridCloudShape[] = [];
  const layers: ('high' | 'mid' | 'low')[] = ['high', 'mid', 'low'];
  const h_v = observerElevationM / 1000; // observer alt in km

  const baseColors: Record<string, string> = {
    high: 'rgba(255, 192, 203, 0.5)',
    mid: 'rgba(180, 150, 220, 0.45)',
    low: 'rgba(100, 149, 237, 0.4)',
  };

  for (const layer of layers) {
    const clusters = clusterPoints(grid.points, layer);

    clusters.forEach((cluster, ci) => {
      const avgDensity = cluster.reduce((s, p) => s + p[layer], 0) / cluster.length;
      const centerAzOffset = cluster.reduce((s, p) => s + p.azOffset, 0) / cluster.length;
      const centerDist = cluster.reduce((s, p) => s + p.distance, 0) / cluster.length;

      // Compute apparent elevation via earth curvature
      const H_c = LAYER_ALTITUDES[layer];
      const phi = centerDist / EARTH_RADIUS;
      const Vx = (EARTH_RADIUS + H_c) * Math.sin(phi);
      const Vy = (EARTH_RADIUS + H_c) * Math.cos(phi) - (EARTH_RADIUS + h_v);
      const alpha = Math.atan2(Vy, Vx) * (180 / Math.PI);
      const apparentElev = getApparentAltitude(alpha);

      const pathStr = buildClusterPath(cluster, layer);

      shapes.push({
        id: `grid-${layer}-${ci}`,
        type: layer,
        pathStr,
        density: avgDensity,
        centerAzOffset,
        centerDist,
        apparentElevation: apparentElev,
        baseColor: baseColors[layer],
      });
    });
  }

  // Sort by distance (farthest first) for z-ordering
  shapes.sort((a, b) => b.centerDist - a.centerDist);
  return shapes;
}
