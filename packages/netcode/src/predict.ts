/**
 * Client-side prediction + server reconciliation.
 *
 * The server is authoritative, but waiting a network round-trip before your own
 * player moves feels awful. So the client predicts: it applies its own inputs
 * locally and immediately. When the server's authoritative snapshot arrives, we
 * "reconcile" — snap to that truth and re-apply only the inputs the server
 * hadn't processed yet.
 *
 * This module is pure (no network, no React) so it can be unit-tested in
 * isolation, and it reuses the exact same `step` the server runs.
 */
import { neutralInput, step, type GameState, type InputMap, type PlayerInput } from "@dual/sim";
import type { Snapshot } from "@dual/protocol";

/** A local input the client sent, tagged with the client tick it belongs to. */
export interface PendingInput {
  tick: number;
  input: PlayerInput;
}

/**
 * Rehydrate a server `Snapshot` into a full `GameState` the sim can step. The
 * wire snapshot omits the sim's internal `nextProjectileId`; we derive a safe
 * value (one past the highest live projectile id) so any projectiles we predict
 * locally get non-colliding ids.
 */
export function snapshotToState(snap: Snapshot): GameState {
  let maxId = 0;
  for (const p of snap.projectiles) if (p.id > maxId) maxId = p.id;
  return {
    tick: snap.tick,
    players: snap.players,
    projectiles: snap.projectiles,
    nextProjectileId: maxId + 1,
  };
}

/**
 * Produce the predicted "now" by replaying unacknowledged inputs on top of the
 * latest authoritative snapshot.
 *
 * - `authoritative` — the most recent server snapshot (the truth).
 * - `youId` — which player we control.
 * - `pending` — inputs we've sent, tagged by client tick.
 * - `ackTick` — the last input tick the server confirmed it applied.
 *
 * Inputs with `tick <= ackTick` are already baked into `authoritative`, so we
 * skip them and replay only the tail. Other players are stepped with neutral
 * input: we don't render their *predicted* bodies (those come from
 * interpolation), but stepping the whole sim also advances OUR own projectiles,
 * so firing feels instant too.
 */
export function predict(
  authoritative: GameState,
  youId: string,
  pending: PendingInput[],
  ackTick: number,
): GameState {
  const otherIds = authoritative.players.filter((p) => p.id !== youId).map((p) => p.id);

  let state = authoritative;
  for (const p of pending) {
    if (p.tick <= ackTick) continue;
    const inputs: InputMap = { [youId]: p.input };
    for (const id of otherIds) inputs[id] = neutralInput();
    state = step(state, inputs);
  }
  return state;
}

/** Drop inputs the server has already processed; keep the unacknowledged tail. */
export function pruneAcked(pending: PendingInput[], ackTick: number): PendingInput[] {
  return pending.filter((p) => p.tick > ackTick);
}
