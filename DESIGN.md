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

### v0.6 (current)
- **Player-placed stations**: routes are now built by clicking N stations
  in sequence; double-click or Enter commits, Esc cancels, Z undoes the
  last station. Each station snaps to the nearest street junction.
- **Per-segment pathfinding**: Dijkstra runs separately between each
  consecutive station pair and the polylines are stitched together.
  Length and cost reflect the true street-distance of the chosen path.
- **Transfer detection**: when an operating route has a station within
  ~200m of another operating route's station, both routes get a transfer
  bonus to ridership (+30% per transfer with diminishing returns).
- **HUD**: new "Transfers" stat in the topbar; route inspector lists
  station count and transfer count per line.

### v0.7 (current)
- **Soft deadline**: 2040 / 500k riders is now a milestone, not a game-over.
  Hitting the goal shows a celebratory toast and unlocks "sandbox mode";
  missing it shows a "missed deadline" toast — game continues either way.
  Hard game-over only triggers from approval collapse or 6mo bankruptcy.
- **Smoother station placement**: hover ghost shows where the next station
  would land, bigger snap targets, on-screen Finish/Cancel buttons.
- **Route deletion**: cancel a route in construction (refunds 70% of
  capital spent so far) or shut down an operating route (big approval hit).
- **Federal CIG grants**: apply on a route in construction, 12-month review,
  approval probability scales with project ridership-per-cost ratio and
  current approval. Award up to ~50% of project capital.
- **State TIRCP grants**: smaller awards (~10-20%) but faster cycle (6mo)
  and easier approval.
- **Bond issuance**: pick a principal, get cash now, pay monthly debt
  service for 20 years. Interest rate scales with current approval.
- **Cap-and-Trade revenue**: per operating route-mile, a fixed monthly
  allocation flows in.
- **TOD passive revenue**: each operating station earns a small monthly
  stream proportional to its accessible population (joint development).
- **Ballot fatigue**: each accepted ballot raises the threshold and shrinks
  the next award (~15% per accepted measure).
- **NIMBY events**: random against a route in construction. Pay outreach
  cost (no delay) or push through (3-6mo delay + small approval hit).

### v0.8 (current)
- **Right-of-way detection**: routes that overlap existing rail or freeway
  corridors get a cost+time discount (rail: up to −40% cost, −50% time;
  freeway: up to −15% cost, −20% time). Pending panel shows ROW % live.
- **Construction options**: per-route toggles for **design-build**
  (−15% time, +10% cost) and **24/7 shifts** (−20% time, +25% cost).
  Stack with each other and with ROW discount.
- **Live ridership preview**: estimated daily riders shown in real time
  as you place stations.
- **Fare hike controls**: topbar +/- buttons adjust fare in $0.25 steps.
  Price elasticity ≈ -0.4: a $0.25 hike adds ~14% revenue but loses ~6%
  ridership, and burns 1.5 approval points. Cuts give back approval.
- **Mayor/governor turnover**: every 4 sim years a new admin takes office
  with a bias (transit-friendly / neutral / hostile). Bias affects
  approval baseline and CIG/TIRCP grant probabilities (±10%). Visible
  as a pill in the topbar.

### v0.9 (current)
- **Visual corridor overlay**: existing rail (faint green) and freeway
  (faint grey) lines render on the map so players can see ROW discount
  opportunities. Toggleable in the toolbar.
- **Terrain build penalties**: 401 mountain zones (OSM peaks + LA's major
  ranges hand-augmented). Routes that pass through mountainous terrain
  cost more and take longer, scaled by mode (HRT tunneling: up to +85%;
  bus: ~+5%). Surfaces as a "Terrain %" line in the pending panel.
- **Pacific Ocean as hard constraint**: clicks west of LA's coastline
  bounce with a "can't build in the ocean" toast.
- **Scenario picker**: game start modal with 4 scenarios — Sandbox 2026,
  Olympics Sprint 2028, Pacific Electric Restoration, LAX Express by
  Olympics. Each sets starting capital, deadline, ridership target.
- **Bond modal**: replaced the prompt() with a real slider modal showing
  live monthly debt service and total repaid as you adjust principal.

### v1.0 (current)
- **SoCal expansion**: bbox now covers LA County + Orange County + Ventura/
  Oxnard. Streets graph is 47k junctions / 77k edges, corridors include
  the OC/IE freight rail network. Default viewport recenters to show all
  three regions in one frame.
- **Landmark system**: 616 OSM landmarks (airports, universities, colleges,
  hospitals, stadiums, theme parks, malls) with hand-augmented majors
  (LAX, SoFi, Disney, Universal, UCLA, USC, Caltech, UC Irvine, Rose Bowl,
  Dodger Stadium). Each landmark:
  - **Boosts ridership** for stations within ~800m, scaled by magnitude
    (LAX, Disney, UCLA, USC at full strength → up to +150% ridership on
    landmark-served lines)
  - **Penalizes construction** for routes within ~500m of sensitive sites
    (airports up to +70% cost, +42% time near LAX)
- **Map landmark icons**: colored dots by category (gold airports, purple
  universities, red hospitals, cyan stadiums, pink theme parks). Toggle
  with the `L` key or the on-map button.
- **Pending panel** now shows landmark boost %, airport penalty %, and
  the names of landmarks the route would serve.

### v1.1 / Future
- Push bbox south to San Diego, east to Inland Empire (Palm Springs).
- Bay Area as second region (full pipeline replication).
- Statewide rail (HSR, Amtrak California, regional).
- Save/load slots.

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
| v0.6    | Player-placed stations, transfer detection + ridership bonus      |
| v0.7    | Soft deadline, route deletion, CIG/TIRCP/bonds/TOD/NIMBY, ballot fatigue |
| v0.8    | ROW discounts, construction options, live preview, fares, mayor turnover |
| v0.9    | Corridor overlay, terrain penalties, ocean constraint, scenarios, bond modal |
| v1.0    | SoCal expansion (+OC +Ventura), landmarks system (LAX, Disney, UCLA, etc.) |
| v1.1+   | San Diego + Inland Empire bbox, Bay Area, statewide                |
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
