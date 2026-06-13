/**
 * Worker entry. Routes a WebSocket upgrade at `/rooms/:roomId` to the GameRoom
 * Durable Object instance named by that room id, so every client using the same
 * room id lands in the same authoritative match.
 */
import { GameRoom, type Env } from "./GameRoom";

export { GameRoom };

const ROOM_PATH = /^\/rooms\/([A-Za-z0-9_-]{1,64})$/;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/" || url.pathname === "/health") {
      return new Response("DUAL game-server up. Connect a WebSocket to /rooms/:roomId", {
        status: 200,
      });
    }

    const match = ROOM_PATH.exec(url.pathname);
    if (!match) {
      return new Response("Not found. Use /rooms/:roomId", { status: 404 });
    }

    const roomId = match[1]!;
    const id = env.GAME_ROOM.idFromName(roomId);
    // Pin the room near our players (India → Asia-Pacific). A Durable Object
    // lives in ONE location for its lifetime; placing it close keeps RTT — and
    // therefore the smoothing burden — low for everyone in the match. This only
    // affects where a NEW object is created.
    const stub = env.GAME_ROOM.get(id, { locationHint: "apac" });
    return stub.fetch(request);
  },
} satisfies ExportedHandler<Env>;
