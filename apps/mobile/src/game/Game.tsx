/**
 * The playable arena. Runs `@dual/sim` locally at a fixed tick rate and renders
 * the authoritative-style state with Skia. You are player "p1"; "p2" is a bot.
 *
 * When the realtime server lands, the only change here is *where the next state
 * comes from*: instead of stepping the sim locally for the opponent, we apply
 * server snapshots and reconcile our own predicted player.
 */
import { Canvas, Circle, Group, Line, Rect, vec } from "@shopify/react-native-skia";
import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  DT,
  PLAYER_MAX_HEALTH,
  PLAYER_RADIUS,
  PROJECTILE_RADIUS,
  SPAWN_POINTS,
  createInitialState,
  step,
  type GameState,
  type PlayerInput,
} from "@dual/sim";
import { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { playerColor, theme } from "../theme";
import { Joystick, type StickValue } from "./Joystick";
import { botInput } from "./bot";

const LOCAL_ID = "p1";
const BOT_ID = "p2";
const DT_MS = DT * 1000;
const GRID_STEP = 100;

export function Game() {
  const { width, height } = useWindowDimensions();

  // --- Fit the square arena into the screen, letterboxed + centered. -------
  const margin = 12;
  const scale = Math.min(width, height - margin * 2) / ARENA_WIDTH;
  const offsetX = (width - ARENA_WIDTH * scale) / 2;
  const offsetY = (height - ARENA_HEIGHT * scale) / 2;

  // --- Live state. The sim state lives in a ref; we mirror it into React
  //     state once per tick purely to trigger a redraw. ----------------------
  const stateRef = useRef<GameState>(createInitialState([LOCAL_ID, BOT_ID]));
  const [snapshot, setSnapshot] = useState<GameState>(stateRef.current);

  // --- Local input, written by the joysticks, read by the loop. ------------
  const moveRef = useRef({ x: 0, y: 0 });
  const localSpawnAim = SPAWN_POINTS[0]!.aim;
  const aimRef = useRef(localSpawnAim);
  const firingRef = useRef(false);

  const onMove = (s: StickValue) => {
    moveRef.current = { x: s.x * s.magnitude, y: s.y * s.magnitude };
  };
  const onAim = (s: StickValue) => {
    // Touching the right stick fires immediately (in the current aim direction);
    // dragging it steers the shots. Releasing stops fire and keeps the last aim.
    firingRef.current = s.pressed;
    if (s.magnitude > 0.2) {
      aimRef.current = Math.atan2(s.y, s.x);
    }
  };

  // --- Fixed-timestep game loop. -------------------------------------------
  useEffect(() => {
    let raf: number;
    let last: number | null = null;
    let acc = 0;

    const frame = (now: number) => {
      if (last === null) last = now;
      let delta = now - last;
      last = now;
      if (delta > 250) delta = 250; // clamp after a stall; no spiral of death
      acc += delta;

      let advanced = false;
      while (acc >= DT_MS) {
        const local: PlayerInput = {
          moveX: moveRef.current.x,
          moveY: moveRef.current.y,
          aim: aimRef.current,
          firing: firingRef.current,
        };
        stateRef.current = step(stateRef.current, {
          [LOCAL_ID]: local,
          [BOT_ID]: botInput(stateRef.current, BOT_ID, LOCAL_ID),
        });
        acc -= DT_MS;
        advanced = true;
      }
      if (advanced) setSnapshot(stateRef.current);
      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  const you = snapshot.players.find((p) => p.id === LOCAL_ID);
  const bot = snapshot.players.find((p) => p.id === BOT_ID);

  return (
    <View style={styles.root}>
      <Canvas style={styles.canvas}>
        <Group transform={[{ translateX: offsetX }, { translateY: offsetY }, { scale }]}>
          {/* Arena floor + border */}
          <Rect x={0} y={0} width={ARENA_WIDTH} height={ARENA_HEIGHT} color={theme.arena} />
          {gridLines()}
          <Rect
            x={0}
            y={0}
            width={ARENA_WIDTH}
            height={ARENA_HEIGHT}
            color={theme.arenaBorder}
            style="stroke"
            strokeWidth={3}
          />

          {/* Projectiles */}
          {snapshot.projectiles.map((pr) => {
            const owner = snapshot.players.find((p) => p.id === pr.ownerId);
            return (
              <Circle
                key={pr.id}
                cx={pr.x}
                cy={pr.y}
                r={PROJECTILE_RADIUS}
                color={owner ? playerColor(owner.slot) : theme.text}
              />
            );
          })}

          {/* Players */}
          {snapshot.players.map((p) => {
            const color = playerColor(p.slot);
            const alive = p.respawnIn <= 0;
            const bodyOpacity = alive ? 1 : 0.25;
            const muzzle = PLAYER_RADIUS * 1.7;
            return (
              <Group key={p.id} opacity={bodyOpacity}>
                <Circle cx={p.x} cy={p.y} r={PLAYER_RADIUS} color={color} />
                {alive && (
                  <Line
                    p1={vec(p.x, p.y)}
                    p2={vec(p.x + Math.cos(p.aim) * muzzle, p.y + Math.sin(p.aim) * muzzle)}
                    color={theme.bg}
                    strokeWidth={5}
                  />
                )}
                {alive && healthBar(p.x, p.y, p.health)}
              </Group>
            );
          })}
        </Group>
      </Canvas>

      {/* HUD */}
      <View style={styles.hud} pointerEvents="none">
        <Text style={[styles.score, { color: playerColor(0) }]}>YOU {you?.score ?? 0}</Text>
        <Text style={styles.vs}>vs</Text>
        <Text style={[styles.score, { color: playerColor(1) }]}>BOT {bot?.score ?? 0}</Text>
      </View>

      {/* Controls */}
      <Joystick side="left" color={playerColor(0)} onChange={onMove} />
      <Joystick side="right" color={theme.text} onChange={onAim} />
    </View>
  );
}

/** Faint world-space grid drawn behind entities. */
function gridLines() {
  const lines = [];
  for (let x = GRID_STEP; x < ARENA_WIDTH; x += GRID_STEP) {
    lines.push(
      <Line key={`v${x}`} p1={vec(x, 0)} p2={vec(x, ARENA_HEIGHT)} color={theme.grid} strokeWidth={1} />,
    );
  }
  for (let y = GRID_STEP; y < ARENA_HEIGHT; y += GRID_STEP) {
    lines.push(
      <Line key={`h${y}`} p1={vec(0, y)} p2={vec(ARENA_WIDTH, y)} color={theme.grid} strokeWidth={1} />,
    );
  }
  return lines;
}

/** A small health bar floating above a player. */
function healthBar(x: number, y: number, health: number) {
  const w = PLAYER_RADIUS * 2.2;
  const h = 6;
  const bx = x - w / 2;
  const by = y - PLAYER_RADIUS - 16;
  const frac = Math.max(0, health / PLAYER_MAX_HEALTH);
  const color = frac > 0.5 ? "#4caf50" : frac > 0.25 ? "#ffb13b" : "#f44336";
  return (
    <Group>
      <Rect x={bx} y={by} width={w} height={h} color={theme.healthBack} />
      <Rect x={bx} y={by} width={w * frac} height={h} color={color} />
    </Group>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  canvas: { flex: 1 },
  hud: {
    position: "absolute",
    top: 14,
    left: 0,
    right: 0,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 14,
  },
  score: { fontSize: 22, fontWeight: "800", letterSpacing: 1 },
  vs: { color: theme.textDim, fontSize: 14, fontWeight: "600" },
});
