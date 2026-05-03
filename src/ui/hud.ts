// Wires the topbar HUD and the toolbar/inspector panels to game state.

import { MODES, type ModeId } from "../game/modes";
import { totalDailyRiders } from "../game/routes";
import { getState, setState, subscribe } from "../game/state";
import { loadBaselineNetwork } from "../map/baselineNetwork";

function fmtMoneyM(millions: number): string {
  if (millions >= 1000) return `$${(millions / 1000).toFixed(2)}B`;
  return `$${millions.toFixed(0)}M`;
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
        // Sort by short_name / long_name for stable order.
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

  // ---- Subscribe to state for all HUD updates ----
  subscribe((s) => {
    // Top bar stats
    el("stat-capital").textContent = fmtMoneyM(s.capitalBudgetM);
    el("stat-operating").textContent = fmtMoneyM(s.operatingBudgetM);
    el("stat-riders").textContent = fmtNumber(totalDailyRiders());
    el("stat-approval").textContent = `${s.approvalPct}%`;
    el("stat-date").textContent = s.dateLabel;

    // Capital color cue
    const capEl = el("stat-capital");
    capEl.classList.toggle("bad", s.capitalBudgetM < 100);
    capEl.classList.toggle("good", s.capitalBudgetM >= 500);

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
      s.routes.forEach((r, i) => {
        const m = MODES.find((x) => x.id === r.mode)!;
        const row = document.createElement("div");
        row.className = "route-row";
        const colorCss = `rgb(${m.color[0]}, ${m.color[1]}, ${m.color[2]})`;
        row.innerHTML = `
          <span class="swatch" style="background:${colorCss}"></span>
          <div class="meta">
            <div class="name">${m.shortLabel} · Line ${i + 1}</div>
            <div class="sub">${r.lengthMi.toFixed(2)} mi · ${fmtMoneyM(r.capitalCostM)} · ${fmtNumber(r.dailyRiders)} riders/day</div>
          </div>
        `;
        list.appendChild(row);
      });
    }
  });
}
