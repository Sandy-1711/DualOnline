# DUAL Online — Project Brief

> Context handoff for Claude Code. This file captures the design decisions and
> reasoning made during planning so we don't re-litigate them. Read this before
> scaffolding or proposing architecture changes.

## What we're building

An **online multiplayer game** inspired by [DUAL!](https://play.google.com/store/apps/details?id=com.Seabaa.Dual)
by Seabaa. The original is a *local* 2-player game (same WiFi/Bluetooth) where two
phones sit side by side and bullets fly across the gap between screens. It has three
modes: DUEL (1v1 shootout), DEFEND (co-op), DEFLECT (ball/goals).

**We are NOT cloning it literally.** We're taking the spirit online with a redesign:

- **Single shared arena**, slither.io-style — both players look at the *same* field,
  not two adjacent screens. This deliberately drops the original's two-screens-as-one-
  physical-space conceit, which was its hardest-to-port feature.
- **No tilt/accelerometer controls.** Replaced with normal on-screen controls suited
  to a shared-arena game.
- Players connect and play **over the internet**, not local network.

## Locked decisions

- **Platform:** Native mobile via **React Native / Expo**.
- **Design:** Single shared online arena (slither-style), no tilt.
- **Monorepo tooling:** **Turborepo + pnpm workspaces + TypeScript**.
- **Meta/API layer:** **tRPC** (auth, profiles, stats, leaderboards, matchmaking).
- **Realtime gameplay:** a dedicated realtime channel — **NOT tRPC**. tRPC is
  request/response and wrong for a 30–60Hz game loop.

## OPEN DECISION — confirm before designing the protocol

**Networking model: authoritative server vs P2P.**

The user initially wanted **P2P to avoid server costs**. Recommendation during planning
was to **go authoritative instead**, for these reasons (don't lose these):

- "P2P = no servers" is false for realtime mobile. WebRTC still needs a **signaling
  server**, **STUN**, and **TURN**. On mobile, carrier-grade NAT makes direct
  connections fail *often*, forcing TURN relay — which relays *all* game traffic and
  can cost **more** than a small game server.
- You **still need matchmaking** (a server) to pair players.
- P2P has **no referee** → one peer must be authority → latency edge + cheating.
- **slither.io itself runs authoritative servers**, not P2P.
- A **2-player authoritative server is extremely cheap** (tiny packets). Near-zero-cost
  hosting options exist:
  - **Cloudflare Durable Objects** — one object per game room, holds authoritative
    state + WebSocket connections, **scales to zero**, pay-per-use. Recommended default.
  - Small instance on **Fly.io / Railway / Render** — hosts many rooms cheaply.

**Default assumption unless the user says otherwise: authoritative server on Cloudflare
Durable Objects.** Confirm with the user before committing the protocol/transport design.

## Architecture

Two-layer split:

1. **Meta layer (tRPC over HTTP):** auth, profiles, stats, leaderboards, achievements,
   friends, matchmaking (create room / join / queue).
2. **Realtime layer (WebSocket):** the live match. Clients send inputs; server is the
   single source of truth and broadcasts state snapshots.

**Netcode model:** authoritative server + **client-side prediction** (own player moves
instantly, no round-trip wait) + **entity interpolation** (remote players/projectiles
rendered slightly in the past for smoothness). References: Gabriel Gambetta's
"Fast-Paced Multiplayer" series; Valve Source multiplayer networking.

**The crown jewel:** a shared **`sim` package** — deterministic game logic imported by
*both* the server (authority) and the client (prediction). Same TypeScript, two runtimes.

## Monorepo layout

```
dual-online/
├─ apps/
│  ├─ mobile/       # Expo (RN) + Skia renderer, client prediction + interpolation
│  ├─ game-server/  # authoritative realtime rooms (Cloudflare DO worker, or Node+ws)
│  └─ api/          # tRPC: auth, stats, leaderboards, matchmaking
├─ packages/
│  ├─ sim/          # ⭐ shared deterministic game logic (server + client import)
│  ├─ protocol/     # shared message + state types (zod schemas)
│  ├─ trpc/         # routers + typed client
│  └─ db/           # drizzle/prisma schema (Postgres; + Redis for queue/leaderboard)
└─ turbo.json, pnpm-workspace.yaml, tsconfig base, eslint config
```

## Stack choices

- **Rendering (mobile):** `@shopify/react-native-skia` (fast 2D, runs on UI thread),
  driven by a game loop via `react-native-reanimated`'s frame callback. `expo-gl` is
  the fallback if Skia is outgrown.
- **Realtime transport:** RN has built-in `WebSocket` — no native module needed to talk
  to an authoritative server. (P2P would require `react-native-webrtc`, a native module.)
- **Validation/schemas:** zod, shared via `packages/protocol`.
- **DB:** Postgres (Drizzle or Prisma — pick one). Redis optional for matchmaking
  queue / leaderboards.

## Constraints & gotchas

- **Expo dev builds required.** Skia (and webrtc, if ever used) are native modules →
  cannot run in Expo Go. Use a custom dev client / EAS build.
- **If using Cloudflare Durable Objects:** the Workers runtime is NOT Node. `packages/sim`
  must be **pure, runtime-agnostic TS** (no Node APIs). This is healthy for determinism anyway.
- **Determinism:** the sim must be deterministic for prediction/reconciliation to work.
  Be disciplined with float math, fixed timestep, and stable iteration order.
- **Hosting region / latency:** primary user is in India — choose a server region
  accordingly (or Cloudflare's edge handles this for DO).

## Build order

The slither pivot collapses all three original modes into "things happening in one
shared arena," so they share the same netcode. Sequence:

1. **Monorepo scaffold** — Turborepo + pnpm, the apps/packages skeleton above, shared
   tsconfig/eslint.
2. **`packages/sim` + `packages/protocol`** — core deterministic loop: player entity,
   movement, projectiles, collisions; zod message/state schemas.
3. **`game-server`** — authoritative room: accept 2 clients, run sim at fixed tick,
   broadcast snapshots. (DO worker or Node+ws per the open decision.)
4. **`apps/mobile`** — Skia render of the arena + game loop; client prediction on own
   player, interpolation on remote entities; WebSocket client.
5. **Core loop playable:** both players move, shoot, see each other in one arena.
6. **`api` (tRPC):** matchmaking, then auth/stats/leaderboards.
7. **Layer the modes** (DUEL-like, DEFLECT-like, DEFEND-like) on the shared arena.

## Suggested first tasks for Claude Code

- Confirm the networking decision (authoritative DO vs Node+ws vs P2P) with the user.
- Scaffold the Turborepo + pnpm workspace and the apps/packages skeleton.
- Stand up `packages/protocol` with zod schemas for client→server input and
  server→client snapshot messages.
- Implement a minimal deterministic `sim` with a fixed timestep and one test
  (same inputs → same state) to lock determinism early.

## References

- Original game: https://play.google.com/store/apps/details?id=com.Seabaa.Dual
- Gabriel Gambetta — Fast-Paced Multiplayer (client prediction, interpolation,
  server reconciliation)
- Valve — Source Multiplayer Networking
- Cloudflare Durable Objects (per-room authoritative state + WebSockets)
- @shopify/react-native-skia, react-native-reanimated