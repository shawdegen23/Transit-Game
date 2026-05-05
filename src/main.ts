// Entry point — boots the map, HUD, simulation tick, events, goal tracker.

import { initMap } from "./map/mapView";
import { initHud } from "./ui/hud";
import { startSimulation } from "./sim/tick";
import { startEvents } from "./sim/events";
import { startGoalTracker } from "./sim/goal";
import { loadPlaces } from "./sim/ridership";
import { loadCorridors } from "./map/corridors";
import { loadTerrain } from "./map/terrain";
import { startAutosave, hasAutosave, loadFromSlot } from "./sim/save";

const mapEl = document.getElementById("map");
if (!mapEl) throw new Error("#map element not found");

initHud();
startSimulation();
startEvents();
startGoalTracker();
startAutosave();
void loadPlaces();
void loadCorridors();
void loadTerrain();
void initMap(mapEl);

// Resume-on-reload: if the player has an autosave, offer to continue
// instead of forcing them through the scenario picker.
if (hasAutosave()) {
  // Defer slightly so HUD subscribers are wired before we restore state.
  setTimeout(() => {
    if (confirm("Continue your previous game? (Cancel = pick a new scenario)")) {
      const ok = loadFromSlot("auto");
      if (!ok) {
        // Bail to scenario picker.
        setState({ scenarioPicked: false });
      }
    } else {
      // Player wants a fresh start; just clear the autosave hint and show picker.
      setState({ scenarioPicked: false });
    }
  }, 200);
}

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
  "[CA Transit Builder] v1.5 — Central Coast + south Central Valley added: " +
    "Santa Barbara, San Luis Obispo, Monterey, Bakersfield, Fresno.",
);
