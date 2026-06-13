/** Minimal 2D vector helpers. Pure functions, no allocation surprises. */

export interface Vec2 {
  x: number;
  y: number;
}

export function length(x: number, y: number): number {
  return Math.sqrt(x * x + y * y);
}

/**
 * Normalize (x, y) to unit length. Returns (0, 0) for the zero vector so a
 * neutral stick reads as "no movement" rather than NaN.
 */
export function normalize(x: number, y: number): Vec2 {
  const len = length(x, y);
  if (len === 0) return { x: 0, y: 0 };
  return { x: x / len, y: y / len };
}

/** Clamp a value into [min, max]. */
export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/** Squared distance — cheaper than distance, fine for circle overlap checks. */
export function distanceSq(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}
