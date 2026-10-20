import type { AddressInfo } from "node:net";
import { io as connect, type Socket } from "socket.io-client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  Ack,
  ClientToServerEvents,
  JoinResult,
  ServerToClientEvents,
  SessionState,
} from "../../shared/types.js";
import { createApp } from "../src/app.js";

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;

let server: ReturnType<typeof createApp>;
let baseUrl: string;
const clients: Client[] = [];

beforeEach(async () => {
  server = createApp({ broadcastDelayMs: 0, createLimitPerHour: 5 });
  await new Promise<void>((resolve) => server.httpServer.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.httpServer.address() as AddressInfo).port}`;
});

afterEach(async () => {
  clients.splice(0).forEach((c) => c.disconnect());
  await server.close();
  await new Promise((resolve) => server.httpServer.close(resolve));
});

async function client(): Promise<Client> {
  const socket: Client = connect(baseUrl, { transports: ["websocket"], forceNew: true });
  clients.push(socket);
  await new Promise((resolve) => socket.once("connect", resolve));
  return socket;
}

// Typed helper around emitWithAck so tests read like the client code.
async function call<T>(socket: Client, event: string, ...args: unknown[]): Promise<Ack<T>> {
  return (socket.emitWithAck as (e: string, ...a: unknown[]) => Promise<Ack<T>>)(event, ...args);
}

async function ok<T>(socket: Client, event: string, ...args: unknown[]): Promise<T> {
  const res = await call<T>(socket, event, ...args);
  if (!res.ok) throw new Error(`${event} failed: ${res.error}`);
  return res.data;
}

const nextState = (socket: Client, until: (s: SessionState) => boolean = () => true) =>
  new Promise<SessionState>((resolve) => {
    const handler = (s: SessionState) => {
      if (until(s)) {
        socket.off("state", handler);
        resolve(s);
      }
    };
    socket.on("state", handler);
  });

async function createSession(title = "Lecture 7") {
  const res = await fetch(`${baseUrl}/api/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  return { status: res.status, body: await res.json() };
}

describe("HTTP API", () => {
  it("creates and looks up sessions", async () => {
    const { status, body } = await createSession();
    expect(status).toBe(201);
    expect(body.code).toMatch(/^[A-Z0-9]{6}$/);
    expect(body.hostToken.length).toBeGreaterThan(20);

    const lookup = await fetch(`${baseUrl}/api/sessions/${body.code.toLowerCase()}`);
    expect(await lookup.json()).toMatchObject({ code: body.code, title: "Lecture 7", endedAt: null });
    expect((await fetch(`${baseUrl}/api/sessions/NOPE99`)).status).toBe(404);
  });

  it("validates input and rate-limits session creation", async () => {
    expect((await createSession("   ")).status).toBe(422);
    const bad = await fetch(`${baseUrl}/api/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{oops",
    });
    expect(bad.status).toBe(400);
    for (let i = 0; i < 4; i++) await createSession();
    expect((await createSession()).status).toBe(429);
  });
});

describe("live session over Socket.IO", () => {
  async function setup() {
    const { body } = await createSession();
    const host = await client();
    const joined = await ok<JoinResult>(host, "join", { code: body.code, role: "host", hostToken: body.hostToken });
    return { code: body.code as string, hostToken: body.hostToken as string, host, joined };
  }

  it("rejects host access without the right token", async () => {
    const { code } = await setup();
    const intruder = await client();
    const res = await call(intruder, "join", { code, role: "host", hostToken: "guess" });
    expect(res).toMatchObject({ ok: false, error: expect.stringContaining("host access") });
    const res2 = await call(intruder, "poll:create", { question: "Hijack?", options: ["A", "B"] });
    expect(res2.ok).toBe(false);
  });

  it("runs a full poll: create, open, vote, live results, close", async () => {
    const { code, host } = await setup();
    const alice = await client();
    const bob = await client();
    await ok(alice, "join", { code, role: "audience", participantId: "alice-1234" });
    await ok(bob, "join", { code, role: "audience", participantId: "bob-123456" });

    const { pollId } = await ok<{ pollId: number }>(host, "poll:create", {
      question: "Which topic should we revise?",
      options: ["Joins", "Normalization", "Transactions"],
    });

    // Draft polls are not broadcast to the audience; opening one is.
    const seenByAlice = nextState(alice, (s) => s.activePollId === pollId);
    await ok(host, "poll:open", { pollId });
    const live = await seenByAlice;
    const [joins, normalization] = live.polls[0].options;

    const hostSees = nextState(host, (s) => s.polls[0]?.totalVotes === 2);
    const me = await ok<{ votes: Record<number, number> }>(alice, "vote", { pollId, optionId: normalization.id });
    expect(me.votes[pollId]).toBe(normalization.id);
    await ok(bob, "vote", { pollId, optionId: joins.id });
    const results = await hostSees;
    expect(results.polls[0].options.map((o) => o.votes)).toEqual([1, 1, 0]);
    expect(results.audienceCount).toBe(2);

    await ok(host, "poll:close", { pollId });
    const late = await call(bob, "vote", { pollId, optionId: normalization.id });
    expect(late).toMatchObject({ ok: false, error: "Voting is closed for this poll" });
  });

  it("restores a returning participant's vote on rejoin", async () => {
    const { code, host } = await setup();
    const { pollId } = await ok<{ pollId: number }>(host, "poll:create", { question: "Q?", options: ["A", "B"] });
    await ok(host, "poll:open", { pollId });

    const first = await client();
    const joined = await ok<JoinResult>(first, "join", { code, role: "audience", participantId: "returning-1" });
    const optionId = joined.state.polls[0].options[1].id;
    await ok(first, "vote", { pollId, optionId });
    first.disconnect();

    const again = await client();
    const rejoined = await ok<JoinResult>(again, "join", { code, role: "audience", participantId: "returning-1" });
    expect(rejoined.me.votes[pollId]).toBe(optionId);
  });

  it("handles Q&A: ask, upvote, moderate", async () => {
    const { code, host } = await setup();
    const student = await client();
    await ok(student, "join", { code, role: "audience", participantId: "student-01" });

    const { questionId } = await ok<{ questionId: number }>(student, "question:ask", {
      text: "Is BCNF stricter than 3NF?",
      author: "Rahul",
    });
    const me = await ok<{ upvoted: number[] }>(student, "question:upvote", { questionId });
    expect(me.upvoted).toEqual([questionId]);

    const hidden = nextState(student, (s) => s.questions.length === 0);
    await ok(host, "question:hide", { questionId, hidden: true });
    await hidden;

    const forbidden = await call(student, "question:answer", { questionId, answered: true });
    expect(forbidden).toMatchObject({ ok: false, error: "Only the host can do that" });
  });

  it("limits how fast one participant can ask questions", async () => {
    const { code } = await setup();
    const student = await client();
    await ok(student, "join", { code, role: "audience", participantId: "fast-asker" });
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await call(student, "question:ask", { text: `Question ${i}` }));
    expect(results.map((r) => r.ok)).toEqual([true, true, true, false]);
  });

  it("keeps the presentation screen read-only and out of the audience count", async () => {
    const { code, host } = await setup();
    const screen = await client();
    const joined = await ok<JoinResult>(screen, "join", { code, role: "screen" });
    expect(joined.state.audienceCount).toBe(0);
    const res = await call(screen, "question:ask", { text: "From the projector?" });
    expect(res).toMatchObject({ ok: false });

    const audienceSeen = nextState(host, (s) => s.audienceCount === 1);
    const a = await client();
    await ok(a, "join", { code, role: "audience", participantId: "counted-01" });
    await audienceSeen;
  });

  it("returns validation details in acknowledgements", async () => {
    const { host } = await setup();
    const res = await call(host, "poll:create", { question: "", options: ["A"] });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(Object.keys(res.details ?? {})).toEqual(expect.arrayContaining(["question", "options"]));
  });
});
