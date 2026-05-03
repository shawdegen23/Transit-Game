// Wires the topbar HUD, time controls, toolbar, inspector, and route list
// to game state and the clock.

import { MODES, type ModeId } from "../game/modes";
import { totalDailyRiders, constructionCount } from "../game/routes";
import { getState, setState, subscribe, type RouteSegment } from "../game/state";
import { loadBaselineNetwork } from "../map/baselineNetwork";
import {
  formatDate,
  setSpeed,
  subscribeClock,
  togglePause,
  type SpeedIndex,
} from "../game/clock";

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
      setState({ selectedMode: m.id as ModeId, pendingFrom: null });
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

    // Construction badge in title (subtle indicator that things are happening)
    const cc = constructionCount();
    document.title = cc > 0
      ? `🏗 ${cc} · California Transit Builder — v0.4`
      : "California Transit Builder — v0.4 (Los Angeles)";
  });
}

function renderRouteRow(list: HTMLElement, r: RouteSegment): void {
  const m = MODES.find((x) => x.id === r.mode)!;
  const colorCss = `rgb(${m.color[0]}, ${m.color[1]}, ${m.color[2]})`;
  const row = document.createElement("div");
  row.className = "route-row";

  const pill = `<span class="pill ${r.status}">${r.status === "construction" ? "Building" : "Live"}</span>`;
  let sub: string;
  if (r.status === "construction") {
    const pct = Math.round((r.monthsBuilt / r.buildMonths) * 100);
    const remaining = r.buildMonths - r.monthsBuilt;
    sub = `${r.lengthMi.toFixed(2)} mi · ${pct}% built · ${remaining}mo to open`;
  } else {
    sub = `${r.lengthMi.toFixed(2)} mi · ${r.dailyRiders.toLocaleString()} riders/day`;
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
