import { SneakEngine } from "./engine.js";
import { allAIs } from "./ais/registry.js";

const ui = document.getElementById("ui");
const uiToggle = document.getElementById("ui-toggle");
const startBtn = document.getElementById("start-btn");
const timerEl = document.getElementById("timer");
const scoreGuardsEl = document.getElementById("score-guards");
const scoreInfilEl = document.getElementById("score-infil");
const eventsEl = document.getElementById("events");
const matchTimeInput = document.getElementById("match-time");
const goldCountInput = document.getElementById("gold-count");
const guardCountInput = document.getElementById("guard-count");
const infilCountInput = document.getElementById("infil-count");
const guardsEl = document.getElementById("guards");
const infiltratorsEl = document.getElementById("infiltrators");
const container = document.getElementById("canvas-container");

let engine = null;
let guardSelects = [];
let infilSelects = [];

function formatTime(seconds) {
  const s = Math.max(0, seconds);
  const mins = Math.floor(s / 60);
  const secs = Math.floor(s % 60);
  return mins > 0 ? `${mins}:${secs.toString().padStart(2, "0")}` : `${secs}`;
}

function populateSelect(select) {
  select.innerHTML = "";
  allAIs.forEach((ai, index) => {
    const opt = document.createElement("option");
    opt.value = ai.id || String(index);
    opt.textContent = ai.name || ai.id || `AI ${index + 1}`;
    select.appendChild(opt);
  });
}

function getAIById(id) {
  return allAIs.find((ai) => ai.id === id) || allAIs[0];
}

function createTeamSelects(rootEl, count, colorHex, defaultAIId) {
  rootEl.innerHTML = "";
  const selects = [];

  for (let i = 0; i < count; i++) {
    const row = document.createElement("div");
    row.className = "agent-select";

    const pill = document.createElement("div");
    pill.className = "agent-pill";
    pill.style.backgroundColor = colorHex;

    const select = document.createElement("select");
    populateSelect(select);

    // Set default AI by ID
    const defaultIdx = allAIs.findIndex(ai => ai.id === defaultAIId);
    if (defaultIdx >= 0) {
      select.selectedIndex = defaultIdx;
    }

    row.appendChild(pill);
    row.appendChild(select);
    rootEl.appendChild(row);

    selects.push(select);
  }

  return selects;
}

function rebuildSelects() {
  const guardCount = Math.max(1, Math.min(6, parseInt(guardCountInput.value) || 2));
  const infilCount = Math.max(1, Math.min(6, parseInt(infilCountInput.value) || 2));
  guardCountInput.value = String(guardCount);
  infilCountInput.value = String(infilCount);

  guardSelects = createTeamSelects(guardsEl, guardCount, "#38bdf8", "claude-opus-guard");
  infilSelects = createTeamSelects(infiltratorsEl, infilCount, "#f97373", "claude-opus-infil");
}

rebuildSelects();

guardCountInput.addEventListener("change", rebuildSelects);
infilCountInput.addEventListener("change", rebuildSelects);

if (ui && uiToggle) {
  uiToggle.addEventListener("click", () => {
    const collapsed = ui.classList.toggle("collapsed");
    uiToggle.textContent = collapsed ? "Show" : "Hide";
  });
}

engine = new SneakEngine({
  container,
  onTick: ({ timeRemaining, scoreGuards, scoreInfiltrators, lastEvent }) => {
    timerEl.textContent = formatTime(timeRemaining);
    scoreGuardsEl.textContent = String(scoreGuards);
    scoreInfilEl.textContent = String(scoreInfiltrators);
    eventsEl.textContent = lastEvent || "-";
  },
  onGameEnd: ({ scoreGuards, scoreInfiltrators }) => {
    timerEl.textContent = "GAME OVER";
    scoreGuardsEl.textContent = String(scoreGuards);
    scoreInfilEl.textContent = String(scoreInfiltrators);
  },
  guardAIs: [allAIs[0]],
  infiltratorAIs: [allAIs[0]],
  matchTime: 120,
});

window.sneak = engine;

startBtn.addEventListener("click", () => {
  const matchTime = Math.max(20, Math.min(600, parseInt(matchTimeInput.value) || 120));
  matchTimeInput.value = String(matchTime);

  const goldCount = Math.max(1, Math.min(10, parseInt(goldCountInput.value) || 5));
  goldCountInput.value = String(goldCount);

  const guardAIs = guardSelects.map((s) => getAIById(s.value));
  const infiltratorAIs = infilSelects.map((s) => getAIById(s.value));

  if (engine) {
    engine.stop();
  }

  timerEl.textContent = formatTime(matchTime);
  scoreGuardsEl.textContent = "0";
  scoreInfilEl.textContent = "0";
  eventsEl.textContent = "-";

  engine.setTeams({ guardAIs, infiltratorAIs });
  engine.setMatchTime(matchTime);
  engine.setGoldCount(goldCount);
  engine.start();
});
