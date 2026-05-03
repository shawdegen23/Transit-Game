import { getMode, type ModeId } from "./modes";
import {
  getState,
  setState,
  type RouteSegment,
  type ConstructionOpts,
  defaultOpts,
} from "./state";
import { nearestNode, shortestPath } from "../map/streetGraph";
import { getDate } from "./clock";
import { estimateRidership as estimateDensityRidership } from "../sim/ridership";
import { computeRowOverlap, constructionDiscount } from "../map/corridors";
import { computeTerrainShare, terrainPenalty } from "../map/terrain";

const EARTH_RADIUS_MI = 3958.8;
const M_PER_MI = 1609.344;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function haversineMi(a: [number, number], b: [number, number]): number {
  const [lon1, lat1] = a;
  const [lon2, lat2] = b;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLon = Math.sin(dLon / 2);
  const h =
    sinDLat * sinDLat +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * sinDLon * sinDLon;
  return 2 * EARTH_RADIUS_MI * Math.asin(Math.sqrt(h));
}

function estimateBuildMonths(modeId: ModeId, capitalCostM: number): number {
  const m = getMode(modeId);
  if (m.id === "bus") return Math.max(1, Math.round(capitalCostM / 5));
  if (m.id === "brt") return Math.max(2, Math.round(capitalCostM / 30));
  if (m.id === "lrt") return Math.max(12, Math.round(capitalCostM / 50));
  if (m.id === "hrt") return Math.max(24, Math.round(capitalCostM / 60));
  return Math.max(6, Math.round(capitalCostM / 40));
}

function dateToMonthIndex(year: number, month: number): number {
  return year * 12 + month;
}

// Apply construction-options multipliers on top of ROW discount.
function optionMults(opts: ConstructionOpts): { costMult: number; timeMult: number } {
  let costMult = 1;
  let timeMult = 1;
  if (opts.designBuild) {
    costMult *= 1.10;
    timeMult *= 0.85;
  }
  if (opts.shifts247) {
    costMult *= 1.25;
    timeMult *= 0.80;
  }
  return { costMult, timeMult };
}

function pathfindSegment(
  from: [number, number],
  to: [number, number],
): { coords: [number, number][]; lengthMi: number } {
  const u = nearestNode(from[0], from[1]);
  const v = nearestNode(to[0], to[1]);
  if (u !== null && v !== null && u !== v) {
    const sp = shortestPath(u, v);
    if (sp && sp.coords.length > 1) {
      return { coords: sp.coords, lengthMi: sp.lengthM / M_PER_MI };
    }
  }
  return { coords: [from, to], lengthMi: haversineMi(from, to) };
}

export function buildSegment(
  stations: [number, number][],
  modeId: ModeId,
  opts: ConstructionOpts = defaultOpts,
): RouteSegment {
  if (stations.length < 2) throw new Error("buildSegment: need >= 2 stations");
  const mode = getMode(modeId);

  let totalLenMi = 0;
  const fullPath: [number, number][] = [];
  for (let i = 0; i + 1 < stations.length; i++) {
    const seg = pathfindSegment(stations[i], stations[i + 1]);
    totalLenMi += seg.lengthMi;
    if (i === 0) fullPath.push(...seg.coords);
    else fullPath.push(...seg.coords.slice(1));
  }

  const baseCost = totalLenMi * mode.capitalCostPerMileM;
  const { railShare, freewayShare } = computeRowOverlap(fullPath);
  const rowDiscount = constructionDiscount(railShare, freewayShare);
  const optMults = optionMults(opts);
  const terrainShare = computeTerrainShare(fullPath);
  const terrain = terrainPenalty(modeId, terrainShare);

  const capitalCostM = baseCost * rowDiscount.costMult * optMults.costMult * terrain.costMult;
  const baseBuildMonths = estimateBuildMonths(modeId, baseCost);
  const buildMonths = Math.max(
    1,
    Math.round(baseBuildMonths * rowDiscount.timeMult * optMults.timeMult * terrain.timeMult),
  );

  const date = getDate();
  const s = getState();
  const baseRiders = estimateDensityRidership(mode, stations, totalLenMi);

  return {
    id: s.nextRouteId,
    stations: stations.map((p) => [...p] as [number, number]),
    mode: modeId,
    lengthMi: totalLenMi,
    capitalCostM,
    dailyRiders: baseRiders,
    path: fullPath,
    status: "construction",
    startMonth: dateToMonthIndex(date.year, date.month),
    buildMonths,
    monthsBuilt: 0,
    transferCount: 0,
    railShare,
    freewayShare,
    terrainShare,
    opts: { ...opts },
  };
}

export function commitSegment(seg: RouteSegment): void {
  const s = getState();
  setState({
    routes: [...s.routes, seg],
    pending: null,
    nextRouteId: s.nextRouteId + 1,
  });
  recomputeTransferStats();
}

// ---- Transfer detection + ridership refresh ----

const TRANSFER_RADIUS_M = 200;
const M_PER_DEG_LAT = 111_320;

function approxDistM(a: [number, number], b: [number, number]): number {
  const meanLat = ((a[1] + b[1]) / 2) * (Math.PI / 180);
  const dx = (b[0] - a[0]) * M_PER_DEG_LAT * Math.cos(meanLat);
  const dy = (b[1] - a[1]) * M_PER_DEG_LAT;
  return Math.sqrt(dx * dx + dy * dy);
}

function transferBonus(transfers: number): number {
  let bonus = 1;
  for (let i = 0; i < transfers; i++) {
    bonus += 0.30 * Math.pow(0.6, i);
  }
  return bonus;
}

export function recomputeTransferStats(): void {
  const s = getState();
  const operating = s.routes.filter((r) => r.status === "operating");
  const transfersById = new Map<number, number>();
  for (const r of operating) transfersById.set(r.id, 0);

  for (let i = 0; i < operating.length; i++) {
    for (let j = i + 1; j < operating.length; j++) {
      const a = operating[i];
      const b = operating[j];
      let transfers = 0;
      for (const sa of a.stations) {
        for (const sb of b.stations) {
          if (approxDistM(sa, sb) <= TRANSFER_RADIUS_M) {
            transfers++;
            break;
          }
        }
      }
      if (transfers > 0) {
        transfersById.set(a.id, (transfersById.get(a.id) ?? 0) + transfers);
        transfersById.set(b.id, (transfersById.get(b.id) ?? 0) + transfers);
      }
    }
  }

  const updated = s.routes.map((r) => {
    const mode = getMode(r.mode);
    const base = estimateDensityRidership(mode, r.stations, r.lengthMi);
    const t = transfersById.get(r.id) ?? 0;
    const dailyRiders = Math.round(base * transferBonus(t));
    return { ...r, dailyRiders, transferCount: t };
  });
  setState({ routes: updated });
}

export function totalDailyRiders(): number {
  return getState().routes.reduce(
    (sum, r) => sum + (r.status === "operating" ? r.dailyRiders : 0),
    0,
  );
}

export function operatingMiles(): number {
  return getState().routes.reduce(
    (sum, r) => sum + (r.status === "operating" ? r.lengthMi : 0),
    0,
  );
}

export function constructionCount(): number {
  return getState().routes.filter((r) => r.status === "construction").length;
}

export function totalTransfers(): number {
  return Math.round(
    getState()
      .routes.filter((r) => r.status === "operating")
      .reduce((sum, r) => sum + r.transferCount, 0) / 2,
  );
}

export function cancelConstruction(routeId: number): void {
  const s = getState();
  const r = s.routes.find((x) => x.id === routeId);
  if (!r || r.status !== "construction") return;
  const spentSoFar = (r.monthsBuilt / r.buildMonths) * r.capitalCostM;
  const refund = spentSoFar * 0.7;
  setState({
    routes: s.routes.filter((x) => x.id !== routeId),
    capitalBudgetM: s.capitalBudgetM + refund,
    approvalPct: Math.max(0, s.approvalPct - 0.5),
  });
  recomputeTransferStats();
}

export function shutdownRoute(routeId: number): void {
  const s = getState();
  const r = s.routes.find((x) => x.id === routeId);
  if (!r || r.status !== "operating") return;
  setState({
    routes: s.routes.filter((x) => x.id !== routeId),
    approvalPct: Math.max(0, s.approvalPct - 4),
  });
  recomputeTransferStats();
}

// Live preview of cost + length + ridership + ROW share for a list of
// pending stations. Uses straight-line haversine for length (cheap), but
// passes a rough polyline through corridor-overlap to give the player a
// real sense of how much ROW their proposed line would hug.
export interface RoutePreview {
  lengthMi: number;
  capitalCostM: number;
  estBuildMonths: number;
  dailyRiders: number;
  railShare: number;
  freewayShare: number;
  terrainShare: number;
}

export function previewRoute(
  stations: [number, number][],
  modeId: ModeId,
  opts: ConstructionOpts = defaultOpts,
): RoutePreview {
  if (stations.length < 2) {
    return { lengthMi: 0, capitalCostM: 0, estBuildMonths: 0, dailyRiders: 0, railShare: 0, freewayShare: 0, terrainShare: 0 };
  }
  const mode = getMode(modeId);
  let len = 0;
  for (let i = 0; i + 1 < stations.length; i++) {
    len += haversineMi(stations[i], stations[i + 1]);
  }
  const adjLen = len * 1.3;
  const baseCost = adjLen * mode.capitalCostPerMileM;
  const { railShare, freewayShare } = computeRowOverlap(stations);
  const rowDiscount = constructionDiscount(railShare, freewayShare);
  const optMults = optionMults(opts);
  const terrainShare = computeTerrainShare(stations);
  const terrain = terrainPenalty(modeId, terrainShare);
  const cost = baseCost * rowDiscount.costMult * optMults.costMult * terrain.costMult;
  const baseMonths = estimateBuildMonths(modeId, baseCost);
  const months = Math.max(1, Math.round(baseMonths * rowDiscount.timeMult * optMults.timeMult * terrain.timeMult));
  const riders = estimateDensityRidership(mode, stations, adjLen);
  return {
    lengthMi: adjLen,
    capitalCostM: cost,
    estBuildMonths: months,
    dailyRiders: riders,
    railShare,
    freewayShare,
    terrainShare,
  };
}
