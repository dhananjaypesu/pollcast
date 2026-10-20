import { useParams } from "react-router-dom";
import { JoinTicket } from "../components/JoinTicket";
import { ResultBars } from "../components/ResultBars";
import { plural } from "../lib/format";
import { useSession } from "../lib/useSession";

/** Full-screen view for the projector: the live poll, or the top questions when no poll is showing. */
export function Screen() {
  const code = (useParams().code ?? "").toUpperCase();
  const { status, error, state } = useSession(code, "screen");

  if (status === "error") return <main className="message-page">{error}</main>;
  if (!state) return <main className="message-page">Loading…</main>;

  const active = state.polls.find((p) => p.id === state.activePollId) ?? null;
  const topQuestions = state.questions.filter((q) => !q.answered).slice(0, 4);

  return (
    <div className="screen">
      <main className="screen__stage">
        {active ? (
          <>
            <p className={`screen__state ${active.status === "open" ? "is-live" : ""}`}>
              {active.status === "open" ? "Voting is open" : "Final results"}
            </p>
            <h1 className="screen__question">{active.question}</h1>
            <ResultBars poll={active} size="screen" />
          </>
        ) : (
          <>
            <h1 className="screen__question">{state.session.title}</h1>
            {topQuestions.length > 0 ? (
              <ol className="screen__questions">
                {topQuestions.map((q) => (
                  <li key={q.id}>
                    <span className="screen__q-votes">{q.upvotes}</span>
                    <span>{q.text}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="screen__hint">Join on your phone. Polls and questions will show up here.</p>
            )}
          </>
        )}
      </main>
      <aside className="screen__aside">
        <JoinTicket code={code} size="screen" />
        <p className="screen__count">{plural(state.audienceCount, "person", "people")} joined</p>
      </aside>
    </div>
  );
}
