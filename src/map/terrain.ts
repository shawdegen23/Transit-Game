// Mountain/terrain build penalty data + computation.
//
// Loads la-terrain.json (a list of circular blobs around peaks and known
// LA mountain ranges) and computes "terrain share" for a player route as
// the fraction of route polyline samples that fall within any mountain
// zone, weighted by the zone's intensity.

interface TerrainZone {
  lon: number;
  lat: number;
  radiusKm: number;
  intensity: number; // 0-1
  name: string;
}

interface TerrainFile {
  bbox: [number, number, number, number];
  zones: TerrainZone[];
}

let LOADED = false;
let ZONES: TerrainZone[] = [];

export async function loadTerrain(): Promise<void> {
  if (LOADED) return;
  try {
    const res = await fetch("/la-terrain.json");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as TerrainFile;
    ZONES = data.zones;
    LOADED = true;
    // eslint-disable-next-line no-console
    console.log(`[terrain] loaded ${ZONES.length} zones`);
  } catch (err) {
    console.warn("[terrain] failed:", err);
    LOADED = true;
  }
}

const M_PER_DEG_LAT = 111_320;

function approxDistKm(a: [number, number], b: [number, number]): number {
  const meanLat = ((a[1] + b[1]) / 2) * (Math.PI / 180);
  const dx = (b[0] - a[0]) * M_PER_DEG_LAT * Math.cos(meanLat);
  const dy = (b[1] - a[1]) * M_PER_DEG_LAT;
  return Math.sqrt(dx * dx + dy * dy) / 1000;
}

// Returns the intensity-weighted share (0-1) of the route that runs through
// terrain zones. Higher = more mountain → bigger build penalty.
export function computeTerrainShare(routeCoords: [number, number][]): number {
  if (!LOADED || ZONES.length === 0 || routeCoords.length < 2) return 0;
  // Sample ~50m intervals.
  const samples: [number, number][] = [routeCoords[0]];
  for (let i = 1; i < routeCoords.length; i++) {
    const a = routeCoords[i - 1];
    const b = routeCoords[i];
    const dKm = approxDistKm(a, b);
    const n = Math.max(1, Math.floor(dKm * 20));
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      samples.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  let weightedSum = 0;
  for (const s of samples) {
    let bestIntensity = 0;
    for (const z of ZONES) {
      const d = approxDistKm(s, [z.lon, z.lat]);
      if (d > z.radiusKm) continue;
      // Falloff inside the zone: intensity at center, 0 at radius.
      const i = z.intensity * (1 - d / z.radiusKm);
      if (i > bestIntensity) bestIntensity = i;
    }
    weightedSum += bestIntensity;
  }
  return weightedSum / samples.length;
}

// Cost + time penalties for a route, scaled by mode (rail tunneling is
// the expensive one; bus and BRT just go around mountains in real life).
export function terrainPenalty(
  modeId: string,
  terrainShare: number,
): { costMult: number; timeMult: number } {
  if (terrainShare <= 0) return { costMult: 1, timeMult: 1 };
  const factor: Record<string, number> = {
    bus: 0.05,
    brt: 0.10,
    lrt: 0.45,
    hrt: 0.85, // tunneling
    commuter: 0.30,
  };
  const f = factor[modeId] ?? 0.20;
  // At 100% mountain share, costMult = 1 + factor, timeMult similar.
  return {
    costMult: 1 + terrainShare * f,
    timeMult: 1 + terrainShare * f * 1.2,
  };
}

// Quick check: is this point in the ocean (i.e., not in any zone AND west
// of LA's coastal bbox)? Crude — uses an approximate coastline polygon.
//
// Coastline approximation: a series of (lat, lon-cutoff) pairs. Point is
// in ocean if its lon is west of the cutoff at its latitude. Updated for
// the full SoCal bbox down to the Mexican border at San Diego.
const COAST_PROFILE: [number, number][] = [
  [32.55, -117.13], // Tijuana / border
  [32.70, -117.18], // Imperial Beach / Coronado
  [32.85, -117.28], // Pacific Beach / La Jolla
  [33.00, -117.30], // Del Mar
  [33.20, -117.40], // Carlsbad / Oceanside
  [33.40, -117.61], // San Clemente / Dana Point
  [33.55, -117.85], // Newport Beach
  [33.65, -118.00], // Huntington Beach
  [33.65, -118.20], // San Pedro / LA Harbor area
  [33.75, -118.40], // Long Beach / Torrance
  [33.85, -118.42], // Manhattan Beach
  [33.95, -118.46], // Marina del Rey
  [34.05, -118.51], // Santa Monica
  [34.15, -118.58], // Pacific Palisades
  [34.20, -118.60], // Malibu fringe
  [34.40, -119.00], // Ventura
  [34.50, -119.30], // Oxnard fringe
];

export function isInOcean(lon: number, lat: number): boolean {
  if (lat < COAST_PROFILE[0][0] || lat > COAST_PROFILE[COAST_PROFILE.length - 1][0]) {
    // Outside our coastline data range; only block the obvious far west.
    return lon < -118.7;
  }
  // Linear interpolate cutoff lon for this latitude.
  for (let i = 1; i < COAST_PROFILE.length; i++) {
    const [latA, lonA] = COAST_PROFILE[i - 1];
    const [latB, lonB] = COAST_PROFILE[i];
    if (lat >= latA && lat <= latB) {
      const t = (lat - latA) / (latB - latA);
      const cutoff = lonA + (lonB - lonA) * t;
      return lon < cutoff;
    }
  }
  return false;
}
