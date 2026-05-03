// Lightweight central state. We use a hand-rolled subscriber store for the MVP
// to avoid pulling in zustand before we need it; the API mirrors zustand so we
// can swap it in painlessly later.

import type { ModeId } from "./modes";

export interface RouteSegment {
  // [lon, lat] pairs.
  from: [number, number];
  to: [number, number];
  mode: ModeId;
  // Length in miles (computed from the actual street path when available,
  // falls back to haversine if no path was found).
  lengthMi: number;
  // Capital cost in millions USD.
  capitalCostM: number;
  // Crude daily ridership estimate.
  dailyRiders: number;
  // Polyline of [lon, lat] coords from `from` to `to` along the street graph.
  // Empty array means a fallback straight line; renderer handles both.
  path: [number, number][];
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
  dateLabel: string;
}

type Listener = (s: GameState) => void;

const initialState: GameState = {
  selectedMode: "lrt",
  routes: [],
  pendingFrom: null,
  capitalBudgetM: 2400,
  operatingBudgetM: 1850,
  approvalPct: 62,
  dateLabel: "Jan 2026",
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
