/**
 * Presentational arena: given the entities to draw and the input callbacks, it
 * renders the Skia scene, HUD, and joysticks. It is mode-agnostic — the same
 * component renders the local bot match and the online match. *Where* the
 * entities come from (local sim vs predicted+interpolated network state) is the
 * caller's job.
 */
import { Canvas, Circle, Group, Line, Rect, vec } from "@shopify/react-native-skia";
import { ARENA_HEIGHT, ARENA_WIDTH, PLAYER_MAX_HEALTH, PLAYER_RADIUS, PROJECTILE_RADIUS } from "@dual/sim";
import { StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { playerColor, theme } from "../theme";
import { Joystick, type StickValue } from "./Joystick";

const GRID_STEP = 100;

export interface RenderPlayer {
  id: string;
  x: number;
  y: number;
  aim: number;
  health: number;
  respawnIn: number;
  slot: number;
  score: number;
}

export interface RenderProjectile {
  id: number;
  x: number;
  y: number;
  ownerId: string;
}

interface Props {
  players: RenderPlayer[];
  projectiles: RenderProjectile[];
  youId: string | null;
  oppLabel?: string;
  banner?: string | null;
  onMove: (s: StickValue) => void;
  onAim: (s: StickValue) => void;
}

export function Arena({ players, projectiles, youId, oppLabel = "OPP", banner, onMove, onAim }: Props) {
  const { width, height } = useWindowDimensions();
  const margin = 12;
  const scale = Math.min(width, height - margin * 2) / ARENA_WIDTH;
  const offsetX = (width - ARENA_WIDTH * scale) / 2;
  const offsetY = (height - ARENA_HEIGHT * scale) / 2;

  const you = players.find((p) => p.id === youId);
  const opp = players.find((p) => p.id !== youId);

  return (
    <View style={styles.root}>
      <Canvas style={styles.canvas}>
        <Group transform={[{ translateX: offsetX }, { translateY: offsetY }, { scale }]}>
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

          {projectiles.map((pr) => {
            const owner = players.find((p) => p.id === pr.ownerId);
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

          {players.map((p) => {
            const color = playerColor(p.slot);
            const alive = p.respawnIn <= 0;
            const muzzle = PLAYER_RADIUS * 1.7;
            return (
              <Group key={p.id} opacity={alive ? 1 : 0.25}>
                <Circle cx={p.x} cy={p.y} r={PLAYER_RADIUS} color={color} />
                {p.id === youId && (
                  <Circle
                    cx={p.x}
                    cy={p.y}
                    r={PLAYER_RADIUS + 5}
                    color={color}
                    style="stroke"
                    strokeWidth={2}
                    opacity={0.5}
                  />
                )}
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

      <View style={styles.hud} pointerEvents="none">
        <Text style={[styles.score, { color: playerColor(you?.slot ?? 0) }]}>YOU {you?.score ?? 0}</Text>
        <Text style={styles.vs}>vs</Text>
        <Text style={[styles.score, { color: playerColor(opp?.slot ?? 1) }]}>
          {oppLabel} {opp?.score ?? 0}
        </Text>
      </View>

      {banner ? (
        <View style={styles.bannerWrap} pointerEvents="none">
          <Text style={styles.banner}>{banner}</Text>
        </View>
      ) : null}

      <Joystick side="left" color={playerColor(you?.slot ?? 0)} onChange={onMove} />
      <Joystick side="right" color={theme.text} onChange={onAim} />
    </View>
  );
}

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
  bannerWrap: {
    position: "absolute",
    top: 52,
    left: 0,
    right: 0,
    alignItems: "center",
  },
  banner: {
    color: theme.text,
    backgroundColor: "rgba(0,0,0,0.5)",
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 8,
    fontSize: 14,
    fontWeight: "600",
    overflow: "hidden",
  },
});
