// Lightweight central state with a hand-rolled subscriber store.

import type { ModeId } from "./modes";
import { defaultEventState, type EventState, type Bond } from "../sim/events";
import { defaultGoalState, type GoalState } from "../sim/goal";

export type RouteStatus = "construction" | "operating";
export type Frequency = "low" | "standard" | "high";

export interface ConstructionOpts {
  designBuild: boolean;  // -15% time, +10% cost
  shifts247: boolean;    // -20% time, +25% cost
}

export const defaultOpts: ConstructionOpts = { designBuild: false, shifts247: false };

export interface RouteSegment {
  id: number;
  stations: [number, number][];
  mode: ModeId;
  lengthMi: number;
  // Total capital cost in millions USD (after ROW discount + construction options).
  capitalCostM: number;
  dailyRiders: number;
  path: [number, number][];
  status: RouteStatus;
  startMonth: number;
  buildMonths: number;
  monthsBuilt: number;
  transferCount: number;
  // Right-of-way overlap shares (0-1) and resulting discount.
  railShare: number;
  freewayShare: number;
  // Terrain share (0-1): how much of the route runs through mountains.
  terrainShare: number;
  // Construction options chosen at commit time.
  opts: ConstructionOpts;
  // Service frequency (player-adjustable after the route opens).
  frequency: Frequency;
}

export interface PendingRoute {
  stations: [number, number][];
  opts: ConstructionOpts;
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
  bonds: Bond[];
  fareUSD: number;
  adminBias: -1 | 0 | 1;
  adminLabel: string;
  scenarioId: string; // matches a Scenario.id
  ridershipTarget: number;
  deadlineYear: number;
  // Has the player picked a scenario yet (controls game-start modal).
  scenarioPicked: boolean;
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
  bonds: [],
  fareUSD: 1.75,
  adminBias: 0,
  adminLabel: "Mayor 2026-2030 (neutral)",
  scenarioId: "sandbox",
  ridershipTarget: 500_000,
  deadlineYear: 2040,
  scenarioPicked: false,
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
