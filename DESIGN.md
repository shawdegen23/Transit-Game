# California Transit Builder — Design Doc

A realistic public transit builder game. Plan, fund, build, and operate transit
networks across real California geography under real-world constraints: budgets,
agencies, ridership, and politics.

Inspired by Subway Builder (subwaybuilder.com), but pushed toward simulation
realism: real maps, real population data, real funding mechanisms, real agencies.

---

## 1. Vision

The player is part transit planner, part agency director, part politician.

You pick a starting role (e.g., LA Metro CEO, a city council member in Long Beach,
or a state-level HSR Authority director) and a starting era (e.g., 2026). Your job
is to expand and operate transit in your jurisdiction over decades. You succeed
when ridership grows, your agency stays solvent, and voters keep approving your
projects. You fail when budgets collapse, projects miss deadlines, ridership
stagnates, or political support evaporates.

The game should reward the kinds of decisions real planners face:
- Light rail vs BRT vs heavy rail trade-offs
- Where to put stations (ridership vs equity vs cost)
- When to ask voters for a sales-tax measure
- Whether to chase federal CIG funding (and accept federal NEPA review)
- How to manage labor agreements, fare policy, and inter-agency coordination

---

## 2. Scope

### v0.1 (shipped)
- LA only, isometric MapLibre + deck.gl basemap.
- Sandbox mode, click-to-draw straight-line routes.
- Five modes with rough per-mile costs.
- HUD with budget, ridership stub, voter approval, date.

### v0.2 (shipped)
- Real LA Metro Rail baseline rendered from official GTFS (A/B/C/D/E/K Lines).
- Click endpoints snap to the nearest OSM street via Overpass API.
- Existing-network legend so the player can see what's already there.

### v0.3 (shipped)
- Pre-cached street graph (Overpass → edge-contracted JSON) cached as a
  static asset.
- Local nearest-junction snap using a uniform-grid spatial index.
- Dijkstra shortest-path. Player routes follow real streets.

### v0.4 (current)
- **Full LA County street graph** via chunked Overpass queries (12 tiles,
  per-tile cache, retry/backoff). 36,706 junctions, 60,429 edges, 14 MB raw
  / 3.1 MB gzipped. Pathfinding remains <25ms per query.
- **Real-time game clock**: 1 sim-day per ~333ms at 1×, with pause / 1× /
  4× / 16× speed controls. Spacebar toggles pause.
- **Construction queue**: new routes start `under construction` for a
  duration based on cost + mode (rough rule: 1 month per $50M for LRT,
  faster for bus/BRT). Capital drains evenly across build months. When
  build completes, route flips to `operating`.
- **Monthly budget tick**: fare revenue from operating routes + monthly
  sales-tax allocation flow into operating budget; per-route operating
  costs drain it. Net cash flow shown in HUD.
- **Approval ticks** based on completed routes, operating health, and
  capital availability.

### v0.5 (current)
- **Density-based ridership**: 667 LA-area population centers from OSM
  (each city/town/suburb/neighbourhood with `population` tag), modeled as
  2D Gaussian density blobs. Each route synthesizes ~1 station per mile;
  daily boardings ≈ summed-station-access × mode-share × length-factor.
  Calibrated so a B-Line clone (DT→Hollywood, HRT, 5mi) hits ~130k
  riders, matching reality.
- **Ballot measure events**: ~once every 2-3 sim years, a sales-tax
  ballot proposal pops up. Player accepts or declines. If accepted, pass
  probability = current approval vs threshold (with noise). On pass:
  $1.5–3.5B capital injection. On fail: −4 approval points.
- **Win/lose conditions**: default goal is **500k daily riders by Jan 2040**.
  Lose conditions: approval drops below 25%, OR operating budget stays
  negative for 6 consecutive months, OR deadline passes without target.
- **Goal progress bar** in topbar, **end-game modal** with restart button.

### v0.6
- Player-placed intermediate stations (vs auto-synthesized).
- Multi-line transfers + ridership boost when lines connect.
- More event types: federal CIG grant cycles, NIMBY opposition, fare hikes.
- Multiple difficulty levels / starting roles.

### v0.3
- Agencies: LA Metro, LADOT, Foothill Transit, Big Blue Bus, etc., each with
  separate budgets and jurisdictions.
- Political layer: voter approval, NIMBY events, environmental review timelines.

### v1.0
- Bay Area as second region, then full California.
- Inter-agency coordination, statewide rail (HSR, Amtrak California).
- Save/load, scenarios, historical "what-if" mode (e.g., "Build the LA subway
  the 1925 plan called for").

---

## 3. Architecture

### Stack
- **Language:** TypeScript
- **Build:** Vite
- **Rendering:** deck.gl on top of MapLibre GL (basemap)
- **State:** Zustand (lightweight, easy to evolve into something bigger)
- **Map data:** OpenStreetMap (basemap tiles), GTFS feeds for existing transit,
  US Census ACS for population, OpenStreetMap Overpass for street network
- **Hosting:** static site (Vercel/Netlify/GitHub Pages) — no backend yet

### Why deck.gl + MapLibre
- Real geographic accuracy out of the box
- Built-in pitch/bearing for the requested 2.5D isometric view
- WebGL-based, scales to large datasets (entire LA street network)
- Free basemap tiles (no Mapbox account required by default)
- Layer system maps cleanly to game concepts: a `LineLayer` for routes, a
  `ScatterplotLayer` for stations, a `PolygonLayer` for service areas, a
  `HeatmapLayer` for ridership demand

### Folder layout
```
public-transit-game/
  index.html
  package.json
  tsconfig.json
  vite.config.ts
  src/
    main.ts             # entry point
    app.ts              # top-level app wiring
    map/
      mapView.ts        # deck.gl + MapLibre setup
      layers/           # transit lines, stations, demand heatmap, etc.
    sim/
      budget.ts         # capital + operating budget tick
      ridership.ts      # demand model
      cost.ts           # per-mile cost estimates by mode
    game/
      state.ts          # Zustand store
      routes.ts         # route data model & operations
      agencies.ts       # agency definitions
    ui/
      hud.ts            # budget/agency HUD
      toolbar.ts        # mode picker, draw tool
    data/
      la-bbox.ts        # starting viewport for LA
  DESIGN.md
  README.md
```

---

## 4. Core Systems

### Map & Camera
The map is the game board. Default view of LA is centered roughly at Union Station,
with a pitch of ~50° and bearing of -20° to give the requested isometric feel.
The player can pan, rotate, and zoom freely.

### Routes & Construction
A **route** is an ordered list of stations connected by track or right-of-way.
Construction has a cost (capital), a duration (months), and a mode (bus, BRT,
LRT, HRT, commuter rail). Each mode has different per-mile cost, capacity,
top speed, and right-of-way requirements.

For MVP: clicking two points draws a straight line. Real pathfinding along
streets/rail corridors comes later (we'll snap to OSM ways).

### Budget
Two ledgers:
- **Capital budget** — funds construction. Sources: sales tax measures (e.g., LA's
  Measure M), federal grants (FTA CIG, RAISE), state funds (TIRCP, SB1), bonds.
- **Operating budget** — funds running service. Sources: fare revenue, sales tax
  operations share, federal formula funds, state STA. Drains: labor (largest
  single line), fuel/energy, maintenance, admin.

Each in-game month, capital projects under construction draw down capital;
operating expenses and fare revenue settle on the operating side.

### Ridership
MVP ridership model is intentionally crude: for each station, count population
within 0.5 mi (using ACS block-group data). Estimated daily boardings = some
fraction of that population, modulated by the station's connectivity (number of
routes, frequency).

Later iterations will use a real four-step model (trip generation, distribution,
mode choice, assignment) on a coarsened zone system.

### Agencies & Politics
Agencies are organizational units that own routes and budgets. The player picks
an agency to lead. Other agencies are NPCs with their own goals; sometimes
they're partners (joint funding), sometimes rivals (competing for the same
federal grant pool).

Politics is modeled as a **voter approval** number per jurisdiction (city,
county, region). Approval rises when ridership grows and projects deliver on
time/budget; falls with cost overruns, service cuts, or unpopular fare hikes.
At low approval, ballot measures fail and you lose tax authority.

---

## 5. Data Sources

| Need                          | Source                                          |
| ----------------------------- | ----------------------------------------------- |
| Basemap                       | OpenStreetMap raster tiles (or MapTiler)        |
| Street/rail geometry          | OpenStreetMap via Overpass API                  |
| Existing transit (rail/bus)   | GTFS feeds — LA Metro, Metrolink, etc.          |
| Population & demographics     | US Census ACS 5-year block-group                |
| Boundaries (cities, counties) | US Census TIGER/Line                            |
| Real costs (per-mile)         | Eno Center / FTA CIG project profiles, Marron   |
| Existing tax measures         | LA Metro budget docs, ballotpedia               |

For MVP we only need the basemap. Other sources get pulled in over the next
few iterations.

---

## 6. Roadmap

| Version | What ships                                                        |
| ------- | ----------------------------------------------------------------- |
| v0.1    | LA isometric map, click-to-draw straight line, stub HUD           |
| v0.2    | Real LA Metro Rail baseline (GTFS), click-to-street snapping      |
| v0.3    | Local street graph (downtown LA), Dijkstra pathfinding            |
| v0.4    | Full LA County graph + clock + construction + monthly tick        |
| v0.5    | Density ridership, ballot measures, goal/win/lose                 |
| v0.6    | Player stations, multi-line transfers, more event types           |
| v0.5    | Multi-agency, voter approval, simple political events             |
| v0.6    | Save/load, scenarios                                              |
| v1.0    | Bay Area + statewide expansion, HSR, polished UI                  |

---

## 7. Open Questions

- **Time scale:** real-time with pause, or turn-based by month? (Leaning real-time
  with adjustable speed, like Cities: Skylines.)
- **Failure conditions:** are they hard fails (game over) or soft (you get fired
  but the game continues with a new role)?
- **Multiplayer / shared scenarios:** out of scope for now, but the architecture
  shouldn't preclude it.
- **Historical mode:** start in 1925 with the Pacific Electric system intact and
  see if you can save it. Cool but post-v1.0.
