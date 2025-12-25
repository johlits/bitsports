export const id = "swe-1-5";
export const name = "SWE-1.5";

// Advanced AI parameters
const STRATEGY_UPDATE_INTERVAL = 0.5; // Update strategy every 0.5 seconds
const TERRITORY_IMPORTANCE = 0.4; // Weight for territory control
const POWERUP_IMPORTANCE = 0.3; // Weight for powerup collection
const OFFENSIVE_IMPORTANCE = 0.2; // Weight for offensive actions
const DEFENSIVE_IMPORTANCE = 0.1; // Weight for defensive actions

// Memory and state tracking
let memory = {
    myId: null,
    initialTime: null,
    lastStrategyUpdate: 0,
    currentStrategy: 'expand', // expand, defend, attack, powerup
    targetPosition: null,
    territoryMap: null,
    lastPosition: null,
    stuckCounter: 0,
    enemyPositions: new Map(),
    powerupHistory: [],
    controlZones: []
};

function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
}

function hypot2(x, z) {
    return Math.hypot(x, z);
}

function normalizeDir(x, z) {
    const len = hypot2(x, z);
    if (!len || len < 1e-9) return { x: 0, z: 0 };
    return { x: x / len, z: z / len };
}

function worldToGrid(x, z, tileSize, halfW, halfH, gridWidth, gridHeight) {
    const gx = Math.floor((x + halfW) / tileSize);
    const gy = Math.floor((z + halfH) / tileSize);
    return {
        gx: clamp(gx, 0, gridWidth - 1),
        gy: clamp(gy, 0, gridHeight - 1),
    };
}

function gridToWorld(gx, gy, tileSize, halfW, halfH) {
    return {
        x: gx * tileSize - halfW + tileSize / 2,
        z: gy * tileSize - halfH + tileSize / 2,
    };
}

function manhattan(gx1, gy1, gx2, gy2) {
    return Math.abs(gx2 - gx1) + Math.abs(gy2 - gy1);
}

function euclidean(x1, z1, x2, z2) {
    return Math.hypot(x2 - x1, z2 - z1);
}

// Advanced territory analysis
function analyzeTerritory(grid, gridWidth, gridHeight, playerId) {
    const territory = [];
    const frontier = [];
    const controlled = [];
    
    for (let x = 0; x < gridWidth; x++) {
        territory[x] = [];
        for (let y = 0; y < gridHeight; y++) {
            const owner = grid[x][y];
            if (owner === playerId) {
                territory[x][y] = 'controlled';
                controlled.push({x, y});
                
                // Check if this is a frontier tile
                let isFrontier = false;
                for (let dx = -1; dx <= 1; dx++) {
                    for (let dy = -1; dy <= 1; dy++) {
                        if (dx === 0 && dy === 0) continue;
                        const nx = x + dx;
                        const ny = y + dy;
                        if (nx >= 0 && nx < gridWidth && ny >= 0 && ny < gridHeight) {
                            if (grid[nx][ny] !== playerId) {
                                isFrontier = true;
                                break;
                            }
                        }
                    }
                    if (isFrontier) break;
                }
                if (isFrontier) {
                    frontier.push({x, y});
                }
            } else if (owner === 0) {
                territory[x][y] = 'empty';
            } else {
                territory[x][y] = 'enemy';
            }
        }
    }
    
    return { territory, frontier, controlled };
}

// Find optimal expansion targets
function findExpansionTargets(territory, gridWidth, gridHeight, selfGrid) {
    const targets = [];
    const visited = new Set();
    
    // BFS from controlled territory to find valuable empty tiles
    for (const tile of territory.frontier) {
        for (let dx = -2; dx <= 2; dx++) {
            for (let dy = -2; dy <= 2; dy++) {
                const nx = tile.x + dx;
                const ny = tile.y + dy;
                const key = `${nx},${ny}`;
                
                if (nx >= 0 && nx < gridWidth && ny >= 0 && ny < gridHeight && 
                    !visited.has(key) && territory.territory[nx][ny] === 'empty') {
                    visited.add(key);
                    
                    // Calculate value based on connectivity and distance
                    const dist = euclidean(nx, ny, selfGrid.gx, selfGrid.gy);
                    const connectivity = countEmptyNeighbors(nx, ny, territory.territory, gridWidth, gridHeight);
                    const value = connectivity * 10 - dist;
                    
                    targets.push({x: nx, y: ny, value, dist});
                }
            }
        }
    }
    
    return targets.sort((a, b) => b.value - a.value);
}

function countEmptyNeighbors(x, y, territory, gridWidth, gridHeight) {
    let count = 0;
    for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx;
            const ny = y + dy;
            if (nx >= 0 && nx < gridWidth && ny >= 0 && ny < gridHeight && territory[nx][ny] === 'empty') {
                count++;
            }
        }
    }
    return count;
}

// Strategic decision making
function determineStrategy(state, territory) {
    const timeRatio = state.timeRemaining / (memory.initialTime || 60);
    const myScore = state.self.score;
    const maxEnemyScore = Math.max(...state.others.map(p => p.score), 0);
    const scoreDiff = myScore - maxEnemyScore;
    
    // Early game: expand rapidly
    if (timeRatio > 0.7) {
        return 'expand';
    }
    
    // Mid game: adjust based on score
    if (timeRatio > 0.3) {
        if (scoreDiff > 10) {
            return 'defend'; // Winning, play defensively
        } else if (scoreDiff < -10) {
            return 'attack'; // Losing, play aggressively
        } else {
            return 'expand'; // Close game, continue expanding
        }
    }
    
    // Late game: desperate measures
    if (timeRatio <= 0.3) {
        if (scoreDiff > 5) {
            return 'defend'; // Protect lead
        } else {
            return 'attack'; // Must attack
        }
    }
    
    return 'expand';
}

// Find strategic powerup targets
function findPowerupTargets(state, selfGrid) {
    const targets = [];
    
    for (const powerup of state.powerups) {
        const powerupGrid = worldToGrid(powerup.x, powerup.z, state.tileSize, 
                                       state.gridWidth * state.tileSize / 2, 
                                       state.gridHeight * state.tileSize / 2,
                                       state.gridWidth, state.gridHeight);
        
        const dist = manhattan(selfGrid.gx, selfGrid.gy, powerupGrid.gx, powerupGrid.gy);
        let priority = 50; // Base priority
        
        // Speed boost is most valuable for expansion
        if (powerup.type === 'speed') priority += 30;
        // Shield is valuable when losing
        if (powerup.type === 'shield' && state.self.score < Math.max(...state.others.map(p => p.score))) priority += 20;
        
        // Adjust priority based on distance
        priority -= dist * 2;
        
        targets.push({powerup, priority, dist});
    }
    
    return targets.sort((a, b) => b.priority - a.priority);
}

// Find enemy targets for offensive play
function findEnemyTargets(state, selfGrid, territory) {
    const targets = [];
    
    for (const enemy of state.others) {
        const enemyGrid = worldToGrid(enemy.x, enemy.z, state.tileSize,
                                     state.gridWidth * state.tileSize / 2,
                                     state.gridHeight * state.tileSize / 2,
                                     state.gridWidth, state.gridHeight);
        
        const dist = manhattan(selfGrid.gx, selfGrid.gy, enemyGrid.gx, enemyGrid.gy);
        
        // Find enemy territory tiles near enemy position
        for (let dx = -3; dx <= 3; dx++) {
            for (let dy = -3; dy <= 3; dy++) {
                const nx = enemyGrid.gx + dx;
                const ny = enemyGrid.gy + dy;
                
                if (nx >= 0 && nx < state.gridWidth && ny >= 0 && ny < state.gridHeight &&
                    state.grid[nx][ny] === enemy.id) {
                    
                    const tileDist = manhattan(selfGrid.gx, selfGrid.gy, nx, ny);
                    const value = 20 - tileDist + (enemy.score > state.self.score ? 10 : 0);
                    
                    targets.push({x: nx, y: ny, value, enemyId: enemy.id});
                }
            }
        }
    }
    
    return targets.sort((a, b) => b.value - a.value);
}

// Avoid getting stuck
function checkIfStuck(currentPos, lastPos) {
    if (!lastPos) return false;
    
    const dist = euclidean(currentPos.x, currentPos.z, lastPos.x, lastPos.z);
    return dist < 0.1; // Very small movement
}

// Get unstuck by moving in a random direction
function getUnstuck() {
    const angle = Math.random() * Math.PI * 2;
    return { x: Math.cos(angle), z: Math.sin(angle) };
}

// Main AI tick function
export function tick(state) {
    // Initialize memory
    if (memory.myId === null) {
        memory.myId = state.self.score > 0 ? 1 : 0; // Approximate ID detection
        memory.initialTime = state.timeRemaining;
    }
    
    // Update strategy periodically
    if (state.timeRemaining - memory.lastStrategyUpdate > STRATEGY_UPDATE_INTERVAL) {
        const territory = analyzeTerritory(state.grid, state.gridWidth, state.gridHeight, memory.myId);
        memory.currentStrategy = determineStrategy(state, territory);
        memory.territoryMap = territory;
        memory.lastStrategyUpdate = state.timeRemaining;
    }
    
    const selfGrid = worldToGrid(state.self.x, state.self.z, state.tileSize,
                                 state.gridWidth * state.tileSize / 2,
                                 state.gridHeight * state.tileSize / 2,
                                 state.gridWidth, state.gridHeight);
    
    // Check if stuck
    if (checkIfStuck({x: state.self.x, z: state.self.z}, memory.lastPosition)) {
        memory.stuckCounter++;
        if (memory.stuckCounter > 5) {
            memory.stuckCounter = 0;
            return getUnstuck();
        }
    } else {
        memory.stuckCounter = 0;
    }
    memory.lastPosition = {x: state.self.x, z: state.self.z};
    
    let target = null;
    
    // Execute strategy
    switch (memory.currentStrategy) {
        case 'expand': {
            const expansionTargets = findExpansionTargets(memory.territoryMap, state.gridWidth, state.gridHeight, selfGrid);
            if (expansionTargets.length > 0) {
                const best = expansionTargets[0];
                target = gridToWorld(best.x, best.y, state.tileSize,
                                   state.gridWidth * state.tileSize / 2,
                                   state.gridHeight * state.tileSize / 2);
            }
            break;
        }
        
        case 'defend': {
            // Find weak points in our territory to reinforce
            const weakPoints = [];
            for (const tile of memory.territoryMap.frontier) {
                let enemyCount = 0;
                for (let dx = -1; dx <= 1; dx++) {
                    for (let dy = -1; dy <= 1; dy++) {
                        const nx = tile.x + dx;
                        const ny = tile.y + dy;
                        if (nx >= 0 && nx < state.gridWidth && ny >= 0 && ny < state.gridHeight) {
                            if (state.grid[nx][ny] !== 0 && state.grid[nx][ny] !== memory.myId) {
                                enemyCount++;
                            }
                        }
                    }
                }
                if (enemyCount > 0) {
                    weakPoints.push({x: tile.x, y: tile.y, threat: enemyCount});
                }
            }
            
            if (weakPoints.length > 0) {
                weakPoints.sort((a, b) => b.threat - a.threat);
                const best = weakPoints[0];
                target = gridToWorld(best.x, best.y, state.tileSize,
                                   state.gridWidth * state.tileSize / 2,
                                   state.gridHeight * state.tileSize / 2);
            }
            break;
        }
        
        case 'attack': {
            const enemyTargets = findEnemyTargets(state, selfGrid, memory.territoryMap);
            if (enemyTargets.length > 0) {
                const best = enemyTargets[0];
                target = gridToWorld(best.x, best.y, state.tileSize,
                                   state.gridWidth * state.tileSize / 2,
                                   state.gridHeight * state.tileSize / 2);
            }
            break;
        }
        
        case 'powerup': {
            const powerupTargets = findPowerupTargets(state, selfGrid);
            if (powerupTargets.length > 0) {
                target = {x: powerupTargets[0].powerup.x, z: powerupTargets[0].powerup.z};
            }
            break;
        }
    }
    
    // Fallback: find nearest empty tile
    if (!target) {
        let minDist = Infinity;
        for (let x = 0; x < state.gridWidth; x++) {
            for (let y = 0; y < state.gridHeight; y++) {
                if (state.grid[x][y] === 0) {
                    const worldPos = gridToWorld(x, y, state.tileSize,
                                               state.gridWidth * state.tileSize / 2,
                                               state.gridHeight * state.tileSize / 2);
                    const dist = euclidean(state.self.x, state.self.z, worldPos.x, worldPos.z);
                    if (dist < minDist) {
                        minDist = dist;
                        target = worldPos;
                    }
                }
            }
        }
    }
    
    // Final fallback: random exploration
    if (!target) {
        const angle = Math.random() * Math.PI * 2;
        target = {
            x: state.self.x + Math.cos(angle) * 5,
            z: state.self.z + Math.sin(angle) * 5
        };
    }
    
    // Calculate direction to target
    const dx = target.x - state.self.x;
    const dz = target.z - state.self.z;
    
    if (Math.abs(dx) < 0.2 && Math.abs(dz) < 0.2) {
        // Reached target, find new one
        memory.targetPosition = null;
        return { x: 0, z: 0 };
    }
    
    memory.targetPosition = target;
    return normalizeDir(dx, dz);
}
