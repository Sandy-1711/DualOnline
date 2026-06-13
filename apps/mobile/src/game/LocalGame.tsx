/**
 * Practice mode: runs `@dual/sim` locally at a fixed tick — you (p1) vs a bot
 * (p2). No network. Useful as a warm-up and as a reference for how the same sim
 * behaves without prediction/interpolation in the way.
 */
import { DT, SPAWN_POINTS, createInitialState, step, type GameState, type PlayerInput } from "@dual/sim";
import { useEffect, useRef, useState } from "react";
import { Arena } from "./Arena";
import type { StickValue } from "./Joystick";
import { botInput } from "./bot";

const LOCAL_ID = "p1";
const BOT_ID = "p2";
const DT_MS = DT * 1000;

export function LocalGame() {
  const stateRef = useRef<GameState>(createInitialState([LOCAL_ID, BOT_ID]));
  const [snapshot, setSnapshot] = useState<GameState>(stateRef.current);

  const moveRef = useRef({ x: 0, y: 0 });
  const aimRef = useRef(SPAWN_POINTS[0]!.aim);
  const firingRef = useRef(false);

  const onMove = (s: StickValue) => {
    moveRef.current = { x: s.x * s.magnitude, y: s.y * s.magnitude };
  };
  const onAim = (s: StickValue) => {
    firingRef.current = s.pressed;
    if (s.magnitude > 0.2) aimRef.current = Math.atan2(s.y, s.x);
  };

  useEffect(() => {
    let raf: number;
    let last: number | null = null;
    let acc = 0;
    const frame = (now: number) => {
      if (last === null) last = now;
      let delta = now - last;
      last = now;
      if (delta > 250) delta = 250;
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

  return (
    <Arena
      players={snapshot.players}
      projectiles={snapshot.projectiles}
      youId={LOCAL_ID}
      oppLabel="BOT"
      onMove={onMove}
      onAim={onAim}
    />
  );
}
