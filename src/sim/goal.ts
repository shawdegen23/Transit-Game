// Win/lose tracker.
//
// Default goal: hit RIDERSHIP_TARGET daily riders by GOAL_DEADLINE (Jan 1
// of the deadline year).
//
// Lose conditions: approval drops below MIN_APPROVAL, OR operating budget
// stays negative for INSOLVENCY_GRACE_MONTHS consecutive months.

import { onMonth, getDate } from "../game/clock";
import { totalDailyRiders } from "../game/routes";
import { getState, setState } from "../game/state";

export const RIDERSHIP_TARGET = 500_000;
export const GOAL_DEADLINE_YEAR = 2040; // game starts Jan 2026 → 14 years
export const MIN_APPROVAL = 25;
export const INSOLVENCY_GRACE_MONTHS = 6;

export type GameOutcome = "won" | "lost_approval" | "lost_bankrupt" | "lost_deadline";

export interface GoalState {
  // Months in a row with operating budget < 0.
  insolventMonths: number;
  // Set when game ends; null while in progress.
  outcome: GameOutcome | null;
}

export function defaultGoalState(): GoalState {
  return { insolventMonths: 0, outcome: null };
}

let started = false;
export function startGoalTracker(): void {
  if (started) return;
  started = true;
  onMonth(() => {
    const s = getState();
    if (s.goal.outcome !== null) return; // game already over

    let insolventMonths = s.goal.insolventMonths;
    if (s.operatingBudgetM < 0) insolventMonths += 1;
    else insolventMonths = 0;

    let outcome: GameOutcome | null = null;
    const riders = totalDailyRiders();
    const date = getDate();

    if (riders >= RIDERSHIP_TARGET) {
      outcome = "won";
    } else if (s.approvalPct < MIN_APPROVAL) {
      outcome = "lost_approval";
    } else if (insolventMonths >= INSOLVENCY_GRACE_MONTHS) {
      outcome = "lost_bankrupt";
    } else if (date.year >= GOAL_DEADLINE_YEAR && date.month >= 0 && date.day >= 1) {
      outcome = "lost_deadline";
    }

    setState({
      goal: { insolventMonths, outcome },
    });
  });
}
