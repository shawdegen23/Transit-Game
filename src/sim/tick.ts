// Monthly simulation tick: progresses construction, settles operating
// budget, adjusts approval. Called once per simulated month from main.ts.

import { onMonth } from "../game/clock";
import { getMode } from "../game/modes";
import { getState, setState } from "../game/state";
import { recomputeTransferStats } from "../game/routes";

// Sales tax revenue baked in monthly (Measure M-style). LA Metro's actual
// sales tax revenue is roughly $200M/month, but the player's "agency budget"
// is a simplification that absorbs federal/state operating subsidies too.
// We use a round number that lets new players survive a few months without
// any operating routes yet, but feels tight once a system is built.
const SALES_TAX_MONTHLY_M = 90;

// Average fare per boarding (USD).
const FARE_USD = 1.75;

// Operating cost factor: per-mile cost in modes.ts is per revenue mile.
// A daily revenue mile is roughly 18 hours of service, so we treat
// per-route monthly operating cost as ~30 days * 18 service hours *
// per-mile cost / very-rough-trips-per-mile factor. Calibrate later.
function monthlyOperatingCostM(modeId: string, lengthMi: number): number {
  const m = getMode(modeId as Parameters<typeof getMode>[0]);
  // Revenue miles per month per route: assume both directions, 18-hour
  // service, ~10 mph average effective speed (= 180 mi/day per direction).
  const revenueMilesPerMonth = lengthMi * 2 * 30;
  // Total cost USD → millions
  return (revenueMilesPerMonth * m.operatingCostPerMile) / 1_000_000;
}

function monthlyFareRevenueM(dailyRiders: number): number {
  // 30 days, modest weekend dip baked in.
  const monthlyBoardings = dailyRiders * 28;
  return (monthlyBoardings * FARE_USD) / 1_000_000;
}

function progressConstruction(): { spentThisMonth: number; completedIds: number[] } {
  const s = getState();
  let spent = 0;
  const completed: number[] = [];
  const updated = s.routes.map((r) => {
    if (r.status !== "construction") return r;
    const monthsBuilt = r.monthsBuilt + 1;
    // Spend the route's capital evenly across its build months.
    const draw = r.capitalCostM / r.buildMonths;
    spent += draw;
    if (monthsBuilt >= r.buildMonths) {
      completed.push(r.id);
      return { ...r, monthsBuilt: r.buildMonths, status: "operating" as const };
    }
    return { ...r, monthsBuilt };
  });
  setState({ routes: updated });
  return { spentThisMonth: spent, completedIds: completed };
}

function settleOperating(): { revenueM: number; costM: number } {
  const s = getState();
  let revenue = SALES_TAX_MONTHLY_M;
  let cost = 0;
  for (const r of s.routes) {
    if (r.status !== "operating") continue;
    revenue += monthlyFareRevenueM(r.dailyRiders);
    cost += monthlyOperatingCostM(r.mode, r.lengthMi);
  }
  return { revenueM: revenue, costM: cost };
}

function applyMonthEnd(): void {
  const s = getState();
  const construction = progressConstruction();
  // If any route opened this month, refresh transfer counts + ridership.
  if (construction.completedIds.length > 0) {
    recomputeTransferStats();
  }
  const operating = settleOperating();

  const newCapital = Math.max(
    0,
    s.capitalBudgetM - construction.spentThisMonth,
  );
  const opNet = operating.revenueM - operating.costM;
  const newOperating = s.operatingBudgetM + opNet;

  // Approval adjustments:
  //   +0.2/mo per completed route
  //   -0.5/mo if operating budget is negative
  //   -0.3/mo if capital budget is empty AND there are no operating routes
  //          (you're stuck — players notice)
  //   +0.05/mo per operating route (slow grind upward when system runs)
  let approval = s.approvalPct;
  approval += construction.completedIds.length * 0.2;
  if (newOperating < 0) approval -= 0.5;
  const operatingRoutes = s.routes.filter((r) => r.status === "operating").length;
  if (newCapital <= 0 && operatingRoutes === 0) approval -= 0.3;
  approval += operatingRoutes * 0.05;
  approval = Math.max(0, Math.min(100, approval));

  setState({
    capitalBudgetM: newCapital,
    operatingBudgetM: newOperating,
    lastMonthNetM: opNet - construction.spentThisMonth,
    approvalPct: Math.round(approval * 10) / 10,
  });
}

let started = false;
export function startSimulation(): void {
  if (started) return;
  started = true;
  onMonth(() => applyMonthEnd());
}
