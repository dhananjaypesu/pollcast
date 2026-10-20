import Database from "better-sqlite3";

export type DB = Database.Database;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  id              INTEGER PRIMARY KEY,
  code            TEXT NOT NULL UNIQUE,
  title           TEXT NOT NULL,
  host_token_hash TEXT NOT NULL,
  active_poll_id  INTEGER,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ended_at        TEXT
);

CREATE TABLE IF NOT EXISTS polls (
  id          INTEGER PRIMARY KEY,
  session_id  INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  question    TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'open', 'closed')),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_polls_session ON polls(session_id);

CREATE TABLE IF NOT EXISTS poll_options (
  id        INTEGER PRIMARY KEY,
  poll_id   INTEGER NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  label     TEXT NOT NULL,
  position  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_options_poll ON poll_options(poll_id);

-- One row per participant per poll: changing your vote updates the row.
CREATE TABLE IF NOT EXISTS votes (
  poll_id         INTEGER NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  participant_id  TEXT NOT NULL,
  option_id       INTEGER NOT NULL REFERENCES poll_options(id) ON DELETE CASCADE,
  voted_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (poll_id, participant_id)
);

CREATE TABLE IF NOT EXISTS questions (
  id          INTEGER PRIMARY KEY,
  session_id  INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  text        TEXT NOT NULL,
  author      TEXT,
  participant_id TEXT NOT NULL,
  answered    INTEGER NOT NULL DEFAULT 0,
  hidden      INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_questions_session ON questions(session_id);

CREATE TABLE IF NOT EXISTS question_upvotes (
  question_id     INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  participant_id  TEXT NOT NULL,
  PRIMARY KEY (question_id, participant_id)
);
`;

export function openDatabase(path = ":memory:"): DB {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  return db;
}
