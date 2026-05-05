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
const BBOX = { west: -121.5, south: 32.55, east: -116.0, north: 37.0 };

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

  // Chunk the bbox horizontally + vertically to avoid Overpass timing out
  // on huge multi-tag queries over the full SoCal+CV+Coast area. Each
  // sub-query is one tag type within one quadrant.
  const tagQueries = [
    "node[aeroway=aerodrome]",
    "way[aeroway=aerodrome]",
    "node[amenity=university]",
    "way[amenity=university]",
    "node[amenity=college]",
    "node[amenity=hospital]",
    "way[amenity=hospital]",
    "node[leisure=stadium]",
    "way[leisure=stadium]",
    "node[tourism=theme_park]",
    "way[tourism=theme_park]",
    "node[shop=mall]",
    "way[shop=mall]",
  ];
  const halfLat = (BBOX.south + BBOX.north) / 2;
  const halfLon = (BBOX.west + BBOX.east) / 2;
  const quads = [
    { s: BBOX.south, w: BBOX.west, n: halfLat, e: halfLon },
    { s: BBOX.south, w: halfLon, n: halfLat, e: BBOX.east },
    { s: halfLat, w: BBOX.west, n: BBOX.north, e: halfLon },
    { s: halfLat, w: halfLon, n: BBOX.north, e: BBOX.east },
  ];
  const allElements = [];
  for (let qi = 0; qi < quads.length; qi++) {
    const q = quads[qi];
    const lines = tagQueries
      .map((tq) => `${tq}(${q.s},${q.w},${q.n},${q.e});`)
      .join("\n      ");
    const ql = `[out:json][timeout:60];(${lines});out center;`.trim();
    const tmp = join(tmpdir(), `la-landmarks-${qi}-${Date.now()}.json`);
    log(`querying Overpass quadrant ${qi + 1}/4…`);
    let ok = false;
    for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
      try {
        execSync(
          `curl -sS --max-time 90 -X POST "${OVERPASS_URL}" -H "Content-Type: application/x-www-form-urlencoded" --data-urlencode "data=${ql.replace(/"/g, '\\"')}" -o "${tmp}"`,
          { stdio: ["ignore", "ignore", "pipe"] },
        );
        const parsed = JSON.parse(readFileSync(tmp, "utf-8"));
        if (!parsed.elements) throw new Error("missing elements");
        allElements.push(...parsed.elements);
        log(`  q${qi + 1}: ${parsed.elements.length} elements`);
        ok = true;
      } catch (err) {
        log(`  q${qi + 1} attempt ${attempt} failed: ${err.message ?? err}`);
        if (attempt < 3) execSync("sleep 5");
      }
    }
    if (!ok) throw new Error(`landmarks q${qi + 1} failed`);
  }
  const raw = { elements: allElements };
  log(`  total raw elements: ${raw.elements.length}`);

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
    // San Diego additions
    { kind: "airport",    lon: -117.1933, lat: 32.7338, name: "SAN (San Diego International)", magnitude: 0.85 },
    { kind: "stadium",    lon: -117.1573, lat: 32.7076, name: "Petco Park", magnitude: 0.85 },
    { kind: "stadium",    lon: -117.1196, lat: 32.7831, name: "Snapdragon Stadium", magnitude: 0.65 },
    { kind: "university", lon: -117.2376, lat: 32.8801, name: "UC San Diego", magnitude: 0.95 },
    { kind: "university", lon: -117.0726, lat: 32.7755, name: "San Diego State University", magnitude: 0.85 },
    { kind: "university", lon: -117.1923, lat: 32.7714, name: "University of San Diego", magnitude: 0.65 },
    { kind: "theme_park", lon: -117.1697, lat: 32.7641, name: "Balboa Park / San Diego Zoo", magnitude: 0.80 },
    { kind: "theme_park", lon: -117.1268, lat: 33.0975, name: "LEGOLAND California (Carlsbad)", magnitude: 0.65 },
    { kind: "theme_park", lon: -117.1731, lat: 32.7644, name: "SeaWorld San Diego", magnitude: 0.70 },
    { kind: "beach",      lon: -117.2765, lat: 32.8328, name: "La Jolla Cove", magnitude: 0.55 },
    // Inland Empire additions
    { kind: "airport",    lon: -117.6010, lat: 34.0560, name: "ONT (Ontario International)", magnitude: 0.55 },
    { kind: "airport",    lon: -116.5063, lat: 33.8297, name: "PSP (Palm Springs International)", magnitude: 0.40 },
    { kind: "university", lon: -117.3281, lat: 33.9737, name: "UC Riverside", magnitude: 0.80 },
    { kind: "university", lon: -117.3216, lat: 34.1820, name: "Cal State San Bernardino", magnitude: 0.65 },
    // Central Coast / Santa Barbara
    { kind: "airport",    lon: -119.8403, lat: 34.4262, name: "SBA (Santa Barbara Municipal)", magnitude: 0.40 },
    { kind: "university", lon: -119.8489, lat: 34.4140, name: "UC Santa Barbara", magnitude: 0.85 },
    { kind: "university", lon: -120.6594, lat: 35.3001, name: "Cal Poly San Luis Obispo", magnitude: 0.80 },
    { kind: "beach",      lon: -119.6885, lat: 34.4173, name: "Santa Barbara waterfront", magnitude: 0.55 },
    // Central Valley
    { kind: "airport",    lon: -119.0568, lat: 35.4334, name: "BFL (Bakersfield Meadows Field)", magnitude: 0.35 },
    { kind: "airport",    lon: -119.7181, lat: 36.7762, name: "FAT (Fresno Yosemite International)", magnitude: 0.45 },
    { kind: "university", lon: -119.7460, lat: 36.8136, name: "Fresno State", magnitude: 0.75 },
    { kind: "university", lon: -119.0421, lat: 35.3540, name: "Cal State Bakersfield", magnitude: 0.65 },
    // Monterey / Salinas
    { kind: "airport",    lon: -121.8489, lat: 36.5870, name: "MRY (Monterey Regional)", magnitude: 0.30 },
    { kind: "university", lon: -121.7965, lat: 36.6553, name: "CSU Monterey Bay", magnitude: 0.55 },
    { kind: "beach",      lon: -121.9018, lat: 36.6177, name: "Carmel Beach", magnitude: 0.50 },
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
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
