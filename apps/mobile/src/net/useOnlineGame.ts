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
  extrapolateProjectiles,
  predict,
  pruneAcked,
  SnapshotBuffer,
  snapshotToState,
  type PendingInput,
} from "@dual/netcode";
import { neutralInput, step, TICK_RATE, type GameState, type InputMap, type PlayerInput } from "@dual/sim";
import type { Player, Projectile, Snapshot } from "@dual/protocol";
import { useEffect, useRef, useState } from "react";
import type { StickValue } from "../game/Joystick";
import { RoomConnection, type RoomStatus } from "./RoomConnection";

export interface RenderFrame {
  players: Player[];
  projectiles: Projectile[];
  youId: string | null;
}

const SEND_MS = 1000 / TICK_RATE;
// At a ~20Hz snapshot rate (50ms apart) we want ~3 snapshots of buffer so jitter
// and the occasional lost packet don't underrun interpolation (which causes the
// opponent to freeze then teleport). Smoothness is bought with a little latency.
const INTERP_DELAY_MS = 150;
// Safety cap: if the server stops acking (dropped connection), don't let the
// replay buffer grow without bound.
const MAX_PENDING = 180;
// Adaptive interpolation: under jitter we grow the buffer up to this ceiling.
const MAX_INTERP_DELAY_MS = 350;
// Smooth error correction: when reconciliation moves our own player, ease the
// visual to the corrected spot over a few frames instead of snapping.
const ERR_DECAY_PER_FRAME = 0.85;
const ERR_SNAP_THRESHOLD = 220; // beyond this (respawn/teleport) just snap, don't slide

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
  // Newest authoritative snapshot + when it arrived — used to dead-reckon the
  // opponent's projectiles to the present (they move in straight lines).
  const latestSnapRef = useRef<Snapshot | null>(null);
  const latestAtRef = useRef(0);
  // The current predicted state. Maintained INCREMENTALLY: stepped one tick per
  // input we send, and re-based on the authoritative snapshot when one arrives.
  // This keeps the per-frame render path cheap (no full replay every frame).
  const predictedRef = useRef<GameState | null>(null);
  // Adaptive interpolation delay + a decaying max of recent snapshot gaps.
  const adaptiveDelayRef = useRef(INTERP_DELAY_MS);
  const maxGapRef = useRef(0);
  // Residual visual offset for our own player, blended out over frames so
  // reconciliation corrections don't snap.
  const renderErrRef = useRef({ x: 0, y: 0 });

  const ownPos = (s: GameState | null, id: string | null) => {
    const p = s?.players.find((pl) => pl.id === id);
    return p ? { x: p.x, y: p.y } : null;
  };

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
        const now = Date.now();
        // Adaptive interpolation delay: track a decaying max of snapshot gaps and
        // widen the buffer when jitter spikes (helps a peer on a flaky network).
        if (latestAtRef.current > 0) {
          const gap = now - latestAtRef.current;
          maxGapRef.current = Math.max(gap, maxGapRef.current * 0.9);
          adaptiveDelayRef.current = Math.min(
            MAX_INTERP_DELAY_MS,
            Math.max(INTERP_DELAY_MS, maxGapRef.current * 1.5 + 40),
          );
        }

        const auth = snapshotToState(snapshot);
        authRef.current = auth;
        if (ackTick != null) {
          ackRef.current = ackTick;
          pendingRef.current = pruneAcked(pendingRef.current, ackTick);
        }
        bufferRef.current.push(snapshot, now);
        latestSnapRef.current = snapshot;
        latestAtRef.current = now;

        // Reconcile: re-base prediction on authoritative truth, replaying the
        // still-unacknowledged inputs. (Expensive full replay only here, ~20Hz.)
        const id = youIdRef.current;
        if (id) {
          const before = ownPos(predictedRef.current, id);
          predictedRef.current = predict(auth, id, pendingRef.current, ackRef.current);
          const after = ownPos(predictedRef.current, id);
          // Smooth error correction: absorb the jump into a residual offset that
          // the render loop blends out — unless it's huge (respawn), then snap.
          if (before && after) {
            const dx = before.x - after.x;
            const dy = before.y - after.y;
            if (Math.hypot(dx, dy) > ERR_SNAP_THRESHOLD) {
              renderErrRef.current = { x: 0, y: 0 };
            } else {
              renderErrRef.current = {
                x: renderErrRef.current.x + dx,
                y: renderErrRef.current.y + dy,
              };
            }
          }
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
          bufferRef.current.sample(Date.now(), adaptiveDelayRef.current) ?? {
            players: predicted.players,
            projectiles: predicted.projectiles,
          };

        const err = renderErrRef.current;
        const players: Player[] = predicted.players.map((p) => {
          if (p.id === id) {
            // predicted self + the residual correction offset being blended out
            return { ...p, x: p.x + err.x, y: p.y + err.y } as Player;
          }
          return (interp.players.find((x) => x.id === p.id) ?? p) as Player;
        });
        // Decay the correction toward zero each frame.
        err.x *= ERR_DECAY_PER_FRAME;
        err.y *= ERR_DECAY_PER_FRAME;
        if (Math.abs(err.x) < 0.05) err.x = 0;
        if (Math.abs(err.y) < 0.05) err.y = 0;

        // Opponent bullets: dead-reckoned from the latest snapshot by velocity so
        // fast shots stay visible and smooth instead of flickering between sparse
        // snapshots. Our own bullets stay predicted (instant).
        const latest = latestSnapRef.current;
        const oppProjectiles = latest
          ? extrapolateProjectiles(
              latest.projectiles.filter((pr) => pr.ownerId !== id),
              (Date.now() - latestAtRef.current) / 1000,
            )
          : [];
        const projectiles: Projectile[] = [
          ...(predicted.projectiles.filter((pr) => pr.ownerId === id) as Projectile[]),
          ...oppProjectiles,
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
