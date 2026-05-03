// Build-time script: pull existing rail (active + abandoned) and freeway
// corridors in LA County. These become "right-of-way" hints that discount
// player route construction when the route runs alongside one.
//
// Output: public/la-corridors.json
//   {
//     bbox: [...],
//     features: [
//       { kind: "rail" | "freeway", coords: [[lon,lat], ...] },
//       ...
//     ]
//   }
//
// Run: npm run corridors

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { readFileSync, rmSync, existsSync } from "node:fs";

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const BBOX = { west: -119.4, south: 33.4, east: -117.4, north: 34.6 };

const TILES_X = 5;
const TILES_Y = 3;

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "..", "public");
const OUT_FILE = join(OUT_DIR, "la-corridors.json");
const CACHE_DIR = join(tmpdir(), "la-corridors-cache");

const log = (m) => process.stdout.write(`[corridors] ${m}\n`);

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
  // Pull rail and freeway in one query per tile.
  const q = `
    [out:json][timeout:90];
    (
      way[railway~"^(rail|light_rail|subway|tram|disused|abandoned)$"]
        (${t.south},${t.west},${t.north},${t.east});
      way[highway~"^(motorway|trunk)$"]
        (${t.south},${t.west},${t.north},${t.east});
    );
    out geom;
  `.trim();

  const start = Date.now();
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      execSync(
        `curl -sS --max-time 120 -X POST "${OVERPASS_URL}" -H "Content-Type: application/x-www-form-urlencoded" --data-urlencode "data=${q.replace(/"/g, '\\"')}" -o "${cacheFile}.tmp"`,
        { stdio: ["ignore", "ignore", "pipe"] },
      );
      const parsed = JSON.parse(readFileSync(`${cacheFile}.tmp`, "utf-8"));
      if (!parsed.elements) throw new Error("missing elements");
      execSync(`mv "${cacheFile}.tmp" "${cacheFile}"`);
      const dt = ((Date.now() - start) / 1000).toFixed(1);
      log(`  tile ${ix},${iy}: ${parsed.elements.length} ways (${dt}s)`);
      return parsed;
    } catch (err) {
      log(`  tile ${ix},${iy}: attempt ${attempt} failed (${err.message ?? err})`);
      if (attempt < 3) execSync("sleep 5");
    }
  }
  throw new Error(`tile ${ix},${iy} failed`);
}

function classifyKind(tags) {
  if (tags.railway) return "rail";
  if (tags.highway === "motorway" || tags.highway === "trunk") return "freeway";
  return null;
}

// Simplify: drop colinear midpoints. Tolerance ~5m via cross-product check.
function simplify(coords, toleranceM = 5) {
  if (coords.length <= 2) return coords;
  const out = [coords[0]];
  for (let i = 1; i < coords.length - 1; i++) {
    const a = out[out.length - 1];
    const b = coords[i];
    const c = coords[i + 1];
    // Convert to local meters via flat-earth approximation.
    const M_PER_DEG_LAT = 111_320;
    const meanLat = ((a[1] + c[1]) / 2) * (Math.PI / 180);
    const px = (b[0] - a[0]) * M_PER_DEG_LAT * Math.cos(meanLat);
    const py = (b[1] - a[1]) * M_PER_DEG_LAT;
    const qx = (c[0] - a[0]) * M_PER_DEG_LAT * Math.cos(meanLat);
    const qy = (c[1] - a[1]) * M_PER_DEG_LAT;
    const denom = Math.hypot(qx, qy) || 1;
    const cross = Math.abs(px * qy - py * qx) / denom;
    if (cross > toleranceM) out.push(b);
  }
  out.push(coords[coords.length - 1]);
  return out;
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  await mkdir(CACHE_DIR, { recursive: true });
  log(`bbox: ${JSON.stringify(BBOX)}`);
  log(`grid: ${TILES_X}x${TILES_Y}`);

  const wayById = new Map();
  for (let iy = 0; iy < TILES_Y; iy++) {
    for (let ix = 0; ix < TILES_X; ix++) {
      const t = fetchTile(ix, iy);
      for (const el of t.elements) {
        if (el.type !== "way" || !Array.isArray(el.geometry)) continue;
        if (!wayById.has(el.id)) wayById.set(el.id, el);
      }
    }
  }
  log(`merged: ${wayById.size} unique ways`);

  const features = [];
  let railWays = 0, freewayWays = 0;
  for (const w of wayById.values()) {
    const kind = classifyKind(w.tags || {});
    if (!kind) continue;
    const coords = w.geometry.map((p) => [round5(p.lon), round5(p.lat)]);
    const simplified = simplify(coords);
    features.push({ kind, coords: simplified });
    if (kind === "rail") railWays++;
    else freewayWays++;
  }
  log(`  rail features: ${railWays}, freeway features: ${freewayWays}`);

  await writeFile(OUT_FILE, JSON.stringify({
    bbox: [BBOX.west, BBOX.south, BBOX.east, BBOX.north],
    features,
  }));
  log(`wrote ${OUT_FILE}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
