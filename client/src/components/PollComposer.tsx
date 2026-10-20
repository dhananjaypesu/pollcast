import { type FormEvent, useState } from "react";
import { LIMITS } from "../../../shared/types";

interface Props {
  onCreate: (input: { question: string; options: string[] }, openNow: boolean) => Promise<string | null>;
}

const blank = () => ["", ""];

export function PollComposer({ onCreate }: Props) {
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState<string[]>(blank);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const setOption = (i: number, value: string) => setOptions((opts) => opts.map((o, j) => (j === i ? value : o)));
  const removeOption = (i: number) => setOptions((opts) => opts.filter((_, j) => j !== i));

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const openNow = (e.nativeEvent as SubmitEvent).submitter?.getAttribute("value") === "open";
    const filled = options.map((o) => o.trim()).filter(Boolean);
    if (!question.trim()) return setError("Write a question first.");
    if (filled.length < LIMITS.optionsMin) return setError("Add at least two options.");
    setBusy(true);
    const problem = await onCreate({ question, options: filled }, openNow);
    setBusy(false);
    if (problem) return setError(problem);
    setQuestion("");
    setOptions(blank());
    setError(null);
  };

  return (
    <form className="composer" onSubmit={submit} noValidate>
      <label className="field">
        <span className="field__label">Question</span>
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          maxLength={LIMITS.questionMax}
          placeholder="Which topic should we revise on Friday?"
        />
      </label>

      <fieldset className="composer__options">
        <legend className="field__label">Options</legend>
        {options.map((option, i) => (
          <div className="composer__option" key={i}>
            <input
              value={option}
              onChange={(e) => setOption(i, e.target.value)}
              maxLength={LIMITS.optionMax}
              placeholder={`Option ${i + 1}`}
              aria-label={`Option ${i + 1}`}
            />
            {options.length > LIMITS.optionsMin && (
              <button type="button" className="icon-button" onClick={() => removeOption(i)} aria-label={`Remove option ${i + 1}`}>
                ×
              </button>
            )}
          </div>
        ))}
        {options.length < LIMITS.optionsMax && (
          <button type="button" className="text-button" onClick={() => setOptions((o) => [...o, ""])}>
            Add option
          </button>
        )}
      </fieldset>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      <div className="composer__actions">
        <button className="button button--primary" type="submit" value="open" disabled={busy}>
          Create and open
        </button>
        <button className="button" type="submit" value="draft" disabled={busy}>
          Save as draft
        </button>
      </div>
    </form>
  );
}
