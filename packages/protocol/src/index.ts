/**
 * Wire protocol for DUAL Online.
 *
 * These zod schemas are the single source of truth for what crosses the network
 * boundary: client -> server inputs and server -> client state snapshots. They
 * mirror the shapes in `@dual/sim` but are defined here independently so the
 * wire format can evolve (versioning, compression) without dragging the sim's
 * internals along.
 *
 * Nothing here is wired to a transport yet — the client currently runs the sim
 * locally. When the authoritative server lands, both ends validate against
 * these schemas.
 */
import { z } from "zod";

/** Bump when the message shapes change in a breaking way. */
export const PROTOCOL_VERSION = 1;

// --- Primitives ------------------------------------------------------------

export const PlayerInputSchema = z.object({
  moveX: z.number(),
  moveY: z.number(),
  aim: z.number(),
  firing: z.boolean(),
});
export type PlayerInput = z.infer<typeof PlayerInputSchema>;

export const PlayerSchema = z.object({
  id: z.string(),
  x: z.number(),
  y: z.number(),
  aim: z.number(),
  health: z.number(),
  fireCooldown: z.number(),
  respawnIn: z.number(),
  slot: z.number().int(),
  score: z.number().int(),
});
export type Player = z.infer<typeof PlayerSchema>;

export const ProjectileSchema = z.object({
  id: z.number().int(),
  ownerId: z.string(),
  x: z.number(),
  y: z.number(),
  vx: z.number(),
  vy: z.number(),
  ttl: z.number().int(),
});
export type Projectile = z.infer<typeof ProjectileSchema>;

export const SnapshotSchema = z.object({
  tick: z.number().int(),
  players: z.array(PlayerSchema),
  projectiles: z.array(ProjectileSchema),
});
export type Snapshot = z.infer<typeof SnapshotSchema>;

// --- Client -> Server ------------------------------------------------------

/** A player's input for a specific tick, tagged so the server can reconcile. */
export const ClientInputMessage = z.object({
  t: z.literal("input"),
  /** The client tick this input belongs to (for prediction/reconciliation). */
  tick: z.number().int(),
  input: PlayerInputSchema,
});

export const JoinMessage = z.object({
  t: z.literal("join"),
  v: z.literal(PROTOCOL_VERSION),
  roomId: z.string(),
});

export const ClientMessage = z.discriminatedUnion("t", [JoinMessage, ClientInputMessage]);
export type ClientMessage = z.infer<typeof ClientMessage>;

// --- Server -> Client ------------------------------------------------------

/** Sent once on join: who you are and the players in the room. */
export const WelcomeMessage = z.object({
  t: z.literal("welcome"),
  v: z.literal(PROTOCOL_VERSION),
  youId: z.string(),
  tickRate: z.number().int(),
});

/** Authoritative world state for a tick. */
export const SnapshotMessage = z.object({
  t: z.literal("snapshot"),
  /** Echoes the last client input tick the server has applied (reconciliation). */
  ackTick: z.number().int().optional(),
  snapshot: SnapshotSchema,
});

export const ServerMessage = z.discriminatedUnion("t", [WelcomeMessage, SnapshotMessage]);
export type ServerMessage = z.infer<typeof ServerMessage>;

// --- Helpers ---------------------------------------------------------------

/** Parse an untrusted inbound client message, throwing on malformed input. */
export function parseClientMessage(raw: unknown): ClientMessage {
  return ClientMessage.parse(raw);
}

/** Parse an untrusted inbound server message. */
export function parseServerMessage(raw: unknown): ServerMessage {
  return ServerMessage.parse(raw);
}

// Binary wire codec (the transport actually used at runtime). The zod schemas
// above remain the source of truth for the message TYPES.
export * from "./binary";
