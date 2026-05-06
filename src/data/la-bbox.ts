// v1.7: California south of Mendocino, with the Pacific Ocean now
// visibly outlined as a polygon overlay. (Full-state bbox deferred to
// v1.8 along with the region picker — single-file 35MB streets file is
// too big without that architecture.)
export const LA_INITIAL_VIEW = {
  longitude: -119.20,
  latitude: 35.70,
  zoom: 6.4,
  pitch: 30,
  bearing: -5,
  minZoom: 5,
  maxZoom: 18,
} as const;

// SoCal + Bay Area + Sacramento bbox (matches v1.6 data files).
export const LA_BBOX = {
  west: -122.5,
  south: 32.55,
  east: -116.0,
  north: 38.8,
} as const;
