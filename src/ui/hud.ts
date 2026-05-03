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
import {
  resolveEvent,
  applyForCIG,
  applyForTIRCP,
  issueBond,
  type BallotMeasure,
  type NIMBYEvent,
  type CIGApplication,
  type TIRCPApplication,
} from "../sim/events";
import { previewMonthlyFlows } from "../sim/tick";
import {
  RIDERSHIP_TARGET,
  GOAL_DEADLINE_YEAR,
  clearMilestoneToast,
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
      ? `🏗 ${cc} · California Transit Builder — v0.7`
      : "California Transit Builder — v0.7 (Los Angeles)";

    // Goal bar — once hit, show "DONE" styling.
    const riders = totalDailyRiders();
    const pct = Math.min(100, (riders / RIDERSHIP_TARGET) * 100);
    el<HTMLDivElement>("goal-bar-fill").style.width = `${pct.toFixed(1)}%`;
    const labelText = s.goal.hitTarget
      ? `<span class="target">${riders.toLocaleString()}</span> riders ✓ Goal achieved (sandbox mode)`
      : `<span class="target">${riders.toLocaleString()}</span> / ${RIDERSHIP_TARGET.toLocaleString()} riders by Jan ${GOAL_DEADLINE_YEAR}`;
    el("goal-label").innerHTML = labelText;

    // Pending route panel
    renderPendingPanel(s);

    // Funding panel
    renderFundingPanel(s);

    // Modal: only for HARD game-over outcomes (lost_approval, lost_bankrupt).
    const modalRoot = el<HTMLDivElement>("modal-root");
    if (s.goal.outcome) {
      renderEndModal(modalRoot, s.goal.outcome, riders);
    } else if (s.events.pending.length > 0) {
      const ev = s.events.pending[0];
      if (ev.kind === "ballot_measure") renderBallotModal(modalRoot, ev, s.approvalPct);
      else if (ev.kind === "nimby") renderNIMBYModal(modalRoot, ev);
      else modalRoot.innerHTML = "";
    } else {
      modalRoot.innerHTML = "";
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
  const preview = previewRoute(s.pending.stations, s.selectedMode);
  const canFinish = s.pending.stations.length >= 2;
  const overBudget = preview.capitalCostM > s.capitalBudgetM;
  root.innerHTML = `
    <div class="pending-panel">
      <div class="stat-mini"><span class="label">Stations</span><span class="value">${s.pending.stations.length}</span></div>
      <div class="stat-mini"><span class="label">Length</span><span class="value">${preview.lengthMi.toFixed(1)} mi</span></div>
      <div class="stat-mini"><span class="label">Capital</span><span class="value ${overBudget ? "bad" : ""}">${fmtMoneyM(preview.capitalCostM)}</span></div>
      <div class="stat-mini"><span class="label">Build time</span><span class="value">${preview.estBuildMonths} mo</span></div>
      <button id="pending-cancel">Cancel (Esc)</button>
      <button id="pending-finish" class="primary" ${canFinish ? "" : "disabled"}>Finish line${canFinish ? " (Enter)" : ""}</button>
    </div>
  `;
  document.getElementById("pending-cancel")!.addEventListener("click", () => {
    setState({ pending: null });
  });
  if (canFinish) {
    document.getElementById("pending-finish")!.addEventListener("click", () => {
      const seg = buildSegment(s.pending!.stations, s.selectedMode);
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
    const ans = prompt("Issue bond — principal in millions USD (e.g., 500):", "500");
    if (!ans) return;
    const v = Number(ans);
    if (!Number.isFinite(v) || v <= 0) return;
    issueBond(v);
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
  row.innerHTML = `
    <span class="swatch" style="background:${colorCss}"></span>
    <div class="meta">
      <div class="name">${m.shortLabel} · Line ${r.id} ${pill}</div>
      <div class="sub">${sub}</div>
    </div>
    <div class="actions"><button data-action="${r.status}" data-id="${r.id}">${actionLabel}</button></div>
  `;
  const btn = row.querySelector("button")!;
  btn.addEventListener("click", () => {
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
  list.appendChild(row);
}

function renderBallotModal(root: HTMLElement, ev: BallotMeasure, currentApproval: number): void {
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

let toastTimer: number | null = null;
function renderToast(milestone: "won" | "missed_deadline"): void {
  const root = el<HTMLDivElement>("toast-root");
  const isGood = milestone === "won";
  const text = isGood
    ? `🎉 You hit ${RIDERSHIP_TARGET.toLocaleString()} daily riders! Goal achieved — keep going for fun.`
    : `${GOAL_DEADLINE_YEAR} arrived without hitting the goal. Sandbox continues — no game over.`;
  root.innerHTML = `<div class="toast ${isGood ? "" : "bad"}">${text}</div>`;
  if (toastTimer !== null) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    root.innerHTML = "";
    clearMilestoneToast();
  }, 6000) as unknown as number;
}
