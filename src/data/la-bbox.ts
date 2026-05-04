// v1.4 starting viewport: centered for full SoCal so the player can see
// Ventura → Palm Springs east, San Diego → north LA fringe vertically.
export const LA_INITIAL_VIEW = {
  longitude: -117.80,
  latitude: 33.65,
  zoom: 8.4,
  pitch: 40,
  bearing: -10,
  minZoom: 7,
  maxZoom: 18,
} as const;

// Full SoCal bbox (matches the data fetch scripts).
export const LA_BBOX = {
  west: -119.4,
  south: 32.55,
  east: -116.0,
  north: 34.7,
} as const;
