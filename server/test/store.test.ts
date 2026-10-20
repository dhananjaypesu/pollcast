import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../src/db.js";
import { AppError } from "../src/errors.js";
import { RateLimiter } from "../src/rateLimit.js";
import { Store } from "../src/store.js";
import { parse, schemas } from "../src/validation.js";

let store: Store;
let sessionId: number;
let hostToken: string;

beforeEach(() => {
  store = new Store(openDatabase());
  const created = store.createSession("Intro to DBMS");
  hostToken = created.hostToken;
  sessionId = store.findSession(created.code).id;
});

const snap = (forHost = false) => store.snapshot(sessionId, { forHost, audienceCount: 0 });

describe("sessions", () => {
  it("creates readable 6-character codes and verifies the host token", () => {
    const { code } = store.createSession("Another");
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    const session = store.findSession(code.toLowerCase());
    expect(store.isHost(session, hostToken)).toBe(false);
    expect(store.isHost(store.getSessionById(sessionId), hostToken)).toBe(true);
    expect(store.isHost(store.getSessionById(sessionId), undefined)).toBe(false);
  });

  it("throws 404 for unknown codes", () => {
    expect(() => store.findSession("ZZZZZZ")).toThrowError(AppError);
  });

  it("ending a session closes polls and blocks new activity", () => {
    const pollId = store.createPoll(sessionId, "Q?", ["A", "B"]);
    store.openPoll(sessionId, pollId);
    store.endSession(sessionId);
    expect(snap().polls[0].status).toBe("closed");
    expect(snap().session.endedAt).not.toBeNull();
    expect(() => store.askQuestion(sessionId, "p1", "late?")).toThrow("ended");
  });
});

describe("polls and votes", () => {
  it("hides draft polls from the audience but not the host", () => {
    store.createPoll(sessionId, "Draft?", ["A", "B"]);
    expect(snap(true).polls).toHaveLength(1);
    expect(snap(false).polls).toHaveLength(0);
  });

  it("opening a poll closes the previously open one and makes it active", () => {
    const first = store.createPoll(sessionId, "First?", ["A", "B"]);
    const second = store.createPoll(sessionId, "Second?", ["A", "B"]);
    store.openPoll(sessionId, first);
    store.openPoll(sessionId, second);
    const state = snap();
    expect(state.activePollId).toBe(second);
    expect(state.polls.find((p) => p.id === first)?.status).toBe("closed");
  });

  it("counts one vote per participant and lets them change it", () => {
    const pollId = store.createPoll(sessionId, "Best language?", ["Python", "Go", "Rust"]);
    store.openPoll(sessionId, pollId);
    const [py, go] = snap().polls[0].options;
    store.vote(sessionId, "alice", pollId, py.id);
    store.vote(sessionId, "bob", pollId, py.id);
    store.vote(sessionId, "alice", pollId, go.id); // alice changes her mind
    const poll = snap().polls[0];
    expect(poll.totalVotes).toBe(2);
    expect(poll.options.map((o) => o.votes)).toEqual([1, 1, 0]);
    expect(store.participantState(sessionId, "alice").votes).toEqual({ [pollId]: go.id });
  });

  it("rejects votes on closed polls and options from other polls", () => {
    const a = store.createPoll(sessionId, "A?", ["1", "2"]);
    const b = store.createPoll(sessionId, "B?", ["3", "4"]);
    const optionOfB = snap(true).polls[1].options[0].id;
    expect(() => store.vote(sessionId, "p", a, optionOfB)).toThrow("closed");
    store.openPoll(sessionId, a);
    expect(() => store.vote(sessionId, "p", a, optionOfB)).toThrow("Option not found");
    store.closePoll(sessionId, a);
    expect(() => store.vote(sessionId, "p", a, snap().polls[0].options[0].id)).toThrow("closed");
    expect(b).toBeGreaterThan(a);
  });

  it("does not let a host touch another session's poll", () => {
    const other = store.createSession("Other");
    const otherId = store.findSession(other.code).id;
    const pollId = store.createPoll(otherId, "Theirs?", ["A", "B"]);
    expect(() => store.openPoll(sessionId, pollId)).toThrow("Poll not found");
  });

  it("reset clears votes and delete clears the active poll", () => {
    const pollId = store.createPoll(sessionId, "Q?", ["A", "B"]);
    store.openPoll(sessionId, pollId);
    store.vote(sessionId, "p", pollId, snap().polls[0].options[0].id);
    store.resetPoll(sessionId, pollId);
    expect(snap().polls[0].totalVotes).toBe(0);
    store.deletePoll(sessionId, pollId);
    expect(snap().activePollId).toBeNull();
    expect(snap(true).polls).toHaveLength(0);
  });
});

describe("questions", () => {
  it("sorts unanswered questions by upvotes, answered ones last", () => {
    const q1 = store.askQuestion(sessionId, "a", "Will this be on the exam?");
    const q2 = store.askQuestion(sessionId, "b", "Can you repeat normalization?", "Priya");
    const q3 = store.askQuestion(sessionId, "c", "Slides link?");
    store.toggleUpvote(sessionId, "x", q2);
    store.toggleUpvote(sessionId, "y", q2);
    store.toggleUpvote(sessionId, "x", q3);
    store.setAnswered(sessionId, q2, true);
    expect(snap().questions.map((q) => q.id)).toEqual([q3, q1, q2]);
    expect(snap().questions[2]).toMatchObject({ author: "Priya", upvotes: 2, answered: true });
  });

  it("upvotes toggle per participant", () => {
    const q = store.askQuestion(sessionId, "a", "Why?");
    store.toggleUpvote(sessionId, "x", q);
    expect(store.participantState(sessionId, "x").upvoted).toEqual([q]);
    store.toggleUpvote(sessionId, "x", q);
    expect(snap().questions[0].upvotes).toBe(0);
  });

  it("hidden questions are visible only to the host and cannot be upvoted", () => {
    const q = store.askQuestion(sessionId, "a", "spam");
    store.setHidden(sessionId, q, true);
    expect(snap(false).questions).toHaveLength(0);
    expect(snap(true).questions[0].hidden).toBe(true);
    expect(() => store.toggleUpvote(sessionId, "x", q)).toThrow("not found");
  });
});

describe("validation", () => {
  it("normalizes whitespace and enforces poll rules", () => {
    const ok = parse(schemas.createPoll, { question: "  Which   topic next? ", options: ["Joins", " Indexes "] });
    expect(ok).toEqual({ question: "Which topic next?", options: ["Joins", "Indexes"] });

    expect(() => parse(schemas.createPoll, { question: "Q", options: ["Only one"] })).toThrow("between 2 and 6");
    expect(() => parse(schemas.createPoll, { question: "Q", options: ["Yes", "yes"] })).toThrow("different");
    expect(() => parse(schemas.createPoll, { question: "   ", options: ["A", "B"] })).toThrow("Question is required");
  });

  it("reports field-level details", () => {
    try {
      parse(schemas.join, { code: "abc", role: "admin" });
      expect.unreachable();
    } catch (err) {
      expect((err as AppError).status).toBe(422);
      expect(Object.keys((err as AppError).details ?? {})).toEqual(["code", "role"]);
    }
  });
});

describe("rate limiter", () => {
  it("allows a burst then refills over time", () => {
    let t = 0;
    const limiter = new RateLimiter(2, 1, () => t);
    expect([limiter.take("k"), limiter.take("k"), limiter.take("k")]).toEqual([true, true, false]);
    t = 1000;
    expect(limiter.take("k")).toBe(true);
    expect(limiter.take("other")).toBe(true);
  });
});
