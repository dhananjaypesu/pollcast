import { type FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { LIMITS } from "../../../shared/types";
import { api, normalizeCode } from "../lib/api";
import { hostToken } from "../lib/storage";

export function Home() {
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [joinError, setJoinError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"join" | "create" | null>(null);

  const join = async (e: FormEvent) => {
    e.preventDefault();
    const clean = normalizeCode(code);
    if (clean.length !== 6) return setJoinError("Codes are 6 characters, like K7QM2X.");
    setBusy("join");
    try {
      await api.lookup(clean);
      navigate(`/j/${clean}`);
    } catch {
      setJoinError(`No session uses the code ${clean}. Check the screen at the front of the room.`);
    } finally {
      setBusy(null);
    }
  };

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return setCreateError("Give your session a name so people know they're in the right place.");
    setBusy("create");
    try {
      const session = await api.createSession(title);
      hostToken.set(session.code, session.hostToken);
      navigate(`/host/${session.code}`);
    } catch (err) {
      setCreateError((err as Error).message);
      setBusy(null);
    }
  };

  return (
    <main className="home">
      <header className="home__brand">
        <span className="wordmark">Pollcast</span>
      </header>

      <section className="home__hero">
        <h1 className="home__title">Ask the room.</h1>
        <p className="home__lede">
          Live polls and questions for lectures, club meetings and fests. People join from their phones with a
          six-letter code: no app, no sign-up.
        </p>
      </section>

      <section className="home__join" aria-labelledby="join-heading">
        <h2 id="join-heading" className="home__h2">
          Joining a session?
        </h2>
        <form onSubmit={join} className="code-form" noValidate>
          <label className="visually-hidden" htmlFor="join-code">
            Session code
          </label>
          <input
            id="join-code"
            className="code-input"
            value={code}
            onChange={(e) => {
              setCode(normalizeCode(e.target.value));
              setJoinError(null);
            }}
            placeholder="K7QM2X"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            inputMode="text"
            maxLength={6}
          />
          <button className="button button--primary button--large" disabled={busy !== null}>
            Join
          </button>
        </form>
        {joinError && (
          <p className="form-error" role="alert">
            {joinError}
          </p>
        )}
      </section>

      <section className="home__create" aria-labelledby="create-heading">
        <h2 id="create-heading" className="home__h2">
          Presenting?
        </h2>
        <form onSubmit={create} className="create-form" noValidate>
          <label className="field">
            <span className="field__label">Session name</span>
            <input
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                setCreateError(null);
              }}
              maxLength={LIMITS.titleMax}
              placeholder="DBMS lecture 7: normalization"
            />
          </label>
          <button className="button" disabled={busy !== null}>
            Start a session
          </button>
        </form>
        {createError && (
          <p className="form-error" role="alert">
            {createError}
          </p>
        )}
      </section>
    </main>
  );
}
