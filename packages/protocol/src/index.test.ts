import { describe, expect, it } from "vitest";
import { parseClientMessage, parseServerMessage, PROTOCOL_VERSION } from "./index.js";

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
