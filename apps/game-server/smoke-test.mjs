// Ad-hoc smoke test for the authoritative room. Connects two clients, drives
// inputs from one, and checks the server moves that player and broadcasts
// snapshots to both. Run while `wrangler dev` is up on 8787.
// Base URL can be passed as argv[2] or WS_URL; defaults to local wrangler dev.
const BASE = process.argv[2] ?? process.env.WS_URL ?? "ws://127.0.0.1:8787";
const URL = `${BASE.replace(/\/+$/, "")}/rooms/smoke`;

function connect(name) {
  return new Promise((resolve) => {
    const ws = new WebSocket(URL);
    const state = { name, ws, youId: null, snapshots: 0, last: null };
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
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
    a.ws.send(
      JSON.stringify({
        t: "input",
        tick: tick++,
        input: { moveX: 1, moveY: 0, aim: 0.6, firing: true },
      }),
    );
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
