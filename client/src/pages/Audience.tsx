import { type FormEvent, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { LIMITS, type ParticipantState, type Poll, type Question } from "../../../shared/types";
import { ConnectionNotice } from "../components/ConnectionNotice";
import { ResultBars } from "../components/ResultBars";
import { plural, timeAgo } from "../lib/format";
import { displayName } from "../lib/storage";
import { type SessionHandle, useSession } from "../lib/useSession";

type Tab = "poll" | "questions";

export function Audience() {
  const code = (useParams().code ?? "").toUpperCase();
  const session = useSession(code, "audience");
  const [tab, setTab] = useState<Tab>("poll");
  const { status, error, state } = session;

  if (status === "error") {
    return (
      <main className="message-page">
        <h1>Couldn't join {code}</h1>
        <p>{error}</p>
        <Link className="button" to="/">
          Enter a different code
        </Link>
      </main>
    );
  }
  if (!state) return <main className="message-page">Joining {code}…</main>;

  const active = state.polls.find((p) => p.id === state.activePollId) ?? null;
  const ended = Boolean(state.session.endedAt);
  const openQuestions = state.questions.filter((q) => !q.answered).length;

  return (
    <div className="audience">
      <ConnectionNotice status={status} />
      <header className="audience__header">
        <span className="wordmark wordmark--small">Pollcast</span>
        <h1 className="audience__title">{state.session.title}</h1>
      </header>

      {ended && <p className="banner">This session has ended. Thanks for taking part.</p>}

      <div className="segmented segmented--wide" role="tablist" aria-label="Sections">
        <button role="tab" aria-selected={tab === "poll"} className={tab === "poll" ? "is-selected" : ""} onClick={() => setTab("poll")}>
          Poll
          {active?.status === "open" && session.me.votes[active.id] === undefined && (
            <span className="tab-dot" aria-label="needs your vote" />
          )}
        </button>
        <button
          role="tab"
          aria-selected={tab === "questions"}
          className={tab === "questions" ? "is-selected" : ""}
          onClick={() => setTab("questions")}
        >
          Questions <span className="count">{openQuestions}</span>
        </button>
      </div>

      <main className="audience__body">
        {tab === "poll" ? (
          <PollPanel poll={active} session={session} ended={ended} onAsk={() => setTab("questions")} />
        ) : (
          <QuestionsPanel questions={state.questions} session={session} ended={ended} />
        )}
      </main>
    </div>
  );
}

function PollPanel({ poll, session, ended, onAsk }: { poll: Poll | null; session: SessionHandle; ended: boolean; onAsk: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<number | null>(null);

  if (!poll) {
    return (
      <div className="waiting">
        <p className="waiting__title">{ended ? "No poll was run in this session." : "Waiting for the next poll"}</p>
        {!ended && (
          <p>
            It will appear here as soon as the presenter opens it. In the meantime you can{" "}
            <button className="text-button" onClick={onAsk}>
              ask a question
            </button>
            .
          </p>
        )}
      </div>
    );
  }

  const myVote = session.me.votes[poll.id];
  const voted = myVote !== undefined;

  const vote = async (optionId: number) => {
    setPending(optionId);
    const res = await session.send<ParticipantState>("vote", { pollId: poll.id, optionId });
    setPending(null);
    if (res.ok) {
      session.setMe(res.data);
      setError(null);
    } else setError(res.error);
  };

  if (poll.status === "open" && !voted) {
    return (
      <section aria-labelledby="poll-question">
        <h2 id="poll-question" className="poll-question">
          {poll.question}
        </h2>
        <ul className="vote-options">
          {poll.options.map((o) => (
            <li key={o.id}>
              <button className="vote-option" onClick={() => vote(o.id)} disabled={pending !== null}>
                {o.label}
                {pending === o.id && <span className="visually-hidden"> sending vote</span>}
              </button>
            </li>
          ))}
        </ul>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </section>
    );
  }

  return (
    <section aria-labelledby="poll-question">
      <h2 id="poll-question" className="poll-question">
        {poll.question}
      </h2>
      <ResultBars poll={poll} myOptionId={myVote} />
      {poll.status === "open" ? (
        <details className="change-vote">
          <summary>Change your vote</summary>
          <ul className="vote-options vote-options--compact">
            {poll.options.map((o) => (
              <li key={o.id}>
                <button className="vote-option" aria-pressed={o.id === myVote} onClick={() => vote(o.id)} disabled={pending !== null}>
                  {o.label}
                </button>
              </li>
            ))}
          </ul>
        </details>
      ) : (
        <p className="muted">Voting is closed.</p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

function QuestionsPanel({ questions, session, ended }: { questions: Question[]; session: SessionHandle; ended: boolean }) {
  const [text, setText] = useState("");
  const [name, setName] = useState(displayName.get);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const ask = async (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return setError("Type your question first.");
    setBusy(true);
    const res = await session.send("question:ask", { text, author: name.trim() || undefined });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    displayName.set(name.trim());
    setText("");
    setError(null);
    setSent(true);
  };

  const upvote = async (questionId: number) => {
    const res = await session.send<ParticipantState>("question:upvote", { questionId });
    if (res.ok) session.setMe(res.data);
    else setError(res.error);
  };

  return (
    <section>
      {!ended && (
        <form className="ask-form" onSubmit={ask} noValidate>
          <label className="field">
            <span className="field__label">Your question</span>
            <textarea
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setSent(false);
              }}
              maxLength={LIMITS.askMax}
              rows={3}
              placeholder="What would you like to ask?"
            />
            <span className="field__hint">{LIMITS.askMax - text.length} characters left</span>
          </label>
          <label className="field">
            <span className="field__label">Name (optional)</span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={LIMITS.authorMax} placeholder="Anonymous" />
          </label>
          <button className="button button--primary" disabled={busy}>
            Send question
          </button>
          {sent && (
            <p className="form-success" role="status">
              Question sent. Others can upvote it now.
            </p>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </form>
      )}

      <ul className="question-list">
        {questions.map((q) => {
          const mine = session.me.upvoted.includes(q.id);
          return (
            <li key={q.id} className={`question ${q.answered ? "is-answered" : ""}`}>
              <button
                className={`upvote ${mine ? "is-on" : ""}`}
                aria-pressed={mine}
                aria-label={`${mine ? "Remove upvote" : "Upvote"}: ${plural(q.upvotes, "upvote")}`}
                onClick={() => upvote(q.id)}
                disabled={ended}
              >
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M8 3l5 6H3z" />
                </svg>
                <span>{q.upvotes}</span>
              </button>
              <div className="question__body">
                <p className="question__text">{q.text}</p>
                <p className="question__meta">
                  {q.author ?? "Anonymous"}, {timeAgo(q.createdAt)}
                  {q.answered && <span className="answered-tag">Answered</span>}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
      {questions.length === 0 && <p className="empty">No questions yet. Yours could be the first.</p>}
    </section>
  );
}
