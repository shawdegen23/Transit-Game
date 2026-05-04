// Animated trains for operating routes.
//
// For each operating route, we spawn a handful of "trains" that loop along
// the route polyline in both directions. Train count scales with route
// length (one train per ~3 miles, minimum 2). Animation speed scales with
// the game clock speed, so trains are visible at 1× and zip at 16×.
//
// We keep the work cheap: cumulative path distances are cached per route
// (re-cached when the route list changes). Each frame we compute positions
// in O(trains × log path) via binary search.

import type { RouteSegment } from "../game/state";
import { getMode } from "../game/modes";

const TARGET_SPACING_MI = 3.0; // one train per ~3 miles of route, both directions
const SECONDS_PER_FULL_LOOP = 30; // at 1× game speed, each train traverses end-to-end in ~30s

// Per-route cached distances (in degrees-equivalent; we use the same units
// as the polyline since this is purely for visual interpolation).
interface PathCache {
  cum: number[];
  total: number;
  trainCount: number;
}

const cache = new WeakMap<RouteSegment, PathCache>();

function pathDist(a: [number, number], b: [number, number]): number {
  // Approximate flat-projection distance for cumulative-sum purposes.
  // Cosine adjustment is constant enough at LA latitudes.
  const dx = (b[0] - a[0]) * Math.cos((a[1] * Math.PI) / 180);
  const dy = b[1] - a[1];
  return Math.sqrt(dx * dx + dy * dy);
}

// Train count multiplier per frequency tier (matches FREQUENCY_MULT.trains).
const FREQ_TRAIN_MULT: Record<string, number> = {
  low: 0.5,
  standard: 1.0,
  high: 1.5,
};

function ensureCache(r: RouteSegment): PathCache | null {
  if (r.path.length < 2) return null;
  const existing = cache.get(r);
  if (existing) return existing;
  const cum = [0];
  for (let i = 1; i < r.path.length; i++) {
    cum.push(cum[i - 1] + pathDist(r.path[i - 1], r.path[i]));
  }
  const total = cum[cum.length - 1];
  const desired = Math.round(r.lengthMi / TARGET_SPACING_MI);
  const baseTrainCount = Math.max(2, Math.min(12, desired));
  const freqMult = FREQ_TRAIN_MULT[r.frequency ?? "standard"] ?? 1.0;
  const trainCount = Math.max(1, Math.round(baseTrainCount * freqMult));
  const c: PathCache = { cum, total, trainCount };
  cache.set(r, c);
  return c;
}

// Map t in [0,1) to a [lon, lat] on the polyline.
function pointAlong(path: [number, number][], cum: number[], total: number, t: number): [number, number] {
  const target = (((t % 1) + 1) % 1) * total;
  // Binary search for the segment containing target.
  let lo = 0, hi = cum.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= target) lo = mid;
    else hi = mid;
  }
  const segStart = cum[lo];
  const segEnd = cum[lo + 1] ?? segStart;
  const segLen = segEnd - segStart || 1;
  const segT = (target - segStart) / segLen;
  const a = path[lo];
  const b = path[lo + 1];
  return [a[0] + (b[0] - a[0]) * segT, a[1] + (b[1] - a[1]) * segT];
}

export interface TrainDot {
  position: [number, number];
  color: [number, number, number, number];
  size: number;
}

// Compute current train dots given the operating routes and the current
// real-time + game speed. timeSeconds is monotonic real-world wall time;
// speedMult scales how fast trains move (1, 4, 16, or 0 for paused).
export function computeTrains(
  routes: RouteSegment[],
  timeSeconds: number,
  speedMult: number,
): TrainDot[] {
  const dots: TrainDot[] = [];
  if (speedMult <= 0) {
    // Paused — still show static train positions so the network doesn't go
    // dark, but freeze them at their spawn offsets.
    speedMult = 0;
  }
  for (const r of routes) {
    if (r.status !== "operating") continue;
    const c = ensureCache(r);
    if (!c) continue;
    const m = getMode(r.mode);
    // Each loop takes SECONDS_PER_FULL_LOOP / speedMult seconds (or infinity if paused).
    const loopFraction = speedMult > 0
      ? (timeSeconds * speedMult) / SECONDS_PER_FULL_LOOP
      : 0;

    // Train sizes: heavier modes get bigger dots.
    const size = m.id === "hrt" ? 5 : m.id === "lrt" || m.id === "commuter" ? 4 : m.id === "brt" ? 3.5 : 3;
    const baseColor: [number, number, number] = m.color;

    // Forward direction: trains evenly spaced.
    for (let i = 0; i < c.trainCount; i++) {
      const phase = i / c.trainCount;
      const t = loopFraction + phase;
      const pos = pointAlong(r.path, c.cum, c.total, t);
      dots.push({
        position: pos,
        color: [baseColor[0], baseColor[1], baseColor[2], 255],
        size,
      });
    }
    // Reverse direction: trains going the other way (stagger phase).
    for (let i = 0; i < c.trainCount; i++) {
      const phase = (i + 0.5) / c.trainCount;
      const t = -loopFraction + phase; // negative direction
      const pos = pointAlong(r.path, c.cum, c.total, t);
      dots.push({
        position: pos,
        color: [baseColor[0], baseColor[1], baseColor[2], 255],
        size,
      });
    }
  }
  return dots;
}

export function clearCache(): void {
  // WeakMap doesn't have a clear; routes that get GC'd drop their entry.
  // Caller can rely on this no-op to mean "fine, things will rebuild".
}
