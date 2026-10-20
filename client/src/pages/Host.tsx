import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { Poll, Question } from "../../../shared/types";
import { ConnectionNotice, LiveDot } from "../components/ConnectionNotice";
import { JoinTicket } from "../components/JoinTicket";
import { PollComposer } from "../components/PollComposer";
import { ResultBars } from "../components/ResultBars";
import { joinUrl } from "../lib/api";
import { plural, timeAgo } from "../lib/format";
import { hostToken } from "../lib/storage";
import { useSession } from "../lib/useSession";

type QuestionFilter = "open" | "answered" | "hidden";

/** A host link can carry the token in the URL hash, so the host can move to another device. */
function useTokenFromHash(code: string) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const match = window.location.hash.match(/host=([A-Za-z0-9_-]+)/);
    if (match) {
      hostToken.set(code, match[1]);
      window.history.replaceState(null, "", window.location.pathname);
    }
    setReady(true);
  }, [code]);
  return ready;
}

export function Host() {
  const code = (useParams().code ?? "").toUpperCase();
  const ready = useTokenFromHash(code);
  return ready ? <HostView code={code} /> : null;
}

function HostView({ code }: { code: string }) {
  const { status, error, state, send } = useSession(code, "host");
  const [notice, setNotice] = useState<string | null>(null);
  const [filter, setFilter] = useState<QuestionFilter>("open");

  const flash = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice((m) => (m === message ? null : m)), 3000);
  };

  const act = async <T = undefined,>(event: Parameters<typeof send>[0], payload?: unknown) => {
    const res = await send<T>(event, payload);
    if (!res.ok) flash(res.error);
    return res;
  };

  const questions = useMemo(() => {
    const all = state?.questions ?? [];
    return {
      open: all.filter((q) => !q.answered && !q.hidden),
      answered: all.filter((q) => q.answered && !q.hidden),
      hidden: all.filter((q) => q.hidden),
    };
  }, [state?.questions]);

  if (status === "error") {
    return (
      <main className="message-page">
        <h1>Can't open this session as the host</h1>
        <p>{error}</p>
        <p>
          Host access is saved in the browser that created the session. Open the host link you copied, or{" "}
          <Link to={`/j/${code}`}>join as a participant</Link>.
        </p>
      </main>
    );
  }
  if (!state) return <main className="message-page">Loading session…</main>;

  const active = state.polls.find((p) => p.id === state.activePollId) ?? null;
  const ended = Boolean(state.session.endedAt);

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      flash(`${what} copied`);
    } catch {
      flash("Couldn't copy. Select the link and copy it manually.");
    }
  };

  return (
    <div className="host">
      <ConnectionNotice status={status} />
      <header className="host__header">
        <div className="host__title-block">
          <Link to="/" className="wordmark wordmark--small">
            Pollcast
          </Link>
          <h1 className="host__title">{state.session.title}</h1>
          <LiveDot count={state.audienceCount} />
        </div>
        <div className="host__tools">
          <a className="button" href={`/screen/${code}`} target="_blank" rel="noreferrer">
            Open projector view
          </a>
          <button className="button" onClick={() => copy(joinUrl(code), "Join link")}>
            Copy join link
          </button>
          <button
            className="button"
            onClick={() => copy(`${window.location.origin}/host/${code}#host=${hostToken.get(code) ?? ""}`, "Host link")}
            title="Opens the host controls on another device. Keep it private."
          >
            Copy host link
          </button>
          {!ended && (
            <button
              className="button button--danger"
              onClick={() => {
                if (window.confirm("End this session? Voting and questions will close for everyone.")) act("session:end");
              }}
            >
              End session
            </button>
          )}
        </div>
      </header>

      {notice && (
        <p className="toast" role="status">
          {notice}
        </p>
      )}

      {ended && <p className="banner">This session has ended. Results stay available here and on the projector view.</p>}

      <div className="host__grid">
        <section className="panel host__polls" aria-labelledby="polls-heading">
          <JoinTicket code={code} />

          <div className="host__live">
            <h2 id="polls-heading" className="panel__title">
              {active ? (active.status === "open" ? "Live now" : "Results") : "Polls"}
            </h2>
            {active ? (
              <>
                <p className="host__live-question">{active.question}</p>
                <ResultBars poll={active} />
                <div className="row">
                  {active.status === "open" ? (
                    <button className="button button--primary" onClick={() => act("poll:close", { pollId: active.id })}>
                      Close voting
                    </button>
                  ) : (
                    !ended && (
                      <button className="button" onClick={() => act("poll:open", { pollId: active.id })}>
                        Reopen voting
                      </button>
                    )
                  )}
                </div>
              </>
            ) : (
              <p className="empty">Create a poll below. Opening it puts it on everyone's phone and the projector.</p>
            )}
          </div>

          {!ended && (
            <PollComposer
              onCreate={async (input, openNow) => {
                const res = await send<{ pollId: number }>("poll:create", input);
                if (!res.ok) return res.error;
                if (openNow) await act("poll:open", { pollId: res.data.pollId });
                return null;
              }}
            />
          )}

          <PollList polls={state.polls} activeId={state.activePollId} ended={ended} act={act} />
        </section>

        <section className="panel host__questions" aria-labelledby="questions-heading">
          <h2 id="questions-heading" className="panel__title">
            Questions
          </h2>
          <div className="segmented" role="tablist" aria-label="Filter questions">
            {(
              [
                ["open", "To answer"],
                ["answered", "Answered"],
                ["hidden", "Hidden"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                role="tab"
                aria-selected={filter === key}
                className={filter === key ? "is-selected" : ""}
                onClick={() => setFilter(key)}
              >
                {label} <span className="count">{questions[key].length}</span>
              </button>
            ))}
          </div>
          <ul className="question-list">
            {questions[filter].map((q) => (
              <HostQuestion key={q.id} q={q} act={act} />
            ))}
          </ul>
          {questions[filter].length === 0 && (
            <p className="empty">
              {filter === "open"
                ? "Questions from the audience appear here, most upvoted first."
                : filter === "answered"
                  ? "Questions you mark as answered move here."
                  : "Hidden questions are removed from everyone else's screen."}
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

type Act = (event: Parameters<ReturnType<typeof useSession>["send"]>[0], payload?: unknown) => Promise<unknown>;

function PollList({ polls, activeId, ended, act }: { polls: Poll[]; activeId: number | null; ended: boolean; act: Act }) {
  if (polls.length === 0) return null;
  return (
    <div className="poll-list">
      <h3 className="panel__subtitle">All polls</h3>
      <ul>
        {[...polls].reverse().map((p) => (
          <li key={p.id} className={`poll-row ${p.id === activeId ? "is-active" : ""}`}>
            <div className="poll-row__main">
              <span className={`status status--${p.status}`}>{statusLabel(p, activeId)}</span>
              <span className="poll-row__question">{p.question}</span>
              <span className="poll-row__meta">{plural(p.totalVotes, "vote")}</span>
            </div>
            <div className="poll-row__actions">
              {!ended && p.status !== "open" && (
                <button className="text-button" onClick={() => act("poll:open", { pollId: p.id })}>
                  {p.status === "draft" ? "Open" : p.id === activeId ? "Reopen" : "Show"}
                </button>
              )}
              {p.totalVotes > 0 && (
                <button
                  className="text-button"
                  onClick={() => window.confirm("Clear all votes on this poll?") && act("poll:reset", { pollId: p.id })}
                >
                  Clear votes
                </button>
              )}
              <button
                className="text-button text-button--danger"
                onClick={() => window.confirm("Delete this poll and its votes?") && act("poll:delete", { pollId: p.id })}
              >
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function statusLabel(p: Poll, activeId: number | null) {
  if (p.status === "open") return "Live";
  if (p.status === "draft") return "Draft";
  return p.id === activeId ? "On screen" : "Closed";
}

function HostQuestion({ q, act }: { q: Question; act: Act }) {
  return (
    <li className={`question ${q.answered ? "is-answered" : ""}`}>
      <div className="question__votes" aria-label={plural(q.upvotes, "upvote")}>
        <span className="question__vote-count">{q.upvotes}</span>
      </div>
      <div className="question__body">
        <p className="question__text">{q.text}</p>
        <p className="question__meta">
          {q.author ?? "Anonymous"}, {timeAgo(q.createdAt)}
        </p>
        <div className="question__actions">
          {!q.hidden && (
            <button className="text-button" onClick={() => act("question:answer", { questionId: q.id, answered: !q.answered })}>
              {q.answered ? "Move back to unanswered" : "Mark answered"}
            </button>
          )}
          <button className="text-button" onClick={() => act("question:hide", { questionId: q.id, hidden: !q.hidden })}>
            {q.hidden ? "Show again" : "Hide"}
          </button>
        </div>
      </div>
    </li>
  );
}
