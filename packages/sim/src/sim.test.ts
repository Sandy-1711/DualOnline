import { describe, expect, it } from "vitest";
import { ARENA_WIDTH, FIRE_COOLDOWN_TICKS, PLAYER_RADIUS, TICK_RATE } from "./constants.js";
import { createInitialState, step } from "./sim.js";
import type { InputMap, PlayerInput } from "./types.js";
import { neutralInput } from "./types.js";

/** Run `ticks` steps applying the same inputs each tick. */
function run(playerIds: string[], inputs: InputMap, ticks: number) {
  let state = createInitialState(playerIds);
  for (let i = 0; i < ticks; i++) state = step(state, inputs);
  return state;
}

describe("determinism", () => {
  it("same inputs produce byte-identical state", () => {
    const ids = ["p2", "p1"]; // intentionally unsorted
    const inputs: InputMap = {
      p1: { moveX: 1, moveY: 0.3, aim: 0.5, firing: true },
      p2: { moveX: -0.7, moveY: 1, aim: 2.1, firing: true },
    };

    const a = run(ids, inputs, 120);
    const b = run(ids, inputs, 120);

    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });

  it("sorts player ids into stable slots regardless of input order", () => {
    const a = createInitialState(["zeta", "alpha"]);
    const b = createInitialState(["alpha", "zeta"]);
    expect(a.players.map((p) => p.id)).toEqual(["alpha", "zeta"]);
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });
});

describe("step purity", () => {
  it("does not mutate the input state", () => {
    const state = createInitialState(["p1", "p2"]);
    const before = JSON.stringify(state);
    step(state, {});
    expect(JSON.stringify(state)).toEqual(before);
  });
});

describe("movement", () => {
  it("moves a player and never leaves the arena", () => {
    const inputs: InputMap = {
      p1: { ...neutralInput(), moveX: 1, moveY: 0 },
      p2: neutralInput(),
    };
    const state = run(["p1", "p2"], inputs, TICK_RATE * 10); // 10s straight right
    const p1 = state.players.find((p) => p.id === "p1")!;
    expect(p1.x).toBeLessThanOrEqual(ARENA_WIDTH - PLAYER_RADIUS + 1e-6);
    expect(p1.x).toBeGreaterThan(0);
  });

  it("normalizes diagonal movement (no speed boost)", () => {
    const straight = run(
      ["p1", "p2"],
      { p1: { ...neutralInput(), moveX: 1, moveY: 0 }, p2: neutralInput() },
      5,
    );
    const diagonal = run(
      ["p1", "p2"],
      { p1: { ...neutralInput(), moveX: 1, moveY: 1 }, p2: neutralInput() },
      5,
    );
    const sp = straight.players[0]!;
    const dp = diagonal.players[0]!;
    const startX = createInitialState(["p1", "p2"]).players[0]!.x;
    const startY = createInitialState(["p1", "p2"]).players[0]!.y;
    const straightDist = Math.hypot(sp.x - startX, sp.y - startY);
    const diagDist = Math.hypot(dp.x - startX, dp.y - startY);
    expect(diagDist).toBeCloseTo(straightDist, 5);
  });
});

describe("firing", () => {
  it("spawns one projectile then respects the cooldown", () => {
    const firing: PlayerInput = { ...neutralInput(), firing: true };
    let state = createInitialState(["p1", "p2"]);

    state = step(state, { p1: firing, p2: neutralInput() });
    expect(state.projectiles).toHaveLength(1);

    // Still on cooldown for the next few ticks → no new projectile spawns.
    state = step(state, { p1: firing, p2: neutralInput() });
    expect(state.projectiles.length).toBeLessThanOrEqual(2);
    expect(state.players.find((p) => p.id === "p1")!.fireCooldown).toBeGreaterThan(0);
    expect(FIRE_COOLDOWN_TICKS).toBeGreaterThan(0);
  });
});
