// Map view: MapLibre GL basemap + deck.gl overlay for game layers.

import maplibregl from "maplibre-gl";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { LineLayer, ScatterplotLayer, PathLayer } from "@deck.gl/layers";

import { LA_INITIAL_VIEW } from "../data/la-bbox";
import { getMode } from "../game/modes";
import { buildSegment, commitSegment } from "../game/routes";
import { getState, setState, subscribe, type RouteSegment } from "../game/state";
import {
  loadBaselineNetwork,
  hexToRgb,
  type BaselineCollection,
} from "./baselineNetwork";
import { loadStreetGraph, nearestNode } from "./streetGraph";
import { getCorridorFeatures, type CorridorFeature } from "./corridors";
import { isInOcean } from "./terrain";

const BASEMAP_STYLE =
  "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

let baseline: BaselineCollection | null = null;
let streetsReady = false;
let streetNodes: [number, number][] = [];
let hoverPos: [number, number] | null = null;
let forceRerender: () => void = () => {};
let showCorridors = true;

export async function initMap(container: HTMLElement): Promise<maplibregl.Map> {
  const map = new maplibregl.Map({
    container,
    style: BASEMAP_STYLE,
    center: [LA_INITIAL_VIEW.longitude, LA_INITIAL_VIEW.latitude],
    zoom: LA_INITIAL_VIEW.zoom,
    pitch: LA_INITIAL_VIEW.pitch,
    bearing: LA_INITIAL_VIEW.bearing,
    minZoom: LA_INITIAL_VIEW.minZoom,
    maxZoom: LA_INITIAL_VIEW.maxZoom,
    attributionControl: { compact: true },
  });

  map.addControl(
    new maplibregl.NavigationControl({ visualizePitch: true }),
    "bottom-right",
  );

  const overlay = new MapboxOverlay({ layers: [] });
  map.addControl(overlay as unknown as maplibregl.IControl);

  loadBaselineNetwork()
    .then((b) => {
      baseline = b;
      setState({});
      // eslint-disable-next-line no-console
      console.log(`[baseline] loaded ${b.features.length} rail lines`);
    })
    .catch((err) => console.warn("[baseline] failed:", err));

  loadStreetGraph()
    .then((g) => {
      streetsReady = true;
      streetNodes = g.nodes;
      setState({});
    })
    .catch((err) => console.warn("[street-graph] failed:", err));

  subscribe((s) => {
    const layers: unknown[] = [];

    // Corridor overlay (rail + freeway hints) — bottom of stack.
    if (showCorridors) {
      const corridors = getCorridorFeatures();
      if (corridors.length > 0) {
        layers.push(
          new PathLayer({
            id: "corridors",
            data: corridors,
            getPath: (d: CorridorFeature) => d.coords,
            getColor: (d: CorridorFeature) =>
              d.kind === "rail" ? [120, 200, 140, 80] : [180, 180, 200, 50],
            getWidth: (d: CorridorFeature) => (d.kind === "rail" ? 3 : 2),
            widthUnits: "pixels",
            capRounded: true,
            jointRounded: true,
          }),
        );
      }
    }

    // Existing rail network — drawn UNDER player routes.
    if (baseline && baseline.features.length > 0) {
      layers.push(
        new PathLayer({
          id: "baseline-rail",
          data: baseline.features,
          getPath: (d: BaselineCollection["features"][number]) =>
            d.geometry.coordinates,
          getColor: (d: BaselineCollection["features"][number]) => {
            const [r, g, b] = hexToRgb(d.properties.color);
            return [r, g, b, 200];
          },
          getWidth: (d: BaselineCollection["features"][number]) =>
            d.properties.type === "subway" ? 7 : 5,
          widthUnits: "pixels",
          capRounded: true,
          jointRounded: true,
          pickable: true,
        }),
      );
    }

    // Player routes.
    if (s.routes.length > 0) {
      const widthFor = (d: RouteSegment) => {
        const m = getMode(d.mode);
        const base = m.id === "hrt" ? 9
          : m.id === "lrt" || m.id === "commuter" ? 7
          : m.id === "brt" ? 5
          : 3;
        return d.status === "construction" ? Math.max(2, base - 2) : base;
      };
      const colorFor = (d: RouteSegment): [number, number, number, number] => {
        const [r, g, b] = getMode(d.mode).color;
        return d.status === "construction" ? [r, g, b, 110] : [r, g, b, 255];
      };

      const pathRoutes = s.routes.filter((r) => r.path.length > 1);
      const straightRoutes = s.routes.filter((r) => r.path.length <= 1);

      if (pathRoutes.length > 0) {
        layers.push(
          new PathLayer({
            id: "routes-paths",
            data: pathRoutes,
            getPath: (d: RouteSegment) => d.path,
            getColor: colorFor,
            getWidth: widthFor,
            widthUnits: "pixels",
            capRounded: true,
            jointRounded: true,
            pickable: true,
            updateTriggers: {
              getColor: pathRoutes.map((r) => r.status).join(","),
              getWidth: pathRoutes.map((r) => r.status).join(","),
            },
          }),
        );
      }

      if (straightRoutes.length > 0) {
        layers.push(
          new LineLayer({
            id: "routes-straight",
            data: straightRoutes,
            getSourcePosition: (d: RouteSegment) => d.stations[0],
            getTargetPosition: (d: RouteSegment) =>
              d.stations[d.stations.length - 1],
            getColor: colorFor,
            getWidth: widthFor,
            widthUnits: "pixels",
            pickable: true,
          }),
        );
      }

      // Stations: every station of every route, color tinted by status.
      const stationDots: { position: [number, number]; status: string }[] = [];
      for (const r of s.routes) {
        for (const st of r.stations) {
          stationDots.push({ position: st, status: r.status });
        }
      }
      layers.push(
        new ScatterplotLayer({
          id: "stations",
          data: stationDots,
          getPosition: (d) => d.position,
          getFillColor: (d) =>
            d.status === "operating" ? [255, 255, 255, 255] : [200, 180, 130, 200],
          getLineColor: [20, 20, 20],
          stroked: true,
          getRadius: 50,
          radiusMinPixels: 4,
          radiusMaxPixels: 9,
          lineWidthMinPixels: 1,
        }),
      );
    }

    // Pending route preview: line through placed stations, plus markers.
    if (s.pending && s.pending.stations.length > 0) {
      const m = getMode(s.selectedMode);
      const stations = s.pending.stations;

      // Connecting preview: stations placed so far, optionally extended to hover.
      const previewLine: [number, number][] = [...stations];
      if (hoverPos) previewLine.push(hoverPos);

      if (previewLine.length >= 2) {
        layers.push(
          new PathLayer({
            id: "pending-path",
            data: [{ path: previewLine }],
            getPath: (d: { path: [number, number][] }) => d.path,
            getColor: [m.color[0], m.color[1], m.color[2], 200],
            getWidth: 6,
            widthUnits: "pixels",
            capRounded: true,
            jointRounded: true,
            // Make the trailing hover segment dashed-feeling by re-rendering
            // each frame; the bind on hoverPos forces an updateTriggers tick.
            updateTriggers: { getPath: hoverPos ? `${hoverPos[0]},${hoverPos[1]}` : "noh" },
          }),
        );
      }

      // Placed stations.
      layers.push(
        new ScatterplotLayer({
          id: "pending-stations",
          data: stations.map((p, i) => ({
            position: p,
            isLast: i === stations.length - 1,
          })),
          getPosition: (d) => d.position,
          getFillColor: (d) =>
            d.isLast ? [246, 196, 83, 230] : [255, 255, 255, 230],
          getLineColor: [20, 20, 20],
          stroked: true,
          getRadius: 70,
          radiusMinPixels: 7,
          radiusMaxPixels: 12,
          lineWidthMinPixels: 1,
        }),
      );

      // Ghost preview at hover position.
      if (hoverPos) {
        layers.push(
          new ScatterplotLayer({
            id: "pending-hover",
            data: [{ position: hoverPos }],
            getPosition: (d) => d.position,
            getFillColor: [246, 196, 83, 140],
            getLineColor: [246, 196, 83, 220],
            stroked: true,
            getRadius: 70,
            radiusMinPixels: 6,
            radiusMaxPixels: 10,
            lineWidthMinPixels: 2,
            updateTriggers: { getPosition: `${hoverPos[0]},${hoverPos[1]}` },
          }),
        );
      }
    }

    overlay.setProps({ layers: layers as never });
  });

  // Re-render trigger for hover-only changes (hoverPos isn't in game state).
  forceRerender = () => setState({});

  // Expose corridor toggle to HUD.
  (window as unknown as { toggleCorridors: () => void }).toggleCorridors = () => {
    showCorridors = !showCorridors;
    forceRerender();
  };

  function snapLocal(p: [number, number]): [number, number] {
    if (!streetsReady) return p;
    const idx = nearestNode(p[0], p[1]);
    if (idx === null) return p;
    return streetNodes[idx];
  }

  // Multi-click route drawing.
  // - First click on empty: opens a pending route with that station.
  // - Subsequent clicks: append station.
  // - Double-click or Enter: commit the pending route (needs >= 2 stations).
  // - Esc: cancel.
  let lastClickTime = 0;
  let lastClickPos: [number, number] | null = null;

  function commitPending(): void {
    const s = getState();
    if (!s.pending || s.pending.stations.length < 2) return;
    const seg = buildSegment(s.pending.stations, s.selectedMode);
    commitSegment(seg);
  }

  // Hover ghost — only active during pending route, throttled.
  let hoverThrottle = 0;
  map.on("mousemove", (e) => {
    if (!getState().pending) {
      if (hoverPos) {
        hoverPos = null;
        forceRerender();
      }
      return;
    }
    const now = performance.now();
    if (now - hoverThrottle < 50) return;
    hoverThrottle = now;
    const raw: [number, number] = [e.lngLat.lng, e.lngLat.lat];
    hoverPos = snapLocal(raw);
    forceRerender();
  });
  map.on("mouseout", () => {
    if (hoverPos) {
      hoverPos = null;
      forceRerender();
    }
  });

  map.on("click", (e) => {
    const raw: [number, number] = [e.lngLat.lng, e.lngLat.lat];
    if (isInOcean(raw[0], raw[1])) {
      flashToast("Can't build in the Pacific Ocean.");
      return;
    }
    const lngLat = snapLocal(raw);
    const s = getState();
    const now = Date.now();
    const isDouble =
      now - lastClickTime < 350 &&
      lastClickPos !== null &&
      Math.abs(lastClickPos[0] - lngLat[0]) < 1e-5 &&
      Math.abs(lastClickPos[1] - lngLat[1]) < 1e-5;
    lastClickTime = now;
    lastClickPos = lngLat;

    if (isDouble) {
      commitPending();
      return;
    }

    const stations = s.pending?.stations ?? [];
    // Reject duplicate of the immediately previous click.
    if (stations.length > 0) {
      const prev = stations[stations.length - 1];
      if (
        Math.abs(prev[0] - lngLat[0]) < 1e-6 &&
        Math.abs(prev[1] - lngLat[1]) < 1e-6
      ) return;
    }
    setState({
      pending: {
        stations: [...stations, lngLat],
        opts: s.pending?.opts ?? { designBuild: false, shifts247: false },
      },
    });
  });

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (getState().pending) setState({ pending: null });
    } else if (e.key === "Enter") {
      commitPending();
    } else if ((e.key === "z" || e.key === "Z") && getState().pending) {
      // Quick undo of last placed station.
      const stations = getState().pending!.stations;
      if (stations.length === 0) return;
      const next = stations.slice(0, -1);
      setState({
        pending: next.length === 0
          ? null
          : { stations: next, opts: getState().pending!.opts },
      });
    }
  });

  return map;
}

// Lightweight inline toast for ocean-click feedback (separate from goal toasts).
let flashTimer: number | null = null;
function flashToast(msg: string): void {
  let el = document.getElementById("flash-toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "flash-toast";
    el.style.cssText = `
      position: absolute; top: 80px; left: 50%; transform: translateX(-50%);
      background: rgba(248, 81, 73, 0.95); color: white; padding: 8px 14px;
      border-radius: 6px; font-size: 12px; z-index: 200;
      box-shadow: 0 4px 16px rgba(0,0,0,0.5);
    `;
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.opacity = "1";
  if (flashTimer !== null) clearTimeout(flashTimer);
  flashTimer = setTimeout(() => {
    if (el) el.style.opacity = "0";
  }, 1800) as unknown as number;
}

