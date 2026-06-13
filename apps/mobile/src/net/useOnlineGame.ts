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
import { neutralInput, step, TICK_RATE, type GameState, type InputMap, type PlayerInput } from "@dual/sim";
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
  // The current predicted state. Maintained INCREMENTALLY: stepped one tick per
  // input we send, and re-based on the authoritative snapshot when one arrives.
  // This keeps the per-frame render path cheap (no full replay every frame).
  const predictedRef = useRef<GameState | null>(null);

  const stepPredictionForOwnInput = (input: PlayerInput) => {
    const id = youIdRef.current;
    const pred = predictedRef.current;
    if (!id || !pred) return;
    const inputs: InputMap = { [id]: input };
    for (const p of pred.players) if (p.id !== id) inputs[p.id] = neutralInput();
    predictedRef.current = step(pred, inputs);
  };

  // 1) Connection lifecycle.
  useEffect(() => {
    const conn = new RoomConnection(serverUrl, roomId, {
      onStatus: setStatus,
      onWelcome: (id) => {
        youIdRef.current = id;
        setYouId(id);
      },
      onSnapshot: (snapshot, ackTick) => {
        const auth = snapshotToState(snapshot);
        authRef.current = auth;
        if (ackTick != null) {
          ackRef.current = ackTick;
          pendingRef.current = pruneAcked(pendingRef.current, ackTick);
        }
        bufferRef.current.push(snapshot);
        // Reconcile: re-base prediction on the authoritative truth, replaying the
        // still-unacknowledged inputs. The expensive full replay happens here, at
        // the ~20Hz snapshot rate — not on every render frame.
        if (youIdRef.current) {
          predictedRef.current = predict(auth, youIdRef.current, pendingRef.current, ackRef.current);
        }
      },
    });
    conn.connect();
    connRef.current = conn;
    return () => conn.close();
  }, [serverUrl, roomId]);

  // 2) Send our input at a fixed rate, tagged with a client tick for reconciliation,
  //    and advance the prediction by exactly one tick (cheap, incremental).
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
      stepPredictionForOwnInput(input);
    }, SEND_MS);
    return () => clearInterval(id);
  }, []);

  // 3) Each frame, compose predicted-self + interpolated-others. No prediction
  //    work here anymore — just read the maintained predicted state and sample
  //    the interpolation buffer.
  useEffect(() => {
    let raf: number;
    const tick = () => {
      const id = youIdRef.current;
      const predicted = predictedRef.current;
      if (id && predicted) {
        const interp =
          bufferRef.current.sample() ?? {
            players: predicted.players,
            projectiles: predicted.projectiles,
          };

        const players: Player[] = predicted.players.map((p) => {
          if (p.id === id) return p as Player; // predicted self
          return (interp.players.find((x) => x.id === p.id) ?? p) as Player;
        });

        const projectiles: Projectile[] = [
          ...(predicted.projectiles.filter((pr) => pr.ownerId === id) as Projectile[]),
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
