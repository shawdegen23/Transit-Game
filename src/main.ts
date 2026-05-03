// Entry point — boots the map, HUD, and simulation tick.

import { initMap } from "./map/mapView";
import { initHud } from "./ui/hud";
import { startSimulation } from "./sim/tick";

const mapEl = document.getElementById("map");
if (!mapEl) throw new Error("#map element not found");

initHud();
startSimulation();
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
  "[CA Transit Builder] v0.4 — full LA County street graph, real-time clock, " +
    "construction queue, monthly budget tick. Press Space to play/pause.",
);
