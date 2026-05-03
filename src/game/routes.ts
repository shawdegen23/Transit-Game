import { getMode, type ModeId } from "./modes";
import { getState, setState, type RouteSegment } from "./state";
import { nearestNode, shortestPath } from "../map/streetGraph";

const EARTH_RADIUS_MI = 3958.8;
const M_PER_MI = 1609.344;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

// Great-circle distance between two [lon, lat] points, in miles.
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

// Stub ridership estimate: scaled by mode capacity and length.
function estimateRidership(mode: ModeId, lengthMi: number): number {
  const m = getMode(mode);
  const baseDaily = m.capacityPphpd * 16 * 0.08;
  const lengthFactor = Math.min(1, lengthMi / 5);
  return Math.round(baseDaily * lengthFactor);
}

// Build a segment that follows real streets from `from` to `to`. If the
// street graph isn't loaded yet or no path exists, falls back to a straight
// line (caller can still play).
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
  return { from, to, mode: modeId, lengthMi, capitalCostM, dailyRiders, path };
}

export function commitSegment(seg: RouteSegment): void {
  const s = getState();
  setState({
    routes: [...s.routes, seg],
    capitalBudgetM: Math.max(0, s.capitalBudgetM - seg.capitalCostM),
    pendingFrom: null,
  });
}

export function totalDailyRiders(): number {
  return getState().routes.reduce((sum, r) => sum + r.dailyRiders, 0);
}
