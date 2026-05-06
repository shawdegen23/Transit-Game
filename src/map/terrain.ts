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
  [34.65, -119.40], // Mussel Shoals / Carpinteria approach
  [34.42, -119.70], // Santa Barbara
  [34.60, -120.10], // Goleta / Gaviota Pass
  [34.70, -120.50], // Pt. Conception turn
  [34.85, -120.65], // Lompoc / Vandenberg
  [35.15, -120.85], // Pismo Beach / Avila
  [35.28, -120.85], // Morro Bay area
  [35.50, -121.10], // San Simeon
  [35.85, -121.40], // Big Sur south
  [36.20, -121.80], // Big Sur central
  [36.55, -121.95], // Carmel / Pacific Grove
  [36.75, -121.85], // Monterey Bay
  [37.00, -122.00], // Aptos / Capitola
  [37.10, -122.30], // Pescadero
  [37.30, -122.40], // Half Moon Bay
  [37.50, -122.50], // Pacifica
  [37.70, -122.50], // SF western coast (Sutro / Ocean Beach)
  [37.78, -122.51], // Ocean Beach
  [37.83, -122.50], // Cliff House / Lands End
  [37.83, -122.48], // Golden Gate Bridge
  // North of Golden Gate up the Marin / Sonoma coast.
  [37.86, -122.51], // Marin Headlands
  [37.95, -122.62], // Stinson Beach
  [38.05, -122.79], // Point Reyes Station fringe (Drakes Bay area)
  [38.20, -122.85], // Bodega Head
  [38.40, -123.00], // Sonoma coast
  [38.60, -123.10], // Sea Ranch / Stewarts Point fringe
  [38.80, -123.30], // Sea Ranch / Stewarts Point fringe
  [39.00, -123.40], // Gualala
  [39.30, -123.78], // Mendocino village
  [39.60, -123.80], // Fort Bragg
  [40.00, -124.00], // Lost Coast south
  [40.30, -124.35], // Cape Mendocino
  [40.60, -124.30], // Eureka / Humboldt Bay west edge
  [40.85, -124.20], // Trinidad
  [41.20, -124.10], // Klamath
  [41.55, -124.10], // Crescent City
  [41.80, -124.20], // Smith River
  [42.00, -124.30], // Oregon border
  // Inside SF Bay (between SF and Oakland) is also water, but the simple
  // west-of-cutoff check doesn't model bays. We accept that — players
  // just can't build subway tubes through SF Bay, which mirrors reality
  // (BART has the only Transbay Tube and it took decades).
];

// Return the coastline as an ordered list of [lon, lat] points (south to
// north). Used to render the coast as a visible line on the map.
export function getCoastline(): [number, number][] {
  return COAST_PROFILE.map(([lat, lon]) => [lon, lat]);
}

// Return a closed polygon ring representing the Pacific Ocean within
// our bbox. Points walk south-to-north along the coast, then loop west
// and south to close the ring far out in the Pacific.
export function getOceanPolygon(bbox: { west: number; south: number; north: number }): [number, number][] {
  const coast = getCoastline();
  // Push the western edge a bit further west than bbox.west so the polygon
  // visibly extends off-screen, hiding the closure edge from the player.
  const farWest = bbox.west - 1.0;
  return [
    ...coast,
    [farWest, bbox.north],
    [farWest, bbox.south],
    coast[0], // close back to the southernmost coast point
  ];
}

export function isInOcean(lon: number, lat: number): boolean {
  if (lat < COAST_PROFILE[0][0] || lat > COAST_PROFILE[COAST_PROFILE.length - 1][0]) {
    // Outside our coastline data range. Only block clicks that are
    // clearly far west of our bbox (i.e. west of -123, which is
    // unambiguously open Pacific). Don't apply the cutoff inland.
    return lon < -123.0;
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
