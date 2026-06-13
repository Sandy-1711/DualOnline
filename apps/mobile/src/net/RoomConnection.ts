/**
 * Thin WebSocket client for a game room. Speaks the `@dual/protocol` wire format:
 * sends `join` + `input`, receives `welcome` + `snapshot`. Validates every
 * inbound message before surfacing it (the server is trusted, but the transport
 * isn't — and validation catches version/shape drift early).
 */
import {
  decodeServerMessage,
  encodeClientMessage,
  PROTOCOL_VERSION,
  type ClientMessage,
  type PlayerInput,
  type Snapshot,
} from "@dual/protocol";

export type RoomStatus = "connecting" | "open" | "closed" | "error";

export interface RoomHandlers {
  onWelcome?(youId: string, tickRate: number): void;
  onSnapshot?(snapshot: Snapshot, ackTick: number | undefined): void;
  onStatus?(status: RoomStatus): void;
}

export class RoomConnection {
  private ws: WebSocket | null = null;

  constructor(
    private readonly baseUrl: string,
    private readonly roomId: string,
    private readonly handlers: RoomHandlers,
  ) {}

  connect(): void {
    const url = `${this.baseUrl.replace(/\/+$/, "")}/rooms/${this.roomId}`;
    const ws = new WebSocket(url);
    ws.binaryType = "arraybuffer"; // receive binary frames as ArrayBuffer
    this.ws = ws;
    this.handlers.onStatus?.("connecting");

    ws.onopen = () => {
      this.handlers.onStatus?.("open");
      this.send({ t: "join", v: PROTOCOL_VERSION, roomId: this.roomId });
    };

    ws.onmessage = (event: MessageEvent) => {
      const data = event.data;
      if (typeof data === "string") return; // we speak binary
      let msg;
      try {
        msg = decodeServerMessage(data as ArrayBuffer);
      } catch {
        return; // ignore malformed messages
      }
      if (msg.t === "welcome") this.handlers.onWelcome?.(msg.youId, msg.tickRate);
      else if (msg.t === "snapshot") this.handlers.onSnapshot?.(msg.snapshot, msg.ackTick);
    };

    ws.onclose = () => this.handlers.onStatus?.("closed");
    ws.onerror = () => this.handlers.onStatus?.("error");
  }

  send(msg: ClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(encodeClientMessage(msg));
    }
  }

  sendInput(tick: number, input: PlayerInput): void {
    this.send({ t: "input", tick, input });
  }

  close(): void {
    this.ws?.close();
    this.ws = null;
  }
}
