// Build-time script: pull mountain/peak features in LA via Overpass to use
// as terrain build-cost penalties. We grab natural=peak nodes and named
// mountain ranges, then synthesize a coarse "high terrain" zone array.
//
// Output: public/la-terrain.json
//   {
//     bbox: [...],
//     // Each zone is a circular blob: peaks as point + radius (km), with
//     // larger radius for major ranges (San Gabriels, Santa Monica, etc.)
//     zones: [{ lon, lat, radiusKm, name, intensity }],
//   }
//
// Run: npm run terrain

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const BBOX = { west: -119.4, south: 32.55, east: -116.0, north: 34.7 };

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "..", "public");
const OUT_FILE = join(OUT_DIR, "la-terrain.json");

const log = (m) => process.stdout.write(`[terrain] ${m}\n`);

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  // Pull peaks (small zones) and named mountain ranges (bigger zones).
  const q = `
    [out:json][timeout:60];
    (
      node[natural=peak](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});
      node[place=mountain](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});
      node[natural=mountain_range](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});
    );
    out body;
  `.trim();

  const tmp = join(tmpdir(), `la-terrain-${Date.now()}.json`);
  log("querying Overpass…");
  execSync(
    `curl -sS --max-time 90 -X POST "${OVERPASS_URL}" -H "Content-Type: application/x-www-form-urlencoded" --data-urlencode "data=${q.replace(/"/g, '\\"')}" -o "${tmp}"`,
    { stdio: "inherit" },
  );
  const raw = JSON.parse(readFileSync(tmp, "utf-8"));
  log(`  raw nodes: ${raw.elements?.length ?? 0}`);

  const zones = [];
  for (const el of raw.elements ?? []) {
    if (el.type !== "node") continue;
    const t = el.tags ?? {};
    const name = t.name ?? "";
    let radiusKm = 1.5;
    let intensity = 0.5;
    if (t.natural === "peak") {
      const ele = Number(t.ele) || 500;
      // Bigger peaks = bigger zone of build penalty around them.
      radiusKm = Math.min(4, 0.8 + ele / 800);
      intensity = Math.min(1, 0.3 + ele / 2500);
    } else {
      // Mountain ranges from OSM are usually a single label point;
      // give them a generous radius.
      radiusKm = 6;
      intensity = 0.7;
    }
    zones.push({
      lon: Math.round(el.lon * 1e5) / 1e5,
      lat: Math.round(el.lat * 1e5) / 1e5,
      radiusKm: Math.round(radiusKm * 100) / 100,
      intensity: Math.round(intensity * 100) / 100,
      name,
    });
  }

  // Manually augment with the major LA mountain blobs that OSM tags
  // inconsistently. These are the corridors a player most often runs into.
  const knownRanges = [
    { lon: -118.50, lat: 34.10, radiusKm: 12, intensity: 0.85, name: "Santa Monica Mountains" },
    { lon: -118.30, lat: 34.18, radiusKm: 8, intensity: 0.75, name: "Verdugo Hills" },
    { lon: -118.05, lat: 34.22, radiusKm: 18, intensity: 0.95, name: "San Gabriel Mountains (south flank)" },
    { lon: -117.85, lat: 34.20, radiusKm: 14, intensity: 0.90, name: "San Gabriel Mountains (Sierra Madre)" },
    { lon: -117.80, lat: 33.85, radiusKm: 8, intensity: 0.65, name: "Puente Hills" },
    { lon: -118.07, lat: 33.85, radiusKm: 4, intensity: 0.55, name: "Whittier Hills" },
  ];
  zones.push(...knownRanges);

  log(`  total zones: ${zones.length}`);

  await writeFile(OUT_FILE, JSON.stringify({
    bbox: [BBOX.west, BBOX.south, BBOX.east, BBOX.north],
    zones,
  }));
  log(`wrote ${OUT_FILE}`);

  rmSync(tmp, { force: true });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
