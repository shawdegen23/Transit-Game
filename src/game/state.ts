// Lightweight central state with a hand-rolled subscriber store.

import type { ModeId } from "./modes";
import { defaultEventState, type EventState } from "../sim/events";
import { defaultGoalState, type GoalState } from "../sim/goal";

export type RouteStatus = "construction" | "operating";

export interface RouteSegment {
  id: number;
  // Player-placed stations along the route, ordered. >= 2 entries.
  stations: [number, number][];
  mode: ModeId;
  // Length in miles (sum of street-distance per inter-station segment).
  lengthMi: number;
  // Capital cost in millions USD (TOTAL).
  capitalCostM: number;
  // Daily boardings when in service (recomputed when transfers change).
  dailyRiders: number;
  // Concatenated polyline of [lon, lat] coords for the entire route.
  // Empty array means a fallback straight line; renderer handles both.
  path: [number, number][];
  // Construction lifecycle.
  status: RouteStatus;
  startMonth: number;
  buildMonths: number;
  monthsBuilt: number;
  // Number of transfer points this route shares with other operating routes.
  // Recomputed on each route commit / status change.
  transferCount: number;
}

export interface PendingRoute {
  // Stations the player has placed so far on the route in progress.
  stations: [number, number][];
}

export interface GameState {
  selectedMode: ModeId;
  routes: RouteSegment[];
  // null when no route is in progress; otherwise the working route.
  pending: PendingRoute | null;
  capitalBudgetM: number;
  operatingBudgetM: number;
  approvalPct: number;
  lastMonthNetM: number;
  nextRouteId: number;
  events: EventState;
  goal: GoalState;
}

type Listener = (s: GameState) => void;

const initialState: GameState = {
  selectedMode: "lrt",
  routes: [],
  pending: null,
  capitalBudgetM: 2400,
  operatingBudgetM: 1850,
  approvalPct: 62,
  lastMonthNetM: 0,
  nextRouteId: 1,
  events: defaultEventState(),
  goal: defaultGoalState(),
};

let state: GameState = { ...initialState };
const listeners = new Set<Listener>();

export function getState(): GameState {
  return state;
}

export function setState(patch: Partial<GameState>): void {
  state = { ...state, ...patch };
  for (const l of listeners) l(state);
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  listener(state);
  return () => listeners.delete(listener);
}
