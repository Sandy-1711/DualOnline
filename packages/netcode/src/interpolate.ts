/**
 * Entity interpolation for *remote* entities (the opponent and their shots).
 *
 * Snapshots arrive at discrete ticks. If we drew each one the instant it landed,
 * remote players would teleport between positions. Instead we render them
 * slightly in the past (a small `delayMs`) and blend between the two snapshots
 * that straddle that render time, so motion is smooth. Standard technique from
 * Valve / Gambetta multiplayer.
 */
import type { Player, Projectile, Snapshot } from "@dual/protocol";

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Interpolate an angle along the shortest arc (so it never spins the long way). */
function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return a + d * t;
}

export function interpolatePlayers(prev: Snapshot, next: Snapshot, t: number): Player[] {
  return next.players.map((np) => {
    const pp = prev.players.find((p) => p.id === np.id);
    if (!pp) return np; // newly seen player — no prior to blend from
    return {
      ...np,
      x: lerp(pp.x, np.x, t),
      y: lerp(pp.y, np.y, t),
      aim: lerpAngle(pp.aim, np.aim, t),
    };
  });
}

export function interpolateProjectiles(prev: Snapshot, next: Snapshot, t: number): Projectile[] {
  return next.projectiles.map((np) => {
    const pp = prev.projectiles.find((p) => p.id === np.id);
    if (!pp) return np; // just spawned — render at its first known position
    return { ...np, x: lerp(pp.x, np.x, t), y: lerp(pp.y, np.y, t) };
  });
}

interface Stamped {
  at: number;
  snap: Snapshot;
}

/**
 * Buffers incoming snapshots and produces a smoothly interpolated snapshot for a
 * render time `delayMs` in the past. Keeps remote motion fluid even when packets
 * arrive irregularly.
 */
export class SnapshotBuffer {
  private buf: Stamped[] = [];

  constructor(
    private readonly delayMs = 100,
    private readonly maxAgeMs = 1000,
  ) {}

  push(snap: Snapshot, at: number = Date.now()): void {
    this.buf.push({ at, snap });
    // Drop anything older than we'd ever need.
    const cutoff = at - this.maxAgeMs;
    while (this.buf.length > 2 && this.buf[0]!.at < cutoff) this.buf.shift();
  }

  get latest(): Snapshot | null {
    return this.buf.length ? this.buf[this.buf.length - 1]!.snap : null;
  }

  /**
   * Sample the buffer at `now - delayMs`. Returns interpolated player and
   * projectile arrays, or null if we have nothing yet.
   */
  sample(now: number = Date.now()): { players: Player[]; projectiles: Projectile[] } | null {
    if (this.buf.length === 0) return null;
    if (this.buf.length === 1) {
      const only = this.buf[0]!.snap;
      return { players: only.players, projectiles: only.projectiles };
    }

    const target = now - this.delayMs;

    // Find the pair (a, b) with a.at <= target <= b.at.
    let a = this.buf[0]!;
    let b = this.buf[this.buf.length - 1]!;
    for (let i = 0; i < this.buf.length - 1; i++) {
      if (this.buf[i]!.at <= target && this.buf[i + 1]!.at >= target) {
        a = this.buf[i]!;
        b = this.buf[i + 1]!;
        break;
      }
    }

    const span = b.at - a.at;
    const t = span > 0 ? Math.max(0, Math.min(1, (target - a.at) / span)) : 0;
    return {
      players: interpolatePlayers(a.snap, b.snap, t),
      projectiles: interpolateProjectiles(a.snap, b.snap, t),
    };
  }
}
