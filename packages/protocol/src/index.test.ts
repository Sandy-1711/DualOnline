import { describe, expect, it } from "vitest";
import {
  decodeClientMessage,
  decodeServerMessage,
  encodeClientMessage,
  encodeServerMessage,
  parseClientMessage,
  parseServerMessage,
  PROTOCOL_VERSION,
  type ServerMessage,
} from "./index";

describe("protocol", () => {
  it("accepts a valid join message", () => {
    const msg = parseClientMessage({ t: "join", v: PROTOCOL_VERSION, roomId: "abc" });
    expect(msg.t).toBe("join");
  });

  it("accepts a valid input message", () => {
    const msg = parseClientMessage({
      t: "input",
      tick: 42,
      input: { moveX: 1, moveY: 0, aim: 0.5, firing: true },
    });
    expect(msg.t).toBe("input");
  });

  it("rejects an unknown message type", () => {
    expect(() => parseClientMessage({ t: "nope" })).toThrow();
  });

  it("validates a server snapshot", () => {
    const msg = parseServerMessage({
      t: "snapshot",
      snapshot: { tick: 1, players: [], projectiles: [] },
    });
    expect(msg.t).toBe("snapshot");
  });
});

describe("binary codec round-trips", () => {
  it("join", () => {
    const out = decodeClientMessage(
      encodeClientMessage({ t: "join", v: PROTOCOL_VERSION, roomId: "alpha-1" }),
    );
    expect(out).toEqual({ t: "join", v: PROTOCOL_VERSION, roomId: "alpha-1" });
  });

  it("input (floats survive within f32 precision)", () => {
    const out = decodeClientMessage(
      encodeClientMessage({ t: "input", tick: 12345, input: { moveX: 1, moveY: -0.5, aim: 1.25, firing: true } }),
    );
    expect(out.t).toBe("input");
    if (out.t === "input") {
      expect(out.tick).toBe(12345);
      expect(out.input.moveX).toBeCloseTo(1, 4);
      expect(out.input.moveY).toBeCloseTo(-0.5, 4);
      expect(out.input.aim).toBeCloseTo(1.25, 4);
      expect(out.input.firing).toBe(true);
    }
  });

  it("welcome", () => {
    const out = decodeServerMessage(
      encodeServerMessage({ t: "welcome", v: PROTOCOL_VERSION, youId: "abc-123", tickRate: 60 }),
    );
    expect(out).toEqual({ t: "welcome", v: PROTOCOL_VERSION, youId: "abc-123", tickRate: 60 });
  });

  it("snapshot with players + projectiles", () => {
    const msg: ServerMessage = {
      t: "snapshot",
      ackTick: 99,
      snapshot: {
        tick: 7,
        players: [
          { id: "p-a", x: 100, y: 200, aim: 0.5, health: 75, fireCooldown: 3, respawnIn: 0, slot: 0, score: 2 },
          { id: "p-b", x: 900, y: 800, aim: 3.0, health: 100, fireCooldown: 0, respawnIn: 12, slot: 1, score: 1 },
        ],
        projectiles: [{ id: 42, ownerId: "p-a", x: 150, y: 250, vx: 520, vy: 0, ttl: 90 }],
      },
    };
    const out = decodeServerMessage(encodeServerMessage(msg));
    expect(out.t).toBe("snapshot");
    if (out.t === "snapshot") {
      expect(out.ackTick).toBe(99);
      expect(out.snapshot.players).toHaveLength(2);
      expect(out.snapshot.players[1]!.respawnIn).toBe(12);
      expect(out.snapshot.projectiles[0]!.ownerId).toBe("p-a");
      expect(out.snapshot.projectiles[0]!.vx).toBeCloseTo(520, 2);
    }
  });

  it("rejects a malformed/short buffer", () => {
    expect(() => decodeServerMessage(new ArrayBuffer(0))).toThrow();
  });
});
