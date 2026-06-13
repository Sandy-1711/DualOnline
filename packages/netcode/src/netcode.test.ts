import { describe, expect, it } from "vitest";
import { createInitialState, neutralInput, step, type PlayerInput } from "@dual/sim";
import type { Snapshot } from "@dual/protocol";
import { predict, pruneAcked } from "./predict";
import { interpolatePlayers, SnapshotBuffer } from "./interpolate";

const RIGHT: PlayerInput = { moveX: 1, moveY: 0, aim: 0, firing: false };

describe("prediction", () => {
  it("with nothing pending, returns the authoritative state unchanged", () => {
    const auth = createInitialState(["you", "them"]);
    const out = predict(auth, "you", [], 0);
    expect(out).toBe(auth);
  });

  it("replays unacknowledged inputs to move our own player forward", () => {
    const auth = createInitialState(["you", "them"]);
    const you0 = auth.players.find((p) => p.id === "you")!;

    const pending = Array.from({ length: 10 }, (_, i) => ({ tick: i + 1, input: RIGHT }));
    const predicted = predict(auth, "you", pending, 0);
    const you1 = predicted.players.find((p) => p.id === "you")!;

    expect(you1.x).toBeGreaterThan(you0.x); // moved right
    expect(predicted.tick).toBe(auth.tick + 10); // advanced 10 ticks
  });

  it("skips inputs already acknowledged by the server", () => {
    const auth = createInitialState(["you", "them"]);
    const pending = Array.from({ length: 10 }, (_, i) => ({ tick: i + 1, input: RIGHT }));

    // Server acked through tick 10 → nothing left to replay.
    const predicted = predict(auth, "you", pending, 10);
    expect(predicted).toBe(auth);
  });

  it("reconciles to the same place the server computed (no drift)", () => {
    // Ground truth: server applies the same inputs the client predicted.
    const ids = ["you", "them"];
    let server = createInitialState(ids);
    const pending = Array.from({ length: 20 }, (_, i) => ({ tick: i + 1, input: RIGHT }));
    for (const p of pending) {
      server = step(server, { you: p.input, them: neutralInput() });
    }

    // Client predicts from the INITIAL snapshot (ack=0) replaying all inputs.
    const predicted = predict(createInitialState(ids), "you", pending, 0);

    const sx = server.players.find((p) => p.id === "you")!.x;
    const px = predicted.players.find((p) => p.id === "you")!.x;
    expect(px).toBeCloseTo(sx, 6); // prediction matches authority exactly
  });

  it("prunes acknowledged inputs", () => {
    const pending = [1, 2, 3, 4, 5].map((tick) => ({ tick, input: RIGHT }));
    expect(pruneAcked(pending, 3).map((p) => p.tick)).toEqual([4, 5]);
  });
});

describe("interpolation", () => {
  const snap = (id: string, x: number, y: number): Snapshot => ({
    tick: 0,
    players: [{ id, x, y, aim: 0, health: 100, fireCooldown: 0, respawnIn: 0, slot: 0, score: 0 }],
    projectiles: [],
  });

  it("blends a remote player to the midpoint at t=0.5", () => {
    const players = interpolatePlayers(snap("them", 0, 0), snap("them", 100, 50), 0.5);
    expect(players[0]!.x).toBeCloseTo(50);
    expect(players[0]!.y).toBeCloseTo(25);
  });

  it("SnapshotBuffer interpolates between two timestamped snapshots", () => {
    const buf = new SnapshotBuffer(100);
    buf.push(snap("them", 0, 0), 1000);
    buf.push(snap("them", 100, 0), 1100);
    // now=1200 → render time = 1100 (target), which is exactly the 2nd sample.
    const out = buf.sample(1200);
    expect(out!.players[0]!.x).toBeCloseTo(100);
  });
});
