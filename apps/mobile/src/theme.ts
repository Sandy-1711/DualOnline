/** Visual theme for the arena. Slot index -> colour. */
export const theme = {
  bg: "#0b0e14",
  arena: "#111722",
  arenaBorder: "#1f2a3a",
  grid: "#16202e",
  text: "#e6edf3",
  textDim: "#7d8896",
  healthBack: "#2a3340",
  /** Per-slot player colours (0 = you-ish cyan, 1 = opponent amber). */
  players: ["#39d6ff", "#ffb13b"] as const,
} as const;

export function playerColor(slot: number): string {
  return theme.players[slot % theme.players.length]!;
}
