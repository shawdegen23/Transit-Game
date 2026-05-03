// Entry point — boots the map and HUD, then waits for player input.

import { initMap } from "./map/mapView";
import { initHud } from "./ui/hud";

const mapEl = document.getElementById("map");
if (!mapEl) throw new Error("#map element not found");

initHud();
void initMap(mapEl);

// Helpful for poking at game state in the browser devtools.
import { getState, setState } from "./game/state";
(window as unknown as { game: unknown }).game = { getState, setState };

// eslint-disable-next-line no-console
console.log(
  "[CA Transit Builder] v0.3 — LA sandbox. Routes pathfind along real streets.",
);
