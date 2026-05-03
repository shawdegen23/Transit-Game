// Map view: MapLibre GL basemap + deck.gl overlay for game layers.
// We use the MapboxOverlay adapter so deck.gl layers participate in MapLibre's
// render pipeline — this keeps the basemap and game layers perfectly synced
// during pan, zoom, pitch, and bearing changes (which is exactly what we need
// for an isometric 2.5D feel).

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

const BASEMAP_STYLE =
  "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

let baseline: BaselineCollection | null = null;
let streetsReady = false;
let streetNodes: [number, number][] = [];

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

  // Load baseline rail and street graph in parallel.
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

  // Keep deck.gl layers in sync with game state.
  subscribe((s) => {
    const layers: unknown[] = [];

    // Existing rail network — drawn UNDER player routes, slightly thicker but
    // dimmer so the player's work pops visually.
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

    // Player routes: prefer the street-pathfound polyline; fall back to
    // a straight LineLayer for segments that didn't get a path.
    if (s.routes.length > 0) {
      const pathRoutes = s.routes.filter((r) => r.path.length > 1);
      const straightRoutes = s.routes.filter((r) => r.path.length <= 1);

      if (pathRoutes.length > 0) {
        layers.push(
          new PathLayer({
            id: "routes-paths",
            data: pathRoutes,
            getPath: (d: RouteSegment) => d.path,
            getColor: (d: RouteSegment) => getMode(d.mode).color,
            getWidth: (d: RouteSegment) => {
              const m = getMode(d.mode);
              if (m.id === "hrt") return 9;
              if (m.id === "lrt" || m.id === "commuter") return 7;
              if (m.id === "brt") return 5;
              return 3;
            },
            widthUnits: "pixels",
            capRounded: true,
            jointRounded: true,
            pickable: true,
          }),
        );
      }

      if (straightRoutes.length > 0) {
        layers.push(
          new LineLayer({
            id: "routes-straight",
            data: straightRoutes,
            getSourcePosition: (d: RouteSegment) => d.from,
            getTargetPosition: (d: RouteSegment) => d.to,
            getColor: (d: RouteSegment) => getMode(d.mode).color,
            getWidth: 4,
            widthUnits: "pixels",
            pickable: true,
          }),
        );
      }

      // Endpoints as station dots.
      const stations: { position: [number, number] }[] = [];
      for (const r of s.routes) {
        stations.push({ position: r.from });
        stations.push({ position: r.to });
      }
      layers.push(
        new ScatterplotLayer({
          id: "stations",
          data: stations,
          getPosition: (d) => d.position,
          getFillColor: [255, 255, 255],
          getLineColor: [20, 20, 20],
          stroked: true,
          getRadius: 60,
          radiusMinPixels: 4,
          radiusMaxPixels: 10,
          lineWidthMinPixels: 1,
        }),
      );
    }

    // Pending preview: ghost dot at first click.
    if (s.pendingFrom) {
      layers.push(
        new ScatterplotLayer({
          id: "pending-from",
          data: [{ position: s.pendingFrom }],
          getPosition: (d) => d.position,
          getFillColor: [246, 196, 83, 220],
          getRadius: 80,
          radiusMinPixels: 6,
          radiusMaxPixels: 12,
        }),
      );
    }

    overlay.setProps({ layers: layers as never });
  });

  // Local snap: find nearest junction in the cached street graph. Instant,
  // no network round-trip. If the graph isn't loaded yet, just use the raw
  // click — the player will still be able to build, just without snapping.
  function snapLocal(p: [number, number]): [number, number] {
    if (!streetsReady) return p;
    const idx = nearestNode(p[0], p[1]);
    if (idx === null) return p;
    return streetNodes[idx];
  }

  // Click: first click sets pendingFrom, second click commits a segment.
  // Both endpoints snap to the nearest street intersection.
  map.on("click", (e) => {
    const raw: [number, number] = [e.lngLat.lng, e.lngLat.lat];
    const lngLat = snapLocal(raw);
    const s = getState();

    if (!s.pendingFrom) {
      setState({ pendingFrom: lngLat });
      return;
    }

    if (
      Math.abs(s.pendingFrom[0] - lngLat[0]) < 1e-6 &&
      Math.abs(s.pendingFrom[1] - lngLat[1]) < 1e-6
    ) {
      return;
    }

    const seg = buildSegment(s.pendingFrom, lngLat, s.selectedMode);
    commitSegment(seg);
  });

  // Esc cancels a pending route.
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && getState().pendingFrom) {
      setState({ pendingFrom: null });
    }
  });

  return map;
}
