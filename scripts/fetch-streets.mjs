// Build-time script: pull the LA County street graph from Overpass in
// quadrant chunks (avoids timeouts on a single county-wide query) and save
// it as an edge-contracted JSON for runtime pathfinding.
//
// Pipeline:
//   1. Split LA County bbox into N chunks. Query Overpass per chunk, with
//      retry/backoff. Merge ways from all chunks (dedupe by way id).
//   2. Build a raw node/edge graph (every OSM way vertex is a node).
//   3. Contract degree-2 chains so nodes are only intersections; each edge
//      carries the polyline of intermediate coords.
//   4. Serialize a compact JSON.
//
// Output schema:
//   {
//     "bbox":  [west, south, east, north],
//     "nodes": [[lon, lat], ...],                     // intersections only
//     "edges": [
//       [uIndex, vIndex, lenMeters, [lon,lat,lon,lat,...]],  // polyline EXCLUDES endpoints
//       ...
//     ]
//   }
//
// Run: npm run streets

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { readFileSync, rmSync, existsSync } from "node:fs";

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

// Full LA County bbox. We chunk this into smaller tiles below to avoid
// per-query timeouts on Overpass.
const BBOX = { west: -118.95, south: 33.65, east: -117.6, north: 34.4 };

// Tile the bbox into a grid. 4x3 = 12 tiles is small enough per query that
// Overpass reliably finishes each in <30s; total wall time ~5-7 minutes.
const TILES_X = 4;
const TILES_Y = 3;

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "..", "public");
const OUT_FILE = join(OUT_DIR, "la-streets.json");
const CACHE_DIR = join(tmpdir(), "la-streets-cache");

const log = (m) => process.stdout.write(`[streets] ${m}\n`);

function haversineM(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const sa = Math.sin(dLat / 2);
  const so = Math.sin(dLon / 2);
  const h =
    sa * sa + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * so * so;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const round5 = (n) => Math.round(n * 1e5) / 1e5;

function tileBbox(ix, iy) {
  const w = BBOX.west + ((BBOX.east - BBOX.west) * ix) / TILES_X;
  const e = BBOX.west + ((BBOX.east - BBOX.west) * (ix + 1)) / TILES_X;
  const s = BBOX.south + ((BBOX.north - BBOX.south) * iy) / TILES_Y;
  const n = BBOX.south + ((BBOX.north - BBOX.south) * (iy + 1)) / TILES_Y;
  return { west: w, south: s, east: e, north: n };
}

function fetchTile(ix, iy) {
  const cacheFile = join(CACHE_DIR, `tile-${ix}-${iy}.json`);
  if (existsSync(cacheFile)) {
    log(`  tile ${ix},${iy}: cached`);
    return JSON.parse(readFileSync(cacheFile, "utf-8"));
  }

  const t = tileBbox(ix, iy);
  const q = `
    [out:json][timeout:90];
    (
      way[highway~"^(motorway|trunk|primary|secondary|tertiary|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link)$"]
        (${t.south},${t.west},${t.north},${t.east});
    );
    out geom;
  `.trim();

  const start = Date.now();
  // Up to 3 attempts per tile with 5s backoff.
  let lastErr = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      execSync(
        `curl -sS --max-time 120 -X POST "${OVERPASS_URL}" -H "Content-Type: application/x-www-form-urlencoded" --data-urlencode "data=${q.replace(/"/g, '\\"')}" -o "${cacheFile}.tmp"`,
        { stdio: ["ignore", "ignore", "pipe"] },
      );
      // Validate: must be JSON with elements key.
      const parsed = JSON.parse(readFileSync(`${cacheFile}.tmp`, "utf-8"));
      if (!parsed.elements) throw new Error("missing elements");
      execSync(`mv "${cacheFile}.tmp" "${cacheFile}"`);
      const dt = ((Date.now() - start) / 1000).toFixed(1);
      log(`  tile ${ix},${iy}: ${parsed.elements.length} ways (${dt}s)`);
      return parsed;
    } catch (err) {
      lastErr = err;
      log(`  tile ${ix},${iy}: attempt ${attempt} failed (${err.message ?? err})`);
      if (attempt < 3) execSync("sleep 5");
    }
  }
  throw new Error(`tile ${ix},${iy} failed after 3 attempts: ${lastErr}`);
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  await mkdir(CACHE_DIR, { recursive: true });

  log(`bbox: ${JSON.stringify(BBOX)}`);
  log(`grid: ${TILES_X}x${TILES_Y} = ${TILES_X * TILES_Y} tiles`);
  log(`cache: ${CACHE_DIR}`);

  // Fetch all tiles, dedupe by way id (a way that crosses a tile boundary
  // appears in multiple tiles; we keep the first copy).
  const wayById = new Map();
  for (let iy = 0; iy < TILES_Y; iy++) {
    for (let ix = 0; ix < TILES_X; ix++) {
      const t = fetchTile(ix, iy);
      for (const el of t.elements) {
        if (el.type !== "way") continue;
        if (!wayById.has(el.id)) wayById.set(el.id, el);
      }
    }
  }
  log(`merged: ${wayById.size} unique ways`);

  // Stage 1: raw graph from way geometry.
  const nodeIndex = new Map();
  const nodes = []; // [lon, lat]
  const adj = new Map(); // u -> Map<v, lenM>

  function nodeIdOf(lat, lon) {
    const lo = round5(lon);
    const la = round5(lat);
    const key = `${la}|${lo}`;
    let idx = nodeIndex.get(key);
    if (idx === undefined) {
      idx = nodes.length;
      nodes.push([lo, la]);
      nodeIndex.set(key, idx);
    }
    return idx;
  }

  function addEdge(u, v, len) {
    if (u === v) return;
    const a = adj.get(u) ?? new Map();
    if (!a.has(v) || a.get(v) > len) a.set(v, len);
    adj.set(u, a);
    const b = adj.get(v) ?? new Map();
    if (!b.has(u) || b.get(u) > len) b.set(u, len);
    adj.set(v, b);
  }

  for (const w of wayById.values()) {
    if (!Array.isArray(w.geometry)) continue;
    const g = w.geometry;
    for (let i = 1; i < g.length; i++) {
      const a = g[i - 1];
      const b = g[i];
      const u = nodeIdOf(a.lat, a.lon);
      const v = nodeIdOf(b.lat, b.lon);
      const len = haversineM([a.lon, a.lat], [b.lon, b.lat]);
      addEdge(u, v, len);
    }
  }
  const rawEdgeCount = [...adj.values()].reduce((s, m) => s + m.size, 0) / 2;
  log(`  raw nodes: ${nodes.length}, raw edges: ${rawEdgeCount}`);

  // Stage 2: contract degree-2 chains.
  const isJunction = new Set();
  for (const [u, neigh] of adj) {
    if (neigh.size !== 2) isJunction.add(u);
  }

  const contractedEdges = [];
  const startedFrom = new Set();

  for (const u of isJunction) {
    const neighbors = adj.get(u);
    if (!neighbors) continue;
    for (const [first, firstLen] of neighbors) {
      const startKey = `${u}|${first}`;
      if (startedFrom.has(startKey)) continue;

      let prev = u;
      let cur = first;
      let totalLen = firstLen;
      const mids = [];

      while (!isJunction.has(cur)) {
        const [lon, lat] = nodes[cur];
        mids.push(lon, lat);
        const nbrs = adj.get(cur);
        if (!nbrs || nbrs.size !== 2) break;
        let next = -1;
        for (const k of nbrs.keys()) {
          if (k !== prev) { next = k; break; }
        }
        if (next === -1) break;
        const stepLen = nbrs.get(next);
        totalLen += stepLen;
        prev = cur;
        cur = next;
        if (cur === u) break;
      }

      startedFrom.add(startKey);
      startedFrom.add(`${cur}|${prev}`);

      if (cur === u) continue;
      const roundedMids = mids.map(round5);
      contractedEdges.push({
        u,
        v: cur,
        len: Math.round(totalLen * 10) / 10,
        mids: roundedMids,
      });
    }
  }
  log(`  junctions: ${isJunction.size}, contracted edges: ${contractedEdges.length}`);

  // Stage 3: rebuild node array as just junctions, with new ids.
  const oldToNew = new Map();
  const newNodes = [];
  for (const old of isJunction) {
    oldToNew.set(old, newNodes.length);
    newNodes.push(nodes[old]);
  }
  const newEdges = contractedEdges
    .filter((e) => oldToNew.has(e.u) && oldToNew.has(e.v))
    .map((e) => [oldToNew.get(e.u), oldToNew.get(e.v), e.len, e.mids]);

  log(`  final nodes: ${newNodes.length}, final edges: ${newEdges.length}`);

  const out = {
    bbox: [BBOX.west, BBOX.south, BBOX.east, BBOX.north],
    nodes: newNodes,
    edges: newEdges,
  };

  await writeFile(OUT_FILE, JSON.stringify(out));
  log(`wrote ${OUT_FILE}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
