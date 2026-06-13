/**
 * Binary wire codec — a compact alternative to JSON for the hot path.
 *
 * Snapshots go out ~20Hz with floats and ids; JSON spends a lot of bytes on
 * field names, quotes, and decimal text. Encoding to a tight little-endian byte
 * layout shrinks packets and speeds up parsing on weak devices. The message
 * SHAPES are unchanged (same TS types as the zod schemas); only the transport
 * representation differs.
 *
 * Decoding is defensive (bounds-checked, version-validated) — that's the
 * "never trust the wire" guarantee that zod gave us on the JSON path.
 */
import type { ClientMessage, PlayerInput, ServerMessage, Snapshot } from "./index";
import { PROTOCOL_VERSION } from "./index";

// Message tags.
const T_JOIN = 1;
const T_INPUT = 2;
const T_WELCOME = 16;
const T_SNAPSHOT = 17;

// --- low-level writer/reader ----------------------------------------------

const encoder = new TextEncoder();
const decoder = new TextDecoder();

class Writer {
  private buf = new ArrayBuffer(256);
  private view = new DataView(this.buf);
  private off = 0;

  private ensure(n: number): void {
    if (this.off + n <= this.buf.byteLength) return;
    let cap = this.buf.byteLength;
    while (cap < this.off + n) cap *= 2;
    const next = new ArrayBuffer(cap);
    new Uint8Array(next).set(new Uint8Array(this.buf));
    this.buf = next;
    this.view = new DataView(next);
  }

  u8(v: number) { this.ensure(1); this.view.setUint8(this.off, v); this.off += 1; }
  u16(v: number) { this.ensure(2); this.view.setUint16(this.off, v); this.off += 2; }
  u32(v: number) { this.ensure(4); this.view.setUint32(this.off, v); this.off += 4; }
  f32(v: number) { this.ensure(4); this.view.setFloat32(this.off, v); this.off += 4; }
  str(s: string) {
    const bytes = encoder.encode(s);
    this.u16(bytes.length);
    this.ensure(bytes.length);
    new Uint8Array(this.buf).set(bytes, this.off);
    this.off += bytes.length;
  }

  done(): ArrayBuffer {
    return this.buf.slice(0, this.off);
  }
}

class Reader {
  private view: DataView;
  private bytes: Uint8Array;
  private off = 0;

  constructor(buf: ArrayBuffer) {
    this.view = new DataView(buf);
    this.bytes = new Uint8Array(buf);
  }

  private ensure(n: number): void {
    if (this.off + n > this.view.byteLength) throw new Error("binary: buffer underrun");
  }

  u8() { this.ensure(1); const v = this.view.getUint8(this.off); this.off += 1; return v; }
  u16() { this.ensure(2); const v = this.view.getUint16(this.off); this.off += 2; return v; }
  u32() { this.ensure(4); const v = this.view.getUint32(this.off); this.off += 4; return v; }
  f32() { this.ensure(4); const v = this.view.getFloat32(this.off); this.off += 4; return v; }
  str() {
    const len = this.u16();
    this.ensure(len);
    const s = decoder.decode(this.bytes.subarray(this.off, this.off + len));
    this.off += len;
    return s;
  }
}

// --- client -> server ------------------------------------------------------

export function encodeClientMessage(msg: ClientMessage): ArrayBuffer {
  const w = new Writer();
  if (msg.t === "join") {
    w.u8(T_JOIN);
    w.u8(msg.v);
    w.str(msg.roomId);
  } else {
    w.u8(T_INPUT);
    w.u32(msg.tick);
    w.f32(msg.input.moveX);
    w.f32(msg.input.moveY);
    w.f32(msg.input.aim);
    w.u8(msg.input.firing ? 1 : 0);
  }
  return w.done();
}

export function decodeClientMessage(buf: ArrayBuffer): ClientMessage {
  const r = new Reader(buf);
  const tag = r.u8();
  if (tag === T_JOIN) {
    const v = r.u8();
    if (v !== PROTOCOL_VERSION) throw new Error(`binary: protocol version ${v}`);
    const roomId = r.str();
    return { t: "join", v: PROTOCOL_VERSION, roomId };
  }
  if (tag === T_INPUT) {
    const tick = r.u32();
    const input: PlayerInput = {
      moveX: r.f32(),
      moveY: r.f32(),
      aim: r.f32(),
      firing: r.u8() === 1,
    };
    return { t: "input", tick, input };
  }
  throw new Error(`binary: unknown client tag ${tag}`);
}

// --- server -> client ------------------------------------------------------

function writeSnapshot(w: Writer, snap: Snapshot): void {
  w.u32(snap.tick);
  w.u8(snap.players.length);
  for (const p of snap.players) {
    w.str(p.id);
    w.f32(p.x);
    w.f32(p.y);
    w.f32(p.aim);
    w.f32(p.health);
    w.u16(p.fireCooldown);
    w.u16(p.respawnIn);
    w.u8(p.slot);
    w.u16(p.score);
  }
  w.u16(snap.projectiles.length);
  for (const pr of snap.projectiles) {
    w.u32(pr.id);
    w.str(pr.ownerId);
    w.f32(pr.x);
    w.f32(pr.y);
    w.f32(pr.vx);
    w.f32(pr.vy);
    w.u16(pr.ttl);
  }
}

function readSnapshot(r: Reader): Snapshot {
  const tick = r.u32();
  const playerCount = r.u8();
  const players = [];
  for (let i = 0; i < playerCount; i++) {
    players.push({
      id: r.str(),
      x: r.f32(),
      y: r.f32(),
      aim: r.f32(),
      health: r.f32(),
      fireCooldown: r.u16(),
      respawnIn: r.u16(),
      slot: r.u8(),
      score: r.u16(),
    });
  }
  const projCount = r.u16();
  const projectiles = [];
  for (let i = 0; i < projCount; i++) {
    projectiles.push({
      id: r.u32(),
      ownerId: r.str(),
      x: r.f32(),
      y: r.f32(),
      vx: r.f32(),
      vy: r.f32(),
      ttl: r.u16(),
    });
  }
  return { tick, players, projectiles };
}

export function encodeServerMessage(msg: ServerMessage): ArrayBuffer {
  const w = new Writer();
  if (msg.t === "welcome") {
    w.u8(T_WELCOME);
    w.u8(msg.v);
    w.u8(msg.tickRate);
    w.str(msg.youId);
  } else {
    w.u8(T_SNAPSHOT);
    if (msg.ackTick == null) {
      w.u8(0);
    } else {
      w.u8(1);
      w.u32(msg.ackTick);
    }
    writeSnapshot(w, msg.snapshot);
  }
  return w.done();
}

export function decodeServerMessage(buf: ArrayBuffer): ServerMessage {
  const r = new Reader(buf);
  const tag = r.u8();
  if (tag === T_WELCOME) {
    const v = r.u8();
    if (v !== PROTOCOL_VERSION) throw new Error(`binary: protocol version ${v}`);
    const tickRate = r.u8();
    const youId = r.str();
    return { t: "welcome", v: PROTOCOL_VERSION, youId, tickRate };
  }
  if (tag === T_SNAPSHOT) {
    const hasAck = r.u8() === 1;
    const ackTick = hasAck ? r.u32() : undefined;
    const snapshot = readSnapshot(r);
    return { t: "snapshot", ackTick, snapshot };
  }
  throw new Error(`binary: unknown server tag ${tag}`);
}
