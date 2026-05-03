// Goal tracker.
//
// v0.7: 2040 is a SOFT deadline. Hitting RIDERSHIP_TARGET = "won" toast,
// missing the deadline = "missed" toast, but in either case the game
// keeps running (sandbox mode). Only true game-over conditions are
// approval collapse and prolonged insolvency.

import { onMonth, getDate } from "../game/clock";
import { totalDailyRiders } from "../game/routes";
import { getState, setState } from "../game/state";

// These are now defaults — actual target/deadline come from the active
// scenario (state.ridershipTarget, state.deadlineYear).
export const DEFAULT_RIDERSHIP_TARGET = 500_000;
export const DEFAULT_DEADLINE_YEAR = 2040;
export const MIN_APPROVAL = 25;
export const INSOLVENCY_GRACE_MONTHS = 6;

// Hard game-over outcomes only. Soft outcomes (won goal, missed deadline)
// surface as transient banners, not modals.
export type GameOutcome = "lost_approval" | "lost_bankrupt";
export type GoalMilestone = "won" | "missed_deadline" | null;

export interface GoalState {
  insolventMonths: number;
  outcome: GameOutcome | null;
  // Set once when player first hits the ridership target.
  hitTarget: boolean;
  // Set once when 2040 passes without hitting target.
  missedDeadline: boolean;
  // The most recent transient milestone to surface to the player. The HUD
  // clears this after showing a toast.
  milestoneToast: GoalMilestone;
}

export function defaultGoalState(): GoalState {
  return {
    insolventMonths: 0,
    outcome: null,
    hitTarget: false,
    missedDeadline: false,
    milestoneToast: null,
  };
}

export function clearMilestoneToast(): void {
  const s = getState();
  setState({ goal: { ...s.goal, milestoneToast: null } });
}

let started = false;
export function startGoalTracker(): void {
  if (started) return;
  started = true;
  onMonth(() => {
    const s = getState();
    if (s.goal.outcome !== null) return;

    let insolventMonths = s.goal.insolventMonths;
    if (s.operatingBudgetM < 0) insolventMonths += 1;
    else insolventMonths = 0;

    let outcome: GameOutcome | null = null;
    let hitTarget = s.goal.hitTarget;
    let missedDeadline = s.goal.missedDeadline;
    let milestoneToast: GoalMilestone = null;

    const riders = totalDailyRiders();
    const date = getDate();
    const target = s.ridershipTarget;
    const deadline = s.deadlineYear;

    if (!hitTarget && riders >= target) {
      hitTarget = true;
      milestoneToast = "won";
    }

    if (!missedDeadline && !hitTarget && date.year >= deadline) {
      missedDeadline = true;
      milestoneToast = "missed_deadline";
    }

    if (s.approvalPct < MIN_APPROVAL) {
      outcome = "lost_approval";
    } else if (insolventMonths >= INSOLVENCY_GRACE_MONTHS) {
      outcome = "lost_bankrupt";
    }

    setState({
      goal: { insolventMonths, outcome, hitTarget, missedDeadline, milestoneToast },
    });
  });
}
