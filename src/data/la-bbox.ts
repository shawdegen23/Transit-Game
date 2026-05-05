// v1.5 starting viewport: SoCal + Central Coast + south Central Valley
// in one frame. Centered on a point that puts LA, San Diego, Santa
// Barbara, Bakersfield, and Fresno all visible at this zoom.
export const LA_INITIAL_VIEW = {
  longitude: -118.50,
  latitude: 34.50,
  zoom: 7.4,
  pitch: 35,
  bearing: -8,
  minZoom: 6,
  maxZoom: 18,
} as const;

// Bbox covers Monterey/Salinas west, Palm Springs east, San Diego south,
// Fresno north (matches the data fetch scripts).
export const LA_BBOX = {
  west: -121.5,
  south: 32.55,
  east: -116.0,
  north: 37.0,
} as const;
