// Lightweight central state with a hand-rolled subscriber store.

import type { ModeId } from "./modes";
import { defaultEventState, type EventState } from "../sim/events";
import { defaultGoalState, type GoalState } from "../sim/goal";

export type RouteStatus = "construction" | "operating";

export interface RouteSegment {
  id: number;
  from: [number, number];
  to: [number, number];
  mode: ModeId;
  lengthMi: number;
  capitalCostM: number;
  dailyRiders: number;
  path: [number, number][];
  status: RouteStatus;
  startMonth: number;
  buildMonths: number;
  monthsBuilt: number;
}

export interface GameState {
  selectedMode: ModeId;
  routes: RouteSegment[];
  pendingFrom: [number, number] | null;
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
  pendingFrom: null,
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
