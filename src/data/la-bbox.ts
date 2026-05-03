// v1.0 starting viewport: centered between LA and OC so the player sees
// Ventura/Oxnard, San Fernando Valley, downtown LA, OC, and the coast.
export const LA_INITIAL_VIEW = {
  longitude: -118.10,
  latitude: 33.90,
  zoom: 9.4,
  pitch: 45,
  bearing: -15,
  minZoom: 8,
  maxZoom: 18,
} as const;

// SoCal bbox (matches the data fetch scripts).
export const LA_BBOX = {
  west: -119.4,
  south: 33.4,
  east: -117.4,
  north: 34.6,
} as const;
