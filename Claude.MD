# DUAL Online — Project Brief & Status

> Context handoff for Claude Code. Top section = current status (keep this
> accurate). Lower sections = the original design reasoning, preserved so we
> don't re-litigate settled decisions.

---

## CURRENT STATUS (2026-06-14)

**It's a deployed, playable online 1v1.** The core loop works end-to-end over the
internet, on phones and web.

### Live
- **Client (Cloudflare Pages):** https://dual-online.pages.dev
- **Game-server (Cloudflare Worker + Durable Object):** `wss://dual-game-server.sandy1711003.workers.dev` (`/rooms/:id`)
- Cloudflare account: sandy1711003@gmail.com.

### What's built
- `packages/sim` — deterministic core (movement, firing, projectiles, collisions),
  **fixed 60Hz** tick, pure/runtime-agnostic. 6 tests. ⭐ runs on server AND client.
- `packages/protocol` — message + state types (zod) **and a binary wire codec**
  (the transport actually used). 9 tests.
- `packages/netcode` — pure prediction/reconciliation, entity interpolation,
  projectile extrapolation (dead reckoning). 8 tests.
- `apps/game-server` — authoritative `GameRoom` Durable Object: accepts 2 players,
  steps the sim at 60Hz, **broadcasts at 20Hz**, evicts zombie connections,
  `locationHint: "apac"`. Local: `wrangler dev`; e2e: `node smoke-test.mjs <wsUrl>`.
- `apps/mobile` — Expo + Skia twin-stick client. Start menu → **Practice vs Bot**
  (local sim) or **Play Online** (server). Client prediction + reconciliation with
  **smooth error correction**, **adaptive interpolation**, dead-reckoned opponent
  bullets. Web target deployed to Pages; native needs a dev build (Skia is native).

### Deploy (both already wired)
- Server: `cd apps/game-server && wrangler deploy`
- Client: `cd apps/mobile && npx expo export --platform web && wrangler pages deploy dist --project-name dual-online --branch main`

### Not built yet (roadmap, rough priority)
1. **Game feel** — hit flashes, muzzle flash, kill feed, respawn countdown.
2. **Meta layer** — `apps/api` (tRPC) + `packages/db`: auth, stats, leaderboards,
   **matchmaking** (replace typing a room code). DB: user leans **MongoDB** → use
   **Prisma or Mongoose** (Drizzle is SQL-only, won't work with Mongo).
3. **The other modes** — DEFLECT, DEFEND on the shared arena (only DUEL exists).
4. **Gameplay additions** — health restore, pickups (health/food), obstacles
   (all go in `@dual/sim` as new entity arrays; keep determinism).
5. **Robustness** — auto-reconnect, real ready/lobby (today the match resets on any
   roster change), >2 players. **Optional:** live RTT/jitter HUD readout.

### Known real-world issues (diagnosed, not bugs in our code)
- A peer on a poor link (e.g. a VI SIM) jitters; same-network play is smooth.
  Adaptive interpolation + smooth correction absorb it but can't fix a bad last-mile.
- A laptop tethered behind a phone hotspot is *downstream* of the phone (extra hop,
  shared uplink) AND browsers throttle `setInterval`/rAF for unfocused/battery tabs
  → host-side stutter. Focus the window + plug in to test.

### Learning notes
There are **knowledge books** in `knowledge/` (gitignored, local only) — 01
foundations, 02 server, 03 client netcode, 04 deploy, 05 bad networks, 06
optimizations & diagnosis. Write a new one when asked.

---

## What we're building

An **online multiplayer game** inspired by [DUAL!](https://play.google.com/store/apps/details?id=com.Seabaa.Dual)
by Seabaa. The original is a *local* 2-player game (phones side by side, bullets
fly across the gap). We took the spirit online with a redesign:

- **Single shared arena**, slither.io-style — both players look at the *same* field.
- **No tilt/accelerometer.** Twin-stick on-screen controls (left = move, right =
  aim + fire).
- Players connect and play **over the internet**.

## Locked decisions

- **Platform:** React Native / Expo. Renderer: `@shopify/react-native-skia` driven
  by a `requestAnimationFrame` loop.
- **Monorepo:** Turborepo + pnpm workspaces + TypeScript. (pnpm needs
  `node-linker=hoisted` for Metro; workspace pkgs use extensionless imports.)
- **Networking: authoritative server on Cloudflare Durable Objects** — RESOLVED &
  DEPLOYED (see reasoning below). One DO per room holds state + WebSockets.
- **Realtime transport:** WebSocket carrying a **binary protocol** (not tRPC, not
  JSON). Meta/API layer (future) will be tRPC over HTTP.
- **Netcode:** authoritative server + client-side prediction + reconciliation +
  entity interpolation (Gambetta / Valve model).

## Why authoritative server (not P2P) — settled, don't re-open

- "P2P = no servers" is false for realtime mobile: WebRTC still needs signaling +
  STUN + **TURN** (carrier-grade NAT forces relay, which can cost more than a tiny
  game server). You still need a matchmaking server. P2P has no referee → cheating
  + latency edge. slither.io itself runs authoritative servers.
- A 2-player authoritative server is extremely cheap. **Cloudflare Durable Objects**
  scale to zero, pay-per-use, one object per room. (Vercel can't host realtime —
  functions are ephemeral; it's only viable for the future tRPC api layer.)

## Architecture

1. **Meta layer (tRPC/HTTP) — future:** auth, profiles, stats, leaderboards,
   matchmaking.
2. **Realtime layer (WebSocket) — built:** clients send inputs; the DO is the single
   source of truth and broadcasts state snapshots.

**Crown jewel:** the shared `sim` package — identical deterministic TypeScript
imported by both the server (authority) and the client (prediction).

## Monorepo layout

```
dual-online/
├─ apps/
│  ├─ mobile/       # Expo + Skia client (prediction/interp) — deployed to CF Pages
│  ├─ game-server/  # authoritative DO worker — deployed to CF Workers
│  └─ api/          # tRPC: auth/stats/leaderboards/matchmaking  (NOT built)
├─ packages/
│  ├─ sim/          # ⭐ shared deterministic game logic
│  ├─ protocol/     # shared types (zod) + binary wire codec
│  ├─ netcode/      # prediction/reconciliation/interpolation/extrapolation
│  └─ db/           # Postgres/Mongo schema  (NOT built; Mongo → Prisma/Mongoose)
└─ turbo.json, pnpm-workspace.yaml, tsconfig.base.json, .npmrc (node-linker=hoisted)
```

## Constraints & gotchas

- **Expo dev builds required for native** (Skia/Reanimated are native modules; not
  Expo Go). **Web** is the quickest preview and what's deployed.
- **DO runtime is NOT Node** → `packages/sim` must stay pure runtime-agnostic TS.
- **Determinism:** fixed timestep, no `Date.now`/`Math.random` in `step`, stable
  iteration order. (Cross-platform float determinism would need fixed-point later.)
- **Reanimated 4** → Babel plugin is `react-native-worklets/plugin` (last plugin).
- **Skia web** needs CanvasKit loaded via CDN in `index.web.ts`.
- **DO is single-location** — pinned to `apac` for India latency.

## References

- Original game: https://play.google.com/store/apps/details?id=com.Seabaa.Dual
- Gabriel Gambetta — Fast-Paced Multiplayer; Valve — Source Multiplayer Networking
- Cloudflare Durable Objects; @shopify/react-native-skia
