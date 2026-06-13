/**
 * Online mode: connects to the authoritative game-server and renders the
 * predicted-self + interpolated-opponent frame produced by `useOnlineGame`.
 */
import { useOnlineGame } from "../net/useOnlineGame";
import { Arena } from "./Arena";

interface Props {
  serverUrl: string;
  roomId: string;
}

function banner(status: string, hasOpponent: boolean): string | null {
  if (status === "connecting") return "Connecting…";
  if (status === "closed") return "Disconnected — check the server URL";
  if (status === "error") return "Connection error — is the server running?";
  if (status === "open" && !hasOpponent) return "Waiting for an opponent to join…";
  return null;
}

export function OnlineGame({ serverUrl, roomId }: Props) {
  const { status, youId, frame, onMove, onAim } = useOnlineGame(serverUrl, roomId);
  const hasOpponent = frame.players.some((p) => p.id !== youId);

  return (
    <Arena
      players={frame.players}
      projectiles={frame.projectiles}
      youId={frame.youId}
      oppLabel="OPP"
      banner={banner(status, hasOpponent)}
      onMove={onMove}
      onAim={onAim}
    />
  );
}
