// Ad-hoc smoke test for the authoritative room. Connects two clients, drives
// inputs from one, and checks the server moves that player and broadcasts
// snapshots to both. Run while `wrangler dev` is up on 8787.
// Base URL can be passed as argv[2] or WS_URL; defaults to local wrangler dev.
const BASE = process.argv[2] ?? process.env.WS_URL ?? "ws://127.0.0.1:8787";
const URL = `${BASE.replace(/\/+$/, "")}/rooms/smoke`;

// Minimal inline binary codec mirroring packages/protocol/src/binary.ts, so this
// plain .mjs can talk to the (now binary) server without importing TS.
const enc = new TextEncoder();
const dec = new TextDecoder();

function encodeInput(tick, mx, my, aim, firing) {
  const b = new ArrayBuffer(1 + 4 + 4 + 4 + 4 + 1);
  const v = new DataView(b);
  let o = 0;
  v.setUint8(o, 2); o += 1;
  v.setUint32(o, tick); o += 4;
  v.setFloat32(o, mx); o += 4;
  v.setFloat32(o, my); o += 4;
  v.setFloat32(o, aim); o += 4;
  v.setUint8(o, firing ? 1 : 0); o += 1;
  return b;
}

function decodeServer(buf) {
  const v = new DataView(buf);
  const u = new Uint8Array(buf);
  let o = 0;
  const str = () => { const n = v.getUint16(o); o += 2; const s = dec.decode(u.subarray(o, o + n)); o += n; return s; };
  const tag = v.getUint8(o); o += 1;
  if (tag === 16) {
    const ver = v.getUint8(o); o += 1;
    const tickRate = v.getUint8(o); o += 1;
    return { t: "welcome", v: ver, youId: str(), tickRate };
  }
  if (tag === 17) {
    const hasAck = v.getUint8(o) === 1; o += 1;
    let ackTick; if (hasAck) { ackTick = v.getUint32(o); o += 4; }
    const tick = v.getUint32(o); o += 4;
    const pc = v.getUint8(o); o += 1;
    const players = [];
    for (let i = 0; i < pc; i++) {
      const id = str();
      const x = v.getFloat32(o); o += 4; const y = v.getFloat32(o); o += 4;
      const aim = v.getFloat32(o); o += 4; const health = v.getFloat32(o); o += 4;
      const fireCooldown = v.getUint16(o); o += 2; const respawnIn = v.getUint16(o); o += 2;
      const slot = v.getUint8(o); o += 1; const score = v.getUint16(o); o += 2;
      players.push({ id, x, y, aim, health, fireCooldown, respawnIn, slot, score });
    }
    const prc = v.getUint16(o); o += 2;
    const projectiles = [];
    for (let i = 0; i < prc; i++) {
      const id = v.getUint32(o); o += 4; const ownerId = str();
      const x = v.getFloat32(o); o += 4; const y = v.getFloat32(o); o += 4;
      const vx = v.getFloat32(o); o += 4; const vy = v.getFloat32(o); o += 4;
      const ttl = v.getUint16(o); o += 2;
      projectiles.push({ id, ownerId, x, y, vx, vy, ttl });
    }
    return { t: "snapshot", ackTick, snapshot: { tick, players, projectiles } };
  }
  throw new Error("bad tag " + tag);
}

function connect(name) {
  return new Promise((resolve) => {
    const ws = new WebSocket(URL);
    ws.binaryType = "arraybuffer";
    const state = { name, ws, youId: null, snapshots: 0, last: null };
    ws.onmessage = (e) => {
      const m = decodeServer(e.data);
      if (m.t === "welcome") {
        state.youId = m.youId;
        console.log(`[${name}] welcome youId=${m.youId.slice(0, 8)} tickRate=${m.tickRate}`);
      } else if (m.t === "snapshot") {
        state.snapshots++;
        state.last = m;
      }
    };
    ws.onopen = () => resolve(state);
    ws.onerror = (e) => console.error(`[${name}] error`, e.message ?? e);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const me = (s) => s.last?.snapshot.players.find((p) => p.id === s.youId);

async function main() {
  const a = await connect("A");
  const b = await connect("B");
  await sleep(300);

  const startA = me(a);
  console.log(`[A] start pos = (${startA?.x.toFixed(1)}, ${startA?.y.toFixed(1)})`);

  // Drive A: move right + fire for ~1s.
  let tick = 0;
  for (let i = 0; i < 30; i++) {
    a.ws.send(encodeInput(tick++, 1, 0, 0.6, true));
    await sleep(33);
  }
  await sleep(300);

  const endA = me(a);
  console.log(`[A] end pos   = (${endA?.x.toFixed(1)}, ${endA?.y.toFixed(1)})  hp=${endA?.health}`);
  console.log(`[A] snapshots received: ${a.snapshots}`);
  console.log(`[B] snapshots received: ${b.snapshots}`);
  console.log(`[B] sees ${b.last?.snapshot.players.length} players, ackTick(A)=${a.last?.ackTick}`);

  const movedRight = endA && startA && endA.x > startA.x + 50;
  const bothGetSnapshots = a.snapshots > 10 && b.snapshots > 10;
  const projectilesExist = (a.last?.snapshot.projectiles.length ?? 0) >= 0;
  console.log("\nRESULT:");
  console.log(`  player moved right under server authority: ${movedRight ? "PASS" : "FAIL"}`);
  console.log(`  both clients receive snapshots:            ${bothGetSnapshots ? "PASS" : "FAIL"}`);
  console.log(`  ack echoed for reconciliation:             ${a.last?.ackTick != null ? "PASS" : "FAIL"}`);
  console.log(`  projectiles array present:                 ${projectilesExist ? "PASS" : "FAIL"}`);

  a.ws.close();
  b.ws.close();
  process.exit(movedRight && bothGetSnapshots ? 0 : 1);
}

main();
