import type { Server, Socket } from "socket.io";
import type { z } from "zod";
import type { Ack, ClientToServerEvents, Role, ServerToClientEvents } from "../../shared/types.js";
import { AppError, forbidden } from "./errors.js";
import { RateLimiter } from "./rateLimit.js";
import type { Store } from "./store.js";
import { parse, schemas } from "./validation.js";

export interface SocketData {
  sessionId?: number;
  role?: Role;
  participantId?: string;
}

export type IO = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
type PollcastSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

const hostRoom = (id: number) => `s:${id}:host`;
const publicRoom = (id: number) => `s:${id}:public`;

export interface RealtimeOptions {
  /** Coalesce bursts of changes (e.g. 200 people voting at once) into one broadcast. */
  broadcastDelayMs?: number;
}

export function attachRealtime(io: IO, store: Store, opts: RealtimeOptions = {}) {
  const delay = opts.broadcastDelayMs ?? 100;
  const pending = new Map<number, NodeJS.Timeout>();
  // sessionId -> participantId -> open connections; one person with two tabs counts once.
  const audience = new Map<number, Map<string, number>>();
  const askLimiter = new RateLimiter(3, 1 / 20);
  const actionLimiter = new RateLimiter(30, 3);

  const audienceCount = (sessionId: number) => audience.get(sessionId)?.size ?? 0;

  const flush = (sessionId: number) => {
    pending.delete(sessionId);
    const count = audienceCount(sessionId);
    io.to(hostRoom(sessionId)).emit("state", store.snapshot(sessionId, { forHost: true, audienceCount: count }));
    io.to(publicRoom(sessionId)).emit("state", store.snapshot(sessionId, { forHost: false, audienceCount: count }));
  };

  const broadcast = (sessionId: number) => {
    if (pending.has(sessionId)) return;
    pending.set(sessionId, setTimeout(() => flush(sessionId), delay));
  };

  const trackAudience = (sessionId: number, participantId: string, change: 1 | -1) => {
    const people = audience.get(sessionId) ?? new Map<string, number>();
    const next = (people.get(participantId) ?? 0) + change;
    if (next > 0) people.set(participantId, next);
    else people.delete(participantId);
    if (people.size) audience.set(sessionId, people);
    else audience.delete(sessionId);
  };

  io.on("connection", (socket: PollcastSocket) => {
    const reply = <T>(ack: unknown, fn: () => T) => {
      if (typeof ack !== "function") return;
      const respond = ack as (res: Ack<T>) => void;
      try {
        respond({ ok: true, data: fn() });
      } catch (err) {
        if (err instanceof AppError) {
          respond({ ok: false, error: err.message, ...(err.details ? { details: err.details } : {}) });
        } else {
          console.error(err);
          respond({ ok: false, error: "Something went wrong on the server" });
        }
      }
    };

    const joined = () => {
      const { sessionId, role, participantId } = socket.data;
      if (!sessionId || !role) throw new AppError("Join a session first", 400);
      return { sessionId, role, participantId: participantId ?? socket.id };
    };

    const asHost = () => {
      const ctx = joined();
      if (ctx.role !== "host") throw forbidden();
      return ctx;
    };

    const asAudience = () => {
      const ctx = joined();
      if (ctx.role === "screen") throw new AppError("The presentation screen is view-only", 403);
      if (!actionLimiter.take(ctx.participantId)) throw new AppError("Slow down a little and try again", 429);
      return ctx;
    };

    const leave = () => {
      const { sessionId, role, participantId } = socket.data;
      if (!sessionId) return;
      socket.leave(hostRoom(sessionId));
      socket.leave(publicRoom(sessionId));
      if (role === "audience") {
        trackAudience(sessionId, participantId ?? socket.id, -1);
        broadcast(sessionId);
      }
      socket.data = {};
    };

    socket.on("join", (payload, ack) =>
      reply(ack, () => {
        const input = parse(schemas.join, payload);
        const session = store.findSession(input.code);
        if (input.role === "host" && !store.isHost(session, input.hostToken)) {
          throw new AppError("This link doesn't have host access to the session", 403);
        }
        leave();
        const participantId = input.participantId ?? socket.id;
        socket.data = { sessionId: session.id, role: input.role, participantId };
        socket.join(input.role === "host" ? hostRoom(session.id) : publicRoom(session.id));
        if (input.role === "audience") {
          trackAudience(session.id, participantId, 1);
          broadcast(session.id);
        }
        return {
          role: input.role,
          state: store.snapshot(session.id, { forHost: input.role === "host", audienceCount: audienceCount(session.id) }),
          me: store.participantState(session.id, participantId),
        };
      }),
    );

    // ----- host actions -----

    const hostAction = <S extends z.ZodType, T>(
      event: keyof ClientToServerEvents,
      schema: S,
      fn: (sessionId: number, input: z.output<S>) => T,
    ) => {
      socket.on(event, ((payload: unknown, ack: unknown) =>
        reply(ack, () => {
          const { sessionId } = asHost();
          const result = fn(sessionId, parse(schema, payload));
          broadcast(sessionId);
          return result;
        })) as never);
    };

    hostAction("poll:create", schemas.createPoll, (sid, p) => ({ pollId: store.createPoll(sid, p.question, p.options) }));
    hostAction("poll:open", schemas.pollRef, (sid, p) => void store.openPoll(sid, p.pollId));
    hostAction("poll:close", schemas.pollRef, (sid, p) => void store.closePoll(sid, p.pollId));
    hostAction("poll:delete", schemas.pollRef, (sid, p) => void store.deletePoll(sid, p.pollId));
    hostAction("poll:reset", schemas.pollRef, (sid, p) => void store.resetPoll(sid, p.pollId));
    hostAction("question:answer", schemas.answer, (sid, p) => void store.setAnswered(sid, p.questionId, p.answered));
    hostAction("question:hide", schemas.hide, (sid, p) => void store.setHidden(sid, p.questionId, p.hidden));

    socket.on("session:end", (ack) =>
      reply(ack, () => {
        const { sessionId } = asHost();
        store.endSession(sessionId);
        broadcast(sessionId);
      }),
    );

    // ----- audience actions -----

    socket.on("vote", (payload, ack) =>
      reply(ack, () => {
        const { sessionId, participantId } = asAudience();
        const p = parse(schemas.vote, payload);
        store.vote(sessionId, participantId, p.pollId, p.optionId);
        broadcast(sessionId);
        return store.participantState(sessionId, participantId);
      }),
    );

    socket.on("question:ask", (payload, ack) =>
      reply(ack, () => {
        const { sessionId, participantId } = asAudience();
        const p = parse(schemas.ask, payload);
        if (!askLimiter.take(participantId)) {
          throw new AppError("You're asking quickly. Wait a few seconds before the next question.", 429);
        }
        const questionId = store.askQuestion(sessionId, participantId, p.text, p.author);
        broadcast(sessionId);
        return { questionId };
      }),
    );

    socket.on("question:upvote", (payload, ack) =>
      reply(ack, () => {
        const { sessionId, participantId } = asAudience();
        const p = parse(schemas.questionRef, payload);
        store.toggleUpvote(sessionId, participantId, p.questionId);
        broadcast(sessionId);
        return store.participantState(sessionId, participantId);
      }),
    );

    socket.on("disconnect", leave);
  });

  return {
    /** Send any pending broadcasts immediately (used on shutdown and in tests). */
    flushAll: () => [...pending.keys()].forEach((id) => (clearTimeout(pending.get(id)), flush(id))),
  };
}
