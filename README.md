# California Transit Builder

A realistic public transit builder game. Plan, fund, and operate transit on real
California maps — starting with Los Angeles.

See [DESIGN.md](./DESIGN.md) for the full vision, scope, and roadmap.

## Status: v0.3 (street-following routes)

What's playable today:
- Real isometric map of Los Angeles (MapLibre + deck.gl, dark basemap)
- Real LA Metro Rail network rendered from official GTFS — A, B, C, D, E,
  and K Lines with their actual colors and alignments
- Toolbar with five transit modes (bus, BRT, light rail, subway, commuter rail)
- **Click two points to build a route — it pathfinds along real LA streets**
  using a cached street graph (Dijkstra over an edge-contracted OSM extract)
- Endpoints snap instantly to the nearest street intersection (local spatial
  index, no network calls per click)
- True street-distance length and cost (not haversine)
- Live HUD showing capital budget, operating budget, daily ridership estimate,
  voter approval, and date
- Route inspector listing every line you've built with length, cost, and riders

> **Coverage note:** v0.3's street graph covers downtown LA and immediate
> surroundings. Outside the bbox, routes fall back to straight lines. The
> bbox is one constant in `scripts/fetch-streets.mjs` — widening it requires
> a healthy Overpass API or, ideally, the Geofabrik migration planned for
> v0.3.x.

## Run it

You need Node 18+ and npm.

```bash
npm install        # already done if node_modules exists
npm run gtfs       # one-time: fetches LA Metro Rail GTFS
npm run streets    # one-time: fetches the LA street graph (~30-60s)
npm run dev
```

The two `fetch-*` scripts only need to run once (or to refresh the data).
Both write to `public/`.

Vite will open `http://localhost:5173` automatically.

## Controls

- **Click** a point on the map to start a route, **click again** to finish it.
  Both endpoints snap to the nearest street intersection.
- **Esc** cancels a pending route.
- **Right-click + drag** to rotate / change pitch (the isometric look).
- **Scroll** to zoom; **left-click + drag** to pan.

## Stack

- TypeScript + Vite
- MapLibre GL (basemap; dark Carto style by default)
- deck.gl (transit lines, stations, baseline rail PathLayer)
- LA Metro GTFS (baseline rail network, build-time fetch)
- OpenStreetMap via Overpass (street graph for pathfinding, build-time fetch)

## Project layout

```
scripts/
  fetch-gtfs.mjs           # downloads LA Metro Rail GTFS → GeoJSON
  fetch-streets.mjs        # downloads LA major-road graph → contracted JSON
public/
  la-metro-rail.geojson    # generated; existing rail network
  la-streets.json          # generated; street graph for pathfinding
src/
  main.ts                  # entry point
  map/
    mapView.ts             # MapLibre + deck.gl + click-to-build
    baselineNetwork.ts     # loader for LA Metro Rail GeoJSON
    streetGraph.ts         # graph load + spatial index + Dijkstra
    snap.ts                # (legacy v0.2 Overpass snap; kept as fallback)
  game/
    modes.ts               # transit modes (cost, capacity, color)
    state.ts               # central game state + subscribers
    routes.ts              # build segment + ridership stub
  ui/hud.ts                # topbar + toolbar + inspector + legend
  data/la-bbox.ts          # LA viewport constants
```

## What's next (v0.3.x → v0.4)

- Switch the street-graph pipeline from Overpass to a Geofabrik OSM extract
  for full LA County coverage and reliability
- ACS population layer + 0.5-mile station-area ridership model
- Monthly budget tick (capital drawdown during construction, operating ledger)
- First political event (a ballot measure that adds capital if it passes)
