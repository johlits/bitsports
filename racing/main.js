import { RacingEngine } from "./engine.js";
import { allAIs } from "./ais/registry.js";

const DRIVER_COLORS = ["#38bdf8", "#f97316", "#22c55e", "#e879f9"];

const ui = document.getElementById("ui");
const uiToggle = document.getElementById("ui-toggle");
const driverSelectsEl = document.getElementById("driver-selects");
const lapCountInput = document.getElementById("lap-count");
const matchTimeInput = document.getElementById("match-time");
const driverCountInput = document.getElementById("driver-count");
const startBtn = document.getElementById("start-btn");
const timerEl = document.getElementById("timer");
const scoreboardEl = document.getElementById("scoreboard");
const container = document.getElementById("canvas-container");
const cinematicCountdown = document.getElementById("cinematic-countdown");
const cinematicStandings = document.getElementById("cinematic-standings");
const victoryOverlay = document.getElementById("victory-overlay");
const victoryWinner = document.getElementById("victory-winner");
const victoryList = document.getElementById("victory-list");
const victoryPlayAgain = document.getElementById("victory-play-again");
const victoryClose = document.getElementById("victory-close");

let engine = null;
let driverSelects = [];
let cinematicMode = false;
let countdownInterval = null;

function formatTime(seconds) {
  const whole = Math.floor(seconds);
  const m = Math.floor(whole / 60);
  const s = whole % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function getAIById(id) {
  return allAIs.find((ai) => ai.id === id) ?? allAIs[0];
}

function populateDriverSelects() {
  const count = Math.max(1, Math.min(4, Number(driverCountInput.value) || 4));
  driverSelectsEl.innerHTML = "";
  driverSelects = [];
  for (let i = 0; i < count; i++) {
    const row = document.createElement("div");
    row.className = "driver-row";

    const dot = document.createElement("div");
    dot.className = "driver-color";
    dot.style.background = DRIVER_COLORS[i % DRIVER_COLORS.length];

    const select = document.createElement("select");
    allAIs.forEach((ai) => {
      const opt = document.createElement("option");
      opt.value = ai.id;
      opt.textContent = ai.name;
      select.appendChild(opt);
    });
    select.value = allAIs[i % allAIs.length].id;

    row.appendChild(dot);
    row.appendChild(select);
    driverSelectsEl.appendChild(row);
    driverSelects.push(select);
  }
}

function renderScoreboard(karts = []) {
  scoreboardEl.innerHTML = karts
    .slice()
    .sort((a, b) => a.place - b.place)
    .map((kart) => `
      <div class="score-row">
        <div class="driver-color" style="background:${kart.colorHex}; width:14px; height:14px;"></div>
        <div>${kart.place}. ${kart.name}</div>
        <div class="pill">Lap ${Math.min(kart.lap + 1, kart.maxLaps)}/${kart.maxLaps}</div>
        <div class="pill">${kart.item ?? "-"}</div>
      </div>
    `)
    .join("");

  cinematicStandings.innerHTML = karts
    .slice()
    .sort((a, b) => a.place - b.place)
    .map((kart) => `
      <div class="cin-row" style="color:${kart.colorHex}">
        <span>${kart.place}.</span>
        <span>●</span>
        <span>${kart.name}</span>
      </div>
    `)
    .join("");
}

function hideVictory() {
  victoryOverlay.classList.remove("active");
}

function showVictory(result) {
  const winner = result.winner;
  victoryWinner.innerHTML = `<strong style="color:${winner.colorHex}">${winner.name}</strong> wins the race.`;
  victoryList.innerHTML = result.standings
    .map((kart, index) => `
      <div class="victory-row">
        <span>#${index + 1}</span>
        <span style="color:${kart.colorHex}">●</span>
        <span>${kart.name}</span>
        <span>Lap ${Math.min(kart.lap + 1, kart.maxLaps)}/${kart.maxLaps}</span>
      </div>
    `)
    .join("");
  victoryOverlay.classList.add("active");
}

function buildEngine() {
  const driverAIs = driverSelects.map((select) => getAIById(select.value));
  const lapCount = Math.max(1, Math.min(999, Number(lapCountInput.value) || 3));

  if (!engine) {
    engine = new RacingEngine({
      container,
      driverAIs,
      lapCount,
      onTick: (timeElapsed, karts) => {
        timerEl.textContent = formatTime(timeElapsed);
        renderScoreboard(karts);
      },
      onRaceEnd: (result) => {
        renderScoreboard(result.standings);
        showVictory(result);
      },
    });
  } else {
    engine.setDriverAIs(driverAIs);
    engine.setMatchConfig({ lapCount });
  }

  timerEl.textContent = formatTime(0);
  renderScoreboard(engine.karts.map((k) => engine._publicKartState(k)));
  return engine;
}

function resetAndStartRace() {
  hideVictory();
  const eng = buildEngine();
  eng.start();
  if (cinematicMode) eng.setCinematicMode(true);
}

function clearCountdown() {
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
  cinematicCountdown.classList.remove("active");
  cinematicCountdown.textContent = "";
}

function startCountdown() {
  let count = 15;
  cinematicCountdown.textContent = count;
  cinematicCountdown.classList.add("active");
  countdownInterval = setInterval(() => {
    count -= 1;
    if (count > 0) {
      cinematicCountdown.textContent = count;
    } else {
      clearCountdown();
      resetAndStartRace();
    }
  }, 1000);
}

uiToggle.addEventListener("click", () => {
  const collapsed = ui.classList.toggle("collapsed");
  uiToggle.textContent = collapsed ? "Show" : "Hide";
});

startBtn.addEventListener("click", resetAndStartRace);
victoryPlayAgain.addEventListener("click", resetAndStartRace);
victoryClose.addEventListener("click", hideVictory);

document.addEventListener("keydown", (e) => {
  if (e.key !== "c" && e.key !== "C") return;
  cinematicMode = !cinematicMode;
  document.body.classList.toggle("cinematic-mode", cinematicMode);
  if (cinematicMode) {
    startCountdown();
  } else {
    clearCountdown();
  }
  if (engine) engine.setCinematicMode(cinematicMode);
});

driverCountInput.addEventListener("change", populateDriverSelects);

populateDriverSelects();
buildEngine();
