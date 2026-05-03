// Runtime street graph: loads the cached JSON, builds adjacency, spatial
// index for nearest-junction snap, and a Dijkstra shortest-path query.
//
// The cached file uses an edge-contracted format (see scripts/fetch-streets.mjs)
// where nodes are intersections only and each edge carries the polyline of
// intermediate coords between its endpoints.

interface RawGraph {
  bbox: [number, number, number, number];
  nodes: [number, number][]; // [lon, lat]
  edges: [number, number, number, number[]][]; // [u, v, lenM, [lon,lat,lon,lat,...]]
}

interface AdjEdge {
  to: number;
  len: number;
  // Polyline from u to v, INCLUDING both endpoints, oriented from u → v.
  // We materialize this once at load so pathfinding can stitch full
  // geometries quickly.
  polyline: [number, number][];
}

let GRAPH: RawGraph | null = null;
let ADJ: Map<number, AdjEdge[]> | null = null;
let GRID: Map<string, number[]> | null = null;
let GRID_CELL_DEG = 0.005; // ~550m at LA latitude

function gridKey(lon: number, lat: number): string {
  const i = Math.floor(lon / GRID_CELL_DEG);
  const j = Math.floor(lat / GRID_CELL_DEG);
  return `${i}|${j}`;
}

export async function loadStreetGraph(): Promise<RawGraph> {
  if (GRAPH) return GRAPH;
  const res = await fetch("/la-streets.json");
  if (!res.ok) throw new Error(`street graph fetch failed: ${res.status}`);
  GRAPH = (await res.json()) as RawGraph;

  // Build adjacency.
  ADJ = new Map();
  for (const [u, v, len, mids] of GRAPH.edges) {
    const ulnlat = GRAPH.nodes[u];
    const vlnlat = GRAPH.nodes[v];

    // mids is a flat [lon, lat, lon, lat, ...] array. Reshape to pairs.
    const pairs: [number, number][] = [];
    for (let i = 0; i < mids.length; i += 2) {
      pairs.push([mids[i], mids[i + 1]]);
    }

    const fwd: [number, number][] = [ulnlat, ...pairs, vlnlat];
    const rev: [number, number][] = [...fwd].reverse();

    if (!ADJ.has(u)) ADJ.set(u, []);
    if (!ADJ.has(v)) ADJ.set(v, []);
    ADJ.get(u)!.push({ to: v, len, polyline: fwd });
    ADJ.get(v)!.push({ to: u, len, polyline: rev });
  }

  // Build spatial index for nearest-junction lookup.
  GRID = new Map();
  for (let i = 0; i < GRAPH.nodes.length; i++) {
    const [lon, lat] = GRAPH.nodes[i];
    const k = gridKey(lon, lat);
    if (!GRID.has(k)) GRID.set(k, []);
    GRID.get(k)!.push(i);
  }

  // eslint-disable-next-line no-console
  console.log(
    `[street-graph] loaded: ${GRAPH.nodes.length} nodes, ${GRAPH.edges.length} edges`,
  );
  return GRAPH;
}

function haversineM(a: [number, number], b: [number, number]): number {
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

// Nearest junction node id (or null if graph not loaded / point too far).
export function nearestNode(lon: number, lat: number): number | null {
  if (!GRAPH || !GRID) return null;
  // Search the cell + its 8 neighbors. Expand outward if no hit (e.g., for
  // clicks outside the dense road area).
  for (let radius = 1; radius <= 6; radius++) {
    const i0 = Math.floor(lon / GRID_CELL_DEG);
    const j0 = Math.floor(lat / GRID_CELL_DEG);
    const candidates: number[] = [];
    for (let di = -radius; di <= radius; di++) {
      for (let dj = -radius; dj <= radius; dj++) {
        const arr = GRID.get(`${i0 + di}|${j0 + dj}`);
        if (arr) candidates.push(...arr);
      }
    }
    if (candidates.length === 0) continue;
    let best = -1;
    let bestD = Infinity;
    for (const id of candidates) {
      const d = haversineM([lon, lat], GRAPH.nodes[id]);
      if (d < bestD) {
        bestD = d;
        best = id;
      }
    }
    return best;
  }
  return null;
}

// Min-heap keyed by `dist`. Tiny implementation good enough for graphs of
// our size (a few thousand nodes). Uses array-based binary heap.
class MinHeap {
  private a: { id: number; dist: number }[] = [];
  push(id: number, dist: number) {
    this.a.push({ id, dist });
    let i = this.a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.a[p].dist <= this.a[i].dist) break;
      [this.a[p], this.a[i]] = [this.a[i], this.a[p]];
      i = p;
    }
  }
  pop(): { id: number; dist: number } | null {
    if (this.a.length === 0) return null;
    const top = this.a[0];
    const last = this.a.pop()!;
    if (this.a.length > 0) {
      this.a[0] = last;
      let i = 0;
      const n = this.a.length;
      for (;;) {
        const l = 2 * i + 1;
        const r = 2 * i + 2;
        let s = i;
        if (l < n && this.a[l].dist < this.a[s].dist) s = l;
        if (r < n && this.a[r].dist < this.a[s].dist) s = r;
        if (s === i) break;
        [this.a[s], this.a[i]] = [this.a[i], this.a[s]];
        i = s;
      }
    }
    return top;
  }
  get size() {
    return this.a.length;
  }
}

export interface PathResult {
  // Total length in meters along the actual streets.
  lengthM: number;
  // Polyline of [lon, lat] pairs from start to end, ready for a deck.gl PathLayer.
  coords: [number, number][];
}

// Dijkstra. Returns null if no path exists between the two junctions.
export function shortestPath(from: number, to: number): PathResult | null {
  if (!ADJ) return null;
  if (from === to) return { lengthM: 0, coords: [] };

  const dist = new Map<number, number>();
  const prev = new Map<number, { node: number; via: AdjEdge }>();
  dist.set(from, 0);

  const heap = new MinHeap();
  heap.push(from, 0);

  while (heap.size > 0) {
    const { id: u, dist: ud } = heap.pop()!;
    if (u === to) break;
    if (ud > (dist.get(u) ?? Infinity)) continue;

    const adj = ADJ.get(u);
    if (!adj) continue;
    for (const e of adj) {
      const nd = ud + e.len;
      if (nd < (dist.get(e.to) ?? Infinity)) {
        dist.set(e.to, nd);
        prev.set(e.to, { node: u, via: e });
        heap.push(e.to, nd);
      }
    }
  }

  if (!prev.has(to) && from !== to) return null;

  // Reconstruct: walk prev from `to` back to `from`, stitching polylines.
  const segments: [number, number][][] = [];
  let cur = to;
  while (cur !== from) {
    const p = prev.get(cur);
    if (!p) return null;
    segments.push(p.via.polyline);
    cur = p.node;
  }
  segments.reverse();

  // Stitch: each segment includes both endpoints. Drop the first point of
  // each subsequent segment so junctions aren't duplicated.
  const coords: [number, number][] = [];
  segments.forEach((seg, i) => {
    if (i === 0) coords.push(...seg);
    else coords.push(...seg.slice(1));
  });

  return { lengthM: dist.get(to) ?? 0, coords };
}
