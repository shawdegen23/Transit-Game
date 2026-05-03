// Wires the topbar HUD, time controls, toolbar, inspector, route list,
// goal progress, ballot-measure modal, and end screen to game state.

import { MODES, type ModeId } from "../game/modes";
import {
  totalDailyRiders,
  constructionCount,
  totalTransfers,
} from "../game/routes";
import { getState, setState, subscribe, type RouteSegment } from "../game/state";
import { loadBaselineNetwork } from "../map/baselineNetwork";
import {
  formatDate,
  setSpeed,
  subscribeClock,
  togglePause,
  type SpeedIndex,
  formatMonthYear,
} from "../game/clock";
import { resolveEvent, type BallotMeasure } from "../sim/events";
import {
  RIDERSHIP_TARGET,
  GOAL_DEADLINE_YEAR,
  type GameOutcome,
} from "../sim/goal";

function fmtMoneyM(millions: number): string {
  const sign = millions < 0 ? "-" : "";
  const abs = Math.abs(millions);
  if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(2)}B`;
  return `${sign}$${abs.toFixed(0)}M`;
}

function fmtSignedMoneyM(millions: number): string {
  const sign = millions >= 0 ? "+" : "−";
  const abs = Math.abs(millions);
  if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(2)}B`;
  return `${sign}$${abs.toFixed(1)}M`;
}

function fmtNumber(n: number): string {
  return n.toLocaleString("en-US");
}

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id) as T | null;
  if (!node) throw new Error(`Missing element #${id}`);
  return node;
}

export function initHud(): void {
  // ---- Baseline rail legend (loaded async) ----
  const legendEl = document.getElementById("baseline-legend") as HTMLDivElement | null;
  if (legendEl) {
    loadBaselineNetwork()
      .then((b) => {
        if (b.features.length === 0) {
          legendEl.innerHTML = '<div class="empty">No baseline data.</div>';
          return;
        }
        legendEl.innerHTML = "";
        const sorted = [...b.features].sort((a, c) =>
          (a.properties.long_name || "").localeCompare(c.properties.long_name || ""),
        );
        for (const f of sorted) {
          const row = document.createElement("div");
          row.className = "route-row";
          const p = f.properties;
          const label = p.long_name || p.short_name || p.route_id;
          row.innerHTML = `
            <span class="swatch" style="background:${p.color}"></span>
            <div class="meta">
              <div class="name">${label}</div>
              <div class="sub">${p.type === "subway" ? "Subway" : p.type === "commuter" ? "Commuter rail" : "Light rail"}</div>
            </div>
          `;
          legendEl.appendChild(row);
        }
      })
      .catch(() => {
        legendEl.innerHTML = '<div class="empty">Could not load existing network.</div>';
      });
  }

  // ---- Mode toolbar ----
  const modeGroup = el<HTMLDivElement>("mode-group");
  modeGroup.innerHTML = "";
  for (const m of MODES) {
    const btn = document.createElement("button");
    btn.className = "mode-btn";
    btn.dataset.mode = m.id;
    btn.innerHTML = `
      <span>${m.label}</span>
      <span class="cost">$${m.capitalCostPerMileM}M/mi</span>
    `;
    btn.addEventListener("click", () => {
      setState({ selectedMode: m.id as ModeId, pending: null });
    });
    modeGroup.appendChild(btn);
  }

  // ---- Time controls ----
  const timeControls = el<HTMLDivElement>("time-controls");
  const speedButtons = timeControls.querySelectorAll<HTMLButtonElement>(".speed-btn");
  speedButtons.forEach((b) => {
    b.addEventListener("click", () => {
      const idx = Number(b.dataset.speed) as SpeedIndex;
      setSpeed(idx);
    });
  });

  // Spacebar toggles pause.
  window.addEventListener("keydown", (e) => {
    if (e.code === "Space" && !(e.target instanceof HTMLInputElement)) {
      e.preventDefault();
      togglePause();
    }
  });

  // ---- Clock subscription (date + speed pill highlight) ----
  subscribeClock((cs) => {
    el("stat-date").textContent = formatDate(cs.date);
    speedButtons.forEach((b) => {
      const matches = Number(b.dataset.speed) === cs.speedIdx;
      b.classList.toggle("active", matches);
    });
  });

  // ---- Game state subscription ----
  subscribe((s) => {
    el("stat-capital").textContent = fmtMoneyM(s.capitalBudgetM);
    el("stat-operating").textContent = fmtMoneyM(s.operatingBudgetM);
    el("stat-riders").textContent = fmtNumber(totalDailyRiders());
    el("stat-transfers").textContent = fmtNumber(totalTransfers());
    el("stat-approval").textContent = `${s.approvalPct.toFixed(1)}%`;

    // Net flow indicator (millions/month)
    const nfEl = el("net-flow");
    if (s.lastMonthNetM !== 0 || s.routes.length > 0) {
      nfEl.textContent = `${fmtSignedMoneyM(s.lastMonthNetM)}/mo`;
      nfEl.classList.toggle("good", s.lastMonthNetM >= 0);
      nfEl.classList.toggle("bad", s.lastMonthNetM < 0);
    } else {
      nfEl.textContent = "";
    }

    // Capital color cue
    const capEl = el("stat-capital");
    capEl.classList.toggle("bad", s.capitalBudgetM < 100);
    capEl.classList.toggle("good", s.capitalBudgetM >= 500);

    // Approval color
    const apEl = el("stat-approval");
    apEl.classList.toggle("bad", s.approvalPct < 40);
    apEl.classList.toggle("good", s.approvalPct >= 55);

    // Active mode highlight
    const buttons = modeGroup.querySelectorAll<HTMLButtonElement>(".mode-btn");
    buttons.forEach((b) => {
      b.classList.toggle("active", b.dataset.mode === s.selectedMode);
    });

    // Route inspector
    const list = el<HTMLDivElement>("route-list");
    if (s.routes.length === 0) {
      list.innerHTML =
        '<div class="empty">No routes yet.<br/>Pick a mode and click two points on the map.</div>';
    } else {
      list.innerHTML = "";
      s.routes.forEach((r) => renderRouteRow(list, r));
    }

    // Construction badge in title
    const cc = constructionCount();
    document.title = cc > 0
      ? `🏗 ${cc} · California Transit Builder — v0.6`
      : "California Transit Builder — v0.6 (Los Angeles)";

    // Goal bar
    const riders = totalDailyRiders();
    const pct = Math.min(100, (riders / RIDERSHIP_TARGET) * 100);
    el<HTMLDivElement>("goal-bar-fill").style.width = `${pct.toFixed(1)}%`;
    el("goal-label").innerHTML =
      `<span class="target">${riders.toLocaleString()}</span> / ${RIDERSHIP_TARGET.toLocaleString()} riders by Jan ${GOAL_DEADLINE_YEAR}`;

    // Modals: pending ballot OR end screen.
    const modalRoot = el<HTMLDivElement>("modal-root");
    if (s.goal.outcome) {
      renderEndModal(modalRoot, s.goal.outcome, riders);
    } else if (s.events.pending.length > 0) {
      const ev = s.events.pending[0];
      if (ev.kind === "ballot_measure") renderBallotModal(modalRoot, ev, s.approvalPct);
      else modalRoot.innerHTML = "";
    } else {
      modalRoot.innerHTML = "";
    }
  });
}

function renderBallotModal(root: HTMLElement, ev: BallotMeasure, currentApproval: number): void {
  const passLikely = currentApproval >= ev.thresholdPct
    ? "Likely to pass"
    : "Risky — current approval is below threshold";
  const passColor = currentApproval >= ev.thresholdPct ? "var(--good)" : "var(--bad)";
  root.innerHTML = `
    <div class="modal-overlay">
      <div class="modal">
        <h2>Ballot Measure ${ev.id} — ${formatMonthYear({ year: ev.year, month: ev.month, day: 1 })}</h2>
        <div class="subtitle">A coalition wants to put a sales-tax measure on the ballot.</div>
        <p>If voters approve, you'll receive a one-time capital injection. If it fails publicly, voter approval will take a small hit.</p>
        <div class="stat-row"><span>Capital if passed</span><span class="v">$${ev.capitalIfPassedM.toLocaleString()}M</span></div>
        <div class="stat-row"><span>Approval needed</span><span class="v">${ev.thresholdPct}%</span></div>
        <div class="stat-row"><span>Your approval now</span><span class="v">${currentApproval.toFixed(1)}%</span></div>
        <div class="stat-row"><span>Outlook</span><span class="v" style="color:${passColor}">${passLikely}</span></div>
        <div class="modal-actions">
          <button class="modal-btn" id="ballot-decline">Decline</button>
          <button class="modal-btn primary" id="ballot-accept">Put on ballot</button>
        </div>
      </div>
    </div>
  `;
  document.getElementById("ballot-decline")!.addEventListener("click", () => {
    resolveEvent(ev.id, "decline");
  });
  document.getElementById("ballot-accept")!.addEventListener("click", () => {
    resolveEvent(ev.id, "accept");
  });
}

function renderEndModal(root: HTMLElement, outcome: GameOutcome, riders: number): void {
  // If already rendered, don't replace (prevents flicker).
  if (root.dataset.outcome === outcome) return;
  root.dataset.outcome = outcome;

  const titles: Record<GameOutcome, string> = {
    won: "🎉 You win",
    lost_approval: "Approval collapsed",
    lost_bankrupt: "Bankrupt",
    lost_deadline: "Time's up",
  };
  const subs: Record<GameOutcome, string> = {
    won: `You hit ${RIDERSHIP_TARGET.toLocaleString()} daily riders before the deadline.`,
    lost_approval: "Voters lost faith in the agency. Your tenure ends.",
    lost_bankrupt: "Six months of negative operating budget. The state takes over.",
    lost_deadline: `${GOAL_DEADLINE_YEAR} arrived and you didn't reach the ridership target.`,
  };

  setSpeed(0);

  root.innerHTML = `
    <div class="modal-overlay">
      <div class="modal">
        <h2>${titles[outcome]}</h2>
        <div class="subtitle">${subs[outcome]}</div>
        <div class="stat-row"><span>Final daily riders</span><span class="v">${riders.toLocaleString()}</span></div>
        <div class="modal-actions">
          <button class="modal-btn primary" id="restart-btn">New game</button>
        </div>
      </div>
    </div>
  `;
  document.getElementById("restart-btn")!.addEventListener("click", () => {
    location.reload();
  });
}

function renderRouteRow(list: HTMLElement, r: RouteSegment): void {
  const m = MODES.find((x) => x.id === r.mode)!;
  const colorCss = `rgb(${m.color[0]}, ${m.color[1]}, ${m.color[2]})`;
  const row = document.createElement("div");
  row.className = "route-row";

  const pill = `<span class="pill ${r.status}">${r.status === "construction" ? "Building" : "Live"}</span>`;
  const stationCount = r.stations.length;
  const xferTag = r.transferCount > 0
    ? ` · ${r.transferCount} transfer${r.transferCount > 1 ? "s" : ""}`
    : "";
  let sub: string;
  if (r.status === "construction") {
    const pct = Math.round((r.monthsBuilt / r.buildMonths) * 100);
    const remaining = r.buildMonths - r.monthsBuilt;
    sub = `${r.lengthMi.toFixed(2)} mi · ${stationCount} stations · ${pct}% built · ${remaining}mo`;
  } else {
    sub = `${r.lengthMi.toFixed(2)} mi · ${stationCount} stations${xferTag} · ${r.dailyRiders.toLocaleString()} riders/day`;
  }

  row.innerHTML = `
    <span class="swatch" style="background:${colorCss}"></span>
    <div class="meta">
      <div class="name">${m.shortLabel} · Line ${r.id} ${pill}</div>
      <div class="sub">${sub}</div>
    </div>
  `;
  list.appendChild(row);
}
