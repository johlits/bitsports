import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js";

// Player colors - vibrant and distinct
const PLAYER_COLORS = [
  0x38bdf8, // Blue
  0xf97373, // Red
  0x4ade80, // Green
  0xfbbf24, // Yellow
  0xa78bfa, // Purple
  0xfb7185, // Pink
  0x2dd4bf, // Teal
  0xfb923c, // Orange
];

export class PaintEngine {
  constructor({ container, onTick, onGameEnd, playerAIs, matchTime = 60 }) {
    this.container = container;
    this.onTick = onTick;
    this.onGameEnd = onGameEnd;
    this.playerAIs = playerAIs;
    this.matchTime = matchTime;

    // Grid settings
    this.gridWidth = 40;
    this.gridHeight = 40;
    this.tileSize = 0.5;

    // Player settings
    this.playerRadius = 0.3;
    this.maxPlayerSpeed = 8; // units/sec

    // Game state
    this.grid = []; // grid[x][y] = playerId (0 = unpainted)
    this.players = []; // { mesh, velocity, color, score, ai, id }
    this.powerups = []; // { mesh, type, x, y }
    this.timeRemaining = matchTime;
    this.gameRunning = false;
    this.lastTime = 0;

    // Powerup settings
    this.powerupSpawnInterval = 5; // seconds
    this.lastPowerupSpawn = 0;
    this.maxPowerups = 5;

    this._initThree();
    this._initScene();
  }

  _initThree() {
    const width = window.innerWidth;
    const height = window.innerHeight;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x020617);

    // Orthographic camera for top-down view
    const aspect = width / height;
    const viewSize = this.gridHeight * this.tileSize * 0.6;
    this.camera = new THREE.OrthographicCamera(
      -viewSize * aspect,
      viewSize * aspect,
      viewSize,
      -viewSize,
      0.1,
      100
    );
    this.camera.position.set(0, 30, 0);
    this.camera.lookAt(0, 0, 0);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.container.innerHTML = "";
    this.container.appendChild(this.renderer.domElement);

    window.addEventListener("resize", () => this._onResize());
  }

  _onResize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const aspect = width / height;
    const viewSize = this.gridHeight * this.tileSize * 0.6;

    this.camera.left = -viewSize * aspect;
    this.camera.right = viewSize * aspect;
    this.camera.top = viewSize;
    this.camera.bottom = -viewSize;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  _initScene() {
    // Lighting
    const light = new THREE.DirectionalLight(0xffffff, 1.0);
    light.position.set(0, 10, 0);
    this.scene.add(light);
    this.scene.add(new THREE.AmbientLight(0x64748b, 0.8));

    // Create grid tiles
    this._initGrid();

    // Create border
    this._createBorder();

    // Start preview render loop
    this._previewMode = true;
    this._renderPreview();
  }

  _initGrid() {
    // Initialize grid data
    this.grid = [];
    for (let x = 0; x < this.gridWidth; x++) {
      this.grid[x] = [];
      for (let y = 0; y < this.gridHeight; y++) {
        this.grid[x][y] = 0;
      }
    }

    // Create tile meshes using instanced mesh for performance
    const tileGeom = new THREE.PlaneGeometry(this.tileSize * 0.95, this.tileSize * 0.95);
    const tileMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      metalness: 0.1,
      roughness: 0.8,
    });

    this.tileMeshes = [];
    const offsetX = -(this.gridWidth * this.tileSize) / 2 + this.tileSize / 2;
    const offsetZ = -(this.gridHeight * this.tileSize) / 2 + this.tileSize / 2;

    for (let x = 0; x < this.gridWidth; x++) {
      this.tileMeshes[x] = [];
      for (let y = 0; y < this.gridHeight; y++) {
        const tile = new THREE.Mesh(tileGeom, tileMat.clone());
        tile.rotation.x = -Math.PI / 2;
        tile.position.set(
          offsetX + x * this.tileSize,
          0,
          offsetZ + y * this.tileSize
        );
        this.scene.add(tile);
        this.tileMeshes[x][y] = tile;
      }
    }
  }

  _createBorder() {
    const borderMat = new THREE.MeshBasicMaterial({ color: 0x64748b });
    const borderThickness = 0.1;
    const halfW = (this.gridWidth * this.tileSize) / 2;
    const halfH = (this.gridHeight * this.tileSize) / 2;

    // Create 4 border walls
    const borders = [
      { w: this.gridWidth * this.tileSize + borderThickness * 2, h: borderThickness, x: 0, z: -halfH - borderThickness / 2 },
      { w: this.gridWidth * this.tileSize + borderThickness * 2, h: borderThickness, x: 0, z: halfH + borderThickness / 2 },
      { w: borderThickness, h: this.gridHeight * this.tileSize, x: -halfW - borderThickness / 2, z: 0 },
      { w: borderThickness, h: this.gridHeight * this.tileSize, x: halfW + borderThickness / 2, z: 0 },
    ];

    for (const b of borders) {
      const geom = new THREE.PlaneGeometry(b.w, b.h);
      const mesh = new THREE.Mesh(geom, borderMat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(b.x, 0.01, b.z);
      this.scene.add(mesh);
    }
  }

  _renderPreview() {
    if (!this._previewMode) return;
    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(() => this._renderPreview());
  }

  _worldToGrid(worldX, worldZ) {
    const offsetX = (this.gridWidth * this.tileSize) / 2;
    const offsetZ = (this.gridHeight * this.tileSize) / 2;
    const gx = Math.floor((worldX + offsetX) / this.tileSize);
    const gz = Math.floor((worldZ + offsetZ) / this.tileSize);
    return { x: gx, y: gz };
  }

  _gridToWorld(gx, gy) {
    const offsetX = -(this.gridWidth * this.tileSize) / 2 + this.tileSize / 2;
    const offsetZ = -(this.gridHeight * this.tileSize) / 2 + this.tileSize / 2;
    return {
      x: offsetX + gx * this.tileSize,
      z: offsetZ + gy * this.tileSize,
    };
  }

  _initPlayers() {
    // Clear existing players
    for (const p of this.players) {
      this.scene.remove(p.mesh);
    }
    this.players = [];

    const numPlayers = this.playerAIs.length;
    const playerGeom = new THREE.CylinderGeometry(this.playerRadius, this.playerRadius, 0.3, 32);

    // Spawn positions - spread around the grid
    const spawnPositions = this._getSpawnPositions(numPlayers);

    for (let i = 0; i < numPlayers; i++) {
      const color = PLAYER_COLORS[i % PLAYER_COLORS.length];
      const mat = new THREE.MeshStandardMaterial({ color });
      const mesh = new THREE.Mesh(playerGeom, mat);

      const spawn = spawnPositions[i];
      mesh.position.set(spawn.x, 0.15, spawn.z);

      this.scene.add(mesh);

      this.players.push({
        mesh,
        velocity: new THREE.Vector2(0, 0),
        color,
        colorHex: "#" + color.toString(16).padStart(6, "0"),
        score: 0,
        ai: this.playerAIs[i],
        id: i + 1,
        powerups: {
          speedBoost: 0,
          shield: 0,
          paintBomb: 0,
        },
      });
    }
  }

  _getSpawnPositions(numPlayers) {
    const positions = [];
    const halfW = (this.gridWidth * this.tileSize) / 2 - 2;
    const halfH = (this.gridHeight * this.tileSize) / 2 - 2;

    // Predefined spawn positions for different player counts
    const corners = [
      { x: -halfW, z: -halfH },
      { x: halfW, z: halfH },
      { x: halfW, z: -halfH },
      { x: -halfW, z: halfH },
      { x: 0, z: -halfH },
      { x: 0, z: halfH },
      { x: -halfW, z: 0 },
      { x: halfW, z: 0 },
    ];

    for (let i = 0; i < numPlayers; i++) {
      positions.push(corners[i % corners.length]);
    }

    return positions;
  }

  _resetGrid() {
    for (let x = 0; x < this.gridWidth; x++) {
      for (let y = 0; y < this.gridHeight; y++) {
        this.grid[x][y] = 0;
        this.tileMeshes[x][y].material.color.setHex(0x1e293b);
      }
    }
  }

  _clearPowerups() {
    for (const p of this.powerups) {
      this.scene.remove(p.mesh);
    }
    this.powerups = [];
  }

  _spawnPowerup() {
    if (this.powerups.length >= this.maxPowerups) return;

    // Find an empty tile
    let attempts = 0;
    while (attempts < 100) {
      const gx = Math.floor(Math.random() * this.gridWidth);
      const gy = Math.floor(Math.random() * this.gridHeight);

      if (this.grid[gx][gy] === 0) {
        // Check no player is nearby
        const worldPos = this._gridToWorld(gx, gy);
        let tooClose = false;
        for (const p of this.players) {
          const dx = p.mesh.position.x - worldPos.x;
          const dz = p.mesh.position.z - worldPos.z;
          if (dx * dx + dz * dz < 4) {
            tooClose = true;
            break;
          }
        }

        if (!tooClose) {
          const types = ["speed", "bomb", "shield"];
          const type = types[Math.floor(Math.random() * types.length)];
          this._createPowerup(gx, gy, type);
          return;
        }
      }
      attempts++;
    }
  }

  _createPowerup(gx, gy, type) {
    const worldPos = this._gridToWorld(gx, gy);

    let color;
    let geometry;
    switch (type) {
      case "speed":
        color = 0xfbbf24; // Yellow
        geometry = new THREE.ConeGeometry(0.15, 0.3, 8);
        break;
      case "bomb":
        color = 0xef4444; // Red
        geometry = new THREE.SphereGeometry(0.15, 16, 16);
        break;
      case "shield":
        color = 0x38bdf8; // Blue
        geometry = new THREE.BoxGeometry(0.25, 0.25, 0.25);
        break;
    }

    const mat = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.5,
    });
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.position.set(worldPos.x, 0.25, worldPos.z);

    this.scene.add(mesh);
    this.powerups.push({ mesh, type, gx, gy });
  }

  _checkPowerupCollision(player) {
    for (let i = this.powerups.length - 1; i >= 0; i--) {
      const powerup = this.powerups[i];
      const dx = player.mesh.position.x - powerup.mesh.position.x;
      const dz = player.mesh.position.z - powerup.mesh.position.z;
      const dist = Math.sqrt(dx * dx + dz * dz);

      if (dist < this.playerRadius + 0.2) {
        // Collect powerup
        this._applyPowerup(player, powerup.type);
        this.scene.remove(powerup.mesh);
        this.powerups.splice(i, 1);
      }
    }
  }

  _applyPowerup(player, type) {
    switch (type) {
      case "speed":
        player.powerups.speedBoost = 3; // 3 seconds
        break;
      case "bomb":
        // Paint 3x3 area around player
        const gridPos = this._worldToGrid(player.mesh.position.x, player.mesh.position.z);
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            const gx = gridPos.x + dx;
            const gy = gridPos.y + dy;
            if (gx >= 0 && gx < this.gridWidth && gy >= 0 && gy < this.gridHeight) {
              this._paintTile(gx, gy, player);
            }
          }
        }
        break;
      case "shield":
        player.powerups.shield = 5; // 5 seconds
        break;
    }
  }

  _paintTile(gx, gy, player) {
    if (gx < 0 || gx >= this.gridWidth || gy < 0 || gy >= this.gridHeight) return;

    const currentOwner = this.grid[gx][gy];

    // Check if tile is protected by shield
    if (currentOwner !== 0 && currentOwner !== player.id) {
      const owner = this.players.find((p) => p.id === currentOwner);
      if (owner && owner.powerups.shield > 0) {
        return; // Can't paint over shielded player's tiles
      }
    }

    // Update grid and visual
    this.grid[gx][gy] = player.id;
    this.tileMeshes[gx][gy].material.color.setHex(player.color);
  }

  _applyAIMove(player, delta) {
    if (!player.ai || typeof player.ai.tick !== "function") return;

    // Build game state for AI
    const gridPos = this._worldToGrid(player.mesh.position.x, player.mesh.position.z);

    const otherPlayers = this.players
      .filter((p) => p.id !== player.id)
      .map((p) => ({
        x: p.mesh.position.x,
        z: p.mesh.position.z,
        id: p.id,
        color: p.color,
        score: p.score,
      }));

    const powerupList = this.powerups.map((p) => ({
      x: p.mesh.position.x,
      z: p.mesh.position.z,
      type: p.type,
    }));

    const state = {
      self: {
        x: player.mesh.position.x,
        z: player.mesh.position.z,
        gridX: gridPos.x,
        gridY: gridPos.y,
        score: player.score,
        powerups: { ...player.powerups },
      },
      others: otherPlayers,
      powerups: powerupList,
      grid: this.grid,
      gridWidth: this.gridWidth,
      gridHeight: this.gridHeight,
      tileSize: this.tileSize,
      timeRemaining: this.timeRemaining,
      dt: delta,
    };

    const dir = player.ai.tick(state);
    if (!dir) return;

    const move = new THREE.Vector2(dir.x || 0, dir.z || 0);
    if (move.lengthSq() === 0) return;

    // Apply speed boost if active
    let speed = this.maxPlayerSpeed;
    if (player.powerups.speedBoost > 0) {
      speed *= 1.5;
    }

    move.normalize().multiplyScalar(speed * delta);

    player.mesh.position.x += move.x;
    player.mesh.position.z += move.y;
  }

  _clampPlayerPosition(player) {
    const halfW = (this.gridWidth * this.tileSize) / 2 - this.playerRadius;
    const halfH = (this.gridHeight * this.tileSize) / 2 - this.playerRadius;

    player.mesh.position.x = Math.max(-halfW, Math.min(halfW, player.mesh.position.x));
    player.mesh.position.z = Math.max(-halfH, Math.min(halfH, player.mesh.position.z));
  }

  _updatePowerupTimers(delta) {
    for (const player of this.players) {
      if (player.powerups.speedBoost > 0) {
        player.powerups.speedBoost -= delta;
      }
      if (player.powerups.shield > 0) {
        player.powerups.shield -= delta;
      }
    }

    // Rotate powerup meshes for visual effect
    for (const p of this.powerups) {
      p.mesh.rotation.y += delta * 2;
      p.mesh.position.y = 0.25 + Math.sin(performance.now() / 300) * 0.05;
    }
  }

  _calculateScores() {
    // Reset scores
    for (const player of this.players) {
      player.score = 0;
    }

    // Count tiles
    for (let x = 0; x < this.gridWidth; x++) {
      for (let y = 0; y < this.gridHeight; y++) {
        const owner = this.grid[x][y];
        if (owner > 0) {
          const player = this.players.find((p) => p.id === owner);
          if (player) {
            player.score++;
          }
        }
      }
    }
  }

  setPlayerAIs(ais) {
    this.playerAIs = ais;
  }

  setMatchTime(time) {
    this.matchTime = time;
  }

  start() {
    this._previewMode = false;
    this.gameRunning = true;
    this.timeRemaining = this.matchTime;
    this.lastPowerupSpawn = 0;

    this._resetGrid();
    this._clearPowerups();
    this._initPlayers();

    this.lastTime = performance.now();

    const loop = (time) => {
      if (!this.gameRunning) return;

      const dt = (time - this.lastTime) / 1000;
      this.lastTime = time;

      this.update(dt);
      this.renderer.render(this.scene, this.camera);

      if (this.gameRunning) {
        this.rafId = requestAnimationFrame(loop);
      }
    };

    this.rafId = requestAnimationFrame(loop);
  }

  stop() {
    this.gameRunning = false;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
    }
  }

  update(delta) {
    // Update timer
    this.timeRemaining -= delta;
    if (this.timeRemaining <= 0) {
      this.timeRemaining = 0;
      this._endGame();
      return;
    }

    // Spawn powerups
    this.lastPowerupSpawn += delta;
    if (this.lastPowerupSpawn >= this.powerupSpawnInterval) {
      this._spawnPowerup();
      this.lastPowerupSpawn = 0;
    }

    // Update powerup timers
    this._updatePowerupTimers(delta);

    // Update players
    for (const player of this.players) {
      this._applyAIMove(player, delta);
      this._clampPlayerPosition(player);

      // Paint tile under player
      const gridPos = this._worldToGrid(player.mesh.position.x, player.mesh.position.z);
      this._paintTile(gridPos.x, gridPos.y, player);

      // Check powerup collision
      this._checkPowerupCollision(player);
    }

    // Calculate scores
    this._calculateScores();

    // Callback for UI update
    this.onTick?.(this.timeRemaining, this.players);
  }

  _endGame() {
    this.gameRunning = false;
    this._calculateScores();

    // Find winner
    let winner = this.players[0];
    for (const player of this.players) {
      if (player.score > winner.score) {
        winner = player;
      }
    }

    this.onGameEnd?.(this.players, winner);
  }

  getPlayerColors() {
    return PLAYER_COLORS;
  }
}
