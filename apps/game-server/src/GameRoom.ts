/**
 * GameRoom — one authoritative match.
 *
 * A Durable Object is a single, stateful instance living on Cloudflare's edge.
 * We address one instance per room id, so this object IS the match: it holds the
 * authoritative `GameState` in memory, owns both players' WebSockets, runs the
 * SAME `@dual/sim` the client runs, and is the only place that decides truth.
 *
 * Clients send inputs; the server steps the sim at a fixed tick and broadcasts
 * snapshots. No gameplay decision is ever made by a client.
 */
import { DurableObject } from "cloudflare:workers";
import {
  createInitialState,
  neutralInput,
  step,
  TICK_RATE,
  type GameState,
  type InputMap,
  type PlayerInput,
} from "@dual/sim";
import { parseClientMessage, PROTOCOL_VERSION, type ServerMessage } from "@dual/protocol";

export interface Env {
  GAME_ROOM: DurableObjectNamespace;
}

const MAX_PLAYERS = 2;
const TICK_MS = 1000 / TICK_RATE;

// Simulate at the full tick rate, but only BROADCAST every Nth tick. Snapshots
// at ~20Hz cut bandwidth ~3x; client interpolation hides the gaps. (60/3 = 20Hz.)
const SNAPSHOT_INTERVAL = 3;

// A client sends input every tick, so silence means a dead/zombie connection
// (closed tab, lost signal) whose close frame never arrived. Evict it so the
// room can't get stuck "full" with ghosts.
const CONN_TIMEOUT_MS = 8000;

interface Conn {
  socket: WebSocket;
  id: string;
  lastSeen: number;
}

export class GameRoom extends DurableObject<Env> {
  /** Connected sockets and the player id we minted for each. */
  private conns = new Map<WebSocket, Conn>();
  /** Latest input received per player id (applied every tick). */
  private inputs = new Map<string, PlayerInput>();
  /** Last input tick we've seen per player, echoed back for reconciliation. */
  private acks = new Map<string, number>();
  private sim: GameState | null = null;
  private loop: ReturnType<typeof setInterval> | null = null;
  private tickCount = 0;

  /** HTTP entrypoint — we only accept WebSocket upgrades here. */
  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected a WebSocket upgrade", { status: 426 });
    }
    if (this.conns.size >= MAX_PLAYERS) {
      return new Response("Room full", { status: 409 });
    }

    const { 0: client, 1: server } = new WebSocketPair();
    this.acceptConnection(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  private acceptConnection(socket: WebSocket): void {
    socket.accept();
    const id = crypto.randomUUID();
    this.conns.set(socket, { socket, id, lastSeen: Date.now() });

    const welcome: ServerMessage = {
      t: "welcome",
      v: PROTOCOL_VERSION,
      youId: id,
      tickRate: TICK_RATE,
    };
    socket.send(JSON.stringify(welcome));

    socket.addEventListener("message", (event) => this.onMessage(socket, event));
    const cleanup = () => this.onClose(socket);
    socket.addEventListener("close", cleanup);
    socket.addEventListener("error", cleanup);

    // (Re)start the match for the current roster and make sure the loop runs.
    this.rebuildSim();
    this.ensureLoop();
  }

  private onMessage(socket: WebSocket, event: MessageEvent): void {
    const conn = this.conns.get(socket);
    if (!conn) return;
    conn.lastSeen = Date.now(); // any traffic counts as "alive"

    let parsed: unknown;
    try {
      parsed = JSON.parse(typeof event.data === "string" ? event.data : "");
    } catch {
      return; // ignore non-JSON
    }

    let msg;
    try {
      msg = parseClientMessage(parsed);
    } catch {
      return; // ignore anything that doesn't match the protocol — never trust the wire
    }

    if (msg.t === "input") {
      this.inputs.set(conn.id, msg.input);
      this.acks.set(conn.id, msg.tick);
    }
    // "join" is informational here; the connection already exists. Version
    // negotiation could be enforced against msg.v in a later pass.
  }

  private onClose(socket: WebSocket): void {
    const conn = this.conns.get(socket);
    if (conn) {
      this.inputs.delete(conn.id);
      this.acks.delete(conn.id);
    }
    this.conns.delete(socket);
    this.rebuildSim();
    this.ensureLoop();
  }

  /**
   * Build a fresh authoritative state for whoever is currently connected. v1
   * resets the match whenever the roster changes; a ready/lobby flow comes later.
   */
  private rebuildSim(): void {
    const ids = [...this.conns.values()].map((c) => c.id);
    this.sim = ids.length > 0 ? createInitialState(ids) : null;
  }

  /** Run the tick loop only while someone is connected. */
  private ensureLoop(): void {
    if (this.conns.size > 0 && this.loop === null) {
      this.loop = setInterval(() => this.tick(), TICK_MS);
    } else if (this.conns.size === 0 && this.loop !== null) {
      clearInterval(this.loop);
      this.loop = null;
    }
  }

  /**
   * Drop connections that have gone silent (a client sends input every tick, so
   * silence = a dead socket whose close frame never arrived). Returns true if
   * anything was evicted. This is what stops the room getting stuck "full".
   */
  private sweepDeadConnections(): boolean {
    const now = Date.now();
    let changed = false;
    for (const [socket, conn] of this.conns) {
      if (now - conn.lastSeen > CONN_TIMEOUT_MS) {
        this.inputs.delete(conn.id);
        this.acks.delete(conn.id);
        this.conns.delete(socket);
        try {
          socket.close(1001, "timeout");
        } catch {
          // already gone
        }
        changed = true;
      }
    }
    return changed;
  }

  private tick(): void {
    if (this.sweepDeadConnections()) {
      this.rebuildSim();
      this.ensureLoop();
    }
    if (!this.sim) return;

    // Step the sim every tick (full rate) for fine-grained, prediction-friendly
    // physics.
    const map: InputMap = {};
    for (const conn of this.conns.values()) {
      map[conn.id] = this.inputs.get(conn.id) ?? neutralInput();
    }
    this.sim = step(this.sim, map);

    // ...but only broadcast every Nth tick to save bandwidth (~20Hz).
    this.tickCount++;
    if (this.tickCount % SNAPSHOT_INTERVAL !== 0) return;

    // The snapshot omits the sim's internal bookkeeping (nextProjectileId).
    const snapshot = {
      tick: this.sim.tick,
      players: this.sim.players,
      projectiles: this.sim.projectiles,
    };

    // Send per-connection so each client gets its own input ack for reconciliation.
    for (const conn of this.conns.values()) {
      const message: ServerMessage = {
        t: "snapshot",
        ackTick: this.acks.get(conn.id),
        snapshot,
      };
      try {
        conn.socket.send(JSON.stringify(message));
      } catch {
        // Socket is gone; the sweep / close handler will clean it up.
      }
    }
  }
}
