// Loader for the LA Metro baseline rail network (existing infrastructure the
// player doesn't own but which exists in the world).
//
// Data is generated at build/setup time by scripts/fetch-gtfs.mjs into
// public/la-metro-rail.geojson, so we just fetch it as a static asset.

export interface BaselineFeature {
  type: "Feature";
  properties: {
    route_id: string;
    short_name: string;
    long_name: string;
    type: "subway" | "lrt" | "commuter";
    color: string; // hex, includes #
    text_color: string;
  };
  geometry: {
    type: "LineString";
    coordinates: [number, number][];
  };
}

export interface BaselineCollection {
  type: "FeatureCollection";
  features: BaselineFeature[];
}

export async function loadBaselineNetwork(): Promise<BaselineCollection> {
  const res = await fetch("/la-metro-rail.geojson");
  if (!res.ok) {
    throw new Error(`Failed to load baseline network: ${res.status}`);
  }
  return (await res.json()) as BaselineCollection;
}

// Convert "#RRGGBB" → [r, g, b] for deck.gl.
export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}
