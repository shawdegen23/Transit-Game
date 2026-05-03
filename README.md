# California Transit Builder

A realistic public transit builder game. Plan, fund, and operate transit on real
California maps — starting with Los Angeles.

**Live build:** [transit-game.vercel.app](https://transit-game.vercel.app)

See [DESIGN.md](./DESIGN.md) for the full vision, scope, and roadmap.

## Status: v0.5 (it's a game now)

What's playable today:
- Real isometric map of Los Angeles (MapLibre + deck.gl, dark basemap)
- Real LA Metro Rail network rendered from official GTFS — A, B, C, D, E,
  and K Lines with their actual colors and alignments
- Toolbar with five transit modes (bus, BRT, light rail, subway, commuter rail)
- **Click two points to build a route — it pathfinds along real LA streets**
  using a cached county-wide street graph (36k junctions / 60k edges)
- Endpoints snap instantly to the nearest street intersection
- **Real-time game clock** with Pause / 1× / 4× / 16× speed (Space to pause)
- **Construction queue**: new routes start under construction. Capital
  drains evenly during construction; routes go live when finished
- **Monthly budget tick**: fare revenue + sales tax flow in, operating costs
  flow out. Net cash flow shown in the topbar
- Approval rises when routes complete, falls when budget goes negative
- Live HUD: capital, operating, daily riders, approval, date, net flow
- Route inspector showing build % and time-to-open during construction
- **Density-based ridership** — 667 OSM population centers as the demand
  model. Routes through dense areas (Downtown, Westside, Long Beach) draw
  ~100k+ riders; routes through empty land draw ~hundreds. Calibrated
  against real LA Metro lines (B Line ≈ 130k matches reality)
- **Ballot measures** — every 2-3 sim years, a sales-tax measure may
  appear. Accept it for a chance at $1.5–3.5B capital. Pass probability
  scales with current voter approval
- **Goal**: hit 500k daily riders by Jan 2040
- **Lose conditions**: approval below 25%, 6 months bankrupt, or deadline
- Goal progress bar across the top, end-game modal with restart

## Run it

You need Node 18+ and npm.

```bash
npm install        # already done if node_modules exists
npm run gtfs       # one-time: fetches LA Metro Rail GTFS
npm run streets    # one-time: fetches the LA County street graph (~3-7 min, 12 tiles)
npm run places     # one-time: fetches LA-area OSM population centers
npm run dev
```

The two `fetch-*` scripts only need to run once (or to refresh the data).
Both write to `public/`. The street fetch caches per-tile in `/tmp` so a
re-run resumes instantly if interrupted.

Vite will open `http://localhost:5173` automatically.

## Controls

- **Click** a point on the map to start a route, **click again** to finish it.
  Both endpoints snap to the nearest street intersection.
- **Esc** cancels a pending route.
- **Space** toggles pause / play.
- **Right-click + drag** to rotate / change pitch (the isometric look).
- **Scroll** to zoom; **left-click + drag** to pan.

## Stack

- TypeScript + Vite
- MapLibre GL (basemap; dark Carto style)
- deck.gl (transit lines, stations, baseline rail PathLayer)
- LA Metro GTFS (baseline rail network, build-time fetch)
- OpenStreetMap via Overpass (street graph for pathfinding, build-time fetch)

## Project layout

```
scripts/
  fetch-gtfs.mjs           # downloads LA Metro Rail GTFS → GeoJSON
  fetch-streets.mjs        # tiled Overpass → contracted street graph JSON
  fetch-places.mjs         # LA-area OSM places with populations → JSON
public/
  la-metro-rail.geojson    # generated; existing rail network
  la-streets.json          # generated; full LA County street graph
  la-places.json           # generated; population centers
src/
  main.ts                  # entry point
  map/
    mapView.ts             # MapLibre + deck.gl + click-to-build
    baselineNetwork.ts     # LA Metro Rail loader
    streetGraph.ts         # graph load + spatial index + Dijkstra
    snap.ts                # (legacy v0.2 Overpass snap; unused)
  game/
    modes.ts               # transit modes (cost, capacity, color)
    state.ts               # central game state + subscribers
    routes.ts              # build segment, station synth, helpers
    clock.ts               # game clock + speed controls
  sim/
    tick.ts                # monthly tick: construction, budget, approval
    ridership.ts           # density-based daily-rider model
    events.ts              # ballot measures (and future events)
    goal.ts                # win/lose tracker
  ui/hud.ts                # topbar + goal bar + modals + inspector
  data/la-bbox.ts          # LA viewport constants
```

## What's next (v0.6)

- Player-placed intermediate stations (vs auto-synthesized)
- Multi-line transfers + ridership boost when lines connect
- More event types: federal CIG grant cycles, NIMBY opposition
- Multiple difficulty levels / starting scenarios
