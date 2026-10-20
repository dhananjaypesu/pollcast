import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type {
  Ack,
  ClientToServerEvents,
  JoinResult,
  ParticipantState,
  Role,
  ServerToClientEvents,
  SessionState,
} from "../../../shared/types";
import { hostToken, participantId } from "./storage";

type PollcastSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export type ConnectionStatus = "connecting" | "live" | "reconnecting" | "error";

export interface SessionHandle {
  status: ConnectionStatus;
  error: string | null;
  state: SessionState | null;
  me: ParticipantState;
  /** Emit an event and resolve with the server's acknowledgement. */
  send: <T = undefined>(event: keyof ClientToServerEvents, payload?: unknown) => Promise<Ack<T>>;
  setMe: (me: ParticipantState) => void;
}

const EMPTY_ME: ParticipantState = { votes: {}, upvoted: [] };

/**
 * Connects to a live session and keeps its state in sync. Re-joins automatically
 * after a dropped connection, so phones that sleep come back with fresh results.
 */
export function useSession(code: string, role: Role): SessionHandle {
  const socketRef = useRef<PollcastSocket | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<SessionState | null>(null);
  const [me, setMe] = useState<ParticipantState>(EMPTY_ME);

  useEffect(() => {
    const socket: PollcastSocket = io({ transports: ["websocket", "polling"] });
    socketRef.current = socket;

    const join = async () => {
      const res = (await socket.emitWithAck("join", {
        code,
        role,
        participantId: participantId(),
        hostToken: role === "host" ? (hostToken.get(code) ?? undefined) : undefined,
      })) as Ack<JoinResult>;
      if (res.ok) {
        setState(res.data.state);
        setMe(res.data.me);
        setError(null);
        setStatus("live");
      } else {
        setError(res.error);
        setStatus("error");
      }
    };

    socket.on("connect", join);
    socket.on("disconnect", () => setStatus((s) => (s === "error" ? s : "reconnecting")));
    socket.on("state", setState);
    return () => {
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, [code, role]);

  const send = useCallback(async <T,>(event: keyof ClientToServerEvents, payload?: unknown): Promise<Ack<T>> => {
    const socket = socketRef.current;
    if (!socket?.connected) return { ok: false, error: "You're offline. Reconnecting…" };
    try {
      const timed = socket.timeout(8000);
      // Keep the method bound to its socket; a detached emitWithAck loses `this` and throws.
      const emit = timed.emitWithAck.bind(timed) as (e: string, ...a: unknown[]) => Promise<Ack<T>>;
      return payload === undefined ? await emit(event) : await emit(event, payload);
    } catch {
      return { ok: false, error: "The server didn't respond. Try again." };
    }
  }, []);

  return { status, error, state, me, send, setMe };
}
