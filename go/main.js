import { GoGame, BLACK, WHITE, BOARD_SIZE, KOMI, idx, coord, neighbors, tryMove } from "./engine.js";
import { allAIs } from "./ais/registry.js";

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const ui         = document.getElementById("ui");
const uiToggle   = document.getElementById("ui-toggle");
const blackSelect = document.getElementById("black-ai");
const whiteSelect = document.getElementById("white-ai");
const startBtn   = document.getElementById("start-btn");
const passBtn    = document.getElementById("pass-btn");
const resignBtn  = document.getElementById("resign-btn");
const scoreEl    = document.getElementById("score");
const statusEl   = document.getElementById("status-line");
const container  = document.getElementById("canvas-container");

// Cinematic mode
const cinematicBlackName = document.getElementById("cinematic-black-name");
const cinematicWhiteName = document.getElementById("cinematic-white-name");
const cinematicBlackCap  = document.getElementById("cinematic-black-cap");
const cinematicWhiteCap  = document.getElementById("cinematic-white-cap");
const cinematicCountdown = document.getElementById("cinematic-countdown");

// Victory screen elements
const victoryOverlay = document.getElementById("victory-overlay");
const victoryWinner = document.getElementById("victory-winner");
const victoryDetails = document.getElementById("victory-details");
const victoryPlayAgain = document.getElementById("victory-play-again");
const victoryClose = document.getElementById("victory-close");

// ─── Canvas setup ─────────────────────────────────────────────────────────────
const canvas = document.createElement("canvas");
container.appendChild(canvas);
const ctx = canvas.getContext("2d");

// ─── State ────────────────────────────────────────────────────────────────────
let game = new GoGame();
let blackAI = null;
let whiteAI = null;
let running = false;
let aiThinkTimer = 0;
const AI_DELAY = 0.35; // seconds between AI moves

let cinematicMode = false;
let countdownInterval = null;

// Board layout (recalculated on resize)
let layout = {};

// Hover position for human player
let hoverX = -1, hoverY = -1;

// ─── Populate AI selects ──────────────────────────────────────────────────────
function populateSelect(sel) {
  allAIs.forEach((ai, i) => {
    const opt = document.createElement("option");
    opt.value = ai.id;
    opt.textContent = ai.name;
    sel.appendChild(opt);
  });
}
populateSelect(blackSelect);
populateSelect(whiteSelect);
blackSelect.value = allAIs[0].id;
whiteSelect.value = (allAIs[1] ?? allAIs[0]).id;

// ─── UI collapse ─────────────────────────────────────────────────────────────
uiToggle.addEventListener("click", () => {
  const collapsed = ui.classList.toggle("collapsed");
  uiToggle.textContent = collapsed ? "Show" : "Hide";
});

// ─── Cinematic mode ───────────────────────────────────────────────────────────
function updateCinematicOverlay() {
  const bName = blackAI ? blackAI.name : "Human";
  const wName = whiteAI ? whiteAI.name : "Human";
  cinematicBlackName.textContent = bName;
  cinematicWhiteName.textContent = wName;
  cinematicBlackCap.querySelector(".cap-val").textContent = game.captures[BLACK];
  cinematicWhiteCap.querySelector(".cap-val").textContent = game.captures[WHITE];
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
  let count = 30;
  cinematicCountdown.textContent = count;
  cinematicCountdown.classList.add("active");
  countdownInterval = setInterval(() => {
    count--;
    if (count > 0) {
      cinematicCountdown.textContent = count;
    } else {
      clearCountdown();
      // Auto-start a new game with current AI selections
      startBtn.click();
    }
  }, 1000);
}

document.addEventListener("keydown", (e) => {
  if (e.key !== "c" && e.key !== "C") return;
  if (!cinematicMode) {
    cinematicMode = true;
    document.body.classList.add("cinematic-mode");
    updateCinematicOverlay();
    startCountdown();
  } else {
    cinematicMode = false;
    document.body.classList.remove("cinematic-mode");
    clearCountdown();
  }
});

// ─── Victory Screen ───────────────────────────────────────────────────────────

function showVictoryScreen() {
  if (!game.gameOver || !game.result) return;
  
  const { winner, reason, blackScore, whiteScore } = game.result;
  
  const winnerColor = winner === BLACK ? "Black" : "White";
  const winnerAI = winner === BLACK ? blackAI : whiteAI;
  const winnerName = winnerAI ? winnerAI.name : `Human (${winnerColor})`;
  const winnerCssClass = winner === BLACK ? "style='color: #e2e8f0;'" : "style='color: #94a3b8;'";
  
  victoryWinner.innerHTML = `<span class="winner-name" ${winnerCssClass}>${winnerName}</span> wins!`;
  
  if (reason === 'resign') {
    victoryDetails.innerHTML = `by resignation`;
  } else if (reason === 'dominance') {
    victoryDetails.innerHTML = `
      by dominance<br><br>
      Black: ${blackScore} (alive+cap)<br>
      White: ${whiteScore} (alive+cap)
    `;
  } else if (blackScore !== null) {
    victoryDetails.innerHTML = `
      Black: ${blackScore.toFixed(1)}<br>
      White: ${whiteScore.toFixed(1)} (incl. ${KOMI} komi)
    `;
  } else {
    victoryDetails.innerHTML = `by ${reason}`;
  }
  
  victoryOverlay.classList.add("active");
}

victoryPlayAgain.addEventListener("click", () => {
  victoryOverlay.classList.remove("active");
  startBtn.click();
});

victoryClose.addEventListener("click", () => {
  victoryOverlay.classList.remove("active");
});

// ─── Layout calculation ───────────────────────────────────────────────────────
function calcLayout() {
  const W = canvas.width;
  const H = canvas.height;
  const minDim = Math.min(W, H);
  const margin = minDim * 0.055;
  const boardPx = minDim - margin * 2;
  const cell = boardPx / (BOARD_SIZE - 1);
  const ox = (W - boardPx) / 2;
  const oy = (H - boardPx) / 2;
  layout = { ox, oy, cell, boardPx, stoneR: cell * 0.46 };
}

function screenToGrid(sx, sy) {
  const { ox, oy, cell } = layout;
  const gx = Math.round((sx - ox) / cell);
  const gy = Math.round((sy - oy) / cell);
  if (gx < 0 || gx >= BOARD_SIZE || gy < 0 || gy >= BOARD_SIZE) return null;
  // Only snap if within half a cell
  const px = ox + gx * cell, py = oy + gy * cell;
  if (Math.hypot(sx - px, sy - py) > cell * 0.5) return null;
  return { x: gx, y: gy };
}

// ─── Drawing constants ────────────────────────────────────────────────────────
const BOARD_BG    = "#dcbc7e";
const BOARD_EDGE  = "#b8963e";
const LINE_COLOR  = "#5a3e1b";
const STAR_COLOR  = "#3a2a0e";

const STAR_POINTS = [
  [3,3],[9,3],[15,3],
  [3,9],[9,9],[15,9],
  [3,15],[9,15],[15,15],
];

// ─── Resize ───────────────────────────────────────────────────────────────────
function resize() {
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
  calcLayout();
  draw();
}
window.addEventListener("resize", resize);
resize();

function draw() {
  const { ox, oy, cell, boardPx, stoneR } = layout;
  const W = canvas.width, H = canvas.height;

  // Background
  ctx.fillStyle = "#050816";
  ctx.fillRect(0, 0, W, H);

  // Board surface
  const pad = cell * 0.7;
  ctx.fillStyle = BOARD_BG;
  roundRect(ctx, ox - pad, oy - pad, boardPx + pad * 2, boardPx + pad * 2, cell * 0.15);
  ctx.fill();
  ctx.strokeStyle = BOARD_EDGE;
  ctx.lineWidth = 2;
  ctx.stroke();

  // Grid lines
  ctx.strokeStyle = LINE_COLOR;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < BOARD_SIZE; i++) {
    ctx.moveTo(ox + i * cell, oy);
    ctx.lineTo(ox + i * cell, oy + boardPx);
    ctx.moveTo(ox, oy + i * cell);
    ctx.lineTo(ox + boardPx, oy + i * cell);
  }
  ctx.stroke();

  // Star points
  ctx.fillStyle = STAR_COLOR;
  for (const [sx, sy] of STAR_POINTS) {
    ctx.beginPath();
    ctx.arc(ox + sx * cell, oy + sy * cell, cell * 0.08, 0, Math.PI * 2);
    ctx.fill();
  }

  // Stones
  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      const color = game.board[idx(x, y)];
      if (color !== 0) {
        drawStone(ox + x * cell, oy + y * cell, stoneR, color);
      }
    }
  }

  // Last move marker
  if (game.lastMove && game.lastMove !== "pass") {
    const { x, y } = game.lastMove;
    const color = game.board[idx(x, y)];
    ctx.strokeStyle = color === BLACK ? "rgba(255,255,255,0.8)" : "rgba(0,0,0,0.7)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(ox + x * cell, oy + y * cell, stoneR * 0.38, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Hover ghost for human player
  if (running && !game.gameOver && hoverX >= 0) {
    const currentAI = game.turn === BLACK ? blackAI : whiteAI;
    if (!currentAI || currentAI.id === "human") {
      const { ok } = tryMoveCheck(hoverX, hoverY);
      if (ok) {
        ctx.globalAlpha = 0.4;
        drawStone(ox + hoverX * cell, oy + hoverY * cell, stoneR, game.turn);
        ctx.globalAlpha = 1;
      }
    }
  }

  // We no longer draw the canvas overlay result, instead we use the DOM overlay
  if (game.gameOver && game.result && !victoryOverlay.classList.contains("active")) {
     // Ensure it shows up if it was dismissed but we still want to indicate game over somewhere? 
     // Usually showing once is enough. We'll handle showing it in the game loop/handlers.
  }
}

function tryMoveCheck(x, y) {
  return tryMove(game.board, x, y, game.turn, game.koPoint);
}

function drawStone(cx, cy, r, color) {
  // Base fill
  const isBlack = color === BLACK;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);

  // Radial gradient for 3-D look
  const grd = ctx.createRadialGradient(
    cx - r * 0.3, cy - r * 0.3, r * 0.05,
    cx, cy, r
  );
  if (isBlack) {
    grd.addColorStop(0, "#555");
    grd.addColorStop(1, "#0a0a0a");
  } else {
    grd.addColorStop(0, "#ffffff");
    grd.addColorStop(1, "#c8c8c8");
  }
  ctx.fillStyle = grd;
  ctx.fill();

  // Subtle edge
  ctx.strokeStyle = isBlack ? "#000" : "#aaa";
  ctx.lineWidth = 0.5;
  ctx.stroke();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// ─── UI updates ───────────────────────────────────────────────────────────────
function updateUI() {
  const bc = game.captures[BLACK];
  const wc = game.captures[WHITE];
  scoreEl.innerHTML =
    `<span class="score-black"><span class="stone-icon black" style="margin-right:0.25rem;"></span>${bc}</span>` +
    `<span class="score-sep"> cap </span>` +
    `<span class="score-white">${wc}<span class="stone-icon white" style="margin-left:0.25rem;"></span></span>`;

  if (cinematicMode) updateCinematicOverlay();

  if (!running) {
    statusEl.innerHTML = "Press Start Game";
    passBtn.disabled = true;
    resignBtn.disabled = true;
    return;
  }

  if (game.gameOver) {
    const { winner, reason, blackScore, whiteScore } = game.result;
    const name = winner === BLACK ? "Black" : "White";
    if (reason === "resign") {
      statusEl.innerHTML = `${name} wins by resignation`;
    } else if (reason === "dominance") {
      statusEl.innerHTML = `${name} wins by dominance · B ${blackScore} – W ${whiteScore}`;
    } else {
      statusEl.innerHTML =
        `${name} wins · B ${blackScore?.toFixed(1)} – W ${whiteScore?.toFixed(1)}`;
    }
    passBtn.disabled = true;
    resignBtn.disabled = true;
    return;
  }

  const turnName = game.turn === BLACK ? "Black" : "White";
  const turnIcon = game.turn === BLACK 
    ? '<span class="stone-icon black"></span>' 
    : '<span class="stone-icon white"></span>';
    
  const currentAI = game.turn === BLACK ? blackAI : whiteAI;
  const isHuman = !currentAI || currentAI.id === "human";
  statusEl.innerHTML = isHuman
    ? `${turnIcon} <span>${turnName} — click to place</span>`
    : `${turnIcon} <span>${turnName} — thinking…</span>`;

  passBtn.disabled   = !isHuman;
  resignBtn.disabled = !isHuman;
}

// ─── Game loop ────────────────────────────────────────────────────────────────
let lastTime = 0;

function loop(ts) {
  const dt = Math.min((ts - lastTime) / 1000, 0.1);
  lastTime = ts;

  if (running && !game.gameOver) {
    const currentAI = game.turn === BLACK ? blackAI : whiteAI;
    if (currentAI && currentAI.id !== "human") {
      aiThinkTimer -= dt;
      if (aiThinkTimer <= 0) {
        const move = currentAI.tick({ game, color: game.turn });
        if (move === "pass") {
          game.pass();
        } else if (move) {
          game.playMove(move.x, move.y);
        }
        aiThinkTimer = AI_DELAY;
        updateUI();
        
        if (game.gameOver) {
          showVictoryScreen();
        }
      }
    }
  }

  draw();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// ─── Input ────────────────────────────────────────────────────────────────────
canvas.addEventListener("mousemove", (e) => {
  const rect = canvas.getBoundingClientRect();
  const g = screenToGrid(e.clientX - rect.left, e.clientY - rect.top);
  hoverX = g ? g.x : -1;
  hoverY = g ? g.y : -1;
});

canvas.addEventListener("mouseleave", () => { hoverX = -1; hoverY = -1; });

canvas.addEventListener("click", (e) => {
  if (!running || game.gameOver) return;
  const currentAI = game.turn === BLACK ? blackAI : whiteAI;
  if (currentAI && currentAI.id !== "human") return; // AI turn

  const rect = canvas.getBoundingClientRect();
  const g = screenToGrid(e.clientX - rect.left, e.clientY - rect.top);
  if (!g) return;

  if (game.playMove(g.x, g.y)) {
    aiThinkTimer = AI_DELAY;
    updateUI();
    
    if (game.gameOver) {
      showVictoryScreen();
    }
  }
});

// Touch support
canvas.addEventListener("touchend", (e) => {
  if (!running || game.gameOver) return;
  const currentAI = game.turn === BLACK ? blackAI : whiteAI;
  if (currentAI && currentAI.id !== "human") return;

  const t = e.changedTouches[0];
  const rect = canvas.getBoundingClientRect();
  const g = screenToGrid(t.clientX - rect.left, t.clientY - rect.top);
  if (!g) return;

  if (game.playMove(g.x, g.y)) {
    aiThinkTimer = AI_DELAY;
    updateUI();
    
    if (game.gameOver) {
      showVictoryScreen();
    }
  }
  e.preventDefault();
}, { passive: false });

// ─── Button handlers ──────────────────────────────────────────────────────────
startBtn.addEventListener("click", () => {
  victoryOverlay.classList.remove("active");

  const bAI = allAIs.find(a => a.id === blackSelect.value) ?? allAIs[0];
  const wAI = allAIs.find(a => a.id === whiteSelect.value) ?? allAIs[0];
  blackAI = bAI.id === "human" ? null : bAI;
  whiteAI = wAI.id === "human" ? null : wAI;

  game.reset();
  running = true;
  aiThinkTimer = AI_DELAY;
  updateUI();
});

passBtn.addEventListener("click", () => {
  if (!running || game.gameOver) return;
  const currentAI = game.turn === BLACK ? blackAI : whiteAI;
  if (currentAI && currentAI.id !== "human") return;
  game.pass();
  aiThinkTimer = AI_DELAY;
  updateUI();
  if (game.gameOver) {
    showVictoryScreen();
  }
});

resignBtn.addEventListener("click", () => {
  if (!running || game.gameOver) return;
  const currentAI = game.turn === BLACK ? blackAI : whiteAI;
  if (currentAI && currentAI.id !== "human") return;
  game.resign(game.turn);
  updateUI();
  if (game.gameOver) {
    showVictoryScreen();
  }
});
