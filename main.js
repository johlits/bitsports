import { AirHockeyEngine } from "./engine.js";
import { allAIs } from "./ais/registry.js";

const ui = document.getElementById("ui");
const uiToggle = document.getElementById("ui-toggle");
const blueSelect = document.getElementById("blue-ai");
const redSelect = document.getElementById("red-ai");
const startBtn = document.getElementById("start-btn");
const scoreEl = document.getElementById("score");
const container = document.getElementById("canvas-container");

let engine = null;

// Create engine immediately to show board preview
engine = new AirHockeyEngine({
  container,
  onScore: (blue, red) => {
    scoreEl.innerHTML = `<span class="score-blue">Blue ${blue}</span><span class="score-sep">:</span><span class="score-red">${red} Red</span>`;
  },
  blueAI: allAIs[0],
  redAI: allAIs[0],
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

  engine.start();
});
