import { PaintEngine } from "./engine.js";
import { allAIs } from "./ais/registry.js";

const ui = document.getElementById("ui");
const uiToggle = document.getElementById("ui-toggle");
const startBtn = document.getElementById("start-btn");
const timerEl = document.getElementById("timer");
const scoreboardEl = document.getElementById("scoreboard");
const playerSelectsEl = document.getElementById("player-selects");
const matchTimeInput = document.getElementById("match-time");
const playerCountInput = document.getElementById("player-count");
const container = document.getElementById("canvas-container");

// Cinematic mode elements
const cinematicCountdown = document.getElementById("cinematic-countdown");

// Victory screen elements
const victoryOverlay = document.getElementById("victory-overlay");
const victoryWinner = document.getElementById("victory-winner");
const victoryList = document.getElementById("victory-list");
const victoryPlayAgain = document.getElementById("victory-play-again");
const victoryClose = document.getElementById("victory-close");

let engine = null;
let playerSelects = [];
let cinematicMode = false;
let countdownInterval = null;

// Toggle cinematic mode with 'c' key
document.addEventListener("keydown", (e) => {
  if (e.key === "c" || e.key === "C") {
    if (!cinematicMode) {
      // Enter cinematic mode with countdown
      cinematicMode = true;
      document.body.classList.add("cinematic-mode");
      if (engine) {
        engine.setCinematicMode(true);
      }
      startCountdown();
    } else {
      // Exit cinematic mode
      cinematicMode = false;
      document.body.classList.remove("cinematic-mode");
      if (engine) {
        engine.setCinematicMode(false);
      }
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
  if (!engine) return;
  
  // Hide victory screen if visible
  victoryOverlay.classList.remove("active");
  
  const matchTime = Math.max(10, Math.min(300, parseInt(matchTimeInput.value) || 60));
  const selectedAIs = playerSelects.map((select) => getAIById(select.value));
  
  engine.stop();
  timerEl.textContent = formatTime(matchTime);
  scoreboardEl.innerHTML = "";
  
  engine.setPlayerAIs(selectedAIs);
  engine.setMatchTime(matchTime);
  engine.start();
  
  // Preserve cinematic mode state
  if (cinematicMode) {
    engine.setCinematicMode(true);
  }
}

function showVictoryScreen(players, winner) {
  // Set winner text
  const winnerName = winner.ai?.name || `Player ${winner.id}`;
  victoryWinner.innerHTML = `<span class="winner-name">${winnerName}</span> wins with <span class="winner-score">${winner.score}</span> tiles!`;
  
  // Sort players by score
  const sorted = [...players].sort((a, b) => b.score - a.score);
  
  // Build standings list
  victoryList.innerHTML = sorted.map((p, i) => {
    const rankClass = i === 0 ? "gold" : i === 1 ? "silver" : i === 2 ? "bronze" : "";
    const name = p.ai?.name || `Player ${p.id}`;
    return `
      <div class="victory-row">
        <span class="victory-rank ${rankClass}">#${i + 1}</span>
        <div class="victory-color" style="background-color: ${p.colorHex}"></div>
        <span class="victory-name">${name}</span>
        <span class="victory-score">${p.score}</span>
      </div>
    `;
  }).join("");
  
  // Show overlay
  victoryOverlay.classList.add("active");
}

// Victory screen button handlers
victoryPlayAgain.addEventListener("click", () => {
  victoryOverlay.classList.remove("active");
  resetAndStartGame();
});

victoryClose.addEventListener("click", () => {
  victoryOverlay.classList.remove("active");
});

// Player colors matching engine
const PLAYER_COLORS = [
  "#38bdf8", // Blue
  "#f97373", // Red
  "#4ade80", // Green
  "#fbbf24", // Yellow
  "#a78bfa", // Purple
  "#fb7185", // Pink
  "#2dd4bf", // Teal
  "#fb923c", // Orange
];

function createPlayerSelects(count) {
  playerSelectsEl.innerHTML = "";
  playerSelects = [];

  for (let i = 0; i < count; i++) {
    const row = document.createElement("div");
    row.className = "player-row";

    const colorIndicator = document.createElement("div");
    colorIndicator.className = "player-color";
    colorIndicator.style.backgroundColor = PLAYER_COLORS[i % PLAYER_COLORS.length];

    const select = document.createElement("select");
    select.id = `player-${i}-ai`;

    allAIs.forEach((ai, index) => {
      const opt = document.createElement("option");
      opt.value = ai.id || String(index);
      opt.textContent = ai.name || ai.id || `AI ${index + 1}`;
      select.appendChild(opt);
    });

    // Set different default AIs for variety
    if (allAIs.length > 1) {
      select.selectedIndex = i % allAIs.length;
    }

    row.appendChild(colorIndicator);
    row.appendChild(select);
    playerSelectsEl.appendChild(row);
    playerSelects.push(select);
  }
}

function getAIById(id) {
  return allAIs.find((ai) => ai.id === id) || allAIs[0];
}

function updateScoreboard(players) {
  if (!players || players.length === 0) {
    scoreboardEl.innerHTML = "";
    return;
  }

  // Sort by score descending
  const sorted = [...players].sort((a, b) => b.score - a.score);

  scoreboardEl.innerHTML = sorted
    .map(
      (p, i) => `
    <div class="score-row">
      <div class="player-indicator" style="background-color: ${p.colorHex}"></div>
      <span class="player-name">${p.ai?.name || `Player ${p.id}`}</span>
      <span class="player-score">${p.score}</span>
    </div>
  `
    )
    .join("");
}

function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return mins > 0 ? `${mins}:${secs.toString().padStart(2, "0")}` : `${secs}`;
}

// Initialize with default player count
createPlayerSelects(parseInt(playerCountInput.value));

// Update player selects when count changes
playerCountInput.addEventListener("change", () => {
  const count = Math.max(2, Math.min(8, parseInt(playerCountInput.value) || 4));
  playerCountInput.value = count;
  createPlayerSelects(count);
});

// UI collapse / expand
if (ui && uiToggle) {
  uiToggle.addEventListener("click", () => {
    const collapsed = ui.classList.toggle("collapsed");
    uiToggle.textContent = collapsed ? "Show" : "Hide";
  });
}

// Create initial engine for preview
engine = new PaintEngine({
  container,
  onTick: (time, players) => {
    timerEl.textContent = formatTime(time);
    updateScoreboard(players);
  },
  onGameEnd: (players, winner) => {
    timerEl.textContent = "GAME OVER";
    updateScoreboard(players);
    showVictoryScreen(players, winner);
  },
  playerAIs: allAIs.slice(0, 3),
  matchTime: 60,
});

startBtn.addEventListener("click", () => {
  // Hide victory screen if visible
  victoryOverlay.classList.remove("active");
  
  const matchTime = Math.max(10, Math.min(300, parseInt(matchTimeInput.value) || 60));
  matchTimeInput.value = matchTime;

  const selectedAIs = playerSelects.map((select) => getAIById(select.value));

  if (engine) {
    engine.stop();
  }

  // Reset UI
  timerEl.textContent = formatTime(matchTime);
  scoreboardEl.innerHTML = "";

  engine.setPlayerAIs(selectedAIs);
  engine.setMatchTime(matchTime);
  engine.start();
  
  // Preserve cinematic mode state
  if (cinematicMode) {
    engine.setCinematicMode(true);
  }
});
