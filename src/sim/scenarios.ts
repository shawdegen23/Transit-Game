// Scenario definitions. Player picks one at game start; it sets initial
// budget, deadline, ridership target, and a description.

export interface Scenario {
  id: string;
  label: string;
  description: string;
  startCapitalM: number;
  startOperatingM: number;
  startApproval: number;
  startYear: number;
  startMonth: number;
  ridershipTarget: number;
  deadlineYear: number;
  // Optional flavor: a hint to the player about what to focus on.
  hint: string;
}

export const SCENARIOS: Scenario[] = [
  {
    id: "sandbox",
    label: "Sandbox — LA Metro 2026",
    description:
      "The default scenario. You inherit the LA Metro operating budget and Measure M capital. Build whatever you want, however you want. Soft goal: 500k daily riders by 2040, but the game keeps running.",
    startCapitalM: 2400,
    startOperatingM: 1850,
    startApproval: 62,
    startYear: 2026,
    startMonth: 0,
    ridershipTarget: 500_000,
    deadlineYear: 2040,
    hint: "Mix subway in dense corridors with light rail along the existing Blue / Gold lines for big transfer bonuses.",
  },
  {
    id: "olympics_2028",
    label: "Olympics Sprint — 2028 LA Games",
    description:
      "Two years to ship transit improvements before the world arrives. The IOC threw $1.5B at you. You need 250k new daily riders by July 2028, focused on the LAX → Downtown corridor.",
    startCapitalM: 3900, // Measure M baseline + Olympics windfall
    startOperatingM: 2000,
    startApproval: 70,
    startYear: 2026,
    startMonth: 0,
    ridershipTarget: 250_000,
    deadlineYear: 2028,
    hint: "Light rail along existing freight corridors finishes faster. 24/7 shifts pay off when the deadline is brutal.",
  },
  {
    id: "pacific_electric",
    label: "Pacific Electric Restoration",
    description:
      "Resurrect the historical Red Cars: rebuild the great LA streetcar network destroyed in the 1950s. Wide network, lots of light rail, hit 750k riders by 2050.",
    startCapitalM: 3200,
    startOperatingM: 1500,
    startApproval: 55,
    startYear: 2026,
    startMonth: 0,
    ridershipTarget: 750_000,
    deadlineYear: 2050,
    hint: "Lots of LRT lines radiating from downtown. Long lines, many transfers — that's how the original PE worked.",
  },
  {
    id: "lax_express",
    label: "LAX Express by Olympics",
    description:
      "Voters demand a one-seat ride from Downtown LA to LAX before the 2028 Olympics. Tighter budget but high political will. Hit 100k daily riders on a DT↔LAX corridor by July 2028.",
    startCapitalM: 2800,
    startOperatingM: 1700,
    startApproval: 75,
    startYear: 2026,
    startMonth: 0,
    ridershipTarget: 100_000,
    deadlineYear: 2028,
    hint: "Build heavy rail along the I-110 corridor for max ROW discount. Don't overbuild elsewhere.",
  },
];

export function getScenario(id: string): Scenario | undefined {
  return SCENARIOS.find((s) => s.id === id);
}

const STORAGE_KEY = "ca-transit-scenario";

export function loadSavedScenarioId(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function saveScenarioId(id: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // No-op; some browsers/embeds block storage.
  }
}
