/**
 * Simulation constants. All gameplay tuning lives here so the sim stays a pure
 * function of (state, inputs, constants). Keep these as plain numbers — no env,
 * no Date, no Math.random — so the sim is deterministic and runtime-agnostic
 * (it must run unchanged inside a Cloudflare Durable Object later).
 */

/** Fixed simulation rate. The sim ALWAYS advances by exactly DT seconds per tick. */
export const TICK_RATE = 60;
export const DT = 1 / TICK_RATE;

/** Arena bounds in world units (origin top-left, +y down — matches screen space). */
export const ARENA_WIDTH = 1000;
export const ARENA_HEIGHT = 1000;

/** Player tuning. */
export const PLAYER_RADIUS = 22;
export const PLAYER_SPEED = 260; // world units / second
export const PLAYER_MAX_HEALTH = 100;
export const PLAYER_RESPAWN_TICKS = TICK_RATE * 2; // 2s

/** Projectile tuning. */
export const PROJECTILE_RADIUS = 6;
export const PROJECTILE_SPEED = 520; // world units / second
export const PROJECTILE_LIFETIME_TICKS = TICK_RATE * 2; // 2s before it expires
export const PROJECTILE_DAMAGE = 25;
// 0.4s between shots (2.5/s). A slower fire rate also eases the netcode: fewer
// fast projectiles in flight means less aliasing/flicker over the wire.
export const FIRE_COOLDOWN_TICKS = Math.round(TICK_RATE * 0.4);

/** Spawn points (P0 top-left-ish, P1 bottom-right-ish), facing the centre. */
export const SPAWN_POINTS = [
  { x: ARENA_WIDTH * 0.25, y: ARENA_HEIGHT * 0.25, aim: Math.PI / 4 },
  { x: ARENA_WIDTH * 0.75, y: ARENA_HEIGHT * 0.75, aim: Math.PI + Math.PI / 4 },
] as const;
