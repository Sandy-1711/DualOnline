/**
 * The deterministic simulation core.
 *
 * `step(state, inputs)` is a PURE function: given identical (state, inputs) it
 * always returns an identical next state. It does not read the clock, generate
 * randomness, or mutate its arguments. This is what lets the SAME code run as
 * the authoritative server AND as the client's local prediction later.
 *
 * Time is fixed: every call advances the world by exactly DT seconds.
 */

import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  DT,
  FIRE_COOLDOWN_TICKS,
  PLAYER_MAX_HEALTH,
  PLAYER_RADIUS,
  PLAYER_RESPAWN_TICKS,
  PLAYER_SPEED,
  PROJECTILE_DAMAGE,
  PROJECTILE_LIFETIME_TICKS,
  PROJECTILE_RADIUS,
  PROJECTILE_SPEED,
  SPAWN_POINTS,
} from "./constants";
import {
  type GameState,
  type InputMap,
  type Player,
  type PlayerId,
  type Projectile,
  neutralInput,
} from "./types";
import { clamp, distanceSq, normalize } from "./vec";

function spawnPlayer(id: PlayerId, slot: number): Player {
  const spawn = SPAWN_POINTS[slot % SPAWN_POINTS.length]!;
  return {
    id,
    x: spawn.x,
    y: spawn.y,
    aim: spawn.aim,
    health: PLAYER_MAX_HEALTH,
    fireCooldown: 0,
    respawnIn: 0,
    slot,
    score: 0,
  };
}

/**
 * Build the initial state for a match. Player ids are sorted so iteration order
 * is stable and identical on every machine.
 */
export function createInitialState(playerIds: PlayerId[]): GameState {
  const sorted = [...playerIds].sort();
  return {
    tick: 0,
    players: sorted.map((id, slot) => spawnPlayer(id, slot)),
    projectiles: [],
    nextProjectileId: 1,
  };
}

function respawn(player: Player): void {
  const spawn = SPAWN_POINTS[player.slot % SPAWN_POINTS.length]!;
  player.x = spawn.x;
  player.y = spawn.y;
  player.aim = spawn.aim;
  player.health = PLAYER_MAX_HEALTH;
  player.fireCooldown = 0;
  player.respawnIn = 0;
}

/**
 * Advance the world by one tick. Returns a NEW state object; the input `state`
 * is not mutated, so callers can keep prior snapshots for reconciliation.
 */
export function step(state: GameState, inputs: InputMap): GameState {
  // Deep-ish clone of the mutable parts. State is plain data, so spreading the
  // arrays + objects is enough to avoid mutating the caller's snapshot.
  const players: Player[] = state.players.map((p) => ({ ...p }));
  let projectiles: Projectile[] = state.projectiles.map((pr) => ({ ...pr }));
  let nextProjectileId = state.nextProjectileId;

  // --- Players: movement, aim, firing -------------------------------------
  for (const player of players) {
    if (player.respawnIn > 0) {
      player.respawnIn -= 1;
      if (player.respawnIn <= 0) respawn(player);
      continue; // dead players don't move or shoot
    }

    const input = inputs[player.id] ?? neutralInput();

    // Move (normalized so diagonals aren't faster).
    const dir = normalize(input.moveX, input.moveY);
    player.x = clamp(
      player.x + dir.x * PLAYER_SPEED * DT,
      PLAYER_RADIUS,
      ARENA_WIDTH - PLAYER_RADIUS,
    );
    player.y = clamp(
      player.y + dir.y * PLAYER_SPEED * DT,
      PLAYER_RADIUS,
      ARENA_HEIGHT - PLAYER_RADIUS,
    );

    player.aim = input.aim;

    if (player.fireCooldown > 0) player.fireCooldown -= 1;

    if (input.firing && player.fireCooldown <= 0) {
      // Spawn a projectile from the muzzle, travelling along the aim vector.
      const muzzle = PLAYER_RADIUS + PROJECTILE_RADIUS + 1;
      projectiles.push({
        id: nextProjectileId++,
        ownerId: player.id,
        x: player.x + Math.cos(player.aim) * muzzle,
        y: player.y + Math.sin(player.aim) * muzzle,
        vx: Math.cos(player.aim) * PROJECTILE_SPEED,
        vy: Math.sin(player.aim) * PROJECTILE_SPEED,
        ttl: PROJECTILE_LIFETIME_TICKS,
      });
      player.fireCooldown = FIRE_COOLDOWN_TICKS;
    }
  }

  // --- Projectiles: move, expire, leave arena -----------------------------
  const survivors: Projectile[] = [];
  for (const pr of projectiles) {
    pr.x += pr.vx * DT;
    pr.y += pr.vy * DT;
    pr.ttl -= 1;

    const outOfBounds =
      pr.x < 0 || pr.x > ARENA_WIDTH || pr.y < 0 || pr.y > ARENA_HEIGHT;
    if (pr.ttl > 0 && !outOfBounds) survivors.push(pr);
  }
  projectiles = survivors;

  // --- Collisions: projectile vs opponent ---------------------------------
  // Iterate projectiles in id order (already stable) against players in id
  // order so resolution is deterministic.
  const hitRadius = PLAYER_RADIUS + PROJECTILE_RADIUS;
  const hitRadiusSq = hitRadius * hitRadius;
  const remaining: Projectile[] = [];
  for (const pr of projectiles) {
    let consumed = false;
    for (const player of players) {
      if (player.respawnIn > 0) continue; // can't hit a dead player
      if (player.id === pr.ownerId) continue; // no self-hits
      if (distanceSq(pr.x, pr.y, player.x, player.y) <= hitRadiusSq) {
        player.health -= PROJECTILE_DAMAGE;
        if (player.health <= 0) {
          player.health = 0;
          player.respawnIn = PLAYER_RESPAWN_TICKS;
          const shooter = players.find((p) => p.id === pr.ownerId);
          if (shooter) shooter.score += 1;
        }
        consumed = true;
        break;
      }
    }
    if (!consumed) remaining.push(pr);
  }
  projectiles = remaining;

  return {
    tick: state.tick + 1,
    players,
    projectiles,
    nextProjectileId,
  };
}
