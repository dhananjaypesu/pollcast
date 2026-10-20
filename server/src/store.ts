import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import type { ParticipantState, Poll, PollStatus, Question, SessionState } from "../../shared/types.js";
import type { DB } from "./db.js";
import { AppError, notFound } from "./errors.js";

// No 0/O or 1/I/L, so codes survive being read off a projector.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export interface SessionRow {
  id: number;
  code: string;
  title: string;
  host_token_hash: string;
  active_poll_id: number | null;
  created_at: string;
  ended_at: string | null;
}

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export class Store {
  constructor(private db: DB) {}

  // ---------- sessions ----------

  createSession(title: string): { code: string; hostToken: string } {
    const hostToken = randomBytes(24).toString("base64url");
    for (let attempt = 0; attempt < 10; attempt++) {
      const code = Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
      const exists = this.db.prepare("SELECT 1 FROM sessions WHERE code = ?").get(code);
      if (exists) continue;
      this.db
        .prepare("INSERT INTO sessions (code, title, host_token_hash) VALUES (?, ?, ?)")
        .run(code, title, hashToken(hostToken));
      return { code, hostToken };
    }
    throw new AppError("Could not allocate a session code, try again", 503);
  }

  findSession(code: string): SessionRow {
    const row = this.db.prepare("SELECT * FROM sessions WHERE code = ?").get(code.toUpperCase()) as
      | SessionRow
      | undefined;
    if (!row) throw notFound("Session");
    return row;
  }

  getSessionById(id: number): SessionRow {
    return this.db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as SessionRow;
  }

  isHost(session: SessionRow, token: string | undefined): boolean {
    if (!token) return false;
    const a = Buffer.from(hashToken(token), "hex");
    const b = Buffer.from(session.host_token_hash, "hex");
    return a.length === b.length && timingSafeEqual(a, b);
  }

  endSession(sessionId: number) {
    this.db.transaction(() => {
      this.db.prepare("UPDATE polls SET status = 'closed' WHERE session_id = ? AND status = 'open'").run(sessionId);
      this.db
        .prepare("UPDATE sessions SET ended_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND ended_at IS NULL")
        .run(sessionId);
    })();
  }

  private assertLive(sessionId: number) {
    if (this.getSessionById(sessionId).ended_at) throw new AppError("This session has ended", 409);
  }

  // ---------- polls ----------

  createPoll(sessionId: number, question: string, options: string[]): number {
    this.assertLive(sessionId);
    return this.db.transaction(() => {
      const { lastInsertRowid } = this.db
        .prepare("INSERT INTO polls (session_id, question) VALUES (?, ?)")
        .run(sessionId, question);
      const insert = this.db.prepare("INSERT INTO poll_options (poll_id, label, position) VALUES (?, ?, ?)");
      options.forEach((label, i) => insert.run(lastInsertRowid, label, i));
      return Number(lastInsertRowid);
    })();
  }

  private pollStatus(sessionId: number, pollId: number): PollStatus {
    const row = this.db.prepare("SELECT status FROM polls WHERE id = ? AND session_id = ?").get(pollId, sessionId) as
      | { status: PollStatus }
      | undefined;
    if (!row) throw notFound("Poll");
    return row.status;
  }

  /** Opening a poll makes it the one on screen and closes any other open poll. */
  openPoll(sessionId: number, pollId: number) {
    this.assertLive(sessionId);
    this.pollStatus(sessionId, pollId);
    this.db.transaction(() => {
      this.db
        .prepare("UPDATE polls SET status = 'closed' WHERE session_id = ? AND status = 'open' AND id != ?")
        .run(sessionId, pollId);
      this.db.prepare("UPDATE polls SET status = 'open' WHERE id = ?").run(pollId);
      this.db.prepare("UPDATE sessions SET active_poll_id = ? WHERE id = ?").run(pollId, sessionId);
    })();
  }

  closePoll(sessionId: number, pollId: number) {
    if (this.pollStatus(sessionId, pollId) !== "open") throw new AppError("That poll is not open", 409);
    this.db.prepare("UPDATE polls SET status = 'closed' WHERE id = ?").run(pollId);
  }

  deletePoll(sessionId: number, pollId: number) {
    this.pollStatus(sessionId, pollId);
    this.db.transaction(() => {
      this.db.prepare("UPDATE sessions SET active_poll_id = NULL WHERE id = ? AND active_poll_id = ?").run(sessionId, pollId);
      this.db.prepare("DELETE FROM polls WHERE id = ?").run(pollId);
    })();
  }

  resetPoll(sessionId: number, pollId: number) {
    this.pollStatus(sessionId, pollId);
    this.db.prepare("DELETE FROM votes WHERE poll_id = ?").run(pollId);
  }

  vote(sessionId: number, participantId: string, pollId: number, optionId: number) {
    this.assertLive(sessionId);
    if (this.pollStatus(sessionId, pollId) !== "open") throw new AppError("Voting is closed for this poll", 409);
    const option = this.db.prepare("SELECT 1 FROM poll_options WHERE id = ? AND poll_id = ?").get(optionId, pollId);
    if (!option) throw notFound("Option");
    this.db
      .prepare(
        `INSERT INTO votes (poll_id, participant_id, option_id) VALUES (?, ?, ?)
         ON CONFLICT (poll_id, participant_id)
         DO UPDATE SET option_id = excluded.option_id, voted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
      )
      .run(pollId, participantId, optionId);
  }

  // ---------- questions ----------

  askQuestion(sessionId: number, participantId: string, text: string, author?: string): number {
    this.assertLive(sessionId);
    const { lastInsertRowid } = this.db
      .prepare("INSERT INTO questions (session_id, participant_id, text, author) VALUES (?, ?, ?, ?)")
      .run(sessionId, participantId, text, author || null);
    return Number(lastInsertRowid);
  }

  private assertQuestion(sessionId: number, questionId: number) {
    const row = this.db.prepare("SELECT hidden FROM questions WHERE id = ? AND session_id = ?").get(questionId, sessionId) as
      | { hidden: number }
      | undefined;
    if (!row) throw notFound("Question");
    return row;
  }

  /** Toggles: upvoting a question you already upvoted removes your upvote. */
  toggleUpvote(sessionId: number, participantId: string, questionId: number) {
    this.assertLive(sessionId);
    if (this.assertQuestion(sessionId, questionId).hidden) throw notFound("Question");
    const removed = this.db
      .prepare("DELETE FROM question_upvotes WHERE question_id = ? AND participant_id = ?")
      .run(questionId, participantId);
    if (removed.changes === 0) {
      this.db.prepare("INSERT INTO question_upvotes (question_id, participant_id) VALUES (?, ?)").run(questionId, participantId);
    }
  }

  setAnswered(sessionId: number, questionId: number, answered: boolean) {
    this.assertQuestion(sessionId, questionId);
    this.db.prepare("UPDATE questions SET answered = ? WHERE id = ?").run(answered ? 1 : 0, questionId);
  }

  setHidden(sessionId: number, questionId: number, hidden: boolean) {
    this.assertQuestion(sessionId, questionId);
    this.db.prepare("UPDATE questions SET hidden = ? WHERE id = ?").run(hidden ? 1 : 0, questionId);
  }

  // ---------- read models ----------

  snapshot(sessionId: number, opts: { forHost: boolean; audienceCount: number }): SessionState {
    const s = this.getSessionById(sessionId);

    const pollRows = this.db
      .prepare(`SELECT id, question, status, created_at FROM polls WHERE session_id = ? ${opts.forHost ? "" : "AND status != 'draft'"} ORDER BY id`)
      .all(sessionId) as { id: number; question: string; status: PollStatus; created_at: string }[];

    const optionRows = this.db
      .prepare(
        `SELECT o.id, o.poll_id, o.label, COUNT(v.participant_id) AS votes
         FROM poll_options o
         JOIN polls p ON p.id = o.poll_id
         LEFT JOIN votes v ON v.option_id = o.id
         WHERE p.session_id = ?
         GROUP BY o.id
         ORDER BY o.poll_id, o.position`,
      )
      .all(sessionId) as { id: number; poll_id: number; label: string; votes: number }[];

    const polls: Poll[] = pollRows.map((p) => {
      const options = optionRows.filter((o) => o.poll_id === p.id).map(({ id, label, votes }) => ({ id, label, votes }));
      return {
        id: p.id,
        question: p.question,
        status: p.status,
        options,
        totalVotes: options.reduce((n, o) => n + o.votes, 0),
        createdAt: p.created_at,
      };
    });

    const questionRows = this.db
      .prepare(
        `SELECT q.id, q.text, q.author, q.answered, q.hidden, q.created_at, COUNT(u.participant_id) AS upvotes
         FROM questions q
         LEFT JOIN question_upvotes u ON u.question_id = q.id
         WHERE q.session_id = ? ${opts.forHost ? "" : "AND q.hidden = 0"}
         GROUP BY q.id
         ORDER BY q.answered ASC, upvotes DESC, q.id ASC`,
      )
      .all(sessionId) as {
      id: number;
      text: string;
      author: string | null;
      answered: number;
      hidden: number;
      created_at: string;
      upvotes: number;
    }[];

    const questions: Question[] = questionRows.map((q) => ({
      id: q.id,
      text: q.text,
      author: q.author,
      upvotes: q.upvotes,
      answered: q.answered === 1,
      hidden: q.hidden === 1,
      createdAt: q.created_at,
    }));

    const active = polls.find((p) => p.id === s.active_poll_id && p.status !== "draft");
    return {
      session: { code: s.code, title: s.title, createdAt: s.created_at, endedAt: s.ended_at },
      polls,
      activePollId: active ? active.id : null,
      questions,
      audienceCount: opts.audienceCount,
    };
  }

  participantState(sessionId: number, participantId: string | undefined): ParticipantState {
    if (!participantId) return { votes: {}, upvoted: [] };
    const votes = this.db
      .prepare("SELECT v.poll_id, v.option_id FROM votes v JOIN polls p ON p.id = v.poll_id WHERE p.session_id = ? AND v.participant_id = ?")
      .all(sessionId, participantId) as { poll_id: number; option_id: number }[];
    const upvoted = this.db
      .prepare(
        "SELECT u.question_id FROM question_upvotes u JOIN questions q ON q.id = u.question_id WHERE q.session_id = ? AND u.participant_id = ?",
      )
      .all(sessionId, participantId) as { question_id: number }[];
    return {
      votes: Object.fromEntries(votes.map((v) => [v.poll_id, v.option_id])),
      upvoted: upvoted.map((u) => u.question_id),
    };
  }
}
