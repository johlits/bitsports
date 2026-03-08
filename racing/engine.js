import * as THREE from "https://esm.sh/three@0.160.0";

const DRIVER_COLORS = [0x38bdf8, 0xf97316, 0x22c55e, 0xe879f9, 0xfacc15, 0xfb7185];
const ITEM_TYPES = ["boost", "oil", "rocket"];
const VIEW_SIZE = 29;

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function normalize(x, z) {
  const len = Math.hypot(x, z);
  if (len < 1e-6) return { x: 0, z: 0 };
  return { x: x / len, z: z / len };
}

function rotatePoint(point, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return {
    x: point.x * c - point.z * s,
    z: point.x * s + point.z * c,
  };
}

function sampleClosedCurve(points, subdivisions = 10) {
  const sampled = [];
  for (let i = 0; i < points.length; i++) {
    const p0 = points[(i - 1 + points.length) % points.length];
    const p1 = points[i];
    const p2 = points[(i + 1) % points.length];
    const p3 = points[(i + 2) % points.length];
    for (let s = 0; s < subdivisions; s++) {
      const t = s / subdivisions;
      const t2 = t * t;
      const t3 = t2 * t;
      const x = 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
      const z = 0.5 * ((2 * p1.z) + (-p0.z + p2.z) * t + (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 + (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t3);
      sampled.push({ x, z });
    }
  }
  return sampled;
}

function buildRibbon(points, halfWidth) {
  const left = [];
  const right = [];
  const samples = [];
  for (let i = 0; i < points.length; i++) {
    const prev = points[(i - 1 + points.length) % points.length];
    const next = points[(i + 1) % points.length];
    const tangent = normalize(next.x - prev.x, next.z - prev.z);
    const normal = { x: -tangent.z, z: tangent.x };
    const center = points[i];
    const l = { x: center.x + normal.x * halfWidth, z: center.z + normal.z * halfWidth };
    const r = { x: center.x - normal.x * halfWidth, z: center.z - normal.z * halfWidth };
    left.push(l);
    right.push(r);
    samples.push({ ...center, tangent, normal, left: l, right: r, halfWidth });
  }
  return { left, right, samples };
}

function makeStripGeometry(left, right, y = 0) {
  const positions = [];
  const indices = [];
  for (let i = 0; i < left.length; i++) {
    positions.push(left[i].x, y, left[i].z);
    positions.push(right[i].x, y, right[i].z);
  }
  for (let i = 0; i < left.length; i++) {
    const ni = (i + 1) % left.length;
    const a = i * 2;
    const b = a + 1;
    const c = ni * 2;
    const d = c + 1;
    indices.push(a, c, b, b, c, d);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function makeTrack() {
  const controlPoints = [];
  const checkpointCount = 20;
  const roadWidth = 5.6;
  const startCheckpointIndex = 12;

  for (let i = 0; i < checkpointCount; i++) {
    const t = (i / checkpointCount) * Math.PI * 2;
    const p = {
      x: Math.sin(t) * 16.5,
      z: Math.sin(t * 2) * 9.4,
    };
    controlPoints.push(rotatePoint(p, Math.PI / 2));
  }

  const centerline = sampleClosedCurve(controlPoints, 8);
  const roadRibbon = buildRibbon(centerline, roadWidth * 0.5);
  const wallRibbon = buildRibbon(centerline, roadWidth * 0.5 + 0.38);

  const rawCheckpoints = [];
  for (let i = 0; i < checkpointCount; i++) {
    const sampleIndex = Math.floor((i / checkpointCount) * centerline.length) % centerline.length;
    const sample = roadRibbon.samples[sampleIndex];
    rawCheckpoints.push({
      x: sample.x,
      z: sample.z,
      nx: sample.normal.x,
      nz: sample.normal.z,
      halfWidth: roadWidth * 0.5,
      tangent: sample.tangent,
      sampleIndex,
    });
  }

  const checkpoints = [
    ...rawCheckpoints.slice(startCheckpointIndex),
    ...rawCheckpoints.slice(0, startCheckpointIndex)
  ];

  const itemBoxes = [1, 4, 7, 10, 13, 16].map((idx) => ({
    checkpointIndex: idx,
    x: checkpoints[idx].x,
    z: checkpoints[idx].z,
    active: true,
    respawn: 0,
  }));

  const bridgeSample = roadRibbon.samples[0];

  return {
    roadWidth,
    centerline,
    controlPoints,
    roadRibbon,
    wallRibbon,
    checkpoints,
    itemBoxes,
    bridge: {
      center: { x: bridgeSample.x, z: bridgeSample.z },
      tangent: bridgeSample.tangent,
      normal: bridgeSample.normal,
      deckLength: 14,
      deckWidth: roadWidth + 1.4,
      clearanceWidth: roadWidth + 4.2,
      clearanceLength: roadWidth + 1.8,
    },
    startCheckpointIndex,
    finishLine: checkpoints[0],
    bounds: { radius: 28 },
  };
}

export class RacingEngine {
  constructor({ container, driverAIs = [], lapCount = 3, onTick, onRaceEnd }) {
    this.container = container;
    this.driverAIs = driverAIs;
    this.lapCount = lapCount;
    this.onTick = onTick;
    this.onRaceEnd = onRaceEnd;

    this.track = makeTrack();
    this.karts = [];
    this.hazards = [];
    this.projectiles = [];
    this.timeElapsed = 0;
    this.gameRunning = false;
    this.lastTime = 0;
    this.cinematicMode = false;
    this.previewSpin = 0;

    this.kartRadius = 0.55;
    this.maxSpeed = 14;
    this.accel = 11;
    this.brakePower = 15;
    this.drag = 0.992;
    this.traction = 6;
    this.offRoadGrip = 0.45;
    this.turnRate = 2.45;

    this._initThree();
    this._initScene();
    this._initPreview();
  }

  _initThree() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const aspect = width / height;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x020617);
    this.scene.fog = new THREE.Fog(0x020617, 34, 78);

    this.camera = new THREE.OrthographicCamera(
      -VIEW_SIZE * aspect,
      VIEW_SIZE * aspect,
      VIEW_SIZE,
      -VIEW_SIZE,
      0.1,
      100
    );
    this.camera.position.set(0, 34, 0);
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
    this.camera.left = -VIEW_SIZE * aspect;
    this.camera.right = VIEW_SIZE * aspect;
    this.camera.top = VIEW_SIZE;
    this.camera.bottom = -VIEW_SIZE;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  _initScene() {
    this.scene.add(new THREE.AmbientLight(0xcbd5e1, 0.65));
    const light = new THREE.DirectionalLight(0xffffff, 1.0);
    light.position.set(8, 18, 10);
    this.scene.add(light);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(240, 240),
      new THREE.MeshStandardMaterial({ color: 0x064e3b, roughness: 1, metalness: 0 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.02;
    this.scene.add(floor);

    const bridge = this.track.bridge;
    const bridgeAngle = Math.atan2(bridge.tangent.z, bridge.tangent.x);

    const abutmentThickness = 1.6;
    const abutmentGeom = new THREE.BoxGeometry(bridge.deckWidth, 1.4, abutmentThickness);
    const abutmentMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.85, metalness: 0.08 });
    const offsetDist = this.track.roadWidth * 0.5 + abutmentThickness * 0.5;

    const ab1 = new THREE.Mesh(abutmentGeom, abutmentMat);
    ab1.position.set(
      bridge.center.x + bridge.tangent.x * offsetDist,
      0.55,
      bridge.center.z + bridge.tangent.z * offsetDist
    );
    ab1.rotation.y = -bridgeAngle + Math.PI / 2;
    this.scene.add(ab1);

    const ab2 = new THREE.Mesh(abutmentGeom, abutmentMat);
    ab2.position.set(
      bridge.center.x - bridge.tangent.x * offsetDist,
      0.55,
      bridge.center.z - bridge.tangent.z * offsetDist
    );
    ab2.rotation.y = -bridgeAngle + Math.PI / 2;
    this.scene.add(ab2);

    const bridgeDeck = new THREE.Mesh(
      new THREE.BoxGeometry(bridge.deckWidth, 0.7, bridge.deckLength),
      new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.7, metalness: 0.1 })
    );
    bridgeDeck.position.set(bridge.center.x, 1.1, bridge.center.z);
    bridgeDeck.rotation.y = -bridgeAngle + Math.PI / 2;
    this.scene.add(bridgeDeck);

    const pillarGeom = new THREE.BoxGeometry(0.9, 1.8, 0.9);
    const pillarMat = new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.9, metalness: 0.05 });
    const pillarOffsets = [
      [-3.2, -4.4],
      [3.2, -4.4],
      [-3.2, 4.4],
      [3.2, 4.4],
    ];
    for (const [x, z] of pillarOffsets) {
      const pillar = new THREE.Mesh(pillarGeom, pillarMat);
      const offset = rotatePoint({ x, z }, bridgeAngle);
      pillar.position.set(bridge.center.x + offset.x, 0.45, bridge.center.z + offset.z);
      this.scene.add(pillar);
    }

    this._buildTrackMesh();
    this._buildCheckpoints();
    this._buildItemBoxes();
  }

  _buildTrackMesh() {
    const { roadRibbon, wallRibbon, centerline } = this.track;

    const roadBase = new THREE.Mesh(
      makeStripGeometry(wallRibbon.left, wallRibbon.right, 0),
      new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.88, metalness: 0.05 })
    );
    this.scene.add(roadBase);

    const trackMesh = new THREE.Mesh(
      makeStripGeometry(roadRibbon.left, roadRibbon.right, 0.04),
      new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.78, metalness: 0.12 })
    );
    this.scene.add(trackMesh);

    const centerGeom = new THREE.BufferGeometry().setFromPoints(centerline.map((p) => new THREE.Vector3(p.x, 0.08, p.z)).concat([new THREE.Vector3(centerline[0].x, 0.08, centerline[0].z)]));
    const centerLine = new THREE.Line(centerGeom, new THREE.LineDashedMaterial({ color: 0x94a3b8, dashSize: 0.6, gapSize: 0.4 }));
    centerLine.computeLineDistances();
    this.scene.add(centerLine);

    const finish = this.track.finishLine;
    const finishGeom = new THREE.BoxGeometry(1.1, 0.05, this.track.roadWidth + 0.6);
    const finishMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const finishMesh = new THREE.Mesh(finishGeom, finishMat);
    finishMesh.position.set(finish.x, 0.14, finish.z);
    finishMesh.rotation.y = -Math.atan2(finish.tangent.z, finish.tangent.x);
    this.scene.add(finishMesh);

    const finishStripeGeom = new THREE.BoxGeometry(1.1, 0.06, this.track.roadWidth + 0.6);
    const finishStripeMat = new THREE.MeshBasicMaterial({ color: 0x111827, transparent: true, opacity: 0.22 });
    const finishStripe = new THREE.Mesh(finishStripeGeom, finishStripeMat);
    finishStripe.position.set(finish.x, 0.145, finish.z);
    finishStripe.rotation.y = -Math.atan2(finish.tangent.z, finish.tangent.x);
    this.scene.add(finishStripe);

    const edgeHeight = 0.18;
    for (let i = 0; i < roadRibbon.samples.length; i += 3) {
      const a = roadRibbon.samples[i];
      const b = roadRibbon.samples[(i + 1) % roadRibbon.samples.length];
      const segLen = Math.hypot(b.x - a.x, b.z - a.z);
      const seg = new THREE.Mesh(
        new THREE.BoxGeometry(segLen, edgeHeight, 0.24),
        new THREE.MeshStandardMaterial({ color: 0xf8fafc, emissive: 0x111827, roughness: 0.5 })
      );
      seg.position.set((a.x + b.x) / 2, 0.12, (a.z + b.z) / 2);
      seg.rotation.y = -Math.atan2(b.z - a.z, b.x - a.x);
      seg.position.x += a.normal.x * this.track.roadWidth * 0.5;
      seg.position.z += a.normal.z * this.track.roadWidth * 0.5;
      this.scene.add(seg);

      const seg2 = seg.clone();
      seg2.position.x -= a.normal.x * this.track.roadWidth;
      seg2.position.z -= a.normal.z * this.track.roadWidth;
      this.scene.add(seg2);
    }
  }

  _buildCheckpoints() {
    this.checkpointMeshes = [];
    for (const cp of this.track.checkpoints) {
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(this.track.roadWidth * 0.92, 0.22),
        new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.08, side: THREE.DoubleSide })
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.rotation.z = Math.atan2(cp.nz, cp.nx);
      mesh.position.set(cp.x, 0.01, cp.z);
      this.scene.add(mesh);
      this.checkpointMeshes.push(mesh);
    }
  }

  _buildItemBoxes() {
    const geom = new THREE.BoxGeometry(0.6, 0.6, 0.6);
    this.track.itemBoxes.forEach((box) => {
      const mesh = new THREE.Mesh(
        geom,
        new THREE.MeshStandardMaterial({ color: 0xa78bfa, emissive: 0x312e81, roughness: 0.3, metalness: 0.15 })
      );
      mesh.position.set(box.x, 0.4, box.z);
      this.scene.add(mesh);
      box.mesh = mesh;
    });
  }

  _initPreview() {
    this._spawnKarts();
    this.render();
  }

  _spawnKarts() {
    for (const kart of this.karts) {
      this.scene.remove(kart.group);
      this.scene.remove(kart.ghostGroup);
      this.scene.remove(kart.shadowMesh);
    }
    this.karts = [];
    this.camera.rotation.z = 0;

    const start = this.track.finishLine;
    const forward = start.tangent;
    const normal = { x: start.nx, z: start.nz };
    const baseHeading = Math.atan2(forward.z, forward.x);

    for (let i = 0; i < this.driverAIs.length; i++) {
      const ai = this.driverAIs[i];
      const lane = i % 2 === 0 ? -1 : 1;
      const row = Math.floor(i / 2);
      const x = start.x + normal.x * lane * 0.9 - forward.x * row * 1.25;
      const z = start.z + normal.z * lane * 0.9 - forward.z * row * 1.25;

      const group = new THREE.Group();
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(1.0, 0.35, 1.45),
        new THREE.MeshStandardMaterial({ color: DRIVER_COLORS[i % DRIVER_COLORS.length], roughness: 0.45, metalness: 0.1 })
      );
      body.position.y = 0.28;
      group.add(body);
      const nose = new THREE.Mesh(
        new THREE.BoxGeometry(0.6, 0.18, 0.35),
        new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35 })
      );
      nose.position.set(0, 0.48, 0.45);
      group.add(nose);

      const shadowMesh = new THREE.Mesh(
        new THREE.CircleGeometry(0.7, 18),
        new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28 })
      );
      shadowMesh.rotation.x = -Math.PI / 2;
      shadowMesh.position.set(x, 0.03, z);
      shadowMesh.visible = false;
      this.scene.add(shadowMesh);

      const ghostGroup = new THREE.Group();
      const ghostBody = new THREE.Mesh(
        new THREE.BoxGeometry(1.0, 0.35, 1.45),
        new THREE.MeshBasicMaterial({ color: DRIVER_COLORS[i % DRIVER_COLORS.length], transparent: true, opacity: 0.25, depthTest: false })
      );
      ghostBody.position.y = 0.28;
      ghostBody.renderOrder = 10;
      ghostGroup.add(ghostBody);
      const ghostNose = new THREE.Mesh(
        new THREE.BoxGeometry(0.6, 0.18, 0.35),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.25, depthTest: false })
      );
      ghostNose.position.set(0, 0.48, 0.45);
      ghostNose.renderOrder = 10;
      ghostGroup.add(ghostNose);
      ghostGroup.visible = false;
      this.scene.add(ghostGroup);

      group.position.set(x, 0, z);
      group.rotation.y = -baseHeading + Math.PI / 2;
      this.scene.add(group);

      this.karts.push({
        id: `kart-${i + 1}`,
        ai,
        color: DRIVER_COLORS[i % DRIVER_COLORS.length],
        colorHex: `#${DRIVER_COLORS[i % DRIVER_COLORS.length].toString(16).padStart(6, "0")}`,
        group,
        ghostGroup,
        shadowMesh,
        body,
        nose,
        bridgeGhostAlpha: 0.26,
        bridgeMode: null,
        x,
        z,
        vx: 0,
        vz: 0,
        heading: baseHeading,
        speed: 0,
        lap: 0,
        place: i + 1,
        checkpointIndex: 1,
        lastCheckpointIndex: 0,
        progress: 0,
        item: null,
        boostTimer: 0,
        slipTimer: 0,
        hitSlowTimer: 0,
        finished: false,
        finishTime: null,
      });
    }
  }

  setDriverAIs(driverAIs) {
    this.driverAIs = driverAIs;
    this._spawnKarts();
    this.render();
  }

  setMatchConfig({ lapCount }) {
    this.lapCount = lapCount;
  }

  setCinematicMode(enabled) {
    this.cinematicMode = enabled;
  }

  start() {
    this.stop();
    this.timeElapsed = 0;
    for (const hazard of this.hazards) {
      this.scene.remove(hazard.mesh);
    }
    for (const projectile of this.projectiles) {
      this.scene.remove(projectile.mesh);
    }
    this.hazards = [];
    this.projectiles = [];
    for (const box of this.track.itemBoxes) {
      box.active = true;
      box.respawn = 0;
      if (box.mesh) box.mesh.visible = true;
    }
    this._spawnKarts();
    this.gameRunning = true;
    this.lastTime = performance.now();
    const loop = (time) => {
      if (!this.gameRunning) return;
      const dt = Math.min(0.033, (time - this.lastTime) / 1000 || 0.016);
      this.lastTime = time;
      this.update(dt);
      this.render();
      if (this.gameRunning) this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  stop() {
    this.gameRunning = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
  }

  render() {
    if (!this.gameRunning) {
      this.previewSpin += 0.0025;
      this.camera.rotation.z = Math.sin(this.previewSpin) * 0.015;
    } else {
      this.camera.rotation.z = 0;
    }
    for (const box of this.track.itemBoxes) {
      if (box.mesh && box.active) box.mesh.rotation.y += 0.02;
    }
    this.renderer.render(this.scene, this.camera);
  }

  update(dt) {
    this.timeElapsed += dt;

    for (const box of this.track.itemBoxes) {
      if (!box.active) {
        box.respawn -= dt;
        if (box.respawn <= 0) {
          box.active = true;
          if (box.mesh) box.mesh.visible = true;
        }
      }
    }

    for (const hazard of this.hazards) {
      hazard.ttl -= dt;
      if (hazard.mesh) hazard.mesh.material.opacity = clamp(hazard.ttl / 6, 0, 0.8);
    }
    this.hazards = this.hazards.filter((h) => {
      if (h.ttl > 0) return true;
      this.scene.remove(h.mesh);
      return false;
    });

    for (const projectile of this.projectiles) {
      projectile.ttl -= dt;
      if (projectile.target && !projectile.target.finished) {
        const dx = projectile.target.x - projectile.x;
        const dz = projectile.target.z - projectile.z;
        const n = normalize(dx, dz);
        projectile.vx = lerp(projectile.vx, n.x * 16, 0.08);
        projectile.vz = lerp(projectile.vz, n.z * 16, 0.08);
      }
      projectile.x += projectile.vx * dt;
      projectile.z += projectile.vz * dt;
      projectile.mesh.position.set(projectile.x, 0.45, projectile.z);
    }

    for (const projectile of this.projectiles) {
      if (projectile.ttl <= 0) continue;
      for (const kart of this.karts) {
        if (kart.id === projectile.ownerId || kart.finished) continue;
        if (Math.hypot(kart.x - projectile.x, kart.z - projectile.z) < this.kartRadius + 0.2) {
          kart.hitSlowTimer = 1.7;
          projectile.ttl = 0;
          break;
        }
      }
    }
    this.projectiles = this.projectiles.filter((p) => {
      if (p.ttl > 0) return true;
      this.scene.remove(p.mesh);
      return false;
    });

    for (const kart of this.karts) {
      if (kart.finished) continue;
      this._updateKart(kart, dt);
      this._checkItemBoxes(kart);
      this._checkHazards(kart);
      this._updateProgress(kart);
    }

    this._resolveKartCollisions();
    this._updatePlacings();

    this.onTick?.(this.timeElapsed, this.karts.map((k) => this._publicKartState(k)));

    const winner = this.karts.find((k) => k.lap >= this.lapCount);
    if (winner) {
      this._finishRace(winner);
    }
  }

  _updateKart(kart, dt) {
    kart.boostTimer = Math.max(0, kart.boostTimer - dt);
    kart.slipTimer = Math.max(0, kart.slipTimer - dt);
    kart.hitSlowTimer = Math.max(0, kart.hitSlowTimer - dt);

    const command = kart.ai?.tick?.(this._makeAIState(kart, dt)) ?? {};
    const throttle = clamp(command.throttle ?? 0, 0, 1);
    const brake = clamp(command.brake ?? 0, 0, 1);
    const steer = clamp(command.steer ?? 0, -1, 1);

    if (command.useItem && kart.item) {
      this._useItem(kart);
    }

    const distInfo = this._distanceToCenterline(kart.x, kart.z);
    const offRoad = distInfo.distance > this.track.roadWidth * 0.53;
    kart.offRoad = offRoad;

    const maxOffRoad = this.track.roadWidth * 0.5 + 1.2;
    if (distInfo.distance > maxOffRoad) {
      const dx = kart.x - distInfo.point.x;
      const dz = kart.z - distInfo.point.z;
      const d = Math.hypot(dx, dz) || 0.001;
      kart.x = distInfo.point.x + (dx / d) * maxOffRoad;
      kart.z = distInfo.point.z + (dz / d) * maxOffRoad;
      kart.vx *= 0.5;
      kart.vz *= 0.5;
    }

    const forward = { x: Math.cos(kart.heading), z: Math.sin(kart.heading) };
    const right = { x: -forward.z, z: forward.x };
    const currentForwardSpeed = kart.vx * forward.x + kart.vz * forward.z;
    const currentSideways = kart.vx * right.x + kart.vz * right.z;

    const accel = this.accel * throttle + (kart.boostTimer > 0 ? 14 : 0);
    const braking = this.brakePower * brake + (kart.hitSlowTimer > 0 ? 5 : 0);
    
    const currentDecel = offRoad ? 8 : 2.6;
    let deceleration = braking + currentDecel;
    let nextForward = currentForwardSpeed;
    
    if (accel > 0) {
      nextForward += accel * dt;
    } else if (Math.abs(nextForward) > 0.1) {
      nextForward -= deceleration * Math.sign(nextForward) * dt;
      if (Math.sign(currentForwardSpeed) !== Math.sign(nextForward)) {
        nextForward = 0;
      }
    } else {
      if (brake > 0.1 && accel === 0) {
        nextForward -= this.brakePower * brake * dt;
      } else {
        nextForward = 0;
      }
    }

    nextForward *= this.drag;
    nextForward = clamp(nextForward, -4, this.maxSpeed + (kart.boostTimer > 0 ? 4 : 0));
    if (kart.hitSlowTimer > 0) nextForward = Math.min(nextForward, 8.5);

    const grip = offRoad ? this.offRoadGrip : 1;
    const traction = this.traction * (kart.slipTimer > 0 ? 0.22 : 1) * grip;
    const nextSideways = lerp(currentSideways, 0, clamp(traction * dt, 0, 1));
    const steerPower = this.turnRate * (0.45 + Math.min(1, Math.abs(nextForward) / 8)) * (kart.slipTimer > 0 ? 1.25 : 1);
    kart.heading = wrapAngle(kart.heading + steer * steerPower * dt * Math.sign(nextForward || 1));

    const newForward = { x: Math.cos(kart.heading), z: Math.sin(kart.heading) };
    const newRight = { x: -newForward.z, z: newForward.x };
    kart.vx = newForward.x * nextForward + newRight.x * nextSideways;
    kart.vz = newForward.z * nextForward + newRight.z * nextSideways;

    kart.x += kart.vx * dt;
    kart.z += kart.vz * dt;

    const bound = this.track.bounds.radius;
    const len = Math.hypot(kart.x, kart.z);
    if (len > bound) {
      kart.x *= bound / len;
      kart.z *= bound / len;
      kart.vx *= 0.7;
      kart.vz *= 0.7;
    }

    kart.speed = Math.hypot(kart.vx, kart.vz);
    const bridge = this.track.bridge;
    const relX = kart.x - bridge.center.x;
    const relZ = kart.z - bridge.center.z;
    const along = relX * bridge.tangent.x + relZ * bridge.tangent.z;
    const across = relX * bridge.normal.x + relZ * bridge.normal.z;
    const inBridgeZone = Math.abs(along) < bridge.deckLength * 0.7 && Math.abs(across) < bridge.deckWidth * 1.5;
    const overCandidate = Math.abs(along) > Math.abs(across);
    if (!inBridgeZone) {
      kart.bridgeMode = null;
    } else if (!kart.bridgeMode) {
      kart.bridgeMode = overCandidate ? "over" : "under";
    }
    const visuallyUnder = kart.bridgeMode === "under" && Math.abs(across) < bridge.deckWidth * 0.38 && Math.abs(along) < bridge.deckLength * 0.35;
    const visuallyOver = kart.bridgeMode === "over" && Math.abs(across) < bridge.deckWidth * 0.52 && Math.abs(along) < bridge.deckLength * 0.52;
    kart.group.position.set(kart.x, 0, kart.z);
    kart.group.position.y = visuallyOver ? 1.12 : 0;
    kart.group.rotation.y = -kart.heading + Math.PI / 2;
    kart.ghostGroup.position.set(kart.x, 0, kart.z);
    kart.ghostGroup.rotation.y = -kart.heading + Math.PI / 2;
    kart.shadowMesh.position.set(kart.x, 0.03, kart.z);
    kart.shadowMesh.scale.setScalar(visuallyOver ? 1.15 : 1.05);
    kart.shadowMesh.material.opacity = visuallyOver ? 0.32 : visuallyUnder ? 0.42 : 0.18;
    kart.shadowMesh.visible = visuallyOver || visuallyUnder;
    kart.group.visible = !visuallyUnder;
    kart.ghostGroup.visible = visuallyUnder;
  }

  _makeAIState(kart, dt) {
    const self = this._publicKartState(kart);
    const opponents = this.karts.filter((k) => k !== kart).map((k) => this._publicKartState(k));
    const checkpoints = this.track.checkpoints;
    const centerlineLength = this.track.centerline.length;
    const localCenterline = this._distanceToCenterline(kart.x, kart.z);
    const state = {
      dt,
      timeElapsed: this.timeElapsed,
      self,
      opponents,
      itemBoxes: this.track.itemBoxes.filter((b) => b.active).map((b) => ({ x: b.x, z: b.z, respawn: b.respawn })),
      hazards: this.hazards.map((h) => ({ type: h.type, x: h.x, z: h.z })),
      projectiles: this.projectiles.map((p) => ({ x: p.x, z: p.z, vx: p.vx, vz: p.vz, ownerId: p.ownerId })),
      track: {
        centerline: this.track.centerline,
        checkpoints,
        roadWidth: this.track.roadWidth,
        finishLine: this.track.finishLine,
      },
      getNextCheckpoint: (countAhead = 0) => checkpoints[(kart.checkpointIndex + countAhead) % checkpoints.length],
      getCenterlinePoint: (offset = 0) => {
        const index = (localCenterline.index + Math.floor(offset * (centerlineLength / checkpoints.length))) % centerlineLength;
        const point = this.track.centerline[(index + centerlineLength) % centerlineLength];
        return { x: point.x, z: point.z };
      },
      distanceToNextCheckpoint: () => dist(kart, checkpoints[kart.checkpointIndex]),
      findNearestOpponentAhead: () => {
        const ahead = opponents
          .filter((o) => o.progress > self.progress)
          .sort((a, b) => a.progress - b.progress)[0];
        return ahead ? { ...ahead, distance: Math.hypot(ahead.x - self.x, ahead.z - self.z) } : null;
      },
    };
    return state;
  }

  _publicKartState(kart) {
    return {
      id: kart.id,
      name: kart.ai?.name || kart.id,
      x: kart.x,
      z: kart.z,
      heading: kart.heading,
      speed: kart.speed,
      lap: kart.lap,
      maxLaps: this.lapCount,
      checkpointIndex: kart.checkpointIndex,
      progress: kart.progress,
      place: kart.place,
      item: kart.item,
      offRoad: !!kart.offRoad,
      colorHex: kart.colorHex,
      effects: {
        boost: kart.boostTimer,
        slip: kart.slipTimer,
        slow: kart.hitSlowTimer,
      },
    };
  }

  _distanceToCenterline(x, z) {
    let bestDist = Infinity;
    let bestIndex = 0;
    let bestPoint = { x: 0, z: 0 };
    const pts = this.track.centerline;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const l2 = dx * dx + dz * dz;
      let t = 0;
      if (l2 > 0) {
        t = clamp(((x - a.x) * dx + (z - a.z) * dz) / l2, 0, 1);
      }
      const px = a.x + t * dx;
      const pz = a.z + t * dz;
      const d = Math.hypot(x - px, z - pz);
      if (d < bestDist) {
        bestDist = d;
        bestIndex = i;
        bestPoint = { x: px, z: pz };
      }
    }
    return { distance: bestDist, index: bestIndex, point: bestPoint };
  }

  _updateProgress(kart) {
    const cp = this.track.checkpoints[kart.checkpointIndex];
    const dx = kart.x - cp.x;
    const dz = kart.z - cp.z;
    
    if (Math.hypot(dx, dz) < cp.halfWidth + 2.5) {
      const dotTangent = dx * cp.tangent.x + dz * cp.tangent.z;
      if (dotTangent >= 0) {
        kart.lastCheckpointIndex = kart.checkpointIndex;
        kart.checkpointIndex = (kart.checkpointIndex + 1) % this.track.checkpoints.length;
        if (kart.checkpointIndex === 1 && kart.lastCheckpointIndex === 0) {
          kart.lap += 1;
          if (kart.lap >= this.lapCount) {
            kart.finished = true;
            kart.finishTime = this.timeElapsed;
          }
        }
      }
    }

    const next = this.track.checkpoints[kart.checkpointIndex];
    const d = Math.hypot(kart.x - next.x, kart.z - next.z);
    const localProgress = 1 - clamp(d / 12, 0, 1);
    kart.progress = kart.lap * this.track.checkpoints.length + kart.lastCheckpointIndex + localProgress;
  }

  _checkItemBoxes(kart) {
    if (kart.item) return;
    for (const box of this.track.itemBoxes) {
      if (!box.active) continue;
      if (Math.hypot(kart.x - box.x, kart.z - box.z) < 0.9) {
        kart.item = ITEM_TYPES[Math.floor(Math.random() * ITEM_TYPES.length)];
        box.active = false;
        box.respawn = 6;
        if (box.mesh) box.mesh.visible = false;
        return;
      }
    }
  }

  _checkHazards(kart) {
    for (const hazard of this.hazards) {
      if (hazard.ownerId === kart.id) continue;
      if (Math.hypot(kart.x - hazard.x, kart.z - hazard.z) < 0.9) {
        kart.slipTimer = 1.35;
      }
    }
  }

  _useItem(kart) {
    const item = kart.item;
    kart.item = null;
    if (item === "boost") {
      kart.boostTimer = 1.15;
      return;
    }
    if (item === "oil") {
      const mesh = new THREE.Mesh(
        new THREE.CircleGeometry(0.75, 18),
        new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.75 })
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(kart.x - Math.cos(kart.heading) * 0.9, 0.02, kart.z - Math.sin(kart.heading) * 0.9);
      this.scene.add(mesh);
      this.hazards.push({ type: "oil", ownerId: kart.id, x: mesh.position.x, z: mesh.position.z, ttl: 6, mesh });
      return;
    }
    if (item === "rocket") {
      const target = this.karts
        .filter((k) => k !== kart && k.progress > kart.progress && !k.finished)
        .sort((a, b) => a.progress - b.progress)[0] || this.karts.filter((k) => k !== kart)[0];
      if (!target) return;
      const dir = normalize(target.x - kart.x, target.z - kart.z);
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.18, 10, 10),
        new THREE.MeshStandardMaterial({ color: 0xf87171, emissive: 0x7f1d1d })
      );
      mesh.position.set(kart.x, 0.45, kart.z);
      this.scene.add(mesh);
      this.projectiles.push({ ownerId: kart.id, target, x: kart.x, z: kart.z, vx: dir.x * 16, vz: dir.z * 16, ttl: 4, mesh });
    }
  }

  _resolveKartCollisions() {
    for (let i = 0; i < this.karts.length; i++) {
      for (let j = i + 1; j < this.karts.length; j++) {
        const a = this.karts[i];
        const b = this.karts[j];
        if ((a.bridgeMode === "over" && b.bridgeMode === "under") ||
            (a.bridgeMode === "under" && b.bridgeMode === "over")) continue;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const d = Math.hypot(dx, dz) || 0.0001;
        const minDist = this.kartRadius * 2;
        if (d >= minDist) continue;
        const nx = dx / d;
        const nz = dz / d;
        const overlap = minDist - d;
        a.x -= nx * overlap * 0.5;
        a.z -= nz * overlap * 0.5;
        b.x += nx * overlap * 0.5;
        b.z += nz * overlap * 0.5;

        const avn = a.vx * nx + a.vz * nz;
        const bvn = b.vx * nx + b.vz * nz;
        const impulse = (bvn - avn) * 0.75;
        a.vx += nx * impulse;
        a.vz += nz * impulse;
        b.vx -= nx * impulse;
        b.vz -= nz * impulse;

        a.group.position.set(a.x, 0, a.z);
        b.group.position.set(b.x, 0, b.z);
      }
    }
  }

  _updatePlacings() {
    const sorted = [...this.karts].sort((a, b) => {
      if (b.lap !== a.lap) return b.lap - a.lap;
      return b.progress - a.progress;
    });
    sorted.forEach((kart, i) => {
      kart.place = i + 1;
    });
  }

  _finishRace(winner) {
    const standings = [...this.karts].sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.progress - a.progress;
    });
    const publicStandings = standings.map((k) => this._publicKartState(k));
    const publicWinner = winner
      ? this._publicKartState(winner)
      : publicStandings[0];
    this.stop();
    this.onRaceEnd?.({
      winner: publicWinner,
      standings: publicStandings,
    });
  }
}
