import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js";

const TEAM_GUARDS = "guards";
const TEAM_INFILTRATORS = "infiltrators";

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

function distSq2(ax, az, bx, bz) {
  const dx = ax - bx;
  const dz = az - bz;
  return dx * dx + dz * dz;
}

function normalize2(x, z) {
  const len = Math.hypot(x, z) || 1;
  return { x: x / len, z: z / len };
}

function angleBetween2(ax, az, bx, bz) {
  const al = Math.hypot(ax, az) || 1;
  const bl = Math.hypot(bx, bz) || 1;
  const dot = (ax / al) * (bx / bl) + (az / al) * (bz / bl);
  return Math.acos(clamp(dot, -1, 1));
}

function bresenhamLine(x0, y0, x1, y1) {
  const points = [];
  let dx = Math.abs(x1 - x0);
  let dy = Math.abs(y1 - y0);
  let sx = x0 < x1 ? 1 : -1;
  let sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;

  let x = x0;
  let y = y0;
  while (true) {
    points.push({ x, y });
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
  }

  return points;
}

// A* pathfinding - returns array of {x, z} world positions or null if no path
function astarPath(walls, gridWidth, gridHeight, tileSize, startX, startZ, goalX, goalZ) {
  const worldToGrid = (x, z) => {
    const offsetX = (gridWidth * tileSize) / 2;
    const offsetZ = (gridHeight * tileSize) / 2;
    return {
      x: Math.floor((x + offsetX) / tileSize),
      y: Math.floor((z + offsetZ) / tileSize),
    };
  };

  const gridToWorld = (gx, gy) => {
    const offsetX = -(gridWidth * tileSize) / 2 + tileSize / 2;
    const offsetZ = -(gridHeight * tileSize) / 2 + tileSize / 2;
    return {
      x: offsetX + gx * tileSize,
      z: offsetZ + gy * tileSize,
    };
  };

  const isWall = (gx, gy) => {
    if (gx < 0 || gx >= gridWidth || gy < 0 || gy >= gridHeight) return true;
    return !!walls[gx]?.[gy];
  };

  const start = worldToGrid(startX, startZ);
  const goal = worldToGrid(goalX, goalZ);

  // Clamp to valid cells
  start.x = clamp(start.x, 0, gridWidth - 1);
  start.y = clamp(start.y, 0, gridHeight - 1);
  goal.x = clamp(goal.x, 0, gridWidth - 1);
  goal.y = clamp(goal.y, 0, gridHeight - 1);

  // If goal is a wall, find nearest non-wall
  if (isWall(goal.x, goal.y)) {
    let best = null;
    let bestD = Infinity;
    for (let dx = -3; dx <= 3; dx++) {
      for (let dy = -3; dy <= 3; dy++) {
        const gx = goal.x + dx;
        const gy = goal.y + dy;
        if (!isWall(gx, gy)) {
          const d = dx * dx + dy * dy;
          if (d < bestD) {
            bestD = d;
            best = { x: gx, y: gy };
          }
        }
      }
    }
    if (best) {
      goal.x = best.x;
      goal.y = best.y;
    } else {
      return null;
    }
  }

  // If start is a wall, find nearest non-wall
  if (isWall(start.x, start.y)) {
    let best = null;
    let bestD = Infinity;
    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = -2; dy <= 2; dy++) {
        const gx = start.x + dx;
        const gy = start.y + dy;
        if (!isWall(gx, gy)) {
          const d = dx * dx + dy * dy;
          if (d < bestD) {
            bestD = d;
            best = { x: gx, y: gy };
          }
        }
      }
    }
    if (best) {
      start.x = best.x;
      start.y = best.y;
    } else {
      return null;
    }
  }

  if (start.x === goal.x && start.y === goal.y) {
    const wp = gridToWorld(goal.x, goal.y);
    return [{ x: wp.x, z: wp.z }];
  }

  const key = (gx, gy) => `${gx},${gy}`;
  const heuristic = (gx, gy) => Math.abs(gx - goal.x) + Math.abs(gy - goal.y);

  const openSet = new Map();
  const cameFrom = new Map();
  const gScore = new Map();
  const fScore = new Map();

  const startKey = key(start.x, start.y);
  gScore.set(startKey, 0);
  fScore.set(startKey, heuristic(start.x, start.y));
  openSet.set(startKey, { x: start.x, y: start.y });

  const neighbors = [
    { dx: 1, dy: 0 },
    { dx: -1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: 0, dy: -1 },
    { dx: 1, dy: 1 },
    { dx: -1, dy: 1 },
    { dx: 1, dy: -1 },
    { dx: -1, dy: -1 },
  ];

  let iterations = 0;
  const maxIterations = 800;

  while (openSet.size > 0 && iterations < maxIterations) {
    iterations++;

    // Find node with lowest fScore
    let currentKey = null;
    let currentNode = null;
    let lowestF = Infinity;
    for (const [k, node] of openSet) {
      const f = fScore.get(k) ?? Infinity;
      if (f < lowestF) {
        lowestF = f;
        currentKey = k;
        currentNode = node;
      }
    }

    if (!currentNode) break;

    if (currentNode.x === goal.x && currentNode.y === goal.y) {
      // Reconstruct path
      const path = [];
      let ck = currentKey;
      while (ck) {
        const [cx, cy] = ck.split(",").map(Number);
        const wp = gridToWorld(cx, cy);
        path.unshift({ x: wp.x, z: wp.z });
        ck = cameFrom.get(ck);
      }
      return path;
    }

    openSet.delete(currentKey);

    for (const { dx, dy } of neighbors) {
      const nx = currentNode.x + dx;
      const ny = currentNode.y + dy;

      if (isWall(nx, ny)) continue;

      // For diagonal moves, check that we can actually pass (no corner cutting)
      if (dx !== 0 && dy !== 0) {
        if (isWall(currentNode.x + dx, currentNode.y) || isWall(currentNode.x, currentNode.y + dy)) {
          continue;
        }
      }

      const nKey = key(nx, ny);
      const moveCost = dx !== 0 && dy !== 0 ? 1.414 : 1;
      const tentativeG = (gScore.get(currentKey) ?? Infinity) + moveCost;

      if (tentativeG < (gScore.get(nKey) ?? Infinity)) {
        cameFrom.set(nKey, currentKey);
        gScore.set(nKey, tentativeG);
        fScore.set(nKey, tentativeG + heuristic(nx, ny));
        if (!openSet.has(nKey)) {
          openSet.set(nKey, { x: nx, y: ny });
        }
      }
    }
  }

  return null; // No path found
}

// Get direction to next waypoint on path
function getPathDirection(path, currentX, currentZ) {
  if (!path || path.length === 0) return null;

  // Find closest waypoint we haven't passed yet
  let targetIdx = 0;
  for (let i = 0; i < path.length; i++) {
    const wp = path[i];
    const dx = wp.x - currentX;
    const dz = wp.z - currentZ;
    const dist = Math.hypot(dx, dz);
    if (dist > 0.25) {
      targetIdx = i;
      break;
    }
    targetIdx = i + 1;
  }

  if (targetIdx >= path.length) {
    targetIdx = path.length - 1;
  }

  const target = path[targetIdx];
  const dx = target.x - currentX;
  const dz = target.z - currentZ;
  const len = Math.hypot(dx, dz);

  if (len < 0.05) return null;

  return { x: dx / len, z: dz / len };
}

export class SneakEngine {
  constructor({ container, onTick, onGameEnd, guardAIs, infiltratorAIs, matchTime = 120 }) {
    this.container = container;
    this.onTick = onTick;
    this.onGameEnd = onGameEnd;

    this.guardAIs = guardAIs || [];
    this.infiltratorAIs = infiltratorAIs || [];
    this.matchTime = matchTime;

    // Grid / world - bigger map
    this.gridWidth = 48;
    this.gridHeight = 32;
    this.tileSize = 0.5;

    // Movement
    this.agentRadius = 0.18;
    this.maxSpeed = 3.2; // units / sec

    // Vision - different for each team
    this.guardVisionRange = 3.5;  // guards have shorter range
    this.guardVisionFov = (80 * Math.PI) / 180;  // narrower FOV
    this.infiltratorVisionRange = 4.5;  // infiltrators see further
    this.infiltratorVisionFov = (120 * Math.PI) / 180;  // wider FOV - more aware

    // Detection
    this.spotCooldownSec = 1.5;  // slightly longer cooldown for balance
    this.spotDistanceRequired = 1.8;  // guards must be this close to spot
    this._lastSpotTime = -999;

    // Gold
    this.goldPickupRadius = 0.28;
    this.baseRadius = 0.55;
    this.goldCount = 5;  // configurable number of gold

    // Scores
    this.scoreGuards = 0;
    this.scoreInfiltrators = 0;

    // Time
    this.timeRemaining = matchTime;
    this.gameRunning = false;
    this.lastEvent = "";

    // State
    this.walls = this._createDefaultWalls(); // boolean grid
    this.agents = []; // {id, team, ai, mesh, heading:{x,z}, carryingGoldId:null, spawn:{x,z}}
    this.gold = []; // {id, mesh, x,z, active}

    // Visual effects
    this.particles = [];
    this.flashEffects = [];

    this.bases = {
      [TEAM_GUARDS]: { x: -10, z: 0 },
      [TEAM_INFILTRATORS]: { x: 10, z: 0 },
    };

    // Spawn protection - guards cannot enter this radius around infiltrator base
    this.spawnProtectionRadius = 2.5;

    // Shared team vision
    this.teamVision = {
      [TEAM_GUARDS]: { visibleCells: new Set(), visibleEnemies: [], visibleGold: [] },
      [TEAM_INFILTRATORS]: { visibleCells: new Set(), visibleEnemies: [], visibleGold: [] },
    };

    this._initThree();
    this._initScene();
  }

  setTeams({ guardAIs, infiltratorAIs }) {
    this.guardAIs = guardAIs || [];
    this.infiltratorAIs = infiltratorAIs || [];
  }

  setMatchTime(t) {
    this.matchTime = t;
  }

  setGoldCount(count) {
    this.goldCount = Math.max(1, Math.min(10, count));
  }

  _initThree() {
    const width = window.innerWidth;
    const height = window.innerHeight;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x020617);

    const aspect = width / height;
    const viewSize = this.gridHeight * this.tileSize * 0.65;
    this.camera = new THREE.OrthographicCamera(
      -viewSize * aspect,
      viewSize * aspect,
      viewSize,
      -viewSize,
      0.1,
      200
    );
    this.camera.position.set(0, 40, 0);
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
    const viewSize = this.gridHeight * this.tileSize * 0.65;

    this.camera.left = -viewSize * aspect;
    this.camera.right = viewSize * aspect;
    this.camera.top = viewSize;
    this.camera.bottom = -viewSize;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  _initScene() {
    const light = new THREE.DirectionalLight(0xffffff, 1.0);
    light.position.set(0, 10, 0);
    this.scene.add(light);
    this.scene.add(new THREE.AmbientLight(0x64748b, 0.85));

    this._initGridMeshes();
    this._initWallsMeshes();
    this._initBaseMeshes();

    this._previewMode = true;
    this._renderPreview();
  }

  _renderPreview() {
    if (!this._previewMode) return;
    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(() => this._renderPreview());
  }

  _gridToWorld(gx, gy) {
    const offsetX = -(this.gridWidth * this.tileSize) / 2 + this.tileSize / 2;
    const offsetZ = -(this.gridHeight * this.tileSize) / 2 + this.tileSize / 2;
    return {
      x: offsetX + gx * this.tileSize,
      z: offsetZ + gy * this.tileSize,
    };
  }

  _worldToGrid(x, z) {
    const offsetX = (this.gridWidth * this.tileSize) / 2;
    const offsetZ = (this.gridHeight * this.tileSize) / 2;
    const gx = Math.floor((x + offsetX) / this.tileSize);
    const gy = Math.floor((z + offsetZ) / this.tileSize);
    return { x: gx, y: gy };
  }

  _snapToTileCenter(x, z) {
    const g = this._worldToGrid(x, z);
    const clamped = {
      x: clamp(g.x, 0, this.gridWidth - 1),
      y: clamp(g.y, 0, this.gridHeight - 1),
    };
    return this._gridToWorld(clamped.x, clamped.y);
  }

  _initGridMeshes() {
    const tileGeom = new THREE.PlaneGeometry(this.tileSize * 0.98, this.tileSize * 0.98);
    const baseMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      metalness: 0.05,
      roughness: 0.9,
    });

    this.tileMeshes = [];

    for (let x = 0; x < this.gridWidth; x++) {
      this.tileMeshes[x] = [];
      for (let y = 0; y < this.gridHeight; y++) {
        const tile = new THREE.Mesh(tileGeom, baseMat.clone());
        tile.rotation.x = -Math.PI / 2;
        const p = this._gridToWorld(x, y);
        tile.position.set(p.x, 0, p.z);
        this.scene.add(tile);
        this.tileMeshes[x][y] = tile;
      }
    }

    // border
    const borderMat = new THREE.MeshBasicMaterial({ color: 0x334155 });
    const thickness = 0.08;
    const w = this.gridWidth * this.tileSize;
    const h = this.gridHeight * this.tileSize;

    const borders = [
      { w: w + thickness * 2, h: thickness, x: 0, z: -h / 2 - thickness / 2 },
      { w: w + thickness * 2, h: thickness, x: 0, z: h / 2 + thickness / 2 },
      { w: thickness, h: h, x: -w / 2 - thickness / 2, z: 0 },
      { w: thickness, h: h, x: w / 2 + thickness / 2, z: 0 },
    ];

    for (const b of borders) {
      const geom = new THREE.PlaneGeometry(b.w, b.h);
      const mesh = new THREE.Mesh(geom, borderMat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(b.x, 0.01, b.z);
      this.scene.add(mesh);
    }
  }

  _createDefaultWalls() {
    const walls = [];
    for (let x = 0; x < this.gridWidth; x++) {
      walls[x] = [];
      for (let y = 0; y < this.gridHeight; y++) walls[x][y] = false;
    }

    // perimeter walls (for vision blocking + collision)
    for (let x = 0; x < this.gridWidth; x++) {
      walls[x][0] = true;
      walls[x][this.gridHeight - 1] = true;
    }
    for (let y = 0; y < this.gridHeight; y++) {
      walls[0][y] = true;
      walls[this.gridWidth - 1][y] = true;
    }

    const addRect = (x1, y1, x2, y2) => {
      for (let x = x1; x <= x2; x++) {
        for (let y = y1; y <= y2; y++) {
          if (x >= 0 && x < this.gridWidth && y >= 0 && y < this.gridHeight) {
            walls[x][y] = true;
          }
        }
      }
    };

    // === BIGGER MAP WITH OPEN AND CLOSED AREAS ===
    // Map is 48x32 tiles (24x16 world units)
    
    // ---- CENTRAL OPEN ARENA ----
    // Small pillars around center for cover, but mostly open
    addRect(22, 14, 25, 17);  // central block (gold vault)
    
    // ---- LEFT SIDE (Guard territory) - more closed/maze-like ----
    // Guard base area is clear (around grid x=4, y=16 which is world -10, 0)
    // Walls start further from base
    addRect(8, 10, 9, 13);    // left corridor wall upper (moved right)
    addRect(8, 18, 9, 21);    // left corridor wall lower (moved right)
    
    // Left maze corridors
    addRect(12, 5, 13, 10);   // upper left corridor wall
    addRect(12, 21, 13, 26);  // lower left corridor wall
    addRect(16, 8, 17, 12);   // inner left wall upper
    addRect(16, 19, 17, 23);  // inner left wall lower
    
    // Left rooms/alcoves (moved to not block spawn)
    addRect(8, 3, 11, 5);     // top left room
    addRect(8, 26, 11, 28);   // bottom left room
    
    // ---- RIGHT SIDE (Infiltrator territory) - more open with cover spots ----
    // Scattered cover for sneaking
    addRect(35, 6, 37, 8);    // upper right cover
    addRect(35, 23, 37, 25);  // lower right cover
    addRect(40, 12, 41, 14);  // right side pillar upper
    addRect(40, 17, 41, 19);  // right side pillar lower
    
    // Light corridor walls on right
    addRect(32, 10, 33, 13);  // right corridor wall upper
    addRect(32, 18, 33, 21);  // right corridor wall lower
    
    // ---- MIDDLE TRANSITION ZONE - mix of open and closed ----
    // Upper passage
    addRect(17, 3, 18, 7);    // upper mid-left wall
    addRect(29, 3, 30, 7);    // upper mid-right wall
    
    // Lower passage
    addRect(17, 24, 18, 28);  // lower mid-left wall
    addRect(29, 24, 30, 28);  // lower mid-right wall
    
    // Scattered pillars in transition zone
    addRect(20, 8, 21, 9);    // pillar
    addRect(26, 8, 27, 9);    // pillar
    addRect(20, 22, 21, 23);  // pillar
    addRect(26, 22, 27, 23);  // pillar
    
    // Central lane dividers (creates 3 main paths through middle)
    addRect(22, 6, 25, 7);    // upper divider
    addRect(22, 24, 25, 25);  // lower divider

    return walls;
  }

  _initWallsMeshes() {
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      emissive: 0x020617,
      roughness: 0.6,
      metalness: 0.05,
    });

    const wallGeom = new THREE.BoxGeometry(this.tileSize, 0.6, this.tileSize);
    this.wallMeshes = [];

    for (let x = 0; x < this.gridWidth; x++) {
      for (let y = 0; y < this.gridHeight; y++) {
        if (!this.walls[x][y]) continue;
        const p = this._gridToWorld(x, y);
        const mesh = new THREE.Mesh(wallGeom, wallMat);
        mesh.position.set(p.x, 0.3, p.z);
        this.scene.add(mesh);
        this.wallMeshes.push(mesh);
      }
    }
  }

  _initBaseMeshes() {
    const baseGeom = new THREE.CylinderGeometry(this.baseRadius, this.baseRadius, 0.08, 32);
    const guardMat = new THREE.MeshStandardMaterial({ color: 0x38bdf8, emissive: 0x1d4ed8, emissiveIntensity: 0.25 });
    const infilMat = new THREE.MeshStandardMaterial({ color: 0xf97373, emissive: 0x991b1b, emissiveIntensity: 0.25 });

    const gBase = new THREE.Mesh(baseGeom, guardMat);
    gBase.position.set(this.bases[TEAM_GUARDS].x, 0.04, this.bases[TEAM_GUARDS].z);
    this.scene.add(gBase);

    const iBase = new THREE.Mesh(baseGeom, infilMat);
    iBase.position.set(this.bases[TEAM_INFILTRATORS].x, 0.04, this.bases[TEAM_INFILTRATORS].z);
    this.scene.add(iBase);

    // Spawn protection zone visual (guards cannot enter)
    const protectGeom = new THREE.RingGeometry(this.spawnProtectionRadius - 0.05, this.spawnProtectionRadius, 48);
    const protectMat = new THREE.MeshBasicMaterial({ 
      color: 0xff4444, 
      transparent: true, 
      opacity: 0.3,
      side: THREE.DoubleSide 
    });
    const protectZone = new THREE.Mesh(protectGeom, protectMat);
    protectZone.rotation.x = -Math.PI / 2;
    protectZone.position.set(this.bases[TEAM_INFILTRATORS].x, 0.01, this.bases[TEAM_INFILTRATORS].z);
    this.scene.add(protectZone);

    this.baseMeshes = { guards: gBase, infiltrators: iBase };
  }

  _clearAgentsAndGold() {
    for (const a of this.agents) this.scene.remove(a.mesh);
    for (const g of this.gold) this.scene.remove(g.mesh);
    this.agents = [];
    this.gold = [];
  }

  _spawnTeams() {
    this._clearAgentsAndGold();

    const agentGeom = new THREE.CylinderGeometry(this.agentRadius, this.agentRadius, 0.25, 24);

    const spawnGuard = (i) => {
      const ai = this.guardAIs[i];
      const mat = new THREE.MeshStandardMaterial({
        color: 0x38bdf8,
        emissive: 0x38bdf8,
        emissiveIntensity: 0.5,
        roughness: 0.55,
      });
      const mesh = new THREE.Mesh(agentGeom, mat);
      const spawn = this._snapToTileCenter(this.bases[TEAM_GUARDS].x - 1.5, (i - (this.guardAIs.length - 1) / 2) * 0.9);
      mesh.position.set(spawn.x, 0.14, spawn.z);
      this.scene.add(mesh);

      this.agents.push({
        id: `g${i + 1}`,
        team: TEAM_GUARDS,
        role: "guard",
        ai,
        mesh,
        heading: { x: -1, z: 0 },
        carryingGoldId: null,
        spawn,
        lastPos: { x: spawn.x, z: spawn.z },
        stuckSec: 0,
        avoidSec: 0,
        avoidDir: { x: 0, z: 0 },
      });
    };

    const spawnInfil = (i) => {
      const ai = this.infiltratorAIs[i];
      const mat = new THREE.MeshStandardMaterial({
        color: 0xf97373,
        emissive: 0xf97373,
        emissiveIntensity: 0.45,
        roughness: 0.55,
      });
      const mesh = new THREE.Mesh(agentGeom, mat);
      const spawn = this._snapToTileCenter(this.bases[TEAM_INFILTRATORS].x + 1.5, (i - (this.infiltratorAIs.length - 1) / 2) * 0.9);
      mesh.position.set(spawn.x, 0.14, spawn.z);
      this.scene.add(mesh);

      this.agents.push({
        id: `i${i + 1}`,
        team: TEAM_INFILTRATORS,
        role: "infiltrator",
        ai,
        mesh,
        heading: { x: 1, z: 0 },
        carryingGoldId: null,
        spawn,
        lastPos: { x: spawn.x, z: spawn.z },
        stuckSec: 0,
        avoidSec: 0,
        avoidDir: { x: 0, z: 0 },
      });
    };

    for (let i = 0; i < this.guardAIs.length; i++) spawnGuard(i);
    for (let i = 0; i < this.infiltratorAIs.length; i++) spawnInfil(i);

    // spawn gold nodes at random locations
    const goldGeom = new THREE.IcosahedronGeometry(0.22, 0);
    const goldMat = new THREE.MeshStandardMaterial({
      color: 0xfbbf24,
      emissive: 0xf59e0b,
      emissiveIntensity: 0.7,
      roughness: 0.4,
      metalness: 0.2,
    });

    for (let i = 0; i < this.goldCount; i++) {
      const pos = this._getRandomGoldSpawn();
      const mesh = new THREE.Mesh(goldGeom, goldMat.clone());
      mesh.position.set(pos.x, 0.25, pos.z);
      this.scene.add(mesh);
      this.gold.push({ 
        id: `gold${i + 1}`, 
        mesh, 
        x: pos.x, 
        z: pos.z, 
        active: true 
      });
    }
  }

  // Get a random valid spawn location for gold (not in walls, not too close to bases)
  _getRandomGoldSpawn() {
    const halfW = (this.gridWidth * this.tileSize) / 2;
    const halfH = (this.gridHeight * this.tileSize) / 2;
    const margin = 2;  // stay away from edges
    const baseExclusion = 3;  // stay away from bases
    
    for (let attempts = 0; attempts < 100; attempts++) {
      // Random position within map bounds
      const x = (Math.random() - 0.5) * (halfW * 2 - margin * 2);
      const z = (Math.random() - 0.5) * (halfH * 2 - margin * 2);
      
      // Check not too close to either base
      const distToGuardBase = Math.hypot(x - this.bases[TEAM_GUARDS].x, z - this.bases[TEAM_GUARDS].z);
      const distToInfilBase = Math.hypot(x - this.bases[TEAM_INFILTRATORS].x, z - this.bases[TEAM_INFILTRATORS].z);
      if (distToGuardBase < baseExclusion || distToInfilBase < baseExclusion) continue;
      
      // Check not in a wall
      const g = this._worldToGrid(x, z);
      if (this._isWall(g.x, g.y)) continue;
      
      // Check not too close to existing gold
      let tooClose = false;
      for (const gold of this.gold) {
        if (Math.hypot(x - gold.x, z - gold.z) < 2) {
          tooClose = true;
          break;
        }
      }
      if (tooClose) continue;
      
      return this._snapToTileCenter(x, z);
    }
    
    // Fallback to center if no valid spot found
    return this._snapToTileCenter(0, 0);
  }

  start() {
    this._previewMode = false;
    this.gameRunning = true;
    this.timeRemaining = this.matchTime;
    this.scoreGuards = 0;
    this.scoreInfiltrators = 0;
    this.lastEvent = "Match started";
    this._lastSpotTime = -999;

    this._spawnTeams();

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
    if (this.rafId) cancelAnimationFrame(this.rafId);
  }

  _endGame() {
    this.gameRunning = false;
    this.onGameEnd?.({ scoreGuards: this.scoreGuards, scoreInfiltrators: this.scoreInfiltrators });
  }

  _isWall(gx, gy) {
    if (gx < 0 || gx >= this.gridWidth || gy < 0 || gy >= this.gridHeight) return true;
    return !!this.walls[gx][gy];
  }

  _hasLineOfSight(ax, az, bx, bz) {
    const a = this._worldToGrid(ax, az);
    const b = this._worldToGrid(bx, bz);
    if (a.x === b.x && a.y === b.y) return true;

    const points = bresenhamLine(a.x, a.y, b.x, b.y);
    // skip first cell (agent cell), include last cell (target)
    for (let i = 1; i < points.length; i++) {
      const p = points[i];
      if (this._isWall(p.x, p.y)) return false;
    }

    return true;
  }

  _computeTeamVision() {
    // Reset
    for (const team of [TEAM_GUARDS, TEAM_INFILTRATORS]) {
      this.teamVision[team].visibleCells = new Set();
      this.teamVision[team].visibleEnemies = [];
      this.teamVision[team].visibleGold = [];
    }

    // Build per-agent visibility
    for (const agent of this.agents) {
      const team = agent.team;
      const otherTeam = team === TEAM_GUARDS ? TEAM_INFILTRATORS : TEAM_GUARDS;

      // Team-specific vision parameters
      const visionRange = team === TEAM_GUARDS ? this.guardVisionRange : this.infiltratorVisionRange;
      const visionFov = team === TEAM_GUARDS ? this.guardVisionFov : this.infiltratorVisionFov;

      const ax = agent.mesh.position.x;
      const az = agent.mesh.position.z;

      // cells in a circle around agent, filtered by FOV and LOS
      const center = this._worldToGrid(ax, az);
      const cellRange = Math.ceil(visionRange / this.tileSize);

      for (let dx = -cellRange; dx <= cellRange; dx++) {
        for (let dy = -cellRange; dy <= cellRange; dy++) {
          const gx = center.x + dx;
          const gy = center.y + dy;
          if (gx < 0 || gx >= this.gridWidth || gy < 0 || gy >= this.gridHeight) continue;
          if (this._isWall(gx, gy)) continue;

          const wp = this._gridToWorld(gx, gy);
          const ddx = wp.x - ax;
          const ddz = wp.z - az;
          const d = Math.hypot(ddx, ddz);
          if (d > visionRange) continue;

          const ang = angleBetween2(agent.heading.x, agent.heading.z, ddx, ddz);
          if (ang > visionFov / 2) continue;

          if (!this._hasLineOfSight(ax, az, wp.x, wp.z)) continue;

          this.teamVision[team].visibleCells.add(`${gx},${gy}`);
        }
      }

      // visible enemies
      for (const enemy of this.agents.filter((a) => a.team === otherTeam)) {
        const ex = enemy.mesh.position.x;
        const ez = enemy.mesh.position.z;
        if (distSq2(ax, az, ex, ez) > visionRange * visionRange) continue;

        const ddx = ex - ax;
        const ddz = ez - az;
        const ang = angleBetween2(agent.heading.x, agent.heading.z, ddx, ddz);
        if (ang > visionFov / 2) continue;

        if (!this._hasLineOfSight(ax, az, ex, ez)) continue;

        this.teamVision[team].visibleEnemies.push({
          id: enemy.id,
          team: enemy.team,
          x: ex,
          z: ez,
          carryingGold: !!enemy.carryingGoldId,
        });
      }

      // visible gold
      for (const g of this.gold) {
        if (!g.active) continue;
        if (distSq2(ax, az, g.x, g.z) > visionRange * visionRange) continue;

        const ddx = g.x - ax;
        const ddz = g.z - az;
        const ang = angleBetween2(agent.heading.x, agent.heading.z, ddx, ddz);
        if (ang > visionFov / 2) continue;

        if (!this._hasLineOfSight(ax, az, g.x, g.z)) continue;

        this.teamVision[team].visibleGold.push({ id: g.id, x: g.x, z: g.z });
      }
    }

    // Dedup arrays by id
    for (const team of [TEAM_GUARDS, TEAM_INFILTRATORS]) {
      const dedupEnemies = new Map();
      for (const e of this.teamVision[team].visibleEnemies) dedupEnemies.set(e.id, e);
      this.teamVision[team].visibleEnemies = [...dedupEnemies.values()];

      const dedupGold = new Map();
      for (const g of this.teamVision[team].visibleGold) dedupGold.set(g.id, g);
      this.teamVision[team].visibleGold = [...dedupGold.values()];
    }
  }

  _buildAIState(agent, dt) {
    const team = agent.team;
    const otherTeam = team === TEAM_GUARDS ? TEAM_INFILTRATORS : TEAM_GUARDS;

    const self = {
      id: agent.id,
      team: agent.team,
      role: agent.role,
      x: agent.mesh.position.x,
      z: agent.mesh.position.z,
      heading: { ...agent.heading },
      carryingGoldId: agent.carryingGoldId,
    };

    const teammates = this.agents
      .filter((a) => a.team === team && a.id !== agent.id)
      .map((a) => ({
        id: a.id,
        x: a.mesh.position.x,
        z: a.mesh.position.z,
        heading: { ...a.heading },
        carryingGoldId: a.carryingGoldId,
      }));

    // Pathfinding helper for AIs
    const walls = this.walls;
    const gridWidth = this.gridWidth;
    const gridHeight = this.gridHeight;
    const tileSize = this.tileSize;

    const findPath = (goalX, goalZ) => {
      return astarPath(walls, gridWidth, gridHeight, tileSize, self.x, self.z, goalX, goalZ);
    };

    const getDirectionToward = (goalX, goalZ) => {
      const path = findPath(goalX, goalZ);
      return getPathDirection(path, self.x, self.z);
    };

    const state = {
      dt,
      timeRemaining: this.timeRemaining,
      scores: { guards: this.scoreGuards, infiltrators: this.scoreInfiltrators },
      map: {
        gridWidth: this.gridWidth,
        gridHeight: this.gridHeight,
        tileSize: this.tileSize,
        // walls are shared knowledge (lets AIs pathfind)
        walls: this.walls,
        bases: this.bases,
      },
      self,
      teammates,
      teamVision: {
        visibleCells: this.teamVision[team].visibleCells,
        visibleEnemies: this.teamVision[team].visibleEnemies,
        visibleGold: this.teamVision[team].visibleGold,
      },
      // Convenience lists (already filtered by shared vision)
      visibleEnemies: this.teamVision[team].visibleEnemies,
      visibleGold: this.teamVision[team].visibleGold,
      // Opponent base location is known
      enemyBase: this.bases[otherTeam],
      myBase: this.bases[team],
      // Pathfinding helpers
      findPath,
      getDirectionToward,
    };

    return state;
  }

  _applyAIMove(agent, dt) {
    if (!agent.ai || typeof agent.ai.tick !== "function") return;

    const state = this._buildAIState(agent, dt);
    let dir = null;
    try {
      dir = agent.ai.tick(state);
    } catch (e) {
      // If an AI crashes, just stop it
      dir = { x: 0, z: 0 };
    }

    if (!dir) return;

    if (agent.avoidSec > 0) {
      agent.avoidSec = Math.max(0, agent.avoidSec - dt);
      dir = agent.avoidDir;
    }

    const x = Number(dir.x) || 0;
    const z = Number(dir.z) || 0;
    if (x === 0 && z === 0) return;

    const v = normalize2(x, z);
    const speed = this.maxSpeed;

    const prevX = agent.mesh.position.x;
    const prevZ = agent.mesh.position.z;

    const stepX = v.x * speed * dt;
    const stepZ = v.z * speed * dt;

    agent.mesh.position.x = prevX + stepX;
    this._clampAndCollide(agent);
    const afterX = agent.mesh.position.x;
    const blockedX = Math.abs(afterX - (prevX + stepX)) > 1e-6;

    agent.mesh.position.z = prevZ + stepZ;
    this._clampAndCollide(agent);
    const afterZ = agent.mesh.position.z;
    const blockedZ = Math.abs(afterZ - (prevZ + stepZ)) > 1e-6;

    if (blockedX && blockedZ) {
      agent.mesh.position.x = prevX;
      agent.mesh.position.z = prevZ;
      const sign = agent.id && agent.id.charCodeAt(0) % 2 === 0 ? 1 : -1;
      const nx = -v.z * sign;
      const nz = v.x * sign;
      agent.avoidSec = 0.45;
      agent.avoidDir = normalize2(nx, nz);

      agent.mesh.position.x = prevX + agent.avoidDir.x * speed * dt * 0.9;
      agent.mesh.position.z = prevZ + agent.avoidDir.z * speed * dt * 0.9;
      this._clampAndCollide(agent);
    }

    agent.heading = { x: v.x, z: v.z };

    const dx = agent.mesh.position.x - (agent.lastPos?.x ?? agent.mesh.position.x);
    const dz = agent.mesh.position.z - (agent.lastPos?.z ?? agent.mesh.position.z);
    const movedSq = dx * dx + dz * dz;
    agent.lastPos = { x: agent.mesh.position.x, z: agent.mesh.position.z };

    if (movedSq < 0.00002) {
      agent.stuckSec = (agent.stuckSec || 0) + dt;
    } else {
      agent.stuckSec = 0;
    }

    if (agent.stuckSec > 0.6) {
      const sign = agent.id && agent.id.charCodeAt(0) % 2 === 0 ? 1 : -1;
      const nx = -agent.heading.z * sign;
      const nz = agent.heading.x * sign;
      agent.avoidSec = 0.55;
      agent.avoidDir = normalize2(nx, nz);
      agent.mesh.position.x += agent.avoidDir.x * this.tileSize * 1.2;
      agent.mesh.position.z += agent.avoidDir.z * this.tileSize * 1.2;
      this._clampAndCollide(agent);
      agent.stuckSec = 0;
    }
  }

  _clampAndCollide(agent) {
    const halfW = (this.gridWidth * this.tileSize) / 2 - this.agentRadius;
    const halfH = (this.gridHeight * this.tileSize) / 2 - this.agentRadius;

    agent.mesh.position.x = clamp(agent.mesh.position.x, -halfW, halfW);
    agent.mesh.position.z = clamp(agent.mesh.position.z, -halfH, halfH);

    // Spawn protection: guards cannot enter infiltrator spawn zone
    if (agent.team === TEAM_GUARDS) {
      const infilBase = this.bases[TEAM_INFILTRATORS];
      const dx = agent.mesh.position.x - infilBase.x;
      const dz = agent.mesh.position.z - infilBase.z;
      const dist = Math.hypot(dx, dz);
      if (dist < this.spawnProtectionRadius) {
        // Push guard back to edge of protection zone
        const pushDist = this.spawnProtectionRadius + 0.1;
        const angle = Math.atan2(dz, dx);
        agent.mesh.position.x = infilBase.x + Math.cos(angle) * pushDist;
        agent.mesh.position.z = infilBase.z + Math.sin(angle) * pushDist;
      }
    }

    // simple wall collision: if inside a wall cell, push back to previous tile center
    const g = this._worldToGrid(agent.mesh.position.x, agent.mesh.position.z);
    if (this._isWall(g.x, g.y)) {
      const snap = this._snapToTileCenter(agent.mesh.position.x, agent.mesh.position.z);
      // Move to nearest non-wall by searching local neighborhood
      let best = null;
      let bestD = Infinity;
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const gx = g.x + dx;
          const gy = g.y + dy;
          if (this._isWall(gx, gy)) continue;
          const p = this._gridToWorld(gx, gy);
          const d = distSq2(agent.mesh.position.x, agent.mesh.position.z, p.x, p.z);
          if (d < bestD) {
            bestD = d;
            best = p;
          }
        }
      }

      if (best) {
        agent.mesh.position.x = best.x;
        agent.mesh.position.z = best.z;
      } else {
        agent.mesh.position.x = snap.x;
        agent.mesh.position.z = snap.z;
      }
    }
  }

  _handleSpotting(nowSec) {
    // Guards spotting infiltrators
    if (nowSec - this._lastSpotTime < this.spotCooldownSec) return;

    const guardsVisibleEnemies = this.teamVision[TEAM_GUARDS].visibleEnemies;
    if (!guardsVisibleEnemies.length) return;

    // Find the first infiltrator and reset it
    const target = guardsVisibleEnemies.find((e) => e.team === TEAM_INFILTRATORS);
    if (!target) return;

    const infil = this.agents.find((a) => a.id === target.id);
    if (!infil) return;

    // Check if guard is close enough to actually catch
    const closestGuard = this.agents
      .filter(a => a.team === TEAM_GUARDS)
      .reduce((closest, guard) => {
        const d = Math.hypot(guard.mesh.position.x - infil.mesh.position.x, guard.mesh.position.z - infil.mesh.position.z);
        return d < closest.dist ? { guard, dist: d } : closest;
      }, { guard: null, dist: Infinity });
    
    if (closestGuard.dist > this.spotDistanceRequired) return;  // too far to catch

    // Guards get a point for catching, infiltrators don't lose points (less punishing)
    this.scoreGuards += 1;

    // drop gold if carrying
    if (infil.carryingGoldId) {
      const gold = this.gold.find((g) => g.id === infil.carryingGoldId);
      if (gold) {
        gold.active = true;
        gold.x = infil.mesh.position.x;
        gold.z = infil.mesh.position.z;
        gold.mesh.visible = true;
        gold.mesh.position.set(gold.x, 0.25, gold.z);
      }
      infil.carryingGoldId = null;
    }

    // Visual effect for spotting - red flash and particles
    this._spawnFlash(infil.mesh.position.x, infil.mesh.position.z, 0xff3333, 1.2);
    this._spawnParticles(infil.mesh.position.x, infil.mesh.position.z, 0xff5555, 15);

    // reset infiltrator to spawn
    infil.mesh.position.x = infil.spawn.x;
    infil.mesh.position.z = infil.spawn.z;
    infil.heading = { x: 1, z: 0 };

    this._lastSpotTime = nowSec;
    this.lastEvent = `Guard caught ${infil.id}! (+1 for guards)`;
  }

  _handleGold() {
    // pickup
    for (const infil of this.agents.filter((a) => a.team === TEAM_INFILTRATORS)) {
      if (infil.carryingGoldId) continue;

      for (const g of this.gold) {
        if (!g.active) continue;
        if (distSq2(infil.mesh.position.x, infil.mesh.position.z, g.x, g.z) < this.goldPickupRadius * this.goldPickupRadius) {
          // Visual effect for gold pickup - gold sparkle
          this._spawnParticles(g.x, g.z, 0xffd700, 10);
          this._spawnFlash(g.x, g.z, 0xffaa00, 0.8);
          
          g.active = false;
          g.mesh.visible = false;
          infil.carryingGoldId = g.id;
          this.lastEvent = `${infil.id} picked up gold`;
          break;
        }
      }
    }

    // deposit
    const base = this.bases[TEAM_INFILTRATORS];
    for (const infil of this.agents.filter((a) => a.team === TEAM_INFILTRATORS)) {
      if (!infil.carryingGoldId) continue;
      if (distSq2(infil.mesh.position.x, infil.mesh.position.z, base.x, base.z) < this.baseRadius * this.baseRadius) {
        // Visual effect for scoring - big green celebration
        this._spawnFlash(base.x, base.z, 0x22ff66, 2.0);
        this._spawnParticles(base.x, base.z, 0x44ff88, 20);
        this._spawnParticles(base.x, base.z, 0xffd700, 10);
        
        this.scoreInfiltrators += 1;
        const gold = this.gold.find((g) => g.id === infil.carryingGoldId);
        if (gold) {
          // respawn gold at a new random location
          const newPos = this._getRandomGoldSpawn();
          gold.x = newPos.x;
          gold.z = newPos.z;
          gold.active = true;
          gold.mesh.visible = true;
          gold.mesh.position.set(gold.x, 0.25, gold.z);
          
          // Visual effect at new spawn location
          this._spawnParticles(gold.x, gold.z, 0xffd700, 8);
        }
        infil.carryingGoldId = null;
        this.lastEvent = `${infil.id} scored! (+1)`;
      }
    }
  }

  _updateTileTint() {
    // Very subtle tint for visible cells per team (guards=blue, infil=red)
    const gVis = this.teamVision[TEAM_GUARDS].visibleCells;
    const iVis = this.teamVision[TEAM_INFILTRATORS].visibleCells;

    for (let x = 0; x < this.gridWidth; x++) {
      for (let y = 0; y < this.gridHeight; y++) {
        const key = `${x},${y}`;
        const tile = this.tileMeshes[x][y];
        if (!tile) continue;

        if (this._isWall(x, y)) {
          tile.material.color.setHex(0x0b1222);
          continue;
        }

        const gv = gVis.has(key);
        const iv = iVis.has(key);
        if (gv && iv) {
          tile.material.color.setHex(0x1f2937);
        } else if (gv) {
          tile.material.color.setHex(0x0b2a3f);
        } else if (iv) {
          tile.material.color.setHex(0x3b0b1d);
        } else {
          tile.material.color.setHex(0x0f172a);
        }
      }
    }
  }

  update(dt) {
    if (!this.gameRunning) return;

    this.timeRemaining -= dt;
    if (this.timeRemaining <= 0) {
      this.timeRemaining = 0;
      this._endGame();
      return;
    }

    // Compute vision based on last headings
    this._computeTeamVision();

    // Apply AI moves
    for (const agent of this.agents) {
      this._applyAIMove(agent, dt);
    }

    // Recompute vision after movement
    this._computeTeamVision();

    // Mechanics
    const nowSec = performance.now() / 1000;
    this._handleSpotting(nowSec);
    this._handleGold();

    // Visualize shared vision
    this._updateTileTint();

    // Update gold rotation animation
    this._updateGoldVisuals(dt);

    // Update agent visuals (gold carrier glow)
    this._updateAgentVisuals(dt);

    // Update visual effects
    this._updateParticles(dt);
    this._updateFlashEffects(dt);

    this.onTick?.({
      timeRemaining: this.timeRemaining,
      scoreGuards: this.scoreGuards,
      scoreInfiltrators: this.scoreInfiltrators,
      lastEvent: this.lastEvent,
    });
  }

  // Visual effects system
  _spawnParticles(x, z, color, count = 12) {
    const particleMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1 });
    for (let i = 0; i < count; i++) {
      const size = 0.04 + Math.random() * 0.04;
      const geom = new THREE.SphereGeometry(size, 6, 6);
      const mesh = new THREE.Mesh(geom, particleMat.clone());
      mesh.position.set(x, 0.3 + Math.random() * 0.2, z);
      
      const angle = Math.random() * Math.PI * 2;
      const speed = 1.5 + Math.random() * 2;
      const particle = {
        mesh,
        vx: Math.cos(angle) * speed,
        vy: 2 + Math.random() * 2,
        vz: Math.sin(angle) * speed,
        life: 0.6 + Math.random() * 0.4,
        maxLife: 0.6 + Math.random() * 0.4,
      };
      
      this.scene.add(mesh);
      this.particles.push(particle);
    }
  }

  _updateParticles(dt) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      
      if (p.life <= 0) {
        this.scene.remove(p.mesh);
        p.mesh.geometry.dispose();
        p.mesh.material.dispose();
        this.particles.splice(i, 1);
        continue;
      }
      
      p.vy -= 8 * dt; // gravity
      p.mesh.position.x += p.vx * dt;
      p.mesh.position.y += p.vy * dt;
      p.mesh.position.z += p.vz * dt;
      
      // Fade out
      p.mesh.material.opacity = p.life / p.maxLife;
      
      // Bounce off ground
      if (p.mesh.position.y < 0.05) {
        p.mesh.position.y = 0.05;
        p.vy = Math.abs(p.vy) * 0.4;
      }
    }
  }

  _spawnFlash(x, z, color, size = 1.5) {
    const geom = new THREE.RingGeometry(0.1, size, 24);
    const mat = new THREE.MeshBasicMaterial({ 
      color, 
      transparent: true, 
      opacity: 0.8,
      side: THREE.DoubleSide 
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 0.02, z);
    
    this.scene.add(mesh);
    this.flashEffects.push({
      mesh,
      life: 0.4,
      maxLife: 0.4,
      maxSize: size,
    });
  }

  _updateFlashEffects(dt) {
    for (let i = this.flashEffects.length - 1; i >= 0; i--) {
      const f = this.flashEffects[i];
      f.life -= dt;
      
      if (f.life <= 0) {
        this.scene.remove(f.mesh);
        f.mesh.geometry.dispose();
        f.mesh.material.dispose();
        this.flashEffects.splice(i, 1);
        continue;
      }
      
      const progress = 1 - (f.life / f.maxLife);
      f.mesh.material.opacity = 0.8 * (1 - progress);
      f.mesh.scale.setScalar(1 + progress * 2);
    }
  }

  _updateAgentVisuals(dt) {
    const time = performance.now() / 1000;
    
    for (const agent of this.agents) {
      // Pulsing scale for gold carriers
      if (agent.carryingGoldId) {
        const pulse = 1 + Math.sin(time * 6) * 0.1;
        agent.mesh.scale.setScalar(pulse);
        
        // Occasional gold sparkle trail
        if (Math.random() < 0.15) {
          const ox = (Math.random() - 0.5) * 0.2;
          const oz = (Math.random() - 0.5) * 0.2;
          this._spawnParticles(
            agent.mesh.position.x + ox, 
            agent.mesh.position.z + oz, 
            0xffd700, 
            1
          );
        }
      } else {
        agent.mesh.scale.setScalar(1);
      }
    }
  }

  _updateGoldVisuals(dt) {
    const time = performance.now() / 1000;
    
    for (const g of this.gold) {
      if (!g.active) continue;
      
      // Rotate gold
      g.mesh.rotation.y += dt * 1.5;
      
      // Gentle bobbing
      g.mesh.position.y = 0.25 + Math.sin(time * 2 + g.x) * 0.05;
    }
  }
}
