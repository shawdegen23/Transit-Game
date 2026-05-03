// Existing right-of-way corridors (rail + freeway) used to discount
// player route construction when the route runs alongside them.
//
// Loads the cached la-corridors.json once. Computes overlap by sampling
// the player's route polyline at fixed intervals and checking each sample
// point's distance to corridor segments via a uniform-grid spatial index.

export interface CorridorFeature {
  kind: "rail" | "freeway";
  coords: [number, number][];
}

interface CorridorsFile {
  bbox: [number, number, number, number];
  features: CorridorFeature[];
}

let LOADED = false;
let FEATURES: CorridorFeature[] = [];
let SEGMENTS: { kind: "rail" | "freeway"; a: [number, number]; b: [number, number] }[] = [];

export function getCorridorFeatures(): CorridorFeature[] {
  return FEATURES;
}
// Spatial index: cell key → indices into SEGMENTS
let GRID: Map<string, number[]> = new Map();
const CELL_DEG = 0.005; // ~550m at LA latitude

function gridKey(lon: number, lat: number): string {
  const i = Math.floor(lon / CELL_DEG);
  const j = Math.floor(lat / CELL_DEG);
  return `${i}|${j}`;
}

export async function loadCorridors(): Promise<void> {
  if (LOADED) return;
  try {
    const res = await fetch("/la-corridors.json");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as CorridorsFile;
    FEATURES = data.features;
    SEGMENTS = [];
    for (const f of data.features) {
      for (let i = 0; i + 1 < f.coords.length; i++) {
        SEGMENTS.push({ kind: f.kind, a: f.coords[i], b: f.coords[i + 1] });
      }
    }
    GRID = new Map();
    for (let i = 0; i < SEGMENTS.length; i++) {
      const seg = SEGMENTS[i];
      // Index by both endpoints' cells, plus midpoint for long segments.
      const cells = new Set<string>();
      cells.add(gridKey(seg.a[0], seg.a[1]));
      cells.add(gridKey(seg.b[0], seg.b[1]));
      cells.add(gridKey((seg.a[0] + seg.b[0]) / 2, (seg.a[1] + seg.b[1]) / 2));
      for (const k of cells) {
        if (!GRID.has(k)) GRID.set(k, []);
        GRID.get(k)!.push(i);
      }
    }
    LOADED = true;
    // eslint-disable-next-line no-console
    console.log(`[corridors] loaded ${data.features.length} features, ${SEGMENTS.length} segments`);
  } catch (err) {
    console.warn("[corridors] failed:", err);
    LOADED = true;
  }
}

const M_PER_DEG_LAT = 111_320;

function approxDistM(a: [number, number], b: [number, number]): number {
  const meanLat = ((a[1] + b[1]) / 2) * (Math.PI / 180);
  const dx = (b[0] - a[0]) * M_PER_DEG_LAT * Math.cos(meanLat);
  const dy = (b[1] - a[1]) * M_PER_DEG_LAT;
  return Math.sqrt(dx * dx + dy * dy);
}

// Distance from point p to segment [a, b], in meters (approximate, flat Earth).
function pointToSegmentM(
  p: [number, number],
  a: [number, number],
  b: [number, number],
): number {
  const meanLat = ((a[1] + b[1]) / 2) * (Math.PI / 180);
  const cosLat = Math.cos(meanLat);
  const px = (p[0] - a[0]) * M_PER_DEG_LAT * cosLat;
  const py = (p[1] - a[1]) * M_PER_DEG_LAT;
  const bx = (b[0] - a[0]) * M_PER_DEG_LAT * cosLat;
  const by = (b[1] - a[1]) * M_PER_DEG_LAT;
  const lenSq = bx * bx + by * by;
  if (lenSq === 0) return Math.sqrt(px * px + py * py);
  let t = (px * bx + py * by) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const closestX = bx * t;
  const closestY = by * t;
  return Math.sqrt((px - closestX) ** 2 + (py - closestY) ** 2);
}

// Returns the fraction of the route polyline that runs within `radiusM` of
// a corridor segment. Returned 0–1; rail and freeway both count.
export function computeRowOverlap(
  routeCoords: [number, number][],
  radiusM = 150,
): { railShare: number; freewayShare: number } {
  if (!LOADED || SEGMENTS.length === 0 || routeCoords.length < 2) {
    return { railShare: 0, freewayShare: 0 };
  }

  // Sample the route polyline at ~50m intervals.
  const samples: [number, number][] = [routeCoords[0]];
  for (let i = 1; i < routeCoords.length; i++) {
    const a = routeCoords[i - 1];
    const b = routeCoords[i];
    const d = approxDistM(a, b);
    const n = Math.max(1, Math.floor(d / 50));
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      samples.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  if (samples.length === 0) return { railShare: 0, freewayShare: 0 };

  let railHits = 0;
  let freewayHits = 0;
  for (const s of samples) {
    // Check segments in this and 8 surrounding grid cells.
    const i0 = Math.floor(s[0] / CELL_DEG);
    const j0 = Math.floor(s[1] / CELL_DEG);
    let nearestKind: "rail" | "freeway" | null = null;
    let nearestD = radiusM;
    for (let di = -1; di <= 1; di++) {
      for (let dj = -1; dj <= 1; dj++) {
        const arr = GRID.get(`${i0 + di}|${j0 + dj}`);
        if (!arr) continue;
        for (const segIdx of arr) {
          const seg = SEGMENTS[segIdx];
          const d = pointToSegmentM(s, seg.a, seg.b);
          if (d < nearestD) {
            nearestD = d;
            nearestKind = seg.kind;
          }
        }
      }
    }
    if (nearestKind === "rail") railHits++;
    else if (nearestKind === "freeway") freewayHits++;
  }
  return {
    railShare: railHits / samples.length,
    freewayShare: freewayHits / samples.length,
  };
}

// Combined construction discount factor (multiplicative on cost AND time).
// Rail ROW gives bigger discount than freeway. Rough numbers based on real
// projects (using existing rail trench: ~30-45% cheaper, freeway median:
// ~10-20% cheaper).
export function constructionDiscount(
  railShare: number,
  freewayShare: number,
): { costMult: number; timeMult: number } {
  // Rail: up to 40% cost reduction, up to 50% time reduction.
  // Freeway: up to 15% cost reduction, up to 20% time reduction.
  const costRed = railShare * 0.40 + freewayShare * 0.15;
  const timeRed = railShare * 0.50 + freewayShare * 0.20;
  return {
    costMult: 1 - Math.min(0.5, costRed),
    timeMult: 1 - Math.min(0.6, timeRed),
  };
}
