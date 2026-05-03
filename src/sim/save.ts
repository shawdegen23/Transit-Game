// Save/load: serialize and deserialize the full game state to JSON,
// stored in localStorage.
//
// Schema versioning: SAVE_VERSION bumps when state shape changes. Loads
// of old versions can attempt a migration; if the version is unknown,
// the load fails gracefully and the player can pick a new scenario.

import { getState, setState, type GameState } from "../game/state";
import { getDate, setSpeed, getSpeedIdx } from "../game/clock";
import { recomputeTransferStats } from "../game/routes";
import { onMonth } from "../game/clock";

const SAVE_VERSION = 1;
const SLOT_KEY_PREFIX = "ca-transit-save-";
const AUTOSAVE_KEY = `${SLOT_KEY_PREFIX}auto`;

export type SlotId = "auto" | "1" | "2" | "3";

interface SaveBlob {
  version: number;
  savedAt: string; // ISO timestamp (real wall clock, not game date)
  // Game state — we save almost everything except the static-asset side.
  state: SerializedState;
  // Clock snapshot.
  clock: { year: number; month: number; day: number; speedIdx: number };
}

// Serialized form is just the GameState minus things we know are safe to
// drop: pending route is reset (no point saving mid-draw), and listeners
// rebuild themselves when the data is reloaded.
type SerializedState = Omit<GameState, "pending"> & { pending: null };

export interface SlotInfo {
  id: SlotId;
  exists: boolean;
  savedAt?: string;
  scenarioId?: string;
  date?: { year: number; month: number; day: number };
  dailyRiders?: number;
  capitalBudgetM?: number;
  routeCount?: number;
}

function snapshot(): SaveBlob {
  const s = getState();
  const date = getDate();
  return {
    version: SAVE_VERSION,
    savedAt: new Date().toISOString(),
    state: { ...s, pending: null },
    clock: { year: date.year, month: date.month, day: date.day, speedIdx: getSpeedIdx() },
  };
}

export function saveToSlot(slot: SlotId): boolean {
  try {
    const blob = snapshot();
    localStorage.setItem(`${SLOT_KEY_PREFIX}${slot}`, JSON.stringify(blob));
    return true;
  } catch (err) {
    console.warn("[save] failed to save:", err);
    return false;
  }
}

export function loadFromSlot(slot: SlotId): boolean {
  try {
    const raw = localStorage.getItem(`${SLOT_KEY_PREFIX}${slot}`);
    if (!raw) return false;
    const blob = JSON.parse(raw) as SaveBlob;
    if (typeof blob.version !== "number") return false;
    if (blob.version !== SAVE_VERSION) {
      console.warn(`[save] slot version ${blob.version} doesn't match current ${SAVE_VERSION}; load skipped`);
      return false;
    }
    // Apply state. Reset pending route so we don't restore a half-drawn line.
    setState({ ...blob.state, pending: null });
    // Apply clock state via the clock module.
    setClockFromBlob(blob.clock);
    // Recompute derived data that depends on routes (transfers, ridership).
    recomputeTransferStats();
    return true;
  } catch (err) {
    console.warn("[save] failed to load:", err);
    return false;
  }
}

export function deleteSlot(slot: SlotId): void {
  try {
    localStorage.removeItem(`${SLOT_KEY_PREFIX}${slot}`);
  } catch {
    // No-op
  }
}

export function listSlots(): SlotInfo[] {
  const slots: SlotId[] = ["auto", "1", "2", "3"];
  return slots.map((id) => peekSlot(id));
}

function peekSlot(id: SlotId): SlotInfo {
  try {
    const raw = localStorage.getItem(`${SLOT_KEY_PREFIX}${id}`);
    if (!raw) return { id, exists: false };
    const blob = JSON.parse(raw) as SaveBlob;
    if (blob.version !== SAVE_VERSION) return { id, exists: false };
    const s = blob.state;
    let dailyRiders = 0;
    for (const r of s.routes ?? []) {
      if (r.status === "operating") dailyRiders += r.dailyRiders;
    }
    return {
      id,
      exists: true,
      savedAt: blob.savedAt,
      scenarioId: s.scenarioId,
      date: { year: blob.clock.year, month: blob.clock.month, day: blob.clock.day },
      dailyRiders,
      capitalBudgetM: s.capitalBudgetM,
      routeCount: (s.routes ?? []).length,
    };
  } catch {
    return { id, exists: false };
  }
}

export function hasAutosave(): boolean {
  return peekSlot("auto").exists;
}

// Wire the autosave to the monthly tick (saves every 12 sim-months).
let autosaveStarted = false;
export function startAutosave(): void {
  if (autosaveStarted) return;
  autosaveStarted = true;
  let lastAutosaveMonth = -1;
  onMonth((d) => {
    const monthIdx = d.year * 12 + d.month;
    if (lastAutosaveMonth === -1) {
      lastAutosaveMonth = monthIdx;
      return;
    }
    if (monthIdx - lastAutosaveMonth >= 12) {
      saveToSlot("auto");
      lastAutosaveMonth = monthIdx;
    }
  });
}

// Helper to set clock state. Importing setClockFromBlob from clock.ts
// would be cleaner; for now we wire it inline via state.
function setClockFromBlob(clock: SaveBlob["clock"]): void {
  // We don't have a public setClockDate, so use the clock module's setSpeed
  // (to pause) then directly mutate via a brief workaround: find clock state
  // by reading getDate result. Cleaner: add a setClock function. For v1.1
  // simplicity, rely on a side-effect via setState that the clock module
  // doesn't own — we'll add a proper setter below.
  setSpeed(0); // pause
  setClockDateInternal(clock.year, clock.month, clock.day);
  // Don't auto-resume speed; player should choose to unpause.
}

// Tiny back-channel: clock.ts exposes setClockDate via window for save loads.
// Avoids a circular import.
declare global {
  interface Window {
    __setClockDate?: (year: number, month: number, day: number) => void;
  }
}
function setClockDateInternal(year: number, month: number, day: number): void {
  if (typeof window !== "undefined" && window.__setClockDate) {
    window.__setClockDate(year, month, day);
  }
}
