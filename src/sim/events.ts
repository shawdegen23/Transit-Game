// Political events. v0.5 ships exactly one type: a sales-tax ballot
// measure. The clock fires onMonth → events.ts decides whether to spawn
// a new event. Events are pushed to game state; the HUD renders a modal
// for any pending event and exposes accept/decline.

import { onMonth, getDate } from "../game/clock";
import { getState, setState } from "../game/state";

export type EventKind = "ballot_measure";

export interface BallotMeasure {
  kind: "ballot_measure";
  id: number;
  // Year/month when proposed.
  year: number;
  month: number;
  // Capital injection (millions USD) if it passes.
  capitalIfPassedM: number;
  // Approval needed to pass (0-100). Compared against current approvalPct
  // with some noise.
  thresholdPct: number;
  // Player's choice. null = pending.
  playerChoice: "accept" | "decline" | null;
  // Outcome after resolution.
  outcome: "passed" | "failed" | "declined" | null;
}

export type GameEvent = BallotMeasure;

export interface EventState {
  pending: GameEvent[];
  history: GameEvent[];
  nextEventId: number;
  // Game-month index of the most recent ballot measure. Used to space them out.
  lastBallotMonth: number;
}

export function defaultEventState(): EventState {
  return {
    pending: [],
    history: [],
    nextEventId: 1,
    lastBallotMonth: -9999,
  };
}

const MIN_MONTHS_BETWEEN_BALLOTS = 24; // 2 sim years

function dateToMonthIndex(year: number, month: number): number {
  return year * 12 + month;
}

function maybeSpawnBallot(): void {
  const s = getState();
  const ev = s.events;
  const now = getDate();
  const m = dateToMonthIndex(now.year, now.month);
  if (m - ev.lastBallotMonth < MIN_MONTHS_BETWEEN_BALLOTS) return;
  // Only one pending at a time, please.
  if (ev.pending.length > 0) return;
  // 25% chance per eligible month (≈once every 4 eligible months, so ~once every 3 sim years on average).
  if (Math.random() > 0.25) return;

  const measure: BallotMeasure = {
    kind: "ballot_measure",
    id: ev.nextEventId,
    year: now.year,
    month: now.month,
    // $1.5B–$3.5B injection range, scaled with current operating budget burn.
    capitalIfPassedM: 1500 + Math.floor(Math.random() * 2000),
    // Need ~50–55% approval to pass typically.
    thresholdPct: 50 + Math.floor(Math.random() * 6),
    playerChoice: null,
    outcome: null,
  };

  setState({
    events: {
      ...ev,
      pending: [...ev.pending, measure],
      nextEventId: ev.nextEventId + 1,
    },
  });
}

// Resolve a ballot the player has chosen on. Called from the HUD via
// resolveEvent below.
function resolveBallot(m: BallotMeasure): BallotMeasure {
  const s = getState();
  if (m.playerChoice === "decline") {
    return { ...m, outcome: "declined" };
  }
  // Pass probability: linear ramp from threshold-10 to threshold+10.
  const a = s.approvalPct;
  const noise = (Math.random() - 0.5) * 8;
  const passed = a + noise >= m.thresholdPct;
  return { ...m, outcome: passed ? "passed" : "failed" };
}

export function resolveEvent(
  eventId: number,
  choice: "accept" | "decline",
): void {
  const s = getState();
  const idx = s.events.pending.findIndex((e) => e.id === eventId);
  if (idx < 0) return;
  const ev = s.events.pending[idx];
  if (ev.kind !== "ballot_measure") return;

  const updated = resolveBallot({ ...ev, playerChoice: choice });

  // Apply outcome.
  let newCapital = s.capitalBudgetM;
  let newApproval = s.approvalPct;
  if (updated.outcome === "passed") {
    newCapital += updated.capitalIfPassedM;
    newApproval = Math.min(100, newApproval + 3);
  } else if (updated.outcome === "failed") {
    newApproval = Math.max(0, newApproval - 4);
  } // declined → no change

  const now = getDate();
  setState({
    capitalBudgetM: newCapital,
    approvalPct: Math.round(newApproval * 10) / 10,
    events: {
      ...s.events,
      pending: s.events.pending.filter((_, i) => i !== idx),
      history: [...s.events.history, updated],
      lastBallotMonth: dateToMonthIndex(now.year, now.month),
    },
  });
}

let started = false;
export function startEvents(): void {
  if (started) return;
  started = true;
  onMonth(() => {
    maybeSpawnBallot();
  });
}
