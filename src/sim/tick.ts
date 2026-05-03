// Monthly simulation tick.

import { onMonth } from "../game/clock";
import { getMode } from "../game/modes";
import { getState, setState } from "../game/state";
import { recomputeTransferStats } from "../game/routes";
import { bondMonthlyDebtM } from "./events";
import { accessPopAt } from "./ridership";

// Sales-tax baseline (covers federal/state operating subsidies too).
const SALES_TAX_MONTHLY_M = 90;

// CA Cap-and-Trade allocation per operating route-mile per month, USD millions.
const CAP_TRADE_PER_MILE_M = 0.08;

// TOD passive revenue per operating station, scaled by accessible
// population at that station. Tuned so a downtown station yields ~$0.5M/mo.
const TOD_PER_STATION_BASE_M = 0.05;
const TOD_DENSITY_FACTOR = 0.0000015; // multiplied by accessPop

const FARE_USD = 1.75;

function monthlyOperatingCostM(modeId: string, lengthMi: number): number {
  const m = getMode(modeId as Parameters<typeof getMode>[0]);
  const revenueMilesPerMonth = lengthMi * 2 * 30;
  return (revenueMilesPerMonth * m.operatingCostPerMile) / 1_000_000;
}

function monthlyFareRevenueM(dailyRiders: number): number {
  const monthlyBoardings = dailyRiders * 28;
  return (monthlyBoardings * FARE_USD) / 1_000_000;
}

function monthlyTODRevenueM(): number {
  const s = getState();
  let total = 0;
  for (const r of s.routes) {
    if (r.status !== "operating") continue;
    for (const st of r.stations) {
      const access = accessPopAt(st[0], st[1]);
      total += TOD_PER_STATION_BASE_M + access * TOD_DENSITY_FACTOR;
    }
  }
  return total;
}

function monthlyCapTradeM(): number {
  const s = getState();
  let mi = 0;
  for (const r of s.routes) if (r.status === "operating") mi += r.lengthMi;
  return mi * CAP_TRADE_PER_MILE_M;
}

function progressConstruction(): { spentThisMonth: number; completedIds: number[] } {
  const s = getState();
  let spent = 0;
  const completed: number[] = [];
  const updated = s.routes.map((r) => {
    if (r.status !== "construction") return r;
    const monthsBuilt = r.monthsBuilt + 1;
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

interface OperatingFlows {
  fareM: number;
  todM: number;
  capTradeM: number;
  salesTaxM: number;
  costM: number;
  bondsM: number;
}

function settleOperating(): OperatingFlows {
  const s = getState();
  let fareM = 0;
  let costM = 0;
  for (const r of s.routes) {
    if (r.status !== "operating") continue;
    fareM += monthlyFareRevenueM(r.dailyRiders);
    costM += monthlyOperatingCostM(r.mode, r.lengthMi);
  }
  return {
    fareM,
    todM: monthlyTODRevenueM(),
    capTradeM: monthlyCapTradeM(),
    salesTaxM: SALES_TAX_MONTHLY_M,
    costM,
    bondsM: bondMonthlyDebtM(),
  };
}

function applyMonthEnd(): void {
  const s = getState();
  const construction = progressConstruction();
  if (construction.completedIds.length > 0) {
    recomputeTransferStats();
  }
  const op = settleOperating();
  const opNet =
    op.fareM + op.todM + op.capTradeM + op.salesTaxM - op.costM - op.bondsM;

  const newCapital = Math.max(0, s.capitalBudgetM - construction.spentThisMonth);
  const newOperating = s.operatingBudgetM + opNet;

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

// Exposed for HUD inspection.
export function previewMonthlyFlows(): OperatingFlows {
  return settleOperating();
}
