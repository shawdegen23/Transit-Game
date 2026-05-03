// Game clock. Advances simulated days/months on a real-time timer with
// pause + speed controls. Every onDay subscriber fires once per simulated
// day; every onMonth subscriber fires when the month rolls over.

const MS_PER_DAY_AT_1X = 333; // 1 sim day every 333 ms at 1x speed (~3 sim days/sec)
const SPEEDS = [0, 1, 4, 16] as const;
export type SpeedIndex = 0 | 1 | 2 | 3;

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export interface GameDate {
  year: number;
  month: number; // 0-11
  day: number; // 1-N
}

interface ClockState {
  date: GameDate;
  speedIdx: SpeedIndex; // 0 = paused
}

type DayListener = (d: GameDate) => void;
type MonthListener = (d: GameDate) => void;

let state: ClockState = {
  date: { year: 2026, month: 0, day: 1 },
  speedIdx: 0,
};

const dayListeners = new Set<DayListener>();
const monthListeners = new Set<MonthListener>();
const stateListeners = new Set<(s: ClockState) => void>();

let timer: number | null = null;

function daysInMonth(year: number, month: number): number {
  if (month === 1) {
    // Feb leap year rule
    if ((year % 4 === 0 && year % 100 !== 0) || year % 400 === 0) return 29;
    return 28;
  }
  return DAYS_IN_MONTH[month];
}

function tick() {
  const prevMonth = state.date.month;
  let { year, month, day } = state.date;
  day++;
  if (day > daysInMonth(year, month)) {
    day = 1;
    month++;
    if (month > 11) {
      month = 0;
      year++;
    }
  }
  state.date = { year, month, day };
  for (const l of dayListeners) l(state.date);
  if (state.date.month !== prevMonth) {
    for (const l of monthListeners) l(state.date);
  }
  emitState();
}

function reschedule() {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
  const speed = SPEEDS[state.speedIdx];
  if (speed === 0) return; // paused
  const interval = MS_PER_DAY_AT_1X / speed;
  // setInterval returns number in browser; cast for TS.
  timer = setInterval(tick, interval) as unknown as number;
}

function emitState() {
  for (const l of stateListeners) l(state);
}

export function getDate(): GameDate {
  return state.date;
}

export function getSpeedIdx(): SpeedIndex {
  return state.speedIdx;
}

export function setSpeed(idx: SpeedIndex): void {
  state.speedIdx = idx;
  reschedule();
  emitState();
}

export function togglePause(): void {
  setSpeed((state.speedIdx === 0 ? 1 : 0) as SpeedIndex);
}

export function onDay(l: DayListener): () => void {
  dayListeners.add(l);
  return () => dayListeners.delete(l);
}

export function onMonth(l: MonthListener): () => void {
  monthListeners.add(l);
  return () => monthListeners.delete(l);
}

export function subscribeClock(l: (s: ClockState) => void): () => void {
  stateListeners.add(l);
  l(state);
  return () => stateListeners.delete(l);
}

export function formatDate(d: GameDate = state.date): string {
  return `${MONTH_LABELS[d.month]} ${d.day}, ${d.year}`;
}

export function formatMonthYear(d: GameDate = state.date): string {
  return `${MONTH_LABELS[d.month]} ${d.year}`;
}
