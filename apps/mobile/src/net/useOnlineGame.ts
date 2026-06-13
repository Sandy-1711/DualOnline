/**
 * Drives an online match: opens the room connection, sends our input at a fixed
 * rate, and each animation frame produces a *render frame* that combines
 *
 *   - our own player + our own projectiles via client-side PREDICTION
 *     (instant, then reconciled against the server's acks), and
 *   - the opponent + their projectiles via entity INTERPOLATION
 *     (smooth, rendered slightly in the past).
 *
 * The heavy lifting lives in the pure `@dual/netcode` package; this hook is the
 * React/timing glue.
 */
import {
  predict,
  pruneAcked,
  SnapshotBuffer,
  snapshotToState,
  type PendingInput,
} from "@dual/netcode";
import { TICK_RATE, type GameState, type PlayerInput } from "@dual/sim";
import type { Player, Projectile } from "@dual/protocol";
import { useEffect, useRef, useState } from "react";
import type { StickValue } from "../game/Joystick";
import { RoomConnection, type RoomStatus } from "./RoomConnection";

export interface RenderFrame {
  players: Player[];
  projectiles: Projectile[];
  youId: string | null;
}

const SEND_MS = 1000 / TICK_RATE;
// At a ~20Hz snapshot rate (50ms apart) we want a little more than two
// snapshots of buffer so interpolation never runs past the newest one and stalls.
const INTERP_DELAY_MS = 120;
// Safety cap: if the server stops acking (dropped connection), don't let the
// replay buffer grow without bound.
const MAX_PENDING = 180;

export function useOnlineGame(serverUrl: string, roomId: string) {
  const [status, setStatus] = useState<RoomStatus>("connecting");
  const [youId, setYouId] = useState<string | null>(null);
  const [frame, setFrame] = useState<RenderFrame>({ players: [], projectiles: [], youId: null });

  // Inputs — written by the joysticks, read by the send loop (refs avoid re-renders).
  const moveRef = useRef({ x: 0, y: 0 });
  const aimRef = useRef(0);
  const firingRef = useRef(false);

  // Net + prediction state.
  const connRef = useRef<RoomConnection | null>(null);
  const youIdRef = useRef<string | null>(null);
  const authRef = useRef<GameState | null>(null);
  const ackRef = useRef(0);
  const pendingRef = useRef<PendingInput[]>([]);
  const bufferRef = useRef(new SnapshotBuffer(INTERP_DELAY_MS));
  const clientTickRef = useRef(0);

  // 1) Connection lifecycle.
  useEffect(() => {
    const conn = new RoomConnection(serverUrl, roomId, {
      onStatus: setStatus,
      onWelcome: (id) => {
        youIdRef.current = id;
        setYouId(id);
      },
      onSnapshot: (snapshot, ackTick) => {
        authRef.current = snapshotToState(snapshot);
        if (ackTick != null) {
          ackRef.current = ackTick;
          pendingRef.current = pruneAcked(pendingRef.current, ackTick);
        }
        bufferRef.current.push(snapshot);
      },
    });
    conn.connect();
    connRef.current = conn;
    return () => conn.close();
  }, [serverUrl, roomId]);

  // 2) Send our input at a fixed rate, tagged with a client tick for reconciliation.
  useEffect(() => {
    const id = setInterval(() => {
      if (!youIdRef.current) return;
      const tick = ++clientTickRef.current;
      const input: PlayerInput = {
        moveX: moveRef.current.x,
        moveY: moveRef.current.y,
        aim: aimRef.current,
        firing: firingRef.current,
      };
      pendingRef.current.push({ tick, input });
      if (pendingRef.current.length > MAX_PENDING) {
        pendingRef.current.splice(0, pendingRef.current.length - MAX_PENDING);
      }
      connRef.current?.sendInput(tick, input);
    }, SEND_MS);
    return () => clearInterval(id);
  }, []);

  // 3) Each frame, compose predicted-self + interpolated-others into a render frame.
  useEffect(() => {
    let raf: number;
    const tick = () => {
      const id = youIdRef.current;
      const auth = authRef.current;
      if (id && auth) {
        const predicted = predict(auth, id, pendingRef.current, ackRef.current);
        const interp =
          bufferRef.current.sample() ?? { players: auth.players, projectiles: auth.projectiles };

        const players: Player[] = auth.players.map((p) => {
          if (p.id === id) {
            return (predicted.players.find((x) => x.id === id) ?? p) as Player;
          }
          return (interp.players.find((x) => x.id === p.id) ?? p) as Player;
        });

        const projectiles: Projectile[] = [
          // our shots: predicted, so they appear the instant we fire
          ...(predicted.projectiles.filter((pr) => pr.ownerId === id) as Projectile[]),
          // their shots: interpolated, so they glide
          ...interp.projectiles.filter((pr) => pr.ownerId !== id),
        ];

        setFrame({ players, projectiles, youId: id });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const onMove = (s: StickValue) => {
    moveRef.current = { x: s.x * s.magnitude, y: s.y * s.magnitude };
  };
  const onAim = (s: StickValue) => {
    firingRef.current = s.pressed;
    if (s.magnitude > 0.2) aimRef.current = Math.atan2(s.y, s.x);
  };

  return { status, youId, frame, onMove, onAim };
}
