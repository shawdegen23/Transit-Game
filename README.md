# California Transit Builder

A realistic public transit builder game. Plan, fund, and operate transit on real
California maps — starting with Los Angeles.

**Live build:** [transit-game.vercel.app](https://transit-game.vercel.app)

See [DESIGN.md](./DESIGN.md) for the full vision, scope, and roadmap.

## Status: v1.5 (SoCal + Central Coast + south Central Valley)

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
- **Player-placed stations**: click as many points as you want along a
  route. A bottom-of-screen panel shows live cost/length/build-time and
  has Finish/Cancel buttons (Enter/Esc still work). A gold ghost dot
  follows your cursor showing where the next station would snap.
- **Transfers**: when one of your operating routes has a station within
  ~200m of another operating route's station, both lines get a ridership
  boost (diminishing returns when stacking).
- **Route deletion**: cancel a route in construction (70% refund) or
  shut down an operating route (approval hit) from the inspector.
- **Funding sources panel**: federal CIG grants, state TIRCP grants, and
  bond issuance, plus a summary of monthly recurring revenue (sales tax,
  cap-and-trade, TOD, fares, ops costs, debt service).
- **NIMBY events**: occasionally a community group will oppose one of
  your in-construction lines. Pay outreach to keep on schedule, or push
  through and absorb a delay + approval hit.
- **Soft deadline**: 2040 / 500k riders is a celebration milestone, not
  a game-over. The game keeps running so you can build a system you're
  proud of.
- **Right-of-way discounts**: routes that hug existing rail corridors or
  freeway medians get major cost + time discounts. The pending panel
  shows ROW % live as you place stations.
- **Construction options** in the pending panel: toggle **design-build**
  (faster + costlier) and **24/7 shifts** (much faster + much costlier).
- **Live ridership preview** while drawing — see estimated daily riders
  update with every station you place.
- **Fare hike controls** in the topbar (±$0.25). Price elasticity ≈ -0.4:
  fare increases boost revenue but cost ridership and approval.
- **Mayor / governor turnover** every 4 sim years with friendly / neutral /
  hostile bias affecting grant odds and approval baseline.
- **Visual corridor overlay**: faint green = existing rail (huge build
  discount), faint grey = freeway (smaller discount). Toggle in toolbar.
- **Terrain build penalties**: routes through mountains (Santa Monicas,
  Verdugos, San Gabriels) cost more and take longer to build — heavy on
  subways (tunneling), light on buses.
- **Ocean constraint**: clicks west of LA's coastline bounce with a
  "can't build in the ocean" toast.
- **Scenario picker** at game start: Sandbox, Olympics Sprint 2028,
  Pacific Electric Restoration, LAX Express. Each sets a different
  budget, deadline, and ridership target.
- **Bond modal** with a slider, live monthly debt service preview, and
  total repayment estimate.
- **SoCal expansion**: now covers LA County + Orange County + Ventura/
  Oxnard. Build all the way from Disneyland to Oxnard.
- **Landmarks**: 616 named landmarks across SoCal — airports (LAX, John
  Wayne, Burbank, Ontario), universities (UCLA, USC, Caltech, UC Irvine),
  theme parks (Disney, Universal, Magic Mountain), stadiums (SoFi, Rose
  Bowl, Dodger), hospitals, and malls. Stations near landmarks get a
  ridership boost; routes too close to airports cost more (FAA, runway
  proximity). Toggle visibility with `L` key or the on-map button.
- **Save/load**: 3 named save slots + autosave every sim-year, all
  persisted in your browser. Menu button (top-left) opens the save
  manager. Reload the page → it offers to resume your previous game.
  `Ctrl+S` (or `Cmd+S`) for quick-save anytime.
- **Animated trains**: every operating route has trains running back and
  forth along its polyline. Train count scales with line length, dot size
  scales with mode. Animation speed follows the game clock — paused
  freezes them, 16× zips them across the map.
- **Service frequency**: per-route Low / Std / High pills in the inspector.
  High frequency = more riders + more trains visible + more ops cost. Low
  = the opposite. Scale-down underused lines to cut ops; pump up corridors
  with real demand.
- **Full SoCal**: build everywhere from Ventura/Oxnard to Palm Springs,
  San Fernando Valley to Tijuana border. San Diego (with UCSD, Petco
  Park, Balboa Park, SeaWorld, LEGOLAND), Inland Empire (Riverside,
  San Bernardino, Ontario), Coachella Valley — all in one playable map.
- **Central Coast** (v1.5): Santa Barbara, UCSB, Lompoc, SLO / Cal Poly,
  Pismo, Morro Bay, Monterey, Carmel, CSU Monterey Bay.
- **South Central Valley** (v1.5): Bakersfield (CSUB, BFL airport),
  Fresno (Fresno State, FAT airport), Visalia, Tulare, Hanford.

## Run it

You need Node 18+ and npm.

```bash
npm install        # already done if node_modules exists
npm run gtfs       # one-time: fetches LA Metro Rail GTFS
npm run streets    # one-time: fetches the LA County street graph (~3-7 min)
npm run places     # one-time: fetches LA-area OSM population centers
npm run corridors  # one-time: fetches LA-area rail + freeway corridors (~3-7 min)
npm run terrain    # one-time: fetches mountain/peak zones (~30s)
npm run landmarks  # one-time: fetches major landmarks (~30s)
npm run dev
```

The two `fetch-*` scripts only need to run once (or to refresh the data).
Both write to `public/`. The street fetch caches per-tile in `/tmp` so a
re-run resumes instantly if interrupted.

Vite will open `http://localhost:5173` automatically.

## Controls

- **Click** to place a station. Buttons at the bottom of the screen show
  live cost/length and let you Finish or Cancel.
- **Enter** finishes the route. **Esc** cancels.
- **Z** undoes the last placed station while drawing.
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

## What's next (v1.6+)

- Stats / charts panel and history view
- First-time tutorial flow
- Time-of-day modeling (peak vs off-peak)
- Eventually: Bay Area + Sacramento, then statewide rail (HSR)
