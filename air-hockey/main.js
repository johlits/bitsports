import { AirHockeyEngine } from "./engine.js";
import { allAIs } from "./ais/registry.js";

const ui = document.getElementById("ui");
const uiToggle = document.getElementById("ui-toggle");
const blueSelect = document.getElementById("blue-ai");
const redSelect = document.getElementById("red-ai");
const startBtn = document.getElementById("start-btn");
const scoreEl = document.getElementById("score");
const container = document.getElementById("canvas-container");

// Cinematic mode elements
const cinematicBlueName = document.getElementById("cinematic-blue-name");
const cinematicRedName = document.getElementById("cinematic-red-name");
const cinematicBlueScore = document.getElementById("cinematic-blue-score");
const cinematicRedScore = document.getElementById("cinematic-red-score");
const cinematicCountdown = document.getElementById("cinematic-countdown");

let engine = null;
let cinematicMode = false;
let countdownInterval = null;

// Toggle cinematic mode with 'c' key
document.addEventListener("keydown", (e) => {
  if (e.key === "c" || e.key === "C") {
    if (!cinematicMode) {
      // Enter cinematic mode with countdown
      cinematicMode = true;
      document.body.classList.add("cinematic-mode");
      updateCinematicOverlay();
      startCountdown();
    } else {
      // Exit cinematic mode
      cinematicMode = false;
      document.body.classList.remove("cinematic-mode");
      clearCountdown();
    }
  }
});

function startCountdown() {
  let count = 30;
  cinematicCountdown.textContent = count;
  cinematicCountdown.classList.add("active");
  
  countdownInterval = setInterval(() => {
    count--;
    if (count > 0) {
      cinematicCountdown.textContent = count;
    } else {
      // Countdown finished - reset and start game
      clearCountdown();
      resetAndStartGame();
    }
  }, 1000);
}

function clearCountdown() {
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
  cinematicCountdown.classList.remove("active");
  cinematicCountdown.textContent = "";
}

function resetAndStartGame() {
  if (engine) {
    engine.stop();
  }
  
  // Reset scores
  engine.blueScore = 0;
  engine.redScore = 0;
  
  // Update displays
  scoreEl.innerHTML = `<span class="score-blue">Blue 0</span><span class="score-sep">:</span><span class="score-red">0 Red</span>`;
  cinematicBlueScore.textContent = "0";
  cinematicRedScore.textContent = "0";
  
  // Start the game
  engine.start();
}

function updateCinematicOverlay() {
  if (engine) {
    cinematicBlueName.textContent = engine.blueAI?.name || "Blue AI";
    cinematicRedName.textContent = engine.redAI?.name || "Red AI";
    cinematicBlueScore.textContent = engine.blueScore;
    cinematicRedScore.textContent = engine.redScore;
  }
}

// Create engine immediately to show board preview
engine = new AirHockeyEngine({
  container,
  onScore: (blue, red) => {
    scoreEl.innerHTML = `<span class="score-blue">Blue ${blue}</span><span class="score-sep">:</span><span class="score-red">${red} Red</span>`;
    // Update cinematic overlay
    cinematicBlueScore.textContent = blue;
    cinematicRedScore.textContent = red;
  },
  blueAI: allAIs[0],
  redAI: allAIs[1] || allAIs[0],
});

function populateAISelect(select) {
  allAIs.forEach((ai, index) => {
    const opt = document.createElement("option");
    opt.value = ai.id || String(index);
    opt.textContent = ai.name || ai.id || `AI ${index + 1}`;
    select.appendChild(opt);
  });
}

populateAISelect(blueSelect);
populateAISelect(redSelect);

// Select first AI for blue, second for red
blueSelect.selectedIndex = 0;
redSelect.selectedIndex = allAIs.length > 1 ? 1 : 0;

// UI collapse / expand for mobile
if (ui && uiToggle) {
  uiToggle.addEventListener("click", () => {
    const collapsed = ui.classList.toggle("collapsed");
    uiToggle.textContent = collapsed ? "Show" : "Hide";
  });
}

function getAIById(id) {
  return allAIs.find((ai) => ai.id === id) || allAIs[0];
}

startBtn.addEventListener("click", () => {
  const blueId = blueSelect.value;
  const redId = redSelect.value;

  const blueAI = getAIById(blueId);
  const redAI = getAIById(redId);

  if (engine) {
    engine.stop();
  }

  // Reset score display
  scoreEl.innerHTML = `<span class="score-blue">Blue 0</span><span class="score-sep">:</span><span class="score-red">0 Red</span>`;

  // Update AIs and reset scores
  engine.blueAI = blueAI;
  engine.redAI = redAI;
  engine.blueScore = 0;
  engine.redScore = 0;

  // Update cinematic overlay with new AI names and reset scores
  cinematicBlueName.textContent = blueAI.name || "Blue AI";
  cinematicRedName.textContent = redAI.name || "Red AI";
  cinematicBlueScore.textContent = "0";
  cinematicRedScore.textContent = "0";

  engine.start();
});
