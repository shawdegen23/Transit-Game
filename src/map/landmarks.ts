// Major landmarks (airports, universities, hospitals, stadiums, theme
// parks, malls) that boost ridership when stations are nearby and, for
// some kinds (airports), penalize construction when a route runs too close.

export interface Landmark {
  kind: "airport" | "university" | "college" | "hospital" | "stadium" | "theme_park" | "beach" | "mall";
  lon: number;
  lat: number;
  name: string;
  magnitude: number;       // 0-1
  ridershipBoost: number;  // 0-1, multiplier on nearby station ridership
  buildPenalty: number;    // 0-1, cost+time bump when route within penaltyRadius
}

interface LandmarksFile {
  bbox: [number, number, number, number];
  landmarks: Landmark[];
}

let LOADED = false;
let LANDMARKS: Landmark[] = [];

export function getLandmarks(): Landmark[] {
  return LANDMARKS;
}

export async function loadLandmarks(): Promise<void> {
  if (LOADED) return;
  try {
    const res = await fetch("/la-landmarks.json");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as LandmarksFile;
    LANDMARKS = data.landmarks;
    LOADED = true;
    // eslint-disable-next-line no-console
    console.log(`[landmarks] loaded ${LANDMARKS.length} landmarks`);
  } catch (err) {
    console.warn("[landmarks] failed:", err);
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

const STATION_PROXIMITY_M = 800; // ~0.5 mi catchment for landmark boost

// Returns aggregate ridership multiplier (1.0 = no change, 2.0 = 2x).
// Each landmark within station catchment adds its boost (with diminishing
// returns when many overlap).
export function landmarkRidershipMultiplier(stations: [number, number][]): number {
  if (LANDMARKS.length === 0) return 1;
  let totalBoost = 0;
  for (const s of stations) {
    let stationBoost = 0;
    for (const lm of LANDMARKS) {
      // Quick lat/lon prefilter
      if (Math.abs(lm.lat - s[1]) > 0.01) continue;
      if (Math.abs(lm.lon - s[0]) > 0.012) continue;
      const d = approxDistM(s, [lm.lon, lm.lat]);
      if (d > STATION_PROXIMITY_M) continue;
      // Distance falloff: full boost at center, zero at edge.
      const falloff = 1 - d / STATION_PROXIMITY_M;
      stationBoost += lm.ridershipBoost * falloff;
    }
    totalBoost += stationBoost;
  }
  // Per-route diminishing returns: log curve, max ~+150% on very landmarky lines.
  return 1 + Math.min(1.5, totalBoost * 0.5);
}

// Names of landmarks served by any station on the route (for HUD display).
export function landmarksServed(stations: [number, number][]): Landmark[] {
  if (LANDMARKS.length === 0) return [];
  const seen = new Set<string>();
  const served: Landmark[] = [];
  for (const s of stations) {
    for (const lm of LANDMARKS) {
      if (Math.abs(lm.lat - s[1]) > 0.01) continue;
      if (Math.abs(lm.lon - s[0]) > 0.012) continue;
      const d = approxDistM(s, [lm.lon, lm.lat]);
      if (d > STATION_PROXIMITY_M) continue;
      const key = `${lm.kind}|${lm.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      served.push(lm);
    }
  }
  served.sort((a, b) => b.magnitude - a.magnitude);
  return served;
}

// Construction penalty for routes that run too close to airports / sensitive
// landmarks. Returns multiplicative factors >= 1.
const PENALTY_RADIUS_M = 500;

export function landmarkBuildPenalty(routeCoords: [number, number][]): { costMult: number; timeMult: number } {
  if (LANDMARKS.length === 0 || routeCoords.length < 2) return { costMult: 1, timeMult: 1 };
  // Find max penalty across the route from any landmark with buildPenalty > 0.
  let maxPenalty = 0;
  for (const lm of LANDMARKS) {
    if (lm.buildPenalty <= 0) continue;
    // Sample-based: find the closest point on the route to this landmark.
    let minD = Infinity;
    for (const p of routeCoords) {
      const d = approxDistM(p, [lm.lon, lm.lat]);
      if (d < minD) minD = d;
      if (minD < 50) break;
    }
    if (minD > PENALTY_RADIUS_M) continue;
    const falloff = 1 - minD / PENALTY_RADIUS_M;
    const p = lm.buildPenalty * falloff;
    if (p > maxPenalty) maxPenalty = p;
  }
  return {
    costMult: 1 + maxPenalty,
    timeMult: 1 + maxPenalty * 0.6,
  };
}
