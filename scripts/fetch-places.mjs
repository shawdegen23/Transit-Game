// Build-time script: pull OSM place=* features (city / town / suburb /
// neighbourhood / village) within the LA bbox and save a compact JSON of
// {lon, lat, population, name, kind} for each. Used by the runtime
// ridership model as a coarse population-density proxy.
//
// Run: npm run places

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const BBOX = { west: -119.4, south: 33.4, east: -117.4, north: 34.6 };

// Approximate fallback populations by place kind, used when OSM doesn't
// have a `population` tag (suburbs/neighbourhoods often lack one).
const DEFAULT_POP = {
  city: 50000,
  town: 15000,
  suburb: 8000,
  village: 3000,
  neighbourhood: 4000,
  hamlet: 800,
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "..", "public");
const OUT_FILE = join(OUT_DIR, "la-places.json");

const log = (m) => process.stdout.write(`[places] ${m}\n`);

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const q = `
    [out:json][timeout:60];
    (
      node[place~"^(city|town|suburb|village|neighbourhood|hamlet)$"]
        (${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});
    );
    out body;
  `.trim();

  const tmp = join(tmpdir(), `la-places-${Date.now()}.json`);
  log("querying Overpass…");
  execSync(
    `curl -sS --max-time 90 -X POST "${OVERPASS_URL}" -H "Content-Type: application/x-www-form-urlencoded" --data-urlencode "data=${q.replace(/"/g, '\\"')}" -o "${tmp}"`,
    { stdio: "inherit" },
  );

  const raw = JSON.parse(readFileSync(tmp, "utf-8"));
  log(`  raw nodes returned: ${raw.elements?.length ?? 0}`);

  const places = [];
  for (const el of raw.elements ?? []) {
    if (el.type !== "node") continue;
    const t = el.tags ?? {};
    const kind = t.place;
    if (!kind) continue;
    const pop = Number(t.population) || DEFAULT_POP[kind] || 1000;
    places.push({
      lon: Math.round(el.lon * 1e5) / 1e5,
      lat: Math.round(el.lat * 1e5) / 1e5,
      pop: Math.round(pop),
      name: t.name ?? "",
      kind,
    });
  }
  log(`  kept ${places.length} places`);

  // Sort by descending population so largest centers process first at runtime.
  places.sort((a, b) => b.pop - a.pop);

  await writeFile(OUT_FILE, JSON.stringify({
    bbox: [BBOX.west, BBOX.south, BBOX.east, BBOX.north],
    places,
  }));
  log(`wrote ${OUT_FILE}`);

  rmSync(tmp, { force: true });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
