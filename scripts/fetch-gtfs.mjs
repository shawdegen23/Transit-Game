// Build-time script: download LA Metro Rail GTFS, parse, and emit a single
// GeoJSON FeatureCollection of rail lines for the game's "existing network"
// layer.
//
// Run via: npm run gtfs
//
// Output: public/la-metro-rail.geojson
//
// Source: https://gitlab.com/LACMTA/gtfs_rail (LACMTA's official mirror)

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { readFileSync, existsSync, rmSync } from "node:fs";

const GTFS_URL =
  "https://gitlab.com/LACMTA/gtfs_rail/-/raw/master/gtfs_rail.zip";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "..", "public");
const OUT_FILE = join(OUT_DIR, "la-metro-rail.geojson");

function log(msg) {
  process.stdout.write(`[gtfs] ${msg}\n`);
}

// Tiny CSV parser sufficient for GTFS (no embedded newlines in fields we use).
function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return [];
  const headers = parseRow(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseRow(lines[i]);
    const obj = {};
    for (let j = 0; j < headers.length; j++) obj[headers[j]] = cols[j] ?? "";
    rows.push(obj);
  }
  return rows;
}

function parseRow(line) {
  const out = [];
  let cur = "";
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuote) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') {
        inQuote = false;
      } else {
        cur += c;
      }
    } else if (c === '"') {
      inQuote = true;
    } else if (c === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const tmp = join(tmpdir(), `la-metro-gtfs-${Date.now()}`);
  const zipPath = join(tmp, "gtfs_rail.zip");
  await mkdir(tmp, { recursive: true });

  log(`downloading ${GTFS_URL}`);
  execSync(`curl -sSL -o "${zipPath}" "${GTFS_URL}"`, { stdio: "inherit" });

  log("unzipping");
  execSync(`unzip -o -q "${zipPath}" -d "${tmp}"`, { stdio: "inherit" });

  const must = ["routes.txt", "trips.txt", "shapes.txt"];
  for (const f of must) {
    if (!existsSync(join(tmp, f))) {
      throw new Error(`Missing ${f} in GTFS feed`);
    }
  }

  log("parsing CSVs");
  const routes = parseCSV(readFileSync(join(tmp, "routes.txt"), "utf-8"));
  const trips = parseCSV(readFileSync(join(tmp, "trips.txt"), "utf-8"));
  const shapesRaw = parseCSV(readFileSync(join(tmp, "shapes.txt"), "utf-8"));

  log(`  routes=${routes.length} trips=${trips.length} shape pts=${shapesRaw.length}`);

  // Index routes by route_id.
  const routeById = new Map();
  for (const r of routes) routeById.set(r.route_id, r);

  // Map shape_id -> route_id (via trips). A shape is associated with a route
  // through any trip that uses it; pick the first trip's route.
  const shapeToRoute = new Map();
  for (const t of trips) {
    if (!shapeToRoute.has(t.shape_id)) {
      shapeToRoute.set(t.shape_id, t.route_id);
    }
  }

  // Group shape points by shape_id, sorted by sequence.
  const shapePoints = new Map(); // shape_id -> Array<{seq, lon, lat}>
  for (const p of shapesRaw) {
    const arr = shapePoints.get(p.shape_id) ?? [];
    arr.push({
      seq: Number(p.shape_pt_sequence),
      lon: Number(p.shape_pt_lon),
      lat: Number(p.shape_pt_lat),
    });
    shapePoints.set(p.shape_id, arr);
  }
  for (const arr of shapePoints.values()) arr.sort((a, b) => a.seq - b.seq);

  // For each route, dedupe shapes (a route often has many near-identical shape
  // variants for direction/short-turn). Keep the longest shape per route_id —
  // good enough for a baseline visual.
  const longestShapeByRoute = new Map();
  for (const [shapeId, pts] of shapePoints) {
    const routeId = shapeToRoute.get(shapeId);
    if (!routeId) continue;
    const cur = longestShapeByRoute.get(routeId);
    if (!cur || pts.length > cur.pts.length) {
      longestShapeByRoute.set(routeId, { shapeId, pts });
    }
  }

  // Emit GeoJSON FeatureCollection.
  const features = [];
  for (const [routeId, { pts }] of longestShapeByRoute) {
    const r = routeById.get(routeId);
    if (!r) continue;
    // Skip non-rail just in case the feed includes mixed entries.
    // GTFS route_type: 0=tram/light rail, 1=subway, 2=rail, 3=bus, 5=cable.
    const rt = Number(r.route_type);
    if (![0, 1, 2].includes(rt)) continue;

    features.push({
      type: "Feature",
      properties: {
        route_id: r.route_id,
        short_name: r.route_short_name || "",
        long_name: r.route_long_name || "",
        type: rt === 1 ? "subway" : rt === 2 ? "commuter" : "lrt",
        // GTFS color is hex without the # — fallback to a neutral gold.
        color: r.route_color ? `#${r.route_color}` : "#f6c453",
        text_color: r.route_text_color ? `#${r.route_text_color}` : "#000",
      },
      geometry: {
        type: "LineString",
        coordinates: pts.map((p) => [p.lon, p.lat]),
      },
    });
  }

  const fc = { type: "FeatureCollection", features };
  await writeFile(OUT_FILE, JSON.stringify(fc));
  log(`wrote ${features.length} features → ${OUT_FILE}`);

  // Cleanup
  rmSync(tmp, { recursive: true, force: true });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
