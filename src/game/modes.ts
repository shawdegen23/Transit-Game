// Transit modes available to the player.
// Costs are very rough US averages, suitable for prototyping. We'll refine these
// using FTA CIG project profiles and Eno Center data later.

export type ModeId = "bus" | "brt" | "lrt" | "hrt" | "commuter";

export interface Mode {
  id: ModeId;
  label: string;
  shortLabel: string;
  // Capital cost per mile, in millions of USD.
  capitalCostPerMileM: number;
  // Operating cost per revenue mile, in USD.
  operatingCostPerMile: number;
  // Approximate peak-hour capacity (passengers per direction per hour).
  capacityPphpd: number;
  // Top operating speed (mph).
  topSpeedMph: number;
  // Hex color for drawing on the map.
  color: [number, number, number];
}

export const MODES: Mode[] = [
  {
    id: "bus",
    label: "Local bus",
    shortLabel: "Bus",
    capitalCostPerMileM: 1,
    operatingCostPerMile: 12,
    capacityPphpd: 1500,
    topSpeedMph: 25,
    color: [120, 180, 255],
  },
  {
    id: "brt",
    label: "Bus rapid transit",
    shortLabel: "BRT",
    capitalCostPerMileM: 25,
    operatingCostPerMile: 14,
    capacityPphpd: 4500,
    topSpeedMph: 35,
    color: [255, 160, 80],
  },
  {
    id: "lrt",
    label: "Light rail",
    shortLabel: "LRT",
    capitalCostPerMileM: 200,
    operatingCostPerMile: 22,
    capacityPphpd: 12000,
    topSpeedMph: 55,
    color: [246, 196, 83],
  },
  {
    id: "hrt",
    label: "Heavy rail (subway)",
    shortLabel: "Subway",
    capitalCostPerMileM: 750,
    operatingCostPerMile: 30,
    capacityPphpd: 30000,
    topSpeedMph: 70,
    color: [220, 80, 80],
  },
  {
    id: "commuter",
    label: "Commuter rail",
    shortLabel: "Commuter",
    capitalCostPerMileM: 60,
    operatingCostPerMile: 40,
    capacityPphpd: 10000,
    topSpeedMph: 79,
    color: [180, 130, 220],
  },
];

export function getMode(id: ModeId): Mode {
  const m = MODES.find((x) => x.id === id);
  if (!m) throw new Error(`Unknown mode: ${id}`);
  return m;
}
