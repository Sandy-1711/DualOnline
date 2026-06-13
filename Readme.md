# DUAL Online

An online multiplayer game inspired by [DUAL!](https://play.google.com/store/apps/details?id=com.Seabaa.Dual)
by Seabaa — reimagined as a **single shared arena** (slither.io-style) played over the
internet, with normal on-screen controls instead of tilt.

See [Claude.MD](Claude.MD) for the full design brief and locked decisions.

## Monorepo layout

```
dual-online/
├─ apps/
│  └─ mobile/       # Expo (React Native) + Skia renderer, runs the sim locally for now
├─ packages/
│  ├─ sim/          # ⭐ shared deterministic game logic (will run on server + client)
│  └─ protocol/     # shared message + state types (zod schemas)
└─ turbo.json, pnpm-workspace.yaml, tsconfig.base.json
```

> Coming later (deferred): `apps/game-server` (Cloudflare Durable Objects, authoritative
> realtime), `apps/api` (tRPC: auth/stats/leaderboards/matchmaking), `packages/db`.

## Current status

**Core game runs client-side.** The deterministic `sim` drives a playable arena in the
Expo app — move and shoot, no server required yet. The same `sim` will later be promoted
to the authoritative server with client-side prediction.

## Getting started

```bash
pnpm install

# Fastest preview — runs in the browser:
pnpm mobile:web

# On a device/emulator (requires a custom dev build, NOT Expo Go, because Skia is native):
pnpm mobile
```

### Why not Expo Go?

`@shopify/react-native-skia` and `react-native-reanimated` are native modules. They run in
a **custom dev client / EAS build**, not Expo Go. The **web** target is the quickest way to
see the game without a native build pipeline.

## Tech stack

- **Rendering:** `@shopify/react-native-skia` driven by `react-native-reanimated`
- **Monorepo:** Turborepo + pnpm workspaces + TypeScript
- **Validation:** zod (shared via `packages/protocol`)
- **Realtime (later):** authoritative server on Cloudflare Durable Objects + WebSockets
