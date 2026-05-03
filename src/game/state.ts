// Lightweight central state with a hand-rolled subscriber store.

import type { ModeId } from "./modes";

export type RouteStatus = "construction" | "operating";

export interface RouteSegment {
  id: number;
  // [lon, lat] pairs.
  from: [number, number];
  to: [number, number];
  mode: ModeId;
  // Length in miles (street-distance when available, haversine fallback).
  lengthMi: number;
  // Capital cost in millions USD (TOTAL).
  capitalCostM: number;
  // Crude daily ridership estimate when in service.
  dailyRiders: number;
  // Polyline of [lon, lat] coords from `from` to `to` along the street graph.
  // Empty array means a fallback straight line; renderer handles both.
  path: [number, number][];

  // --- Construction lifecycle ---
  status: RouteStatus;
  // Game-month when construction started.
  startMonth: number;
  // Total construction duration in months.
  buildMonths: number;
  // Months elapsed in construction so far.
  monthsBuilt: number;
}

export interface GameState {
  selectedMode: ModeId;
  routes: RouteSegment[];
  // Pending click when the player has placed the first point of a new segment.
  pendingFrom: [number, number] | null;
  // Budget snapshot in millions USD.
  capitalBudgetM: number;
  operatingBudgetM: number;
  approvalPct: number;
  // Most recent monthly net cash flow (millions USD), positive = surplus.
  lastMonthNetM: number;
  // Monotonically increasing route id source.
  nextRouteId: number;
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
