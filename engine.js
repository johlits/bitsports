import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js";

export class AirHockeyEngine {
  constructor({ container, onScore, blueAI, redAI }) {
    this.container = container;
    this.onScore = onScore;
    this.blueAI = blueAI;
    this.redAI = redAI;

    this.tableWidth = 10;
    this.tableHeight = 20;
    this.paddleRadius = 0.35;
    this.puckRadius = 0.25;
    this.goalCreaseRadius = 2.5; // Half-circle crease in front of goals

    this.maxPaddleSpeed = 6; // units/sec
    this.puckFriction = 0.997;

    this.lastTime = 0;
    this.blueScore = 0;
    this.redScore = 0;
    this.startTime = 0; // Track game time for spawning pucks

    // Track last paddle that touched the puck and on which half of the table
    // { paddle: 'blue' | 'red', half: 'blue' | 'red', time: number }
    this.lastHit = null;
    this.foulGraceMs = 80; // small window where consecutive hits are allowed

    this.pucks = []; // Array of { mesh, velocity, id }

    this._initThree();
    this._initScene();
  }

  _initThree() {
    const width = window.innerWidth;
    const height = window.innerHeight;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x020617);

    this.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
    // Higher, more top-down view so the full board sits higher in the viewport
    this.camera.position.set(0, 25, 1);
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
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  _initScene() {
    const light = new THREE.DirectionalLight(0xffffff, 1.1);
    light.position.set(3, 6, 4);
    this.scene.add(light);
    this.scene.add(new THREE.AmbientLight(0x64748b, 0.6));

    const tableGeom = new THREE.PlaneGeometry(this.tableWidth, this.tableHeight);
    const tableMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      emissive: 0x020617,
      metalness: 0.3,
      roughness: 0.4,
    });
    this.table = new THREE.Mesh(tableGeom, tableMat);
    this.table.rotation.x = -Math.PI / 2;
    this.scene.add(this.table);

    // Board border
    const borderMat = new THREE.MeshBasicMaterial({ color: 0x64748b });
    const borderThickness = 0.06;
    
    // Top and bottom borders
    const hBorderGeom = new THREE.PlaneGeometry(this.tableWidth, borderThickness);
    const topBorder = new THREE.Mesh(hBorderGeom, borderMat);
    topBorder.rotation.x = -Math.PI / 2;
    topBorder.position.set(0, 0.001, -this.tableHeight / 2);
    this.scene.add(topBorder);
    
    const bottomBorder = new THREE.Mesh(hBorderGeom, borderMat);
    bottomBorder.rotation.x = -Math.PI / 2;
    bottomBorder.position.set(0, 0.001, this.tableHeight / 2);
    this.scene.add(bottomBorder);
    
    // Left and right borders
    const vBorderGeom = new THREE.PlaneGeometry(borderThickness, this.tableHeight);
    const leftBorder = new THREE.Mesh(vBorderGeom, borderMat);
    leftBorder.rotation.x = -Math.PI / 2;
    leftBorder.position.set(-this.tableWidth / 2, 0.001, 0);
    this.scene.add(leftBorder);
    
    const rightBorder = new THREE.Mesh(vBorderGeom, borderMat);
    rightBorder.rotation.x = -Math.PI / 2;
    rightBorder.position.set(this.tableWidth / 2, 0.001, 0);
    this.scene.add(rightBorder);

    const lineMat = new THREE.MeshBasicMaterial({ color: 0x64748b });
    const centerLineGeom = new THREE.PlaneGeometry(this.tableWidth, 0.02);
    this.centerLine = new THREE.Mesh(centerLineGeom, lineMat);
    this.centerLine.rotation.x = -Math.PI / 2;
    this.centerLine.position.z = 0;
    this.centerLine.position.y = 0.001;
    this.scene.add(this.centerLine);

    const circleGeom = new THREE.RingGeometry(0.6, 0.62, 64);
    const circleMat = new THREE.MeshBasicMaterial({ color: 0x64748b, side: THREE.DoubleSide });
    const centerCircle = new THREE.Mesh(circleGeom, circleMat);
    centerCircle.rotation.x = -Math.PI / 2;
    centerCircle.position.y = 0.001;
    this.scene.add(centerCircle);

    // Goals (visual markers matching goal width in _handleCollisions)
    const goalWidth = 4.0;
    const goalDepth = 0.15;
    const goalMatBlue = new THREE.MeshBasicMaterial({ color: 0x22c55e });
    const goalMatRed = new THREE.MeshBasicMaterial({ color: 0xef4444 });

    const goalGeom = new THREE.PlaneGeometry(goalWidth, goalDepth);

    this.blueGoal = new THREE.Mesh(goalGeom, goalMatBlue);
    this.redGoal = new THREE.Mesh(goalGeom, goalMatRed);

    this.blueGoal.rotation.x = -Math.PI / 2;
    this.redGoal.rotation.x = -Math.PI / 2;

    this.blueGoal.position.set(0, 0.002, this.tableHeight / 2 - goalDepth / 2);
    this.redGoal.position.set(0, 0.002, -this.tableHeight / 2 + goalDepth / 2);

    this.scene.add(this.blueGoal);
    this.scene.add(this.redGoal);

    // Goal creases (half-circles where paddles cannot enter)
    // Filled semi-circle area
    const creaseFilledGeom = new THREE.CircleGeometry(this.goalCreaseRadius, 64, 0, Math.PI);
    const creaseFilledMat = new THREE.MeshBasicMaterial({ color: 0x1e293b, side: THREE.DoubleSide });

    const blueCreaseFill = new THREE.Mesh(creaseFilledGeom, creaseFilledMat);
    blueCreaseFill.rotation.x = -Math.PI / 2;
    blueCreaseFill.rotation.z = 0; // Arc faces inward onto field
    blueCreaseFill.position.set(0, 0.0005, this.tableHeight / 2);
    this.scene.add(blueCreaseFill);

    const redCreaseFill = new THREE.Mesh(creaseFilledGeom, creaseFilledMat);
    redCreaseFill.rotation.x = -Math.PI / 2;
    redCreaseFill.rotation.z = Math.PI; // Arc faces inward onto field
    redCreaseFill.position.set(0, 0.0005, -this.tableHeight / 2);
    this.scene.add(redCreaseFill);

    // Crease outline ring
    const creaseGeom = new THREE.RingGeometry(this.goalCreaseRadius - 0.04, this.goalCreaseRadius, 64, 1, 0, Math.PI);
    const creaseMat = new THREE.MeshBasicMaterial({ color: 0x64748b, side: THREE.DoubleSide });

    const blueCrease = new THREE.Mesh(creaseGeom, creaseMat);
    blueCrease.rotation.x = -Math.PI / 2;
    blueCrease.rotation.z = 0; // Rotate so arc faces inward onto field
    blueCrease.position.set(0, 0.001, this.tableHeight / 2);
    this.scene.add(blueCrease);

    const redCrease = new THREE.Mesh(creaseGeom, creaseMat);
    redCrease.rotation.x = -Math.PI / 2;
    redCrease.rotation.z = Math.PI; // Arc faces inward onto field
    redCrease.position.set(0, 0.001, -this.tableHeight / 2);
    this.scene.add(redCrease);

    const paddleGeom = new THREE.CylinderGeometry(this.paddleRadius, this.paddleRadius, 0.2, 32);
    // Keep geometry/material for spawning pucks later
    this.puckGeom = new THREE.CylinderGeometry(this.puckRadius, this.puckRadius, 0.1, 32);
    this.puckMat = new THREE.MeshStandardMaterial({ color: 0xe5e7eb });

    const blueMat = new THREE.MeshStandardMaterial({ color: 0x38bdf8 });
    const redMat = new THREE.MeshStandardMaterial({ color: 0xf97373 });
    
    this.bluePaddle = new THREE.Mesh(paddleGeom, blueMat);
    this.redPaddle = new THREE.Mesh(paddleGeom, redMat);
    // Removed single puck mesh creation

    // Initialize velocity tracking
    this.bluePaddle.userData.velocity = new THREE.Vector2(0, 0);
    this.redPaddle.userData.velocity = new THREE.Vector2(0, 0);

    this.bluePaddle.position.set(0, 0.1, this.tableHeight * 0.25);
    this.redPaddle.position.set(0, 0.1, -this.tableHeight * 0.25);

    this.scene.add(this.bluePaddle);
    this.scene.add(this.redPaddle);
  }

  _spawnPuck(direction = 1) {
    const mesh = new THREE.Mesh(this.puckGeom, this.puckMat);
    mesh.position.set(0, 0.05, 0);
    this.scene.add(mesh);

    const speed = 3;
    const angleSpread = Math.PI / 3;
    const baseAngle = direction > 0 ? Math.PI / 2 : -Math.PI / 2;
    const angle = baseAngle + (Math.random() - 0.5) * angleSpread;
    const vx = Math.cos(angle) * speed;
    const vy = Math.sin(angle) * speed;

    this.pucks.push({
      mesh: mesh,
      velocity: new THREE.Vector2(vx, vy),
      id: Math.random().toString(36).substr(2, 9),
      spawning: true // Skip puck-puck collision until clear of overlap
    });
  }

  resetPuck(direction = 1) {
    // Remove existing pucks
    for (const p of this.pucks) {
      this.scene.remove(p.mesh);
    }
    this.pucks = [];

    // Spawn initial puck
    this._spawnPuck(direction);

    // Reset paddles
    this.bluePaddle.position.set(0, 0.1, this.tableHeight * 0.25);
    this.redPaddle.position.set(0, 0.1, -this.tableHeight * 0.25);

    this.lastHit = null;
    this.startTime = performance.now(); // Reset spawn timer
  }

  _clampPaddlePosition(paddle, isBlue) {
    const halfW = this.tableWidth / 2 - this.paddleRadius;
    const halfH = this.tableHeight / 2 - this.paddleRadius;
    paddle.position.x = Math.max(-halfW, Math.min(halfW, paddle.position.x));

    if (isBlue) {
      paddle.position.z = Math.max(0, Math.min(halfH, paddle.position.z));
    } else {
      paddle.position.z = Math.max(-halfH, Math.min(0, paddle.position.z));
    }

    // Enforce goal crease zones - push paddle out if inside the half-circle
    const creaseMinDist = this.goalCreaseRadius + this.paddleRadius;

    // Blue goal crease (at z = tableHeight/2)
    const blueGoalZ = this.tableHeight / 2;
    const dzBlue = blueGoalZ - paddle.position.z;
    const distToBlueGoalSq = paddle.position.x * paddle.position.x + dzBlue * dzBlue;
    if (dzBlue > 0 && distToBlueGoalSq < creaseMinDist * creaseMinDist) {
      const dist = Math.sqrt(distToBlueGoalSq) || 0.0001;
      const pushFactor = creaseMinDist / dist;
      paddle.position.x = Math.max(-halfW, Math.min(halfW, paddle.position.x * pushFactor));
      paddle.position.z = blueGoalZ - dzBlue * pushFactor;
    }

    // Red goal crease (at z = -tableHeight/2)
    const redGoalZ = -this.tableHeight / 2;
    const dzRed = paddle.position.z - redGoalZ;
    const distToRedGoalSq = paddle.position.x * paddle.position.x + dzRed * dzRed;
    if (dzRed > 0 && distToRedGoalSq < creaseMinDist * creaseMinDist) {
      const dist = Math.sqrt(distToRedGoalSq) || 0.0001;
      const pushFactor = creaseMinDist / dist;
      paddle.position.x = Math.max(-halfW, Math.min(halfW, paddle.position.x * pushFactor));
      paddle.position.z = redGoalZ + dzRed * pushFactor;
    }
  }

  _applyAIMove(ai, paddle, opponent, delta) {
    // Store previous position to calculate velocity
    const prevX = paddle.position.x;
    const prevZ = paddle.position.z;

    // Reset velocity for this frame
    paddle.userData.velocity.set(0, 0);

    if (!ai || typeof ai.tick !== "function") return;
    if (this.pucks.length === 0) return;

    const paddlePos = new THREE.Vector2(paddle.position.x, paddle.position.z);
    const opponentPos = new THREE.Vector2(opponent.position.x, opponent.position.z);
    const isBlue = paddle.position.z > 0;

    // Find the best puck to target
    // Criteria: Closest puck moving towards my goal, or just closest puck
    let bestPuck = this.pucks[0];
    let minScore = Infinity;

    for (const p of this.pucks) {
      // Simple score: distance to paddle
      const distSq = (p.mesh.position.x - paddlePos.x)**2 + (p.mesh.position.z - paddlePos.y)**2;
      
      // Bias: prioritize pucks moving towards my goal line
      const movingTowardsMe = isBlue ? p.velocity.y > 0 : p.velocity.y < 0;
      
      let score = distSq;
      if (movingTowardsMe) score *= 0.5; // Priority multiplier

      if (score < minScore) {
        minScore = score;
        bestPuck = p;
      }
    }

    // Also pass full list of pucks if AI updates to support it
    const allPucks = this.pucks.map(p => ({
        x: p.mesh.position.x, 
        y: p.mesh.position.z, 
        velocity: new THREE.Vector2(p.velocity.x, p.velocity.y)
    }));

    const dir = ai.tick({ 
        pucks: allPucks,
        self: paddlePos, 
        opponent: opponentPos, 
        dt: delta 
    });
    if (!dir) return;

    const move = new THREE.Vector2(dir.x || 0, dir.z || 0);
    if (move.lengthSq() === 0) return;
    move.normalize().multiplyScalar(this.maxPaddleSpeed * delta);

    paddle.position.x += move.x;
    paddle.position.z += move.y;

    // Calculate actual velocity (units per second) for collision physics
    if (delta > 0) {
      paddle.userData.velocity.set(
        (paddle.position.x - prevX) / delta,
        (paddle.position.z - prevZ) / delta
      );
    }
  }

  _handleCollisions() {
    const halfW = this.tableWidth / 2;
    const halfH = this.tableHeight / 2;
    const goalWidth = 4.0;

    for (let i = this.pucks.length - 1; i >= 0; i--) {
        const p = this.pucks[i];
        
        // Wall Collisions (X)
        if (p.mesh.position.x <= -halfW + this.puckRadius) {
            p.mesh.position.x = -halfW + this.puckRadius;
            p.velocity.x *= -1;
        }
        if (p.mesh.position.x >= halfW - this.puckRadius) {
            p.mesh.position.x = halfW - this.puckRadius;
            p.velocity.x *= -1;
        }

        // Goal / End Wall Collisions (Z)
        if (p.mesh.position.z <= -halfH + this.puckRadius) {
            if (Math.abs(p.mesh.position.x) < goalWidth / 2) {
                this.blueScore++;
                this.onScore?.(this.blueScore, this.redScore);
                // Remove this puck
                this.scene.remove(p.mesh);
                this.pucks.splice(i, 1);
                
                // If no pucks left, reset
                if (this.pucks.length === 0) {
                    this.resetPuck(1);
                }
                continue;
            } else {
                p.mesh.position.z = -halfH + this.puckRadius;
                p.velocity.y *= -1;
            }
        }

        if (p.mesh.position.z >= halfH - this.puckRadius) {
            if (Math.abs(p.mesh.position.x) < goalWidth / 2) {
                this.redScore++;
                this.onScore?.(this.blueScore, this.redScore);
                // Remove this puck
                this.scene.remove(p.mesh);
                this.pucks.splice(i, 1);
                
                if (this.pucks.length === 0) {
                    this.resetPuck(-1);
                }
                continue;
            } else {
                p.mesh.position.z = halfH - this.puckRadius;
                p.velocity.y *= -1;
            }
        }

        // Paddle Collisions
        this._paddlePuckCollision(this.bluePaddle, "blue", p);
        this._paddlePuckCollision(this.redPaddle, "red", p);
    }

    // Puck-Puck Collisions
    this._handlePuckPuckCollisions();

    // Prevent paddles from overlapping each other
    const dx = this.bluePaddle.position.x - this.redPaddle.position.x;
    const dz = this.bluePaddle.position.z - this.redPaddle.position.z;
    const distSq = dx * dx + dz * dz;
    const minDist = this.paddleRadius * 2;
    if (distSq < minDist * minDist) {
      const dist = Math.sqrt(distSq) || 0.0001;
      const overlap = minDist - dist;
      const nx = dx / dist;
      const nz = dz / dist;

      // Push both paddles apart equally along the line between them
      const offsetX = (nx * overlap) / 2;
      const offsetZ = (nz * overlap) / 2;
      this.bluePaddle.position.x += offsetX;
      this.bluePaddle.position.z += offsetZ;
      this.redPaddle.position.x -= offsetX;
      this.redPaddle.position.z -= offsetZ;
    }

    this._clampPaddlePosition(this.bluePaddle, true);
    this._clampPaddlePosition(this.redPaddle, false);
  }

  _handlePuckPuckCollisions() {
    const minDist = this.puckRadius * 2;
    const minDistSq = minDist * minDist;

    for (let i = 0; i < this.pucks.length; i++) {
      const p1 = this.pucks[i];

      // Check if this puck overlaps any other
      let overlapsAny = false;

      for (let j = i + 1; j < this.pucks.length; j++) {
        const p2 = this.pucks[j];

        const dx = p2.mesh.position.x - p1.mesh.position.x;
        const dz = p2.mesh.position.z - p1.mesh.position.z;
        const distSq = dx * dx + dz * dz;

        if (distSq < minDistSq) {
          overlapsAny = true;

          // Skip collision if either puck is still spawning
          if (p1.spawning || p2.spawning) continue;

          const dist = Math.sqrt(distSq) || 0.0001;
          const nx = dx / dist;
          const nz = dz / dist;

          // Separate the pucks
          const overlap = minDist - dist;
          p1.mesh.position.x -= nx * overlap * 0.5;
          p1.mesh.position.z -= nz * overlap * 0.5;
          p2.mesh.position.x += nx * overlap * 0.5;
          p2.mesh.position.z += nz * overlap * 0.5;

          // Elastic collision (equal mass)
          const v1n = p1.velocity.x * nx + p1.velocity.y * nz;
          const v2n = p2.velocity.x * nx + p2.velocity.y * nz;

          // Only collide if approaching
          if (v1n - v2n > 0) {
            // Swap normal components
            p1.velocity.x += (v2n - v1n) * nx;
            p1.velocity.y += (v2n - v1n) * nz;
            p2.velocity.x += (v1n - v2n) * nx;
            p2.velocity.y += (v1n - v2n) * nz;
          }
        }
      }

      // Clear spawning flag once puck is clear of all others
      if (p1.spawning && !overlapsAny) {
        p1.spawning = false;
      }
    }
  }

  _paddlePuckCollision(paddle, paddleId, puckObj) {
    const dx = puckObj.mesh.position.x - paddle.position.x;
    const dz = puckObj.mesh.position.z - paddle.position.z;
    const distSq = dx * dx + dz * dz;
    const minDist = this.paddleRadius + this.puckRadius;
    if (distSq < minDist * minDist) {
      const dist = Math.sqrt(distSq) || 0.0001;
      const nx = dx / dist;
      const nz = dz / dist;
      const overlap = minDist - dist;
      puckObj.mesh.position.x += nx * overlap;
      puckObj.mesh.position.z += nz * overlap;

      // Update last hitter info
      // Only count as valid hit if it's a hit
      const now = performance.now();
      this.lastHit = { paddle: paddleId, half: puckObj.mesh.position.z >= 0 ? "blue" : "red", time: now };

      // Get paddle velocity (or zero if undefined)
      const pVel = paddle.userData.velocity || new THREE.Vector2(0, 0);

      // Store original puck speed before collision
      const originalSpeed = puckObj.velocity.length();

      // Paddle velocity component along collision normal
      // Positive = paddle moving toward puck, Negative = paddle moving away
      const paddleNormalSpeed = pVel.x * nx + pVel.y * nz;

      // Always bounce puck away from paddle along the normal direction
      // Speed calculation:
      // - Stationary paddle: preserve original speed
      // - Paddle moving toward puck: increase speed
      // - Paddle moving away from puck: decrease speed
      const paddleInfluence = paddleNormalSpeed * 5;
      const newSpeed = Math.max(0.5, Math.min(15, originalSpeed + paddleInfluence));

      // Set puck velocity to bounce away along normal
      puckObj.velocity.x = nx * newSpeed;
      puckObj.velocity.y = nz * newSpeed;
    }
  }

  start() {
    this.resetPuck(1);
    this.lastTime = performance.now();
    const loop = (time) => {
      const dt = (time - this.lastTime) / 1000;
      this.lastTime = time;
      this.update(dt);
      this.renderer.render(this.scene, this.camera);
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  stop() {
    if (this.rafId) cancelAnimationFrame(this.rafId);
  }

  update(delta) {
    this._applyAIMove(this.blueAI, this.bluePaddle, this.redPaddle, delta);
    this._applyAIMove(this.redAI, this.redPaddle, this.bluePaddle, delta);

    // Update all pucks
    for (const p of this.pucks) {
        p.mesh.position.x += p.velocity.x * delta;
        p.mesh.position.z += p.velocity.y * delta;
        p.velocity.multiplyScalar(this.puckFriction);
    }
    
    // Spawning logic: add a new puck every 15 seconds, up to 10 pucks
    const now = performance.now();
    if (now - this.startTime > 15000) {
        if (this.pucks.length < 10) {
            // Randomly serve to someone
            this._spawnPuck(Math.random() > 0.5 ? 1 : -1);
            this.startTime = now; // Reset timer for next spawn
        }
    }

    this._handleCollisions();
  }
}
