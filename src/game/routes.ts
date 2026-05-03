import { getMode, type ModeId } from "./modes";
import { getState, setState, type RouteSegment } from "./state";
import { nearestNode, shortestPath } from "../map/streetGraph";
import { getDate } from "./clock";

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

function estimateRidership(mode: ModeId, lengthMi: number): number {
  const m = getMode(mode);
  const baseDaily = m.capacityPphpd * 16 * 0.08;
  const lengthFactor = Math.min(1, lengthMi / 5);
  return Math.round(baseDaily * lengthFactor);
}

// Construction time in months. Loose rule of thumb based on real-world
// projects: rail takes ~1 month per $50M, BRT and bus are much faster.
function estimateBuildMonths(modeId: ModeId, capitalCostM: number): number {
  const m = getMode(modeId);
  if (m.id === "bus") return Math.max(1, Math.round(capitalCostM / 5));
  if (m.id === "brt") return Math.max(2, Math.round(capitalCostM / 30));
  if (m.id === "lrt") return Math.max(12, Math.round(capitalCostM / 50));
  if (m.id === "hrt") return Math.max(24, Math.round(capitalCostM / 60));
  // commuter
  return Math.max(6, Math.round(capitalCostM / 40));
}

function dateToMonthIndex(year: number, month: number): number {
  return year * 12 + month;
}

export function buildSegment(
  from: [number, number],
  to: [number, number],
  modeId: ModeId,
): RouteSegment {
  const mode = getMode(modeId);

  let path: [number, number][] = [];
  let lengthMi: number;

  const u = nearestNode(from[0], from[1]);
  const v = nearestNode(to[0], to[1]);
  if (u !== null && v !== null && u !== v) {
    const sp = shortestPath(u, v);
    if (sp && sp.coords.length > 1) {
      path = sp.coords;
      lengthMi = sp.lengthM / M_PER_MI;
    } else {
      lengthMi = haversineMi(from, to);
    }
  } else {
    lengthMi = haversineMi(from, to);
  }

  const capitalCostM = lengthMi * mode.capitalCostPerMileM;
  const dailyRiders = estimateRidership(modeId, lengthMi);
  const buildMonths = estimateBuildMonths(modeId, capitalCostM);
  const date = getDate();

  const s = getState();
  return {
    id: s.nextRouteId,
    from,
    to,
    mode: modeId,
    lengthMi,
    capitalCostM,
    dailyRiders,
    path,
    status: "construction",
    startMonth: dateToMonthIndex(date.year, date.month),
    buildMonths,
    monthsBuilt: 0,
  };
}

export function commitSegment(seg: RouteSegment): void {
  const s = getState();
  setState({
    routes: [...s.routes, seg],
    pendingFrom: null,
    nextRouteId: s.nextRouteId + 1,
  });
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
