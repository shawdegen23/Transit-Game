// Political and funding events. v0.7 adds CIG, TIRCP, NIMBY events.
//
// Events fall into two flavors:
//   - SPONTANEOUS: spawned by the monthly tick (ballot measures, NIMBY).
//     Surface as modals; player must accept/decline.
//   - PLAYER-INITIATED: applied for via the funding panel (CIG, TIRCP, bonds).
//     Become "in-flight" entries that resolve later.

import { onMonth, getDate } from "../game/clock";
import { getState, setState } from "../game/state";

export type EventKind =
  | "ballot_measure"
  | "cig_application"
  | "tircp_application"
  | "nimby";

interface BaseEvent {
  id: number;
  kind: EventKind;
  year: number;
  month: number;
}

export interface BallotMeasure extends BaseEvent {
  kind: "ballot_measure";
  capitalIfPassedM: number;
  thresholdPct: number;
  playerChoice: "accept" | "decline" | null;
  outcome: "passed" | "failed" | "declined" | null;
}

// Federal Capital Investment Grant — needs a backing project (a route in
// construction). 12-month review. Award is a fraction of project capital.
export interface CIGApplication extends BaseEvent {
  kind: "cig_application";
  routeId: number;
  awardM: number;
  // Game-month index when decision lands.
  resolutionMonth: number;
  outcome: "approved" | "rejected" | null;
}

export interface TIRCPApplication extends BaseEvent {
  kind: "tircp_application";
  routeId: number;
  awardM: number;
  resolutionMonth: number;
  outcome: "approved" | "rejected" | null;
}

export interface NIMBYEvent extends BaseEvent {
  kind: "nimby";
  routeId: number;
  // Cost (millions) to handle outreach and avoid delay.
  outreachCostM: number;
  // Months of delay added if player refuses.
  delayMonths: number;
  approvalHit: number;
  playerChoice: "outreach" | "ignore" | null;
}

export type GameEvent = BallotMeasure | CIGApplication | TIRCPApplication | NIMBYEvent;

export interface EventState {
  pending: GameEvent[];
  inflight: (CIGApplication | TIRCPApplication)[];
  history: GameEvent[];
  nextEventId: number;
  lastBallotMonth: number;
  lastNIMBYMonth: number;
}

export function defaultEventState(): EventState {
  return {
    pending: [],
    inflight: [],
    history: [],
    nextEventId: 1,
    lastBallotMonth: -9999,
    lastNIMBYMonth: -9999,
  };
}

const MIN_MONTHS_BETWEEN_BALLOTS = 24;
const MIN_MONTHS_BETWEEN_NIMBY = 18;
const CIG_REVIEW_MONTHS = 12;
const TIRCP_REVIEW_MONTHS = 6;

function dateToMonthIndex(year: number, month: number): number {
  return year * 12 + month;
}

// ---------- Spontaneous ballot measures ----------

function maybeSpawnBallot(): void {
  const s = getState();
  const ev = s.events;
  const now = getDate();
  const m = dateToMonthIndex(now.year, now.month);
  if (m - ev.lastBallotMonth < MIN_MONTHS_BETWEEN_BALLOTS) return;
  if (ev.pending.find((e) => e.kind === "ballot_measure")) return;
  if (Math.random() > 0.25) return;

  // Diminishing returns: each historical accepted ballot reduces the next
  // award by ~15%.
  const acceptedBefore = ev.history.filter(
    (e) => e.kind === "ballot_measure" && e.outcome === "passed",
  ).length;
  const fatigueMult = Math.pow(0.85, acceptedBefore);

  const measure: BallotMeasure = {
    kind: "ballot_measure",
    id: ev.nextEventId,
    year: now.year,
    month: now.month,
    capitalIfPassedM: Math.round((1500 + Math.floor(Math.random() * 2000)) * fatigueMult),
    thresholdPct: 50 + Math.floor(Math.random() * 6) + acceptedBefore * 2,
    playerChoice: null,
    outcome: null,
  };

  setState({
    events: { ...ev, pending: [...ev.pending, measure], nextEventId: ev.nextEventId + 1 },
  });
}

function resolveBallot(m: BallotMeasure): BallotMeasure {
  const s = getState();
  if (m.playerChoice === "decline") return { ...m, outcome: "declined" };
  const a = s.approvalPct;
  const noise = (Math.random() - 0.5) * 8;
  const passed = a + noise >= m.thresholdPct;
  return { ...m, outcome: passed ? "passed" : "failed" };
}

// ---------- Spontaneous NIMBY events ----------

function maybeSpawnNIMBY(): void {
  const s = getState();
  const ev = s.events;
  const now = getDate();
  const m = dateToMonthIndex(now.year, now.month);
  if (m - ev.lastNIMBYMonth < MIN_MONTHS_BETWEEN_NIMBY) return;
  if (ev.pending.find((e) => e.kind === "nimby")) return;
  // Need a route in construction to NIMBY against.
  const candidates = s.routes.filter((r) => r.status === "construction");
  if (candidates.length === 0) return;
  if (Math.random() > 0.18) return;

  const target = candidates[Math.floor(Math.random() * candidates.length)];
  const ev2: NIMBYEvent = {
    kind: "nimby",
    id: ev.nextEventId,
    year: now.year,
    month: now.month,
    routeId: target.id,
    outreachCostM: Math.round(target.capitalCostM * 0.04 + 5),
    delayMonths: 3 + Math.floor(Math.random() * 4),
    approvalHit: 1.5,
    playerChoice: null,
  };
  setState({
    events: { ...ev, pending: [...ev.pending, ev2], nextEventId: ev.nextEventId + 1 },
  });
}

// ---------- Player-initiated grant applications ----------

export function applyForCIG(routeId: number): void {
  const s = getState();
  const route = s.routes.find((r) => r.id === routeId);
  if (!route || route.status !== "construction") return;
  // Reject if already an inflight CIG for this route.
  if (s.events.inflight.find((e) => e.kind === "cig_application" && e.routeId === routeId)) return;
  const now = getDate();
  // Award scales with ridership-per-cost ratio. Big efficient projects
  // get up to ~50% of capital reimbursed.
  const efficiency = Math.min(1, route.dailyRiders / Math.max(1, route.capitalCostM * 50));
  const awardFrac = 0.30 + 0.20 * efficiency;
  const award = Math.round(route.capitalCostM * awardFrac);
  const m = dateToMonthIndex(now.year, now.month);
  const ev: CIGApplication = {
    kind: "cig_application",
    id: s.events.nextEventId,
    year: now.year,
    month: now.month,
    routeId,
    awardM: award,
    resolutionMonth: m + CIG_REVIEW_MONTHS,
    outcome: null,
  };
  setState({
    events: {
      ...s.events,
      inflight: [...s.events.inflight, ev],
      nextEventId: s.events.nextEventId + 1,
    },
  });
}

export function applyForTIRCP(routeId: number): void {
  const s = getState();
  const route = s.routes.find((r) => r.id === routeId);
  if (!route || route.status !== "construction") return;
  if (s.events.inflight.find((e) => e.kind === "tircp_application" && e.routeId === routeId)) return;
  const now = getDate();
  const efficiency = Math.min(1, route.dailyRiders / Math.max(1, route.capitalCostM * 50));
  const awardFrac = 0.10 + 0.10 * efficiency;
  const award = Math.round(route.capitalCostM * awardFrac);
  const m = dateToMonthIndex(now.year, now.month);
  const ev: TIRCPApplication = {
    kind: "tircp_application",
    id: s.events.nextEventId,
    year: now.year,
    month: now.month,
    routeId,
    awardM: award,
    resolutionMonth: m + TIRCP_REVIEW_MONTHS,
    outcome: null,
  };
  setState({
    events: {
      ...s.events,
      inflight: [...s.events.inflight, ev],
      nextEventId: s.events.nextEventId + 1,
    },
  });
}

function resolveInflight(): void {
  const s = getState();
  const now = getDate();
  const m = dateToMonthIndex(now.year, now.month);
  let capitalGain = 0;
  let approvalGain = 0;
  const remaining: typeof s.events.inflight = [];
  const newHistory = [...s.events.history];
  for (const ev of s.events.inflight) {
    if (m < ev.resolutionMonth) {
      remaining.push(ev);
      continue;
    }
    // CIG ≈ 35% base, TIRCP ≈ 55% base. Bias from approval AND admin.
    const base = ev.kind === "cig_application" ? 0.35 : 0.55;
    const approvalMod = (s.approvalPct - 50) / 200; // ±0.25 from approval
    const adminMod = s.adminBias * 0.10; // ±0.10 from admin bias
    const approved = Math.random() < base + approvalMod + adminMod;
    const resolved = { ...ev, outcome: (approved ? "approved" : "rejected") as "approved" | "rejected" };
    if (approved) {
      capitalGain += ev.awardM;
      approvalGain += 1;
    }
    newHistory.push(resolved);
  }
  if (newHistory.length !== s.events.history.length) {
    setState({
      capitalBudgetM: s.capitalBudgetM + capitalGain,
      approvalPct: Math.min(100, s.approvalPct + approvalGain),
      events: { ...s.events, inflight: remaining, history: newHistory },
    });
  }
}

// ---------- Bond issuance ----------

export interface Bond {
  id: number;
  issuedYear: number;
  issuedMonth: number;
  principalM: number;
  // Total monthly payment (covers principal + interest over termMonths).
  monthlyPaymentM: number;
  termMonths: number;
  monthsPaid: number;
}

export function issueBond(principalM: number): void {
  const s = getState();
  if (principalM <= 0) return;
  const now = getDate();
  // Annual interest rate scales with approval: high approval = better rate.
  // 60% approval = 5% APR; 30% = 9%; 90% = 3%.
  const apr = Math.max(0.025, 0.10 - 0.0009 * s.approvalPct);
  const r = apr / 12; // monthly rate
  const n = 240; // 20 years
  const monthlyPayment = (principalM * r) / (1 - Math.pow(1 + r, -n));
  const bond: Bond = {
    id: s.bonds.length + 1,
    issuedYear: now.year,
    issuedMonth: now.month,
    principalM,
    monthlyPaymentM: Math.round(monthlyPayment * 100) / 100,
    termMonths: n,
    monthsPaid: 0,
  };
  setState({
    capitalBudgetM: s.capitalBudgetM + principalM,
    bonds: [...s.bonds, bond],
  });
}

// Total monthly bond payment (sum of all active bonds).
export function bondMonthlyDebtM(): number {
  return getState().bonds
    .filter((b) => b.monthsPaid < b.termMonths)
    .reduce((sum, b) => sum + b.monthlyPaymentM, 0);
}

function tickBonds(): void {
  const s = getState();
  if (s.bonds.length === 0) return;
  const updated = s.bonds.map((b) =>
    b.monthsPaid < b.termMonths ? { ...b, monthsPaid: b.monthsPaid + 1 } : b,
  );
  setState({ bonds: updated });
}

// ---------- Resolution + dispatch ----------

export function resolveEvent(
  eventId: number,
  choice: "accept" | "decline" | "outreach" | "ignore",
): void {
  const s = getState();
  const idx = s.events.pending.findIndex((e) => e.id === eventId);
  if (idx < 0) return;
  const ev = s.events.pending[idx];
  const now = getDate();
  const m = dateToMonthIndex(now.year, now.month);

  if (ev.kind === "ballot_measure") {
    const c = choice === "accept" || choice === "outreach" ? "accept" : "decline";
    const resolved = resolveBallot({ ...ev, playerChoice: c });
    let newCapital = s.capitalBudgetM;
    let newApproval = s.approvalPct;
    if (resolved.outcome === "passed") {
      newCapital += resolved.capitalIfPassedM;
      newApproval = Math.min(100, newApproval + 3);
    } else if (resolved.outcome === "failed") {
      newApproval = Math.max(0, newApproval - 4);
    }
    setState({
      capitalBudgetM: newCapital,
      approvalPct: Math.round(newApproval * 10) / 10,
      events: {
        ...s.events,
        pending: s.events.pending.filter((_, i) => i !== idx),
        history: [...s.events.history, resolved],
        lastBallotMonth: m,
      },
    });
    return;
  }

  if (ev.kind === "nimby") {
    if (choice === "outreach" || choice === "accept") {
      // Pay outreach cost, no delay.
      const newCapital = Math.max(0, s.capitalBudgetM - ev.outreachCostM);
      const resolved: NIMBYEvent = { ...ev, playerChoice: "outreach" };
      setState({
        capitalBudgetM: newCapital,
        events: {
          ...s.events,
          pending: s.events.pending.filter((_, i) => i !== idx),
          history: [...s.events.history, resolved],
          lastNIMBYMonth: m,
        },
      });
    } else {
      // Refuse: delay route + small approval hit.
      const updatedRoutes = s.routes.map((r) =>
        r.id === ev.routeId
          ? { ...r, buildMonths: r.buildMonths + ev.delayMonths }
          : r,
      );
      const resolved: NIMBYEvent = { ...ev, playerChoice: "ignore" };
      setState({
        routes: updatedRoutes,
        approvalPct: Math.max(0, s.approvalPct - ev.approvalHit),
        events: {
          ...s.events,
          pending: s.events.pending.filter((_, i) => i !== idx),
          history: [...s.events.history, resolved],
          lastNIMBYMonth: m,
        },
      });
    }
    return;
  }
}

// ---------- Tick wiring ----------

// ---------- Fare adjustments ----------

const BASE_FARE = 1.75; // baseline against which elasticity is anchored

// Adjust fare by deltaUSD. Positive = hike, negative = cut. Approval moves
// in opposite direction; ridership rebalances in tick via fareElasticity().
export function adjustFare(deltaUSD: number): void {
  const s = getState();
  const newFare = Math.max(0.25, Math.round((s.fareUSD + deltaUSD) * 100) / 100);
  if (newFare === s.fareUSD) return;
  // Approval shock: $0.25 hike = -1.5 approval, $0.25 cut = +1.0 approval
  const approvalDelta = deltaUSD > 0 ? -1.5 : 1.0;
  setState({
    fareUSD: newFare,
    approvalPct: Math.max(0, Math.min(100, s.approvalPct + approvalDelta)),
  });
}

// Fare-to-ridership elasticity factor: how much riders scale with fare
// vs. baseline. Elasticity ≈ -0.4 (transit-typical).
export function fareElasticity(fareUSD: number): number {
  // r = (fare/base)^elasticity; elasticity is negative.
  const elasticity = -0.4;
  return Math.pow(fareUSD / BASE_FARE, elasticity);
}

// ---------- Admin turnover ----------

const ADMIN_TERM_MONTHS = 48; // 4-year terms
const ADMIN_LABELS = {
  "-1": "hostile",
  "0": "neutral",
  "1": "transit-friendly",
} as const;

function maybeRotateAdmin(): void {
  const s = getState();
  const now = getDate();
  const m = dateToMonthIndex(now.year, now.month);
  // Rotate every ADMIN_TERM_MONTHS aligned to game start.
  // Game starts Jan 2026; first rotation Jan 2030, then Jan 2034, etc.
  const startM = 2026 * 12; // Jan 2026
  const monthsSinceStart = m - startM;
  if (monthsSinceStart <= 0) return;
  if (monthsSinceStart % ADMIN_TERM_MONTHS !== 0) return;

  // Bias distribution: 30% friendly, 50% neutral, 20% hostile, slight pull
  // toward neutral if previous bias was extreme.
  const r = Math.random();
  let bias: -1 | 0 | 1;
  if (r < 0.3) bias = 1;
  else if (r < 0.8) bias = 0;
  else bias = -1;

  const termStartYear = now.year;
  const termEndYear = termStartYear + 4;
  const label = `Mayor ${termStartYear}-${termEndYear} (${ADMIN_LABELS[String(bias) as "-1" | "0" | "1"]})`;

  // Approval shock based on new bias.
  const shock = bias === 1 ? 4 : bias === -1 ? -4 : 0;
  setState({
    adminBias: bias,
    adminLabel: label,
    approvalPct: Math.max(0, Math.min(100, s.approvalPct + shock)),
  });
}

let started = false;
export function startEvents(): void {
  if (started) return;
  started = true;
  onMonth(() => {
    maybeRotateAdmin();
    maybeSpawnBallot();
    maybeSpawnNIMBY();
    resolveInflight();
    tickBonds();
  });
}
