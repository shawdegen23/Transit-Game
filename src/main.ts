// Entry point — boots the map, HUD, simulation tick, events, goal tracker.

import { initMap } from "./map/mapView";
import { initHud } from "./ui/hud";
import { startSimulation } from "./sim/tick";
import { startEvents } from "./sim/events";
import { startGoalTracker } from "./sim/goal";
import { loadPlaces } from "./sim/ridership";

const mapEl = document.getElementById("map");
if (!mapEl) throw new Error("#map element not found");

initHud();
startSimulation();
startEvents();
startGoalTracker();
void loadPlaces();
void initMap(mapEl);

// Helpful for poking at game state in the browser devtools.
import { getState, setState } from "./game/state";
import { getDate, setSpeed } from "./game/clock";
(window as unknown as { game: unknown }).game = {
  getState,
  setState,
  getDate,
  setSpeed,
};

// eslint-disable-next-line no-console
console.log(
  "[CA Transit Builder] v0.5 — density-based ridership, ballot measures, win/lose. " +
    "Goal: hit 500k daily riders by Jan 2040.",
);
