// v1.6 starting viewport: full California south of Mendocino, all in one
// frame. SF Bay Area at top-left, Sacramento at top-right, San Diego at
// bottom. Player can zoom in to focus on a region.
export const LA_INITIAL_VIEW = {
  longitude: -119.20,
  latitude: 35.70,
  zoom: 6.4,
  pitch: 30,
  bearing: -5,
  minZoom: 5,
  maxZoom: 18,
} as const;

// Full CA bbox south of Mendocino (matches the data fetch scripts).
export const LA_BBOX = {
  west: -122.5,
  south: 32.55,
  east: -116.0,
  north: 38.8,
} as const;
