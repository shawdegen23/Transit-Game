// Build-time script: pull a packed LA-area street graph from Overpass and
// save it as a static JSON asset for runtime pathfinding.
//
// Pipeline:
//   1. Query Overpass for major roads in the LA bbox.
//   2. Build a raw node/edge graph (every OSM way vertex is a node).
//   3. Contract degree-2 chains: collapse intermediate vertices that aren't
//      intersections. Each contracted edge keeps a polyline of the original
//      coords so we can still draw the curved road accurately.
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
import { readFileSync, rmSync } from "node:fs";

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
// v0.3 starting bbox — Downtown LA + immediate surroundings (Hollywood,
// Echo Park, USC, Boyle Heights, Glendale fringe, Koreatown). Tight enough
// to query reliably and big enough to support meaningful gameplay around
// the densest part of the Metro Rail network. Widen in later sessions.
const BBOX = { west: -118.35, south: 33.97, east: -118.15, north: 34.13 };

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "..", "public");
const OUT_FILE = join(OUT_DIR, "la-streets.json");

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

// Round a coord to 5 decimal places (~1.1m). Two birds: dedupe AND shrink JSON.
const round5 = (n) => Math.round(n * 1e5) / 1e5;

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const q = `
    [out:json][timeout:120];
    (
      way[highway~"^(motorway|trunk|primary|secondary|tertiary|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link)$"]
        (${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});
    );
    out geom;
  `.trim();

  const tmp = join(tmpdir(), `la-streets-${Date.now()}`);
  await mkdir(tmp, { recursive: true });
  const respPath = join(tmp, "overpass.json");

  log("querying Overpass (this can take 30-90s)…");
  execSync(
    `curl -sS --max-time 180 -X POST "${OVERPASS_URL}" -H "Content-Type: application/x-www-form-urlencoded" --data-urlencode "data=${q.replace(/"/g, '\\"')}" -o "${respPath}"`,
    { stdio: "inherit" },
  );

  const raw = JSON.parse(readFileSync(respPath, "utf-8"));
  if (!raw.elements) throw new Error("Overpass response missing elements");
  log(`  ways returned: ${raw.elements.length}`);

  // Stage 1: raw graph. Every distinct rounded coord is a node.
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

  for (const w of raw.elements) {
    if (w.type !== "way" || !Array.isArray(w.geometry)) continue;
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
  log(`  raw nodes: ${nodes.length}, raw edges (undirected): ${[...adj.values()].reduce((s, m) => s + m.size, 0) / 2}`);

  // Stage 2: contract degree-2 chains. A node with exactly 2 neighbors and
  // not its own neighbor (no self-loops) gets dissolved; we walk the chain
  // collecting intermediate coords until we hit a real junction (degree != 2)
  // or come back around.
  const isJunction = new Set(); // node ids that are real intersections (or chain endpoints)
  for (const [u, neigh] of adj) {
    if (neigh.size !== 2) isJunction.add(u);
  }

  // For each junction node, walk each direction until we hit another junction.
  // Record contracted edges. Track visited (u,v) starting halves to avoid dups.
  const contractedEdges = []; // {u, v, len, mids:[lon,lat,lon,lat,...]}
  const startedFrom = new Set(); // "u|firstStep"

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

      // Walk through degree-2 nodes.
      while (!isJunction.has(cur)) {
        // Collect the current node as an intermediate coord.
        const [lon, lat] = nodes[cur];
        mids.push(lon, lat);

        const nbrs = adj.get(cur);
        if (!nbrs || nbrs.size !== 2) break; // safety
        let next = -1;
        for (const k of nbrs.keys()) {
          if (k !== prev) {
            next = k;
            break;
          }
        }
        if (next === -1) break;
        const stepLen = nbrs.get(next);
        totalLen += stepLen;
        prev = cur;
        cur = next;
        if (cur === u) break; // closed loop with no junction; abandon
      }

      // Mark the matching reverse half so we don't traverse it again.
      // The "other end" of this contracted edge starts from `cur` going to `prev`.
      startedFrom.add(startKey);
      startedFrom.add(`${cur}|${prev}`);

      if (cur === u) continue; // pure loop, skip
      // Round mid coords for compactness.
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

  // Stage 3: rebuild the node array as just junctions, with new ids.
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

  rmSync(tmp, { recursive: true, force: true });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
