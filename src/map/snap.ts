// Snap a clicked point to the nearest OpenStreetMap road node.
//
// We query the public Overpass API for road nodes within a small radius of the
// click and return the closest one. If Overpass is slow or unavailable, the
// caller falls back to the raw click point — the game should never block on
// network when the player tries to build.
//
// This is intentionally simple. v0.3+ will swap in a pre-downloaded local
// graph of LA streets for instant snapping and proper street-following routes.

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const SEARCH_RADIUS_M = 80;
const TIMEOUT_MS = 1500;

interface OverpassNode {
  type: "node";
  id: number;
  lat: number;
  lon: number;
}
interface OverpassResp {
  elements: OverpassNode[];
}

function haversineM(
  a: [number, number],
  b: [number, number],
): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const sa = Math.sin(dLat / 2);
  const so = Math.sin(dLon / 2);
  const h =
    sa * sa + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * so * so;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export async function snapToNearestRoad(
  click: [number, number],
): Promise<[number, number] | null> {
  const [lon, lat] = click;

  // Overpass QL: road nodes (any "highway" way's nodes) within radius.
  // We filter out service roads / footways / cycleways to bias toward
  // motor-vehicle streets where transit would actually run.
  const q = `
    [out:json][timeout:5];
    (
      way(around:${SEARCH_RADIUS_M},${lat},${lon})
        ["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified|living_street)$"];
    );
    node(w);
    out skel;
  `.trim();

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(OVERPASS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `data=${encodeURIComponent(q)}`,
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const json = (await res.json()) as OverpassResp;
    if (!json.elements || json.elements.length === 0) return null;

    let best: OverpassNode | null = null;
    let bestD = Infinity;
    for (const n of json.elements) {
      if (n.type !== "node") continue;
      const d = haversineM(click, [n.lon, n.lat]);
      if (d < bestD) {
        bestD = d;
        best = n;
      }
    }
    if (!best) return null;
    return [best.lon, best.lat];
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
