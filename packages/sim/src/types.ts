/**
 * Core simulation types. These describe the authoritative game state and the
 * per-tick input. They are plain data (no methods, no class instances) so a
 * snapshot can be structurally cloned, serialized, or sent over the wire.
 */

export type PlayerId = string;

/** One player's input for a single tick. Produced by the client, applied by the sim. */
export interface PlayerInput {
  /** Desired move direction. Need not be normalized; the sim normalizes it. */
  moveX: number;
  moveY: number;
  /** Aim direction in radians (0 = +x, increasing clockwise in screen space). */
  aim: number;
  /** Whether the fire button is held this tick. */
  firing: boolean;
}

export function neutralInput(): PlayerInput {
  return { moveX: 0, moveY: 0, aim: 0, firing: false };
}

export interface Player {
  id: PlayerId;
  x: number;
  y: number;
  aim: number;
  health: number;
  /** Ticks remaining on the fire cooldown (0 = can fire). */
  fireCooldown: number;
  /** Ticks remaining until respawn while dead (0 = alive). */
  respawnIn: number;
  /** Spawn slot index (drives spawn point + colour). */
  slot: number;
  score: number;
}

export interface Projectile {
  id: number;
  ownerId: PlayerId;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Ticks remaining before it expires. */
  ttl: number;
}

export interface GameState {
  /** Monotonic tick counter. Advances by 1 each step. */
  tick: number;
  /** Sorted-by-id for deterministic iteration order. */
  players: Player[];
  projectiles: Projectile[];
  /** Source of new projectile ids — deterministic, never reused. */
  nextProjectileId: number;
}

/** A map of playerId -> the input that player issued for the tick being simulated. */
export type InputMap = Record<PlayerId, PlayerInput>;
