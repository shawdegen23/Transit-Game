// Build-time script: pull major OSM landmarks in SoCal that act as
// trip generators (positive ridership) and/or build-cost penalties.
//
// Categories:
//   airport (aeroway=aerodrome, large/intl: bigger magnitude)
//   university (amenity=university)
//   college (amenity=college)
//   hospital (amenity=hospital)
//   stadium (leisure=stadium)
//   theme_park (tourism=theme_park)
//   beach (natural=beach, big named ones)
//   mall (shop=mall)
//
// Output: public/la-landmarks.json
//   {
//     bbox: [...],
//     landmarks: [
//       { kind, lon, lat, name, magnitude, ridershipBoost, buildPenalty }
//     ]
//   }
//
// magnitude: 0-1
// ridershipBoost: bonus daily-rider multiplier when a station is nearby
// buildPenalty: extra cost+time multiplier when route polyline is nearby

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const BBOX = { west: -119.4, south: 33.4, east: -117.4, north: 34.6 };

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "..", "public");
const OUT_FILE = join(OUT_DIR, "la-landmarks.json");

const log = (m) => process.stdout.write(`[landmarks] ${m}\n`);

// Heuristic magnitude based on tags. Returns 0–1.
function magnitudeFor(kind, tags) {
  const t = tags ?? {};
  switch (kind) {
    case "airport": {
      // Major commercial: iata_code + aerodrome:type=international, or known names
      const iata = t.iata;
      const name = (t.name ?? "").toLowerCase();
      if (iata === "LAX") return 1.0;
      if (iata === "SNA") return 0.65; // John Wayne
      if (iata === "ONT") return 0.55; // Ontario
      if (iata === "BUR") return 0.55; // Burbank/Hollywood
      if (iata === "LGB") return 0.40; // Long Beach
      if (iata) return 0.35;
      if (name.includes("international")) return 0.5;
      if (t.aeroway === "aerodrome") return 0.20;
      return 0.10;
    }
    case "university": {
      const name = (t.name ?? "").toLowerCase();
      if (name.includes("ucla") || name.includes("usc")) return 0.95;
      if (name.includes("caltech") || name.includes("uci") || name.includes("uc irvine")) return 0.85;
      if (name.includes("csu") || name.includes("california state")) return 0.75;
      if (name.includes("university")) return 0.65;
      return 0.50;
    }
    case "college":
      return 0.40;
    case "hospital": {
      const beds = Number(t.beds);
      if (beds >= 500) return 0.7;
      if (beds >= 200) return 0.5;
      return 0.30;
    }
    case "stadium": {
      const name = (t.name ?? "").toLowerCase();
      if (name.includes("dodger") || name.includes("sofi") || name.includes("crypto")) return 0.95;
      if (name.includes("rose bowl") || name.includes("staples")) return 0.85;
      if (name.includes("angel stadium") || name.includes("honda center")) return 0.75;
      return 0.45;
    }
    case "theme_park": {
      const name = (t.name ?? "").toLowerCase();
      if (name.includes("disney")) return 1.0;
      if (name.includes("universal") || name.includes("knott")) return 0.85;
      if (name.includes("six flags") || name.includes("magic mountain")) return 0.75;
      return 0.40;
    }
    case "beach":
      return 0.40;
    case "mall":
      return 0.30;
  }
  return 0.30;
}

// Returns: { ridershipBoost (0-2 multiplier on nearby station ridership), buildPenalty (0-1 cost+time bump per unit) }
function effectsFor(kind, magnitude) {
  switch (kind) {
    case "airport":
      // Airports: moderate ridership boost (everyone going to airport), big build penalty (FAA)
      return { ridershipBoost: 0.5 * magnitude, buildPenalty: 0.7 * magnitude };
    case "university":
    case "college":
      // Lots of riders (students, faculty, daily commute), no build penalty
      return { ridershipBoost: 0.7 * magnitude, buildPenalty: 0 };
    case "hospital":
      return { ridershipBoost: 0.35 * magnitude, buildPenalty: 0.05 * magnitude };
    case "stadium":
      // Spike ridership on event days; we model as steady boost averaged
      return { ridershipBoost: 0.4 * magnitude, buildPenalty: 0 };
    case "theme_park":
      return { ridershipBoost: 0.6 * magnitude, buildPenalty: 0.1 * magnitude };
    case "beach":
      return { ridershipBoost: 0.25 * magnitude, buildPenalty: 0 };
    case "mall":
      return { ridershipBoost: 0.2 * magnitude, buildPenalty: 0 };
  }
  return { ridershipBoost: 0.1 * magnitude, buildPenalty: 0 };
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const q = `
    [out:json][timeout:90];
    (
      node[aeroway=aerodrome](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});
      way[aeroway=aerodrome](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});
      node[amenity=university](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});
      way[amenity=university](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});
      node[amenity=college](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});
      node[amenity=hospital](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});
      way[amenity=hospital](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});
      node[leisure=stadium](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});
      way[leisure=stadium](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});
      node[tourism=theme_park](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});
      way[tourism=theme_park](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});
      node[shop=mall](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});
      way[shop=mall](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});
    );
    out center;
  `.trim();

  const tmp = join(tmpdir(), `la-landmarks-${Date.now()}.json`);
  log("querying Overpass…");
  execSync(
    `curl -sS --max-time 120 -X POST "${OVERPASS_URL}" -H "Content-Type: application/x-www-form-urlencoded" --data-urlencode "data=${q.replace(/"/g, '\\"')}" -o "${tmp}"`,
    { stdio: "inherit" },
  );
  const raw = JSON.parse(readFileSync(tmp, "utf-8"));
  log(`  raw elements: ${raw.elements?.length ?? 0}`);

  const round5 = (n) => Math.round(n * 1e5) / 1e5;
  const landmarks = [];
  const seenNames = new Map(); // name+kind → existing entry (dedupe overlaps)

  function classify(t) {
    if (t.aeroway === "aerodrome") return "airport";
    if (t.amenity === "university") return "university";
    if (t.amenity === "college") return "college";
    if (t.amenity === "hospital") return "hospital";
    if (t.leisure === "stadium") return "stadium";
    if (t.tourism === "theme_park") return "theme_park";
    if (t.shop === "mall") return "mall";
    if (t.natural === "beach") return "beach";
    return null;
  }

  for (const el of raw.elements ?? []) {
    const t = el.tags ?? {};
    const kind = classify(t);
    if (!kind) continue;

    let lon, lat;
    if (el.type === "node") {
      lon = el.lon;
      lat = el.lat;
    } else if (el.center) {
      lon = el.center.lon;
      lat = el.center.lat;
    } else {
      continue;
    }
    const name = t.name ?? "";
    if (!name) continue; // skip unnamed
    const key = `${kind}|${name.toLowerCase()}`;
    if (seenNames.has(key)) continue;

    const mag = magnitudeFor(kind, t);
    if (mag < 0.15) continue; // skip tiny ones to keep noise down
    const eff = effectsFor(kind, mag);
    const entry = {
      kind,
      lon: round5(lon),
      lat: round5(lat),
      name,
      magnitude: Math.round(mag * 100) / 100,
      ridershipBoost: Math.round(eff.ridershipBoost * 100) / 100,
      buildPenalty: Math.round(eff.buildPenalty * 100) / 100,
    };
    seenNames.set(key, entry);
    landmarks.push(entry);
  }

  log(`  kept ${landmarks.length} named landmarks`);

  // Hand-augment a few critical landmarks that OSM tags inconsistently.
  // (Skip if already present.)
  const augment = [
    { kind: "airport", lon: -118.4081, lat: 33.9416, name: "LAX (Los Angeles International)", magnitude: 1.0 },
    { kind: "airport", lon: -117.8678, lat: 33.6757, name: "SNA (John Wayne / Orange County)", magnitude: 0.65 },
    { kind: "airport", lon: -118.3585, lat: 34.2007, name: "BUR (Hollywood Burbank)", magnitude: 0.55 },
    { kind: "stadium", lon: -118.2400, lat: 34.0739, name: "Dodger Stadium", magnitude: 0.95 },
    { kind: "stadium", lon: -118.3387, lat: 33.9534, name: "SoFi Stadium / Hollywood Park", magnitude: 0.95 },
    { kind: "stadium", lon: -118.1689, lat: 34.1614, name: "Rose Bowl Stadium", magnitude: 0.85 },
    { kind: "theme_park", lon: -117.9190, lat: 33.8121, name: "Disneyland Resort", magnitude: 1.0 },
    { kind: "theme_park", lon: -118.3535, lat: 34.1381, name: "Universal Studios Hollywood", magnitude: 0.85 },
    { kind: "theme_park", lon: -118.5973, lat: 34.4233, name: "Six Flags Magic Mountain", magnitude: 0.70 },
    { kind: "university", lon: -118.4452, lat: 34.0689, name: "UCLA", magnitude: 0.95 },
    { kind: "university", lon: -118.2851, lat: 34.0224, name: "USC", magnitude: 0.95 },
    { kind: "university", lon: -118.1252, lat: 34.1377, name: "Caltech", magnitude: 0.85 },
    { kind: "university", lon: -117.8443, lat: 33.6405, name: "UC Irvine", magnitude: 0.85 },
  ];
  for (const a of augment) {
    const key = `${a.kind}|${a.name.toLowerCase()}`;
    if (seenNames.has(key)) continue;
    const eff = effectsFor(a.kind, a.magnitude);
    landmarks.push({
      ...a,
      lon: round5(a.lon),
      lat: round5(a.lat),
      ridershipBoost: Math.round(eff.ridershipBoost * 100) / 100,
      buildPenalty: Math.round(eff.buildPenalty * 100) / 100,
    });
    seenNames.set(key, true);
  }

  // Sort by magnitude desc for stable rendering order.
  landmarks.sort((a, b) => b.magnitude - a.magnitude);

  log(`  total after augment: ${landmarks.length}`);

  await writeFile(OUT_FILE, JSON.stringify({
    bbox: [BBOX.west, BBOX.south, BBOX.east, BBOX.north],
    landmarks,
  }));
  log(`wrote ${OUT_FILE}`);

  rmSync(tmp, { force: true });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
