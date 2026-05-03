// Starting viewport for the Los Angeles MVP.
// Centered roughly on Union Station / downtown LA, with an isometric pitch.
export const LA_INITIAL_VIEW = {
  longitude: -118.2437,
  latitude: 34.0522,
  zoom: 11,
  pitch: 50,
  bearing: -20,
  minZoom: 9,
  maxZoom: 18,
} as const;

// Approximate bounding box for LA County (used later for clipping data fetches).
export const LA_BBOX = {
  west: -118.95,
  south: 33.65,
  east: -117.6,
  north: 34.4,
} as const;
