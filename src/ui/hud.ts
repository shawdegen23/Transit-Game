// HUD: topbar stats, pending-route panel, toolbar, funding panel,
// inspector, ballot/end modals, and milestone toasts.

import { MODES, type ModeId } from "../game/modes";
import {
  totalDailyRiders,
  constructionCount,
  totalTransfers,
  cancelConstruction,
  shutdownRoute,
  previewRoute,
  buildSegment,
  commitSegment,
  setRouteFrequency,
  FREQUENCY_MULT,
} from "../game/routes";
import type { Frequency } from "../game/state";
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
import {
  resolveEvent,
  applyForCIG,
  applyForTIRCP,
  issueBond,
  adjustFare,
  type BallotMeasure,
  type NIMBYEvent,
} from "../sim/events";
import { previewMonthlyFlows } from "../sim/tick";
import {
  clearMilestoneToast,
  type GameOutcome,
} from "../sim/goal";
import { SCENARIOS, saveScenarioId } from "../sim/scenarios";
import {
  saveToSlot,
  loadFromSlot,
  deleteSlot,
  listSlots,
  hasAutosave,
  type SlotId,
} from "../sim/save";

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
  // ---- Baseline rail legend ----
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
      setSpeed(Number(b.dataset.speed) as SpeedIndex);
    });
  });

  window.addEventListener("keydown", (e) => {
    if (e.code === "Space" && !(e.target instanceof HTMLInputElement)) {
      e.preventDefault();
      togglePause();
    }
  });

  // Fare control
  document.getElementById("fare-up")!.addEventListener("click", () => adjustFare(0.25));
  document.getElementById("fare-down")!.addEventListener("click", () => adjustFare(-0.25));

  // (Corridor toggle is wired directly in mapView.ts via the floating button.)

  // Menu button → save/load modal
  document.getElementById("menu-btn")!.addEventListener("click", () => openMenuModal());

  // Ctrl+S quick-save
  window.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === "s" || e.key === "S")) {
      e.preventDefault();
      const ok = saveToSlot("auto");
      flashUiToast(ok ? "Quick-saved." : "Save failed.", ok);
    }
  });

  // ---- Clock subscription ----
  subscribeClock((cs) => {
    el("stat-date").textContent = formatDate(cs.date);
    speedButtons.forEach((b) => {
      b.classList.toggle("active", Number(b.dataset.speed) === cs.speedIdx);
    });
  });

  // ---- Game state subscription ----
  subscribe((s) => {
    el("stat-capital").textContent = fmtMoneyM(s.capitalBudgetM);
    el("stat-operating").textContent = fmtMoneyM(s.operatingBudgetM);
    el("stat-riders").textContent = fmtNumber(totalDailyRiders());
    el("stat-transfers").textContent = fmtNumber(totalTransfers());
    el("stat-approval").textContent = `${s.approvalPct.toFixed(1)}%`;
    el("fare-val").textContent = `$${s.fareUSD.toFixed(2)}`;

    const adminPill = el("admin-pill");
    adminPill.textContent = s.adminLabel;
    adminPill.classList.toggle("friendly", s.adminBias === 1);
    adminPill.classList.toggle("hostile", s.adminBias === -1);

    const nfEl = el("net-flow");
    if (s.lastMonthNetM !== 0 || s.routes.length > 0) {
      nfEl.textContent = `${fmtSignedMoneyM(s.lastMonthNetM)}/mo`;
      nfEl.classList.toggle("good", s.lastMonthNetM >= 0);
      nfEl.classList.toggle("bad", s.lastMonthNetM < 0);
    } else {
      nfEl.textContent = "";
    }

    const capEl = el("stat-capital");
    capEl.classList.toggle("bad", s.capitalBudgetM < 100);
    capEl.classList.toggle("good", s.capitalBudgetM >= 500);

    const apEl = el("stat-approval");
    apEl.classList.toggle("bad", s.approvalPct < 40);
    apEl.classList.toggle("good", s.approvalPct >= 55);

    modeGroup.querySelectorAll<HTMLButtonElement>(".mode-btn").forEach((b) => {
      b.classList.toggle("active", b.dataset.mode === s.selectedMode);
    });

    // Inspector
    const list = el<HTMLDivElement>("route-list");
    if (s.routes.length === 0) {
      list.innerHTML = '<div class="empty">No routes yet.<br/>Pick a mode and click stations on the map.</div>';
    } else {
      list.innerHTML = "";
      s.routes.forEach((r) => renderRouteRow(list, r));
    }

    const cc = constructionCount();
    document.title = cc > 0
      ? `🏗 ${cc} · California Transit Builder — v0.8`
      : "California Transit Builder — v0.8 (Los Angeles)";

    // Goal bar — uses scenario's target/deadline.
    const riders = totalDailyRiders();
    const pct = Math.min(100, (riders / s.ridershipTarget) * 100);
    el<HTMLDivElement>("goal-bar-fill").style.width = `${pct.toFixed(1)}%`;
    const labelText = s.goal.hitTarget
      ? `<span class="target">${riders.toLocaleString()}</span> riders ✓ Goal achieved (sandbox mode)`
      : `<span class="target">${riders.toLocaleString()}</span> / ${s.ridershipTarget.toLocaleString()} riders by Jan ${s.deadlineYear}`;
    el("goal-label").innerHTML = labelText;

    // Pending route panel
    renderPendingPanel(s);

    // Funding panel
    renderFundingPanel(s);

    // Modal: scenario picker > game-over > pending events. User-opened
    // modals (menu, bond) own modal-root via dataset.kind and shouldn't
    // be force-closed by state updates.
    const modalRoot = el<HTMLDivElement>("modal-root");
    const userOwned = modalRoot.dataset.kind === "menu" || modalRoot.dataset.kind === "bond";
    if (!s.scenarioPicked) {
      renderScenarioPicker(modalRoot);
    } else if (s.goal.outcome) {
      renderEndModal(modalRoot, s.goal.outcome, riders);
    } else if (s.events.pending.length > 0 && !userOwned) {
      const ev = s.events.pending[0];
      if (ev.kind === "ballot_measure") renderBallotModal(modalRoot, ev, s.approvalPct);
      else if (ev.kind === "nimby") renderNIMBYModal(modalRoot, ev);
      else { modalRoot.innerHTML = ""; modalRoot.dataset.modalSig = ""; }
    } else if (!userOwned) {
      // No state-driven modal should be showing — clear the slate.
      if (modalRoot.dataset.modalSig || modalRoot.innerHTML !== "") {
        modalRoot.innerHTML = "";
        modalRoot.dataset.modalSig = "";
        modalRoot.dataset.outcome = "";
      }
    }

    // Toast (soft milestones)
    if (s.goal.milestoneToast) {
      renderToast(s.goal.milestoneToast);
    }
  });
}

function renderPendingPanel(s: ReturnType<typeof getState>): void {
  const root = el<HTMLDivElement>("pending-root");
  if (!s.pending || s.pending.stations.length === 0) {
    root.innerHTML = "";
    return;
  }
  const opts = s.pending.opts;
  const preview = previewRoute(s.pending.stations, s.selectedMode, opts);
  const canFinish = s.pending.stations.length >= 2;
  const overBudget = preview.capitalCostM > s.capitalBudgetM;
  const rowPct = ((preview.railShare + preview.freewayShare) * 100).toFixed(0);
  const rowDetail = preview.railShare > 0 || preview.freewayShare > 0
    ? `<div class="stat-mini"><span class="label">Right-of-way</span><span class="value" style="color:var(--good)">${rowPct}%</span></div>`
    : "";
  const terrainPct = (preview.terrainShare * 100).toFixed(0);
  const terrainDetail = preview.terrainShare > 0.05
    ? `<div class="stat-mini"><span class="label">Terrain</span><span class="value" style="color:var(--bad)">${terrainPct}%</span></div>`
    : "";
  const landmarkBoostDetail = preview.landmarkBoostPct > 0
    ? `<div class="stat-mini"><span class="label">Landmark boost</span><span class="value" style="color:var(--good)">+${preview.landmarkBoostPct}%</span></div>`
    : "";
  const landmarkPenaltyDetail = preview.landmarkPenaltyPct > 0
    ? `<div class="stat-mini"><span class="label">Airport penalty</span><span class="value" style="color:var(--bad)">+${preview.landmarkPenaltyPct}%</span></div>`
    : "";
  const servedDetail = preview.servedNames.length > 0
    ? `<div class="stat-mini" style="max-width:200px;"><span class="label">Serves</span><span class="value" style="font-size:11px;font-weight:500;line-height:1.3;">${preview.servedNames.slice(0, 4).join(", ")}${preview.servedNames.length > 4 ? "…" : ""}</span></div>`
    : "";
  root.innerHTML = `
    <div class="pending-panel">
      <div class="stat-mini"><span class="label">Stations</span><span class="value">${s.pending.stations.length}</span></div>
      <div class="stat-mini"><span class="label">Length</span><span class="value">${preview.lengthMi.toFixed(1)} mi</span></div>
      <div class="stat-mini"><span class="label">Capital</span><span class="value ${overBudget ? "bad" : ""}">${fmtMoneyM(preview.capitalCostM)}</span></div>
      <div class="stat-mini"><span class="label">Build time</span><span class="value">${preview.estBuildMonths} mo</span></div>
      <div class="stat-mini"><span class="label">Est. riders</span><span class="value">${preview.dailyRiders.toLocaleString()}/d</span></div>
      ${rowDetail}
      ${terrainDetail}
      ${landmarkBoostDetail}
      ${landmarkPenaltyDetail}
      ${servedDetail}
      <label class="opt-toggle ${opts.designBuild ? "active" : ""}">
        <input type="checkbox" id="opt-db" ${opts.designBuild ? "checked" : ""} />
        Design-build
      </label>
      <label class="opt-toggle ${opts.shifts247 ? "active" : ""}">
        <input type="checkbox" id="opt-247" ${opts.shifts247 ? "checked" : ""} />
        24/7 shifts
      </label>
      <button id="pending-cancel">Cancel (Esc)</button>
      <button id="pending-finish" class="primary" ${canFinish ? "" : "disabled"}>Finish line${canFinish ? " (Enter)" : ""}</button>
    </div>
  `;
  document.getElementById("pending-cancel")!.addEventListener("click", () => {
    setState({ pending: null });
  });
  document.getElementById("opt-db")!.addEventListener("change", (e) => {
    if (!s.pending) return;
    setState({ pending: { ...s.pending, opts: { ...s.pending.opts, designBuild: (e.target as HTMLInputElement).checked } } });
  });
  document.getElementById("opt-247")!.addEventListener("change", (e) => {
    if (!s.pending) return;
    setState({ pending: { ...s.pending, opts: { ...s.pending.opts, shifts247: (e.target as HTMLInputElement).checked } } });
  });
  if (canFinish) {
    document.getElementById("pending-finish")!.addEventListener("click", () => {
      const seg = buildSegment(s.pending!.stations, s.selectedMode, s.pending!.opts);
      commitSegment(seg);
    });
  }
}

function renderFundingPanel(s: ReturnType<typeof getState>): void {
  const actions = el<HTMLDivElement>("funding-actions");
  const inflightEl = el<HTMLDivElement>("funding-inflight");
  const flows = previewMonthlyFlows();

  const eligibleRoutes = s.routes.filter((r) => r.status === "construction");
  const cigEligible = eligibleRoutes.filter(
    (r) => !s.events.inflight.find((e) => e.kind === "cig_application" && e.routeId === r.id),
  );
  const tircpEligible = eligibleRoutes.filter(
    (r) => !s.events.inflight.find((e) => e.kind === "tircp_application" && e.routeId === r.id),
  );

  actions.innerHTML = `
    <div class="action-row">
      <span class="label">Federal CIG grant</span>
      <span class="desc">12-month review. Up to 50% reimbursement on cost-effective rail projects.</span>
      <button id="apply-cig" ${cigEligible.length === 0 ? "disabled" : ""}>
        ${cigEligible.length === 0 ? "Need a route in construction" : `Apply (${cigEligible.length} eligible)`}
      </button>
    </div>
    <div class="action-row">
      <span class="label">State TIRCP grant</span>
      <span class="desc">6-month review. Smaller awards but easier approval.</span>
      <button id="apply-tircp" ${tircpEligible.length === 0 ? "disabled" : ""}>
        ${tircpEligible.length === 0 ? "Need a route in construction" : `Apply (${tircpEligible.length} eligible)`}
      </button>
    </div>
    <div class="action-row">
      <span class="label">Issue bonds</span>
      <span class="desc">Cash now, monthly payments for 20 years. Rate scales with approval.</span>
      <button id="issue-bond">Issue bond…</button>
    </div>
    <div class="action-row">
      <span class="label">Monthly recurring</span>
      <span class="desc">
        Sales tax: ${fmtMoneyM(flows.salesTaxM)} ·
        Cap-and-trade: ${fmtMoneyM(flows.capTradeM)} ·
        TOD: ${fmtMoneyM(flows.todM)}<br/>
        Fares: ${fmtMoneyM(flows.fareM)} · Ops cost: −${fmtMoneyM(flows.costM)} · Bonds: −${fmtMoneyM(flows.bondsM)}
      </span>
    </div>
  `;

  document.getElementById("apply-cig")!.addEventListener("click", () => {
    if (cigEligible.length === 0) return;
    // For simplicity: apply on the largest pending project.
    const r = [...cigEligible].sort((a, b) => b.capitalCostM - a.capitalCostM)[0];
    applyForCIG(r.id);
  });
  document.getElementById("apply-tircp")!.addEventListener("click", () => {
    if (tircpEligible.length === 0) return;
    const r = [...tircpEligible].sort((a, b) => b.capitalCostM - a.capitalCostM)[0];
    applyForTIRCP(r.id);
  });
  document.getElementById("issue-bond")!.addEventListener("click", () => {
    openBondModal();
  });

  // In-flight applications + active bonds summary
  const lines: string[] = [];
  for (const e of s.events.inflight) {
    const route = s.routes.find((r) => r.id === e.routeId);
    const label = e.kind === "cig_application" ? "CIG" : "TIRCP";
    const monthsLeft = e.resolutionMonth - (s.routes.length > 0 ? 0 : 0);
    lines.push(`${label} for line ${e.routeId}${route ? ` (${route.mode.toUpperCase()})` : ""}: $${e.awardM}M, decision pending`);
  }
  if (s.bonds.length > 0) {
    const active = s.bonds.filter((b) => b.monthsPaid < b.termMonths);
    if (active.length > 0) {
      const totalDebt = active.reduce((sum, b) => sum + b.monthlyPaymentM, 0);
      lines.push(`Bonds: ${active.length} active, ${fmtMoneyM(totalDebt)}/mo debt service`);
    }
  }
  inflightEl.innerHTML = lines.length === 0
    ? "<em>No applications in flight.</em>"
    : lines.map((l) => `<div>${l}</div>`).join("");
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

  const actionLabel = r.status === "construction" ? "Cancel" : "Shut down";

  // Frequency pills only on operating routes.
  const freq: Frequency = r.frequency ?? "standard";
  const freqPills = r.status === "operating"
    ? `<div class="freq-pills">
         <button data-freq="low"      class="${freq === "low"      ? "active" : ""}" title="Every ${FREQUENCY_MULT.low.minutes} min">Low</button>
         <button data-freq="standard" class="${freq === "standard" ? "active" : ""}" title="Every ${FREQUENCY_MULT.standard.minutes} min">Std</button>
         <button data-freq="high"     class="${freq === "high"     ? "active" : ""}" title="Every ${FREQUENCY_MULT.high.minutes} min">High</button>
       </div>`
    : "";

  row.innerHTML = `
    <span class="swatch" style="background:${colorCss}"></span>
    <div class="meta">
      <div class="name">${m.shortLabel} · Line ${r.id} ${pill}</div>
      <div class="sub">${sub}</div>
      ${freqPills}
    </div>
    <div class="actions"><button data-action="${r.status}" data-id="${r.id}">${actionLabel}</button></div>
  `;

  // Action button (cancel/shutdown).
  const actionBtn = row.querySelector<HTMLButtonElement>("[data-action]")!;
  actionBtn.addEventListener("click", () => {
    if (r.status === "construction") {
      if (confirm(`Cancel ${m.shortLabel} Line ${r.id}? Refund 70% of capital spent.`)) {
        cancelConstruction(r.id);
      }
    } else {
      if (confirm(`Shut down ${m.shortLabel} Line ${r.id}? Big approval hit, no undo.`)) {
        shutdownRoute(r.id);
      }
    }
  });

  // Frequency buttons.
  row.querySelectorAll<HTMLButtonElement>("[data-freq]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const f = btn.dataset.freq as Frequency;
      setRouteFrequency(r.id, f);
    });
  });

  list.appendChild(row);
}

function renderBallotModal(root: HTMLElement, ev: BallotMeasure, currentApproval: number): void {
  // Re-render guard: if this exact event is already showing, leave the
  // existing DOM (and its event listeners) in place. Without this guard,
  // every monthly tick destroys the buttons mid-click.
  const sig = `ballot:${ev.id}`;
  if (root.dataset.modalSig === sig) return;
  root.dataset.modalSig = sig;
  // Pause the clock so the player can read without time pressure.
  setSpeed(0);

  const passLikely = currentApproval >= ev.thresholdPct ? "Likely to pass" : "Risky — current approval is below threshold";
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
  document.getElementById("ballot-decline")!.addEventListener("click", () => resolveEvent(ev.id, "decline"));
  document.getElementById("ballot-accept")!.addEventListener("click", () => resolveEvent(ev.id, "accept"));
}

function renderNIMBYModal(root: HTMLElement, ev: NIMBYEvent): void {
  const sig = `nimby:${ev.id}`;
  if (root.dataset.modalSig === sig) return;
  root.dataset.modalSig = sig;
  setSpeed(0);

  const route = getState().routes.find((r) => r.id === ev.routeId);
  const routeLabel = route ? `Line ${route.id} (${route.mode.toUpperCase()})` : `Route ${ev.routeId}`;
  root.innerHTML = `
    <div class="modal-overlay">
      <div class="modal">
        <h2>Community Opposition — ${routeLabel}</h2>
        <div class="subtitle">Local groups oppose ${routeLabel}'s alignment.</div>
        <p>You can fund a community outreach effort to address concerns, or push through and absorb a delay.</p>
        <div class="stat-row"><span>Outreach cost</span><span class="v">$${ev.outreachCostM}M</span></div>
        <div class="stat-row"><span>Delay if ignored</span><span class="v">${ev.delayMonths} months</span></div>
        <div class="stat-row"><span>Approval hit if ignored</span><span class="v">−${ev.approvalHit.toFixed(1)}</span></div>
        <div class="modal-actions">
          <button class="modal-btn" id="nimby-ignore">Push through</button>
          <button class="modal-btn primary" id="nimby-outreach">Fund outreach</button>
        </div>
      </div>
    </div>
  `;
  document.getElementById("nimby-ignore")!.addEventListener("click", () => resolveEvent(ev.id, "ignore"));
  document.getElementById("nimby-outreach")!.addEventListener("click", () => resolveEvent(ev.id, "outreach"));
}

function openBondModal(): void {
  const s = getState();
  const apr = Math.max(0.025, 0.10 - 0.0009 * s.approvalPct);
  const root = el<HTMLDivElement>("modal-root");
  // Save what's currently in the modal so we can restore after.
  const previousKind = root.dataset.kind ?? "";
  root.dataset.kind = "bond";
  root.innerHTML = `
    <div class="modal-overlay">
      <div class="modal">
        <h2>Issue bond</h2>
        <div class="subtitle">Borrow now, repay over 20 years. Rate: ${(apr * 100).toFixed(2)}% APR (scales with approval).</div>
        <div style="margin: 16px 0;">
          <label style="display: flex; align-items: center; gap: 12px;">
            <span style="font-size: 12px; color: var(--muted); width: 70px;">Principal</span>
            <input type="range" id="bond-slider" min="100" max="3000" step="50" value="500" style="flex: 1;" />
            <span class="v" id="bond-amount" style="font-weight: 700; font-variant-numeric: tabular-nums; min-width: 70px; text-align: right;">$500M</span>
          </label>
        </div>
        <div class="stat-row"><span>Cash now</span><span class="v" id="bond-cash">+$500M</span></div>
        <div class="stat-row"><span>Monthly debt service (20yr)</span><span class="v" id="bond-monthly">−$3.3M/mo</span></div>
        <div class="stat-row"><span>Total repaid</span><span class="v" id="bond-total">$792M</span></div>
        <div class="modal-actions">
          <button class="modal-btn" id="bond-cancel">Cancel</button>
          <button class="modal-btn primary" id="bond-confirm">Issue bond</button>
        </div>
      </div>
    </div>
  `;
  const slider = document.getElementById("bond-slider") as HTMLInputElement;
  const amtEl = document.getElementById("bond-amount")!;
  const cashEl = document.getElementById("bond-cash")!;
  const monEl = document.getElementById("bond-monthly")!;
  const totEl = document.getElementById("bond-total")!;

  function update() {
    const p = Number(slider.value);
    const r = apr / 12;
    const n = 240;
    const monthly = (p * r) / (1 - Math.pow(1 + r, -n));
    const total = monthly * n;
    amtEl.textContent = `$${p}M`;
    cashEl.textContent = `+$${p}M`;
    monEl.textContent = `−$${monthly.toFixed(1)}M/mo`;
    totEl.textContent = `$${total.toFixed(0)}M`;
  }
  slider.addEventListener("input", update);
  update();

  document.getElementById("bond-cancel")!.addEventListener("click", () => {
    root.innerHTML = "";
    root.dataset.kind = previousKind;
  });
  document.getElementById("bond-confirm")!.addEventListener("click", () => {
    const p = Number(slider.value);
    issueBond(p);
    root.innerHTML = "";
    root.dataset.kind = previousKind;
  });
}

function renderScenarioPicker(root: HTMLElement): void {
  // Don't re-render if already shown.
  if (root.dataset.kind === "scenario") return;
  root.dataset.kind = "scenario";

  setSpeed(0); // freeze the clock until they pick

  const cards = SCENARIOS.map((sc) => `
    <button class="modal-btn scenario-card" data-id="${sc.id}" style="
      display: block; width: 100%; text-align: left; margin-bottom: 8px;
      padding: 10px 12px; background: var(--panel-2); border: 1px solid var(--border);
      cursor: pointer; border-radius: 6px;">
      <div style="font-weight: 700; font-size: 14px; color: var(--text);">${sc.label}</div>
      <div style="font-size: 12px; color: var(--muted); margin-top: 4px; line-height: 1.4;">${sc.description}</div>
      <div style="font-size: 11px; color: var(--accent); margin-top: 6px;">
        Goal: ${sc.ridershipTarget.toLocaleString()} riders by Jan ${sc.deadlineYear}
        · Start capital: $${(sc.startCapitalM / 1000).toFixed(2)}B
      </div>
      <div style="font-size: 11px; color: var(--muted); margin-top: 4px; font-style: italic;">${sc.hint}</div>
    </button>
  `).join("");

  root.innerHTML = `
    <div class="modal-overlay">
      <div class="modal" style="max-width: 600px;">
        <h2>Pick a scenario</h2>
        <div class="subtitle">Each scenario sets your starting budget, deadline, and ridership target. You can always change strategy mid-game.</div>
        ${cards}
      </div>
    </div>
  `;

  root.querySelectorAll<HTMLButtonElement>(".scenario-card").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.id!;
      applyScenario(id);
      saveScenarioId(id);
      root.dataset.kind = "";
    });
  });
}

function applyScenario(id: string): void {
  const sc = SCENARIOS.find((s) => s.id === id);
  if (!sc) return;
  setState({
    capitalBudgetM: sc.startCapitalM,
    operatingBudgetM: sc.startOperatingM,
    approvalPct: sc.startApproval,
    ridershipTarget: sc.ridershipTarget,
    deadlineYear: sc.deadlineYear,
    scenarioId: sc.id,
    scenarioPicked: true,
  });
}

function renderEndModal(root: HTMLElement, outcome: GameOutcome, riders: number): void {
  if (root.dataset.outcome === outcome) return;
  root.dataset.outcome = outcome;

  const titles: Record<GameOutcome, string> = {
    lost_approval: "Approval collapsed",
    lost_bankrupt: "Bankrupt",
  };
  const subs: Record<GameOutcome, string> = {
    lost_approval: "Voters lost faith in the agency. Your tenure ends.",
    lost_bankrupt: "Six months of negative operating budget. The state takes over.",
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
  document.getElementById("restart-btn")!.addEventListener("click", () => location.reload());
}

function openMenuModal(): void {
  const root = el<HTMLDivElement>("modal-root");
  const previousKind = root.dataset.kind ?? "";
  root.dataset.kind = "menu";

  const slots = listSlots();

  function fmtSlot(s: ReturnType<typeof listSlots>[number]): string {
    if (!s.exists) return `<em style="color:var(--muted)">empty</em>`;
    const dateStr = s.date ? `${MONTH_LABELS_SHORT[s.date.month]} ${s.date.year}` : "";
    const sc = s.scenarioId ? ` · ${s.scenarioId}` : "";
    return `${dateStr}${sc} · ${s.dailyRiders?.toLocaleString() ?? 0} riders · ${s.routeCount ?? 0} lines`;
  }

  const slotsHtml = slots.map((s) => `
    <div class="stat-row" style="align-items:center;gap:6px;">
      <span style="min-width:80px;font-weight:600;">${s.id === "auto" ? "Autosave" : `Slot ${s.id}`}</span>
      <span class="v" style="flex:1;font-size:11px;font-weight:500;color:var(--muted);">${fmtSlot(s)}</span>
      <button class="modal-btn" data-action="save" data-slot="${s.id}" ${s.id === "auto" ? "" : ""} style="padding:3px 8px;font-size:11px;">Save</button>
      <button class="modal-btn ${s.exists ? "primary" : ""}" data-action="load" data-slot="${s.id}" ${s.exists ? "" : "disabled"} style="padding:3px 8px;font-size:11px;">Load</button>
      <button class="modal-btn" data-action="delete" data-slot="${s.id}" ${s.exists ? "" : "disabled"} style="padding:3px 8px;font-size:11px;color:var(--bad);">×</button>
    </div>
  `).join("");

  root.innerHTML = `
    <div class="modal-overlay">
      <div class="modal" style="max-width: 560px;">
        <h2>Game menu</h2>
        <div class="subtitle">Save slots persist in your browser. Autosave runs every sim-year.</div>
        ${slotsHtml}
        <div class="modal-actions" style="justify-content:space-between;">
          <button class="modal-btn" id="menu-newgame" style="color:var(--bad);border-color:var(--bad);">New game (lose progress)</button>
          <button class="modal-btn primary" id="menu-close">Back to game</button>
        </div>
      </div>
    </div>
  `;

  root.querySelectorAll<HTMLButtonElement>("[data-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const action = btn.dataset.action!;
      const slot = btn.dataset.slot as SlotId;
      if (action === "save") {
        const ok = saveToSlot(slot);
        flashUiToast(ok ? `Saved to ${slot === "auto" ? "autosave" : `slot ${slot}`}.` : "Save failed.", ok);
        openMenuModal(); // re-render
      } else if (action === "load") {
        const ok = loadFromSlot(slot);
        if (ok) {
          flashUiToast(`Loaded ${slot === "auto" ? "autosave" : `slot ${slot}`}.`, true);
          root.innerHTML = "";
          root.dataset.kind = "";
        } else {
          flashUiToast("Load failed.", false);
        }
      } else if (action === "delete") {
        if (confirm(`Delete ${slot === "auto" ? "autosave" : `slot ${slot}`}?`)) {
          deleteSlot(slot);
          openMenuModal(); // re-render
        }
      }
    });
  });

  document.getElementById("menu-newgame")!.addEventListener("click", () => {
    if (confirm("Start a new game? Current progress will be lost (unless saved).")) {
      // Reset by reloading + clearing scenarioPicked from any saved scenario.
      try {
        // Don't actually clear localStorage saves — just trigger scenario picker.
        // Reload state to defaults.
        location.reload();
      } catch {
        location.reload();
      }
    }
  });
  document.getElementById("menu-close")!.addEventListener("click", () => {
    root.innerHTML = "";
    root.dataset.kind = previousKind;
  });
}

const MONTH_LABELS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

let uiToastTimer: number | null = null;
function flashUiToast(msg: string, good: boolean): void {
  let elNode = document.getElementById("ui-toast");
  if (!elNode) {
    elNode = document.createElement("div");
    elNode.id = "ui-toast";
    elNode.style.cssText = `
      position: absolute; bottom: 80px; left: 50%; transform: translateX(-50%);
      color: white; padding: 8px 14px; border-radius: 6px; font-size: 12px;
      font-weight: 600; z-index: 200; box-shadow: 0 4px 16px rgba(0,0,0,0.5);
      transition: opacity 0.3s;
    `;
    document.body.appendChild(elNode);
  }
  elNode.style.background = good ? "rgba(63, 185, 80, 0.95)" : "rgba(248, 81, 73, 0.95)";
  elNode.textContent = msg;
  elNode.style.opacity = "1";
  if (uiToastTimer !== null) clearTimeout(uiToastTimer);
  uiToastTimer = setTimeout(() => {
    if (elNode) elNode.style.opacity = "0";
  }, 1800) as unknown as number;
}

let toastTimer: number | null = null;
function renderToast(milestone: "won" | "missed_deadline"): void {
  const root = el<HTMLDivElement>("toast-root");
  const isGood = milestone === "won";
  const text = isGood
    ? `🎉 You hit ${getState().ridershipTarget.toLocaleString()} daily riders! Goal achieved — keep going for fun.`
    : `${getState().deadlineYear} arrived without hitting the goal. Sandbox continues — no game over.`;
  root.innerHTML = `<div class="toast ${isGood ? "" : "bad"}">${text}</div>`;
  if (toastTimer !== null) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    root.innerHTML = "";
    clearMilestoneToast();
  }, 6000) as unknown as number;
}
