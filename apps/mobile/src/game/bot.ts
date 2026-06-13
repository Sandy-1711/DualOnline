/**
 * A dead-simple opponent AI. It produces a `PlayerInput` exactly like a human
 * would, so the sim can't tell the difference — and later this same slot is
 * simply fed by the network instead of by this function.
 *
 * Behaviour: orbit the target at a comfortable range and fire whenever it has
 * a clear-ish shot. Deterministic given the state (no randomness).
 */
import type { GameState, PlayerId, PlayerInput } from "@dual/sim";

const PREFERRED_RANGE = 320;

export function botInput(
  state: GameState,
  selfId: PlayerId,
  targetId: PlayerId,
): PlayerInput {
  const self = state.players.find((p) => p.id === selfId);
  const target = state.players.find((p) => p.id === targetId);
  if (!self || !target || self.respawnIn > 0) {
    return { moveX: 0, moveY: 0, aim: self?.aim ?? 0, firing: false };
  }

  const dx = target.x - self.x;
  const dy = target.y - self.y;
  const dist = Math.hypot(dx, dy) || 1;
  const aim = Math.atan2(dy, dx);

  // Move toward the target if too far, away if too close, else strafe around it
  // (perpendicular to the line of sight) so the fight stays mobile.
  let moveX: number;
  let moveY: number;
  const gap = dist - PREFERRED_RANGE;
  if (Math.abs(gap) > 60) {
    const sign = gap > 0 ? 1 : -1;
    moveX = (dx / dist) * sign;
    moveY = (dy / dist) * sign;
  } else {
    // Strafe direction flips slowly based on tick so it circles, deterministically.
    const orbit = Math.floor(state.tick / 90) % 2 === 0 ? 1 : -1;
    moveX = (-dy / dist) * orbit;
    moveY = (dx / dist) * orbit;
  }

  // Fire when target is alive and within a sensible range.
  const firing = target.respawnIn <= 0 && dist < 560;

  return { moveX, moveY, aim, firing };
}
